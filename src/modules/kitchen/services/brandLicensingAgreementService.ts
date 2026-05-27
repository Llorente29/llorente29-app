// src/modules/kitchen/services/brandLicensingAgreementService.ts
//
// Service CRUD del acuerdo de cesión de marca (brand_licensing_agreement).
// Capa 2 / host kitchen: tú cocinas la marca de un tercero y cobras un
// revenue_share sobre PVP sin IVA. UNIQUE(brand_id) → un acuerdo por marca.
//
// Operaciones:
//   - listLicensingAgreements(opts)      → lista filtrada
//   - getLicensingAgreementById(id)      → uno
//   - getLicensingAgreementByBrandId(b)  → el acuerdo de una marca (o null)
//   - createLicensingAgreement(input)    → alta
//   - updateLicensingAgreement(id,patch) → modificación
//   - archiveLicensingAgreement(id)      → soft delete
//   - restoreLicensingAgreement(id)      → des-archivar
//
// Convención de errores: todos los métodos LANZAN Error. Componentes en try/catch.
// Identidad operativa (v17.1): el caller pasa createdBy/createdByName.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  BrandLicensingAgreement,
  BrandLicensingAgreementInsert,
  BrandLicensingAgreementUpdate,
  RowBrandLicensingAgreement,
  RowBrandLicensingAgreementInsert,
  RowBrandLicensingAgreementUpdate,
} from '../../../types/kitchen'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

export function rowToLicensingAgreement(
  row: RowBrandLicensingAgreement
): BrandLicensingAgreement {
  return {
    id: row.id,
    accountId: row.account_id,
    brandId: row.brand_id,
    ownerName: row.owner_name,
    revenueSharePct: row.revenue_share_pct,
    reimbursesConsumption: row.reimburses_consumption,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    notes: row.notes,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function licensingInsertToRow(
  input: BrandLicensingAgreementInsert
): RowBrandLicensingAgreementInsert {
  return {
    account_id: input.accountId,
    brand_id: input.brandId,
    owner_name: input.ownerName,
    revenue_share_pct: input.revenueSharePct,
    reimburses_consumption: input.reimbursesConsumption ?? true,
    starts_on: input.startsOn ?? null,
    ends_on: input.endsOn ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function licensingUpdateToRow(
  patch: BrandLicensingAgreementUpdate
): RowBrandLicensingAgreementUpdate {
  const row: RowBrandLicensingAgreementUpdate = {}
  if (patch.ownerName !== undefined) row.owner_name = patch.ownerName
  if (patch.revenueSharePct !== undefined) row.revenue_share_pct = patch.revenueSharePct
  if (patch.reimbursesConsumption !== undefined) row.reimburses_consumption = patch.reimbursesConsumption
  if (patch.startsOn !== undefined) row.starts_on = patch.startsOn
  if (patch.endsOn !== undefined) row.ends_on = patch.endsOn
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
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

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

export interface ListLicensingAgreementsOptions {
  accountId: string
  includeArchived?: boolean
  includeInactive?: boolean
  limit?: number
  offset?: number
}

export async function listLicensingAgreements(
  opts: ListLicensingAgreementsOptions
): Promise<BrandLicensingAgreement[]> {
  requireSupabase()
  let query = supabase!
    .from('brand_licensing_agreement')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('owner_name', { ascending: true })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando acuerdos de cesión: ${error.message}`)
  }
  return (data ?? []).map(rowToLicensingAgreement)
}

export async function getLicensingAgreementById(
  id: string
): Promise<BrandLicensingAgreement | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo acuerdo ${id}: ${error.message}`)
  }
  return data ? rowToLicensingAgreement(data) : null
}

export async function getLicensingAgreementByBrandId(
  brandId: string
): Promise<BrandLicensingAgreement | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .select('*')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo acuerdo de la marca ${brandId}: ${error.message}`)
  }
  return data ? rowToLicensingAgreement(data) : null
}

export async function createLicensingAgreement(
  input: BrandLicensingAgreementInsert
): Promise<BrandLicensingAgreement> {
  requireSupabase()

  const existing = await getLicensingAgreementByBrandId(input.brandId)
  if (existing) {
    throw new Error('Esta marca ya tiene un acuerdo de cesión.')
  }

  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .insert(licensingInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando acuerdo de cesión: ${error.message}`)
  }
  return rowToLicensingAgreement(data)
}

export async function updateLicensingAgreement(
  id: string,
  patch: BrandLicensingAgreementUpdate
): Promise<BrandLicensingAgreement> {
  requireSupabase()

  const rowPatch = licensingUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getLicensingAgreementById(id)
    if (!current) throw new Error(`Acuerdo ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando acuerdo ${id}: ${error.message}`)
  }
  return rowToLicensingAgreement(data)
}

export async function archiveLicensingAgreement(
  id: string
): Promise<BrandLicensingAgreement> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando acuerdo ${id}: ${error.message}`)
  }
  return rowToLicensingAgreement(data)
}

export async function restoreLicensingAgreement(
  id: string
): Promise<BrandLicensingAgreement> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand_licensing_agreement')
    .update({
      is_active: true,
      archived_at: null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando acuerdo ${id}: ${error.message}`)
  }
  return rowToLicensingAgreement(data)
}
