// src/modules/kitchen/services/menuAllergenBulkService.ts
//
// Alérgenos de TODOS los platos de una carta, en DOS consultas.
//
// Ya existía `listItemAllergens(itemId)`, pero es por producto: en una carta de
// 100 platos serían 100 peticiones, justo el N+1 que el encargo prohíbe. Esto
// no sustituye a aquel —la ficha necesita el detalle con su origen y su motivo
// manual—, solo resuelve el caso "píntamelos todos en la lista".
//
// Solo se devuelven los alérgenos PRESENTES. `state` distingue presente de
// trazas y de ausente; en una fila de carta pintar trazas junto a presentes
// sería alarmismo, y ocultar presentes sería lo contrario. Se pinta lo que hay.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado')
}

export interface AllergenChip {
  code: string
  name: string
  icon: string | null
}

/** recipeItemId -> alérgenos presentes, ya ordenados. */
export type AllergensByRecipe = Map<string, AllergenChip[]>

export async function listAllergensForRecipes(
  recipeItemIds: string[],
): Promise<AllergensByRecipe> {
  requireSupabase()
  const out: AllergensByRecipe = new Map()
  if (recipeItemIds.length === 0) return out

  const [{ data: links, error: lErr }, { data: cat, error: cErr }] = await Promise.all([
    supabase!
      .from('recipe_item_allergen')
      .select('recipe_item_id, allergen_code, state')
      .in('recipe_item_id', recipeItemIds),
    supabase!.from('allergen').select('code, name_es, icon, position'),
  ])
  if (lErr) throw new Error(`Error leyendo alérgenos: ${lErr.message}`)
  if (cErr) throw new Error(`Error leyendo el catálogo de alérgenos: ${cErr.message}`)

  const meta = new Map<string, { name: string; icon: string | null; position: number }>()
  for (const a of cat ?? []) {
    meta.set(a.code as string, {
      name: (a.name_es as string) ?? (a.code as string),
      icon: (a.icon as string) ?? null,
      position: Number(a.position ?? 0),
    })
  }

  for (const l of links ?? []) {
    if (l.state !== 'present') continue
    const rid = l.recipe_item_id as string
    const m = meta.get(l.allergen_code as string)
    const arr = out.get(rid) ?? []
    arr.push({
      code: l.allergen_code as string,
      name: m?.name ?? (l.allergen_code as string),
      icon: m?.icon ?? null,
    })
    out.set(rid, arr)
  }
  for (const [rid, arr] of out) {
    out.set(rid, arr.sort((a, b) =>
      (meta.get(a.code)?.position ?? 0) - (meta.get(b.code)?.position ?? 0)))
  }
  return out
}
