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
  /** Ventas cuyo consumo se ha vuelto a calcular (posteriores al último conteo). */
  ventasReprocesadas: number
  /** Ventas que NO se han tocado porque un conteo aprobado ya dijo la verdad. */
  ventasProtegidas: number
  /** Importe de esas ventas protegidas. */
  eurosProtegidos: number
}

interface RowResolve {
  resultado: string
  menu_item_id: string | null
  recipe_item_id: string | null
  brand_id: string | null
  ventas_reprocesadas: number | null
  ventas_protegidas: number | null
  euros_protegidos: number | null
}

/**
 * Resuelve un producto ciego. 'link' (solo no_menu_item: crea el plato en carta
 * y recalcula el consumo) | 'ignore' | 'delist'. La RPC lanza EXCEPTION si el
 * producto es combo o no tiene receta (link): se propaga como Error.
 *
 * Llama a resolve_unmapped_sales_scoped, no a resolve_unmapped_sales. La
 * diferencia es EL CORTE, y no es cosmética: la versión sin corte termina en
 * recast_lastapp_sales(cuenta), que reprocesa TODAS las ventas lastapp de la
 * cuenta. Medido el 25/08 en Foodint: 7.042 de 7.197 ventas (195.185,32 €)
 * caen por debajo del último conteo aprobado de su local. Reprocesarlas
 * regenera consumo que un conteo físico ya corrigió — el doble descuento de
 * A3, a escala 11x. La versión con corte solo toca las ventas posteriores al
 * conteo y devuelve cuántas ha protegido.
 */
