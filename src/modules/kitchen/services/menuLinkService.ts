// src/modules/kitchen/services/menuLinkService.ts
//
// Trazabilidad ítem↔escandallo: aprobación explícita del enlace menu_item↔
// recipe_item. Envuelve las 5 RPC de la migración 20260802T1030 (guard
// verificado contra el policy menu_item_write vivo — ver esa migración).
//
// menu_item.needs_review = "hay coste" (lo pone map_sales_product_to_dish al
// enlazar). menu_item.link_approved_at/by = "un humano dijo que el enlace es
// el correcto". Son cosas DISTINTAS — no confundir ni mezclar en la UI.
//
// menu_item_link_health.status es la ÚNICA fuente de verdad del sello (3
// estados: roto_* / sin_aprobar / aprobado), recalculada en vivo cada
// llamada. El sello del Menú y la pantalla de barrido leen de aquí, nunca de
// menu_item.needs_review directamente.
//
// Convención de errores: todos los métodos LANZAN Error si la RPC falla.
// Un catch que trague el error y devuelva [] esconde el fallo — como mínimo
// console.warn antes de degradar a lista vacía en el caller.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { createRecipeItem } from './recipeItemService'
import { listUnits } from './kitchenUnitService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio
// ─────────────────────────────────────────────────────────────────────

export type MenuItemLinkStatus =
  | 'roto_sin_escandallo'
  | 'roto_enlace'
  | 'roto_coste_null'
  | 'roto_needs_review'
  | 'roto_coste_imposible'
  | 'sin_aprobar'
  | 'aprobado'

export interface MenuItemLinkHealthRow {
  menuItemId: string
  itemName: string
  brandId: string
  brandName: string | null
  recipeItemId: string | null
  recipeName: string | null
  cost: number | null
  needsReview: boolean
  linkApprovedAt: string | null
  status: MenuItemLinkStatus
  sharedWith: number
}

/** Los 7 status técnicos colapsan a 3 estados humanos — el cockpit, el Menú y
 * la ficha muestran SIEMPRE uno de estos 3, nunca la jerga técnica. */
export type LinkHumanState = 'bien' | 'para_revisar' | 'sin_casar'

/**
 * Metadatos de presentación del sello — única fuente de verdad para las
 * pantallas que lo pintan (ficha de producto, fila del Menú, cockpit
 * "Casado", ficha de escandallo). No dupliques este mapeo localmente en un
 * componente. `label`/`tone` son SIEMPRE los 3 del bucket humano (uniformes);
 * `reason` es el motivo corto técnico (para tooltip); `plainText` es la
 * frase larga en lenguaje de cocina para el cockpit — nada de "needs_review"
 * ni "roto_coste_imposible" en pantalla, eso vive solo en `status`.
 */
export const LINK_STATUS_META: Record<MenuItemLinkStatus, {
  human: LinkHumanState
  label: string
  tone: 'red' | 'amber' | 'green'
  reason: string
  plainText: string
}> = {
  roto_sin_escandallo: {
    human: 'sin_casar', label: 'Sin casar', tone: 'red',
    reason: 'Sin escandallo enlazado',
    plainText: 'No tiene receta. No sabemos su coste ni descuenta de almacén.',
  },
  roto_enlace: {
    human: 'sin_casar', label: 'Sin casar', tone: 'red',
    reason: 'El escandallo enlazado ya no existe',
    plainText: 'La receta a la que estaba enlazado ya no existe. Hay que volver a enlazarlo.',
  },
  roto_coste_null: {
    human: 'sin_casar', label: 'Sin casar', tone: 'red',
    reason: 'El escandallo no tiene coste calculado',
    plainText: 'La receta no tiene coste. No sabemos cuánto cuesta este plato.',
  },
  roto_needs_review: {
    human: 'sin_casar', label: 'Sin casar', tone: 'red',
    reason: 'El escandallo está marcado a revisión',
    plainText: 'La receta está marcada a revisión — su coste no es fiable todavía.',
  },
  roto_coste_imposible: {
    human: 'sin_casar', label: 'Sin casar', tone: 'red',
    reason: 'El coste del escandallo es sospechosamente bajo',
    plainText: 'El coste es demasiado bajo, parece un error.',
  },
  sin_aprobar: {
    human: 'para_revisar', label: 'Para revisar', tone: 'amber',
    reason: 'En uso, pendiente de aprobación de oficina',
    plainText: 'Está casado pero nadie lo ha confirmado.',
  },
  aprobado: {
    human: 'bien', label: 'Bien', tone: 'green',
    reason: 'Aprobado por oficina',
    plainText: 'Confirmado por oficina.',
  },
}

export interface MenuItemSharedRecipeReview {
  recipeItemId: string
  recipeName: string
  nItems: number
  itemNames: string[]
  rawIngredients: string[]
}

export interface SetMenuItemRecipeResult {
  menuItemId: string
  recipeItemId: string
  recipeName: string
}

export interface ApproveMenuItemLinkResult {
  menuItemId: string
  recipeName: string
  cost: number
}

// ─────────────────────────────────────────────────────────────────────
// Escritura — solo admin de la cuenta (guard exacto de menu_item_write)
// ─────────────────────────────────────────────────────────────────────

