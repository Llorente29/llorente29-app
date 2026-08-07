// src/pages/PlantillaPage.tsx
// F4.2 — Plantilla: tabla de horas/coste real de la cuenta, estilo Sesame/Bizneo.
// Consume team_hours_summary (RPC, verificado 07/08). Balance con semáforo,
// coste real gateado por show_salaries. Clic en fila -> ficha del empleado.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Euro, Clock, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useActiveAccount } from '../modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import { Card } from '../components/ui'
import PeriodFilter, { makePeriodValue, type PeriodValue } from '../components/team/PeriodFilter'
import { fetchTeamHoursSummary, type TeamHoursSummaryRow } from '../services/teamHoursService'
import { fetchSalesByLocation } from '../services/teamReportsService'
import { toISODate } from '../types/scheduler'

// Balance (delta_hours = trabajado+ausencia_pagada - contratado): rojo si debe
// horas (déficit real), ámbar mientras está cerca de 0 (aún no es un colchón
// cómodo), verde a partir de ahí. Umbral de "cerca de 0" = 2h, elegido a mano
// (no viene del RPC); ajustar aquí si Julio quiere otro corte.
const DELTA_AMBER_THRESHOLD = 2

type SortKey = 'name' | 'contracted' | 'worked' | 'vacation' | 'night' | 'delta' | 'cost'
type SortDir = 'asc' | 'desc'