export async function resolveUnmapped(
  accountId: string,
  productName: string,
  action: ResolveAction,
): Promise<ResolveResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('resolve_unmapped_sales_scoped', {
    p_account_id: accountId,
    p_product_name: productName,
    p_action: action,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as RowResolve | undefined
  if (!row) throw new Error('La acción no devolvió resultado.')
  const reprocesadas = Number(row.ventas_reprocesadas ?? 0)
  return {
    resultado: row.resultado as ResolveResult['resultado'],
    menuItemId: row.menu_item_id ?? null,
    recipeItemId: row.recipe_item_id ?? null,
    brandId: row.brand_id ?? null,
    // La RPC con corte cuenta ventas, no líneas. Es el número que le importa a
    // quien pulsa: cuántos tickets se han vuelto a calcular.
    lineasAfectadas: reprocesadas,
    ventasReprocesadas: reprocesadas,
    ventasProtegidas: Number(row.ventas_protegidas ?? 0),
    eurosProtegidos: Number(row.euros_protegidos ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Clasificación de un producto ciego (Capa 1, frente "modelo de producto")
// ─────────────────────────────────────────────────────────────────────

export type ClassifyAction = 'resale' | 'dish' | 'combo'

/** Candidato de artículo para el desplegable cuando la RPC no resuelve el ancla. */
export interface ClassifyCandidate {
  recipeItemId: string
  name: string
  type: string
}

export interface ClassifyResult {
  resultado: 'resale_linked' | 'is_dish' | 'is_combo' | 'needs_target'
  recipeItemId: string | null
  marcasCreadas: number
  lineasCasadas: number
  /** Solo en 'needs_target': artículos candidatos para que el usuario elija a cuál casar. */
  candidatos: ClassifyCandidate[]
}

interface RowClassify {
  resultado: string
  recipe_item_id: string | null
  marcas_creadas: number
  lineas_casadas: number
  candidatos: { recipe_item_id: string; name: string; type: string }[] | null
}

/**
 * Clasifica un producto. 'resale' (artículo de reventa: convierte a raw vendible y
 * propaga a TODAS las marcas de sus matrículas) | 'dish' | 'combo'. La lógica vive en
 * la RPC classify_unmapped_product.
 *
 * Dos puertas:
 *  - PUERTA 1 (ficha): se pasa recipeItemId → ancla directa al artículo, sin adivinar.
 *  - PUERTA 2 (Excepciones): solo productName → la RPC resuelve por nombre; si no puede,
 *    devuelve resultado='needs_target' + candidatos para que el usuario elija a cuál casar
 *    (entonces se vuelve a llamar pasando el recipeItemId elegido).
 * Para 'resale' se puede pasar unitCost opcional.
 */
export async function classifyUnmappedProduct(
  accountId: string,
  productName: string,
  action: ClassifyAction,
  unitCost?: number | null,
  recipeItemId?: string | null,
): Promise<ClassifyResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('classify_unmapped_product', {
    p_account_id: accountId,
    p_product_name: productName,
    p_action: action,
    p_unit_cost: unitCost ?? undefined,
    p_recipe_item_id: recipeItemId ?? undefined,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as RowClassify | undefined
  if (!row) throw new Error('La clasificación no devolvió resultado.')
  return {
    resultado: row.resultado as ClassifyResult['resultado'],
    recipeItemId: row.recipe_item_id ?? null,
    marcasCreadas: Number(row.marcas_creadas ?? 0),
    lineasCasadas: Number(row.lineas_casadas ?? 0),
    candidatos: Array.isArray(row.candidatos)
      ? row.candidatos.map((c) => ({ recipeItemId: c.recipe_item_id, name: c.name, type: c.type }))
      : [],
  }
}

/**
 * Sugerencia de IA: a qué escandallo (recipe_item) se parece un producto ciego,
 * por nombre, con confianza + semáforo. Envuelve la RPC run_mapping (la misma que
 * usa Supply para casar líneas de albarán). Solo sugiere; no escribe nada.
 */
/** Candidato fuerte por nombre parecido que create_dish_from_unmapped encontró
 *  en vez de duplicar (similarity() trigram >= 0.6 contra un plato vivo). */
export interface DuplicateCandidate {
  recipeItemId: string
  nombre: string
  similitud: number
}

/**
 * Crea un plato NUEVO del TPV que no existe en Folvy (no_recipe/no_menu_item):
 * recipe_item(dish) + menu_item SELLADO (external_source='lastapp'+external_id=
 * matrícula), recasa, y devuelve el recipe_item_id para llevar al editor de
 * escandallo. Modelo canónico (sin product_map). La lógica vive en la RPC
 * create_dish_from_unmapped (anti-invención: EXCEPTION si la marca no resuelve,
 * no hay matrícula, o el producto es un combo).
 *
 * Anti-duplicado (28/07): antes de crear, la RPC busca un plato ya existente
 * con nombre MUY parecido. Si lo encuentra y confirmCreate=false, NO crea
 * nada: devuelve `creado=false` + `candidato` para que la pantalla pregunte
 * "¿es el mismo?" en vez de duplicar en silencio. confirmCreate=true salta
 * ese check ("no, crear uno nuevo igualmente").
 */
export async function createDishFromUnmapped(
  accountId: string,
  productName: string,
  confirmCreate = false,
): Promise<{
  recipeItemId: string | null
  marcasCreadas: number
  lineasCasadas: number
  creado: boolean
  candidato: DuplicateCandidate | null
  ventasReprocesadas: number
  ventasProtegidas: number
  eurosProtegidos: number
}> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('create_dish_from_unmapped_scoped', {
    p_account_id: accountId,
    p_product_name: productName,
    p_confirm_create: confirmCreate,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as {
    out_recipe_item_id: string | null; out_marcas_creadas: number; out_lineas_casadas: number
    out_creado: boolean; out_candidato_id: string | null; out_candidato_nombre: string | null
    out_similitud: number | null
    out_ventas_reprocesadas: number | null; out_ventas_protegidas: number | null
    out_euros_protegidos: number | null
  } | undefined
  if (!row) throw new Error('No se pudo crear el plato.')
  return {
    recipeItemId: row.out_recipe_item_id ?? null,
    marcasCreadas: Number(row.out_marcas_creadas ?? 0),
    lineasCasadas: Number(row.out_lineas_casadas ?? 0),
    creado: row.out_creado === true,
    candidato: row.out_candidato_id
      ? { recipeItemId: row.out_candidato_id, nombre: row.out_candidato_nombre ?? '', similitud: Number(row.out_similitud ?? 0) }
      : null,
    ventasReprocesadas: Number(row.out_ventas_reprocesadas ?? 0),
    ventasProtegidas: Number(row.out_ventas_protegidas ?? 0),
    eurosProtegidos: Number(row.out_euros_protegidos ?? 0),
  }
}

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
    // Sin esto la llamada es ambigua entre las dos versiones de run_mapping
    // que hay en BBDD (drift, ninguna versionada) y PostgreSQL responde
    // "function is not unique" — el catch de quien llama a suggestMatch se
    // lo traga y la pantalla dice "no se parece a nada" siempre. Ver
    // 20260729T1000_run_mapping_unico_y_anti_duplicado.sql.
    p_target_types: ['dish'],
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

// ── «Productos vendidos SIN coste» — RETIRADO el 02/09 ─────────────────────
//
// Aquí vivían `CostlessProduct` y `listCostlessSoldProducts`, que envolvían la
// RPC `list_costless_sold_products`. Se fueron con la RPC, y la RPC se fue
// porque devolvía CERO habiendo 118 productos y 11.522 € vendidos sin costear:
// exigía que el `recipe_item` enlazado no tuviera coste, y el agujero real está
// un paso antes, en productos de carta SIN escandallo enlazado — que su JOIN
// contra `recipe_item` excluye por construcción.
//
// La pregunta la contesta ahora `home_vendido_sin_coste` (tarjeta «Platos sin
// escandallo» del Inicio), con el criterio correcto: `sale_line.computed_cost`,
// que es lo que el motor deja escrito en la línea. Ver el frente 15 y la
// migración 20260902T2320_retirar_list_costless_sold_products.sql, que guarda
// la definición original por si alguien la necesita.
