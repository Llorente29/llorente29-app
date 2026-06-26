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

/** Destino de una copia de horario: a un (local, marca|null). */
export interface HoursTarget {
  locationId: string
  brandId: string | null
}

// ── Excepciones / festivos ──────────────────────────────────────────────

export interface HoursException {
  id?: string
  exceptionDate: string  // 'YYYY-MM-DD'
  isClosed: boolean
  openTime: string | null   // 'HH:MM' o null
  closeTime: string | null
  note: string | null
}

/** Lista las excepciones de (local, marca|null) desde hoy en adelante. */
export async function getExceptions(locationId: string, brandId: string | null): Promise<HoursException[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const today = new Date().toISOString().slice(0, 10)
  let q = (supabase as any)
    .from('business_hours_exception')
    .select('id, exception_date, is_closed, open_time, close_time, note')
    .eq('location_id', locationId)
    .gte('exception_date', today)
    .order('exception_date', { ascending: true })
  q = brandId === null ? q.is('brand_id', null) : q.eq('brand_id', brandId)
  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer las excepciones: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    exceptionDate: r.exception_date,
    isClosed: r.is_closed,
    openTime: r.open_time ? (r.open_time as string).slice(0, 5) : null,
    closeTime: r.close_time ? (r.close_time as string).slice(0, 5) : null,
    note: r.note ?? null,
  }))
}

/** Crea una excepción. */
export async function addException(
  accountId: string,
  locationId: string,
  brandId: string | null,
  exc: HoursException,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await (supabase as any).from('business_hours_exception').insert({
    account_id: accountId,
    location_id: locationId,
    brand_id: brandId,
    exception_date: exc.exceptionDate,
    is_closed: exc.isClosed,
    open_time: exc.isClosed ? null : exc.openTime,
    close_time: exc.isClosed ? null : exc.closeTime,
    note: exc.note,
  })
  if (error) throw new Error(`No se pudo guardar la excepción: ${error.message}`)
}

/** Da de alta una excepción para un RANGO de fechas (ambas inclusive),
 *  expandiéndola a una fila por día. Si fromDate === toDate, es un solo día. */
export async function addExceptionRange(
  accountId: string,
  locationId: string,
  brandId: string | null,
  fromDate: string,
  toDate: string,
  isClosed: boolean,
  openTime: string | null,
  closeTime: string | null,
  note: string | null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const start = new Date(fromDate + 'T00:00:00')
  const end = new Date((toDate || fromDate) + 'T00:00:00')
  if (end < start) throw new Error('La fecha final es anterior a la inicial.')

  const rows: any[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    rows.push({
      account_id: accountId,
      location_id: locationId,
      brand_id: brandId,
      exception_date: iso,
      is_closed: isClosed,
      open_time: isClosed ? null : openTime,
      close_time: isClosed ? null : closeTime,
      note,
    })
  }
  const isoFrom = start.toISOString().slice(0, 10)
  const isoTo = end.toISOString().slice(0, 10)

  // Borra primero cualquier excepción previa de ese (local, marca) dentro del rango
  let del = (supabase as any)
    .from('business_hours_exception')
    .delete()
    .eq('location_id', locationId)
    .gte('exception_date', isoFrom)
    .lte('exception_date', isoTo)
  del = brandId === null ? del.is('brand_id', null) : del.eq('brand_id', brandId)
  const { error: delErr } = await del
  if (delErr) throw new Error(`No se pudieron actualizar las excepciones: ${delErr.message}`)

  const { error } = await (supabase as any)
    .from('business_hours_exception')
    .insert(rows)
  if (error) throw new Error(`No se pudieron guardar las excepciones: ${error.message}`)
}

/** Borra una excepción por id. */
export async function deleteException(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { error } = await (supabase as any).from('business_hours_exception').delete().eq('id', id)
  if (error) throw new Error(`No se pudo borrar la excepción: ${error.message}`)
}

// ── Cruce con personal (aviso) ──────────────────────────────────────────

export interface StaffingGap {
  weekday: number
  gapStart: string  // 'HH:MM'
  gapEnd: string
}

/** Tramos en que el local abre (horario general) pero no hay personal asignado,
 *  según el cuadrante más reciente. Solo aviso. */
export async function getStaffingGaps(locationId: string): Promise<StaffingGap[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await (supabase as any).rpc('hours_staffing_gaps', { p_location_id: locationId })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    weekday: r.weekday,
    gapStart: (r.gap_start as string).slice(0, 5),
    gapEnd: (r.gap_end as string).slice(0, 5),
  }))
}

/** Copia los tramos de un origen (local, marca|null) a varios destinos.
 *  Cada destino se REEMPLAZA por completo con los tramos del origen.
 *  Sirve para: marca->marcas (mismo local), general->otros locales,
 *  y la misma marca entre locales. */
export async function copyHoursTo(
  accountId: string,
  fromLocationId: string,
  fromBrandId: string | null,
  targets: HoursTarget[],
): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  const source = await getHours(fromLocationId, fromBrandId)
  for (const t of targets) {
    // No se copia sobre sí mismo
    if (t.locationId === fromLocationId && t.brandId === fromBrandId) continue
    await replaceHours(accountId, t.locationId, t.brandId, source)
  }
}
