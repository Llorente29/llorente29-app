import { useState, useEffect } from 'react'
import { Download, Settings, CheckCircle2, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, Card, Label, Input, Alert } from '../components/ui'
import { fetchVacations } from '../services/vacationsService'
import { exportPersonalReportCsv } from '../services/exportGestoriaService'
import type { VacationRequest } from '../types/personal'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function InformesPage() {
  const { staff, locations, gestoriaConfig, saveGestoriaConfig } = useApp()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [generating, setGenerating] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [allVacations, setAllVacations] = useState<VacationRequest[]>([])

  useEffect(() => {
    let cancel = false
    fetchVacations().then(list => {
      if (cancel) return
      setAllVacations(list || [])
    })
    return () => { cancel = true }
  }, [])

  const dateFrom = new Date(year, month - 1, 1).toISOString().slice(0, 10)
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

  const report = staff.map(e => {
    const entries = e.clockEntries.filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
    let hours = 0
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'entrada' && entries[i - 1]?.type === 'salida') {
        hours += (new Date(entries[i - 1].datetime).getTime() - new Date(entries[i].datetime).getTime()) / 3600000
      }
    }
    const empVacs = allVacations.filter(v => v.employeeId === e.id)
    const abs = empVacs.filter(v => v.startDate <= dateTo && v.endDate >= dateFrom)
    const approved = abs.filter(v => v.status === 'aprobada')
    return {
      ...e,
      periodEntries: entries,
      totalHours: hours.toFixed(1),
      diasTrabajados: new Set(entries.map(c => c.datetime.slice(0, 10))).size,
      vacaciones: approved.filter(v => v.type === 'vacaciones'),
      bajas:      approved.filter(v => v.type === 'baja_medica'),
      permisos:   approved.filter(v =>
        v.type === 'asuntos_propios' ||
        v.type === 'permiso_matrimonio' ||
        v.type === 'permiso_fallecimiento' ||
        v.type === 'permiso_mudanza' ||
        v.type === 'otro'
      ),
    }
  })

  async function downloadCsv() {
    setGenerating(true)
    setDownloaded(false)
    try {
      await exportPersonalReportCsv({
        employees: staff,
        locations,
        periodStart: dateFrom,
        periodEnd: dateTo,
        periodLabel: `${MESES[month - 1]} ${year}`,
      })
      await saveGestoriaConfig({ lastSentAt: new Date().toISOString() })
      setDownloaded(true)
    } finally {
      setGenerating(false)
    }
  }

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1]
  const dayOfMonth = gestoriaConfig?.dayOfMonth ?? 25
  const enabled = gestoriaConfig?.enabled ?? false
  const lastSentAt = gestoriaConfig?.lastSentAt

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-accent">Informes Gestoría</h1>
        <p className="text-sm text-text-secondary mt-0.5">Resumen mensual de personal para envío a gestoría</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: report */}
        <div className="lg:col-span-2 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-page rounded-xl border border-border-default">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary">Mes</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                className="border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary">
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary">Año</label>
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                className="border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary">
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {downloaded && (
                <span className="inline-flex items-center gap-1 text-xs text-success font-medium">
                  <CheckCircle2 size={14} /> Descargado
                </span>
              )}
              <Button size="sm" onClick={downloadCsv} disabled={generating}>
                <span className="inline-flex items-center gap-1.5">
                  {generating ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                  {generating ? 'Generando...' : 'Descargar CSV'}
                </span>
              </Button>
            </div>
          </div>

          {/* Table */}
          <Card>
            <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
              <h3 className="font-semibold text-sm text-text-primary">{MESES[month - 1]} {year} — Resumen</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border-default bg-page">
                  <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
                  <th className="p-3 text-center text-xs font-semibold text-text-secondary">Días trab.</th>
                  <th className="p-3 text-center text-xs font-semibold text-text-secondary">Horas</th>
                  <th className="p-3 text-center text-xs font-semibold text-text-secondary">Vacac.</th>
                  <th className="p-3 text-center text-xs font-semibold text-text-secondary">Bajas</th>
                  <th className="p-3 text-center text-xs font-semibold text-text-secondary">Permisos</th>
                </tr></thead>
                <tbody>
                  {report.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-text-secondary text-sm">Sin empleados registrados</td></tr>
                  ) : report.map(e => (
                    <tr key={e.id} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                      <td className="p-3">
                        <p className="font-medium text-text-primary">{e.name}</p>
                        <p className="text-xs text-text-secondary">{e.position}</p>
                      </td>
                      <td className="p-3 text-center text-text-primary">{e.diasTrabajados}</td>
                      <td className="p-3 text-center font-medium text-text-primary">{e.totalHours}h</td>
                      <td className="p-3 text-center">
                        {e.vacaciones.length > 0
                          ? <span className="text-xs bg-accent-bg text-accent px-2 py-0.5 rounded-full">{e.vacaciones.length}</span>
                          : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {e.bajas.length > 0
                          ? <span className="text-xs bg-danger-bg text-danger px-2 py-0.5 rounded-full">{e.bajas.length}</span>
                          : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {e.permisos.length > 0
                          ? <span className="text-xs bg-warning-bg text-warning px-2 py-0.5 rounded-full">{e.permisos.length}</span>
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-text-secondary border-t border-border-default">
              La tabla es un resumen rápido. El CSV es el informe oficial.
            </p>
          </Card>
        </div>

        {/* Right: config */}
        <Card className="p-4 space-y-4 h-fit">
          <div>
            <h3 className="font-semibold text-sm text-text-primary inline-flex items-center gap-1.5">
              <Settings size={16} /> Configuración gestoría
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">Envío automático el día {dayOfMonth} de cada mes</p>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Nombre gestoría</Label>
              <Input
                className="mt-1"
                value={gestoriaConfig?.gestoriaNombre ?? ''}
                onChange={e => saveGestoriaConfig({ gestoriaNombre: e.target.value })}
                placeholder="Gestoría López S.L."
                disabled={!gestoriaConfig}
              />
            </div>
            <div>
              <Label>Email gestoría</Label>
              <Input
                className="mt-1"
                type="email"
                value={gestoriaConfig?.gestoriaEmail ?? ''}
                onChange={e => saveGestoriaConfig({ gestoriaEmail: e.target.value })}
                placeholder="gestoria@ejemplo.com"
                disabled={!gestoriaConfig}
              />
            </div>
            <div>
              <Label>Día de envío</Label>
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={e => saveGestoriaConfig({ dayOfMonth: parseInt(e.target.value) || 25 })}
                disabled={!gestoriaConfig}
              />
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-page border border-border-default">
              <input
                type="checkbox"
                id="gest-on"
                checked={enabled}
                onChange={e => saveGestoriaConfig({ enabled: e.target.checked })}
                disabled={!gestoriaConfig}
                className="accent-accent"
              />
              <label htmlFor="gest-on" className="text-sm cursor-pointer text-text-primary">
                Activar envío automático el día {dayOfMonth}
              </label>
            </div>
            <Alert type="warning">
              El envío automático requiere integración SMTP/EmailJS. Por ahora el informe se descarga en CSV listo para adjuntar.
            </Alert>
          </div>
          <div className="pt-2 border-t border-border-default text-xs text-text-secondary inline-flex items-center gap-1.5">
            {enabled
              ? <><CheckCircle2 size={12} className="text-success" /> Envío automático activo</>
              : <>Desactivado</>}
            <span>· Último envío: {lastSentAt ? new Date(lastSentAt).toLocaleDateString('es-ES') : 'Nunca'}</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
