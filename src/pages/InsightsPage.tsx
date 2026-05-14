// src/pages/InsightsPage.tsx
// Dashboard de personal: cumpleaños, aniversarios, eventos próximos,
// distribuciones por local/contrato/puesto, KPIs operativos.

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  HeartPulse,
  Sun,
  GraduationCap,
  TrendingDown,
  Cake,
  Trophy,
  Calendar,
  ShieldCheck,
  Ban,
  AlertTriangle,
  BookOpen,
  BarChart3,
  FileText,
  Briefcase,
  type LucideIcon,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import type { Employee } from '../types'
import type { VacationRequest, Formation } from '../types/personal'
import { VACATION_TYPES, FORMATION_CATALOG } from '../types/personal'
import { fetchVacations } from '../services/vacationsService'
import { fetchAllFormations, getFormationStatus } from '../services/formationsService'

/* =====================================================
   TIPOS Y HELPERS
   ===================================================== */

interface BirthdayItem {
  employee: Employee
  day: number          // día del mes
  isToday: boolean
}

interface AnniversaryItem {
  employee: Employee
  day: number
  years: number
  isToday: boolean
}

interface ExpiringEvent {
  employeeId: string
  employeeName: string
  type: 'contract' | 'trial'
  label: string
  daysLeft: number
  urgency: 'red' | 'orange' | 'yellow'
}

