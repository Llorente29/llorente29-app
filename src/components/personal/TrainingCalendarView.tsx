// src/components/personal/TrainingCalendarView.tsx
// Formación — Onboarding, pieza 4: calendario de formación.
// docs/folvy_formacion_onboarding_diseno.md §3.4.
//
// Tres capas: qué vence (aún por hacer/firmar), qué caduca (vigente pero
// expira, interno + certificados externos), reevaluaciones (proyección por
// mes). Reutiliza training_gaps/training_compliance_matrix (C2) y
// fetchAllFormations/getFormationStatus (ya construidos) — nada de esto se
// recalcula de cero. Con 83 asignaciones vencidas hoy, la vista SIEMPRE
// agrupa por empleado, nunca una lista plana.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Card, Badge, Select } from '@/components/ui'
import {
  getTrainingGaps, getTrainingComplianceMatrix,
  type TrainingGap, type TrainingComplianceRow,
} from '@/services/trainingComplianceService'
import { listBlockingCourseIds } from '@/services/trainingPathService'
import { fetchAllFormations, getFormationStatus } from '@/services/formationsService'
import type { Formation } from '@/types/personal'

const GAP_DAYS_AHEAD = 30
const VENCE_KINDS: TrainingGap['gapKind'][] = ['nunca_hecho', 'sin_firmar', 'falta_practica']
const CADUCA_KINDS: TrainingGap['gapKind'][] = ['caducado', 'caduca_pronto']
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fmtDate(iso: string | null): string {
  if (!iso) return 'sin fecha'
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export default function TrainingCalendarView() {
  const { activeAccountId, staff, locations } = useApp()
  const [gaps, setGaps] = useState<TrainingGap[]>([])
  const [matrix, setMatrix] = useState<TrainingComplianceRow[]>([])
  const [formations, setFormations] = useState<Formation[]>([])
  const [blockingIds, setBlockingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [locationFilter, setLocationFilter] = useState<string>('todas')
  const [positionFilter, setPositionFilter] = useState<string>('todos')

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    setLoading(true)
    setLoadError(false)
    Promise.all([
      getTrainingGaps(activeAccountId, GAP_DAYS_AHEAD),
      getTrainingComplianceMatrix(activeAccountId),
      fetchAllFormations(),
      listBlockingCourseIds(),
    ])
      .then(([g, m, f, b]) => { if (!cancel) { setGaps(g); setMatrix(m); setFormations(f); setBlockingIds(b) } })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeAccountId])

  const empById = useMemo(() => new Map(staff.map(e => [e.id, e])), [staff])
  const locationById = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])
  const positions = useMemo(() => [...new Set(staff.map(e => e.position).filter(Boolean))].sort(), [staff])

  function passesFilter(employeeId: string): boolean {
    const emp = empById.get(employeeId)
    if (!emp) return true // sin ficha resuelta (raro) -> no lo escondemos por error de cruce
    if (locationFilter !== 'todas' && emp.locationId !== locationFilter) return false
    if (positionFilter !== 'todos' && emp.position !== positionFilter) return false
    return true
  }

  // Homónimos son reales (fichas distintas con el mismo nombre, en distinta
  // cuenta/local) — visto en producción con dos "Pamela Guzmán Velásquez"
  // (ids distintos, una en Sala y otra en Cocina). El Map de abajo agrupa por
  // employeeId (nunca por nombre: dos ids nunca comparten entrada aquí), pero
  // dos tarjetas con el mismo nombre y SIN nada más que las distinga eran
  // indistinguibles a la vista — de ahí el aviso. Cada tarjeta lleva ahora
  // puesto + local para que un vistazo baste.
  function employeeDetail(employeeId: string): string {
    const emp = empById.get(employeeId)
    if (!emp) return ''
    const loc = emp.locationId ? locationById.get(emp.locationId)?.name : null
    return [emp.position, loc].filter(Boolean).join(' · ')
  }

  const venceByEmployee = useMemo(() => {
    const map = new Map<string, { name: string; detail: string; items: TrainingGap[] }>()
    for (const g of gaps) {
      if (!VENCE_KINDS.includes(g.gapKind) || !passesFilter(g.employeeId)) continue
      const entry = map.get(g.employeeId) ?? { name: g.employeeName, detail: employeeDetail(g.employeeId), items: [] }
      entry.items.push(g)
      map.set(g.employeeId, entry)
    }
    for (const entry of map.values()) {
      entry.items.sort((a, b) => (a.dueAt ?? '9999') < (b.dueAt ?? '9999') ? -1 : 1)
    }
    return [...map.entries()].sort((a, b) => {
      const aBlocking = a[1].items.some(i => blockingIds.has(i.courseId))
      const bBlocking = b[1].items.some(i => blockingIds.has(i.courseId))
      if (aBlocking !== bBlocking) return aBlocking ? -1 : 1
      return b[1].items.length - a[1].items.length
    })
  }, [gaps, empById, locationById, locationFilter, positionFilter, blockingIds])

  const caducaInternal = useMemo(
    () => gaps.filter(g => CADUCA_KINDS.includes(g.gapKind) && passesFilter(g.employeeId)),
    [gaps, empById, locationFilter, positionFilter],
  )

  const caducaExternal = useMemo(() => {
    return formations
      .filter(f => passesFilter(f.employeeId))
      .map(f => ({ formation: f, status: getFormationStatus(f) }))
      .filter(({ status }) => status.status !== 'vigente' && status.status !== 'no_expira')
      .sort((a, b) => a.status.daysLeft - b.status.daysLeft)
  }, [formations, empById, locationFilter, positionFilter])

  const reevalByMonth = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const row of matrix) {
      if (!passesFilter(row.employeeId)) continue
      for (const cell of Object.values(row.courses)) {
        if (cell.state !== 'vigente' || !cell.expiresAt) continue
        const d = new Date(cell.expiresAt)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
    }
    const now = new Date()
    const months: { key: string; label: string; count: number }[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      months.push({ key, label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, count: buckets.get(key) ?? 0 })
    }
    return months
  }, [matrix, empById, locationFilter, positionFilter])

  if (!activeAccountId) return null

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-52">
          <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
            <option value="todas">Todos los locales</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div className="w-52">
          <Select value={positionFilter} onChange={e => setPositionFilter(e.target.value)}>
            <option value="todos">Todos los puestos</option>
            {positions.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
      </div>

      {loadError && (
        <Card className="p-4 text-sm text-danger">No se pudo cargar el calendario de formación. Reintenta o avisa si persiste.</Card>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Cargando calendario…</Card>
      ) : (
        <>
          {/* Capa 1 — Qué vence */}
          <section>
            <h2 className="font-display text-lg text-text-primary mb-1">Qué vence</h2>
            <p className="text-sm text-text-secondary mb-4">
              Formación asignada todavía por hacer o firmar. Agrupado por persona — los que tienen algo bloqueante van primero.
            </p>
            {venceByEmployee.length === 0 ? (
              <Card className="p-6 text-center text-sm text-text-secondary">Nadie tiene formación pendiente con este filtro.</Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {venceByEmployee.map(([employeeId, { name, detail, items }]) => {
                  const hasBlocking = items.some(i => blockingIds.has(i.courseId))
                  return (
                    <Card key={employeeId} className={`p-4 ${hasBlocking ? 'border-danger/40' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-text-primary truncate">{name}</p>
                          {detail && <p className="text-xs text-text-secondary truncate">{detail}</p>}
                        </div>
                        <Badge color={hasBlocking ? 'red' : 'gray'}>{items.length}</Badge>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {items.map((g, i) => (
                          <li key={i} className="text-xs text-text-secondary flex items-center justify-between gap-2">
                            <span className="truncate">
                              {blockingIds.has(g.courseId) && <span className="text-danger font-bold mr-1">●</span>}
                              {g.courseTitle}
                            </span>
                            <span className="shrink-0">{fmtDate(g.dueAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

          {/* Capa 2 — Qué caduca */}
          <section>
            <h2 className="font-display text-lg text-text-primary mb-1">Qué caduca</h2>
            <p className="text-sm text-text-secondary mb-4">Vigente hoy, pero con fecha de caducidad próxima o ya pasada — interno y certificados externos.</p>
            {caducaInternal.length === 0 && caducaExternal.length === 0 ? (
              <Card className="p-6 text-center text-sm text-text-secondary">Nada caducando con este filtro.</Card>
            ) : (
              <div className="space-y-2">
                {caducaInternal.map((g, i) => (
                  <Card key={`int-${i}`} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{g.employeeName} · {g.courseTitle}</p>
                      <p className="text-xs text-text-secondary truncate">
                        Formación interna{employeeDetail(g.employeeId) ? ` · ${employeeDetail(g.employeeId)}` : ''}
                      </p>
                    </div>
                    <Badge color={g.gapKind === 'caducado' ? 'red' : 'yellow'}>
                      {g.gapKind === 'caducado' ? 'Caducado' : g.daysLeft != null ? `${g.daysLeft} días` : 'Caduca pronto'}
                    </Badge>
                  </Card>
                ))}
                {caducaExternal.map(({ formation, status }, i) => (
                  <Card key={`ext-${i}`} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{empById.get(formation.employeeId)?.name ?? '—'} · {formation.name}</p>
                      <p className="text-xs text-text-secondary truncate">
                        Certificado externo{employeeDetail(formation.employeeId) ? ` · ${employeeDetail(formation.employeeId)}` : ''}
                      </p>
                    </div>
                    <Badge color={status.color === 'red' ? 'red' : status.color === 'orange' ? 'yellow' : 'yellow'}>{status.label}</Badge>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Capa 3 — Reevaluaciones (proyección) */}
          <section>
            <h2 className="font-display text-lg text-text-primary mb-1">Reevaluaciones próximas</h2>
            <p className="text-sm text-text-secondary mb-4">Cuántas formaciones vigentes hoy vencerán mes a mes — para planificar, no para actuar ya.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {reevalByMonth.map(m => (
                <Card key={m.key} className="p-3 text-center">
                  <p className="text-xs text-text-secondary uppercase tracking-wide">{m.label}</p>
                  <p className="font-display text-2xl text-text-primary mt-1">{m.count}</p>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
