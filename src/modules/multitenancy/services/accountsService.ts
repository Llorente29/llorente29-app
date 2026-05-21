// src/modules/multitenancy/services/accountsService.ts
//
// Service CRUD de cuentas (tenants). Núcleo del Shell multi-tenant.
//
// Operaciones:
//   - listAccounts(opts?)           → lista filtrada (RLS hace el scope real)
//   - getAccountById(id)            → una cuenta
//   - getAccountBySlug(slug)        → para validar duplicados / lookup por URL
//   - createAccount(input)          → alta (solo admin global por policy)
//   - updateAccount(id, patch)      → modificación
//   - setAccountStatus(id, status)  → ciclo de vida (trial/active/canceled…)
//
// DIFERENCIAS RESPECTO AL PATRÓN BRANDS (excepción consciente):
//   - NO hay archiveAccount / restoreAccount. El ciclo de vida es `status`
//     (trial/active/past_due/suspended/canceled). Una cuenta cancelada se
//     marca con setAccountStatus(id, 'canceled'), no se "archiva".
//   - listAccounts NO recibe accountId en options. La RLS de Supabase ya
//     restringe lo visible (policy accounts_read_own: ves las tuyas o eres
//     admin global). Documentado en §SHELL de multitenancy.ts.
//
// Convención de errores: todos los métodos LANZAN Error si falla la query.
// Los componentes envuelven en try/catch.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { slugify } from '../utils/slug'
import { sendPlatformEmail } from '../../../services/platformEmailService'
import type {
  Account,
  AccountInsert,
  AccountUpdate,
  AccountStatus,
  RowAccount,
  RowAccountInsert,
  RowAccountUpdate,
} from '../../../types/multitenancy'

// Días de gracia tras impago. DEBE COINCIDIR con GRACE_PERIOD_DAYS del
// componente AccountStatusGate (Sesión 16). Deuda menor: unificar en una
// constante compartida cuando toque. Se usa aquí solo para el email de impago.
const GRACE_PERIOD_DAYS = 7

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToAccount exportado para tests unitarios. No usar fuera de tests
// ni de este service — el resto del proyecto debe consumir las funciones
// públicas (listAccounts, getAccountById, etc.) que ya devuelven Account mapeado.
export function rowToAccount(row: RowAccount): Account {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    cif: row.cif,
    billingEmail: row.billing_email,
    billingPhone: row.billing_phone,
    billingAddress: (row.billing_address as Record<string, unknown> | null) ?? {},
    country: row.country,
    timezone: row.timezone,
    locale: row.locale,
    currency: row.currency,
    status: row.status as AccountStatus,
    isInternal: row.is_internal,
    trialEndsAt: row.trial_ends_at,
    pastDueAt: row.past_due_at,
    stripeCustomerId: row.stripe_customer_id,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  }
}

function accountInsertToRow(input: AccountInsert): RowAccountInsert {
  return {
    name: input.name,
    slug: input.slug,
    legal_name: input.legalName ?? null,
    cif: input.cif ?? null,
    billing_email: input.billingEmail ?? null,
    billing_phone: input.billingPhone ?? null,
    billing_address: (input.billingAddress ?? {}) as RowAccountInsert['billing_address'],
    country: input.country ?? 'ES',
    timezone: input.timezone ?? 'Europe/Madrid',
    locale: input.locale ?? 'es-ES',
    currency: input.currency ?? 'EUR',
    status: input.status ?? 'trial',
    is_internal: input.isInternal ?? false,
    trial_ends_at: input.trialEndsAt ?? null,
    stripe_customer_id: input.stripeCustomerId ?? null,
    metadata: (input.metadata ?? {}) as RowAccountInsert['metadata'],
    created_by: input.createdBy ?? null,
  }
}

function accountUpdateToRow(patch: AccountUpdate): RowAccountUpdate {
  const row: RowAccountUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.slug !== undefined) row.slug = patch.slug
  if (patch.legalName !== undefined) row.legal_name = patch.legalName
  if (patch.cif !== undefined) row.cif = patch.cif
  if (patch.billingEmail !== undefined) row.billing_email = patch.billingEmail
  if (patch.billingPhone !== undefined) row.billing_phone = patch.billingPhone
  if (patch.billingAddress !== undefined) {
    row.billing_address = patch.billingAddress as RowAccountUpdate['billing_address']
  }
  if (patch.country !== undefined) row.country = patch.country
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.locale !== undefined) row.locale = patch.locale
  if (patch.currency !== undefined) row.currency = patch.currency
  if (patch.status !== undefined) row.status = patch.status
  if (patch.trialEndsAt !== undefined) row.trial_ends_at = patch.trialEndsAt
  if (patch.stripeCustomerId !== undefined) row.stripe_customer_id = patch.stripeCustomerId
  if (patch.metadata !== undefined) {
    row.metadata = patch.metadata as RowAccountUpdate['metadata']
  }
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

