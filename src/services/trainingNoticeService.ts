// src/services/trainingNoticeService.ts
// ENCARGO CODE — UI de avisos de formación por WhatsApp. El backend (cola
// training_notice, trigger de auto-encolado, cron training-notify con
// desconexión digital art. 88 LOPDGDD) ya está en producción — este servicio
// SOLO lee el estado de la cola y llama a la RPC notify_employee_courses
// (SECURITY DEFINER, guard admin/manager) para encolar/reenviar. No decide
// nada de negocio: el guardarraíl de las 48h y el envío real viven en el
// servidor.

import { supabase } from '../lib/supabase'

export interface TrainingNoticeStatus {
  employeeId: string
  courseId: string
  status: string // queued|sent|delivered|read|failed|skipped
  skipReason: string | null
  error: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
}

interface TrainingNoticeRow {
  employee_id: string
  course_id: string
  status: string
  skip_reason: string | null
  error: string | null
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
}

/**
 * Últimos avisos de un curso, uno por empleado (el training_notice más
 * reciente por created_at). Para pintar la columna "Aviso" de Seguimiento.
 * RLS ya filtra por cuenta (training_notice_select).
 */
export async function getNoticeStatusForCourse(courseId: string): Promise<TrainingNoticeStatus[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase
    .from('training_notice')
    .select('employee_id, course_id, status, skip_reason, error, created_at, sent_at, delivered_at, read_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[trainingNoticeService] getNoticeStatusForCourse', error); throw error }

  // Ya viene ordenado DESC: la primera fila que vemos de cada empleado es la más reciente.
  const latestByEmployee = new Map<string, TrainingNoticeStatus>()
  for (const r of (data ?? []) as TrainingNoticeRow[]) {
    if (latestByEmployee.has(r.employee_id)) continue
    latestByEmployee.set(r.employee_id, {
      employeeId: r.employee_id,
      courseId: r.course_id,
      status: r.status,
      skipReason: r.skip_reason,
      error: r.error,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      readAt: r.read_at,
    })
  }
  return [...latestByEmployee.values()]
}

export interface NotifyResult {
  encolados: number
  omitidos: number
}

interface NotifyRpcRow {
  course_id: string
  notice_id: string | null
  result: string // 'encolado' | 'omitido (ya avisado/sin gancho/sin teléfono)'
}

async function callNotifyRpc(employeeId: string, courseId?: string): Promise<NotifyRpcRow[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await supabase.rpc('notify_employee_courses', {
    p_employee_id: employeeId,
    p_course_id: courseId,
  })
  if (error) { console.error('[trainingNoticeService] notify_employee_courses', error); throw error }
  return (data ?? []) as NotifyRpcRow[]
}

function tally(rows: NotifyRpcRow[]): NotifyResult {
  let encolados = 0
  let omitidos = 0
  for (const r of rows) {
    if (r.result === 'encolado') encolados++
    else omitidos++
  }
  return { encolados, omitidos }
}

/** Botón "Avisar" de una fila: reencola/avisa a UN empleado de un curso concreto. */
export async function notifyEmployee(employeeId: string, courseId?: string): Promise<NotifyResult> {
  return tally(await callNotifyRpc(employeeId, courseId))
}

/** Botón "Avisar a los pendientes": una llamada por empleado (guard admin en cada una). */
export async function notifyPending(employeeIds: string[], courseId: string): Promise<NotifyResult> {
  const uniqueIds = [...new Set(employeeIds)]
  const results = await Promise.all(uniqueIds.map(id => callNotifyRpc(id, courseId)))
  return tally(results.flat())
}
