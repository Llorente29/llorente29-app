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
} from '../../../types/kitchen'
import { cascadeFromItem } from './costCascadeService'

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

export async function listSuppliersByItem(itemId: string): Promise<ArticleSupplier[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('article_supplier')
    .select('*')
    .eq('recipe_item_id', itemId)
    .eq('is_active', true)
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
}

export interface SimplePurchaseResult {
  format: PurchaseFormat
  link: ArticleSupplier
}

export async function setupSimplePurchase(
  setup: SimplePurchaseSetup
): Promise<SimplePurchaseResult> {
  requireSupabase()
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
  const link = await linkSupplierFormat({
    accountId: setup.accountId,
    recipeItemId: setup.itemId,
    supplierId: setup.supplierId,
    purchaseFormatId: format.id,
    lastPrice: setup.lastPrice,
    supplierCode: setup.supplierCode ?? null,
    isPreferred: setup.isPreferred ?? false,
  })
  // El trigger ya recalculó el coste del ingrediente al insertar el precio.
  // Propagamos a los platos/sub-recetas que lo usan. Fail-safe: si falla la
  // cascada, el alta NO se revierte (el coste del ingrediente quedó bien).
  try {
    await cascadeFromItem(setup.itemId)
  } catch (e) {
    console.error(`setupSimplePurchase: cascada de coste falló para ${setup.itemId}`, e)
  }
  return { format, link }
}
