// src/services/clockoutReminderReportService.ts
// ENCARGO CODE — Informe de recordatorios de olvido de fichaje (oficina).
// Solo lectura sobre clockout_reminder_log (RLS ya filtra por cuenta) +
// clock_entries (cruce para saber si el empleado fichó su salida DESPUÉS del
// aviso). NO toca la detección (enqueue_clockout_reminders), el Edge de envío
// ni el cron.
//
// Doble propósito (protección legal + eficacia del aviso): "totalSent" y el
// detalle son el anexo que demuestra cuándo y cuántas veces se avisó a cada
// persona; "clockedOutAfter" mide si el aviso sirvió de algo.

import { supabase } from '../lib/supabase'
import { fetchEmployees } from './supabaseSync'

export interface ReminderRow {
  employeeId: string
  employeeName: string
  totalSent: number
  thisMonth: number
  thisWeek: number
  lastAt: string | null
  reminderActive: boolean
}

export interface ReminderDetailRow {
  id: string
  createdAt: string
  scheduledEnd: string | null
  status: string
  skipReason: string | null
  error: string | null
  sentAt: string | null
  /** null = el aviso no llegó a enviarse (queued/failed/skipped) — no aplica. */
  clockedOutAfter: boolean | null
}

interface LogSummaryRow {
  employee_id: string
  status: string
  created_at: string
}

interface LogDetailRow {
  id: string
  clock_entry_id: string
  status: string
  skip_reason: string | null
  error: string | null
  created_at: string
  sent_at: string | null
  scheduled_end: string | null
}

function startOfWeekISO(now: Date): string {
  const d = new Date(now)
  const day = (d.getDay() + 6) % 7 // lunes = 0
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  return d.toISOString()
}

function startOfMonthISO(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

/** Resumen por empleado activo de la cuenta — incluye a quien tiene 0 avisos. */
export async function getReminderSummary(
  accountId: string,
  range?: { from: string; to: string },
): Promise<ReminderRow[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  const [employees, logsRes] = await Promise.all([
    fetchEmployees(accountId),
    supabase
      .from('clockout_reminder_log')
      .select('employee_id, status, created_at')
      .eq('account_id', accountId),
  ])
  if (logsRes.error) {
    console.error('[clockoutReminderReportService] getReminderSummary', logsRes.error)
    throw logsRes.error
  }

  const now = new Date()
  const weekStart = startOfWeekISO(now)
  const monthStart = startOfMonthISO(now)

  const byEmployee = new Map<string, { total: number; month: number; week: number; last: string | null }>()
  for (const r of (logsRes.data ?? []) as LogSummaryRow[]) {
    if (r.status !== 'sent') continue
    if (range?.from && r.created_at < range.from) continue
    if (range?.to && r.created_at > range.to) continue
    const acc = byEmployee.get(r.employee_id) ?? { total: 0, month: 0, week: 0, last: null }
    acc.total += 1
    if (r.created_at >= monthStart) acc.month += 1
    if (r.created_at >= weekStart) acc.week += 1
    if (!acc.last || r.created_at > acc.last) acc.last = r.created_at
    byEmployee.set(r.employee_id, acc)
  }

  return (employees ?? [])
    .filter(e => e.active)
    .map(e => {
      const agg = byEmployee.get(e.id)
      return {
        employeeId: e.id,
        employeeName: e.name,
        totalSent: agg?.total ?? 0,
        thisMonth: agg?.month ?? 0,
        thisWeek: agg?.week ?? 0,
        lastAt: agg?.last ?? null,
        reminderActive: e.forgotClockoutReminder ?? true,
      }
    })
    .sort((a, b) => b.totalSent - a.totalSent || a.employeeName.localeCompare(b.employeeName))
}

/** Listado de avisos de un empleado, con si fichó su salida después de cada uno enviado. */
export async function getReminderDetail(employeeId: string): Promise<ReminderDetailRow[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data: logs, error } = await supabase
    .from('clockout_reminder_log')
    .select('id, clock_entry_id, status, skip_reason, error, created_at, sent_at, scheduled_end')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[clockoutReminderReportService] getReminderDetail (log)', error); throw error }
  const rows = (logs ?? []) as LogDetailRow[]
  if (rows.length === 0) return []

  // Salidas del empleado desde el aviso más antiguo — para cruzar "¿fichó tras el aviso?".
  const earliestCreated = rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0].created_at)
  const { data: salidas, error: salidasErr } = await supabase
    .from('clock_entries')
    .select('datetime, voided')
    .eq('employee_id', employeeId)
    .eq('type', 'salida')
    .gte('datetime', earliestCreated)
    .order('datetime', { ascending: true })
  if (salidasErr) { console.error('[clockoutReminderReportService] getReminderDetail (salidas)', salidasErr); throw salidasErr }
  const salidaTimes = ((salidas ?? []) as { datetime: string; voided: boolean | null }[])
    .filter(s => s.voided !== true)
    .map(s => s.datetime)
    .sort()

  function clockedOutAfter(sentAt: string | null): boolean | null {
    if (!sentAt) return null
    return salidaTimes.some(t => t > sentAt)
  }

  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    scheduledEnd: r.scheduled_end,
    status: r.status,
    skipReason: r.skip_reason,
    error: r.error,
    sentAt: r.sent_at,
    clockedOutAfter: r.status === 'sent' ? clockedOutAfter(r.sent_at) : null,
  }))
}
