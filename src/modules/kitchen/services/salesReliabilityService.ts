// src/modules/kitchen/services/salesReliabilityService.ts
//
// Fiabilidad del casado de ventas (capa 4 del subsistema). Lectura.
//   - getReliability(accountId, from, to) → la señal central (RPC sales_mapping_reliability).
//   - listBlindLines(accountId, from, to) → las líneas SIN CASAR agrupadas por producto
//     y razón, con su importe y sus tickets (dónde se vendió).
//   - suggestMatch(accountId, productName) → sugerencia de IA (RPC run_mapping): a qué
//     escandallo se parece el producto ciego, con confianza + semáforo.
//
// Patrón del proyecto: supabase directo, requireSupabase(), mappers row->domain,
// scope cuenta. El cálculo de la señal es server-side (denominador honesto casado/total);
// aquí NO se recalcula nada, solo se lee.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio
// ─────────────────────────────────────────────────────────────────────

export type ReliabilityStatus = 'verde' | 'ambar' | 'rojo'

export interface SalesReliability {
  revenueTotal: number
  revenueCasado: number
  revenueSinCasar: number
  reliabilityPct: number | null
  thresholdPct: number
  status: ReliabilityStatus
  lineasTotal: number
  lineasCasadas: number
  // desglose del dinero ciego
  ciegoDesconocidoEur: number   // no_recipe: coste no estimable
  ciegoDesconocidoLineas: number
  ciegoCalculableEur: number    // no_menu_item: coste calculable
  ciegoCalculableLineas: number
  ciegoOtrosEur: number
  ciegoOtrosLineas: number
  // casado pero SIN COSTE: dinero vendido y casado cuyo food cost es desconocido
  casadoSinCosteEur: number
  casadoSinCosteLineas: number
  costCoveragePct: number | null   // % del casado que SÍ tiene coste conocido
}

export type BlindReason = 'no_recipe' | 'no_menu_item' | 'no_brand' | 'ambiguous' | 'otros'

export interface BlindTicket {
  saleId: string
  soldAt: string | null
  quantity: number
  lineTotal: number
}

export interface BlindProduct {
  productName: string
  reason: BlindReason
  salesCount: number      // nº de tickets donde aparece
  totalEur: number        // importe acumulado
  tickets: BlindTicket[]  // tickets (orden desc por fecha)
}

export interface BlindGroup {
  reason: BlindReason
  products: BlindProduct[]
  totalEur: number
  productCount: number
}

