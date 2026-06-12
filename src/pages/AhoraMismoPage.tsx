// src/pages/AhoraMismoPage.tsx
// Panel del gestor: estado en tiempo real de quién está trabajando AHORA en cada local.
// MODELO A: usa el calendario PUBLICADO como única fuente de horario teórico.
//
// FASE 2.A (22/05/2026): lee del schema canónico (schedulerService + schedules.cells)
// en lugar del legacy (calendarService + shift_assignments). horasComputo sigue
// recibiendo el mismo CalendarContext (sintetizado desde el canónico).
//
// FASE 2.A.2 (22/05/2026): horasComputo ya no depende de tipos de calendarService.
// El adapter sintetiza ScheduledShift / ShiftTypeInfo (tipos propios de horasComputo).
import { useState, useEffect, useMemo } from 'react'
import { Check, AlertCircle, AlertTriangle, Clock, Users, MapPin } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { Card } from '../components/ui'
import type { Employee, Location } from '../types'
import {
  computeCurrentStatus, entriesOfDay,
  type CurrentStatus, type CalendarContext,
  type ScheduledShift, type ShiftTypeInfo,
} from '../services/horasComputo'
import { fetchAppSettings, type AppSettings } from '../services/appSettingsService'
import { getSchedule, listShiftTemplates } from '../services/schedulerService'
import { getMondayOfWeek, toISODate, shiftDurationHours, type DayOfWeek } from '../types/scheduler'
import { isSupabaseEnabled, supabase } from '../lib/supabase'

