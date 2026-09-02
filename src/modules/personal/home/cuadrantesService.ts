// src/modules/personal/home/cuadrantesService.ts
//
// Lo que la tarjeta «Cuadrantes» necesita leer. Cuatro consultas pequeñas y
// acotadas; el cruce se hace en `estadoCuadrantes.ts`, que es puro y probado.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { LocalActivo, FilaSchedule, Empleado, Ausencia } from './estadoCuadrantes'

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export interface DatosCuadrantes {
  locales: LocalActivo[]
  schedules: FilaSchedule[]
  empleados: Empleado[]
  ausencias: Ausencia[]
}

export async function leeCuadrantes(
  accountId: string,
  locationId: string | null,
  desdeLunes: string,
  hoy: string,
): Promise<DatosCuadrantes> {
  // SOLO LOCALES ACTIVOS. Plaza Castilla está cerrado y arrastra 14 borradores:
  // sin este filtro, la tarjeta nace con una alarma que nunca se puede apagar.
  let qLoc = sb().from('locations').select('id, name').eq('account_id', accountId).eq('active', true)
  if (locationId) qLoc = qLoc.eq('id', locationId)
  const { data: locs, error: eLoc } = await qLoc.order('name')
  if (eLoc) throw new Error(`No se han podido leer los locales: ${eLoc.message}`)
  const locales: LocalActivo[] = ((locs ?? []) as { id: string; name: string }[])
    .map(l => ({ id: l.id, nombre: l.name }))
  const ids = locales.map(l => l.id)
  if (ids.length === 0) return { locales: [], schedules: [], empleados: [], ausencias: [] }

  const [sch, emp, vac] = await Promise.all([
    sb().from('schedules').select('location_id, week_start, status')
      .eq('account_id', accountId).in('location_id', ids).gte('week_start', desdeLunes),
    sb().from('employees').select('id, name, location_id')
      .eq('account_id', accountId).eq('active', true).in('location_id', ids),
    // Sin filtrar por estado aquí: el cruce necesita ver las rechazadas para
    // NO contarlas, y que eso se vea en el código que decide, no en la consulta.
    sb().from('vacations').select('employee_id, status, start_date, end_date, type')
      .eq('account_id', accountId).gte('end_date', hoy),
  ])
  if (sch.error) throw new Error(`No se han podido leer los cuadrantes: ${sch.error.message}`)
  if (emp.error) throw new Error(`No se ha podido leer la plantilla: ${emp.error.message}`)
  if (vac.error) throw new Error(`No se han podido leer las ausencias: ${vac.error.message}`)

  return {
    locales,
    schedules: ((sch.data ?? []) as { location_id: string; week_start: string; status: string }[])
      .map(s => ({ locationId: s.location_id, weekStart: s.week_start, status: s.status })),
    empleados: ((emp.data ?? []) as { id: string; name: string; location_id: string | null }[])
      .map(e => ({ id: e.id, nombre: e.name, locationId: e.location_id })),
    ausencias: ((vac.data ?? []) as {
      employee_id: string; status: string; start_date: string; end_date: string; type: string | null
    }[]).map(v => ({
      empleadoId: v.employee_id, estado: v.status,
      desde: v.start_date, hasta: v.end_date, tipo: v.type,
    })),
  }
}
