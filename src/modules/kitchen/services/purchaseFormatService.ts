// src/modules/kitchen/services/purchaseFormatService.ts
//
// Service del árbol de formatos de compra (recipe_item_purchase_format) +
// el enlace proveedor↔formato con precio (article_supplier).
// Scope cuenta. Sigue el patrón canónico de kitchenUnitService.ts:
// rowToX / xInsertToRow / xUpdateToRow, requireSupabase, mapeo snake↔camel.
//
// Goleada de diseño sobre Apicbase/tspoon:
//  · Árbol anidado (Caja→Bolsa→base) vs conversión plana.
//  · Conversión NUNCA silenciosa: si la dimensión del precio no cuadra con
//    la base del ingrediente, se exige aclararlo (needs_review), no se
//    inventa 1:1 (el fallo documentado de Apicbase).
//  · Nodo trivial autocreado (opción A): el caso simple "saco 25 kg" no
//    obliga al cocinero a montar un árbol.
//  · Trazabilidad IA de serie (source/ai_confidence/needs_review) para foto→IA.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  Supplier,
  SupplierInsert,
  SupplierUpdate,
  RowSupplier,
  RowSupplierInsert,
  RowSupplierUpdate,
  PurchaseFormat,
  PurchaseFormatInsert,
  PurchaseFormatUpdate,
  PurchaseFormatSource,
  RowPurchaseFormat,
  RowPurchaseFormatInsert,
  RowPurchaseFormatUpdate,
  ArticleSupplier,
  ArticleSupplierInsert,
  ArticleSupplierUpdate,
  RowArticleSupplier,
  RowArticleSupplierInsert,
  RowArticleSupplierUpdate,
  CostStrategy,
} from '../../../types/kitchen'
import { cascadeFromItem, type RecomputedAncestor } from './costCascadeService'
import { updateRecipeItem } from './recipeItemService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ═══════════════════════════════════════════════════════════════════════
// supplier
// ═══════════════════════════════════════════════════════════════════════
export function rowToSupplier(row: RowSupplier): Supplier {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    address: row.address,
    healthRegistryNo: row.health_registry_no,
    notes: row.notes,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function supplierInsertToRow(input: SupplierInsert): RowSupplierInsert {
  return {
    account_id: input.accountId,
    name: input.name,
    tax_id: input.taxId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    health_registry_no: input.healthRegistryNo ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function supplierUpdateToRow(patch: SupplierUpdate): RowSupplierUpdate {
  const row: RowSupplierUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.taxId !== undefined) row.tax_id = patch.taxId
  if (patch.email !== undefined) row.email = patch.email
  if (patch.phone !== undefined) row.phone = patch.phone
  if (patch.address !== undefined) row.address = patch.address
  if (patch.healthRegistryNo !== undefined) row.health_registry_no = patch.healthRegistryNo
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

export async function listSuppliers(accountId: string): Promise<Supplier[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('supplier')
    .select('*')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando proveedores: ${error.message}`)
  return (data ?? []).map(rowToSupplier)
}

export async function createSupplier(input: SupplierInsert): Promise<Supplier> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('supplier').insert(supplierInsertToRow(input)).select('*').single()
  if (error) throw new Error(`Error creando proveedor: ${error.message}`)
  return rowToSupplier(data)
}

export async function updateSupplier(id: string, patch: SupplierUpdate): Promise<Supplier> {
  requireSupabase()
  const rowPatch = supplierUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const { data, error } = await supabase!
      .from('supplier').select('*').eq('id', id).single()
    if (error) throw new Error(`Error obteniendo proveedor ${id}: ${error.message}`)
    return rowToSupplier(data)
  }
  const { data, error } = await supabase!
    .from('supplier').update(rowPatch).eq('id', id).select('*').single()
  if (error) throw new Error(`Error actualizando proveedor ${id}: ${error.message}`)
  return rowToSupplier(data)
}

// ═══════════════════════════════════════════════════════════════════════
// recipe_item_purchase_format (árbol de empaquetado)
// ═══════════════════════════════════════════════════════════════════════
export function rowToPurchaseFormat(row: RowPurchaseFormat): PurchaseFormat {
  return {
    id: row.id,
    accountId: row.account_id,
    itemId: row.item_id,
    name: row.name,
    parentFormatId: row.parent_format_id,
    qtyPerParent: row.qty_per_parent,
    qtyInBase: row.qty_in_base,
    isPiece: row.is_piece,
    isWeighted: row.is_weighted,
    source: row.source as PurchaseFormatSource,
    aiConfidence: row.ai_confidence,
    needsReview: row.needs_review,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function purchaseFormatInsertToRow(input: PurchaseFormatInsert): RowPurchaseFormatInsert {
  return {
    account_id: input.accountId,
    item_id: input.itemId,
    name: input.name,
    qty_in_base: input.qtyInBase,
    parent_format_id: input.parentFormatId ?? null,
    qty_per_parent: input.qtyPerParent ?? null,
    is_piece: input.isPiece ?? false,
    is_weighted: input.isWeighted ?? false,
    source: input.source ?? 'manual',
    ai_confidence: input.aiConfidence ?? null,
    needs_review: input.needsReview ?? false,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function purchaseFormatUpdateToRow(patch: PurchaseFormatUpdate): RowPurchaseFormatUpdate {
  const row: RowPurchaseFormatUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.parentFormatId !== undefined) row.parent_format_id = patch.parentFormatId
  if (patch.qtyPerParent !== undefined) row.qty_per_parent = patch.qtyPerParent
  if (patch.qtyInBase !== undefined) row.qty_in_base = patch.qtyInBase
  if (patch.isPiece !== undefined) row.is_piece = patch.isPiece
  if (patch.isWeighted !== undefined) row.is_weighted = patch.isWeighted
  if (patch.needsReview !== undefined) row.needs_review = patch.needsReview
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

// Todos los formatos (nodos del árbol) de un ingrediente, ordenados raíz→hoja.
export async function listFormatsByItem(itemId: string): Promise<PurchaseFormat[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item_purchase_format')
    .select('*')
    .eq('item_id', itemId)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Error listando formatos del ingrediente ${itemId}: ${error.message}`)
  return (data ?? []).map(rowToPurchaseFormat)
}

export async function createPurchaseFormat(input: PurchaseFormatInsert): Promise<PurchaseFormat> {
  requireSupabase()
  if (!(input.qtyInBase > 0)) {
    throw new Error('El formato debe tener qtyInBase > 0 (cuánto vale en la unidad base del ingrediente).')
  }
  const { data, error } = await supabase!
    .from('recipe_item_purchase_format')
    .insert(purchaseFormatInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error creando formato de compra: ${error.message}`)
  return rowToPurchaseFormat(data)
}

export async function updatePurchaseFormat(
  id: string,
  patch: PurchaseFormatUpdate
): Promise<PurchaseFormat> {
  requireSupabase()
  const rowPatch = purchaseFormatUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const { data, error } = await supabase!
      .from('recipe_item_purchase_format').select('*').eq('id', id).single()
    if (error) throw new Error(`Error obteniendo formato ${id}: ${error.message}`)
    return rowToPurchaseFormat(data)
  }
  const { data, error } = await supabase!
    .from('recipe_item_purchase_format').update(rowPatch).eq('id', id).select('*').single()
  if (error) throw new Error(`Error actualizando formato ${id}: ${error.message}`)
  return rowToPurchaseFormat(data)
}

// ═══════════════════════════════════════════════════════════════════════
// article_supplier (proveedor ↔ formato que vende, con precio)
// ═══════════════════════════════════════════════════════════════════════
export function rowToArticleSupplier(row: RowArticleSupplier): ArticleSupplier {
  return {
    id: row.id,
    accountId: row.account_id,
    recipeItemId: row.recipe_item_id,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    purchaseFormatId: row.purchase_format_id,
    lastPrice: row.last_price,
    isPreferred: row.is_preferred,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function articleSupplierInsertToRow(input: ArticleSupplierInsert): RowArticleSupplierInsert {
  return {
    account_id: input.accountId,
    recipe_item_id: input.recipeItemId,
    supplier_id: input.supplierId,
    purchase_format_id: input.purchaseFormatId,
    supplier_code: input.supplierCode ?? null,
    last_price: input.lastPrice ?? null,
    is_preferred: input.isPreferred ?? false,
  }
}

function articleSupplierUpdateToRow(patch: ArticleSupplierUpdate): RowArticleSupplierUpdate {
  const row: RowArticleSupplierUpdate = {}
  if (patch.supplierCode !== undefined) row.supplier_code = patch.supplierCode
  if (patch.purchaseFormatId !== undefined) row.purchase_format_id = patch.purchaseFormatId
  if (patch.lastPrice !== undefined) row.last_price = patch.lastPrice
  if (patch.isPreferred !== undefined) row.is_preferred = patch.isPreferred
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  return row
}

export async function listSuppliersByItem(
  itemId: string,
  opts?: { includeInactive?: boolean },
): Promise<ArticleSupplier[]> {
  requireSupabase()
  let q = supabase!
    .from('article_supplier')
    .select('*')
    .eq('recipe_item_id', itemId)
  // Por defecto solo los activos. Con includeInactive traemos también los
  // archivados (descatalogados) para poder verlos/reactivarlos en la ficha.
  if (!opts?.includeInactive) {
    q = q.eq('is_active', true)
  }
  const { data, error } = await q
    .order('is_active', { ascending: false })
    .order('is_preferred', { ascending: false })
  if (error) throw new Error(`Error listando proveedores del ingrediente ${itemId}: ${error.message}`)
  return (data ?? []).map(rowToArticleSupplier)
}

export async function linkSupplierFormat(input: ArticleSupplierInsert): Promise<ArticleSupplier> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('article_supplier')
    .insert(articleSupplierInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error enlazando proveedor-formato: ${error.message}`)
  return rowToArticleSupplier(data)
}

export async function updateArticleSupplier(
  id: string,
  patch: ArticleSupplierUpdate
): Promise<ArticleSupplier> {
  requireSupabase()
  const rowPatch = articleSupplierUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const { data, error } = await supabase!
      .from('article_supplier').select('*').eq('id', id).single()
    if (error) throw new Error(`Error obteniendo enlace ${id}: ${error.message}`)
    return rowToArticleSupplier(data)
  }
  const { data, error } = await supabase!
    .from('article_supplier').update(rowPatch).eq('id', id).select('*').single()
  if (error) throw new Error(`Error actualizando enlace ${id}: ${error.message}`)
  const updated = rowToArticleSupplier(data)
  // Solo si cambió algo que afecta al coste (precio o formato de compra),
  // propagamos a los platos/sub-recetas que usan el ingrediente. Fail-safe:
  // un fallo de cascada no revierte la actualización del enlace.
  if (patch.lastPrice !== undefined || patch.purchaseFormatId !== undefined) {
    try {
      await cascadeFromItem(updated.recipeItemId)
    } catch (e) {
      console.error(`updateArticleSupplier: cascada de coste falló para ${updated.recipeItemId}`, e)
    }
  }
  return updated
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('supplier').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Error obteniendo proveedor ${id}: ${error.message}`)
  return data ? rowToSupplier(data) : null
}

// Los vínculos activos (article_supplier) de un proveedor: los artículos que le
// compras. La página cruza con recipe_item/formatos/unidades vía mapas (el
// service no hace joins; mantiene el estilo plano).
export async function listLinksBySupplier(supplierId: string): Promise<ArticleSupplier[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('article_supplier')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('is_active', true)
    .order('is_preferred', { ascending: false })
  if (error) throw new Error(`Error listando artículos del proveedor ${supplierId}: ${error.message}`)
  return (data ?? []).map(rowToArticleSupplier)
}

// Marca un proveedor como PRINCIPAL de un ingrediente de forma EXCLUSIVA:
// desmarca al resto de proveedores activos del mismo ingrediente y marca el
// elegido. El trigger de article_supplier recalcula el coste del ingrediente
// (sale del preferido); luego propagamos a los platos. Resuelve la limitación
// de updateArticleSupplier, que no cascadea al cambiar is_preferred.
export async function setPreferredSupplier(
  linkId: string,
  recipeItemId: string,
): Promise<void> {
  requireSupabase()
  const { error: e1 } = await supabase!
    .from('article_supplier')
    .update({ is_preferred: false })
    .eq('recipe_item_id', recipeItemId)
    .eq('is_active', true)
    .neq('id', linkId)
  if (e1) throw new Error(`Error desmarcando proveedores previos: ${e1.message}`)
  const { error: e2 } = await supabase!
    .from('article_supplier')
    .update({ is_preferred: true })
    .eq('id', linkId)
  if (e2) throw new Error(`Error marcando proveedor principal: ${e2.message}`)
  try {
    await cascadeFromItem(recipeItemId)
  } catch (e) {
    console.error(`setPreferredSupplier: cascada de coste falló para ${recipeItemId}`, e)
  }
}

// "Dejar de comprar este artículo a este proveedor": desactiva el vínculo
// (is_active=false, no DELETE físico, convención del service). El trigger
// recalcula el coste del ingrediente desde los proveedores que queden; luego
// propagamos a los platos. Devuelve el recipe_item_id afectado.
export async function unlinkSupplierFormat(linkId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('article_supplier')
    .update({ is_active: false })
    .eq('id', linkId)
    .select('*')
    .single()
  if (error) throw new Error(`Error quitando el vínculo ${linkId}: ${error.message}`)
  const updated = rowToArticleSupplier(data)
  try {
    await cascadeFromItem(updated.recipeItemId)
  } catch (e) {
    console.error(`unlinkSupplierFormat: cascada de coste falló para ${updated.recipeItemId}`, e)
  }
  return updated.recipeItemId
}

// "Volver a comprar este artículo a este proveedor": reactiva un vínculo
// archivado (is_active=true). Simétrico a unlinkSupplierFormat. El coste del
// ingrediente puede cambiar (vuelve a entrar este proveedor en el cálculo del
// preferido/más reciente), así que recosteamos y propagamos a los platos.
// Devuelve el recipe_item_id afectado.
export async function reactivateSupplierLink(linkId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('article_supplier')
    .update({ is_active: true })
    .eq('id', linkId)
    .select('*')
    .single()
  if (error) throw new Error(`Error reactivando el vínculo ${linkId}: ${error.message}`)
  const updated = rowToArticleSupplier(data)
  try {
    await cascadeFromItem(updated.recipeItemId)
  } catch (e) {
    console.error(`reactivateSupplierLink: cascada de coste falló para ${updated.recipeItemId}`, e)
  }
  return updated.recipeItemId
}

// ═══════════════════════════════════════════════════════════════════════
// Alta de alto nivel: proveedor vende un formato simple (opción A).
// Autocrea el NODO TRIVIAL del árbol y lo enlaza al proveedor con su precio.
// Para el caso "saco de 25 kg": el cocinero no monta árbol, esto lo hace.
//
// IMPORTANTE (blindaje de conversión): qtyInBase debe venir ya expresado en
// la unidad base del ingrediente. Quien llama (la UI o el foto→IA) es
// responsable de convertir el formato a base ANTES, o de marcar needsReview
// si la dimensión no cuadra y hace falta densidad. Este service no inventa
// conversiones 1:1 — por eso recibe qtyInBase directo, no "25 L" a ciegas.
// ═══════════════════════════════════════════════════════════════════════
export interface SimplePurchaseSetup {
  accountId: string
  itemId: string
  formatName: string        // "Saco", "Caja", "Garrafa"...
  qtyInBase: number         // cuánto vale ese formato en la base del ingrediente
  supplierId: string
  lastPrice: number
  supplierCode?: string | null
  isPreferred?: boolean
  source?: PurchaseFormatSource
  aiConfidence?: number | null
  needsReview?: boolean
  createdBy?: string | null
  createdByName?: string | null
  // Estrategia de coste ACTUAL del ingrediente. Si es 'fixed', el service la
  // pasa a 'last_purchase' antes del alta (la compra debe poder pisar el coste).
  // Quien llama la pasa (la UI/foto→IA ya tiene el item cargado); el service no
  // hace un SELECT extra para averiguarla.
  priorCostStrategy?: CostStrategy
}

export interface SimplePurchaseResult {
  format: PurchaseFormat
  link: ArticleSupplier
  ancestorsRecomputed: number
  // Platos/sub-recetas efectivamente recalculados, con nombre. Misma longitud
  // que ancestorsRecomputed. Permite a la UI mostrar QUÉ platos se movieron.
  recalculatedDishes: RecomputedAncestor[]
}

export async function setupSimplePurchase(
  setup: SimplePurchaseSetup
): Promise<SimplePurchaseResult> {
  requireSupabase()

  // FLIP DE ESTRATEGIA (vive aquí para que lo hereden foto→IA/import):
  // si el ingrediente cobra su coste de un valor fijo tecleado, la compra NO lo
  // pisaría (precedencia 'fixed' en kitchen_recompute_raw_cost). Lo pasamos a
  // 'last_purchase' ANTES de insertar el link, para que el trigger del link
  // calcule el coste desde el precio. El fixed_cost queda como respaldo.
  // Idempotente: si ya estaba en una estrategia de compra, no se toca.
  if (setup.priorCostStrategy === 'fixed') {
    await updateRecipeItem(setup.itemId, { costStrategy: 'last_purchase' })
  }

  const format = await createPurchaseFormat({
    accountId: setup.accountId,
    itemId: setup.itemId,
    name: setup.formatName,
    qtyInBase: setup.qtyInBase,
    source: setup.source,
    aiConfidence: setup.aiConfidence,
    needsReview: setup.needsReview,
    createdBy: setup.createdBy,
    createdByName: setup.createdByName,
  })

  // COMPENSACIÓN: si falla el enlace tras crear el formato, archivamos el
  // formato recién creado para no dejar un nodo huérfano. (Archivar, no DELETE
  // físico: convención del service y evita disparar el trigger SECURITY DEFINER.
  // listFormatsByItem ya filtra archived_at IS NULL, así que desaparece de vista.)
  let link: ArticleSupplier
  try {
    link = await linkSupplierFormat({
      accountId: setup.accountId,
      recipeItemId: setup.itemId,
      supplierId: setup.supplierId,
      purchaseFormatId: format.id,
      lastPrice: setup.lastPrice,
      supplierCode: setup.supplierCode ?? null,
      isPreferred: setup.isPreferred ?? false,
    })
  } catch (e) {
    try {
      await updatePurchaseFormat(format.id, {
        isActive: false,
        archivedAt: new Date().toISOString(),
      })
    } catch (cleanupErr) {
      console.error(
        `setupSimplePurchase: el enlace falló y además no se pudo archivar el formato huérfano ${format.id}`,
        cleanupErr,
      )
    }
    throw e
  }

  // El trigger ya recalculó el coste del ingrediente al insertar el precio.
  // Propagamos a los platos/sub-recetas que lo usan y devolvemos cuántos se
  // recalcularon (recuento real, no inventado). Fail-safe: si la cascada falla,
  // el alta NO se revierte (el coste del ingrediente quedó bien); devolvemos 0.
  let ancestorsRecomputed = 0
  let recalculatedDishes: RecomputedAncestor[] = []
  try {
    const result = await cascadeFromItem(setup.itemId)
    ancestorsRecomputed = result.ancestorsRecomputed
    recalculatedDishes = result.ancestors
  } catch (e) {
    console.error(`setupSimplePurchase: cascada de coste falló para ${setup.itemId}`, e)
  }

  return { format, link, ancestorsRecomputed, recalculatedDishes }
}

// ═══════════════════════════════════════════════════════════════════════
// Árbol de formato leído del albarán: "Caja contiene N × (unidad interior)"
// ═══════════════════════════════════════════════════════════════════════
export interface PackTreeSetup {
  accountId: string
  itemId: string
  count: number              // nº de unidades interiores por caja (p.ej. 3)
  innerQtyInBase: number     // contenido de UNA unidad interior, en base (p.ej. 2000 g)
  innerName: string          // nombre de la unidad interior ("Ud", "Bolsa"…)
  cajaName: string           // nombre del contenedor de compra ("Caja"…)
  source?: PurchaseFormatSource
  createdBy?: string | null
  createdByName?: string | null
}

// Crea/REUTILIZA el árbol "Caja = N × (unidad interior)" tal como lo dice el
// albarán. La unidad interior es un NODO REAL (unidad de stock contable, para
// inventario). El total de la Caja se DERIVA aquí, en un ÚNICO sitio
// (count × inner.qtyInBase) y NUNCA se teclea por separado → imposible que el
// total y el desglose se descuadren. Sin trigger en cascada (misma filosofía
// que costCascadeService: la garantía vive en una sola función app-orquestada).
// Reutiliza la unidad interior si ya existe (mismo contenido en base) y la Caja
// si ya existe con ese interior y ese número → no prolifera nodos.
// Devuelve la CAJA (nodo de compra) y la unidad INTERIOR (nodo de stock).
export async function ensurePackTree(
  setup: PackTreeSetup
): Promise<{ caja: PurchaseFormat; inner: PurchaseFormat }> {
  requireSupabase()
  if (!(setup.count > 0) || !(setup.innerQtyInBase > 0)) {
    throw new Error('ensurePackTree: count e innerQtyInBase deben ser > 0.')
  }
  const formats = await listFormatsByItem(setup.itemId)

  // 1) Unidad interior: reutiliza si ya hay un nodo sin padre con ese contenido.
  const eps = Math.max(0.001, setup.innerQtyInBase * 0.0001)
  let inner =
    formats.find(
      (f) => f.parentFormatId == null && f.archivedAt == null && Math.abs(f.qtyInBase - setup.innerQtyInBase) <= eps
    ) ?? null
  if (!inner) {
    inner = await createPurchaseFormat({
      accountId: setup.accountId,
      itemId: setup.itemId,
      name: setup.innerName,
      qtyInBase: setup.innerQtyInBase,
      source: setup.source ?? 'manual',
      createdBy: setup.createdBy ?? null,
      createdByName: setup.createdByName ?? null,
    })
  }

  // 2) Caja: total DERIVADO del árbol (única fuente de verdad). Reutiliza si ya
  //    existe una caja con ese interior y ese número de unidades.
  const cajaQtyInBase = setup.count * inner.qtyInBase
  const innerId = inner.id
  let caja =
    formats.find(
      (f) =>
        f.parentFormatId === innerId &&
        f.archivedAt == null &&
        f.qtyPerParent != null &&
        Math.abs(f.qtyPerParent - setup.count) < 1e-9
    ) ?? null
  if (!caja) {
    caja = await createPurchaseFormat({
      accountId: setup.accountId,
      itemId: setup.itemId,
      name: setup.cajaName,
      qtyInBase: cajaQtyInBase,
      parentFormatId: innerId,
      qtyPerParent: setup.count,
      source: setup.source ?? 'manual',
      createdBy: setup.createdBy ?? null,
      createdByName: setup.createdByName ?? null,
    })
  }
  return { caja, inner }
}

// ─────────────────────────────────────────────────────────────────────
// Migración de artículos entre proveedores (mantenimiento).
// "Este proveedor ya no me sirve / está duplicado → mueve sus artículos a
// otro." Operación potente: previsualización SIEMPRE antes de ejecutar
// (preview_supplier_migration), y luego migrate_supplier_articles (RPC
// transaccional, modo 'fill' = rellenar huecos en las colisiones). El RPC
// recostea los raws vía trigger; aquí cascadeamos a los platos que los usan.
// ─────────────────────────────────────────────────────────────────────
export interface SupplierMigrationPreview {
  origenTotal: number   // artículos que cuelgan del origen
  colisiones: number    // de esos, los que el destino YA tiene (se fusionan)
  migranLimpio: number  // los que el destino no tiene (se mueven directos)
}

export async function previewSupplierMigration(
  sourceId: string,
  targetId: string,
): Promise<SupplierMigrationPreview> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('preview_supplier_migration', {
    p_source: sourceId,
    p_target: targetId,
  })
  if (error) throw new Error(`No se pudo previsualizar la migración: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    origenTotal: Number(r?.origen_total ?? 0),
    colisiones: Number(r?.colisiones ?? 0),
    migranLimpio: Number(r?.migran_limpio ?? 0),
  }
}

export interface SupplierMigrationResult {
  moved: number
  merged: number
  affectedItemIds: string[]
}

export async function migrateSupplierArticles(
  sourceId: string,
  targetId: string,
  mode: 'fill' = 'fill',
): Promise<SupplierMigrationResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('migrate_supplier_articles', {
    p_source: sourceId,
    p_target: targetId,
    p_mode: mode,
  })
  if (error) throw new Error(`No se pudo migrar: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  const affected = (r?.affected_item_ids ?? []) as string[]
  // El RPC recostea los raws (trigger). Cascada a los platos que los usan.
  for (const id of affected) {
    try {
      await cascadeFromItem(id)
    } catch (e) {
      console.error(`migrateSupplierArticles: cascada de coste falló para ${id}`, e)
    }
  }
  return {
    moved: Number(r?.moved ?? 0),
    merged: Number(r?.merged ?? 0),
    affectedItemIds: affected,
  }
}
