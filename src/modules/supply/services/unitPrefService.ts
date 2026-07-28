// src/modules/supply/services/unitPrefService.ts
//
// Preferencia de unidad de conteo por usuario y artículo.
// "María cuenta el cheddar en paquetes" — se recuerda para la próxima vez.
// purchase_format_id NULL = prefiere la unidad base (g/ml/ud).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// Devuelve la preferencia: 'base' | purchase_format_id | null (sin preferencia).
export async function getUnitPref(userId: string, recipeItemId: string): Promise<string | null> {
  requireSupabase()
  try {
    const { data, error } = await from('user_item_unit_pref')
      .select('purchase_format_id')
      .eq('user_id', userId)
      .eq('recipe_item_id', recipeItemId)
      .maybeSingle()
    if (error) return null
    if (!data) return null
    const fid = (data as Record<string, unknown>).purchase_format_id as string | null
    return fid ?? 'base'
  } catch {
    return null
  }
}

export async function setUnitPref(userId: string, recipeItemId: string, purchaseFormatId: string | null): Promise<void> {
  requireSupabase()
  const { error } = await from('user_item_unit_pref')
    .upsert({
      user_id: userId,
      recipe_item_id: recipeItemId,
      purchase_format_id: purchaseFormatId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,recipe_item_id' })
  if (error) throw new Error(`No se pudo guardar la preferencia: ${error.message}`)
}
