// src/modules/appcc/pages/TrainingCompliancePage.tsx
//
// Formación C2 — "Listo para la inspección". Hermana de
// AllergensCompliancePage.tsx, misma estructura (filtro + export CSV/Excel/
// PDF + matriz + panel qué falta + salud del dato).
//
// Decisión de alcance (no pedida explícita pero necesaria para que el KPI de
// portada y la matriz de pantalla cuadren SIEMPRE exactamente, regla del
// encargo): la matriz se pide siempre con p_only_mandatory=true — el
// informe demuestra las OBLIGATORIAS, que es lo que mira un inspector. El
// resumen por curso (para las fichas del PDF/Excel) sí incluye todo lo
// asignado, mandatory o no.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2, ChevronDown, UserPlus, ShieldAlert } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { supabase } from '@/lib/supabase'
import * as trainingComplianceService from '@/services/trainingComplianceService'
import type {
  TrainingComplianceRow, TrainingCellState, TrainingGap, TrainingDataHealthRow, TrainingCourseSummary,
} from '@/services/trainingComplianceService'
import * as coursesService from '@/services/coursesService'
import { blobToDataUrl } from '@/services/courseCertificatePdfService'
import { fetchAllFormations, getFormationStatus } from '@/services/formationsService'
import { generateTrainingCompliancePdf, type TrainingPdfAttendeeSignature, type TrainingPdfExternalCert, type TrainingPdfGapRow } from '@/services/trainingCompliancePdfService'
import { generateTrainingComplianceExcel } from '@/services/trainingComplianceExcelService'

const CELL_TONE: Record<TrainingCellState, string> = {
  vigente: 'bg-success-bg text-success',
  caducado: 'bg-danger-bg text-danger',
  pendiente: 'bg-warning-bg text-warning',
  en_curso: 'bg-warning-bg text-warning',
  pendiente_practica: 'bg-warning-bg text-warning',
  no_aplica: 'bg-accent-bg text-text-secondary',
}
const CELL_LETTER: Record<TrainingCellState, string> = {
  vigente: 'V', caducado: 'C', pendiente: 'P', en_curso: 'E', pendiente_practica: 'X', no_aplica: '·',
}
const CELL_LABEL: Record<TrainingCellState, string> = {
  vigente: 'Vigente', caducado: 'Caducado', pendiente: 'Pendiente', en_curso: 'En curso (sin firmar)',
  pendiente_practica: 'Falta verificación práctica', no_aplica: 'No aplica',
}
const GAP_LABEL: Record<string, string> = {
  nunca_hecho: 'Nunca hecho',
  sin_firmar: 'Aprobado, sin firmar',
  falta_practica: 'Falta verificación práctica',
  caducado: 'Caducado',
  caduca_pronto: 'Caduca pronto',
}

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