export interface MatchSuggestion {
  recipeItemId: string
  name: string
  folvyCode: string | null
  confidence: number
  matchType: string
  semaphore: 'green' | 'yellow'
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

// Rango por defecto: últimos 90 días (igual que location_economics / el RPC).
function defaultRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

// Etiqueta de razón → grupo de dominio (todo lo que no es no_recipe/no_menu_item cae en 'otros').
function toBlindReason(raw: string | null): BlindReason {
  if (raw === 'no_recipe' || raw === 'no_menu_item' || raw === 'no_brand' || raw === 'ambiguous') {
    return raw
  }
  return 'otros'
}

// ─────────────────────────────────────────────────────────────────────
// Fila cruda del RPC sales_mapping_reliability (snake_case)
// ─────────────────────────────────────────────────────────────────────

interface RowReliability {
  revenue_total: number
  revenue_casado: number
  revenue_sin_casar: number
  reliability_pct: number | null
  threshold_pct: number
  status: string
  lineas_total: number
  lineas_casadas: number
  ciego_desconocido_eur: number
  ciego_desconocido_lineas: number
  ciego_calculable_eur: number
  ciego_calculable_lineas: number
  ciego_otros_eur: number
  ciego_otros_lineas: number
  casado_sin_coste_eur: number
  casado_sin_coste_lineas: number
  cost_coverage_pct: number | null
}

function rowToReliability(r: RowReliability): SalesReliability {
  return {
    revenueTotal: Number(r.revenue_total ?? 0),
    revenueCasado: Number(r.revenue_casado ?? 0),
    revenueSinCasar: Number(r.revenue_sin_casar ?? 0),
    reliabilityPct: r.reliability_pct === null ? null : Number(r.reliability_pct),
    thresholdPct: Number(r.threshold_pct ?? 90),
    status: (r.status as ReliabilityStatus) ?? 'verde',
    lineasTotal: Number(r.lineas_total ?? 0),
    lineasCasadas: Number(r.lineas_casadas ?? 0),
    ciegoDesconocidoEur: Number(r.ciego_desconocido_eur ?? 0),
    ciegoDesconocidoLineas: Number(r.ciego_desconocido_lineas ?? 0),
    ciegoCalculableEur: Number(r.ciego_calculable_eur ?? 0),
    ciegoCalculableLineas: Number(r.ciego_calculable_lineas ?? 0),
    ciegoOtrosEur: Number(r.ciego_otros_eur ?? 0),
    ciegoOtrosLineas: Number(r.ciego_otros_lineas ?? 0),
    casadoSinCosteEur: Number(r.casado_sin_coste_eur ?? 0),
    casadoSinCosteLineas: Number(r.casado_sin_coste_lineas ?? 0),
    costCoveragePct: r.cost_coverage_pct === null || r.cost_coverage_pct === undefined
      ? null : Number(r.cost_coverage_pct),
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

/**
 * La señal central de fiabilidad del casado (% casado por importe / total),
 * con el desglose del dinero ciego. Server-side, sin recálculo en cliente.
 */
export async function getReliability(
  accountId: string,
  from?: string,
  to?: string,
): Promise<SalesReliability> {
  requireSupabase()
  const range = from && to ? { from, to } : defaultRange()
  const { data, error } = await supabase!.rpc('sales_mapping_reliability', {
    p_account_id: accountId,
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw new Error(`Error calculando fiabilidad del casado: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as RowReliability | undefined
  if (!row) {
    // Sin ventas en el periodo: señal neutra (verde, todo a cero).
    return {
      revenueTotal: 0, revenueCasado: 0, revenueSinCasar: 0,
      reliabilityPct: null, thresholdPct: 90, status: 'verde',
      lineasTotal: 0, lineasCasadas: 0,
      ciegoDesconocidoEur: 0, ciegoDesconocidoLineas: 0,
      ciegoCalculableEur: 0, ciegoCalculableLineas: 0,
      ciegoOtrosEur: 0, ciegoOtrosLineas: 0,
      casadoSinCosteEur: 0, casadoSinCosteLineas: 0, costCoveragePct: null,
    }
  }
  return rowToReliability(row)
}

/**
 * Las líneas SIN CASAR (menu_item_id null) de productos, agrupadas por razón y por
 * producto, con sus tickets. El cliente agrega (N pequeño: las líneas ciegas son
 * decenas). No inventa: lee lo que recast_lastapp_sales dejó escrito.
 *
 * Orden: grupos por importe ciego desc (no_recipe suele liderar); dentro de cada
 * grupo, productos por importe desc.
 */
export async function listBlindLines(
  accountId: string,
  from?: string,
  to?: string,
): Promise<BlindGroup[]> {
  requireSupabase()
  const range = from && to ? { from, to } : defaultRange()

  // 1) Ventas activas del periodo (id + fecha) para acotar y aportar la fecha del ticket.
  const saleIds: string[] = []
  const soldAtById = new Map<string, string | null>()
  {
    const pageSize = 1000
    let offset = 0
    for (;;) {
      const { data, error } = await supabase!
        .from('sale')
        .select('id, sold_at')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .gte('sold_at', range.from)
        .lt('sold_at', range.to)
        .range(offset, offset + pageSize - 1)
      if (error) throw new Error(`Error listando ventas: ${error.message}`)
      if (!data || data.length === 0) break
      for (const s of data) {
        saleIds.push(s.id as string)
        soldAtById.set(s.id as string, (s.sold_at as string) ?? null)
      }
      if (data.length < pageSize) break
      offset += pageSize
    }
  }
  if (saleIds.length === 0) return []

  // 2) Líneas de producto sin casar de esas ventas.
  const saleIdSet = new Set(saleIds)
  interface RawLine {
    sale_id: string
    product_name: string | null
    quantity: number | null
    line_total: number | null
    unit_price: number | null
    unmapped_reason: string | null
  }
  const lines: RawLine[] = []
  {
    const pageSize = 1000
    let offset = 0
    for (;;) {
      const { data, error } = await supabase!
        .from('sale_line')
        .select('sale_id, product_name, quantity, line_total, unit_price, unmapped_reason, line_type, menu_item_id')
        .eq('account_id', accountId)
        .is('menu_item_id', null)
        .range(offset, offset + pageSize - 1)
      if (error) throw new Error(`Error listando líneas: ${error.message}`)
      if (!data || data.length === 0) break
      for (const l of data as Record<string, unknown>[]) {
        const lt = (l.line_type as string) ?? 'product'
        if (lt !== 'product') continue
        if (!saleIdSet.has(l.sale_id as string)) continue
        lines.push({
          sale_id: l.sale_id as string,
          product_name: (l.product_name as string) ?? null,
          quantity: l.quantity as number | null,
          line_total: l.line_total as number | null,
          unit_price: l.unit_price as number | null,
          unmapped_reason: (l.unmapped_reason as string) ?? null,
        })
      }
      if (data.length < pageSize) break
      offset += pageSize
    }
  }
  if (lines.length === 0) return []

  // 3) Agregar por (razón, nombre de producto).
  const key = (reason: BlindReason, name: string) => `${reason}␟${name}`
  const productByKey = new Map<string, BlindProduct>()
  for (const l of lines) {
    const reason = toBlindReason(l.unmapped_reason)
    const name = (l.product_name ?? '(sin nombre)').trim()
    const k = key(reason, name)
    const amt = Number(l.line_total ?? (Number(l.unit_price ?? 0) * Number(l.quantity ?? 1)))
    let prod = productByKey.get(k)
    if (!prod) {
      prod = { productName: name, reason, salesCount: 0, totalEur: 0, tickets: [] }
      productByKey.set(k, prod)
    }
    prod.salesCount++
    prod.totalEur += amt
    prod.tickets.push({
      saleId: l.sale_id,
      soldAt: soldAtById.get(l.sale_id) ?? null,
      quantity: Number(l.quantity ?? 1),
      lineTotal: amt,
    })
  }

  // 4) Agrupar productos por razón.
  const groupByReason = new Map<BlindReason, BlindGroup>()
  for (const prod of productByKey.values()) {
    prod.tickets.sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? ''))
    prod.totalEur = Math.round(prod.totalEur * 100) / 100
    let g = groupByReason.get(prod.reason)
    if (!g) {
      g = { reason: prod.reason, products: [], totalEur: 0, productCount: 0 }
      groupByReason.set(prod.reason, g)
    }
    g.products.push(prod)
    g.totalEur += prod.totalEur
    g.productCount++
  }

  // 5) Ordenar: dentro de cada grupo por importe desc; grupos por importe ciego desc.
  const groups = Array.from(groupByReason.values())
  for (const g of groups) {
    g.products.sort((a, b) => b.totalEur - a.totalEur)
    g.totalEur = Math.round(g.totalEur * 100) / 100
  }
  groups.sort((a, b) => b.totalEur - a.totalEur)
  return groups
}

// ─────────────────────────────────────────────────────────────────────
// Fila cruda del RPC run_mapping (snake_case)
// ─────────────────────────────────────────────────────────────────────

interface RowRunMapping {
  recipe_item_id: string
  name: string
  folvy_code: string | null
  confidence: number
  match_type: string
  semaphore: string
}

// ─────────────────────────────────────────────────────────────────────
// Acciones de resolución (Entrega B): link / ignore / delist
// ─────────────────────────────────────────────────────────────────────

export type ResolveAction = 'link' | 'ignore' | 'delist'

export interface ResolveResult {
  resultado: 'linked' | 'ignored' | 'delisted'
  menuItemId: string | null
  recipeItemId: string | null
  brandId: string | null
  lineasAfectadas: number
}

interface RowResolve {
  resultado: string
  menu_item_id: string | null
  recipe_item_id: string | null
  brand_id: string | null
  lineas_afectadas: number
}

/**
 * Resuelve un producto ciego. 'link' (solo no_menu_item: crea el plato en carta
 * y recasa) | 'ignore' | 'delist'. La lógica de resolución vive en la RPC
 * resolve_unmapped_sales (reusa la cadena del recast, no la duplica). La RPC lanza
 * EXCEPTION si el producto es combo o no tiene receta (link): se propaga como Error.
 */
export async function resolveUnmapped(
  accountId: string,
  productName: string,
  action: ResolveAction,
): Promise<ResolveResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('resolve_unmapped_sales', {
    p_account_id: accountId,
    p_product_name: productName,
    p_action: action,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as RowResolve | undefined
  if (!row) throw new Error('La acción no devolvió resultado.')
  return {
    resultado: row.resultado as ResolveResult['resultado'],
    menuItemId: row.menu_item_id ?? null,
    recipeItemId: row.recipe_item_id ?? null,
    brandId: row.brand_id ?? null,
    lineasAfectadas: Number(row.lineas_afectadas ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Clasificación de un producto ciego (Capa 1, frente "modelo de producto")
// ─────────────────────────────────────────────────────────────────────

export type ClassifyAction = 'resale' | 'dish' | 'combo'

export interface ClassifyResult {
  resultado: 'resale_linked' | 'is_dish' | 'is_combo'
  recipeItemId: string | null
  marcasCreadas: number
  lineasCasadas: number
}

interface RowClassify {
  resultado: string
  recipe_item_id: string | null
  marcas_creadas: number
  lineas_casadas: number
}

/**
 * Clasifica un producto ciego (no_recipe). 'resale' (artículo de reventa: convierte
 * a raw vendible con coste de compra y propaga a todas las marcas) | 'dish' (es un
 * plato: devuelve el recipe_item_id para ir al editor de escandallo) | 'combo'
 * (declara para el frente de combos). La lógica vive en la RPC classify_unmapped_product.
 * Para 'resale' se puede pasar unitCost (coste de compra por unidad base) opcional.
 */
export async function classifyUnmappedProduct(
  accountId: string,
  productName: string,
  action: ClassifyAction,
  unitCost?: number | null,
): Promise<ClassifyResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('classify_unmapped_product', {
    p_account_id: accountId,
    p_product_name: productName,
    p_action: action,
    p_unit_cost: unitCost ?? undefined,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as RowClassify | undefined
  if (!row) throw new Error('La clasificación no devolvió resultado.')
  return {
    resultado: row.resultado as ClassifyResult['resultado'],
    recipeItemId: row.recipe_item_id ?? null,
    marcasCreadas: Number(row.marcas_creadas ?? 0),
    lineasCasadas: Number(row.lineas_casadas ?? 0),
  }
}

/**
 * Sugerencia de IA: a qué escandallo (recipe_item) se parece un producto ciego,
 * por nombre, con confianza + semáforo. Envuelve la RPC run_mapping (la misma que
 * usa Supply para casar líneas de albarán). Solo sugiere; no escribe nada.
 */
export async function suggestMatch(
  accountId: string,
  productName: string,
  limit = 3,
): Promise<MatchSuggestion[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('run_mapping', {
    p_account_id: accountId,
    p_text: productName,
    p_code: undefined,
    p_limit: limit,
    p_fuzzy_min: 0.30,
  })
  if (error) throw new Error(`Error sugiriendo casado: ${error.message}`)
  return ((data ?? []) as RowRunMapping[]).map((r) => ({
    recipeItemId: r.recipe_item_id,
    name: r.name,
    folvyCode: r.folvy_code ?? null,
    confidence: Number(r.confidence ?? 0),
    matchType: r.match_type,
    semaphore: (r.semaphore as 'green' | 'yellow') ?? 'yellow',
  }))
}
