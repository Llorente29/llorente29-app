// src/modules/supply/services/supplierCatalogService.ts
//
// Catálogo de compra de un proveedor: dado un supplier_id, devuelve los
// artículos que ese proveedor vende (article_supplier) con su código de
// proveedor, su formato de compra (nombre + equivalencia a base) y su último
// precio. Es la BASE sobre la que se construye el pedido (rediseño 03/06): el
// comprador NO teclea líneas a mano, elige cantidades sobre este catálogo.
//
// Joins PostgREST (FK confirmadas 03/06):
//   article_supplier → recipe_item (nombre del artículo)
//   article_supplier → recipe_item_purchase_format (formato: name + qty_in_base)
//
// "Habituales vs todos": el catálogo completo = todos los article_supplier del
// proveedor. La vista "habituales" se derivará luego de lo más pedido/vendido
// (gancho); de momento la función admite un flag para futuro filtro.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { formatBaseQty } from '../lib/stockDisplay'

export interface SupplierCatalogEntry {
  articleSupplierId: string      // id de article_supplier (la relación proveedor↔artículo)
  recipeItemId: string           // el ingrediente
  itemName: string               // nombre del artículo
  supplierCode: string | null    // código del proveedor (213634…)
  supplierItemName: string | null // descripción del proveedor ("QUESO GOUDA LONCH.BOCAT.FS 1K")
  lastPrice: number | null       // último precio conocido en €/UNIDAD BASE (€/g, €/ml, €/ud); el €/caja se deriva con × formatQtyInBase
  isPreferred: boolean           // proveedor preferente para este artículo
  purchaseFormatId: string | null
  formatName: string | null      // "Caja", "Garrafa", "Paquete"
  formatQtyInBase: number | null // equivalencia en unidad base CRUDA (5000…)
  baseUnitAbbr: string | null    // unidad base del artículo (g, ml, ud)
  formatLabel: string | null     // formato legible: "Saco (5 kg)"
  // TODOS los formatos del artículo (no solo el preferente). Permite a la recepción
  // elegir el formato que coincide con la unidad del albarán (bote vs caja). El
  // preferente sigue expuesto arriba (purchaseFormatId/formatName/formatQtyInBase).
  formats: SupplierFormatOption[]
  // Otros códigos de ESTE proveedor para el MISMO artículo, cuando hay más de
  // una ficha. La fila se agrupa por artículo (una fila = un artículo), pero un
  // código que existe no se esconde: se enseña al lado del principal.
  otherSupplierCodes: string[]
  // Stock de referencia: vacío hoy (no hay inventario); gancho para cuando exista.
  stockOnHand: number | null
  // ── Sugerencia de repedido (motor suggest_purchase_qty) ──
  // suggestedQty en FORMATO de compra (cajas), techo, objetivo 7 días. null = sin señal ("—").
  suggestedQty: number | null
  suggestionSource: SuggestionSource | null      // de dónde sale (para la etiqueta)
  suggestionConfidence: SuggestionConfidence | null
}

export type SuggestionSource = 'par' | 'consumo' | 'historico' | 'none'
export type SuggestionConfidence = 'alta' | 'media'