/** Regex de formato slug. Espejo del CHECK accounts_slug_format en BBDD. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * Valida el formato del slug. Lanza Error si no cumple.
 * Usar antes de createAccount/updateAccount para fallar en cliente con
 * mensaje claro, en lugar de propagar el error críptico del CHECK Postgres.
 */
export function validateAccountSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Slug "${slug}" inválido. Debe usar solo minúsculas, dígitos y guiones, ` +
        `entre 1 y 64 caracteres, sin empezar ni acabar con guión.`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// Capa C de portería: aviso por email según transición de estado
// ─────────────────────────────────────────────────────────────────────

/**
 * Mapea un estado destino a la plantilla de email correspondiente.
 * Devuelve null si ese estado no tiene aviso asociado (p. ej. 'trial').
 */
function templateForStatus(status: AccountStatus): string | null {
  switch (status) {
    case 'past_due':
      return 'aviso_impago'
    case 'suspended':
      return 'aviso_suspension'
    case 'canceled':
      return 'aviso_cancelacion'
    case 'active':
      return 'aviso_reactivacion'
    default:
      return null
  }
}

/**
 * Dispara el email de aviso de portería según la transición de estado.
 *
 * BEST-EFFORT: no lanza nunca. Cualquier fallo se loguea con console.warn y
 * se ignora — el cambio de estado (operación crítica) ya está persistido.
 *
 * Reglas de disparo:
 *   - Solo si el estado CAMBIA de verdad (from !== to). Un re-marcado no reenvía.
 *   - Solo si el estado destino tiene plantilla (past_due/suspended/canceled/active).
 *   - 'active' solo se considera "reactivación" si venía de past_due o suspended
 *     (entrar en active desde trial NO es reactivación; no se avisa).
 *   - Solo si la cuenta tiene billingEmail (si no, no hay a quién enviar).
 */
async function notifyStatusChange(
  account: Account,
  fromStatus: AccountStatus,
): Promise<void> {
  const toStatus = account.status

  // 1. Sin cambio real → nada que avisar.
  if (fromStatus === toStatus) return

  // 2. Reactivación solo desde un estado "malo".
  if (toStatus === 'active' && fromStatus !== 'past_due' && fromStatus !== 'suspended') {
    return
  }

  // 3. ¿Hay plantilla para este destino?
  const template = templateForStatus(toStatus)
  if (!template) return

  // 4. ¿Hay email de facturación?
  const to = account.billingEmail
  if (!to || to.trim() === '') {
    console.warn(
      `[notifyStatusChange] cuenta ${account.id} (${account.name}) sin billingEmail; ` +
        `no se envía aviso de "${toStatus}".`
    )
    return
  }

  // 5. Datos para la plantilla.
  const data: Record<string, unknown> = {
    nombreCuenta: account.name,
  }
  if (toStatus === 'past_due') {
    data.diasGracia = GRACE_PERIOD_DAYS
  }

  // 6. Envío best-effort.
  const result = await sendPlatformEmail(to, template, data)
  if (!result.ok) {
    console.warn(
      `[notifyStatusChange] aviso "${template}" a ${to} (cuenta ${account.id}) ` +
        `falló: ${result.error}`
    )
  } else {
    console.log(
      `[notifyStatusChange] aviso "${template}" enviado a ${to} ` +
        `(cuenta ${account.id}, email_id=${result.emailId})`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

export interface ListAccountsOptions {
  /** Si true, incluye cuentas con is_internal=true. Default false. */
  includeInternal?: boolean
  /** Filtra por uno o varios status. Default: todos. */
  status?: AccountStatus | AccountStatus[]
  /** Filtro de texto sobre name o slug (case-insensitive). */
  search?: string
  /** Paginación. */
  limit?: number
  offset?: number
}

/**
 * Lista cuentas. Ordenadas alfabéticamente por nombre.
 *
 * IMPORTANTE: RLS hace el scope real (policy accounts_read_own). El usuario
 * ve las cuentas a las que pertenece, más todas las cuentas si es admin global.
 * Esta función NO recibe accountId — es excepción al patrón brands.
 */
export async function listAccounts(opts: ListAccountsOptions = {}): Promise<Account[]> {
  requireSupabase()
  let query = supabase!
    .from('accounts')
    .select('*')
    .order('name', { ascending: true })

  if (!opts.includeInternal) {
    query = query.eq('is_internal', false)
  }
  if (opts.status) {
    if (Array.isArray(opts.status)) {
      query = query.in('status', opts.status)
    } else {
      query = query.eq('status', opts.status)
    }
  }
  if (opts.search && opts.search.trim() !== '') {
    const term = `%${opts.search.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando cuentas: ${error.message}`)
  }
  return (data ?? []).map(rowToAccount)
}

/**
 * Obtiene una cuenta por id. Devuelve null si no existe o RLS la oculta.
 */
export async function getAccountById(id: string): Promise<Account | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo cuenta ${id}: ${error.message}`)
  }
  return data ? rowToAccount(data) : null
}

