// src/modules/kitchen/services/comboEditService.ts
//
// Servicio de ESCRITURA de combos: CRUD de slots (combo_slot) y opciones
// (combo_slot_option) de un combo. Complementa brandCatalogService (lectura).
//
// Un combo es un menu_item (product_type='combo'). Sus "puntos de elección" son
// combo_slot (name, min/max_selections, position). Cada slot tiene N opciones
// (combo_slot_option) que apuntan a un menu_item (el producto elegible) con un
// price_impact (lo que suma/resta al precio del combo) y is_default.
//
// Patrón del proyecto: supabase directo, account_id, requireSupabase(), soft
// borrado con is_active donde existe la columna.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ─── Tipos de detalle editable ──────────────────────────────────────────

export interface ComboSlotOption {
  id: string
  menuItemId: string | null
  modifierGroupId: string | null
  optionName: string        // nombre del menu_item al que apunta (para mostrar)
  priceImpact: number
  isDefault: boolean
  position: number
}

export interface ComboSlotDetail {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  position: number
  options: ComboSlotOption[]
}

// ─── Contexto del editor (es combo? + marca + slots) ────────────────────

export interface ComboContext {
  isCombo: boolean
  brandId: string | null
  slots: ComboSlotDetail[]
}

/**
 * Determina si un menu_item es combo (lee product_type), su marca, y trae sus
 * slots editables. Una sola entrada para la página de detalle, sin depender del
 * tipo MenuItem del front.
 */
export async function getComboContext(accountId: string, menuItemId: string): Promise<ComboContext> {
  requireSupabase()
  const { data: mi, error } = await supabase!
    .from('menu_item')
    .select('product_type, brand_id')
    .eq('account_id', accountId)
    .eq('id', menuItemId)
    .single()
  if (error) throw new Error(`Error leyendo el producto: ${error.message}`)
  const isCombo = (mi as { product_type: string }).product_type === 'combo'
  const brandId = (mi as { brand_id: string | null }).brand_id ?? null
  if (!isCombo) return { isCombo: false, brandId, slots: [] }
  const slots = await getComboDetail(accountId, menuItemId)
  return { isCombo: true, brandId, slots }
}

// ─── Lectura del detalle editable de un combo ───────────────────────────

/** Slots + opciones de un combo, con el nombre del producto de cada opción. */
export async function getComboDetail(accountId: string, comboItemId: string): Promise<ComboSlotDetail[]> {
  requireSupabase()

  const { data: slots, error: sErr } = await supabase!
    .from('combo_slot')
    .select('id, name, min_selections, max_selections, position')
    .eq('account_id', accountId)
    .eq('combo_item_id', comboItemId)
    .eq('is_active', true)
    .order('position', { ascending: true })
  if (sErr) throw new Error(`Error leyendo slots: ${sErr.message}`)

  const slotIds = (slots ?? []).map((s) => s.id as string)
  const optsBySlot = new Map<string, ComboSlotOption[]>()

  if (slotIds.length > 0) {
    const { data: opts, error: oErr } = await supabase!
      .from('combo_slot_option')
      .select('id, combo_slot_id, menu_item_id, modifier_group_id, price_impact, is_default, position')
      .eq('account_id', accountId)
      .in('combo_slot_id', slotIds)
      .eq('is_active', true)
      .order('position', { ascending: true })
    if (oErr) throw new Error(`Error leyendo opciones: ${oErr.message}`)

    // Nombres de los menu_item a los que apuntan las opciones.
    const miIds = Array.from(new Set((opts ?? []).map((o) => o.menu_item_id).filter(Boolean) as string[]))
    const nameById = new Map<string, string>()
    if (miIds.length > 0) {
      const { data: mis, error: mErr } = await supabase!
        .from('menu_item')
        .select('id, name')
        .eq('account_id', accountId)
        .in('id', miIds)
      if (mErr) throw new Error(`Error leyendo nombres de opciones: ${mErr.message}`)
      for (const m of mis ?? []) nameById.set(m.id as string, m.name as string)
    }

    for (const o of opts ?? []) {
      const sid = o.combo_slot_id as string
      const arr = optsBySlot.get(sid) ?? []
      arr.push({
        id: o.id as string,
        menuItemId: (o.menu_item_id as string) ?? null,
        modifierGroupId: (o.modifier_group_id as string) ?? null,
        optionName: o.menu_item_id ? (nameById.get(o.menu_item_id as string) ?? '—') : '(grupo de modificadores)',
        priceImpact: Number(o.price_impact ?? 0),
        isDefault: o.is_default === true,
        position: Number(o.position ?? 0),
      })
      optsBySlot.set(sid, arr)
    }
  }

  return (slots ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    minSelections: Number(s.min_selections ?? 1),
    maxSelections: Number(s.max_selections ?? 1),
    position: Number(s.position ?? 0),
    options: optsBySlot.get(s.id as string) ?? [],
  }))
}

// ─── Slots ──────────────────────────────────────────────────────────────

