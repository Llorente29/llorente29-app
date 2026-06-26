// src/modules/multitenancy/services/cuisineService.ts
//
// Lee el vocabulario curado de tipos de cocina (tabla global shop_cuisine).
// Lo consume el selector de la ficha de marca. Solo lectura.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export interface Cuisine {
  code: string
  label: string
  emoji: string | null
}

export async function listCuisines(): Promise<Cuisine[]> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
  const { data, error } = await supabase
    .from('shop_cuisine')
    .select('code, label, emoji')
    .eq('is_active', true)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error listando cocinas: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    code: r.code as string,
    label: r.label as string,
    emoji: (r.emoji as string) ?? null,
  }))
}
