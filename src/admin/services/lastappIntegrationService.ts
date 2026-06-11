// src/admin/services/lastappIntegrationService.ts
//
// Herramienta INTERNA de Folvy (panel admin) para onboarding de una integración
// de Last.app de un cliente. Orquesta el procedimiento genérico — vale para
// marcas propias, cedidas (Cloudtown) o cualquier cliente nuevo:
//
//   1. Alta de la integración        → fila en lastapp_integration (org + token_secret_name)
//   2. Vincular tiendas Last → local → fila(s) en lastapp_location_map
//   2.bis Vincular marca externa → marca Folvy → fila(s) en external_brand_map (genérico)
//   3. Importar catálogo             → Edge lastapp-catalog-import (token desde Vault)
//   4. Sembrar escandallos + recasar → seed_lastapp_catalog + recast_lastapp_sales
//
// SEGURIDAD: el VALOR del token NUNCA pasa por aquí ni por la pantalla. La fila
// solo guarda el NOMBRE del secret (token_secret_name); el valor se pone por CLI
// (`supabase secrets set <nombre>`) y la Edge lo lee de Vault. Escritura directa
// con la sesión del platform admin (igual patrón que accountModulesService; la
// RLS exige current_user_is_admin()).

import { supabase } from '@/lib/supabase'

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

type Row = Record<string, unknown>
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// ─── Tipos de dominio ──────────────────────────────────────────────────────

export interface LastappIntegration {
  id: string
  accountId: string
  lastappOrganizationId: string
  organizationName: string | null
  tokenSecretName: string
  ownershipType: string
  isActive: boolean
}

export interface LastappLocationMap {
  id: string
  lastappLocationId: string
  lastappLocationName: string | null
  locationId: string
  needsReview: boolean
}

export interface FolvyLocation {
  id: string
  name: string
}

// ─── 1. Integraciones ──────────────────────────────────────────────────────

export async function listIntegrations(accountId: string): Promise<LastappIntegration[]> {
  requireSupabase()
  const { data, error } = await from('lastapp_integration')
    .select('id, account_id, lastapp_organization_id, organization_name, token_secret_name, ownership_type, is_active')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Error cargando integraciones: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    accountId: r.account_id as string,
    lastappOrganizationId: r.lastapp_organization_id as string,
    organizationName: (r.organization_name as string | null) ?? null,
    tokenSecretName: r.token_secret_name as string,
    ownershipType: (r.ownership_type as string) ?? 'own',
    isActive: r.is_active !== false,
  }))
}

export async function createIntegration(input: {
  accountId: string
  lastappOrganizationId: string
  organizationName: string | null
  tokenSecretName: string
  ownershipType: string
}): Promise<void> {
  requireSupabase()
  const { error } = await from('lastapp_integration').insert({
    account_id: input.accountId,
    lastapp_organization_id: input.lastappOrganizationId,
    organization_name: input.organizationName,
    token_secret_name: input.tokenSecretName,
    ownership_type: input.ownershipType,
    is_active: true,
  })
  if (error) throw new Error(`No se pudo dar de alta la integración: ${error.message}`)
}

// ─── 2. Tiendas Last → locales Folvy ───────────────────────────────────────

