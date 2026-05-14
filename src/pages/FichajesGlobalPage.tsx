import { useState } from 'react'
import { LogIn, LogOut, Users, Clock, Activity } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Badge, Card } from '../components/ui'

export default function FichajesGlobalPage() {
  const { staff, locations } = useApp()
  const today = new Date()
  const [dateFrom, setDateFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10))
  const [empFilter, setEmpFilter] = useState('')
  const [locFilter, setLocFilter] = useState('todas')

  const filtered = staff.filter(e =>
    (!empFilter || e.id === empFilter) &&
    (locFilter === 'todas' || e.locationId === locFilter)
  )

  const allEntries = filtered
    .flatMap(e => e.clockEntries
      .filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
      .map(c => ({ ...c, employeeName: e.name, employeePos: e.position, employeeId: e.id }))
    )
    .sort((a, b) => b.datetime.localeCompare(a.datetime))

  const summary = filtered.map(e => {
    const entries = e.clockEntries.filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
    let hours = 0
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'entrada' && entries[i - 1]?.type === 'salida') {
        hours += (new Date(entries[i - 1].datetime).getTime() - new Date(entries[i].datetime).getTime()) / 3600000
      }
    }
    return { ...e, totalEntries: entries.length, totalHours: hours.toFixed(1) }
  })

  const stats = [
    { label: 'Fichajes', val: allEntries.length, icon: Clock },
    { label: 'Empleados activos', val: filtered.filter(e => e.clockEntries.some(c => c.datetime >= dateFrom)).length, icon: Users },
    { label: 'Fichajes hoy', val: allEntries.filter(e => e.datetime.startsWith(today.toISOString().slice(0, 10))).length, icon: Activity },
    { label: 'Trabajando ahora', val: filtered.filter(e => e.clockEntries[0]?.type === 'entrada').length, icon: LogIn },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-accent">Control Horario</h1>
        <p className="text-sm text-text-secondary mt-0.5">{allEntries.length} fichajes en el periodo</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-page rounded-xl border border-border-default">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Desde</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Hasta</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Empleado</label>
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
            <option value="">Todos</option>
            {staff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Local</label>
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
            <option value="todas">Todos</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="p-4 rounded-lg border border-border-default bg-accent-bg text-accent">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={18} />
                <p className="text-2xl font-bold">{s.val}</p>
              </div>
              <p className="text-xs">{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Fichajes table */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
          <h3 className="font-semibold text-sm text-text-primary">Todos los fichajes</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border-default bg-page">
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Tipo</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Fecha y hora</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">Turno</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">GPS</th>
            </tr></thead>
            <tbody>
              {allEntries.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-text-secondary text-sm">Sin fichajes en este periodo</td></tr>
              ) : allEntries.map(e => (
                <tr key={e.id + e.datetime} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                  <td className="p-3">
                    <p className="font-medium text-sm text-text-primary">{e.employeeName}</p>
                    <p className="text-xs text-text-secondary">{e.employeePos}</p>
                  </td>
                  <td className="p-3">
                    <Badge color={e.type === 'entrada' ? 'green' : 'red'}>
                      <span className="inline-flex items-center gap-1">
                        {e.type === 'entrada' ? <LogIn size={12} /> : <LogOut size={12} />}
                        {e.type === 'entrada' ? 'Entrada' : 'Salida'}
                      </span>
                    </Badge>
                  </td>
                  <td className="p-3 text-text-primary">
                    <span className="font-medium">{new Date(e.datetime).toLocaleString('es-ES')}</span>
                    {e.roundingApplied && <Badge color="yellow" className="ml-1">redondeado</Badge>}
                    {!e.roundingApplied && (e.diffMinutes || 0) > 10 && <Badge color="red" className="ml-1">+{e.diffMinutes}min</Badge>}
                  </td>
                  <td className="p-3 text-xs text-text-secondary hidden sm:table-cell">{e.scheduled || '—'}</td>
                  <td className="p-3 text-xs text-text-secondary hidden sm:table-cell">{e.address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Summary table */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
          <h3 className="font-semibold text-sm text-text-primary">Resumen por empleado</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border-default bg-page">
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Fichajes</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Horas</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Estado</th>
            </tr></thead>
            <tbody>
              {summary.map(e => (
                <tr key={e.id} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                  <td className="p-3">
                    <p className="font-medium text-text-primary">{e.name}</p>
                    <p className="text-xs text-text-secondary">{e.position}</p>
                  </td>
                  <td className="p-3 text-center text-text-primary">{e.totalEntries}</td>
                  <td className="p-3 text-center font-medium text-text-primary">{e.totalHours}h</td>
                  <td className="p-3 text-center">
                    <Badge color={e.clockEntries[0]?.type === 'entrada' ? 'green' : 'gray'}>
                      {e.clockEntries[0]?.type === 'entrada' ? 'Dentro' : 'Fuera'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
