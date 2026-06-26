// src/modules/multitenancy/services/businessHoursService.ts
//
// Horario comercial por (local, marca). Transversal: lo consumen el Shop, la
// auto-aceptacion de HubRise y la alarma de disponibilidad via la funcion
// canonica is_brand_open. Esta capa solo gestiona la EDICION de los tramos.
//
// Modelo: cada fila de business_hours es un tramo (weekday, open, close).
// Varias filas por dia = horario partido. brand_id NULL = horario general del
// local (lo heredan las marcas sin horario propio). close < open = cruza
// medianoche (cierra de madrugada).

import { supabase } from '@/lib/supabase'

export interface HoursSlot {
  id?: string
  weekday: number      // 0=domingo ... 6=sabado
  openTime: string     // 'HH:MM'
  closeTime: string    // 'HH:MM'
}

/** Lee los tramos de una marca (o del horario general del local si brandId=null). */
export async function getHours(locationId: string, brandId: string | null): Promise<HoursSlot[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  let q = (supabase as any)
    .from('business_hours')
    .select('id, weekday, open_time, close_time')
    .eq('location_id', locationId)
    .order('weekday', { ascending: true })
    .order('open_time', { ascending: true })
  q = brandId === null ? q.is('brand_id', null) : q.eq('brand_id', brandId)
  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los horarios: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    weekday: r.weekday,
    openTime: (r.open_time as string).slice(0, 5),
    closeTime: (r.close_time as string).slice(0, 5),
  }))
}

/** ¿La marca tiene horario propio en este local? (si no, hereda el general). */
export async function hasOwnHours(locationId: string, brandId: string): Promise<boolean> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { count, error } = await (supabase as any)
    .from('business_hours')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('brand_id', brandId)
  if (error) throw new Error(error.message)
  return (count ?? 0) > 0
}

/** Reemplaza TODOS los tramos de (local, marca) por los dados. Operacion atomica
 *  desde el punto de vista del usuario: borra los previos e inserta los nuevos. */
export async function replaceHours(
  accountId: string,
  locationId: string,
  brandId: string | null,
  slots: HoursSlot[],
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Borra los actuales de este (local, marca)
  let del = (supabase as any).from('business_hours').delete().eq('location_id', locationId)
  del = brandId === null ? del.is('brand_id', null) : del.eq('brand_id', brandId)
  const { error: delErr } = await del
  if (delErr) throw new Error(`No se pudieron actualizar los horarios: ${delErr.message}`)

  if (slots.length === 0) return

  const rows = slots.map(s => ({
    account_id: accountId,
    location_id: locationId,
    brand_id: brandId,
    weekday: s.weekday,
    open_time: s.openTime,
    close_time: s.closeTime,
  }))
  const { error: insErr } = await (supabase as any).from('business_hours').insert(rows)
  if (insErr) throw new Error(`No se pudieron guardar los horarios: ${insErr.message}`)
}

/** Pone el horario de la marca igual al general del local (borra el propio). */
export async function clearOwnHours(locationId: string, brandId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await (supabase as any)
    .from('business_hours').delete()
    .eq('location_id', locationId).eq('brand_id', brandId)
  if (error) throw new Error(`No se pudo limpiar el horario propio: ${error.message}`)
}
