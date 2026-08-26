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
import { fmtMoney } from '../../../lib/format'
import type { RecipeItemType } from '../../../types/kitchen'

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
  /** type del recipe_item enlazado ('dish'|'raw'|...) — null si no hay enlace.
   * Eje de clasificación: un recipe_item es a la vez escandallo Y artículo,
   * una bebida de reventa se casa igual que un plato (menu_item.recipe_item_id
   * apunta a su propio recipe_item type='raw'). NUNCA clasificar por nombre
   * o categoría — solo por este hecho estructural. */
  recipeType: RecipeItemType | null
  /** nº de recipe_line del recipe_item enlazado (como padre) — 0 en un
   * 'dish' significa "escandallo sin montar todavía". */
  recipeLineCount: number
  cost: number | null
  /** precio de venta del menu_item — solo para afinar el aviso de "Para
   * revisar" en un raw (aritmética precio/coste), nunca decide el estado. */
  price: number | null
  needsReview: boolean
  linkApprovedAt: string | null
  /** Líneas de venta de este ítem en los últimos 90 días. */
  soldLines90d: number
  /** Importe vendido en esos 90 días. */
  soldEur90d: number
  /** Sigue pedible en el catálogo externo. Un ítem que ni está vivo ni ha
   *  vendido es un resto fuera de carta: cuenta, pero no es una urgencia. */
  liveInCatalog: boolean
  status: MenuItemLinkStatus
  sharedWith: number
}

/** Los 7 status técnicos + recipe_type + recipe_line_count colapsan a 5
 * estados humanos — el cockpit, el Menú y las fichas muestran SIEMPRE uno de
 * estos 5, nunca la jerga técnica. */
export type LinkHumanState = 'bien' | 'para_revisar' | 'falta_escandallo' | 'falta_precio' | 'sin_casar'

export interface LinkClassification {
  human: LinkHumanState
  label: string
  tone: 'green' | 'amber' | 'orange' | 'red'
  /** Frase larga en lenguaje de cocina, lista para pintar — nada de
   * "needs_review" ni "roto_coste_imposible" en pantalla, eso vive solo en
   * `status`/`recipeType`. */
  text: string
}

const HUMAN_LABEL: Record<LinkHumanState, string> = {
  bien: 'Bien',
  para_revisar: 'Para revisar',
  falta_escandallo: 'Falta escandallo',
  falta_precio: 'Falta precio',
  sin_casar: 'Sin casar',
}

const HUMAN_TONE: Record<LinkHumanState, 'green' | 'amber' | 'orange' | 'red'> = {
  bien: 'green',
  para_revisar: 'amber',
  falta_escandallo: 'orange',
  falta_precio: 'orange',
  sin_casar: 'red',
}

function classification(human: LinkHumanState, text: string): LinkClassification {
  return { human, label: HUMAN_LABEL[human], tone: HUMAN_TONE[human], text }
}

/** Por debajo de este % del precio de venta, el coste de un `raw` es
 * demasiado bajo para ser un artículo/escandallo completo — dispara el
 * aviso de alarma en "Para revisar". Sugerido por Julio (03/08), parametrizable. */
const SUSPICIOUS_COST_RATIO = 0.05

/**
 * Clasifica una fila de menu_item_link_health en uno de los 5 estados
 * humanos del cockpit "Casado" — ÚNICA fuente de verdad del sello. Las
 * pantallas que lo pintan (ficha de producto, fila del Menú, cockpit
 * "Casado", ficha de escandallo) llaman a esta función — no reimplementar
 * la lógica en un componente.
 *
 * Regla aprobada por Julio (03/08): el eje es recipe_item.type ('dish' vs
 * 'raw'), NUNCA nombre/categoría/juicio de cocina — is_sellable/
 * is_purchasable están sucios en datos reales y no sirven de eje.
 *
 * "Falta precio"/"Falta escandallo" son SOLO para coste NULL (o, en dish,
 * 0 líneas) — NUNCA por un umbral de coste bajo. Un raw con coste, por bajo
 * que sea (Carne de Birria a 0,019 €), tiene coste: va a "Para revisar", no
 * a "Falta precio" — ese fue el bug que cazó Julio en vivo el 03/08.
 *
 * Un `raw` casado con coste y sin aprobar es SIEMPRE "Para revisar": no hay
 * un camino aparte de "reventa normal sin aviso" — el mismo mecanismo de
 * aprobación cubre tanto un refresco legítimo (Nestea) como un plato mal
 * enlazado a un ingrediente suelto (Quesadilla→Carne de Birria). Oficina lo
 * confirma una vez; tras aprobar, ambos casos son "Bien" igual que
 * cualquier otro. El AVISO (no el estado) se afina por aritmética
 * precio/coste — un hecho, no juicio de cocina — SOLO cuando hay precio de
 * venta > 0; si el precio es 0 o desconocido, aviso neutro (no se puede
 * calcular una alarma con datos que no existen).
 */
