// src/modules/kitchen/services/modifierEditService.ts
//
// Servicio de ESCRITURA de modificadores: grupos (modifier_group), opciones
// (modifier_option) y asignaciones a productos (modifier_group_assignment).
// Complementa brandCatalogService (lectura) y modifierImpactService (impacto en
// coste/escandallo — capa C, separada).
//
// CLAVE: los grupos son REUTILIZABLES entre productos de la marca. Editar un
// grupo (nombre, opciones) afecta a TODOS los productos que lo usan — por eso
// getGroupUsage devuelve a cuántos está asignado, para avisar antes de editar.
//
// Patrón del proyecto: supabase directo, account_id, requireSupabase(),
// soft-delete con is_active.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ModifierOptionDetail {
  id: string
  name: string
  priceImpact: number
  isDefault: boolean
  recipeItemId: string | null
  position: number
}

export interface ModifierGroupDetail {
  id: string
  name: string
  internalName: string | null
  groupType: string            // 'choice' | 'extras' | 'removal' | 'size' ...
  minSelections: number
  maxSelections: number
  position: number             // posición dentro del producto (de la asignación)
  usageCount: number           // a cuántos productos está asignado (reutilización)
  options: ModifierOptionDetail[]
}

// ─── Lectura del detalle editable de los grupos de un producto ──────────────

/** Grupos de modificadores asignados a un producto, con opciones y conteo de uso. */
export async function getProductModifierGroupsEditable(
  accountId: string,
  menuItemId: string,
): Promise<ModifierGroupDetail[]> {
  requireSupabase()

  // Asignaciones del producto → grupos (con su posición en este producto)
  const { data: asg, error: aErr } = await supabase!
    .from('modifier_group_assignment')
    .select('modifier_group_id, position')
    .eq('account_id', accountId)
    .eq('menu_item_id', menuItemId)
    .order('position', { ascending: true })
  if (aErr) throw new Error(`Error leyendo grupos del producto: ${aErr.message}`)

  const groupIds = (asg ?? []).map((a) => a.modifier_group_id as string)
  if (groupIds.length === 0) return []

  const posByGroup = new Map<string, number>()
  for (const a of asg ?? []) posByGroup.set(a.modifier_group_id as string, Number(a.position ?? 0))

  // Grupos
  const { data: groups, error: gErr } = await supabase!
    .from('modifier_group')
    .select('id, name, internal_name, group_type, min_selections, max_selections, position')
    .eq('account_id', accountId)
    .in('id', groupIds)
    .eq('is_active', true)
  if (gErr) throw new Error(`Error leyendo grupos: ${gErr.message}`)

  // Opciones de esos grupos
  const { data: opts, error: oErr } = await supabase!
    .from('modifier_option')
    .select('id, modifier_group_id, name, price_impact, is_default, recipe_item_id, position')
    .eq('account_id', accountId)
    .in('modifier_group_id', groupIds)
    .eq('is_active', true)
    .order('position', { ascending: true })
  if (oErr) throw new Error(`Error leyendo opciones: ${oErr.message}`)

  const optsByGroup = new Map<string, ModifierOptionDetail[]>()
  for (const o of opts ?? []) {
    const gid = o.modifier_group_id as string
    const arr = optsByGroup.get(gid) ?? []
    arr.push({
      id: o.id as string,
      name: o.name as string,
      priceImpact: Number(o.price_impact ?? 0),
      isDefault: o.is_default === true,
      recipeItemId: (o.recipe_item_id as string) ?? null,
      position: Number(o.position ?? 0),
    })
    optsByGroup.set(gid, arr)
  }

  // Conteo de uso (a cuántos productos está asignado cada grupo)
  const usageByGroup = new Map<string, number>()
  const { data: usage, error: uErr } = await supabase!
    .from('modifier_group_assignment')
    .select('modifier_group_id')
    .eq('account_id', accountId)
    .in('modifier_group_id', groupIds)
  if (uErr) throw new Error(`Error contando uso de grupos: ${uErr.message}`)
  for (const u of usage ?? []) {
    const gid = u.modifier_group_id as string
    usageByGroup.set(gid, (usageByGroup.get(gid) ?? 0) + 1)
  }

  return (groups ?? [])
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      internalName: (g.internal_name as string) ?? null,
      groupType: (g.group_type as string) ?? 'choice',
      minSelections: Number(g.min_selections ?? 0),
      maxSelections: Number(g.max_selections ?? 1),
      position: posByGroup.get(g.id as string) ?? Number(g.position ?? 0),
      usageCount: usageByGroup.get(g.id as string) ?? 1,
      options: optsByGroup.get(g.id as string) ?? [],
    }))
    .sort((a, b) => a.position - b.position)
}

