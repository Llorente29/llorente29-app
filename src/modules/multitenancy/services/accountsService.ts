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
import type {
  Account,
  AccountInsert,
  AccountUpdate,
  AccountStatus,
  RowAccount,
  RowAccountInsert,
  RowAccountUpdate,
} from '../../../types/multitenancy'

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
 * Ejemplos de uso:
 *   - setAccountStatus(id, 'active')   → activar tras trial
 *   - setAccountStatus(id, 'past_due') → impago detectado
 *   - setAccountStatus(id, 'canceled') → cancelación definitiva (soft delete semántico)
 */
export async function setAccountStatus(
  id: string,
  status: AccountStatus
): Promise<Account> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('accounts')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error cambiando status de cuenta ${id} a "${status}": ${error.message}`)
  }
  return rowToAccount(data)
}