export function classifyMenuItemLink(row: MenuItemLinkHealthRow): LinkClassification {
  if (!row.recipeItemId || !row.recipeType) {
    return classification(
      'sin_casar',
      'No tiene receta ni artículo enlazado. No sabemos su coste ni descuenta de almacén.',
    )
  }

  const sharedNote = row.sharedWith > 1 ? ' Esta receta también la usa otro plato.' : ''

  if (row.recipeType === 'dish') {
    if (row.recipeLineCount === 0 || row.cost == null) {
      return classification('falta_escandallo', 'Falta el escandallo — este plato aún no tiene receta montada.')
    }
    if (row.linkApprovedAt) {
      return classification('bien', 'Confirmado por oficina.')
    }
    return classification('para_revisar', `Casado, sin confirmar.${sharedNote}`)
  }

  if (row.recipeType === 'raw') {
    if (row.cost == null) {
      return classification(
        'falta_precio',
        `Casado con ${row.recipeName ?? 'su artículo'}, falta ponerle el precio de compra.`,
      )
    }
    if (row.linkApprovedAt) {
      return classification('bien', 'Confirmado por oficina.')
    }
    const ratio = row.price != null && row.price > 0 ? row.cost / row.price : null
    const text = ratio == null
      ? 'Este producto se está costeando con un ingrediente suelto. Revísalo.'
      : ratio < SUSPICIOUS_COST_RATIO
        ? `Se vende a ${fmtMoney(row.price)} pero se costea con un ingrediente de ${fmtMoney(row.cost)}. Le faltan casi todos los componentes. ¿Reasignar a un escandallo completo?`
        : 'Este producto se vende como un artículo directo. Confirma que es correcto.'
    return classification('para_revisar', `${text}${sharedNote}`)
  }

  // packaging/tool/recipe enlazado — la RPC ya excluye estos casos; defensivo.
  return classification('sin_casar', 'Enlazado a un artículo que no es ni plato ni ingrediente de venta.')
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
    recipeType: (row.recipe_type as RecipeItemType | null) ?? null,
    recipeLineCount: row.recipe_line_count ?? 0,
    cost: row.cost ?? null,
    price: row.price ?? null,
    needsReview: row.needs_review,
    linkApprovedAt: row.link_approved_at ?? null,
    soldLines90d: Number(row.sold_lines_90d ?? 0),
    soldEur90d: Number(row.sold_eur_90d ?? 0),
    liveInCatalog: row.live_in_catalog === true,
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
 * Auditoría externa (Bloque C): foto de portada por escandallo, en lote, para
 * listas (p.ej. KitchenRecipesPage). CatalogFichaPage ya prioriza
 * `item.photoUrl` (la del producto de carta, pública, sin firmar) sobre
 * `recipe.kitchenPhotoUrl` (interna, bucket privado, requiere getDishPhotoUrl)
 * — ver headerPhotoUrl en CatalogFichaPage.tsx. Un escandallo se ve en varios
 * platos de carta (marca/canal); nos quedamos con la primera foto no nula que
 * aparezca, misma ambigüedad que ya acepta el selector de ancla de la ficha.
 */
export async function listMenuItemPhotosForRecipes(
  recipeItemIds: string[],
): Promise<Record<string, string>> {
  requireSupabase()
  if (recipeItemIds.length === 0) return {}
  const { data, error } = await supabase!
    .from('menu_item')
    .select('recipe_item_id, photo_url')
    .in('recipe_item_id', recipeItemIds)
    .is('archived_at', null)
    .not('photo_url', 'is', null)
  if (error) throw new Error(`Error listando fotos de carta: ${error.message}`)
  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row.recipe_item_id && row.photo_url && !map[row.recipe_item_id]) {
      map[row.recipe_item_id] = row.photo_url
    }
  }
  return map
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
