// src/modules/shop/services/dishConfigService.ts
//
// Configurador de plato para Folvy Shop: lee el árbol de configuración de un
// menu_item (combo con slots + modificadores anidados, o plato suelto con
// modificadores), y provee la lógica de PRECIO EN VIVO y VALIDACIÓN de min/max.
//
// El árbol viene de la RPC shop_item_config. La "selección" del usuario y el
// cálculo de precio/validez viven aquí (no en la UI), para que el modal solo
// pinte y delegue.

import { supabase } from '@/lib/supabase'

// ── Tipos del árbol (espejo de la RPC) ──────────────────────────────────

export interface Allergen {
  code: string
  nameEs: string
  icon: string | null
}

export interface ModifierOption {
  id: string
  name: string
  priceImpact: number
  isDefault: boolean
  allergens: Allergen[]
}

export interface ModifierGroup {
  id: string
  name: string
  min: number
  max: number
  allowRepetition: boolean
  options: ModifierOption[]
}

export interface SlotOption {
  menuItemId: string
  name: string
  photoUrl: string | null
  priceImpact: number
  isDefault: boolean
  allergens: Allergen[]
  modifierGroups: ModifierGroup[]   // modificadores anidados de ESTA opción
}

export interface ComboSlot {
  id: string
  name: string
  min: number
  max: number
  options: SlotOption[]
}

export interface DishConfig {
  id: string
  name: string
  description: string | null
  photoUrl: string | null
  price: number              // precio base
  productType: 'item' | 'combo'
  allergens: Allergen[]      // alérgenos del plato base
  modifierGroups: ModifierGroup[]  // modificadores directos (plato suelto)
  slots: ComboSlot[]         // slots (si es combo)
}

function mapAllergens(arr: any[]): Allergen[] {
  return (arr ?? []).map((a) => ({ code: a.code, nameEs: a.name_es, icon: a.icon ?? null }))
}

function mapModOption(o: any): ModifierOption {
  return { id: o.id, name: o.name, priceImpact: Number(o.price_impact ?? 0), isDefault: o.is_default === true, allergens: mapAllergens(o.allergens) }
}

function mapModGroup(g: any): ModifierGroup {
  return {
    id: g.id, name: g.name, min: g.min ?? 0, max: g.max ?? 99,
    allowRepetition: g.allow_repetition === true,
    options: (g.options ?? []).map(mapModOption),
  }
}

function mapSlotOption(o: any): SlotOption {
  return {
    menuItemId: o.menu_item_id, name: o.name, photoUrl: o.photo_url ?? null,
    priceImpact: Number(o.price_impact ?? 0), isDefault: o.is_default === true,
    allergens: mapAllergens(o.allergens),
    modifierGroups: (o.modifier_groups ?? []).map(mapModGroup),
  }
}

export async function getDishConfig(slug: string, menuItemId: string): Promise<DishConfig | null> {
  if (!supabase) throw new Error('Supabase no configurado')
  const { data, error } = await (supabase as any).rpc('shop_item_config', { p_slug: slug, p_menu_item_id: menuItemId })
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? null,
    photoUrl: data.photo_url ?? null,
    price: Number(data.price ?? 0),
    productType: data.product_type === 'combo' ? 'combo' : 'item',
    allergens: mapAllergens(data.allergens),
    modifierGroups: (data.modifier_groups ?? []).map(mapModGroup),
    slots: (data.slots ?? []).map((s: any) => ({
      id: s.id, name: s.name, min: s.min ?? 0, max: s.max ?? 99,
      options: (s.options ?? []).map(mapSlotOption),
    })),
  }
}

// ── Selección del usuario ───────────────────────────────────────────────
//
// Estructura de la selección, separada por contexto para no mezclar ids
// (un mismo modifier_group_id puede aparecer bajo dos opciones de slot
// distintas, así que la clave de selección de modificadores incluye el
// contexto: 'base' | slotId:optionMenuItemId).

/** Opción de modificador elegida, con su cantidad (>=1). */
export interface ModSelection {
  optionId: string
  qty: number
}

export interface DishSelection {
  // Modificadores del plato base (no combo): groupId -> opciones elegidas
  baseMods: Record<string, ModSelection[]>
  // Slots del combo: slotId -> menuItemIds elegidos (en orden)
  slotChoices: Record<string, string[]>
  // Modificadores anidados: `${slotId}:${menuItemId}:${groupId}` -> opciones
  nestedMods: Record<string, ModSelection[]>
  // Cantidad del plato entero
  quantity: number
}

export function emptySelection(): DishSelection {
  return { baseMods: {}, slotChoices: {}, nestedMods: {}, quantity: 1 }
}

export function nestedKey(slotId: string, menuItemId: string, groupId: string): string {
  return `${slotId}:${menuItemId}:${groupId}`
}

// ── Cálculo de precio ───────────────────────────────────────────────────

function modsTotal(groups: ModifierGroup[], sel: Record<string, ModSelection[]>, keyFor: (groupId: string) => string): number {
  let total = 0
  for (const g of groups) {
    const chosen = sel[keyFor(g.id)] ?? []
    for (const c of chosen) {
      const opt = g.options.find((o) => o.id === c.optionId)
      if (opt) total += opt.priceImpact * c.qty
    }
  }
  return total
}