/**
 * Asigna o cambia el escandallo de un ítem. Resetea la aprobación (todo
 * cambio de enlace exige re-aprobar) — nunca deja el sello en verde solo.
 */
export async function setMenuItemRecipe(
  menuItemId: string,
  recipeItemId: string,
): Promise<SetMenuItemRecipeResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('set_menu_item_recipe', {
    p_menu_item_id: menuItemId,
    p_recipe_item_id: recipeItemId,
  })
  if (error) throw new Error(`Error asignando escandallo: ${error.message}`)
  const r = (data ?? {}) as {
    menu_item_id?: string; recipe_item_id?: string; recipe_name?: string
  }
  return {
    menuItemId: r.menu_item_id ?? menuItemId,
    recipeItemId: r.recipe_item_id ?? recipeItemId,
    recipeName: r.recipe_name ?? '',
  }
}

/** Quita el escandallo de un ítem. El plato queda sin coste. */
export async function clearMenuItemRecipe(menuItemId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('clear_menu_item_recipe', {
    p_menu_item_id: menuItemId,
  })
  if (error) throw new Error(`Error quitando escandallo: ${error.message}`)
}

/**
 * Aprueba el enlace actual (único camino al sello verde). La RPC rechaza si
 * no hay receta, el coste es NULL, la receta está a revisión/archivada, o el
 * coste es sospechosamente bajo (< 0,50 €) — el mensaje de error ya viene
 * legible desde el servidor.
 */
export async function approveMenuItemLink(menuItemId: string): Promise<ApproveMenuItemLinkResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('approve_menu_item_link', {
    p_menu_item_id: menuItemId,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { menu_item_id?: string; recipe_name?: string; cost?: number }
  return {
    menuItemId: r.menu_item_id ?? menuItemId,
    recipeName: r.recipe_name ?? '',
    cost: r.cost ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lectura / auditoría — admin o manager de la cuenta
// ─────────────────────────────────────────────────────────────────────

/**
 * Estado de salud del enlace ítem↔escandallo, por cuenta (y opcionalmente
 * por marca). Fuente única del sello de 3 estados y de la pantalla de
 * barrido — nunca derivar el sello de `menu_item.needs_review` en el front.
 */
export async function getMenuItemLinkHealth(
  accountId: string,
  brandId?: string,
): Promise<MenuItemLinkHealthRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('menu_item_link_health', {
    p_account_id: accountId,
    p_brand_id: brandId ?? undefined,
  })
  if (error) throw new Error(`Error leyendo salud de escandallos: ${error.message}`)
  return (data ?? []).map((row) => ({
    menuItemId: row.menu_item_id,
    itemName: row.item_name,
    brandId: row.brand_id,
    brandName: row.brand_name ?? null,
    recipeItemId: row.recipe_item_id ?? null,
    recipeName: row.recipe_name ?? null,
    cost: row.cost ?? null,
    needsReview: row.needs_review,
    linkApprovedAt: row.link_approved_at ?? null,
    status: row.status as MenuItemLinkStatus,
    sharedWith: row.shared_with,
  }))
}

/**
 * Escandallos compartidos por >1 ítem, con nombres de ítems e ingredientes
 * crudos — dato de entrada para la futura IA asesora (sin consumidor de UI
 * todavía).
 */
export async function getMenuItemSharedRecipeReview(
  accountId: string,
): Promise<MenuItemSharedRecipeReview[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('menu_item_shared_recipe_review', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`Error leyendo escandallos compartidos: ${error.message}`)
  return (data ?? []).map((row) => ({
    recipeItemId: row.recipe_item_id,
    recipeName: row.recipe_name,
    nItems: row.n_items,
    itemNames: row.item_names ?? [],
    rawIngredients: row.raw_ingredients ?? [],
  }))
}

export interface MenuItemUsingRecipe {
  id: string
  name: string
  brandId: string
}

/**
 * Doble dirección: desde la ficha del escandallo, qué ítems de carta lo usan
 * hoy. Consulta directa (no hace falta RPC — RLS de menu_item_read ya cubre
 * el scope de cuenta).
 */
export async function listMenuItemsUsingRecipe(recipeItemId: string): Promise<MenuItemUsingRecipe[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .select('id, name, brand_id')
    .eq('recipe_item_id', recipeItemId)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando ítems que usan este escandallo: ${error.message}`)
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    brandId: row.brand_id,
  }))
}

/**
 * "Crear receta" — crea un recipe_item tipo 'dish' con el nombre del plato y
 * lo enlaza en un solo paso. Composición reutilizada por la ficha de
 * producto y por el cockpit "Casado" (no duplicar esta lógica en cada UI).
 */
export async function createDishAndLinkToMenuItem(
  accountId: string,
  menuItemId: string,
  dishName: string,
): Promise<SetMenuItemRecipeResult> {
  const units = await listUnits({ dimension: 'unit', includeInactive: false })
  const baseUnitId = units.find((u) => u.isBase)?.id ?? units[0]?.id
  if (!baseUnitId) throw new Error('No hay una unidad de tipo "Unidad" configurada en esta cuenta.')
  const created = await createRecipeItem({
    accountId,
    type: 'dish',
    name: dishName,
    baseUnitId,
    source: 'manual',
    needsReview: true,
  })
  return setMenuItemRecipe(menuItemId, created.id)
}