// ─── Grupos ─────────────────────────────────────────────────────────────────

/** Crea un grupo nuevo en la marca y lo asigna al producto. Devuelve el group id. */
export async function createGroupForProduct(
  accountId: string,
  brandId: string,
  menuItemId: string,
  name: string,
  groupType = 'choice',
  minSelections = 0,
  maxSelections = 1,
): Promise<string> {
  requireSupabase()

  const { data: g, error: gErr } = await supabase!
    .from('modifier_group')
    .insert({
      account_id: accountId,
      brand_id: brandId,
      name: name.trim() || 'Nuevo grupo',
      group_type: groupType,
      min_selections: minSelections,
      max_selections: maxSelections,
      position: 0,
      is_active: true,
    })
    .select('id')
    .single()
  if (gErr) throw new Error(`Error creando el grupo: ${gErr.message}`)
  const groupId = (g as { id: string }).id

  // Asignar al producto al final
  const { data: last } = await supabase!
    .from('modifier_group_assignment')
    .select('position')
    .eq('account_id', accountId)
    .eq('menu_item_id', menuItemId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = last ? Number((last as { position: number }).position) + 1 : 0

  const { error: aErr } = await supabase!
    .from('modifier_group_assignment')
    .insert({
      account_id: accountId,
      modifier_group_id: groupId,
      menu_item_id: menuItemId,
      position: nextPos,
    })
  if (aErr) throw new Error(`Error asignando el grupo al producto: ${aErr.message}`)

  return groupId
}

/** Edita un grupo (nombre, tipo, min/max). Afecta a TODOS los productos que lo usan. */
export async function updateGroup(
  accountId: string,
  groupId: string,
  patch: { name?: string; groupType?: string; minSelections?: number; maxSelections?: number },
): Promise<void> {
  requireSupabase()
  const upd: { name?: string; group_type?: string; min_selections?: number; max_selections?: number; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (patch.name !== undefined) upd.name = patch.name.trim() || 'Grupo'
  if (patch.groupType !== undefined) upd.group_type = patch.groupType
  if (patch.minSelections !== undefined) upd.min_selections = Math.max(0, patch.minSelections)
  if (patch.maxSelections !== undefined) upd.max_selections = Math.max(1, patch.maxSelections)
  const { error } = await supabase!
    .from('modifier_group')
    .update(upd)
    .eq('account_id', accountId)
    .eq('id', groupId)
  if (error) throw new Error(`Error guardando el grupo: ${error.message}`)
}

/** Quita la asignación de un grupo a ESTE producto (no borra el grupo, que puede
 *  estar en otros productos). */
export async function unassignGroupFromProduct(
  accountId: string,
  groupId: string,
  menuItemId: string,
): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('modifier_group_assignment')
    .delete()
    .eq('account_id', accountId)
    .eq('modifier_group_id', groupId)
    .eq('menu_item_id', menuItemId)
  if (error) throw new Error(`Error quitando el grupo del producto: ${error.message}`)
}

/** Asigna un grupo EXISTENTE de la marca a un producto (reutilización). */
export async function assignExistingGroup(
  accountId: string,
  groupId: string,
  menuItemId: string,
): Promise<void> {
  requireSupabase()
  // Evitar duplicado
  const { data: dup } = await supabase!
    .from('modifier_group_assignment')
    .select('id')
    .eq('account_id', accountId)
    .eq('modifier_group_id', groupId)
    .eq('menu_item_id', menuItemId)
    .maybeSingle()
  if (dup) return

  const { data: last } = await supabase!
    .from('modifier_group_assignment')
    .select('position')
    .eq('account_id', accountId)
    .eq('menu_item_id', menuItemId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = last ? Number((last as { position: number }).position) + 1 : 0

  const { error } = await supabase!
    .from('modifier_group_assignment')
    .insert({
      account_id: accountId,
      modifier_group_id: groupId,
      menu_item_id: menuItemId,
      position: nextPos,
    })
  if (error) throw new Error(`Error asignando el grupo: ${error.message}`)
}

// ─── Opciones ─────────────────────────────────────────────────────────────────

/** Añade una opción a un grupo. */
export async function addModifierOption(
  accountId: string,
  groupId: string,
  name: string,
  priceImpact = 0,
  isDefault = false,
): Promise<string> {
  requireSupabase()
  const { data: last } = await supabase!
    .from('modifier_option')
    .select('position')
    .eq('account_id', accountId)
    .eq('modifier_group_id', groupId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = last ? Number((last as { position: number }).position) + 1 : 0

  const { data, error } = await supabase!
    .from('modifier_option')
    .insert({
      account_id: accountId,
      modifier_group_id: groupId,
      name: name.trim() || 'Nueva opción',
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

/** Edita una opción (nombre, price_impact, default). */
export async function updateModifierOption(
  accountId: string,
  optionId: string,
  patch: { name?: string; priceImpact?: number; isDefault?: boolean },
): Promise<void> {
  requireSupabase()
  const upd: { name?: string; price_impact?: number; is_default?: boolean; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (patch.name !== undefined) upd.name = patch.name.trim() || 'Opción'
  if (patch.priceImpact !== undefined) upd.price_impact = patch.priceImpact
  if (patch.isDefault !== undefined) upd.is_default = patch.isDefault
  const { error } = await supabase!
    .from('modifier_option')
    .update(upd)
    .eq('account_id', accountId)
    .eq('id', optionId)
  if (error) throw new Error(`Error guardando la opción: ${error.message}`)
}

/** Quita (soft) una opción. */
export async function deleteModifierOption(accountId: string, optionId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('modifier_option')
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('id', optionId)
  if (error) throw new Error(`Error quitando la opción: ${error.message}`)
}

// ─── Grupos existentes de la marca (para reutilizar / asignar) ──────────────

export interface ExistingGroup {
  id: string
  name: string
  groupType: string
  optionCount: number
  usageCount: number
}

/** Grupos de la marca que NO están ya en este producto, para ofrecerlos a reutilizar. */
export async function listAssignableGroups(
  accountId: string,
  brandId: string,
  menuItemId: string,
): Promise<ExistingGroup[]> {
  requireSupabase()

  const { data: groups, error: gErr } = await supabase!
    .from('modifier_group')
    .select('id, name, group_type')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (gErr) throw new Error(`Error listando grupos de la marca: ${gErr.message}`)

  const allIds = (groups ?? []).map((g) => g.id as string)
  if (allIds.length === 0) return []

  // Grupos ya asignados a este producto (para excluirlos)
  const { data: assigned } = await supabase!
    .from('modifier_group_assignment')
    .select('modifier_group_id')
    .eq('account_id', accountId)
    .eq('menu_item_id', menuItemId)
  const assignedSet = new Set((assigned ?? []).map((a) => a.modifier_group_id as string))

  // Conteo de opciones y de uso
  const { data: opts } = await supabase!
    .from('modifier_option')
    .select('modifier_group_id')
    .eq('account_id', accountId)
    .in('modifier_group_id', allIds)
    .eq('is_active', true)
  const optCount = new Map<string, number>()
  for (const o of opts ?? []) {
    const gid = o.modifier_group_id as string
    optCount.set(gid, (optCount.get(gid) ?? 0) + 1)
  }
  const { data: usage } = await supabase!
    .from('modifier_group_assignment')
    .select('modifier_group_id')
    .eq('account_id', accountId)
    .in('modifier_group_id', allIds)
  const useCount = new Map<string, number>()
  for (const u of usage ?? []) {
    const gid = u.modifier_group_id as string
    useCount.set(gid, (useCount.get(gid) ?? 0) + 1)
  }

  return (groups ?? [])
    .filter((g) => !assignedSet.has(g.id as string))
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      groupType: (g.group_type as string) ?? 'choice',
      optionCount: optCount.get(g.id as string) ?? 0,
      usageCount: useCount.get(g.id as string) ?? 0,
    }))
}