export default function AhoraMismoPage() {
  const { staff, locations } = useApp()
  const [now, setNow] = useState(new Date())
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [filterLoc, setFilterLoc] = useState<string>('all')

  // El selector global de local manda: local activo → ese local; consolidado → 'all'.
  const { resolvedLocationId } = useLocationScope()
  useEffect(() => {
    setFilterLoc(resolvedLocationId ?? 'all')
  }, [resolvedLocationId])
  // Mapa por empleado de su CalendarContext (asignaciones publicadas para hoy)
  const [calendarCtxByEmp, setCalendarCtxByEmp] = useState<Map<string, CalendarContext>>(new Map())

  // Cargar settings
  useEffect(() => {
    fetchAppSettings().then(setSettings)
  }, [])

  // Reloj que actualiza cada minuto para refrescar contadores
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // Cargar asignaciones publicadas para HOY desde el schema canónico
  // (schedulerService.schedules.cells + shift_templates), y sintetizar el
  // CalendarContext que horasComputo espera. Tipos del propio horasComputo
  // (ScheduledShift, ShiftTypeInfo) — independencia total de calendarService.
  async function loadCalendar() {
    const today = new Date()
    const weekMonday = getMondayOfWeek(today)
    const weekMondayIso = toISODate(weekMonday)
    const todayIso = toISODate(today)
    // schedulerService usa 0=Lun..6=Dom. JS Date.getDay() usa 0=Dom..6=Sab.
    const jsDay = today.getDay()
    const todayDayOfWeek: DayOfWeek = (jsDay === 0 ? 6 : jsDay - 1) as DayOfWeek

    const activeLocs = locations.filter(l => l.active)
    if (activeLocs.length === 0) {
      setCalendarCtxByEmp(new Map())
      return
    }

    // Cargar schedule (semana actual) + templates por local en paralelo
    const [allSchedules, allTemplates] = await Promise.all([
      Promise.all(activeLocs.map(loc => getSchedule(loc.id, weekMondayIso))),
      Promise.all(activeLocs.map(loc => listShiftTemplates(loc.id))),
    ])

    // typesById: cada template -> ShiftTypeInfo con los 4 campos mínimos
    const typesById = new Map<string, ShiftTypeInfo>()
    for (const tpls of allTemplates) {
      for (const t of tpls) {
        typesById.set(t.id, {
          startTime: t.start_time,
          endTime: t.end_time,
          hours: shiftDurationHours(t.start_time, t.end_time),
          isOff: false,
        })
      }
    }

    // assignmentsByDate por empleado: solo asignaciones de HOY de schedules publicados
    const map = new Map<string, CalendarContext>()
    for (const schedule of allSchedules) {
      if (!schedule || schedule.status !== 'published') continue
      for (const templateId of Object.keys(schedule.cells)) {
        const byDay = schedule.cells[templateId]
        const employeeIds = byDay?.[String(todayDayOfWeek)]
        if (!employeeIds || employeeIds.length === 0) continue
        for (const empId of employeeIds) {
          const ctx = map.get(empId) || { assignmentsByDate: new Map(), typesById }
          const fakeAssign: ScheduledShift = {
            shiftTypeId: templateId,
          }
          ctx.assignmentsByDate.set(todayIso, fakeAssign)
          ctx.typesById = typesById
          map.set(empId, ctx)
        }
      }
    }
    setCalendarCtxByEmp(map)
  }

  useEffect(() => { loadCalendar() }, [now])

  // Realtime: cambios en schedules o shift_templates -> recargar
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb.channel('ahora-cal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => loadCalendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_templates' }, () => loadCalendar())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  // Calcular el estado de cada empleado activo
  type EmpStatus = { employee: Employee; status: CurrentStatus; primaryLoc: Location | undefined }

  const allStatuses: EmpStatus[] = useMemo(() => {
    if (!settings) return []
    return staff
      .filter(e => e.active)
      .map(e => {
        const todayEntries = entriesOfDay(e.clockEntries || [], now)
        const calendarCtx = calendarCtxByEmp.get(e.id)
        const status = computeCurrentStatus({
          now, employee: e, todayEntries,
          lateAlertMin: settings.lateAlertMin,
          forgotClockoutMin: settings.forgotClockoutMin,
          calendarCtx,
        })
        const primaryLoc = locations.find(l => l.id === e.locationId)
        return { employee: e, status, primaryLoc }
      })
  }, [staff, locations, now, settings, calendarCtxByEmp])

  // Filtrar por local
  const filtered = useMemo(() => {
    if (filterLoc === 'all') return allStatuses
    return allStatuses.filter(s =>
      s.employee.locationId === filterLoc ||
      (s.employee.assignedLocations || []).includes(filterLoc)
    )
  }, [allStatuses, filterLoc])

  // Agrupar por estado
  const groups = useMemo(() => {
    const inside: EmpStatus[] = []
    const lateArrivals: EmpStatus[] = []
    const forgotClockout: EmpStatus[] = []
    const pendingArrival: EmpStatus[] = []
    const finished: EmpStatus[] = []
    const noScheduled: EmpStatus[] = []

    for (const s of filtered) {
      switch (s.status.kind) {
        case 'inside': inside.push(s); break
        case 'late_arrival': lateArrivals.push(s); break
        case 'forgot_clockout': forgotClockout.push(s); break
        case 'pending_arrival': pendingArrival.push(s); break
        case 'finished': finished.push(s); break
        case 'no_scheduled': noScheduled.push(s); break
      }
    }

    // Ordenar dentro de cada grupo
    inside.sort((a, b) =>
      a.status.kind === 'inside' && b.status.kind === 'inside'
        ? a.status.entryAt.getTime() - b.status.entryAt.getTime()
        : 0
    )
    lateArrivals.sort((a, b) =>
      a.status.kind === 'late_arrival' && b.status.kind === 'late_arrival'
        ? b.status.minutesLate - a.status.minutesLate
        : 0
    )

    return { inside, lateArrivals, forgotClockout, pendingArrival, finished, noScheduled }
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Header con reloj */}
      <Card className="p-4 bg-accent-bg border-accent/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-text-secondary uppercase tracking-wide">Ahora mismo</p>
            <p className="text-3xl font-bold text-accent tabular-nums">
              {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-text-secondary mt-1 capitalize">
              {now.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-success">{groups.inside.length}</p>
            <p className="text-xs text-text-secondary">trabajando</p>
          </div>
        </div>
      </Card>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard color="emerald" label="Trabajando" value={groups.inside.length} Icon={Check} />
        <KpiCard color="red" label="No fichó" value={groups.lateArrivals.length} Icon={AlertCircle} />
        <KpiCard color="amber" label="Olvidó salir" value={groups.forgotClockout.length} Icon={Clock} />
        <KpiCard color="gray" label="Esperados" value={groups.pendingArrival.length} Icon={Users} />
      </div>

      {/* Filtro por local */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilterLoc('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-base ${
            filterLoc === 'all'
              ? 'bg-accent text-text-on-accent'
              : 'bg-card border border-border-default text-text-secondary hover:border-accent'
          }`}>
          Todos los locales
        </button>
        {locations.filter(l => l.active).map(l => (
          <button key={l.id} onClick={() => setFilterLoc(l.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-base ${
              filterLoc === l.id
                ? 'bg-accent text-text-on-accent'
                : 'bg-card border border-border-default text-text-secondary hover:border-accent'
            }`}>
            {l.name}
          </button>
        ))}
      </div>

      {/* Grupos */}
      {groups.lateArrivals.length > 0 && (
        <Section TitleIcon={AlertCircle} title="No han fichado y deberían estar trabajando" colorClass="border-danger/30 bg-danger-bg/50">
          {groups.lateArrivals.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.forgotClockout.length > 0 && (
        <Section TitleIcon={AlertTriangle} title="Posible olvido de salida" colorClass="border-warning/30 bg-warning-bg/50">
          {groups.forgotClockout.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.inside.length > 0 && (
        <Section TitleIcon={Check} title="Trabajando ahora">
          {groups.inside.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.pendingArrival.length > 0 && (
        <Section title="Esperados">
          {groups.pendingArrival.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.finished.length > 0 && (
        <Section title="Han terminado hoy">
          {groups.finished.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.noScheduled.length > 0 && (
        <Section title="Sin horario hoy">
          {groups.noScheduled.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <div className="flex justify-center mb-3">
            <Users size={48} className="text-accent" />
          </div>
          <p className="font-semibold text-text-primary">Sin empleados</p>
          <p className="text-xs text-text-secondary mt-1">No hay empleados activos en este local</p>
        </Card>
      )}
    </div>
  )
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function KpiCard({ color, label, value, Icon }: { color: string; label: string; value: number; Icon: typeof Check }) {
  const colors: Record<string, string> = {
    emerald: 'bg-success-bg text-success border-success/30',
    red: 'bg-danger-bg text-danger border-danger/30',
    amber: 'bg-warning-bg text-warning border-warning/30',
    gray: 'bg-page text-text-secondary border-border-default',
  }
  return (
    <Card className={`p-3 border ${colors[color] || colors.gray}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
        </div>
        <Icon size={28} className="opacity-50" />
      </div>
    </Card>
  )
}

function Section({ title, TitleIcon, children, colorClass }: { title: string; TitleIcon?: typeof Check; children: React.ReactNode; colorClass?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-1 mb-2 inline-flex items-center gap-1.5">
        {TitleIcon && <TitleIcon size={12} />} {title}
      </p>
      <div className={`space-y-2 ${colorClass ? `p-2 rounded-xl border ${colorClass}` : ''}`}>
        {children}
      </div>
    </div>
  )
}

function EmpCard({ status }: { status: { employee: Employee; status: CurrentStatus; primaryLoc: Location | undefined } }) {
  const { employee, status: s, primaryLoc } = status
  const initials = (employee.name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()

  let mainText = ''
  let subText = ''
  let badge: { label: string; cls: string } | null = null

  switch (s.kind) {
    case 'inside':
      mainText = `Entró a las ${s.entryAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      subText = `Lleva ${formatMinutes(s.minutesWorked)}${s.theoretical ? ` · Sale a las ${s.theoretical.end}` : ''}`
      badge = { label: 'Dentro', cls: 'bg-success-bg text-success' }
      break
    case 'late_arrival':
      mainText = `Debía empezar a las ${s.theoretical.start}`
      subText = `${formatMinutes(s.minutesLate)} de retraso`
      badge = { label: 'No fichó', cls: 'bg-danger-bg text-danger' }
      break
    case 'forgot_clockout':
      mainText = `Entró a las ${s.entryAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      subText = `Debía salir a las ${s.theoretical.end} · ${formatMinutes(s.minutesOver)} de exceso`
      badge = { label: 'Olvidó salir', cls: 'bg-warning-bg text-warning' }
      break
    case 'pending_arrival':
      mainText = `Empieza a las ${s.theoretical.start}`
      subText = s.minutesEarly > 0
        ? `Quedan ${formatMinutes(s.minutesEarly)}`
        : `Hace ${formatMinutes(-s.minutesEarly)} (todavía dentro de margen)`
      badge = { label: 'Pendiente', cls: 'bg-page text-text-secondary' }
      break
    case 'finished':
      mainText = `Terminó a las ${s.lastExitAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      subText = 'Jornada completada'
      badge = { label: 'Hecho', cls: 'bg-accent-bg text-accent' }
      break
    case 'no_scheduled':
      mainText = 'Sin horario asignado hoy'
      subText = ''
      badge = { label: 'Libre', cls: 'bg-page text-text-secondary' }
      break
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-accent-bg flex items-center justify-center">
          <span className="text-sm font-bold text-accent">{initials || '?'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-text-primary text-sm">{employee.name || 'Sin nombre'}</p>
            <span className="text-xs text-text-secondary">{employee.position || '—'}</span>
            {primaryLoc && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-text-secondary inline-flex items-center gap-1">
                <MapPin size={10} /> {primaryLoc.name}
              </span>
            )}
          </div>
          <p className="text-sm text-text-primary mt-0.5">{mainText}</p>
          {subText && <p className="text-xs text-text-secondary">{subText}</p>}
        </div>
        {badge && (
          <span className={`text-[10px] font-medium px-2 py-1 rounded-full shrink-0 ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
    </Card>
  )
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}