export default function TrainingCompliancePage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { staff } = useApp()

  const [matrix, setMatrix] = useState<TrainingComplianceRow[]>([])
  const [matrixError, setMatrixError] = useState<string | null>(null)
  const [gaps, setGaps] = useState<TrainingGap[]>([])
  const [gapsError, setGapsError] = useState<string | null>(null)
  const [health, setHealth] = useState<TrainingDataHealthRow[]>([])
  const [healthError, setHealthError] = useState<string | null>(null)
  const [courseSummary, setCourseSummary] = useState<TrainingCourseSummary[]>([])
  const [courseSummaryError, setCourseSummaryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [locationFilter, setLocationFilter] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [healthOpen, setHealthOpen] = useState(false)
  const [assigningKey, setAssigningKey] = useState<string | null>(null)
  const [assignedKeys, setAssignedKeys] = useState<Set<string>>(new Set())

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [excelGenerating, setExcelGenerating] = useState(false)
  const [excelError, setExcelError] = useState<string | null>(null)

  async function load(accountId: string) {
    setLoading(true)
    const [m, g, h, c] = await Promise.allSettled([
      trainingComplianceService.getTrainingComplianceMatrix(accountId, null, true),
      trainingComplianceService.getTrainingGaps(accountId, 30),
      trainingComplianceService.getTrainingDataHealth(accountId),
      trainingComplianceService.getTrainingCourseSummary(accountId),
    ])
    if (m.status === 'fulfilled') { setMatrix(m.value); setMatrixError(null) }
    else setMatrixError(m.reason instanceof Error ? m.reason.message : 'Error cargando la matriz.')
    if (g.status === 'fulfilled') { setGaps(g.value); setGapsError(null) }
    else setGapsError(g.reason instanceof Error ? g.reason.message : 'Error cargando huecos.')
    if (h.status === 'fulfilled') { setHealth(h.value); setHealthError(null) }
    else setHealthError(h.reason instanceof Error ? h.reason.message : 'Error cargando salud del dato.')
    if (c.status === 'fulfilled') { setCourseSummary(c.value); setCourseSummaryError(null) }
    else setCourseSummaryError(c.reason instanceof Error ? c.reason.message : 'Error cargando el resumen de cursos.')
    setLoading(false)
  }

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) { setLoading(false); return }
    let cancelled = false
    load(activeAccountId).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, accountsLoading])

  const locationOptions = useMemo(() => {
    const set = new Set<string>()
    matrix.forEach((r) => set.add(r.locationName))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [matrix])

  const filteredRows = useMemo(() => {
    if (!locationFilter) return matrix
    return matrix.filter((r) => r.locationName === locationFilter)
  }, [matrix, locationFilter])

  const rowsByLocation = useMemo(() => {
    const map = new Map<string, TrainingComplianceRow[]>()
    for (const row of filteredRows) {
      const list = map.get(row.locationName) ?? []
      list.push(row)
      map.set(row.locationName, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredRows])

  // Columnas de la matriz: unión de los códigos de curso realmente presentes
  // en las filas (obligatorias asignadas), con su título vía courseSummary.
  const courseCols = useMemo(() => {
    const codes = new Set<string>()
    filteredRows.forEach((r) => Object.keys(r.courses).forEach((c) => codes.add(c)))
    return Array.from(codes).map((code) => ({
      code,
      title: courseSummary.find((c) => c.courseCode === code)?.courseTitle ?? code,
    })).sort((a, b) => a.title.localeCompare(b.title))
  }, [filteredRows, courseSummary])

  const kpi = useMemo(() => trainingComplianceService.computeMandatoryCompliancePct(filteredRows), [filteredRows])
  const caducaPronto30 = gaps.filter((g) => g.gapKind === 'caduca_pronto').length
  const sinFirmar = gaps.filter((g) => g.gapKind === 'sin_firmar').length
  const sinDni = health.find((h) => h.checkKind === 'sin_dni')?.itemCount ?? 0

  async function assignFromGap(gap: TrainingGap) {
    if (!activeAccountId) return
    const key = `${gap.employeeId}-${gap.courseId}`
    setAssigningKey(key)
    try {
      await coursesService.createAssignment({
        courseId: gap.courseId,
        accountId: activeAccountId,
        employeeId: gap.employeeId,
        origin: 'manual',
      })
      setAssignedKeys((prev) => new Set(prev).add(key))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo asignar la formación')
    } finally {
      setAssigningKey(null)
    }
  }

  function exportCsv() {
    const header = ['Trabajador', 'Puesto', 'DNI/NIE', 'Local', ...courseCols.map((c) => c.title)]
    const rows = filteredRows.map((r) => [
      r.employeeName, r.role ?? '—', r.docId ?? '—', r.locationName,
      ...courseCols.map((c) => CELL_LABEL[r.courses[c.code]?.state ?? 'no_aplica']),
    ])
    const csv = [header, ...rows].map((cols) => cols.map(csvEscape).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `formacion_inspeccion_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function buildAccountAndScope() {
    if (!activeAccountId || !supabase) throw new Error('No hay cuenta activa.')
    const { data } = await supabase.from('accounts').select('legal_name, cif').eq('id', activeAccountId).single()
    const now = new Date()
    return {
      account: { legalName: data?.legal_name ?? null, cif: data?.cif ?? null },
      generatedAtLabel: now.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
      generatedAtFilename: now.toISOString().slice(0, 16).replaceAll('-', '').replaceAll(':', '').replaceAll('T', ''),
    }
  }

  // Recorre los cursos del resumen, trae sus intentos + firmas (C1) y
  // resuelve cada firma a una imagen embebible. En paralelo por curso y por
  // firma para no alargar el informe con N llamadas en serie.
  async function buildAttendeeSignatures(): Promise<TrainingPdfAttendeeSignature[]> {
    const employeesById = new Map(staff.map((e) => [e.id, e]))
    const perCourse = await Promise.all(courseSummary.map(async (course) => {
      const attempts = await coursesService.listAttemptsForCourse(course.courseId)
      const sigs = await coursesService.listSignaturesForAttempts(attempts.map((a) => a.id))
      return Promise.all(sigs.map(async (sig) => {
        const attempt = attempts.find((a) => a.id === sig.attemptId)
        const emp = employeesById.get(sig.employeeId)
        let signatureDataUrl: string | null = null
        if (supabase) {
          const { data: blob } = await supabase.storage.from('course-signatures').download(sig.signaturePng)
          if (blob) signatureDataUrl = await blobToDataUrl(blob)
        }
        const row: TrainingPdfAttendeeSignature = {
          employeeName: emp?.name ?? '—',
          employeeDni: emp?.dni ?? null,
          role: emp?.position ?? null,
          courseTitle: course.courseTitle,
          scorePct: attempt?.scorePct ?? null,
          signedAtLabel: new Date(sig.signedAt).toLocaleString('es-ES'),
          signatureDataUrl,
        }
        return row
      }))
    }))
    return perCourse.flat()
  }

  async function buildExternalCerts(): Promise<TrainingPdfExternalCert[]> {
    const employeesById = new Map(staff.map((e) => [e.id, e]))
    const formations = await fetchAllFormations()
    return formations.map((f) => {
      const status = getFormationStatus(f)
      return {
        employeeName: employeesById.get(f.employeeId)?.name ?? '—',
        name: f.name,
        expiryLabel: f.expiryDate ? new Date(f.expiryDate + 'T00:00:00').toLocaleDateString('es-ES') : null,
        statusLabel: status.label,
        statusColor: status.color,
      }
    })
  }

  function buildGapRows(): TrainingPdfGapRow[] {
    return gaps.map((g) => ({
      employeeName: g.employeeName,
      courseTitle: g.courseTitle,
      detail: g.gapKind === 'caduca_pronto' && g.daysLeft != null
        ? `Caduca en ${g.daysLeft} día${g.daysLeft === 1 ? '' : 's'}`
        : GAP_LABEL[g.gapKind] ?? g.gapKind,
    }))
  }

  async function exportPdf() {
    if (pdfGenerating) return
    setPdfGenerating(true)
    setPdfError(null)
    try {
      const scope = await buildAccountAndScope()
      const [attendeeSignatures, externalCerts] = await Promise.all([
        buildAttendeeSignatures(),
        buildExternalCerts(),
      ])
      const { blob, filename } = generateTrainingCompliancePdf({
        ...scope,
        responsibleName: responsibleName.trim() || null,
        kpi,
        rowsByLocation,
        courses: courseSummary
          .filter((c) => courseCols.some((col) => col.code === c.courseCode))
          .map((c) => ({
            code: c.courseCode, title: c.courseTitle, legalBasis: c.legalBasis,
            sectionTitles: c.sectionTitles, estimatedMinutes: c.estimatedMinutes, assignedCount: c.assignedCount,
          })),
        attendeeSignatures,
        externalCerts,
        gaps: buildGapRows(),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfGenerating(false)
    }
  }

  async function exportExcel() {
    if (excelGenerating) return
    setExcelGenerating(true)
    setExcelError(null)
    try {
      const scope = await buildAccountAndScope()
      await generateTrainingComplianceExcel({
        ...scope,
        kpi,
        rowsByLocation,
        courseCodes: courseCols,
        courseSummary,
        gaps,
        health,
      })
    } catch (e) {
      setExcelError(e instanceof Error ? e.message : 'No se pudo generar el Excel.')
    } finally {
      setExcelGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando formación…
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-4xl font-display text-text-primary mb-1">Formación</h1>
          <p className="text-base text-text-secondary">
            Listo para la inspección: quién está formado, con qué evidencia, y quién va tarde.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {locationOptions.length > 1 && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="text-sm border border-border-default rounded-lg bg-card text-text-primary px-2.5 py-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Todos los locales</option>
              {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <input
            type="text"
            value={responsibleName}
            onChange={(e) => setResponsibleName(e.target.value)}
            placeholder="Responsable de formación (opcional)"
            className="text-sm border border-border-default rounded-lg bg-card text-text-primary px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent w-56"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={filteredRows.length === 0 || excelGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            {excelGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {excelGenerating ? 'Generando…' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={filteredRows.length === 0 || pdfGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            {pdfGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {pdfGenerating ? 'Generando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>
      {pdfError && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{pdfError}</div>}
      {excelError && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{excelError}</div>}

      {/* Tira de KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiBox label="Con la obligatoria vigente" value={`${kpi.pct}%`} sub={`${kpi.vigente}/${kpi.applicable}`}
          tone={kpi.pct === 100 ? 'success' : kpi.pct >= 80 ? 'warning' : 'danger'} />
        <KpiBox label="Caducan en 30 días" value={String(caducaPronto30)} tone={caducaPronto30 > 0 ? 'warning' : 'neutral'} />
        <KpiBox label="Sin firmar" value={String(sinFirmar)} tone={sinFirmar > 0 ? 'warning' : 'neutral'} />
        <KpiBox label="Empleados sin DNI" value={String(sinDni)} tone={sinDni > 0 ? 'danger' : 'neutral'} />
      </div>

      {/* Matriz */}
      <div className="bg-card border border-border-default rounded-lg">
        {matrixError ? (
          <div className="p-4 text-sm text-danger">{matrixError}</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-secondary">
            {matrix.length === 0 ? 'Ningún empleado con formación obligatoria asignada todavía.' : 'Ningún local coincide con el filtro.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-page">
                <tr>
                  <th className="px-3 py-2 text-left sticky left-0 z-20 bg-page border-r border-border-default min-w-[200px]">
                    Trabajador
                  </th>
                  {courseCols.map((c) => (
                    <th key={c.code} className="px-1 py-2 text-center min-w-[90px] text-[10px] text-text-secondary font-medium" title={c.title}>
                      {c.title.length > 16 ? c.title.slice(0, 15) + '…' : c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-border-default">
                    <td className="px-3 py-2 align-middle sticky left-0 z-10 bg-card border-r border-border-default">
                      <div className="font-medium text-text-primary truncate max-w-[180px]">{row.employeeName}</div>
                      <div className="text-[10px] text-text-secondary truncate max-w-[180px]">
                        {row.role ?? '—'} · {row.locationName}
                      </div>
                    </td>
                    {courseCols.map((c) => {
                      const cell = row.courses[c.code]
                      const state = cell?.state ?? 'no_aplica'
                      return (
                        <td key={c.code} className="px-1 py-1.5 border-l border-border-default text-center">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[11px] font-semibold ${CELL_TONE[state]}`}
                            title={`${CELL_LABEL[state]}${cell?.expiresAt ? ' · hasta ' + new Date(cell.expiresAt).toLocaleDateString('es-ES') : ''}`}
                          >
                            {CELL_LETTER[state]}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Qué falta */}
      <div className="bg-card border border-border-default rounded-lg p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-text-secondary" /> Qué falta
        </h3>
        {gapsError && <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{gapsError}</div>}
        {gaps.length === 0 && !gapsError ? (
          <p className="text-sm text-success">Ningún hueco pendiente sobre las formaciones obligatorias.</p>
        ) : (
          <ul className="space-y-1.5 max-h-96 overflow-y-auto">
            {gaps.map((g) => {
              const key = `${g.employeeId}-${g.courseId}`
              const done = assignedKeys.has(key)
              return (
                <li key={key} className="flex items-center justify-between gap-2 text-sm border border-border-default rounded-md p-2">
                  <div className="min-w-0">
                    <span className="font-medium text-text-primary">{g.employeeName}</span>
                    <span className="text-text-secondary"> · {g.courseTitle} · </span>
                    <span className="text-warning font-medium">
                      {g.gapKind === 'caduca_pronto' && g.daysLeft != null ? `Caduca en ${g.daysLeft} días` : GAP_LABEL[g.gapKind]}
                    </span>
                  </div>
                  {g.gapKind === 'nunca_hecho' && (
                    done ? (
                      <span className="text-xs text-success shrink-0">Asignado</span>
                    ) : (
                      <button
                        onClick={() => assignFromGap(g)}
                        disabled={assigningKey === key}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-accent text-text-on-accent shrink-0 disabled:opacity-50"
                      >
                        <UserPlus className="w-3 h-3" /> {assigningKey === key ? 'Asignando…' : 'Asignar formación'}
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Salud del dato (plegable) */}
      <div className="bg-card border border-border-default rounded-lg">
        <button
          onClick={() => setHealthOpen((o) => !o)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-text-secondary" /> Salud del dato
          </h3>
          <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${healthOpen ? 'rotate-180' : ''}`} />
        </button>
        {healthOpen && (
          <div className="px-4 pb-4">
            {healthError && <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{healthError}</div>}
            {courseSummaryError && <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{courseSummaryError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {health.map((h) => (
                <div key={h.checkKind} className="border border-border-default rounded-md p-2.5">
                  <div className="text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
                    {h.checkKind === 'sin_dni' ? 'Sin DNI' : h.checkKind === 'sin_acceso' ? 'Sin acceso' : h.checkKind === 'curso_sin_asignar' ? 'Curso sin asignar' : 'Sin fecha límite'}
                  </div>
                  <div className={`text-lg font-semibold ${h.itemCount > 0 ? 'text-warning' : 'text-success'}`}>{h.itemCount}</div>
                  {h.sampleNames.length > 0 && (
                    <div className="text-[10px] text-text-tertiary mt-1 truncate" title={h.sampleNames.join(', ')}>
                      {h.sampleNames.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const toneClass = {
    success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-text-primary',
  }[tone]
  return (
    <div className="bg-card border border-border-default rounded-lg p-3">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs text-text-secondary mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-text-tertiary mt-0.5">{sub}</div>}
    </div>
  )
}
