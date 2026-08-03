// src/services/trainingComplianceExcelService.ts
//
// Exportación a Excel (.xlsx) del informe de cumplimiento de formación —
// mismo patrón que allergenComplianceExcelService.ts, PERO con import
// DINÁMICO de xlsx (`await import('xlsx')`): ese fichero lo importa
// estático y ya generó un warning de bundling (INEFFECTIVE_DYNAMIC_IMPORT)
// porque otras páginas sí lo cargan dinámico — aquí no se repite.
//
// Para trabajar el dato y compartirlo (no para enseñar — eso es el PDF).

import type { TrainingComplianceRow, TrainingGap, TrainingDataHealthRow, TrainingCourseSummary } from './trainingComplianceService'

const STATE_LABEL: Record<string, string> = {
  vigente: 'Vigente', caducado: 'Caducado', pendiente: 'Pendiente', en_curso: 'En curso (sin firmar)', no_aplica: 'No aplica',
}

const HEALTH_LABEL: Record<string, string> = {
  sin_dni: 'Empleados sin DNI',
  sin_acceso: 'Empleados sin acceso generado',
  curso_sin_asignar: 'Cursos publicados sin asignar',
  asignacion_sin_fecha: 'Asignaciones sin fecha límite',
}

export interface TrainingExcelData {
  account: { legalName: string | null; cif: string | null }
  generatedAtLabel: string
  generatedAtFilename: string
  kpi: { vigente: number; applicable: number; pct: number }
  rowsByLocation: [string, TrainingComplianceRow[]][]
  courseCodes: { code: string; title: string }[]
  courseSummary: TrainingCourseSummary[]
  gaps: TrainingGap[]
  health: TrainingDataHealthRow[]
}

// Nombre de hoja Excel: máx 31 caracteres, sin : \ / ? * [ ].
function sheetSafeName(name: string, usedNames: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Local'
  let candidate = base
  let n = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
    n++
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

export async function generateTrainingComplianceExcel(data: TrainingExcelData): Promise<{ filename: string }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // ── Hoja "Resumen" ──
  const summaryRows: Record<string, string>[] = [
    { 'Campo': 'Cliente', 'Valor': data.account.legalName ?? '—' },
    { 'Campo': 'CIF', 'Valor': data.account.cif ?? '—' },
    { 'Campo': 'Generado', 'Valor': data.generatedAtLabel },
    { 'Campo': '', 'Valor': '' },
    { 'Campo': 'Con la obligatoria vigente', 'Valor': `${data.kpi.vigente} de ${data.kpi.applicable}` },
    { 'Campo': 'Cumplimiento', 'Valor': `${data.kpi.pct}%` },
    { 'Campo': '', 'Valor': '' },
    { 'Campo': 'Empleados sin DNI', 'Valor': String(data.health.find(h => h.checkKind === 'sin_dni')?.itemCount ?? 0) },
    { 'Campo': 'Empleados sin acceso generado', 'Valor': String(data.health.find(h => h.checkKind === 'sin_acceso')?.itemCount ?? 0) },
    { 'Campo': 'Cursos publicados sin asignar', 'Valor': String(data.health.find(h => h.checkKind === 'curso_sin_asignar')?.itemCount ?? 0) },
    { 'Campo': 'Asignaciones sin fecha límite', 'Valor': String(data.health.find(h => h.checkKind === 'asignacion_sin_fecha')?.itemCount ?? 0) },
  ]
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows, { header: ['Campo', 'Valor'] })
  summaryWs['!cols'] = [{ wch: 32 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Resumen')

  // ── Una hoja por local — empleado × curso con estado y fecha ──
  const usedNames = new Set<string>(['resumen', 'cursos', 'huecos', 'salud del dato'])
  for (const [locationName, rows] of data.rowsByLocation) {
    const sheetRows = rows.map((row) => {
      const record: Record<string, string> = {
        'Trabajador': row.employeeName,
        'Puesto': row.role ?? '—',
        'DNI/NIE': row.docId ?? '—',
      }
      for (const c of data.courseCodes) {
        const cell = row.courses[c.code]
        const state = cell?.state ?? 'no_aplica'
        record[c.title] = cell?.expiresAt
          ? `${STATE_LABEL[state]} (hasta ${new Date(cell.expiresAt).toLocaleDateString('es-ES')})`
          : STATE_LABEL[state]
      }
      return record
    })
    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ['Trabajador', 'Puesto', 'DNI/NIE', ...data.courseCodes.map(c => c.title)],
    })
    ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 14 }, ...data.courseCodes.map(() => ({ wch: 26 }))]
    XLSX.utils.book_append_sheet(wb, ws, sheetSafeName(locationName, usedNames))
  }

  // ── Hoja "Cursos" ──
  const courseRows = data.courseSummary.map((c) => ({
    'Curso': c.courseTitle,
    'Base legal': c.legalBasis ?? '—',
    'Contenidos': c.sectionTitles.join(' · '),
    'Asignados': c.assignedCount,
    'Formados (aprobado)': c.trainedCount,
    'Firmados (acreditado)': c.signedCount,
    'Cumplimiento': `${c.compliancePct}%`,
  }))
  const courseWs = XLSX.utils.json_to_sheet(courseRows, {
    header: ['Curso', 'Base legal', 'Contenidos', 'Asignados', 'Formados (aprobado)', 'Firmados (acreditado)', 'Cumplimiento'],
  })
  courseWs['!cols'] = [{ wch: 30 }, { wch: 26 }, { wch: 50 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, courseWs, 'Cursos')

  // ── Hoja "Huecos" ──
  const gapRows = data.gaps.map((g) => ({
    'Trabajador': g.employeeName,
    'Curso': g.courseTitle,
    'Qué falta': g.gapKind,
    'Fecha límite': g.dueAt ? new Date(g.dueAt).toLocaleDateString('es-ES') : '—',
    'Días restantes': g.daysLeft ?? '—',
  }))
  const gapWs = XLSX.utils.json_to_sheet(gapRows, {
    header: ['Trabajador', 'Curso', 'Qué falta', 'Fecha límite', 'Días restantes'],
  })
  gapWs['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, gapWs, 'Huecos')

  // ── Hoja "Salud del dato" ──
  const healthRows = data.health.map((h) => ({
    'Comprobación': HEALTH_LABEL[h.checkKind] ?? h.checkKind,
    'Cantidad': h.itemCount,
    'Ejemplos': h.sampleNames.join(', '),
  }))
  const healthWs = XLSX.utils.json_to_sheet(healthRows, { header: ['Comprobación', 'Cantidad', 'Ejemplos'] })
  healthWs['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 50 }]
  XLSX.utils.book_append_sheet(wb, healthWs, 'Salud del dato')

  const filename = `formacion_inspeccion_${data.generatedAtFilename}.xlsx`
  XLSX.writeFile(wb, filename)
  return { filename }
}