export interface SupplierFormatOption {
  id: string
  name: string | null
  qtyInBase: number | null
  parentFormatId: string | null   // si !=null, es un formato anidado (hijo de una caja)
  label: string | null            // legible: "Caja (2,4 kg)" / "Bote (200 g)"
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

/**
 * Formato legible para el comprador: "Saco (5 kg)" en vez de "Saco (5000)".
 * Convierte la cantidad en unidad base cruda a una unidad "pedible":
 *   g  → kg cuando son ≥ 1000 g (5000 g → 5 kg)
 *   ml → L  cuando son ≥ 1000 ml (10000 ml → 10 L)
 * Si no hay equivalencia o unidad, devuelve solo el nombre del formato.
 *
 * Naming (07/06): si el "nombre" del formato es en realidad una UNIDAD (granel:
 * "Kilogramo", "Litro", "Unidad"…), NO se antepone — quedaría "Kilogramo (1,5 kg)",
 * que es un sinsentido. En ese caso se muestra solo la medida ("1,5 kg"). Cuando
 * hay envase real ("Caja", "Saco", "Bolsa"), sí: "Caja (6 kg)".
 */
function isUnitWord(name: string): boolean {
  const n = name.trim().toLowerCase()
  return [
    'kilogramo', 'kilogramos', 'kilo', 'kilos', 'kg',
    'gramo', 'gramos', 'g', 'gr',
    'litro', 'litros', 'l', 'lt',
    'mililitro', 'mililitros', 'ml', 'cc',
    'unidad', 'unidades', 'ud', 'uds', 'u', 'pieza', 'piezas',
  ].includes(n)
}

export function buildFormatLabel(
  name: string | null,
  qtyInBase: number | null,
  baseAbbr: string | null,
): string | null {
  if (!name) return null
  if (qtyInBase === null || baseAbbr === null) return isUnitWord(name) ? null : name

  let qty = qtyInBase
  let unit = baseAbbr

  // Escalado a unidad mayor cuando el número es grande (más "pedible").
  if (baseAbbr === 'g' && qtyInBase >= 1000) {
    qty = qtyInBase / 1000
    unit = 'kg'
  } else if (baseAbbr === 'ml' && qtyInBase >= 1000) {
    qty = qtyInBase / 1000
    unit = 'L'
  }

  // Formateo limpio (sin decimales sobrantes): 5 → "5", 2.5 → "2,5".
  const qtyStr = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(qty)
  const measure = `${qtyStr} ${unit}`

  // Granel (el nombre es una unidad) → solo la medida. Con envase → "Envase (medida)".
  return isUnitWord(name) ? measure : `${name} (${measure})`
}

/**
 * Stock legible para la pantalla de pedido, en UNIDAD BASE (kg/L/ud) — igual
 * que Existencias y la ficha del artículo (fuente única: formatBaseQty). NO se
 * convierte a nº de formatos: con más de un tamaño de compra (mozzarella en
 * bolsas de 1/1,5/2 kg) esa cuenta es ambigua y el "sugerido"/"cantidad a
 * pedir" ya usan el formato de compra por su lado. Null → "—".
 */
export function formatStockForOrder(
  stockOnHand: number | null,
  baseAbbr: string | null,
): string {
  if (stockOnHand === null || stockOnHand === undefined) return '—'
  return formatBaseQty(stockOnHand, baseAbbr)
}

// Prioridad para elegir qué ficha representa al artículo. Nunca al azar: la
// preferente manda, luego la que trae código (es lo que el operario compara con
// el albarán), luego la que trae formato, luego la que trae precio.
export function fichaScore(e: SupplierCatalogEntry): number {
  return (e.isPreferred ? 8 : 0)
    + (e.supplierCode ? 4 : 0)
    + (e.purchaseFormatId ? 2 : 0)
    + (e.lastPrice != null ? 1 : 0)
}

export function mergeEntriesByItem(list: SupplierCatalogEntry[]): SupplierCatalogEntry[] {
  const byItem = new Map<string, SupplierCatalogEntry[]>()
  for (const e of list) {
    const arr = byItem.get(e.recipeItemId) ?? []
    arr.push(e)
    byItem.set(e.recipeItemId, arr)
  }

  const out: SupplierCatalogEntry[] = []
  for (const grupo of byItem.values()) {
    if (grupo.length === 1) { out.push(grupo[0]); continue }

    const ordenadas = [...grupo].sort((a, b) => fichaScore(b) - fichaScore(a))
    const jefe = ordenadas[0]

    // El bloque de formato se toma ENTERO de la misma ficha: mezclar el nombre
    // de una con la equivalencia de otra daría un formato que no existe.
    const conFormato = ordenadas.find((e) => e.purchaseFormatId)
    const conCodigo = ordenadas.find((e) => e.supplierCode)
    const conPrecio = ordenadas.find((e) => e.lastPrice != null)
    const conNombre = ordenadas.find((e) => e.supplierItemName)

    const codigoElegido = jefe.supplierCode ?? conCodigo?.supplierCode ?? null
    const otros = Array.from(new Set(
      ordenadas
        .map((e) => e.supplierCode)
        .filter((c): c is string => !!c && c !== codigoElegido),
    ))

    out.push({
      ...jefe,
      supplierCode: codigoElegido,
      supplierItemName: jefe.supplierItemName ?? conNombre?.supplierItemName ?? null,
      lastPrice: jefe.lastPrice ?? conPrecio?.lastPrice ?? null,
      isPreferred: grupo.some((e) => e.isPreferred),
      purchaseFormatId: jefe.purchaseFormatId ?? conFormato?.purchaseFormatId ?? null,
      formatName: jefe.purchaseFormatId ? jefe.formatName : (conFormato?.formatName ?? null),
      formatQtyInBase: jefe.purchaseFormatId ? jefe.formatQtyInBase : (conFormato?.formatQtyInBase ?? null),
      formatLabel: jefe.purchaseFormatId ? jefe.formatLabel : (conFormato?.formatLabel ?? null),
      otherSupplierCodes: otros,
    })
  }

  // Mismo orden que antes: por nombre de artículo.
  out.sort((a, b) => a.itemName.localeCompare(b.itemName, 'es'))
  return out
}

/**
 * Catálogo de un proveedor: todos sus article_supplier activos, con artículo,
 * código, formato (nombre+equivalencia) y precio. Ordenado por nombre de artículo.
 */
export async function getSupplierCatalog(
  accountId: string,
  supplierId: string,
  locationId?: string | null,
): Promise<SupplierCatalogEntry[]> {
  requireSupabase()
  const { data, error } = await from('article_supplier')
    .select(`
      id,
      recipe_item_id,
      supplier_code,
      supplier_item_name,
      last_price,
      is_preferred,
      purchase_format_id,
      recipe_item:recipe_item_id ( name, kitchen_unit:base_unit_id ( abbreviation ) ),
      recipe_item_purchase_format:purchase_format_id ( name, qty_in_base )
    `)
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .eq('is_active', true)

  if (error) throw new Error(`Error cargando el catálogo del proveedor: ${error.message}`)

  const rows = (data as Row[]) ?? []

  // Segunda consulta: TODOS los formatos de los artículos implicados (no solo el
  // preferente). Permite a la recepción elegir bote vs caja según el albarán.
  const itemIds = Array.from(new Set(rows.map((r) => r.recipe_item_id as string)))
  const formatsByItem = new Map<string, SupplierFormatOption[]>()
  if (itemIds.length) {
    const { data: fmts, error: ef } = await from('recipe_item_purchase_format')
      .select('id, item_id, name, qty_in_base, parent_format_id')
      .eq('account_id', accountId)
      .in('item_id', itemIds)
      .is('archived_at', null)
    if (ef) throw new Error(`Error cargando los formatos: ${ef.message}`)
    // necesitamos la unidad base de cada artículo para la etiqueta legible
    const baseByItem = new Map<string, string | null>()
    for (const r of rows) {
      const item = (r.recipe_item ?? null) as { kitchen_unit?: { abbreviation?: string } | null } | null
      baseByItem.set(r.recipe_item_id as string, item?.kitchen_unit?.abbreviation ?? null)
    }
    for (const f of (fmts as Row[] | null) ?? []) {
      const itemId = f.item_id as string
      const abbr = baseByItem.get(itemId) ?? null
      const opt: SupplierFormatOption = {
        id: f.id as string,
        name: (f.name as string | null) ?? null,
        qtyInBase: (f.qty_in_base as number | null) ?? null,
        parentFormatId: (f.parent_format_id as string | null) ?? null,
        label: buildFormatLabel((f.name as string | null) ?? null, (f.qty_in_base as number | null) ?? null, abbr),
      }
      const arr = formatsByItem.get(itemId) ?? []
      arr.push(opt)
      formatsByItem.set(itemId, arr)
    }
    // orden por tamaño ascendente (bote antes que caja) para que el selector sea predecible
    for (const arr of formatsByItem.values()) {
      arr.sort((a, b) => (a.qtyInBase ?? 0) - (b.qtyInBase ?? 0))
    }
  }

  const entries: SupplierCatalogEntry[] = rows.map((r) => {
    const item = (r.recipe_item ?? null) as
      { name?: string; kitchen_unit?: { abbreviation?: string } | null } | null
    const baseAbbr = item?.kitchen_unit?.abbreviation ?? null
    const fmt = (r.recipe_item_purchase_format ?? null) as
      { name?: string; qty_in_base?: number } | null
    return {
      articleSupplierId: r.id as string,
      recipeItemId: r.recipe_item_id as string,
      itemName: item?.name ?? '(sin nombre)',
      supplierCode: (r.supplier_code as string | null) ?? null,
      supplierItemName: (r.supplier_item_name as string | null) ?? null,
      lastPrice: (r.last_price as number | null) ?? null,
      isPreferred: Boolean(r.is_preferred),
      purchaseFormatId: (r.purchase_format_id as string | null) ?? null,
      formatName: fmt?.name ?? null,
      formatQtyInBase: fmt?.qty_in_base ?? null,
      baseUnitAbbr: baseAbbr,
      formatLabel: buildFormatLabel(fmt?.name ?? null, fmt?.qty_in_base ?? null, baseAbbr),
      formats: formatsByItem.get(r.recipe_item_id as string) ?? [],
      otherSupplierCodes: [],
      stockOnHand: null, // gancho inventario
      suggestedQty: null,
      suggestionSource: null,
      suggestionConfidence: null,
    }
  })

  // ── UNA FILA POR ARTÍCULO (ENCARGO 20/08) ───────────────────────────────
  // article_supplier puede tener VARIAS fichas del mismo artículo para el mismo
  // proveedor: la misma referencia dada de alta dos veces, una con código y otra
  // sin él, una con formato y otra sin asignar. La pantalla pintaba UNA FILA POR
  // FICHA, así que el mismo artículo salía dos veces, con el mismo stock y el
  // mismo "en camino", y el operario tenía que elegir entre filas que se llaman
  // igual. Medido en Foodint: Cloudtown daba 98 filas para 89 artículos.
  //
  // Y el caso feo: "Aceite de Oliva Suave 0,4º" tenía una ficha con código y
  // Garrafa, y otra sin código y SIN FORMATO — esa segunda caía a la unidad base
  // y la pantalla escribía "ml", que no es un formato de compra de nada.
  //
  // Regla del encargo, y vale para toda la aplicación: una lista operativa se
  // agrupa por la cosa que el usuario nombra. El cocinero pide "aceite", no
  // "aceite-en-bidón-formato-3".
  //
  // NO se descarta información. Se elige una ficha representante y sus huecos se
  // rellenan con lo que tengan las hermanas; los códigos que quedan fuera van a
  // otherSupplierCodes para que la pantalla los diga en vez de esconderlos.
  const mergedByItem = mergeEntriesByItem(entries)
  entries.length = 0
  entries.push(...mergedByItem)

  // Stock real del local activo (T1 inventario, vivo desde 14/06): si nos pasan
  // un locationId, leemos recipe_item_location_stock para los artículos del
  // catálogo y rellenamos stockOnHand (qty_on_hand en unidad base). Sin local,
  // se queda en null (la UI muestra "—").
  if (locationId && itemIds.length) {
    const { data: stockRows, error: es } = await from('recipe_item_location_stock')
      .select('recipe_item_id, qty_on_hand')
      .eq('account_id', accountId)
      .eq('location_id', locationId)
      .in('recipe_item_id', itemIds)
    if (es) throw new Error(`Error cargando el stock: ${es.message}`)
    const stockByItem = new Map<string, number>()
    for (const s of (stockRows as Row[] | null) ?? []) {
      stockByItem.set(s.recipe_item_id as string, (s.qty_on_hand as number | null) ?? 0)
    }
    for (const e of entries) {
      const v = stockByItem.get(e.recipeItemId)
      e.stockOnHand = v === undefined ? null : v
    }
  }

  // Sugerencia de repedido: una sola llamada a la RPC suggest_purchase_qty
  // (motor To-Par MRP II). Devuelve por artículo cuánto pedir en formato de
  // compra + de dónde sale (par/consumo/histórico) + confianza. Se fusiona por
  // recipe_item_id. Requiere local (el motor mide stock/consumo por local). Si
  // falla (RPC no disponible en un entorno), degrada a null sin tumbar el catálogo.
  if (locationId && itemIds.length) {
    try {
      const { data: sugg, error: eg } = await (supabase! as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Row[] | null; error: { message: string } | null }>
      }).rpc('suggest_purchase_qty', {
        p_account: accountId,
        p_supplier: supplierId,
        p_location: locationId,
      })
      if (!eg && sugg) {
        const byItem = new Map<string, Row>()
        for (const s of sugg) byItem.set(s.recipe_item_id as string, s)
        for (const e of entries) {
          const s = byItem.get(e.recipeItemId)
          if (!s) continue
          e.suggestedQty = s.suggested_qty == null ? null : Number(s.suggested_qty)
          const src = (s.source as string | null) ?? null
          e.suggestionSource = (src as SuggestionSource | null)
          const conf = (s.confidence as string | null) ?? null
          e.suggestionConfidence = (conf as SuggestionConfidence | null)
        }
      }
    } catch {
      // sugerencia opcional: si la RPC no está, seguimos sin ella
    }
  }

  // Orden por nombre de artículo (es-ES).
  entries.sort((a, b) => a.itemName.localeCompare(b.itemName, 'es'))
  return entries
}