export async function listLocationMaps(accountId: string): Promise<LastappLocationMap[]> {
  requireSupabase()
  const { data, error } = await from('lastapp_location_map')
    .select('id, lastapp_location_id, lastapp_location_name, location_id, needs_review')
    .eq('account_id', accountId)
  if (error) throw new Error(`Error cargando locales vinculados: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    lastappLocationId: r.lastapp_location_id as string,
    lastappLocationName: (r.lastapp_location_name as string | null) ?? null,
    locationId: r.location_id as string,
    needsReview: r.needs_review === true,
  }))
}

export async function listFolvyLocations(accountId: string): Promise<FolvyLocation[]> {
  requireSupabase()
  const { data, error } = await from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error cargando locales del cliente: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({ id: r.id as string, name: r.name as string }))
}

/**
 * Vincula una tienda Last a un local Folvy. Dos lastapp_location_id pueden
 * apuntar al MISMO location (misma cocina física, dos integraciones) — ya
 * soportado por el modelo. Tras vincular, las ventas futuras de esa tienda se
 * atribuyen; las ya entradas se casan con el paso 4 (sembrar + recasar).
 */
export async function linkLocation(input: {
  accountId: string
  lastappLocationId: string
  lastappLocationName: string | null
  locationId: string
}): Promise<void> {
  requireSupabase()
  const { error } = await from('lastapp_location_map').insert({
    account_id: input.accountId,
    lastapp_location_id: input.lastappLocationId,
    lastapp_location_name: input.lastappLocationName,
    location_id: input.locationId,
    needs_review: false,
  })
  if (error) throw new Error(`No se pudo vincular la tienda: ${error.message}`)
}

// ─── 2.bis  Marcas externas → marcas Folvy (amarre GENÉRICO) ────────────────
// Gemelo de linkLocation, a nivel marca. Tabla external_brand_map: source-agnostic
// (hoy 'lastapp'; mañana 'otter' sin cambios). El humano une una vez "id externo
// de marca = mi marca de Folvy"; a partir de ahí la atribución de marca de cada
// venta es determinista (por external_brand_id), no por nombre ni catálogo.

export interface ExternalBrandMap {
  id: string
  source: string
  externalLocationId: string
  externalBrandId: string
  brandId: string
}

export interface FolvyBrand {
  id: string
  name: string
}

export interface PendingExternalBrand {
  source: string
  externalLocationId: string
  externalBrandId: string
  folvyLocationId: string | null
  folvyLocationName: string | null
  ventas: number
  pistaCatalogo: string | null
  pistaProductos: string | null
}

export async function listBrandMaps(accountId: string): Promise<ExternalBrandMap[]> {
  requireSupabase()
  const { data, error } = await from('external_brand_map')
    .select('id, source, external_location_id, external_brand_id, brand_id')
    .eq('account_id', accountId)
  if (error) throw new Error(`Error cargando marcas vinculadas: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    source: r.source as string,
    externalLocationId: r.external_location_id as string,
    externalBrandId: r.external_brand_id as string,
    brandId: r.brand_id as string,
  }))
}

export async function listFolvyBrands(accountId: string): Promise<FolvyBrand[]> {
  requireSupabase()
  const { data, error } = await from('brand')
    .select('id, name')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error cargando marcas del cliente: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({ id: r.id as string, name: r.name as string }))
}

/**
 * Vincula una marca externa (de cualquier fuente) a una marca de Folvy.
 * El humano elige con la marca de Folvy delante; el id externo se guarda por debajo.
 * Tras vincular, las ventas de esa (source, external_location_id, external_brand_id)
 * se atribuyen a la marca de Folvy de forma determinista.
 */
export async function linkBrand(input: {
  accountId: string
  source: string
  externalLocationId: string
  externalBrandId: string
  brandId: string
}): Promise<void> {
  requireSupabase()
  const { error } = await from('external_brand_map').insert({
    account_id: input.accountId,
    source: input.source,
    external_location_id: input.externalLocationId,
    external_brand_id: input.externalBrandId,
    brand_id: input.brandId,
  })
  if (error) throw new Error(`No se pudo vincular la marca: ${error.message}`)
}

/**
 * Lista las marcas externas que han llegado en ventas y aún NO están vinculadas,
 * con pistas para reconocerlas (nombre de catálogo para propias, productos para
 * cedidas). Llama a la RPC list_pending_external_brands. Agnóstica de fuente.
 */
