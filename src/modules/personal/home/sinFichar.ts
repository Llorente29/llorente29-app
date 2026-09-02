// src/modules/personal/home/sinFichar.ts
//
// QUIÉN TENÍA TURNO HOY Y NO HA FICHADO. Las dos mitades ya existían:
//
//   · el turno previsto → `schedules.cells`, la forma `{turnoId: {día: [empleadoId…]}}`
//     que se aprendió al hacer «En cocina ahora» (y que casi cuesta una alarma
//     falsa por leerla del revés).
//   · quién está dentro → `employee_clock_status`, el criterio canónico.
//
// Esto solo las cruza. No define nada nuevo, y por eso es barata.
//
// ── LA REGLA DE «TODAVÍA NO LE TOCA» ───────────────────────────────────────
// Alguien con turno a las 19:45 no está «sin fichar» a las 10 de la mañana:
// está en su casa. Solo cuenta a partir de su hora de entrada, y con un margen
// de cortesía —15 minutos— porque fichar dos minutos tarde no es una ausencia,
// es el metro.
//
// Sin ese margen la tarjeta gritaría todos los días a las 12:30 en punto, y una
// tarjeta que grita todos los días deja de leerse.

import type { Ambito } from './enCocinaAhora'

export const MARGEN_CORTESIA_MIN = 15

export interface TurnoSinFichar {
  empleadoId: string
  nombre: string
  local: string
  /** «12:30» */
  entradaPrevista: string
  /** Minutos desde la hora prevista, ya descontado nada: es el retraso real. */
  minutosDeRetraso: number
}

interface CeldasCuadrante { [turnoId: string]: { [dia: string]: string[] } }

/**
 * Los que tenían turno y no han fichado, PUROS: sin consultas, para poder
 * probarlo. `dentro` son los ids con jornada abierta.
 */
export function cruzaTurnosConFichajes(
  cells: unknown,
  turnos: { id: string; start_time: string }[],
  diaIndex: number,
  ambito: Ambito,
  dentro: Set<string>,
  minutosDelDia: number,
  margen = MARGEN_CORTESIA_MIN,
): TurnoSinFichar[] {
  if (!cells || typeof cells !== 'object') return []
  const c = cells as CeldasCuadrante
  const porEmpleado = new Map<string, { id: string; start_time: string }>()

  for (const [turnoId, porDia] of Object.entries(c)) {
    const asignados = porDia?.[String(diaIndex)]
    if (!Array.isArray(asignados)) continue
    const t = turnos.find(x => x.id === turnoId)
    if (!t?.start_time) continue
    for (const empId of asignados) {
      // Si alguien tiene DOS turnos hoy, manda el más temprano: es la hora a la
      // que se le espera.
      const previo = porEmpleado.get(empId)
      if (!previo || t.start_time < previo.start_time) porEmpleado.set(empId, t)
    }
  }

  const salida: TurnoSinFichar[] = []
  for (const [empId, turno] of porEmpleado) {
    if (dentro.has(empId)) continue
    const emp = ambito.plantilla.find(e => e.id === empId)
    if (!emp) continue                      // baja o de otro local: no es un hueco
    const [h, m] = turno.start_time.split(':').map(Number)
    const previstaMin = h * 60 + m
    const retraso = minutosDelDia - previstaMin
    // Todavía no le toca, o está dentro del margen de cortesía.
    if (retraso < margen) continue
    salida.push({
      empleadoId: empId,
      nombre: emp.name,
      local: (emp.location_id && ambito.locales.get(emp.location_id)) || 'Sin local',
      entradaPrevista: turno.start_time.slice(0, 5),
      minutosDeRetraso: retraso,
    })
  }
  // El que más lleva esperándose, arriba.
  return salida.sort((a, b) => b.minutosDeRetraso - a.minutosDeRetraso)
}

// ── La lectura ─────────────────────────────────────────────────────────────

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { leeAmbito, leeEnCocinaAhora } from './enCocinaAhora'
import { diaDelNegocio, lunesDeLaSemana } from '@/lib/fechas'

export async function leeSinFichar(
  accountId: string, locationId: string | null,
): Promise<TurnoSinFichar[]> {
  if (!isSupabaseEnabled || !supabase) return []
  const ambito = await leeAmbito(accountId, locationId)
  if (ambito.plantilla.length === 0) return []

  const ahora = new Date()
  const dia = diaDelNegocio(ahora)
  const [y, m, d] = dia.ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const diaIndex = dow === 0 ? 6 : dow - 1
  // Minutos transcurridos del día DEL NEGOCIO, que es con lo que se compara la
  // hora del turno: los turnos están en hora local, no en UTC.
  const minutosDelDia = Math.round((ahora.getTime() - dia.desde.getTime()) / 60000)

  const locIds = [...ambito.locales.keys()]
  const [sch, tur, estados] = await Promise.all([
    supabase.from('schedules').select('cells')
      .eq('week_start', lunesDeLaSemana(ahora)).in('location_id', locIds),
    supabase.from('shift_templates').select('id, start_time').in('location_id', locIds),
    leeEnCocinaAhora(ambito),
  ])
  if (sch.error) throw new Error(`No se ha podido leer el cuadrante: ${sch.error.message}`)
  if (tur.error) throw new Error(`No se han podido leer los turnos: ${tur.error.message}`)

  const dentro = new Set(estados.filter(e => e.estado === 'trabajando').map(e => e.empleadoId))
  const turnos = (tur.data ?? []) as { id: string; start_time: string }[]

  return ((sch.data ?? []) as { cells: unknown }[])
    .flatMap(s => cruzaTurnosConFichajes(s.cells, turnos, diaIndex, ambito, dentro, minutosDelDia))
    .sort((a, b) => b.minutosDeRetraso - a.minutosDeRetraso)
}
