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

// ── LO QUE LA MAQUETA PIDE ADEMÁS DE «QUIÉN ESTÁ DENTRO» ───────────────────
// El estado vacío da la PRIMERA ENTRADA PREVISTA, que sale del cuadrante, y la
// fila de contexto dice QUIÉN CERRÓ AYER y a qué hora.
//
// La forma de `schedules.cells` es `{ turnoId: { díaIndex: [empleadoId…] } }`
// — el turno fuera y los empleados dentro, no al revés. Comprobado el 02/09
// después de leerlo del revés y estar a punto de dar una alarma falsa por 226
// referencias «rotas» que no lo estaban: eran empleados donde yo buscaba
// turnos. El día va 0=lunes … 6=domingo, como `DayOfWeek`.

export interface ContextoDelDia {
  /** «12:30», del turno más temprano con alguien asignado hoy. null si no hay. */
  primeraEntradaPrevista: string | null
  /** Quién cerró el último día con salidas, y a qué hora. */
  ayerCerro: { nombre: string; hora: string } | null
}

interface CeldasCuadrante { [turnoId: string]: { [dia: string]: string[] } }

/** El turno más temprano CON ALGUIEN ASIGNADO ese día. */
export function primeraEntradaPrevista(
  cells: unknown,
  turnos: { id: string; start_time: string }[],
  diaIndex: number,
): string | null {
  if (!cells || typeof cells !== 'object') return null
  const c = cells as CeldasCuadrante
  const horas: string[] = []
  for (const [turnoId, porDia] of Object.entries(c)) {
    const asignados = porDia?.[String(diaIndex)]
    // Un turno SIN nadie asignado no es una entrada prevista: es una casilla
    // vacía. Contarlo diría que alguien entra a las 12:30 cuando no entra nadie.
    if (!Array.isArray(asignados) || asignados.length === 0) continue
    const t = turnos.find(x => x.id === turnoId)
    if (t?.start_time) horas.push(t.start_time.slice(0, 5))
  }
  return horas.length === 0 ? null : horas.sort()[0]
}

export interface Ambito {
  locales: Map<string, string>
  plantilla: { id: string; name: string; location_id: string | null }[]
}

/**
 * Los locales ABIERTOS del ámbito y su plantilla activa.
 *
 * Se extrae porque lo necesitan las dos lecturas de la tarjeta, y porque sus
 * ids acotan las consultas siguientes MEJOR que un filtro por cuenta: pedir
 * los fichajes «de estos seis empleados» es más estrecho que «de esta cuenta»,
 * y de paso esquiva que `clock_entries` y `shift_templates` no tengan
 * `account_id` en el fichero de tipos (frente 2) sin parchearlo más.
 */
export async function leeAmbito(accountId: string, locationId: string | null): Promise<Ambito> {
  // Solo locales ACTIVOS, por lo mismo que en cuadrantes: un local cerrado no
  // puede aparecer con «0 dentro» para siempre.
  let qLoc = sb().from('locations').select('id, name').eq('account_id', accountId).eq('active', true)
  if (locationId) qLoc = qLoc.eq('id', locationId)
  const { data: locs, error: eLoc } = await qLoc
  if (eLoc) throw new Error(`No se han podido leer los locales: ${eLoc.message}`)
  const locales = new Map(((locs ?? []) as { id: string; name: string }[]).map(l => [l.id, l.name]))
  if (locales.size === 0) return { locales, plantilla: [] }

  const { data: emps, error: eEmp } = await sb()
    .from('employees').select('id, name, location_id')
    .eq('account_id', accountId).eq('active', true)
    .in('location_id', [...locales.keys()])
    .order('name')
  if (eEmp) throw new Error(`No se ha podido leer la plantilla: ${eEmp.message}`)
  return { locales, plantilla: (emps ?? []) as Ambito['plantilla'] }
}

export async function leeEnCocinaAhora(ambito: Ambito): Promise<EstadoEmpleado[]> {
  const { locales, plantilla } = ambito
  if (plantilla.length === 0) return []

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

/**
 * El contexto que pide la maqueta: primera entrada prevista de hoy y quién
 * cerró ayer.
 *
 * «Ayer» es el último día con salidas, no literalmente el día anterior: si el
 * local libró el lunes, lo útil es quién cerró el domingo, no un hueco.
 */
export async function leeContextoDelDia(
  ambito: Ambito,
  lunes: string,
  diaIndex: number,
  inicioDeHoy: Date,
): Promise<ContextoDelDia> {
  const locIds = [...ambito.locales.keys()]
  const empIds = ambito.plantilla.map(e => e.id)
  if (locIds.length === 0) return { primeraEntradaPrevista: null, ayerCerro: null }

  const qSch = sb().from('schedules').select('location_id, cells')
    .eq('week_start', lunes).in('location_id', locIds)

  const qTur = sb().from('shift_templates').select('id, start_time, location_id')
    .in('location_id', locIds)

  // La última salida ANTERIOR a hoy, y SOLO de esta plantilla. Se mira un mes
  // atrás: de sobra, y acotado para no traerse el histórico en cada carga.
  const haceUnMes = new Date(inicioDeHoy.getTime() - 31 * 86_400_000).toISOString()
  const qSal = empIds.length === 0
    ? Promise.resolve({ data: [], error: null })
    : sb().from('clock_entries')
        .select('employee_id, datetime')
        .in('employee_id', empIds)
        .eq('type', 'salida').eq('voided', false)
        .gte('datetime', haceUnMes).lt('datetime', inicioDeHoy.toISOString())
        .order('datetime', { ascending: false }).limit(1)

  const [sch, tur, sal] = await Promise.all([qSch, qTur, qSal])
  if (sch.error) throw new Error(`No se ha podido leer el cuadrante: ${sch.error.message}`)
  if (tur.error) throw new Error(`No se han podido leer los turnos: ${tur.error.message}`)
  if (sal.error) throw new Error(`No se han podido leer los fichajes: ${sal.error.message}`)

  const turnos = (tur.data ?? []) as { id: string; start_time: string }[]
  const horas = ((sch.data ?? []) as { cells: unknown }[])
    .map(s => primeraEntradaPrevista(s.cells, turnos, diaIndex))
    .filter((h): h is string => h != null)
    .sort()

  let ayerCerro: ContextoDelDia['ayerCerro'] = null
  const ultima = ((sal.data ?? []) as { employee_id: string; datetime: string }[])[0]
  if (ultima) {
    const completo = ambito.plantilla.find(e => e.id === ultima.employee_id)?.name ?? ''
    const nombre = completo.trim().split(/\s+/)[0]
    ayerCerro = {
      nombre: nombre ? nombre.charAt(0).toLocaleUpperCase('es') + nombre.slice(1).toLocaleLowerCase('es') : 'Alguien',
      // La hora, en la del NEGOCIO: una salida a las 00:15 de Madrid está
      // guardada como 22:15 UTC del día anterior.
      hora: new Date(ultima.datetime).toLocaleTimeString('es-ES',
        { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }),
    }
  }

  return { primeraEntradaPrevista: horas[0] ?? null, ayerCerro }
}
