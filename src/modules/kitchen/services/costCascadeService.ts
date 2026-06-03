// src/modules/kitchen/services/costCascadeService.ts
//
// Cascada de recálculo de coste (eje A híbrido, lado app).
// El coste de UN ingrediente lo mantiene el trigger en BBDD. Pero los PLATOS
// y sub-recetas que lo usan no se refrescan solos (lo decidimos así: nada de
// triggers recursivos en cascada). Esta es la pieza que los refresca, orquestada
// desde la app: pide los ancestros (kitchen_ancestors_of) y recalcula cada uno
// en orden hoja→raíz con recomputeRecipeItem (que ya valida al céntimo).
//
// Reutilizable: hoy la llama el flujo de compras; mañana el foto→IA, el import
// y la recepción. UNA sola cascada para todo el sistema → ningún camino la
// reimplementa ni se la salta (misma filosofía que el trigger del ingrediente).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { recomputeRecipeItem } from './recipeItemService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface AncestorRef {
  ancestorId: string
  depth: number
}

// Ancestros (platos/sub-recetas que usan este ingrediente, transitivos),
// ya ordenados por profundidad DESC desde la función SQL (lo más profundo
// primero). Lectura pura.
export async function getAncestorsOf(itemId: string): Promise<AncestorRef[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_ancestors_of', {
    p_item_id: itemId,
  })
  if (error) {
    throw new Error(`Error obteniendo ancestros del item ${itemId}: ${error.message}`)
  }
  return (data ?? []).map((r) => ({ ancestorId: r.ancestor_id, depth: r.depth }))
}

// Plato/sub-receta efectivamente recalculado, con su nombre (para mostrarlo
// al usuario: "estos son los platos que se movieron"). No es solo el conteo.
export interface RecomputedAncestor {
  id: string
  name: string
}

export interface CascadeResult {
  itemId: string
  ancestorsRecomputed: number
  // Lista de los ancestros recalculados con éxito, con nombre. Misma longitud
  // que ancestorsRecomputed. Permite a la UI mostrar QUÉ platos se movieron,
  // no solo cuántos. Si la resolución de nombres falla, queda [] (no rompe el
  // conteo, que es la verdad mínima).
  ancestors: RecomputedAncestor[]
  failures: { id: string; error: string }[]
}

// Resuelve nombres de recipe_item por IDs (una sola consulta). Devuelve un mapa
// id→name. Tolerante: si falla, devuelve mapa vacío (la UI mostrará el conteo
// igualmente). No aplica guard extra: RLS de recipe_item ya limita a la cuenta.
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  try {
    const { data, error } = await supabase!
      .from('recipe_item')
      .select('id, name')
      .in('id', ids)
    if (error) {
      console.error('costCascadeService: resolución de nombres falló', error.message)
      return map
    }
    for (const r of data ?? []) {
      map.set(r.id as string, (r.name as string) ?? '')
    }
  } catch (e) {
    console.error('costCascadeService: resolución de nombres lanzó', e)
  }
  return map
}

// Recalcula los ANCESTROS de un ingrediente cuyo coste acaba de cambiar.
// Orden hoja→raíz (el que devuelve la función SQL): cuando recalcula un plato,
// sus sub-recetas ya están al día. Patrón fail-safe por ítem: si uno falla,
// se registra y se sigue (no se aborta la cascada entera por un plato roto),
// coherente con tryRecompute/tryRecomputeParent del resto de services.
//
// NOTA: el coste del PROPIO ingrediente (itemId) ya lo recalculó el trigger
// en BBDD al cambiar su precio. Aquí NO se recalcula el ingrediente otra vez;
// solo se propaga hacia arriba. Si quien llama no pasó por el trigger (un
// cambio que no sea de article_supplier), use recomputeItemAndAncestors.
export async function cascadeFromItem(itemId: string): Promise<CascadeResult> {
  requireSupabase()
  const ancestors = await getAncestorsOf(itemId)
  const failures: { id: string; error: string }[] = []
  const okIds: string[] = []
  for (const a of ancestors) {
    try {
      await recomputeRecipeItem(a.ancestorId)
      okIds.push(a.ancestorId)
    } catch (e) {
      failures.push({ id: a.ancestorId, error: e instanceof Error ? e.message : String(e) })
      console.error(`costCascadeService: recálculo del ancestro ${a.ancestorId} falló`, e)
    }
  }
  // Resolvemos nombres SOLO de los recalculados con éxito, en orden hoja→raíz
  // (el de getAncestorsOf). Una consulta; tolerante a fallo.
  const names = await resolveNames(okIds)
  const recomputed: RecomputedAncestor[] = okIds.map((id) => ({
    id,
    name: names.get(id) ?? 'Plato sin nombre',
  }))
  return {
    itemId,
    ancestorsRecomputed: recomputed.length,
    ancestors: recomputed,
    failures,
  }
}

// Variante que recalcula PRIMERO el propio ítem y luego sus ancestros.
// Úsala cuando el cambio de coste NO vino por el trigger de article_supplier
// (p.ej. el foto→IA fija un coste, un import, o una edición manual de fixed_cost).
export async function recomputeItemAndAncestors(itemId: string): Promise<CascadeResult> {
  requireSupabase()
  try {
    await recomputeRecipeItem(itemId)
  } catch (e) {
    console.error(`costCascadeService: recálculo del propio item ${itemId} falló`, e)
  }
  return cascadeFromItem(itemId)
}
