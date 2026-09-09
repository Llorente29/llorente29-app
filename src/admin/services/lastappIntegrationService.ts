// src/admin/services/lastappIntegrationService.ts
//
// Herramienta INTERNA de Folvy (panel admin) para onboarding de una integración
// de Last.app de un cliente. Orquesta el procedimiento genérico — vale para
// marcas propias, cedidas (Cloudtown) o cualquier cliente nuevo:
//
//   1. Alta de la integración        → fila en external_integration (source='lastapp')
//   2. Vincular tiendas Last → local → fila(s) en external_location_map (source='lastapp')
//   2.bis Vincular marca externa → marca Folvy → fila(s) en external_brand_map (genérico)
//   3. Importar catálogo             → Edge lastapp-catalog-import (token desde Vault)
//   4. Sembrar catálogo              → seed_catalog_canonical
//   5. Recasar ventas ya entradas    → recast_lastapp_sales
//      (4 y 5 eran un botón; se separan el 09/09 — ver §4 abajo)
//
// (20/06) Tablas convergidas al modelo agnóstico external_*; los nombres de campo
// de dominio en TS conservan "lastapp" por estabilidad de la UI (deuda cosmética).
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
  const { data, error } = await from('external_integration')
    .select('id, account_id, external_org_id, organization_name, token_secret_name, ownership_type, is_active')
    .eq('account_id', accountId)
    .eq('source', 'lastapp')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Error cargando integraciones: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    accountId: r.account_id as string,
    lastappOrganizationId: r.external_org_id as string,
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
  const { error } = await from('external_integration').insert({
    account_id: input.accountId,
    source: 'lastapp',
    external_org_id: input.lastappOrganizationId,
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
  const { data, error } = await from('external_location_map')
    .select('id, external_location_id, external_location_name, location_id, needs_review')
    .eq('account_id', accountId)
    .eq('source', 'lastapp')
  if (error) throw new Error(`Error cargando locales vinculados: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    lastappLocationId: r.external_location_id as string,
    lastappLocationName: (r.external_location_name as string | null) ?? null,
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
  const { error } = await from('external_location_map').insert({
    account_id: input.accountId,
    source: 'lastapp',
    external_location_id: input.lastappLocationId,
    external_location_name: input.lastappLocationName,
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
  const { count, error } = await from('external_catalog_product')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('source', 'lastapp')
    .eq('external_org_id', lastappOrganizationId)
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

// ─── 4. Sembrar escandallos  ·  5. Recasar ventas ──────────────────────────
//
// (09/09) Eran UN botón. Se separan porque el recasado es útil por sí solo —
// se quiere reprocesar sin sembrar nada— y estaba secuestrado por el sembrado:
// para recasar había que aceptar de paso 237 filas nuevas de catálogo.
//
// Y ahora los dos devuelven sus cifras: ambas RPC ya las calculaban y la UI las
// tiraba a la basura (regla 8 — un botón que hace algo importante confirma CON
// CONTENIDO, no con un visto).

/** Una org del espejo y cuándo se sacó su última foto del catálogo. */
export interface FotoDeCatalogo {
  org: string
  ultimaFoto: string | null
  /** Horas transcurridas desde esa foto, como las devuelve la RPC. */
  horas: number
  filas: number
}

/** Un producto que se queda fuera por no estar en la última foto de su org. */
export interface ProductoFueraDeFoto {
  producto: string
  marca: string
  vistoPorUltimaVez: string | null
}

/**
 * Lo que devuelve seed_catalog_canonical.
 *
 * En ensayo (`dryRun`) las cifras son las MISMAS y no se escribe una fila: es
 * el mismo recorrido con los INSERT apagados.
 */
export interface SeedResult {
  /** Eco de lo que se pidió. Si viene true, no se ha escrito nada. */
  dryRun: boolean
  /** Matrículas de Last miradas. Las cinco cifras de abajo suman esto. */
  matriculasMiradas: number
  /** Ya estaban: no se tocan. */
  baseYaExistentes: number
  /** menu_item BASE creados (uno por marca × matrícula de Last). */
  productosBaseCreados: number
  /** Overrides de precio por canal creados. */
  overridesCreados: number
  /** De esos overrides, cuántos salen de una foto que no es la última. Se cuenta, no se corta. */
  overridesDeFotoVieja: number
  /** No se sembraron porque su marca de Last no resuelve en Folvy. */
  saltadosSinMarca: number
  /** No se sembraron por ser de marca PROPIA: su escandallo es de Folvy, no del TPV. */
  saltadosPorSerPropia: number
  /** No se sembraron por no estar en la última foto del catálogo de su org. */
  saltadosPorNoEstarEnLaFoto: number
  /** Los nombres, no solo el número (regla 7). */
  marcasSinResolver: string[]
  marcasPropiasSaltadas: string[]
  noEnLaFoto: ProductoFueraDeFoto[]
  fotos: FotoDeCatalogo[]
}

/**
 * Lo que devuelve recast_lastapp_sales.
 *
 * OJO con el ámbito, que no es el mismo en todos los campos:
 *  - `ventasProtegidas` y `corteEn` son de ESTA pasada (qué se dejó fuera y por dónde cortó).
 *  - todo lo demás (`ventasProcesadas`, `lineas*`) es el ESTADO DEL CASADO DE LA CUENTA
 *    ENTERA, medido después de reescribir. Lo dice la propia función en su comentario.
 *    No es "lo que ha hecho esta pasada": si se etiqueta como tal, se miente.
 */
export interface RecastResult {
  ventasProcesadas: number
  ventasProtegidas: number
  /** timestamptz en UTC. Se pinta en Europe/Madrid (regla 4). */
  corteEn: string | null
  lineasTotal: number
  lineasCasadas: number
  lineasNoBrand: number
  lineasNoRecipe: number
  lineasNoMenuItem: number
  lineasAmbiguous: number
  lineasRespetadas: number
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Un text[] de Postgres. Si no llega, lista vacía — nunca undefined pintado. */
function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Siembra el catálogo en el modelo CANÓNICO: 1 menu_item BASE por marca×matrícula
 * con external_source='lastapp' + external_id=matrícula, más su recipe_item y los
 * overrides de precio por canal. NO recasa ventas — eso es el botón de al lado.
 *
 * Sustituye al viejo seed_lastapp_catalog (modelo por canal + lastapp_product_map),
 * jubilado en la convergencia de ingesta (20/06).
 *
 * `dryRun` recorre exactamente lo mismo con los INSERT apagados y devuelve las
 * mismas cifras. Es obligatorio pasarlo: la RPC no le pone valor por defecto a
 * propósito, para que una llamada vieja falle en la cara en vez de escribir —o
 * de no escribir— en silencio.
 *
 * Dos guardas, y las dos CUENTAN Y LISTAN lo que dejan fuera (regla 7):
 *  - propiedad: sólo se siembra sobre marcas CEDIDAS. El escandallo de una marca
 *    propia es de Folvy, no se copia de lo que el TPV enseña al cliente.
 *  - foto: sólo lo que estaba en la última foto del catálogo de SU org. Y ojo,
 *    la vara es la foto de la org, no «los últimos N días»: las dos orgs de
 *    Foodint se refrescan en fechas distintas, así que un corte contra `now()`
 *    mediría cuándo miramos nosotros, no cuándo lo sirvió Last.
 */
export async function seedCatalogCanonical(
  accountId: string,
  dryRun: boolean,
): Promise<SeedResult> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('seed_catalog_canonical', {
    p_account_id: accountId,
    p_dry_run: dryRun,
  } as never)
  if (error) throw new Error(`Error sembrando el catálogo: ${error.message}`)
  const r = ((data as unknown as Row[] | null) ?? [])[0] ?? {}
  return {
    dryRun: r.dry_run === true,
    matriculasMiradas: num(r.matriculas_miradas),
    baseYaExistentes: num(r.base_ya_existentes),
    productosBaseCreados: num(r.productos_base_creados),
    overridesCreados: num(r.overrides_creados),
    overridesDeFotoVieja: num(r.overrides_de_foto_vieja),
    saltadosSinMarca: num(r.saltados_sin_marca),
    saltadosPorSerPropia: num(r.saltados_por_ser_propia),
    saltadosPorNoEstarEnLaFoto: num(r.saltados_por_no_estar_en_la_foto),
    marcasSinResolver: textos(r.marcas_sin_resolver),
    marcasPropiasSaltadas: textos(r.marcas_propias_saltadas),
    noEnLaFoto: ((r.no_en_la_foto as Row[] | null) ?? []).map(f => ({
      producto: (f.producto as string | null) ?? '(sin nombre)',
      marca: (f.marca as string | null) ?? '(sin marca)',
      vistoPorUltimaVez: (f.visto_por_ultima_vez as string | null) ?? null,
    })),
    fotos: ((r.fotos as Row[] | null) ?? []).map(f => ({
      org: (f.org as string | null) ?? '',
      ultimaFoto: (f.ultima_foto as string | null) ?? null,
      horas: num(f.horas),
      filas: num(f.filas),
    })),
  }
}

/**
 * Recasa las ventas de Last ya entradas: reprocesa cada una y deja el casado
 * escrito en sale_line (y lo que arrastra: sale.brand_id, stock_movement, stock
 * por local). NO siembra nada.
 *
 * CORTE (regla 6): la función se para en el último conteo de inventario cerrado
 * — no reprocesa por debajo de una verdad de stock ya fijada. Las que quedan
 * fuera vuelven en `ventasProtegidas`. Bajar del corte exige los dos parámetros
 * extra de la RPC (p_incluir_bajo_conteo + p_ventas_esperadas con la cifra
 * exacta), y eso NO se expone en esta pantalla a propósito: es una decisión con
 * autorización explícita, no un botón.
 *
 * Los tipos generados (src/types/database.ts) van por detrás de la firma real
 * —no traen ventas_protegidas ni corte_en, ni los dos parámetros nuevos—, así
 * que la fila se lee por nombre contra el objeto crudo. La BBDD es la verdad.
 */
export async function recastLastappSales(accountId: string): Promise<RecastResult> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('recast_lastapp_sales', { p_account_id: accountId })
  if (error) throw new Error(`Error recasando ventas: ${error.message}`)
  const r = ((data as unknown as Row[] | null) ?? [])[0] ?? {}
  return {
    ventasProcesadas: num(r.ventas_procesadas),
    ventasProtegidas: num(r.ventas_protegidas),
    corteEn: (r.corte_en as string | null) ?? null,
    lineasTotal: num(r.lineas_total),
    lineasCasadas: num(r.lineas_casadas),
    lineasNoBrand: num(r.lineas_no_brand),
    lineasNoRecipe: num(r.lineas_no_recipe),
    lineasNoMenuItem: num(r.lineas_no_menu_item),
    lineasAmbiguous: num(r.lineas_ambiguous),
    lineasRespetadas: num(r.lineas_respetadas),
  }
}
