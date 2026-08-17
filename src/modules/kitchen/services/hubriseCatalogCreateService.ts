// src/modules/kitchen/services/hubriseCatalogCreateService.ts
//
// Alimenta el panel "Catálogos de marca" (hubrise-catalog-create) — encargo
// Carabanchel 17/08.
//
// LO QUE HAY QUE SABER ANTES DE LEER ESTO
// ---------------------------------------
// Las listas van por RLS del USUARIO (brand/locations: account_id = ANY
// current_user_account_ids()). Eso NO es una limitación que haya que sortear:
// es la garantía. hubrise-catalog-create autoriza leyendo la marca con el
// cliente del usuario, así que si un selector ofreciera una marca de otra
// cuenta, el botón daría 403. Mostrando solo lo que la sesión puede tocar, el
// selector no puede ofrecer nunca la marca del laboratorio en una sesión de
// producción — la trampa de los nombres duplicados se vuelve imposible por
// construcción, no por cuidado del que mira.
//
// Consecuencia operativa, que el panel dice en pantalla: el ensayo de
// laboratorio y la ejecución de producción son DOS SESIONES distintas, porque
// ningún usuario pertenece a las dos cuentas.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// Cuenta semilla del laboratorio. Todo lo que NO sea esta cuenta es un cliente
// real y se marca como producción en la interfaz.
export const LAB_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001'

// Alcalá. Se señala aparte porque no es "producción" a secas: lleva desde el
// 06/08 recibiendo pedidos reales y tiene 9 catálogos vivos.
export const ALCALA_EXTERNAL_LOCATION_ID = '1b6p8-0'

export interface CatalogBrandOption {
  id: string
  name: string
  accountId: string
  accountName: string
  ownershipType: string | null
  catalogSource: string | null
}

export interface CatalogLocationOption {
  locationId: string
  locationName: string
  accountId: string
  accountName: string
  externalLocationId: string
  externalLocationName: string | null
  isProduction: boolean
  isAlcala: boolean
}

function requireSupabase() {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
  return supabase
}

async function accountNames(ids: string[]): Promise<Record<string, string>> {
  const sb = requireSupabase()
  const out: Record<string, string> = {}
  if (ids.length === 0) return out
  const { data } = await sb.from('accounts').select('id, name').in('id', ids)
  for (const a of data ?? []) out[a.id as string] = (a.name as string) ?? '—'
  return out
}

/**
 * Marcas candidatas a tener catálogo propio en HubRise: SOLO las propias.
 * Las cedidas (ownership_type='licensed') y las gobernadas por el TPV
 * (catalog_source='pos') no van nunca a HubRise — su carta no la manda Folvy,
 * así que ni se listan. Filtrar aquí y no en la interfaz evita que un cambio
 * de pantalla las vuelva a colar.
 */
export async function listOwnBrandsForCatalog(): Promise<CatalogBrandOption[]> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('brand')
    .select('id, name, account_id, ownership_type, catalog_source')
    .eq('ownership_type', 'own')
    .eq('catalog_source', 'folvy')
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando marcas: ${error.message}`)

  const rows = data ?? []
  const names = await accountNames([...new Set(rows.map((b) => b.account_id as string))])
  return rows.map((b) => ({
    id: b.id as string,
    name: b.name as string,
    accountId: b.account_id as string,
    accountName: names[b.account_id as string] ?? '—',
    ownershipType: (b.ownership_type as string) ?? null,
    catalogSource: (b.catalog_source as string) ?? null,
  }))
}

/** Locales con conexión HubRise activa. Sin conexión no hay dónde crear nada. */
export async function listHubriseLocations(): Promise<CatalogLocationOption[]> {
  const sb = requireSupabase()
  const { data: maps, error: mapErr } = await sb
    .from('external_location_map')
    .select('location_id, external_location_id, external_location_name, account_id')
    .eq('source', 'hubrise')
    .eq('is_active', true)
  if (mapErr) throw new Error(`Error listando conexiones: ${mapErr.message}`)

  const rows = (maps ?? []).filter((m) => m.location_id && m.external_location_id)
  if (rows.length === 0) return []

  const { data: locs } = await sb
    .from('locations')
    .select('id, name, account_id')
    .in('id', rows.map((m) => m.location_id as string))
  const locById = new Map((locs ?? []).map((l) => [l.id as string, l]))
  const names = await accountNames([...new Set((locs ?? []).map((l) => l.account_id as string))])

  return rows
    .map((m): CatalogLocationOption | null => {
      const l = locById.get(m.location_id as string)
      if (!l) return null
      const accountId = l.account_id as string
      const externalLocationId = m.external_location_id as string
      return {
        locationId: l.id as string,
        locationName: (l.name as string) ?? '—',
        accountId,
        accountName: names[accountId] ?? '—',
        externalLocationId,
        externalLocationName: (m.external_location_name as string) ?? null,
        isProduction: accountId !== LAB_ACCOUNT_ID,
        isAlcala: externalLocationId === ALCALA_EXTERNAL_LOCATION_ID,
      }
    })
    .filter((x): x is CatalogLocationOption => x !== null)
    .sort((a, b) => (a.accountName + a.locationName).localeCompare(b.accountName + b.locationName))
}

export interface CreateCatalogInput {
  brandId: string
  locationId: string
  dryRun: boolean
}

/**
 * Invoca hubrise-catalog-create y devuelve la respuesta ENTERA, sin recortar.
 * El panel la pinta tal cual: es una herramienta de operación, y resumir la
 * respuesta sería esconder justo el dato que se ha venido a mirar
 * (scope_summary: de_local / de_cuenta / desconocido).
 */
export async function createBrandCatalog(
  input: CreateCatalogInput,
): Promise<{ ok: boolean; data: unknown; error: string | null }> {
  const sb = requireSupabase()
  const { data, error } = await sb.functions.invoke('hubrise-catalog-create', {
    body: {
      brand_id: input.brandId,
      location_id: input.locationId,
      dry_run: input.dryRun,
    },
  })
  if (error) return { ok: false, data, error: error.message }
  const d = (data ?? {}) as Record<string, unknown>
  return { ok: d.ok === true, data, error: (d.error as string | undefined) ?? null }
}