// ─── Locales de la cuenta (destino de entrega del pedido) ───
// Arquitectura multi-local (decisión rectora 03/06): el pedido pertenece a un
// local; la dirección de entrega del proveedor sale de aquí (locations.address).

export interface SupplyLocation {
  id: string
  name: string
  address: string | null
  phone: string | null
  receiptApproval: 'trabajador' | 'oficina'   // quién confirma la recepción en este local
}

/** Locales activos de la cuenta, ordenados por nombre. */
export async function listSupplyLocations(accountId: string): Promise<SupplyLocation[]> {
  requireSupabase()
  const { data, error } = await from('locations')
    .select('id, name, address, phone, receipt_approval')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name')

  if (error) throw new Error(`Error cargando los locales: ${error.message}`)
  const rows = (data as Row[]) ?? []
  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? '(sin nombre)',
    address: (r.address as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    receiptApproval: ((r.receipt_approval as string | null) ?? 'trabajador') as 'trabajador' | 'oficina',
  }))
}

// ─── Aprobación de recepciones por local (toggle del editor de local) ───
// Autocontenido: lee/escribe locations.receipt_approval directamente, sin pasar
// por el tipo Location del contexto (que no gestiona este campo).

/** Mapa id_local → modo de aprobación, para una lista de locales dada. */
export async function listLocationApprovals(
  locationIds: string[],
): Promise<Record<string, 'trabajador' | 'oficina'>> {
  requireSupabase()
  if (locationIds.length === 0) return {}
  const { data, error } = await from('locations')
    .select('id, receipt_approval')
    .in('id', locationIds)
  if (error) throw new Error(`Error cargando la aprobación de recepciones: ${error.message}`)
  const out: Record<string, 'trabajador' | 'oficina'> = {}
  for (const r of (data as Row[]) ?? []) {
    out[r.id as string] = ((r.receipt_approval as string | null) ?? 'trabajador') as 'trabajador' | 'oficina'
  }
  return out
}

/** Fija quién confirma las recepciones de un local. */
export async function setLocationReceiptApproval(
  locationId: string,
  value: 'trabajador' | 'oficina',
): Promise<void> {
  requireSupabase()
  const { error } = await from('locations')
    .update({ receipt_approval: value })
    .eq('id', locationId)
  if (error) throw new Error(`No se pudo guardar la aprobación de recepciones: ${error.message}`)
}
