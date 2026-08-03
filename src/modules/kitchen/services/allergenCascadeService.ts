// src/modules/kitchen/services/allergenCascadeService.ts
//
// Cascada de recálculo de alérgenos heredados (Capa 2). Cuando cambia la
// COMPOSICIÓN de un escandallo (añadir/quitar línea, reemplazo por import, o
// un ingrediente cambia su propia declaración de alérgenos), el recipe_item
// afectado —y todos los platos/sub-recetas que lo usan, transitivamente—
// tienen que volver a heredar.
//
// A diferencia de costCascadeService (que reutiliza el computed_cost YA
// CACHEADO del hijo, hoja→raíz), aquí cada ancestro se recalcula con una
// EXPLOSIÓN COMPLETA del árbol (compute_recipe_item_allergens, vía la RPC
// recompute_recipe_item_allergens) — correcto por construcción, no depende
// del orden ni de un valor cacheado de un hermano. Decisión de Julio,
// confirmada tras RECON del bug latente de orden en kitchen_ancestors_of.
//
// Por qué SÍ se reordena aquí en vez de confiar en kitchen_ancestors_of:
// la función SQL devuelve profundidad DESC (el ancestro más lejano primero)
// — para coste (cacheado) eso es un bug latente nunca disparado en
// producción (RECON: 0 anidamiento real hoy). Para alérgenos el cómputo es
// fresco en cada pasada, así que el orden normalmente no importa, EXCEPTO en
// un caso: si un ancestro intermedio es una sub-receta 'stockable',
// explode_recipe_to_raws la trata como hoja (no baja a sus ingredientes) y
// compute_recipe_item_allergens lee su fila de recipe_item_allergen
// directamente — si esa sub-receta intermedia aún no se ha recalculado en
// esta misma cascada, un ancestro más lejano leería un valor viejo. Por eso
// se reordena a profundidad ASC (más cercano primero) antes de recalcular:
// defensivo, coste cero, no depende de arreglar kitchen_ancestors_of (deuda
// ajena a este frente, ver nota en el plan de Capa 2).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { getAncestorsOf } from './costCascadeService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// RPC pública (con guard). No-op silencioso en BBDD si el item no es
// 'dish'/'recipe' (un raw/tool/packaging declara, no hereda) — quien llama
// no necesita comprobar el tipo antes de invocarla.
export async function recomputeRecipeItemAllergens(itemId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('recompute_recipe_item_allergens', {
    p_recipe_item_id: itemId,
  })
  if (error) {
    throw new Error(`Error recalculando alérgenos heredados de ${itemId}: ${error.message}`)
  }
}

export interface AllergenCascadeResult {
  itemId: string
  ancestorsRecomputed: number
  failures: { id: string; error: string }[]
}

// Recalcula el propio ítem y, en cascada, todos sus ancestros transitivos
// (más cercano primero — ver nota de cabecera). Fail-safe por ítem: si uno
// falla, se registra y se sigue (misma filosofía que costCascadeService).
// Nunca lanza: quien llama decide si el fallo bloquea la UI (hoy, en
// ninguno de los puntos de disparo lo hace — best-effort).
export async function cascadeAllergensFromItem(itemId: string): Promise<AllergenCascadeResult> {
  requireSupabase()
  const failures: { id: string; error: string }[] = []

  try {
    await recomputeRecipeItemAllergens(itemId)
  } catch (e) {
    failures.push({ id: itemId, error: e instanceof Error ? e.message : String(e) })
    console.error(`allergenCascadeService: recálculo del propio item ${itemId} falló`, e)
  }

  const ancestors = await getAncestorsOf(itemId)
  const ordered = [...ancestors].sort((a, b) => a.depth - b.depth)

  let ok = 0
  for (const a of ordered) {
    try {
      await recomputeRecipeItemAllergens(a.ancestorId)
      ok++
    } catch (e) {
      failures.push({ id: a.ancestorId, error: e instanceof Error ? e.message : String(e) })
      console.error(`allergenCascadeService: recálculo del ancestro ${a.ancestorId} falló`, e)
    }
  }

  return { itemId, ancestorsRecomputed: ok, failures }
}