/**
 * Obtiene una cuenta por slug. Útil para resolver /:account-slug/ en URLs (Bloque C).
 */
export async function getAccountBySlug(slug: string): Promise<Account | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('accounts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo cuenta por slug "${slug}": ${error.message}`)
  }
  return data ? rowToAccount(data) : null
}

/**
 * Crea una nueva cuenta. Solo admin global puede invocarlo (policy accounts_write_admin).
 *
 * - Si no se pasa slug, se genera desde name con slugify.
 * - Valida formato de slug antes de mandar el insert.
 * - Detecta colisión de slug con error UX-friendly.
 */
export async function createAccount(input: AccountInsert): Promise<Account> {
  requireSupabase()

  const finalSlug = input.slug && input.slug.trim() !== ''
    ? input.slug.trim().toLowerCase()
    : slugify(input.name)

  validateAccountSlug(finalSlug)

  const existing = await getAccountBySlug(finalSlug)
  if (existing) {
    throw new Error(`Ya existe una cuenta con el slug "${finalSlug}".`)
  }

  const finalInput: AccountInsert = { ...input, slug: finalSlug }

  const { data, error } = await supabase!
    .from('accounts')
    .insert(accountInsertToRow(finalInput))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando cuenta: ${error.message}`)
  }
  return rowToAccount(data)
}

/**
 * Actualiza una cuenta. Solo campos presentes en patch se modifican.
 * Si se cambia el slug, valida formato y unicidad.
 */
export async function updateAccount(
  id: string,
  patch: AccountUpdate
): Promise<Account> {
  requireSupabase()

  if (patch.slug !== undefined) {
    const newSlug = patch.slug.trim().toLowerCase()
    validateAccountSlug(newSlug)

    const current = await getAccountById(id)
    if (!current) {
      throw new Error(`Cuenta ${id} no encontrada.`)
    }
    if (newSlug !== current.slug) {
      const dup = await getAccountBySlug(newSlug)
      if (dup && dup.id !== id) {
        throw new Error(`Ya existe una cuenta con el slug "${newSlug}".`)
      }
    }
    patch = { ...patch, slug: newSlug }
  }

  const rowPatch = accountUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getAccountById(id)
    if (!current) throw new Error(`Cuenta ${id} no encontrada.`)
    return current
  }

  const { data, error } = await supabase!
    .from('accounts')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando cuenta ${id}: ${error.message}`)
  }
  return rowToAccount(data)
}

/**
 * Cambia el status de una cuenta. Sustituye a archive/restore del patrón brands.
 *
 * Sella `past_due_at` de forma coherente con el estado (Sesión 16, Capa B):
 *   - Al ENTRAR en 'past_due' por primera vez → past_due_at = now() (inicio del
 *     impago, base del cálculo de días de gracia en cliente).
 *   - Si ya estaba en 'past_due' y se vuelve a marcar → NO se pisa past_due_at
 *     (un doble clic no debe regalar días de gracia ni reiniciar el contador).
 *   - Cualquier otro estado (active/trial/suspended/canceled) → past_due_at = null.
 *
 * AVISO POR EMAIL (Sesión 17, Bloque 2 — Capa C):
 *   Tras el cambio, dispara un email de aviso al billing_email de la cuenta
 *   según la transición (impago/suspensión/cancelación/reactivación). El envío
 *   es BEST-EFFORT: si falla, se loguea y se ignora. El cambio de estado ya
 *   está persistido y la función devuelve el Account igualmente.
 *
 * Ejemplos de uso:
 *   - setAccountStatus(id, 'active')   → activar tras trial (limpia past_due_at)
 *   - setAccountStatus(id, 'past_due') → impago detectado (sella past_due_at)
 *   - setAccountStatus(id, 'canceled') → cancelación definitiva (limpia past_due_at)
 */
export async function setAccountStatus(
  id: string,
  status: AccountStatus
): Promise<Account> {
  requireSupabase()

  // Necesitamos el estado actual para no pisar past_due_at en un re-marcado
  // y para conocer la transición (origen → destino) del aviso por email.
  const current = await getAccountById(id)
  if (!current) {
    throw new Error(`Cuenta ${id} no encontrada.`)
  }
  const fromStatus = current.status

  // Decide el valor de past_due_at según el estado destino.
  let pastDueAt: string | null
  if (status === 'past_due') {
    // Solo sella la primera vez que entra en impago; conserva la marca si ya estaba.
    pastDueAt = current.status === 'past_due' && current.pastDueAt
      ? current.pastDueAt
      : new Date().toISOString()
  } else {
    pastDueAt = null
  }

  const { data, error } = await supabase!
    .from('accounts')
    .update({ status, past_due_at: pastDueAt })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error cambiando status de cuenta ${id} a "${status}": ${error.message}`)
  }

  const updated = rowToAccount(data)

  // Aviso por email (best-effort, no rompe si falla). El estado ya está guardado.
  await notifyStatusChange(updated, fromStatus)

  return updated
}
