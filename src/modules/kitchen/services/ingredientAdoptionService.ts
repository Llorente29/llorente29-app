// src/modules/kitchen/services/ingredientAdoptionService.ts
//
// ADOPCIÓN AL VUELO (T1b): materializa un ingrediente del MASTER global
// (ingredient_template) en la cuenta del cliente como un recipe_item propio,
// que a partir de ahí es suyo (editable, con su coste/proveedor).
//
// Reglas (decisión Julio 07/06):
//   · "El master propone, el humano decide": lo adoptado entra con
//     needs_review=true (el cocinero confirma). Nada se da por bueno solo por
//     venir del master.
//   · ANTI-DUPLICADO (doble red): antes de crear, si la cuenta YA tiene un
//     recipe_item con ese template_code, se devuelve el existente en vez de
//     crear otro. (La red visual del buscador es la primera; esta es la de
//     datos, por si el usuario la ignora.)
//   · Unidad base: DETERMINISTA, no IA. El template trae la DIMENSIÓN
//     (weight|volume|unit); se elige la unidad is_base de esa dimensión
//     (g | ml | ud). El cocinero la cambia en el detalle si su caso es raro.
//   · Trazabilidad: el recipe_item guarda template_code + template_version
//     (de qué master salió y con qué versión) para la futura propagación con
//     consentimiento (T1c), SIN pisar nunca lo que el cocinero toque.
//
// NO escribe en el master (solo lee). Sigue el patrón canónico de services
// (requireSupabase, errores con throw new Error).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  getTemplateById,
  getTemplateAllergens,
  type IngredientTemplate,
} from './ingredientTemplateService'
import { createRecipeItem, getRecipeItemById } from './recipeItemService'
import type { RecipeItem } from '../../../types/kitchen'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface AdoptResult {
  item: RecipeItem
  // true si ya existía en la cuenta (no se creó nada: anti-duplicado).
  alreadyExisted: boolean
}

/**
 * Resuelve la unidad base (is_base) de una dimensión. Determinista: g/ml/ud.
 * Si por lo que sea no hay is_base para esa dimensión, devuelve null y quien
 * llame decide (la UI ya tiene el selector de unidad como respaldo).
 */
async function resolveBaseUnitId(
  dimension: 'weight' | 'volume' | 'unit',
): Promise<string | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_unit')
    .select('id')
    .eq('dimension', dimension)
    .eq('is_base', true)
    .limit(1)
    .maybeSingle()
  if (error)
    throw new Error(
      `Error resolviendo la unidad base de ${dimension}: ${error.message}`,
    )
  return data?.id ?? null
}

/**
 * ¿La cuenta ya tiene un recipe_item adoptado de este template? (anti-duplicado)
 * Devuelve el id si existe, null si no.
 */
async function findAdoptedByTemplateCode(
  accountId: string,
  templateCode: string,
): Promise<string | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .select('id')
    .eq('account_id', accountId)
    .eq('template_code', templateCode)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()
  if (error)
    throw new Error(
      `Error comprobando adopción previa de ${templateCode}: ${error.message}`,
    )
  return data?.id ?? null
}

export interface AdoptOptions {
  templateId: string
  accountId: string
  actorId?: string | null
  actorName?: string | null
  // Unidad base a usar. Si no se pasa, se resuelve por la dimensión del
  // template (is_base). Permite a la UI forzar otra si el usuario la cambió.
  baseUnitId?: string | null
}

/**
 * Materializa un ingrediente del master en la cuenta. Idempotente respecto al
 * template: si ya estaba adoptado, devuelve el existente (alreadyExisted=true).
 */
