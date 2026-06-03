// src/modules/kitchen/services/vatService.ts
//
// Servicio de IVA (categorías fiscales): listar las categorías disponibles,
// leer el tipo vigente, y asignar/confirmar la categoría de un artículo.
// Apoya la UI de revisión del IVA en la ficha del ingrediente: el cocinero ve
// el IVA propuesto (por su familia) y lo CONFIRMA o lo CAMBIA (reclasifica los
// mixtos como el aceite de oliva). Patrón "IA propone → humano confirma".

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export interface VatCategory {
  id: string
  code: string
  name: string
  description: string | null
  // Tipo vigente HOY (para mostrarlo junto al nombre: "Alimento básico · 4%").
  currentRate: number | null
  currentSurcharge: number | null
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}
type Row = Record<string, unknown>
function from(table: string) {
  return (supabase! as unknown as { from: (t: string) => any }).from(table)
}
function rpc(fn: string, args: Record<string, unknown>) {
  return (supabase! as unknown as { rpc: (fn: string, a: Record<string, unknown>) => any }).rpc(fn, args)
}

/** Lista las categorías fiscales activas, cada una con su tipo vigente hoy. */
export async function listVatCategories(): Promise<VatCategory[]> {
  requireSupabase()
  const { data, error } = await from('vat_category')
    .select('id, code, name, description')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw new Error(`Error cargando categorías de IVA: ${error.message}`)

  const cats = (data as Row[]) ?? []
  const today = new Date().toISOString().slice(0, 10)

  // Resolver el tipo vigente de cada categoría (en paralelo).
  const withRates = await Promise.all(cats.map(async (c) => {
    let rate: number | null = null
    let surcharge: number | null = null
    const { data: vr } = await rpc('vat_rate_for', { p_category_id: c.id as string, p_date: today })
    if (Array.isArray(vr) && vr.length > 0) {
      rate = Number(vr[0].rate)
      surcharge = vr[0].equivalence_surcharge !== undefined ? Number(vr[0].equivalence_surcharge) : null
    }
    return {
      id: c.id as string,
      code: c.code as string,
      name: c.name as string,
      description: (c.description as string | null) ?? null,
      currentRate: rate,
      currentSurcharge: surcharge,
    }
  }))
  return withRates
}

/** Asigna una categoría fiscal a un artículo. confirmed=true marca confirmado por humano. */
export async function setItemVatCategory(
  recipeItemId: string,
  vatCategoryId: string,
  confirmed: boolean,
): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item')
    .update({
      vat_category_id: vatCategoryId,
      vat_category_source: confirmed ? 'confirmed' : 'proposed',
    } as any)
    .eq('id', recipeItemId)
  if (error) throw new Error(`Error guardando el IVA: ${error.message}`)
}

/** Confirma la categoría ya propuesta de un artículo (proposed → confirmed), sin cambiarla. */
export async function confirmItemVatCategory(recipeItemId: string): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item')
    .update({ vat_category_source: 'confirmed' } as any)
    .eq('id', recipeItemId)
  if (error) throw new Error(`Error confirmando el IVA: ${error.message}`)
}