function deltaTone(delta: number): 'danger' | 'warning' | 'success' {
  if (delta < 0) return 'danger'
  if (delta < DELTA_AMBER_THRESHOLD) return 'warning'
  return 'success'
}

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const hrs = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })}h`

export default function PlantillaPage() {
  const { staff, locations } = useApp()
  const { activeAccountId } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const { hasPermission } = usePermissions()
  const canSeeSalaries = hasPermission('show_salaries')
  const navigate = useNavigate()

  const [period, setPeriod] = useState<PeriodValue>(() => makePeriodValue('mensual', toISODate(new Date())))
  const [rows, setRows] = useState<TeamHoursSummaryRow[]>([])
  const [salesTotal, setSalesTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    setLoading(true)
    Promise.all([
      fetchTeamHoursSummary(activeAccountId, period.from, period.to, resolvedLocationId ?? undefined),
      fetchSalesByLocation(activeAccountId, period.from, period.to),
    ]).then(([summary, sales]) => {
      if (cancel) return
      setRows(summary)
      const relevantSales = resolvedLocationId
        ? sales.filter(s => s.locationId === resolvedLocationId)
        : sales
      setSalesTotal(relevantSales.reduce((acc, s) => acc + s.ventas, 0))
      setLoading(false)
    })
    return () => { cancel = true }
  }, [activeAccountId, period.from, period.to, resolvedLocationId])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sortedRows = useMemo(() => {
    const list = [...rows]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.employeeName.localeCompare(b.employeeName, 'es')
        case 'contracted': return dir * (a.contractedHours - b.contractedHours)
        case 'worked': return dir * (a.workedHours - b.workedHours)
        case 'vacation': return dir * (a.vacationHours - b.vacationHours)
        case 'night': return dir * (a.nightHours - b.nightHours)
        case 'delta': return dir * (a.deltaHours - b.deltaHours)
        case 'cost': return dir * (a.laborCost - b.laborCost)
      }
    })
    return list
  }, [rows, sortKey, sortDir])

  const stats = useMemo(() => {
    const totalCost = rows.reduce((acc, r) => acc + r.laborCost, 0)
    const totalWorked = rows.reduce((acc, r) => acc + r.workedHours, 0)
    const partialCount = rows.filter(r => r.costIsPartial).length
    const negativeCount = rows.filter(r => r.deltaHours < 0).length
    const pctSales = salesTotal && salesTotal > 0 ? (totalCost / salesTotal) * 100 : null
    return { totalCost, totalWorked, partialCount, negativeCount, pctSales }
  }, [rows, salesTotal])

  const showLocationColumn = !resolvedLocationId
  const locName = (id: string) => locations.find(l => l.id === id)?.name || '—'

  function goToFicha(employeeId: string) {
    navigate(`/personal?employee=${employeeId}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl text-accent">Plantilla</h1>
          <p className="text-sm text-text-secondary mt-0.5">Horas y coste real por empleado · {period.label}</p>
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {/* Cabecera de dinero: agregado de cuenta/local, NUNCA por empleado
          (no se puede atribuir venta a una persona sin inventar). */}
      <div className={`grid gap-3 ${canSeeSalaries ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-2'}`}>
        <Card className="p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary inline-flex items-center gap-1.5"><Users size={12} /> Empleados</p>
          <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{rows.length}</p>
          {stats.negativeCount > 0 && (
            <p className="text-xs text-danger mt-0.5">{stats.negativeCount} con bolsa negativa</p>
          )}
        </Card>
        <Card className="p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary inline-flex items-center gap-1.5"><Clock size={12} /> Horas trabajadas</p>
          <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{hrs(stats.totalWorked)}</p>
        </Card>
        {canSeeSalaries && (
          <>
            <Card className="p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary inline-flex items-center gap-1.5"><Euro size={12} /> Coste laboral</p>
              <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{eur(stats.totalCost)}</p>
              {stats.partialCount > 0 && (
                <p className="text-xs text-warning mt-0.5 inline-flex items-center gap-1"><AlertTriangle size={11} /> {stats.partialCount} con nómina incompleta</p>
              )}
            </Card>
            <Card className="p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">% personal / ventas</p>
              <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{stats.pctSales == null ? '—' : `${stats.pctSales.toFixed(1)}%`}</p>
              <p className="text-xs text-text-secondary mt-0.5">ventas {salesTotal == null ? '—' : eur(salesTotal)}</p>
            </Card>
          </>
        )}
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Cargando plantilla…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Sin empleados activos con datos en este periodo.</Card>
      ) : (
        <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page">
              <tr>
                <Th label="Empleado" sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} align="left" sticky />
                {showLocationColumn && <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Local</th>}
                <Th label="Contratadas" sortKey="contracted" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Trabajadas" sortKey="worked" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Vacaciones" sortKey="vacation" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Nocturnas" sortKey="night" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Balance" sortKey="delta" active={sortKey} dir={sortDir} onSort={toggleSort} />
                {canSeeSalaries && <Th label="Coste real" sortKey="cost" active={sortKey} dir={sortDir} onSort={toggleSort} />}
                {canSeeSalaries && <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Estado</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const tone = deltaTone(r.deltaHours)
                const ToneIcon = tone === 'danger' ? TrendingDown : tone === 'warning' ? Minus : TrendingUp
                const emp = staff.find(e => e.id === r.employeeId)
                const initials = (r.employeeName || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
                return (
                  <tr
                    key={r.employeeId}
                    onClick={() => goToFicha(r.employeeId)}
                    className="border-b border-border-default hover:bg-page cursor-pointer transition-base"
                  >
                    <td className="px-3 py-2 sticky left-0 bg-card">
                      <div className="flex items-center gap-2">
                        {emp?.photo ? (
                          <img src={emp.photo} alt={r.employeeName} className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-accent-bg text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">{initials}</span>
                        )}
                        <span className="font-medium text-text-primary truncate">{r.employeeName}</span>
                      </div>
                    </td>
                    {showLocationColumn && <td className="px-3 py-2 text-text-secondary text-xs">{locName(r.locationId)}</td>}
                    <td className="px-3 py-2 tabular-nums text-text-secondary">{hrs(r.contractedHours)}</td>
                    <td className="px-3 py-2 tabular-nums text-text-primary">{hrs(r.workedHours)}</td>
                    <td className="px-3 py-2 tabular-nums text-text-secondary">{r.vacationHours > 0 ? hrs(r.vacationHours) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-text-secondary">{r.nightHours > 0 ? hrs(r.nightHours) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                        tone === 'danger' ? 'bg-danger-bg text-danger' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'
                      }`}>
                        <ToneIcon size={11} /> {r.deltaHours > 0 ? '+' : ''}{hrs(r.deltaHours)}
                      </span>
                    </td>
                    {canSeeSalaries && <td className="px-3 py-2 tabular-nums text-text-primary">{eur(r.laborCost)}</td>}
                    {canSeeSalaries && (
                      <td className="px-3 py-2">
                        {r.costIsPartial ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning-bg text-warning">
                            <AlertTriangle size={10} /> Coste estimado
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-xs">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({
  label, sortKey, active, dir, onSort, align = 'right', sticky = false,
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
  sticky?: boolean
}) {
  const isActive = active === sortKey
  const SortIcon = !isActive ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`px-3 py-2 text-xs font-semibold text-text-secondary select-none ${align === 'left' ? 'text-left' : 'text-right'} ${sticky ? 'sticky left-0 bg-page' : ''}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-text-primary transition-base ${isActive ? 'text-text-primary' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <SortIcon size={11} className={isActive ? 'opacity-100' : 'opacity-30'} />
      </button>
    </th>
  )
}