export async function listPendingExternalBrands(accountId: string): Promise<PendingExternalBrand[]> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('list_pending_external_brands', { p_account_id: accountId })
  if (error) throw new Error(`Error cargando marcas pendientes: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    source: r.source as string,
    externalLocationId: r.external_location_id as string,
    externalBrandId: r.external_brand_id as string,
    folvyLocationId: (r.folvy_location_id as string | null) ?? null,
    folvyLocationName: (r.folvy_location_name as string | null) ?? null,
    ventas: Number(r.ventas ?? 0),
    pistaCatalogo: (r.pista_catalogo as string | null) ?? null,
    pistaProductos: (r.pista_productos as string | null) ?? null,
  }))
}

/**
 * Marca una marca externa como IGNORADA (decisión deliberada de no vincularla).
 * Escribe en external_brand_map con brand_id NULL e is_ignored=true. Sale de
 * pendientes sin atribuir ventas. Reversible borrando la fila.
 */
export async function ignoreBrand(input: {
  accountId: string
  source: string
  externalLocationId: string
  externalBrandId: string
}): Promise<void> {
  requireSupabase()
  const { error } = await from('external_brand_map').insert({
    account_id: input.accountId,
    source: input.source,
    external_location_id: input.externalLocationId,
    external_brand_id: input.externalBrandId,
    brand_id: null,
    is_ignored: true,
  })
  if (error) throw new Error(`No se pudo ignorar la marca: ${error.message}`)
}

// ─── 3. Catálogo ───────────────────────────────────────────────────────────

export async function getCatalogCount(
  accountId: string,
  lastappOrganizationId: string,
): Promise<number> {
  requireSupabase()
  const { count, error } = await from('lastapp_catalog_product')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('lastapp_organization_id', lastappOrganizationId)
  if (error) throw new Error(`Error contando catálogo: ${error.message}`)
  return count ?? 0
}

/** Resumen que devuelve la Edge (report). Campos relevantes para la UI. */
export interface ImportReport {
  ok?: boolean
  dry_run?: boolean
  brands_in_use?: string[]
  brands_skipped_empty?: string[]
  brands_unresolved?: string[]
  categories?: number
  products?: number
  combos?: number
  modifier_groups?: number
  warnings?: string[]
}

export type ImportResult = { ok: true; summary: ImportReport } | { ok: false; error: string }

async function parseInvokeError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json()
      if (parsed?.error) return parsed.error as string
    }
  } catch {
    // ignore
  }
  return (error as { message?: string })?.message ?? 'Error invocando el importador.'
}

/**
 * Invoca la Edge lastapp-catalog-import. El token NO viaja: la Edge lo lee de
 * Vault por (account_id, lastapp_organization_id) → token_secret_name. El JWT
 * del platform admin lo adjunta functions.invoke automáticamente (la Edge
 * autoriza en su frontera). `dryRun` simula sin escribir.
 */
export async function importCatalog(input: {
  accountId: string
  lastappOrganizationId: string
  dryRun?: boolean
}): Promise<ImportResult> {
  const sb = supabase
  if (!sb) return { ok: false, error: 'Supabase no está configurado.' }
  try {
    const { data, error } = await sb.functions.invoke('lastapp-catalog-import', {
      body: {
        account_id: input.accountId,
        lastapp_organization_id: input.lastappOrganizationId,
        dry_run: input.dryRun ?? false,
      },
    })
    if (error) return { ok: false, error: await parseInvokeError(error) }
    const body = data as ImportReport & { error?: string }
    if (body?.error) return { ok: false, error: body.error }
    return { ok: true, summary: body }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' }
  }
}

// ─── 4. Sembrar escandallos + recasar ──────────────────────────────────────

/**
 * Siembra escandallos del catálogo (seed_lastapp_catalog: crea recipe_item dish
 * needs_review + menu_item por canal + lastapp_product_map para los productos
 * con marca conocida) y recasa las ventas ya entradas (recast_lastapp_sales).
 * Tras esto, las ventas que tenían catálogo pero no escandallo quedan casadas.
 *
 * No se parsean los contadores de retorno a propósito (los nombres de columna
 * del RETURNS no están verificados): la UI confirma éxito y remite a Ventas para
 * ver el casado real. Surfacing de cifras = mejora menor posterior.
 */
export async function seedAndRecast(accountId: string): Promise<void> {
  const sb = requireSupabase()
  const { error: seedErr } = await sb.rpc('seed_lastapp_catalog', { p_account_id: accountId })
  if (seedErr) throw new Error(`Error sembrando escandallos: ${seedErr.message}`)
  const { error: recastErr } = await sb.rpc('recast_lastapp_sales', { p_account_id: accountId })
  if (recastErr) throw new Error(`Error recasando ventas: ${recastErr.message}`)
}
