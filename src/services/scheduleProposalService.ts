// src/services/scheduleProposalService.ts
// F10 — Generadores de cuadrante por RPC (solver determinista, sin IA).
// Convive con el generador heurístico existente (scheduleGenerator.ts): el
// encargado elige, nada se sustituye. No escribe nada — el caller decide si
// vuelca el resultado en schedules.cells (y solo lo hace al guardar).
//
// fetchScheduleProposal/fetchScheduleRest (propose_schedule): motor original
// por shift_templates. HUÉRFANO desde 08/08 — CalendarioPage pasó a
// fetchGeneratedSchedule (generate_week_schedule, sin shift_templates, desde
// la curva de demanda). No se borra (regla de no destrucción): se retira
// cuando el nuevo lleve unas semanas verificado.
//
// fetchGeneratedSchedule (generate_week_schedule): EN USO. Motor verificado
// en BBDD 08/08 — ver supabase/migrations/20260808T1500..1810.

import { supabase } from '../lib/supabase'
import type { DayOfWeek } from '../types/scheduler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface ScheduleProposalRow {
  dia: string
  dayOfWeek: DayOfWeek
  shiftTemplateId: string
  shiftLabel: string
  /** null cuando es_hueco: nadie puede cubrir el turno sin incumplir una restricción dura. */
  employeeId: string | null
  employeeName: string
  motivo: string
  /** true = el solver tuvo que saltarse la preferencia inferida para cubrir el turno (pintar en ámbar, no en rojo). */
  rompePreferencia: boolean
  /** true = hueco declarado por el solver legal: ninguna persona podía cubrirlo sin romper una restricción dura. Pintar en rojo, nunca omitir. */
  esHueco: boolean
  /** motivo del hueco (qué restricción bloqueó a cada candidato). null si esHueco es false. */
  motivoHueco: string | null
}

export async function fetchScheduleProposal(
  accountId: string,
  locationId: string,
  weekStart: string
): Promise<ScheduleProposalRow[]> {
  const { data, error } = await db().rpc('propose_schedule', {
    p_account: accountId,
    p_location: locationId,
    p_week_start: weekStart,
  })
  if (error) {
    console.error('[scheduleProposal] propose_schedule:', error)
    throw new Error(error.message || 'No se pudo proponer el cuadrante.')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    dia: r.dia,
    dayOfWeek: Number(r.day_of_week) as DayOfWeek,
    shiftTemplateId: r.shift_template_id,
    shiftLabel: r.shift_label,
    employeeId: r.employee_id ?? null,
    employeeName: (r.employee_name || '').trim(),
    motivo: r.motivo || '',
    rompePreferencia: !!r.rompe_preferencia,
    esHueco: !!r.es_hueco,
    motivoHueco: r.motivo_hueco ?? null,
  }))
}

// F10 — descanso semanal configurable (weekly_rest_minutes en break_policy,
// 36h/2160min por defecto = mínimo art. 37.1). Expone, por persona, el hueco
// continuo más largo de la semana propuesta frente al mínimo exigido, con un
// margen de seguridad operativo (rest_safety_margin_minutes, 30min por
// defecto) que separa "ok" de "al límite" — no es restricción dura, es aviso:
// un cuadrante justo en el mínimo es legal pero un fichaje tardío lo tumba.
export interface ScheduleRestRow {
  employeeId: string
  employeeName: string
  diasTrabajados: number
  horasSemana: number
  descansoDesde: string | null
  descansoHasta: string | null
  descansoHoras: number
  minimoExigidoHoras: number
  /** descansoHoras - minimoExigidoHoras. Negativo si incumple. */
  margenHoras: number
  /** 'ok' = descanso con colchón real · 'al_limite' = cumple pero por debajo del margen de seguridad · 'incumple' = no llega al mínimo legal. */
  estado: 'ok' | 'al_limite' | 'incumple'
  cumple: boolean
}

export async function fetchScheduleRest(
  accountId: string,
  locationId: string,
  weekStart: string
): Promise<ScheduleRestRow[]> {
  const { data, error } = await db().rpc('propose_schedule_rest', {
    p_account: accountId,
    p_location: locationId,
    p_week_start: weekStart,
  })
  if (error) {
    console.error('[scheduleProposal] propose_schedule_rest:', error)
    throw new Error(error.message || 'No se pudo calcular el descanso semanal.')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    employeeId: r.employee_id,
    employeeName: (r.employee_name || '').trim(),
    diasTrabajados: Number(r.dias_trabajados) || 0,
    horasSemana: Number(r.horas_semana) || 0,
    descansoDesde: r.descanso_desde ?? null,
    descansoHasta: r.descanso_hasta ?? null,
    descansoHoras: Number(r.descanso_horas) || 0,
    minimoExigidoHoras: Number(r.minimo_exigido_horas) || 0,
    margenHoras: Number(r.margen_horas) || 0,
    estado: (r.estado === 'ok' || r.estado === 'al_limite' || r.estado === 'incumple') ? r.estado : 'incumple',
    cumple: !!r.cumple,
  }))
}

// F10 v3 (09/08) — generate_week_schedule ahora ANCLA a shift_templates
// reales (kind='demanda'/'forzado'/'no_productivo'): la mayoría de filas
// traen shiftTemplateId. Solo el refuerzo excepcional (como mucho uno por
// día) llega con shiftTemplateId=null y horaIni/horaFin en "HH:MM" — ese sí
// se representa como plantilla sintética `gen-<HHMM>-<HHMM>` en CalendarioPage.
// ⚠️ CAMBIO DE CONTRATO respecto a la versión anterior: horaIni/horaFin
// pasan de "hora entera" (number) a "HH:MM" (string) — ver migración
// 20260809T1530_generate_week_schedule_v3_ancla_plantillas.sql.
export interface GeneratedScheduleRow {
  fecha: string
  dayOfWeek: DayOfWeek
  /** null solo en el refuerzo excepcional — el resto ancla a un shift_templates real. */
  shiftTemplateId: string | null
  /** "HH:MM" */
  horaIni: string
  /** "HH:MM" (puede ser < horaIni si cruza medianoche) */
  horaFin: string
  horas: number
  /** 1=base (demanda/forzado/no_productivo) · 2=turno largo del pico · 3=dotación mínima en pico · 4=refuerzo excepcional */
  capa: number
  /** null cuando esHueco: nadie puede cubrir el bloque sin incumplir una restricción dura. */
  employeeId: string | null
  employeeName: string | null
  esHueco: boolean
  motivo: string
}

export async function fetchGeneratedSchedule(
  accountId: string,
  locationId: string,
  weekStart: string,
  role: string = 'cocina',
  minPctDias: number = 15
): Promise<GeneratedScheduleRow[]> {
  const { data, error } = await db().rpc('generate_week_schedule', {
    p_account: accountId,
    p_location: locationId,
    p_week_start: weekStart,
    p_role: role,
    p_min_pct_dias: minPctDias,
  })
  if (error) {
    console.error('[scheduleProposal] generate_week_schedule:', error)
    throw new Error(error.message || 'No se pudo generar el cuadrante.')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    fecha: r.o_fecha,
    dayOfWeek: Number(r.o_dow) as DayOfWeek,
    shiftTemplateId: r.o_shift_template_id ?? null,
    horaIni: String(r.o_ini),
    horaFin: String(r.o_fin),
    horas: Number(r.o_horas),
    capa: Number(r.o_capa),
    employeeId: r.o_employee_id ?? null,
    employeeName: r.o_employee ? String(r.o_employee).trim() : null,
    esHueco: !!r.o_hueco,
    motivo: r.o_motivo || '',
  }))
}