interface DistributionItem {
  label: string
  count: number
  percentage: number
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function isoDateNoon(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

function todayDate(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/* =====================================================
   COMPONENTE PRINCIPAL
   ===================================================== */

export default function InsightsPage() {
  const { staff, locations } = useApp()
  const [vacations, setVacations] = useState<VacationRequest[]>([])
  const [formations, setFormations] = useState<Formation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const [v, f] = await Promise.all([
        fetchVacations(),
        fetchAllFormations(),
      ])
      if (alive) {
        setVacations(v || [])
        setFormations(f || [])
        setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  const today = todayDate()
  const currentMonth = today.getMonth()      // 0-11
  const currentYear = today.getFullYear()

  /* ─── BLOQUE 1: PERSONAS ──────────────────────────── */

  const birthdays: BirthdayItem[] = useMemo(() => {
    const items: BirthdayItem[] = []
    for (const emp of staff) {
      if (!emp.active || !emp.birthDate) continue
      const birth = isoDateNoon(emp.birthDate)
      if (birth.getMonth() === currentMonth) {
        items.push({
          employee: emp,
          day: birth.getDate(),
          isToday: birth.getDate() === today.getDate(),
        })
      }
    }
    return items.sort((a, b) => a.day - b.day)
  }, [staff, currentMonth, today])

  const anniversaries: AnniversaryItem[] = useMemo(() => {
    const items: AnniversaryItem[] = []
    for (const emp of staff) {
      if (!emp.active || !emp.startDate) continue
      const start = isoDateNoon(emp.startDate)
      // Aniversario se cumple cada año en el mismo día/mes
      if (start.getMonth() === currentMonth) {
        const years = currentYear - start.getFullYear()
        if (years >= 1) {
          items.push({
            employee: emp,
            day: start.getDate(),
            years,
            isToday: start.getDate() === today.getDate(),
          })
        }
      }
    }
    return items.sort((a, b) => a.day - b.day)
  }, [staff, currentMonth, currentYear, today])

  const expiringEvents: ExpiringEvent[] = useMemo(() => {
    const events: ExpiringEvent[] = []
    for (const emp of staff) {
      if (!emp.active) continue
      // Fin contrato
      if (emp.endDate) {
        const endDate = isoDateNoon(emp.endDate)
        const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / 86400000)
        if (daysLeft >= 0 && daysLeft <= 30) {
          events.push({
            employeeId: emp.id,
            employeeName: emp.name || '(sin nombre)',
            type: 'contract',
            label: 'Fin de contrato',
            daysLeft,
            urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
          })
        }
      }
      // Fin periodo de prueba
      if (emp.startDate && emp.trialPeriodDays && emp.trialPeriodDays > 0) {
        const start = isoDateNoon(emp.startDate)
        const trialEnd = new Date(start)
        trialEnd.setDate(trialEnd.getDate() + emp.trialPeriodDays)
        const daysLeft = Math.floor((trialEnd.getTime() - today.getTime()) / 86400000)
        if (daysLeft >= 0 && daysLeft <= 30) {
          events.push({
            employeeId: emp.id,
            employeeName: emp.name || '(sin nombre)',
            type: 'trial',
            label: 'Fin periodo de prueba',
            daysLeft,
            urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'orange' : 'yellow',
          })
        }
      }
    }
    return events.sort((a, b) => a.daysLeft - b.daysLeft)
  }, [staff, today])

  /* ─── BLOQUE 2: ESTADO PLANTILLA ──────────────────── */

  const activeStaff = useMemo(() => staff.filter(e => e.active), [staff])

  const staffByLocation: DistributionItem[] = useMemo(() => {
    return computeDistribution(
      activeStaff,
      e => locations.find(l => l.id === e.locationId)?.name || '(Sin local)'
    )
  }, [activeStaff, locations])

  const staffByContract: DistributionItem[] = useMemo(() => {
    return computeDistribution(activeStaff, e => e.contractType || '(Sin contrato)')
  }, [activeStaff])

  const staffByPosition: DistributionItem[] = useMemo(() => {
    return computeDistribution(activeStaff, e => e.position || '(Sin puesto)')
  }, [activeStaff])

  /* ─── BLOQUE 3: KPIS OPERATIVOS ───────────────────── */

  const workingNow = useMemo(() => {
    return activeStaff.filter(e => e.clockEntries[0]?.type === 'entrada')
  }, [activeStaff])

  const sickToday = useMemo(() => {
    const todayISO = today.toISOString().slice(0, 10)
    return vacations.filter(v =>
      v.status === 'aprobada' &&
      v.type === 'baja_medica' &&
      v.startDate <= todayISO &&
      v.endDate >= todayISO
    )
  }, [vacations, today])

  const vacationsThisMonth = useMemo(() => {
    const monthStart = new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10)
    const monthEnd = new Date(currentYear, currentMonth + 1, 0).toISOString().slice(0, 10)
    return vacations.filter(v =>
      v.status === 'aprobada' &&
      v.type !== 'baja_medica' &&
      v.startDate <= monthEnd &&
      v.endDate >= monthStart
    ).sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [vacations, currentMonth, currentYear])

  const turnoverLast12Months = useMemo(() => {
    const cutoff = new Date(today)
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    const cutoffISO = cutoff.toISOString().slice(0, 10)
    return staff.filter(e => !e.active && e.endDate && e.endDate >= cutoffISO)
  }, [staff, today])

  // Formaciones que necesitan acción: caducadas o caducan en próximos 30 días
  const expiringFormations = useMemo(() => {
    const items: Array<{ formation: Formation; statusInfo: ReturnType<typeof getFormationStatus> }> = []
    for (const f of formations) {
      const info = getFormationStatus(f)
      if (info.status === 'caducada' || info.status === 'caduca_urgente' || info.status === 'caduca_critico' || info.status === 'caduca_pronto') {
        // Solo de empleados activos
        const emp = staff.find(e => e.id === f.employeeId)
        if (emp?.active) {
          items.push({ formation: f, statusInfo: info })
        }
      }
    }
    // Ordenar: peores primero (caducadas, luego urgentes, etc.)
    const order: Record<string, number> = {
      caducada: 0,
      caduca_urgente: 1,
      caduca_critico: 2,
      caduca_pronto: 3,
    }
    items.sort((a, b) => (order[a.statusInfo.status] ?? 9) - (order[b.statusInfo.status] ?? 9))
    return items
  }, [formations, staff])

  /* ─── HELPERS DE VISUALIZACIÓN ────────────────────── */

  function findEmployee(id: string): Employee | undefined {
    return staff.find(e => e.id === id)
  }

  function typeLabel(t: string): string {
    return VACATION_TYPES.find(x => x.id === t)?.label || t
  }

  /* ─── RENDER ─────────────────────────────────────── */

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="p-8 text-center text-text-secondary">Cargando insights...</Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ─── KPIs OPERATIVOS (arriba, lo más relevante hoy) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard Icon={Activity} label="Trabajando ahora" value={workingNow.length} accent="success" />
        <KpiCard Icon={HeartPulse} label="Bajas activas" value={sickToday.length} accent="danger" />
        <KpiCard Icon={Sun} label="Vacaciones este mes" value={vacationsThisMonth.length} accent="accent" />
        <KpiCard Icon={GraduationCap} label="Formaciones por renovar" value={expiringFormations.length} accent="warning" />
        <KpiCard Icon={TrendingDown} label="Bajas últ. 12 meses" value={turnoverLast12Months.length} accent="warning" />
      </div>

      {/* ─── TRABAJANDO AHORA: avatares ───────────── */}
      {workingNow.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <Activity size={14} className="text-success" /> Trabajando ahora ({workingNow.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {workingNow.map(e => (
              <div key={e.id} className="flex items-center gap-2 bg-success-bg border border-success/30 rounded-full pl-1 pr-3 py-1">
                <MiniAvatar employee={e} />
                <span className="text-xs text-success font-medium">{e.name?.split(' ')[0] || '?'}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── BLOQUE 1: PERSONAS ────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Cumpleaños */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <Cake size={14} className="text-accent" /> Cumpleaños · {MONTHS[currentMonth]}
          </h3>
          {birthdays.length === 0 ? (
            <p className="text-xs text-text-secondary italic">Sin cumpleaños este mes.</p>
          ) : (
            <div className="space-y-2">
              {birthdays.map((b, i) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded ${b.isToday ? 'bg-warning-bg border border-warning/30' : ''}`}>
                  <MiniAvatar employee={b.employee} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate text-text-primary">{b.employee.name}</p>
                    {b.isToday && <p className="text-[11px] text-warning font-bold">¡HOY!</p>}
                  </div>
                  <span className="text-xs text-text-secondary font-mono">día {b.day}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Aniversarios laborales */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <Trophy size={14} className="text-accent" /> Aniversarios laborales · {MONTHS[currentMonth]}
          </h3>
          {anniversaries.length === 0 ? (
            <p className="text-xs text-text-secondary italic">Sin aniversarios este mes.</p>
          ) : (
            <div className="space-y-2">
              {anniversaries.map((a, i) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded ${a.isToday ? 'bg-warning-bg border border-warning/30' : ''}`}>
                  <MiniAvatar employee={a.employee} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate text-text-primary">{a.employee.name}</p>
                    <p className="text-[11px] text-text-secondary">{a.years} {a.years === 1 ? 'año' : 'años'} en la empresa</p>
                  </div>
                  <span className="text-xs text-text-secondary font-mono">día {a.day}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Eventos próximos */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
          <Calendar size={14} className="text-accent" /> Eventos próximos (30 días)
        </h3>
        {expiringEvents.length === 0 ? (
          <p className="text-xs text-text-secondary italic">No hay eventos próximos.</p>
        ) : (
          <div className="space-y-1.5">
            {expiringEvents.map((ev, i) => {
              const emp = findEmployee(ev.employeeId)
              const EvIcon = ev.type === 'trial' ? ShieldCheck : Calendar
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2 rounded border ${
                    ev.urgency === 'red' ? 'border-danger/30 bg-danger-bg' :
                    ev.urgency === 'orange' ? 'border-warning/30 bg-warning-bg' :
                    'border-warning/30 bg-warning-bg'
                  }`}
                >
                  {emp && <MiniAvatar employee={emp} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-text-primary">{ev.employeeName}</p>
                    <p className="text-[11px] text-text-secondary inline-flex items-center gap-1">
                      <EvIcon size={11} /> {ev.label}
                    </p>
                  </div>
                  <span className={`text-xs font-bold ${
                    ev.urgency === 'red' ? 'text-danger' :
                    ev.urgency === 'orange' ? 'text-warning' :
                    'text-warning'
                  }`}>
                    {ev.daysLeft === 0 ? 'HOY' : ev.daysLeft === 1 ? 'mañana' : `${ev.daysLeft}d`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ─── BLOQUE 2: ESTADO PLANTILLA con gráficos ─── */}
      <div className="grid md:grid-cols-3 gap-3">
        <DistributionCard
          title="Por local"
          TitleIcon={BarChart3}
          items={staffByLocation}
          total={activeStaff.length}
          accentColor="var(--color-accent)"
        />
        <DistributionCard
          title="Por contrato"
          TitleIcon={FileText}
          items={staffByContract}
          total={activeStaff.length}
          accentColor="var(--color-warning)"
        />
        <DistributionCard
          title="Por puesto"
          TitleIcon={Briefcase}
          items={staffByPosition}
          total={activeStaff.length}
          accentColor="var(--color-success)"
        />
      </div>

      {/* ─── BAJAS MÉDICAS DETALLE ─── */}
      {sickToday.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <HeartPulse size={14} className="text-danger" /> Bajas médicas activas hoy
          </h3>
          <div className="space-y-2">
            {sickToday.map(v => {
              const emp = findEmployee(v.employeeId)
              return (
                <div key={v.id} className="flex items-center gap-2 p-2 rounded bg-danger-bg border border-danger/30">
                  {emp && <MiniAvatar employee={emp} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-text-primary">{emp?.name || '(empleado borrado)'}</p>
                    <p className="text-[11px] text-danger">
                      Desde {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES')} hasta {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES')}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ─── VACACIONES DEL MES DETALLE ─── */}
      {vacationsThisMonth.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <Sun size={14} className="text-accent" /> Vacaciones este mes
          </h3>
          <div className="space-y-2">
            {vacationsThisMonth.map(v => {
              const emp = findEmployee(v.employeeId)
              return (
                <div key={v.id} className="flex items-center gap-2 p-2 rounded bg-accent-bg border border-accent/30">
                  {emp && <MiniAvatar employee={emp} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-text-primary">{emp?.name || '(empleado borrado)'}</p>
                    <p className="text-[11px] text-accent">
                      {typeLabel(v.type)} · {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      {' – '}
                      {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                  <span className="text-xs text-accent font-mono">{v.days}d</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ─── FORMACIONES POR RENOVAR ─── */}
      {expiringFormations.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <GraduationCap size={14} className="text-warning" /> Formaciones por renovar ({expiringFormations.length})
          </h3>
          <div className="space-y-1.5">
            {expiringFormations.map(({ formation, statusInfo }, i) => {
              const emp = findEmployee(formation.employeeId)
              const catalog = FORMATION_CATALOG.find(c => c.id === formation.type)
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2 rounded border ${
                    statusInfo.color === 'red' ? 'border-danger/30 bg-danger-bg' :
                    statusInfo.color === 'orange' ? 'border-warning/30 bg-warning-bg' :
                    'border-warning/30 bg-warning-bg'
                  }`}
                >
                  {emp && <MiniAvatar employee={emp} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-text-primary">
                      {emp?.name || '(empleado borrado)'}
                    </p>
                    <p className="text-[11px] text-text-secondary truncate inline-flex items-center gap-1">
                      <BookOpen size={11} /> {formation.name}
                      {catalog?.mandatory && (
                        <span className="ml-1.5 text-[9px] font-bold text-danger">OBLIG.</span>
                      )}
                    </p>
                  </div>
                  <span className={`text-xs font-bold inline-flex items-center gap-1 ${
                    statusInfo.color === 'red' ? 'text-danger' :
                    statusInfo.color === 'orange' ? 'text-warning' :
                    'text-warning'
                  }`}>
                    {statusInfo.status === 'caducada'
                      ? <><Ban size={11} /> Caducada</>
                      : <><AlertTriangle size={11} /> {statusInfo.daysLeft}d</>}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ─── ROTACIÓN 12 MESES DETALLE ─── */}
      {turnoverLast12Months.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
            <TrendingDown size={14} className="text-warning" /> Bajas últimos 12 meses ({turnoverLast12Months.length})
          </h3>
          <div className="space-y-2">
            {turnoverLast12Months.map(e => (
              <div key={e.id} className="flex items-center gap-2 p-2 rounded bg-page border border-border-default">
                <MiniAvatar employee={e} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-text-primary">{e.name}</p>
                  <p className="text-[11px] text-text-secondary">
                    {e.terminationType ? `${e.terminationType} · ` : ''}
                    {e.endDate && `Baja ${new Date(e.endDate + 'T00:00:00').toLocaleDateString('es-ES')}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/* =====================================================
   COMPONENTES AUXILIARES
   ===================================================== */

function KpiCard({
  Icon,
  label,
  value,
  accent,
}: {
  Icon: LucideIcon
  label: string
  value: number
  accent: 'success' | 'danger' | 'accent' | 'warning'
}) {
  const colorMap = {
    success: 'text-success',
    danger: 'text-danger',
    accent: 'text-accent',
    warning: 'text-warning',
  }
  return (
    <Card className="p-3 text-center">
      <div className="flex justify-center">
        <Icon size={20} className={colorMap[accent]} />
      </div>
      <p className={`text-3xl font-bold mt-1 ${colorMap[accent]}`}>{value}</p>
      <p className="text-[11px] text-text-secondary uppercase tracking-wide mt-0.5">{label}</p>
    </Card>
  )
}

function MiniAvatar({ employee }: { employee: Employee }) {
  const initial = employee.name ? employee.name.trim()[0]?.toUpperCase() : '?'
  if (employee.photo) {
    return (
      <img
        src={employee.photo}
        alt={employee.name}
        className="w-8 h-8 rounded-full object-cover border-2 border-card shadow-sm shrink-0"
      />
    )
  }
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-sm border-2 border-card shadow-sm shrink-0"
      style={{ backgroundColor: 'var(--color-accent)' }}
    >
      {initial}
    </div>
  )
}

function DistributionCard({
  title,
  TitleIcon,
  items,
  total,
  accentColor,
}: {
  title: string
  TitleIcon: LucideIcon
  items: DistributionItem[]
  total: number
  accentColor: string
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3 inline-flex items-center gap-1.5">
        <TitleIcon size={14} className="text-accent" /> {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-text-secondary italic">Sin datos.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-text-primary truncate flex-1 pr-2">{item.label}</span>
                <span className="text-text-secondary font-mono shrink-0">{item.count}</span>
              </div>
              <div className="h-2 bg-accent-bg rounded-full overflow-hidden">
                <div
                  className="h-full transition-base"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </div>
            </div>
          ))}
          <p className="text-[10px] text-text-secondary text-right pt-1">Total: {total}</p>
        </div>
      )}
    </Card>
  )
}

/* =====================================================
   UTILIDAD: cálculo de distribución
   ===================================================== */

function computeDistribution(
  items: Employee[],
  groupBy: (e: Employee) => string
): DistributionItem[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = groupBy(item)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const total = items.length
  if (total === 0) return []
  const result: DistributionItem[] = []
  for (const [label, count] of counts.entries()) {
    result.push({
      label,
      count,
      percentage: Math.round((count / total) * 100),
    })
  }
  return result.sort((a, b) => b.count - a.count)
}
