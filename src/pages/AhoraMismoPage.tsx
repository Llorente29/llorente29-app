// src/pages/AhoraMismoPage.tsx
// Panel del gestor: estado en tiempo real de quién está trabajando AHORA en cada local.
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import type { Employee, Location } from '../types'
import {
  computeCurrentStatus, entriesOfDay,
  type CurrentStatus,
} from '../services/horasComputo'
import { fetchAppSettings, type AppSettings } from '../services/appSettingsService'

export default function AhoraMismoPage() {
  const { staff, locations } = useApp()
  const [now, setNow] = useState(new Date())
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [filterLoc, setFilterLoc] = useState<string>('all')

  // Cargar settings
  useEffect(() => {
    fetchAppSettings().then(setSettings)
  }, [])

  // Reloj que actualiza cada minuto para refrescar contadores
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // Calcular el estado de cada empleado activo
  type EmpStatus = { employee: Employee; status: CurrentStatus; primaryLoc: Location | undefined }

  const allStatuses: EmpStatus[] = useMemo(() => {
    if (!settings) return []
    return staff
      .filter(e => e.active)
      .map(e => {
        const todayEntries = entriesOfDay(e.clockEntries || [], now)
        const status = computeCurrentStatus({
          now, employee: e, todayEntries,
          lateAlertMin: settings.lateAlertMin,
          forgotClockoutMin: settings.forgotClockoutMin,
        })
        const primaryLoc = locations.find(l => l.id === e.locationId)
        return { employee: e, status, primaryLoc }
      })
  }, [staff, locations, now, settings])

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
      <Card className="p-4 bg-[#F5E9D9] border-[#E5D4B7]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Ahora mismo</p>
            <p className="text-3xl font-bold text-[#7C1A1A] tabular-nums">
              {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-gray-500 mt-1 capitalize">
              {now.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-emerald-600">{groups.inside.length}</p>
            <p className="text-xs text-gray-500">trabajando</p>
          </div>
        </div>
      </Card>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard color="emerald" label="Trabajando" value={groups.inside.length} icon="✓" />
        <KpiCard color="red" label="No fichó" value={groups.lateArrivals.length} icon="!" />
        <KpiCard color="amber" label="Olvidó salir" value={groups.forgotClockout.length} icon="?" />
        <KpiCard color="gray" label="Esperados" value={groups.pendingArrival.length} icon="○" />
      </div>

      {/* Filtro por local */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilterLoc('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            filterLoc === 'all'
              ? 'bg-[#7C1A1A] text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
          }`}>
          Todos los locales
        </button>
        {locations.filter(l => l.active).map(l => (
          <button key={l.id} onClick={() => setFilterLoc(l.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              filterLoc === l.id
                ? 'bg-[#7C1A1A] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {l.name}
          </button>
        ))}
      </div>

      {/* Grupos */}
      {groups.lateArrivals.length > 0 && (
        <Section title="🚨 No han fichado y deberían estar trabajando" colorClass="border-red-200 bg-red-50/50">
          {groups.lateArrivals.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.forgotClockout.length > 0 && (
        <Section title="⚠️ Posible olvido de salida" colorClass="border-amber-200 bg-amber-50/50">
          {groups.forgotClockout.map(s => <EmpCard key={s.employee.id} status={s} />)}
        </Section>
      )}

      {groups.inside.length > 0 && (
        <Section title="✓ Trabajando ahora">
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
          <p className="text-5xl mb-3">👥</p>
          <p className="font-semibold text-gray-700">Sin empleados</p>
          <p className="text-xs text-gray-500 mt-1">No hay empleados activos en este local</p>
        </Card>
      )}
    </div>
  )
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function KpiCard({ color, label, value, icon }: { color: string; label: string; value: number; icon: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  }
  return (
    <Card className={`p-3 border ${colors[color] || colors.gray}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
        </div>
        <span className="text-2xl opacity-50">{icon}</span>
      </div>
    </Card>
  )
}

function Section({ title, children, colorClass }: { title: string; children: React.ReactNode; colorClass?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 mb-2">{title}</p>
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
      badge = { label: '✓ Dentro', cls: 'bg-emerald-100 text-emerald-700' }
      break
    case 'late_arrival':
      mainText = `Debía empezar a las ${s.theoretical.start}`
      subText = `${formatMinutes(s.minutesLate)} de retraso`
      badge = { label: '🚨 No fichó', cls: 'bg-red-100 text-red-700' }
      break
    case 'forgot_clockout':
      mainText = `Entró a las ${s.entryAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      subText = `Debía salir a las ${s.theoretical.end} · ${formatMinutes(s.minutesOver)} de exceso`
      badge = { label: '⚠️ Olvidó salir', cls: 'bg-amber-100 text-amber-700' }
      break
    case 'pending_arrival':
      mainText = `Empieza a las ${s.theoretical.start}`
      subText = s.minutesEarly > 0
        ? `Quedan ${formatMinutes(s.minutesEarly)}`
        : `Hace ${formatMinutes(-s.minutesEarly)} (todavía dentro de margen)`
      badge = { label: '○ Pendiente', cls: 'bg-gray-100 text-gray-600' }
      break
    case 'finished':
      mainText = `Terminó a las ${s.lastExitAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      subText = 'Jornada completada'
      badge = { label: '✓ Hecho', cls: 'bg-blue-100 text-blue-700' }
      break
    case 'no_scheduled':
      mainText = 'Sin horario asignado hoy'
      subText = ''
      badge = { label: '— Libre', cls: 'bg-gray-100 text-gray-500' }
      break
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-[#F5E9D9] flex items-center justify-center">
          <span className="text-sm font-bold text-[#7C1A1A]">{initials || '?'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 text-sm">{employee.name || 'Sin nombre'}</p>
            <span className="text-xs text-gray-400">{employee.position || '—'}</span>
            {primaryLoc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{primaryLoc.name}</span>}
          </div>
          <p className="text-sm text-gray-700 mt-0.5">{mainText}</p>
          {subText && <p className="text-xs text-gray-500">{subText}</p>}
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