/** Precio unitario configurado (sin multiplicar por la cantidad del plato). */
export function unitPrice(config: DishConfig, sel: DishSelection): number {
  let price = config.price
  // Modificadores del plato base
  price += modsTotal(config.modifierGroups, sel.baseMods, (gid) => gid)
  // Slots del combo
  for (const slot of config.slots) {
    const chosenItemIds = sel.slotChoices[slot.id] ?? []
    for (const itemId of chosenItemIds) {
      const opt = slot.options.find((o) => o.menuItemId === itemId)
      if (!opt) continue
      price += opt.priceImpact
      // Modificadores anidados de esa opción elegida
      price += modsTotal(opt.modifierGroups, sel.nestedMods, (gid) => nestedKey(slot.id, itemId, gid))
    }
  }
  return price
}

/** Precio total (unitario × cantidad). */
export function totalPrice(config: DishConfig, sel: DishSelection): number {
  return unitPrice(config, sel) * Math.max(1, sel.quantity)
}

// ── Validación de min/max ───────────────────────────────────────────────

export interface ValidationError {
  scope: string        // descripción legible de dónde falla
  message: string
}

function countMods(chosen: ModSelection[]): number {
  return chosen.reduce((n, c) => n + c.qty, 0)
}

function validateGroups(groups: ModifierGroup[], sel: Record<string, ModSelection[]>, keyFor: (g: ModifierGroup) => string, prefix: string, errors: ValidationError[]) {
  for (const g of groups) {
    const chosen = sel[keyFor(g)] ?? []
    const n = countMods(chosen)
    if (n < g.min) {
      errors.push({ scope: `${prefix}${g.name}`, message: g.min === 1 ? `Elige al menos 1 opción en “${g.name}”.` : `Elige al menos ${g.min} en “${g.name}”.` })
    }
    if (g.max > 0 && n > g.max) {
      errors.push({ scope: `${prefix}${g.name}`, message: `Máximo ${g.max} en “${g.name}”.` })
    }
  }
}

/** Devuelve la lista de errores de validación. Vacía = configuración válida. */
export function validateSelection(config: DishConfig, sel: DishSelection): ValidationError[] {
  const errors: ValidationError[] = []

  // Modificadores del plato base
  validateGroups(config.modifierGroups, sel.baseMods, (g) => g.id, '', errors)

  // Slots del combo
  for (const slot of config.slots) {
    const chosen = sel.slotChoices[slot.id] ?? []
    const n = chosen.length
    if (n < slot.min) {
      errors.push({ scope: slot.name, message: slot.min === 1 ? `Elige una opción en “${slot.name}”.` : `Elige al menos ${slot.min} en “${slot.name}”.` })
    }
    if (slot.max > 0 && n > slot.max) {
      errors.push({ scope: slot.name, message: `Máximo ${slot.max} en “${slot.name}”.` })
    }
    // Modificadores anidados de cada opción elegida
    for (const itemId of chosen) {
      const opt = slot.options.find((o) => o.menuItemId === itemId)
      if (!opt) continue
      validateGroups(opt.modifierGroups, sel.nestedMods, (g) => nestedKey(slot.id, itemId, g.id), `${opt.name} · `, errors)
    }
  }

  return errors
}

export function isValid(config: DishConfig, sel: DishSelection): boolean {
  return validateSelection(config, sel).length === 0
}

// ── Resumen legible (para el carrito) ───────────────────────────────────
//
// Devuelve las líneas de texto que describen la configuración elegida, como
// en el carrito de Last ("- The Beef Legend", "- Salsa Tzatziki", ...).

export function selectionSummary(config: DishConfig, sel: DishSelection): string[] {
  const lines: string[] = []
  // Base mods
  for (const g of config.modifierGroups) {
    for (const c of (sel.baseMods[g.id] ?? [])) {
      const opt = g.options.find((o) => o.id === c.optionId)
      if (opt) lines.push(c.qty > 1 ? `${opt.name} ×${c.qty}` : opt.name)
    }
  }
  // Slots
  for (const slot of config.slots) {
    for (const itemId of (sel.slotChoices[slot.id] ?? [])) {
      const opt = slot.options.find((o) => o.menuItemId === itemId)
      if (!opt) continue
      lines.push(opt.name)
      for (const g of opt.modifierGroups) {
        for (const c of (sel.nestedMods[nestedKey(slot.id, itemId, g.id)] ?? [])) {
          const mo = g.options.find((o) => o.id === c.optionId)
          if (mo) lines.push(c.qty > 1 ? `  ${mo.name} ×${c.qty}` : `  ${mo.name}`)
        }
      }
    }
  }
  return lines
}

/** Conjunto de alérgenos (codes) presentes en la configuración elegida. */
export function selectionAllergens(config: DishConfig, sel: DishSelection): Allergen[] {
  const byCode = new Map<string, Allergen>()
  const add = (arr: Allergen[]) => arr.forEach((a) => byCode.set(a.code, a))
  add(config.allergens)
  for (const g of config.modifierGroups) {
    for (const c of (sel.baseMods[g.id] ?? [])) {
      const opt = g.options.find((o) => o.id === c.optionId)
      if (opt) add(opt.allergens)
    }
  }
  for (const slot of config.slots) {
    for (const itemId of (sel.slotChoices[slot.id] ?? [])) {
      const opt = slot.options.find((o) => o.menuItemId === itemId)
      if (!opt) continue
      add(opt.allergens)
      for (const g of opt.modifierGroups) {
        for (const c of (sel.nestedMods[nestedKey(slot.id, itemId, g.id)] ?? [])) {
          const mo = g.options.find((o) => o.id === c.optionId)
          if (mo) add(mo.allergens)
        }
      }
    }
  }
  return [...byCode.values()]
}
