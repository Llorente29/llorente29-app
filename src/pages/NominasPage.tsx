// src/pages/NominasPage.tsx
// Cabina de nóminas de Folvy Team: subir PDF → extractor (payroll-extract) →
// coste real por empleado y mes, con bandeja de revisión para lo que no cuadra.

import { useState, useEffect, useCallback } from 'react'
import {
  Upload, Receipt, Check, X, AlertTriangle, Loader2, Inbox, CheckCircle2, FileText,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Badge } from '../components/ui'
import {
  uploadAndExtractNomina, fetchPayrollCosts, fetchPayrollInbox, resolvePayrollInbox,
  type PayrollCostRow, type ExtractResult, type PayrollInboxRow,
} from '../services/payrollService'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const eur = (n: number | null) => n == null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

export default function NominasPage() {
  const { staff, activeAccountId } = useApp()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [rows, setRows] = useState<PayrollCostRow[]>([])
  const [inbox, setInbox] = useState<PayrollInboxRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!activeAccountId) return
    setLoading(true)
    const [costs, inb] = await Promise.all([
      fetchPayrollCosts(activeAccountId, year),
      fetchPayrollInbox(activeAccountId),
    ])
    setRows(costs)
    setInbox(inb)
    setLoading(false)
  }, [activeAccountId, year])
  useEffect(() => { void load() }, [load])

  // ── Subida ────────────────────────────────────────────────────────────
  const [empId, setEmpId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractResult | null>(null)

  async function handleUpload() {
    if (!activeAccountId || !empId || !file) return
    setBusy(true); setErr(null); setResult(null)
    try {
      const res = await uploadAndExtractNomina(activeAccountId, empId, file)
      setResult(res)
      setFile(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo procesar la nómina')
    } finally {
      setBusy(false)
    }
  }

  const empName = (id: string) => staff.find(e => e.id === id)?.name || '—'
  const totalCost = rows.filter(r => !r.needsReview).reduce((s, r) => s + (r.totalCost ?? 0), 0)

  // ── Resolver una nómina sin casar ──────────────────────────────────────
  const [assignEmp, setAssignEmp] = useState<Record<string, string>>({})
  const [resolving, setResolving] = useState<string | null>(null)
  const [resolveErr, setResolveErr] = useState<string | null>(null)

  async function handleResolve(inboxId: string) {
    const employeeId = assignEmp[inboxId]
    if (!employeeId) return
    setResolving(inboxId); setResolveErr(null)
    try {
      await resolvePayrollInbox(inboxId, employeeId)
      await load()
    } catch (e) {
      setResolveErr(e instanceof Error ? e.message : 'No se pudo asignar')
    } finally {
      setResolving(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-accent">Nóminas</h1>
        <p className="text-sm text-text-secondary mt-0.5">Coste laboral real desde las nóminas · {year}</p>
      </div>

      {/* Subir nómina */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center gap-2">
          <Upload size={15} className="text-accent" />
          <h3 className="font-semibold text-sm text-text-primary">Subir una nómina</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary block mb-1">Empleado</label>
              <select value={empId} onChange={e => setEmpId(e.target.value)}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
                <option value="">Elegir…</option>
                {staff.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">PDF de la nómina</label>
              <input type="file" accept="application/pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-text-secondary file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-accent-bg file:text-accent file:text-sm file:font-medium hover:file:bg-accent hover:file:text-text-on-accent file:transition-base" />
            </div>
          </div>
          <p className="text-[11px] text-text-secondary">
            Se sube a la ficha del empleado y la IA saca bruto + SS + coste real, validado por totales y anclado a los tipos legales. Si algo no cuadra o el DNI no casa, queda en revisión.
          </p>
          {err && <p className="text-sm text-danger inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>}
          <button onClick={handleUpload} disabled={!empId || !file || busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Leyendo…</> : <><Receipt size={15} /> Subir y leer</>}
          </button>

          {result && (
            <div className={`rounded-lg p-3 border ${result.status === 'ok' ? 'border-success/40 bg-success-bg' : 'border-warning/40 bg-warning-bg'}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.status === 'ok'
                  ? <><CheckCircle2 size={16} className="text-success" /><span className="font-semibold text-sm text-success">Leída y guardada</span></>
                  : <><AlertTriangle size={16} className="text-warning" /><span className="font-semibold text-sm text-warning">En revisión</span></>}
              </div>
              <div className="text-sm text-text-primary space-y-0.5">
                <p><span className="text-text-secondary">Empleado:</span> {result.matchedEmployeeId ? empName(result.matchedEmployeeId) : <span className="text-danger">sin casar por DNI</span>}</p>
                {result.period && <p><span className="text-text-secondary">Periodo:</span> {MONTHS[result.period.month - 1]} {result.period.year} {result.isDraft && <Badge color="gray">borrador</Badge>}</p>}
                <p><span className="text-text-secondary">Bruto:</span> {eur(result.gross)} · <span className="text-text-secondary">SS empresa:</span> {eur(result.employerSs)} · <span className="text-text-secondary font-medium">Coste empresa:</span> <strong>{eur(result.totalCost)}</strong></p>
                <p className="inline-flex items-center gap-2 text-xs mt-1">
                  <CheckBadge label="Devengos" ok={result.checks.earnings} />
                  <CheckBadge label="Líquido" ok={result.checks.net} />
                  <CheckBadge label="SS legal" ok={result.checks.employer_ss} />
                </p>
                {result.reasons.length > 0 && (
                  <ul className="text-xs text-text-secondary list-disc pl-4 mt-1">
                    {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Bandeja: nóminas sin casar / con error */}
      {inbox.length > 0 && (
        <Card className="border-warning/40">
          <div className="p-4 border-b border-border-default bg-warning-bg rounded-t-xl flex items-center gap-2">
            <Inbox size={15} className="text-warning" />
            <h3 className="font-semibold text-sm text-warning">
              {inbox.length} nómina{inbox.length > 1 ? 's' : ''} sin casar
            </h3>
          </div>
          {resolveErr && <p className="px-4 pt-3 text-sm text-danger">{resolveErr}</p>}
          <div className="divide-y divide-border-default">
            {inbox.map(r => (
              <div key={r.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    {r.readName || 'Nómina sin nombre'}
                    {r.periodMonth ? ` · ${MONTHS[r.periodMonth - 1]} ${r.periodYear}` : ''}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {r.readDni ? `DNI leído ${r.readDni} · ` : ''}Coste {eur(r.totalCost)} · {r.reason || 'sin casar'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={assignEmp[r.id] ?? ''}
                    onChange={e => setAssignEmp(prev => ({ ...prev, [r.id]: e.target.value }))}
                    className="border border-border-default rounded-lg px-2 py-1.5 text-sm bg-card text-text-primary max-w-[180px]">
                    <option value="">Asignar a…</option>
                    {staff.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <button
                    onClick={() => handleResolve(r.id)}
                    disabled={!assignEmp[r.id] || resolving === r.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
                    {resolving === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Asignar
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px] text-text-secondary">
            Al asignar, se guarda el coste y —si la ficha no tenía DNI— se le pone el leído, para que las próximas casen solas.
          </p>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Kpi icon={FileText} label="Nóminas cargadas" value={String(rows.length)} />
        <Kpi icon={Inbox} label="Sin casar" value={String(inbox.length)} />
        <Kpi icon={Receipt} label="Coste empresa (confirmado)" value={eur(totalCost)} />
      </div>

      {/* Tabla */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-text-primary">Coste por empleado y mes</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">Año</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
              {[today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border-default bg-page">
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Mes</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Estado</th>
              <th className="p-3 text-right text-xs font-semibold text-text-secondary">Bruto</th>
              <th className="p-3 text-right text-xs font-semibold text-text-secondary">SS empresa</th>
              <th className="p-3 text-right text-xs font-semibold text-text-secondary">Coste empresa</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Origen</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-text-secondary text-sm"><Loader2 size={16} className="animate-spin inline" /> Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-text-secondary text-sm">Aún no hay nóminas cargadas este año</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={`border-b border-border-default last:border-0 hover:bg-accent-bg ${r.needsReview ? 'bg-warning-bg/40' : ''}`}>
                  <td className="p-3 font-medium text-text-primary">{r.employeeName}</td>
                  <td className="p-3 text-text-secondary">{MONTHS[r.periodMonth - 1]} {r.periodYear}</td>
                  <td className="p-3">
                    <Badge color={r.status === 'definitiva' ? 'green' : 'gray'}>{r.status}</Badge>
                    {r.needsReview && <Badge color="yellow" className="ml-1">revisar</Badge>}
                  </td>
                  <td className="p-3 text-right text-text-primary">{eur(r.gross)}</td>
                  <td className="p-3 text-right text-text-primary">{eur(r.employerSs)}</td>
                  <td className="p-3 text-right font-semibold text-text-primary">{eur(r.totalCost)}</td>
                  <td className="p-3 text-text-secondary">{r.source === 'gmail' ? 'Gmail' : r.source === 'nomina_upload' ? 'Subida' : 'Manual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function CheckBadge({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok === null) return <span className="inline-flex items-center gap-0.5 text-text-secondary">{label}: —</span>
  return (
    <span className={`inline-flex items-center gap-0.5 ${ok ? 'text-success' : 'text-danger'}`}>
      {ok ? <Check size={12} /> : <X size={12} />} {label}
    </span>
  )
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Check; label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg border border-border-default bg-accent-bg text-accent">
      <div className="flex items-center gap-2 mb-1"><Icon size={18} /><p className="text-xl font-bold">{value}</p></div>
      <p className="text-xs">{label}</p>
    </div>
  )
}
