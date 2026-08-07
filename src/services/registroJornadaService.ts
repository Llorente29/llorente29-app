// src/services/registroJornadaService.ts
// F5.1 — Registro de jornada (RD-ley 8/2019, art. 34.9 ET). Envuelve las RPCs
// registro_jornada_mensual (detalle día a día — jornada partida = dos filas
// del mismo día, TODOS los días constan) y registro_jornada_totales
// (cabecera/pie del PDF). Motores verificados en BBDD 07/08 — ver
// ENCARGO_CODE_F5_gestoria_y_pdf_jornada.md. db() laxo por la deuda de
// database.ts (funciones nuevas aún no tipadas), mismo patrón que
// teamHoursService.ts.

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface RegistroJornadaDia {
  dia: string
  entrada: string | null
  salida: string | null
  minutosTrabajados: number
  minutosPausa: number
  minutosNocturnos: number
  esFestivo: boolean
  festivoNombre: string | null
  ausenciaTipo: string | null
}

export interface RegistroJornadaTotales {
  diasTrabajados: number
  tramos: number
  horasTrabajadas: number
  horasPausa: number
  horasNocturnas: number
  diasVacaciones: number
  diasBaja: number
  diasFestivoTrabajado: number
  horasContratadas: number
  deltaHoras: number
}

export async function fetchRegistroJornadaMensual(
  employeeId: string,
  from: string,
  to: string
): Promise<RegistroJornadaDia[]> {
  const { data, error } = await db().rpc('registro_jornada_mensual', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    console.error('[registroJornada] registro_jornada_mensual:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: RegistroJornadaDia[] = (data as any[]).map(r => ({
    dia: r.dia,
    entrada: r.entrada,
    salida: r.salida,
    minutosTrabajados: Number(r.minutos_trabajados) || 0,
    minutosPausa: Number(r.minutos_pausa) || 0,
    minutosNocturnos: Number(r.minutos_nocturnos) || 0,
    esFestivo: !!r.es_festivo,
    festivoNombre: r.festivo_nombre,
    ausenciaTipo: r.ausencia_tipo,
  }))
  // Orden cronológico estable: por día y, dentro del mismo día (jornada
  // partida = dos filas), por hora de entrada — para que el PDF pinte los
  // tramos en el orden en que ocurrieron, no en el orden que devuelva la BBDD.
  rows.sort((a, b) => {
    if (a.dia !== b.dia) return a.dia < b.dia ? -1 : 1
    return (a.entrada ?? '').localeCompare(b.entrada ?? '')
  })
  return rows
}

export async function fetchRegistroJornadaTotales(
  employeeId: string,
  from: string,
  to: string
): Promise<RegistroJornadaTotales | null> {
  const { data, error } = await db().rpc('registro_jornada_totales', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    console.error('[registroJornada] registro_jornada_totales:', error)
    return null
  }
  const r = (data as unknown[])[0] as Record<string, unknown> | undefined
  if (!r) return null
  return {
    diasTrabajados: Number(r.dias_trabajados) || 0,
    tramos: Number(r.tramos) || 0,
    horasTrabajadas: Number(r.horas_trabajadas) || 0,
    horasPausa: Number(r.horas_pausa) || 0,
    horasNocturnas: Number(r.horas_nocturnas) || 0,
    diasVacaciones: Number(r.dias_vacaciones) || 0,
    diasBaja: Number(r.dias_baja) || 0,
    diasFestivoTrabajado: Number(r.dias_festivo_trabajado) || 0,
    horasContratadas: Number(r.horas_contratadas) || 0,
    deltaHoras: Number(r.delta_horas) || 0,
  }
}
