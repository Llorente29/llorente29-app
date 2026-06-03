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
  lastPrice: number | null       // último precio conocido (€ por formato)
  isPreferred: boolean           // proveedor preferente para este artículo
  purchaseFormatId: string | null
  formatName: string | null      // "Caja", "Garrafa", "Paquete"
  formatQtyInBase: number | null // equivalencia a unidad base (25, 5, 0.125…)
  // Stock de referencia: vacío hoy (no hay inventario); gancho para cuando exista.
  stockOnHand: number | null
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
      last_price,
      is_preferred,
      purchase_format_id,
      recipe_item:recipe_item_id ( name ),
      recipe_item_purchase_format:purchase_format_id ( name, qty_in_base )
    `)
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .eq('is_active', true)

  if (error) throw new Error(`Error cargando el catálogo del proveedor: ${error.message}`)

  const rows = (data as Row[]) ?? []
  const entries: SupplierCatalogEntry[] = rows.map((r) => {
    const item = (r.recipe_item ?? null) as { name?: string } | null
    const fmt = (r.recipe_item_purchase_format ?? null) as
      { name?: string; qty_in_base?: number } | null
    return {
      articleSupplierId: r.id as string,
      recipeItemId: r.recipe_item_id as string,
      itemName: item?.name ?? '(sin nombre)',
      supplierCode: (r.supplier_code as string | null) ?? null,
      lastPrice: (r.last_price as number | null) ?? null,
      isPreferred: Boolean(r.is_preferred),
      purchaseFormatId: (r.purchase_format_id as string | null) ?? null,
      formatName: fmt?.name ?? null,
      formatQtyInBase: fmt?.qty_in_base ?? null,
      stockOnHand: null, // gancho inventario
    }
  })

  // Orden por nombre de artículo (es-ES).
  entries.sort((a, b) => a.itemName.localeCompare(b.itemName, 'es'))
  return entries
}
