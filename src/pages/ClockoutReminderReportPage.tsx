// src/pages/ClockoutReminderReportPage.tsx
// ENCARGO CODE — Informe de oficina de los recordatorios de olvido de fichaje
// de salida. Doble propósito: protección legal (cuántas veces y cuándo se
// avisó a cada persona) y eficacia del aviso (¿ficha tras recibirlo?).
//
// Solo lectura + export — no toca la detección, el Edge de envío ni el cron.

import { useEffect, useState } from 'react'
import { BellRing, Download, CheckCircle2, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, Card, Badge, Modal, Alert } from '../components/ui'
import {
  getReminderSummary, getReminderDetail,
  type ReminderRow, type ReminderDetailRow,
} from '../services/clockoutReminderReportService'
import { generateClockoutReminderExcel } from '../services/clockoutReminderExcelService'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  sent: { label: 'Enviado', color: 'green' },
  queued: { label: 'En cola', color: 'gray' },
  failed: { label: 'Falló', color: 'red' },
  skipped: { label: 'Omitido', color: 'yellow' },
}

export default function ClockoutReminderReportPage() {
  const { activeAccountId, activeAccount } = useApp()
  const [rows, setRows] = useState<ReminderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [detailFor, setDetailFor] = useState<ReminderRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function load() {
    if (!activeAccountId) return
    setLoading(true)
    setLoadError(false)
    try {
      setRows(await getReminderSummary(activeAccountId))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [activeAccountId])

  async function handleExport() {
    if (!activeAccountId) return
    setExporting(true)
    setExportError(null)
    try {
      const detailsByEmployee = await Promise.all(
        rows.map(async (r) => ({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          rows: await getReminderDetail(r.employeeId),
        })),
      )
      const now = new Date()
      await generateClockoutReminderExcel({
        account: { legalName: activeAccount?.legalName || activeAccount?.name || null, cif: activeAccount?.cif ?? null },
        generatedAtLabel: now.toLocaleString('es-ES'),
        generatedAtFilename: now.toISOString().slice(0, 10),
        summary: rows,
        detailsByEmployee,
      })
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'No se pudo exportar el informe')
    } finally {
      setExporting(false)
    }
  }

  if (!activeAccountId) return null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-bg flex items-center justify-center">
            <BellRing size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-text-primary">Recordatorios de fichaje</h1>
            <p className="text-sm text-text-secondary">Avisos de olvido de fichar salida — protección legal y eficacia del aviso</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting || rows.length === 0}>
          <Download size={16} /> {exporting ? 'Exportando…' : 'Exportar a Excel'}
        </Button>
      </div>

      {exportError && <Alert type="error" className="mb-4">{exportError}</Alert>}
      {loadError && <Alert type="error" className="mb-4">No se pudo cargar el informe.</Alert>}

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Cargando…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-text-secondary">No hay empleados activos todavía.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-accent-bg text-text-secondary text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Empleado</th>
                <th className="text-left px-3 py-2">Total avisos</th>
                <th className="text-left px-3 py-2">Este mes</th>
                <th className="text-left px-3 py-2">Esta semana</th>
                <th className="text-left px-3 py-2">Último aviso</th>
                <th className="text-left px-3 py-2">Recordatorio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.employeeId}
                  className="border-t border-border-default cursor-pointer hover:bg-page"
                  onClick={() => setDetailFor(r)}
                >
                  <td className="px-3 py-2 text-text-primary">{r.employeeName}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.totalSent}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.thisMonth}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.thisWeek}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.lastAt ? new Date(r.lastAt).toLocaleString('es-ES') : '—'}</td>
                  <td className="px-3 py-2">
                    {r.reminderActive ? (
                      <span className="text-xs text-success">✅ Activado</span>
                    ) : (
                      <span className="text-xs text-warning">⚠️ Renunció</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailFor && (
        <ReminderDetailModal row={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </div>
  )
}

function ReminderDetailModal({ row, onClose }: { row: ReminderRow; onClose: () => void }) {
  const [detail, setDetail] = useState<ReminderDetailRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setLoadError(false)
    getReminderDetail(row.employeeId)
      .then(d => { if (!cancel) setDetail(d) })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [row.employeeId])

  return (
    <Modal open onClose={onClose} title={row.employeeName} size="lg">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge color="gray">{row.totalSent} avisos enviados</Badge>
          {row.reminderActive ? (
            <Badge color="green">Recordatorio activado</Badge>
          ) : (
            <Badge color="yellow">Renunció al recordatorio</Badge>
          )}
        </div>

        {loadError && <Alert type="error">No se pudo cargar el detalle.</Alert>}

        {loading ? (
          <p className="text-sm text-text-secondary text-center py-6">Cargando…</p>
        ) : detail.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-6">Sin avisos registrados todavía.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-default">
            <table className="w-full text-sm">
              <thead className="bg-accent-bg text-text-secondary text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Detectado</th>
                  <th className="text-left px-3 py-2">Salida teórica</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">Fichó tras aviso</th>
                </tr>
              </thead>
              <tbody>
                {detail.map(d => (
                  <tr key={d.id} className="border-t border-border-default">
                    <td className="px-3 py-2 text-text-primary">{new Date(d.createdAt).toLocaleString('es-ES')}</td>
                    <td className="px-3 py-2 text-text-secondary">{d.scheduledEnd ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge color={STATUS_BADGE[d.status]?.color ?? 'gray'}>{STATUS_BADGE[d.status]?.label ?? d.status}</Badge>
                      {(d.skipReason || d.error) && (
                        <p className="text-xs text-text-secondary mt-1">{d.skipReason ?? d.error}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.clockedOutAfter === null ? (
                        <span className="text-xs text-text-tertiary">No aplica</span>
                      ) : d.clockedOutAfter ? (
                        <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 size={12} /> Sí</span>
                      ) : (
                        <span className="text-xs text-danger flex items-center gap-1"><XCircle size={12} /> No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  )
}