/** Crea un slot nuevo al final del combo. */
export async function createSlot(
  accountId: string,
  comboItemId: string,
  name: string,
  minSelections = 1,
  maxSelections = 1,
): Promise<string> {
  requireSupabase()
  // Posición = siguiente al último.
  const { data: last } = await supabase!
    .from('combo_slot')
    .select('position')
    .eq('account_id', accountId)
    .eq('combo_item_id', comboItemId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = last ? Number((last as { position: number }).position) + 1 : 0

  const { data, error } = await supabase!
    .from('combo_slot')
    .insert({
      account_id: accountId,
      combo_item_id: comboItemId,
      name: name.trim() || 'Nuevo grupo',
      min_selections: minSelections,
      max_selections: maxSelections,
      position: nextPos,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Error creando el grupo: ${error.message}`)
  return (data as { id: string }).id
}

/** Edita nombre / min / max de un slot. */
export async function updateSlot(
  accountId: string,
  slotId: string,
  patch: { name?: string; minSelections?: number; maxSelections?: number },
): Promise<void> {
  requireSupabase()
  const upd: { name?: string; min_selections?: number; max_selections?: number; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (patch.name !== undefined) upd.name = patch.name.trim() || 'Grupo'
  if (patch.minSelections !== undefined) upd.min_selections = Math.max(0, patch.minSelections)
  if (patch.maxSelections !== undefined) upd.max_selections = Math.max(1, patch.maxSelections)
  const { error } = await supabase!
    .from('combo_slot')
    .update(upd)
    .eq('account_id', accountId)
    .eq('id', slotId)
  if (error) throw new Error(`Error guardando el grupo: ${error.message}`)
}

/** Borra (soft) un slot y sus opciones. */
export async function deleteSlot(accountId: string, slotId: string): Promise<void> {
  requireSupabase()
  const now = new Date().toISOString()
  const { error: oErr } = await supabase!
    .from('combo_slot_option')
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('combo_slot_id', slotId)
  if (oErr) throw new Error(`Error quitando las opciones del grupo: ${oErr.message}`)
  const { error } = await supabase!
    .from('combo_slot')
    .update({ is_active: false, updated_at: now })
    .eq('account_id', accountId)
    .eq('id', slotId)
  if (error) throw new Error(`Error quitando el grupo: ${error.message}`)
}

/** Reordena los slots de un combo según un array de ids en el nuevo orden. */
export async function reorderSlots(accountId: string, slotIdsInOrder: string[]): Promise<void> {
  requireSupabase()
  for (let i = 0; i < slotIdsInOrder.length; i++) {
    const { error } = await supabase!
      .from('combo_slot')
      .update({ position: i, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('id', slotIdsInOrder[i])
    if (error) throw new Error(`Error reordenando: ${error.message}`)
  }
}

// ─── Opciones ─────────────────────────────────────────────────────────────

/** Añade una opción (un menu_item elegible) a un slot. */
export async function addOption(
  accountId: string,
  slotId: string,
  menuItemId: string,
  priceImpact = 0,
  isDefault = false,
): Promise<string> {
  requireSupabase()
  const { data: last } = await supabase!
    .from('combo_slot_option')
    .select('position')
    .eq('account_id', accountId)
    .eq('combo_slot_id', slotId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = last ? Number((last as { position: number }).position) + 1 : 0

  const { data, error } = await supabase!
    .from('combo_slot_option')
    .insert({
      account_id: accountId,
      combo_slot_id: slotId,
      menu_item_id: menuItemId,
      price_impact: priceImpact,
      is_default: isDefault,
      position: nextPos,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Error añadiendo la opción: ${error.message}`)
  return (data as { id: string }).id
}

/** Edita el price_impact / default de una opción. */
export async function updateOption(
  accountId: string,
  optionId: string,
  patch: { priceImpact?: number; isDefault?: boolean },
): Promise<void> {
  requireSupabase()
  const upd: { price_impact?: number; is_default?: boolean } = {}
  if (patch.priceImpact !== undefined) upd.price_impact = patch.priceImpact
  if (patch.isDefault !== undefined) upd.is_default = patch.isDefault
  if (Object.keys(upd).length === 0) return
  const { error } = await supabase!
    .from('combo_slot_option')
    .update(upd)
    .eq('account_id', accountId)
    .eq('id', optionId)
  if (error) throw new Error(`Error guardando la opción: ${error.message}`)
}

/** Quita (soft) una opción de un slot. */
export async function deleteOption(accountId: string, optionId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('combo_slot_option')
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('id', optionId)
  if (error) throw new Error(`Error quitando la opción: ${error.message}`)
}

// ─── Buscar productos para añadir como opción ──────────────────────────────

export interface OptionCandidate {
  id: string
  name: string
  price: number
}

/** Productos (item, no combo) de la misma marca, para elegir como opción de un slot. */
export async function searchOptionCandidates(
  accountId: string,
  brandId: string,
  query: string,
): Promise<OptionCandidate[]> {
  requireSupabase()
  let q = supabase!
    .from('menu_item')
    .select('id, name, price')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('product_type', 'item')
    .is('archived_at', null)
    .order('name', { ascending: true })
    .limit(40)
  if (query.trim()) q = q.ilike('name', `%${query.trim()}%`)
  const { data, error } = await q
  if (error) throw new Error(`Error buscando productos: ${error.message}`)
  return (data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    price: Number(m.price ?? 0),
  }))
}
