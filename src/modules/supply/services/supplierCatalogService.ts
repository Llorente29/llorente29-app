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

export interface SupplierCatalogEntry {
  articleSupplierId: string      // id de article_supplier (la relación proveedor↔artículo)
  recipeItemId: string           // el ingrediente
  itemName: string               // nombre del artículo
  supplierCode: string | null    // código del proveedor (213634…)
  supplierItemName: string | null // descripción del proveedor ("QUESO GOUDA LONCH.BOCAT.FS 1K")
  lastPrice: number | null       // último precio conocido (€ por formato)
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
  // Stock de referencia: vacío hoy (no hay inventario); gancho para cuando exista.
  stockOnHand: number | null
}

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

function buildFormatLabel(
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
 * Catálogo de un proveedor: todos sus article_supplier activos, con artículo,
 * código, formato (nombre+equivalencia) y precio. Ordenado por nombre de artículo.
 */
export async function getSupplierCatalog(
  accountId: string,
  supplierId: string,
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
      stockOnHand: null, // gancho inventario
    }
  })

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
}

/** Locales activos de la cuenta, ordenados por nombre. */
export async function listSupplyLocations(accountId: string): Promise<SupplyLocation[]> {
  requireSupabase()
  const { data, error } = await from('locations')
    .select('id, name, address, phone')
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
  }))
}
