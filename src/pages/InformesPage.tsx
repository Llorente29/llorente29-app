// src/pages/InformesPage.tsx
// F5.2 — Cierre de mes / export a gestoría. Consume export_gestoria_mensual
// (RPC, verificada en BBDD 07/08 — ver ENCARGO_CODE_F5_gestoria_y_pdf_jornada.md).
// Reemplaza el cálculo cliente-side anterior (recorría clockEntries en el
// navegador, sin incidencias): misma fuente que Plantilla/Ficha.
//
// Bloqueos SIEMPRE visibles arriba, agrupados por tipo — nunca se ocultan:
// es lo que diferencia un export honesto de uno que pasa datos sucios a la
// gestoría (ver AVISOS del encargo).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileText, Settings, RefreshCw, Coffee, AlertTriangle, Scale } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useActiveAccount } from '../modules/multitenancy/hooks/useActiveAccount'
import { Button, Card, Label, Input } from '../components/ui'
import StatusBand, { type StatusLine } from '../components/team/StatusBand'
import PeriodFilter, { makePeriodValue, type PeriodValue } from '../components/team/PeriodFilter'
import { fetchExportGestoriaMensual, downloadExportGestoriaCsv, type ExportGestoriaRow } from '../services/exportGestoriaMensualService'
import { generateExportGestoriaPdf } from '../services/exportGestoriaPdfService'
import { toISODate } from '../types/scheduler'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const hrs = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })}h`

type IncidentKind = 'sin_descansos' | 'olvido_salida' | 'desvio' | 'otro'

function classifyIncident(text: string): IncidentKind {
  if (text.includes('sin descansos')) return 'sin_descansos'
  if (text.includes('fichaje de salida olvidado')) return 'olvido_salida'
  if (text.includes('desvío de')) return 'desvio'
  return 'otro'
}

// Bloqueos agrupados por tipo (no una línea por incidencia suelta): más
// escaneable sin ocultar nada — cada fila lista a quién afecta.
function buildStatusLines(rows: ExportGestoriaRow[]): StatusLine[] {
  const byKind: Record<IncidentKind, { row: ExportGestoriaRow; text: string }[]> = {
    sin_descansos: [], olvido_salida: [], desvio: [], otro: [],
  }
  for (const r of rows) {
    for (const text of r.incidencias) byKind[classifyIncident(text)].push({ row: r, text })
  }
  const lines: StatusLine[] = []
  if (byKind.sin_descansos.length > 0) {
    lines.push({
      key: 'sin_descansos', severity: 'warning', Icon: Coffee,
      text: `${byKind.sin_descansos.length} empleado${byKind.sin_descansos.length === 1 ? '' : 's'} sin descansos registrados`,
      consequence: 'El fichaje de pausa ya existe pero todavía no se usa — la columna "descanso" del PDF de jornada saldrá vacía.',
    })
  }
  if (byKind.olvido_salida.length > 0) {
    lines.push({
      key: 'olvido_salida', severity: 'critical', Icon: AlertTriangle,
      text: `Posible fichaje de salida olvidado: ${byKind.olvido_salida.map(x => x.row.empleado).join(', ')}`,
      consequence: 'Revisar y corregir el fichaje antes de cerrar el mes — puede falsear las horas trabajadas.',
    })
  }
  if (byKind.desvio.length > 0) {
    lines.push({
      key: 'desvio', severity: 'warning', Icon: Scale,
      text: `Desvío de horas sobre contrato: ${byKind.desvio.map(x => `${x.row.empleado} (${x.row.deltaHoras > 0 ? '+' : ''}${x.row.deltaHoras.toFixed(1)}h)`).join(', ')}`,
      consequence: 'Verificar si es real (turnos extra, ausencia sin registrar) antes de enviar a gestoría.',
    })
  }
  if (byKind.otro.length > 0) {
    lines.push({
      key: 'otro', severity: 'warning', Icon: AlertTriangle,
      text: `${byKind.otro.length} incidencia${byKind.otro.length === 1 ? '' : 's'} adicional${byKind.otro.length === 1 ? '' : 'es'}`,
      consequence: byKind.otro.map(x => `${x.row.empleado}: ${x.text}`).join(' · '),
    })
  }
  return lines
}

export default function InformesPage() {
  const { staff, gestoriaConfig, saveGestoriaConfig } = useApp()
  const { activeAccountId, activeAccount } = useActiveAccount()
  const navigate = useNavigate()

  const [period, setPeriod] = useState<PeriodValue>(() => makePeriodValue('mensual', toISODate(new Date())))
  const [rows, setRows] = useState<ExportGestoriaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pdfGenerating, setPdfGenerating] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    setLoading(true)
    fetchExportGestoriaMensual(activeAccountId, period.from, period.to).then(r => {
      if (cancel) return
      setRows(r)
      setLoading(false)
    })
    return () => { cancel = true }
  }, [activeAccountId, period.from, period.to])

  const statusLines = useMemo(() => buildStatusLines(rows), [rows])

  function goToFicha(dni: string) {
    const emp = staff.find(e => e.dni === dni)
    if (emp) navigate(`/personal?employee=${emp.id}`)
  }

  function downloadCsv() {
    downloadExportGestoriaCsv(rows, period.label)
    saveGestoriaConfig({ lastSentAt: new Date().toISOString() })
  }

  function downloadPdf() {
    setPdfGenerating(true)
    try {
      const { blob, filename } = generateExportGestoriaPdf({
        account: { legalName: activeAccount?.legalName ?? null, cif: activeAccount?.cif ?? null },
        periodLabel: period.label,
        periodFrom: period.from,
        periodTo: period.to,
        rows,
      })
      downloadBlob(blob, filename)
      saveGestoriaConfig({ lastSentAt: new Date().toISOString() })
    } finally {
      setPdfGenerating(false)
    }
  }

  const dayOfMonth = gestoriaConfig?.dayOfMonth ?? 25
  const enabled = gestoriaConfig?.enabled ?? false
  const lastSentAt = gestoriaConfig?.lastSentAt
  const missingFields = [
    !gestoriaConfig?.gestoriaNombre ? 'nombre de la gestoría' : null,
    !gestoriaConfig?.gestoriaEmail ? 'email de la gestoría' : null,
  ].filter((x): x is string => !!x)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-accent">Informes Gestoría</h1>
        <p className="text-sm text-text-secondary mt-0.5">Cierre de mes: horas, ausencias e incidencias para enviar a gestoría</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: cierre de mes */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PeriodFilter value={period} onChange={setPeriod} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={loading || rows.length === 0}>
                <span className="inline-flex items-center gap-1.5"><Download size={14} /> CSV</span>
              </Button>
              <Button size="sm" variant="outline" onClick={downloadPdf} disabled={loading || pdfGenerating || rows.length === 0}>
                <span className="inline-flex items-center gap-1.5">
                  {pdfGenerating ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                  PDF
                </span>
              </Button>
            </div>
          </div>

          {/* Bloqueos — SIEMPRE visibles, nunca ocultos (ver AVISOS del encargo F5.2) */}
          {!loading && (
            <StatusBand
              lines={statusLines}
              emptyLabel="Sin incidencias detectadas — listo para enviar a gestoría."
            />
          )}

          <Card>
            <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
              <h3 className="font-semibold text-sm text-text-primary">{period.label} — {rows.length} empleado{rows.length === 1 ? '' : 's'}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border-default bg-page">
                  <th className="p-2.5 text-left text-xs font-semibold text-text-secondary">Empleado</th>
                  <th className="p-2.5 text-left text-xs font-semibold text-text-secondary">Local</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Días trab.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Horas trab.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">H. noct.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Vacac.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Baja</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Fest. trab.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">H. contr.</th>
                  <th className="p-2.5 text-center text-xs font-semibold text-text-secondary">Delta</th>
                  <th className="p-2.5 text-left text-xs font-semibold text-text-secondary">Incidencias</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="p-8 text-center text-text-secondary text-sm">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={11} className="p-8 text-center text-text-secondary text-sm">Sin empleados con datos en este periodo</td></tr>
                  ) : rows.map(r => (
                    <tr
                      key={r.dni}
                      onClick={() => goToFicha(r.dni)}
                      className="border-b border-border-default last:border-0 hover:bg-accent-bg cursor-pointer"
                    >
                      <td className="p-2.5">
                        <p className="font-medium text-text-primary">{r.empleado}</p>
                        <p className="text-xs text-text-secondary">{r.dni}</p>
                      </td>
                      <td className="p-2.5 text-xs text-text-secondary">{r.local}</td>
                      <td className="p-2.5 text-center text-text-primary tabular-nums">{r.diasTrabajados}</td>
                      <td className="p-2.5 text-center font-medium text-text-primary tabular-nums">{hrs(r.horasTrabajadas)}</td>
                      <td className="p-2.5 text-center text-text-secondary tabular-nums">{r.horasNocturnas > 0 ? hrs(r.horasNocturnas) : '—'}</td>
                      <td className="p-2.5 text-center tabular-nums">{r.diasVacaciones > 0 ? r.diasVacaciones : '—'}</td>
                      <td className="p-2.5 text-center tabular-nums">{r.diasBaja > 0 ? r.diasBaja : '—'}</td>
                      <td className="p-2.5 text-center tabular-nums">{r.diasFestivoTrabajado > 0 ? r.diasFestivoTrabajado : '—'}</td>
                      <td className="p-2.5 text-center text-text-secondary tabular-nums">{hrs(r.horasContratadas)}</td>
                      <td className={`p-2.5 text-center font-semibold tabular-nums ${r.deltaHoras < 0 ? 'text-danger' : r.deltaHoras > 0 ? 'text-warning' : 'text-text-secondary'}`}>
                        {r.deltaHoras > 0 ? '+' : ''}{hrs(r.deltaHoras)}
                      </td>
                      <td className="p-2.5 text-xs">
                        {r.incidencias.length === 0 ? (
                          <span className="text-text-tertiary">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {r.incidencias.map((txt, i) => (
                              <li key={i} className="text-danger">{txt}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-text-secondary border-t border-border-default">
              Clic en un empleado para abrir su ficha. Horas reales, sin redondeo — misma fuente que Plantilla.
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
            {enabled && missingFields.length > 0 ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-bg border border-danger/30 text-xs text-danger">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Envío automático activado pero falta {missingFields.join(' y ')}. <strong>No se enviará nada</strong> hasta rellenarlo — el envío automático (SMTP/EmailJS) tampoco está integrado todavía. Por ahora, descarga el CSV o el PDF y envíalos a mano.
                </span>
              </div>
            ) : (
              <div className="text-xs text-text-secondary p-3 rounded-lg bg-page border border-border-default">
                Envío automático desactivado o sin integración SMTP/EmailJS todavía. Descarga el CSV o el PDF y adjúntalos a mano.
              </div>
            )}
          </div>
          <div className="pt-2 border-t border-border-default text-xs text-text-secondary">
            Último envío/descarga: {lastSentAt ? new Date(lastSentAt).toLocaleDateString('es-ES') : 'Nunca'}
          </div>
        </Card>
      </div>
    </div>
  )
}
