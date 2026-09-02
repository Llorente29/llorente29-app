// src/modules/personal/home/enCocinaAhora.ts
//
// Quién está dentro AHORA, por local. Para la tarjeta «En cocina ahora».
//
// ── SE PREGUNTA UNA VEZ POR EMPLEADO, Y ES A PROPÓSITO ─────────────────────
// El criterio de «estar dentro» vive en `employee_clock_status`, una función
// por empleado que resuelve cuatro cosas que la versión evidente se deja:
//
//   1. `pausa_inicio` y `pausa_fin` también son «trabajando»: quien está en su
//      descanso no se ha ido a casa.
//   2. Ordena por `real_datetime`, no por `datetime`, porque 68 fichajes llevan
//      redondeo y el orden oficial no siempre es el real.
//   3. Distingue «fuera» de «sin fichajes».
//   4. NO usa ventana de día para decidir si está dentro — y esto es lo caro.
//      El servicio cierra pasada la medianoche: hoy hay salidas a las 00:15,
//      00:18 y 00:19. Quien entra a las 22:00 y sigue dentro a las 00:30 no
//      tiene NINGÚN fichaje «de hoy», así que una tarjeta con ventana de día
//      diría «0 en cocina» en pleno cierre, con dos personas dentro.
//
// Reescribir eso en el front sería una SEGUNDA definición de «estar dentro».
// Con seis personas en plantilla, seis llamadas en paralelo salen más baratas
// que un criterio duplicado. Hay una propuesta de envoltorio SQL que lo hace en
// una sola ida y vuelta (PROPUESTA_20260902T1450_home_en_cocina_ahora.sql);
// cuando se aplique, aquí solo cambia de dónde vienen los estados.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { rpcSinTipar } from '@/lib/rpcSinTipar'

export interface EstadoEmpleado {
  empleadoId: string
  nombre: string
  locationId: string | null
  localNombre: string
  /** 'trabajando' | 'fuera' | 'sin_fichajes' */
  estado: string
  /** Cuándo empezó la jornada abierta. null si no está dentro. */
  abiertaDesde: string | null
  minutosHoy: number
}

interface RespuestaEstado {
  estado?: string
  abierta_desde?: string | null
  minutos_hoy?: number | string | null
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function leeEnCocinaAhora(
  accountId: string,
  locationId: string | null,
): Promise<EstadoEmpleado[]> {
  // Solo locales ACTIVOS, por lo mismo que en cuadrantes: un local cerrado no
  // puede aparecer con «0 dentro» para siempre.
  let qLoc = sb().from('locations').select('id, name').eq('account_id', accountId).eq('active', true)
  if (locationId) qLoc = qLoc.eq('id', locationId)
  const { data: locs, error: eLoc } = await qLoc
  if (eLoc) throw new Error(`No se han podido leer los locales: ${eLoc.message}`)
  const locales = new Map(((locs ?? []) as { id: string; name: string }[]).map(l => [l.id, l.name]))
  if (locales.size === 0) return []

  const { data: emps, error: eEmp } = await sb()
    .from('employees').select('id, name, location_id')
    .eq('account_id', accountId).eq('active', true)
    .in('location_id', [...locales.keys()])
    .order('name')
  if (eEmp) throw new Error(`No se ha podido leer la plantilla: ${eEmp.message}`)
  const plantilla = (emps ?? []) as { id: string; name: string; location_id: string | null }[]

  const estados = await Promise.all(
    plantilla.map(e =>
      rpcSinTipar<RespuestaEstado>('employee_clock_status', { p_employee_id: e.id })
        // Un empleado cuyo estado falla NO tumba la tarjeta entera, pero
        // tampoco se cuenta como presente: se marca desconocido y se ve.
        .catch(() => ({ estado: 'desconocido' } as RespuestaEstado)),
    ),
  )

  return plantilla.map((e, i) => ({
    empleadoId: e.id,
    nombre: e.name,
    locationId: e.location_id,
    localNombre: (e.location_id && locales.get(e.location_id)) || 'Sin local',
    estado: estados[i]?.estado ?? 'desconocido',
    abiertaDesde: estados[i]?.abierta_desde ?? null,
    minutosHoy: Number(estados[i]?.minutos_hoy ?? 0) || 0,
  }))
}