export async function adoptFromTemplate(
  opts: AdoptOptions,
): Promise<AdoptResult> {
  requireSupabase()

  const template: IngredientTemplate | null = await getTemplateById(
    opts.templateId,
  )
  if (!template) {
    throw new Error(`Plantilla de ingrediente ${opts.templateId} no encontrada.`)
  }

  // ── Anti-duplicado (red de datos) ──
  const existingId = await findAdoptedByTemplateCode(opts.accountId, template.code)
  if (existingId) {
    const existing = await getRecipeItemById(existingId)
    if (existing) return { item: existing, alreadyExisted: true }
  }

  // ── Unidad base determinista por dimensión ──
  let baseUnitId = opts.baseUnitId ?? null
  if (!baseUnitId) {
    const dim = (template.defaultBaseDimension ?? 'weight') as
      | 'weight'
      | 'volume'
      | 'unit'
    baseUnitId = await resolveBaseUnitId(dim)
  }
  if (!baseUnitId) {
    throw new Error(
      `No se pudo resolver la unidad base para "${template.nameEs}". Elige una unidad manualmente.`,
    )
  }

  // Materializar como recipe_item propio de la cuenta.
  // source='template_global' marca que vino del master (traza el origen sin
  // colisionar con manual/ocr_invoice/ai_recipe/import). El CHECK de la BBDD ya
  // lo admite (migración 20260607T2200). Se castea vía string porque el tipo
  // RecipeItem['source'] es una unión cerrada (mismo patrón que rowToRecipeItem
  // al leer); el valor es válido a nivel de datos, que es el guard real.
  const TEMPLATE_SOURCE: string = 'template_global'
  const created = await createRecipeItem({
    accountId: opts.accountId,
    type: 'raw',
    name: template.nameEs,
    altName: template.nameEn ?? null,
    baseUnitId,
    costStrategy: 'fixed', // sin precio aún; se fija al añadir proveedor
    fixedCost: null,
    conservationType:
      (template.conservationType as RecipeItem['conservationType']) ?? null,
    source: TEMPLATE_SOURCE as RecipeItem['source'],
    needsReview: true,
    createdBy: opts.actorId ?? null,
    createdByName: opts.actorName ?? null,
  })

  // ── Enganches de versión + defaults del template (que el insert no admite) ──
  // createRecipeItem no mapea template_code/template_version ni
  // defaultWastePct/shelfLifeDays (no son parte del insert estándar). Los
  // escribimos en un update acotado inmediatamente después del alta.
  {
    const { error } = await supabase!
      .from('recipe_item')
      .update({
        template_code: template.code,
        template_version: template.version,
        default_waste_pct: template.defaultWastePct ?? null,
        shelf_life_days: template.shelfLifeDays ?? null,
      })
      .eq('id', created.id)
    if (error) {
      // No es fatal: el ingrediente ya existe y es usable; solo perdería la
      // traza de versión / defaults. Lo registramos para saneamiento.
      console.error(
        `adoptFromTemplate: no se pudieron escribir enganches/defaults en ${created.id}`,
        error,
      )
    }
  }

  // ── Copiar alérgenos del template como propuesta (needs_review del item) ──
  // Mismo vocabulario (allergen_code/state) que el satélite del master, así que
  // se copian tal cual a recipe_item_allergen. state='contains' del template.
  try {
    const tplAllergens = await getTemplateAllergens(template.id)
    if (tplAllergens.length > 0) {
      const rows = tplAllergens.map((a) => ({
        recipe_item_id: created.id,
        allergen_code: a.allergenCode,
        state: a.state,
        source: 'template_global',
      }))
      const { error } = await supabase!
        .from('recipe_item_allergen')
        .upsert(rows, { onConflict: 'recipe_item_id,allergen_code' })
      if (error) {
        console.error(
          `adoptFromTemplate: no se pudieron copiar los alérgenos a ${created.id}`,
          error,
        )
      }
    }
  } catch (e) {
    // Fail-safe: si la copia de alérgenos falla, el ingrediente sigue siendo
    // válido (entró con needs_review; el cocinero los añadirá en revisión).
    console.error(
      `adoptFromTemplate: error copiando alérgenos para ${created.id}`,
      e,
    )
  }

  // Releer para devolver el item con los enganches ya escritos.
  const fresh = await getRecipeItemById(created.id)
  return { item: fresh ?? created, alreadyExisted: false }
}
