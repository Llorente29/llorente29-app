// src/modules/appcc/services/pdfExportService.ts
// Genera PDFs de registros APPCC listos para inspección de Sanidad.
// Usa jsPDF (cliente, sin backend).
//
// Tipos de PDF:
// 1. Certificado de checklist individual (completado + firma)
// 2. Resumen diario de un local (todos los checklists del día)
// 3. Informe inspector (rango de fechas)

import jsPDF from 'jspdf'
import { supabase } from '@/lib/supabase'
import * as executionsService from './executionsService'
import * as templatesService from './templatesService'
import * as incidentsService from './incidentsService'
import * as analyticsService from './analyticsService'
import type { AppccIncidentAction } from './incidentsService'
import type {
  AppccExecutionResponse,
  AppccTemplateWithItems,
  AppccTemplateItem,
  AppccIncident,
} from '@/modules/appcc/types'

// Colores del branding
const ACCENT = [30, 58, 95] as const    // #1E3A5F
const SUCCESS = [16, 185, 129] as const  // #10B981
const DANGER = [220, 38, 38] as const    // #DC2626
const GRAY = [107, 114, 128] as const    // #6B7280
const LIGHT = [245, 244, 240] as const   // #F5F4F0

interface LocationInfo {
  name: string
  address?: string
}

interface SignatureInfo {
  signed_at: string
  signature_hash: string
  user_id: string
}

// ============================================================
// MODO DE SALIDA (Bloque E — previsualización)
// ------------------------------------------------------------
// Todas las funciones generate*Pdf aceptan un parámetro opcional
// `options` que controla qué hacer con el PDF generado:
//   - mode 'download' (default): descarga directa (comportamiento legacy)
//   - mode 'preview'           : devuelve { blob, url, filename } para
//                                que un modal lo muestre en un iframe
// Cuando se omite, el comportamiento es 'download' → retrocompatible.
// ============================================================

export type PdfMode = 'download' | 'preview'

export interface PdfExportOptions {
  mode?: PdfMode
}

export interface PdfPreviewResult {
  blob: Blob
  url: string       // object URL listo para <iframe src=...>
  filename: string  // nombre sugerido para descargar
}

/**
 * Helper interno: aplica el modo de salida a un doc de jsPDF.
 * - download → doc.save y resuelve null
 * - preview  → genera blob, object URL y devuelve PdfPreviewResult
 *
 * El llamador siempre debe retornar lo que devuelva este helper.
 */
function finalizePdf(
  doc: jsPDF,
  filename: string,
  options?: PdfExportOptions,
): PdfPreviewResult | null {
  if (options?.mode === 'preview') {
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    return { blob, url, filename }
  }
  doc.save(filename)
  return null
}


// ============================================================
// 1. CERTIFICADO DE CHECKLIST INDIVIDUAL
// ============================================================

export async function generateChecklistPdf(
  executionId: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const execData = await executionsService.getExecution(executionId)
  if (!execData) throw new Error('Ejecución no encontrada')

  const { execution, responses } = execData
  const template = await templatesService.getTemplateWithItems(execution.template_id)
  if (!template) throw new Error('Plantilla no encontrada')

  // Obtener firma
  const signature = await getSignature(executionId)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  // --- HEADER ---
  y = drawHeader(doc, y, margin, contentW, locationInfo, template.plan.name)

  // --- TÍTULO DEL CHECKLIST ---
  doc.setFontSize(16)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text(template.name, margin, y)
  y += 8

  // --- METADATA ---
  doc.setFontSize(9)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'normal')
  const dateStr = new Date(execution.scheduled_date + 'T00:00:00').toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  doc.text(`Fecha: ${dateStr}`, margin, y)
  y += 4.5
  if (execution.scheduled_time) {
    doc.text(`Hora programada: ${execution.scheduled_time.slice(0, 5)}`, margin, y)
    y += 4.5
  }
  doc.text(`Estado: ${execution.status === 'completed' ? 'COMPLETADO' : execution.status.toUpperCase()}`, margin, y)
  y += 4.5
  if (execution.completed_at) {
    doc.text(`Completado: ${new Date(execution.completed_at).toLocaleString('es-ES')}`, margin, y)
    y += 4.5
  }
  if (execution.has_failures) {
    doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
    doc.text(`Incidencias: ${execution.failure_count} detectada(s)`, margin, y)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    y += 4.5
  }
  y += 4

  // --- RESPUESTAS ---
  const respMap = new Map<string, AppccExecutionResponse>()
  responses.forEach(r => respMap.set(r.item_id, r))

  for (const item of template.items) {
    // Comprobar si queda espacio en la página
    if (y > 260) {
      doc.addPage()
      y = margin
      y = drawHeader(doc, y, margin, contentW, locationInfo, template.plan.name)
    }

    const resp = respMap.get(item.id)
    y = drawItemRow(doc, y, margin, contentW, item, resp)
  }

  // --- NOTAS ---
  if (execution.notes) {
    y += 4
    if (y > 255) { doc.addPage(); y = margin }
    doc.setFontSize(9)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.setFont('helvetica', 'italic')
    doc.text(`Notas: ${execution.notes}`, margin, y, { maxWidth: contentW })
    y += 8
  }

  // --- FIRMA ---
  y += 6
  if (y > 250) { doc.addPage(); y = margin }
  y = drawSignatureBlock(doc, y, margin, contentW, signature)

  // --- FOOTER ---
  drawFooter(doc)

  // Descargar o previsualizar
  const fileName = `APPCC_${template.code}_${execution.scheduled_date}_${locationInfo.name.replace(/\s/g, '_')}.pdf`
  return finalizePdf(doc, fileName, options)
}

// ============================================================
// 2. RESUMEN DIARIO
// ============================================================

export async function generateDailySummaryPdf(
  locationId: string,
  date: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const executions = await executionsService.listExecutionsForDate(locationId, date)
  if (executions.length === 0) throw new Error('No hay registros para esta fecha')

  // Cargar templates
  const templateIds = [...new Set(executions.map(e => e.template_id))]
  const templates = new Map<string, AppccTemplateWithItems>()
  for (const tid of templateIds) {
    const t = await templatesService.getTemplateWithItems(tid)
    if (t) templates.set(tid, t)
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  // Header
  y = drawHeader(doc, y, margin, contentW, locationInfo, 'Resumen diario APPCC')

  // Fecha
  const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  doc.setFontSize(14)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text(`Resumen del ${dateStr}`, margin, y)
  y += 8

  // Estadísticas
  const completed = executions.filter(e => e.status === 'completed').length
  const pending = executions.filter(e => e.status === 'pending' || e.status === 'in_progress').length
  const withFailures = executions.filter(e => e.has_failures).length

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Total controles: ${executions.length}  |  Completados: ${completed}  |  Pendientes: ${pending}  |  Con incidencias: ${withFailures}`, margin, y)
  y += 8

  // Tabla resumen
  // Header de tabla
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(margin, y, contentW, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Control', margin + 2, y + 5)
  doc.text('Hora', margin + 90, y + 5)
  doc.text('Estado', margin + 115, y + 5)
  doc.text('Incidencias', margin + 145, y + 5)
  y += 7

  // Filas
  for (const exec of executions.sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''))) {
    if (y > 270) { doc.addPage(); y = margin }

    const tpl = templates.get(exec.template_id)
    const isCompleted = exec.status === 'completed'
    const bgColor = isCompleted ? [240, 253, 244] as const : [255, 251, 235] as const

    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2])
    doc.rect(margin, y, contentW, 6, 'F')
    doc.setDrawColor(220, 220, 220)
    doc.rect(margin, y, contentW, 6, 'S')

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    doc.text(tpl?.name ?? 'Checklist', margin + 2, y + 4)
    doc.text(exec.scheduled_time?.slice(0, 5) ?? '—', margin + 90, y + 4)

    if (isCompleted) {
      doc.setTextColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
      doc.text('Completado', margin + 115, y + 4)
    } else {
      doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
      doc.text(exec.status, margin + 115, y + 4)
    }

    const cc1 = exec.has_failures ? DANGER : SUCCESS; doc.setTextColor(cc1[0], cc1[1], cc1[2])
    doc.text(exec.has_failures ? `${exec.failure_count}` : '0', margin + 150, y + 4)

    y += 6
  }

  y += 8

  // Pie legal
  doc.setFontSize(7)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'italic')
  doc.text(
    'Documento generado automáticamente por Folvy APPCC. Los registros están respaldados por firma electrónica simple según Reglamento eIDAS UE 910/2014.',
    margin, y, { maxWidth: contentW }
  )

  drawFooter(doc)

  const fileName = `APPCC_Resumen_${date}_${locationInfo.name.replace(/\s/g, '_')}.pdf`
  return finalizePdf(doc, fileName, options)
}

// ============================================================
// 3. INFORME DE CONTROLES (rango de fechas)
// ============================================================

export async function generateControlsReportPdf(
  locationId: string,
  fromDate: string,
  toDate: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const executions = await executionsService.listByDateRange(locationId, fromDate, toDate)
  if (executions.length === 0) throw new Error('No hay registros en este periodo')

  const templateIds = [...new Set(executions.map(e => e.template_id))]
  const tplCache = new Map<string, AppccTemplateWithItems>()
  for (const tid of templateIds) {
    const t = await templatesService.getTemplateWithItems(tid)
    if (t) tplCache.set(tid, t)
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  y = drawHeader(doc, y, margin, contentW, locationInfo, 'Informe de controles APPCC')

  // Título
  doc.setFontSize(14)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text(`Controles del ${fromDate} al ${toDate}`, margin, y)
  y += 8

  // Estadísticas
  const completed = executions.filter(e => e.status === 'completed').length
  const withFailures = executions.filter(e => e.has_failures).length
  const totalFailures = executions.reduce((acc, e) => acc + e.failure_count, 0)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Total: ${executions.length}  |  Completados: ${completed}  |  Con incidencias: ${withFailures}  |  Incidencias totales: ${totalFailures}`, margin, y)
  y += 8

  // Agrupar por fecha
  const byDate = new Map<string, typeof executions>()
  for (const e of executions) {
    const d = e.scheduled_date
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(e)
  }

  for (const [date, dayExecs] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (y > 255) { doc.addPage(); y = margin }

    // Cabecera del día
    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long'
    })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text(dateLabel, margin, y)
    y += 5

    for (const exec of dayExecs.sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''))) {
      if (y > 265) { doc.addPage(); y = margin }
      const tpl = tplCache.get(exec.template_id)
      const isCompleted = exec.status === 'completed'

      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')

      // Indicador + nombre
      if (exec.has_failures) {
        doc.setFillColor(DANGER[0], DANGER[1], DANGER[2])
      } else if (isCompleted) {
        doc.setFillColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
      } else {
        doc.setFillColor(200, 200, 200)
      }
      doc.circle(margin + 2, y - 0.5, 1.2, 'F')

      doc.setTextColor(0, 0, 0)
      doc.text(`${tpl?.name ?? 'Checklist'}`, margin + 6, y)

      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(
        `${exec.scheduled_time?.slice(0, 5) ?? '—'}  |  ${isCompleted ? 'OK' : exec.status}${exec.has_failures ? `  |  ${exec.failure_count} incid.` : ''}`,
        margin + 90, y
      )
      y += 4.5
    }
    y += 3
  }

  // Pie
  y += 4
  doc.setFontSize(7)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'italic')
  doc.text('Documento generado por Folvy APPCC. Registros respaldados por firma electrónica simple (eIDAS UE 910/2014).', margin, y, { maxWidth: contentW })

  drawFooter(doc)
  return finalizePdf(doc, `APPCC_Controles_${fromDate}_${toDate}_${locationInfo.name.replace(/\s/g, '_')}.pdf`, options)
}

// ============================================================
// 3b. INFORME DE RENDIMIENTO DEL EQUIPO (cumplimiento por empleado)
// Quien hizo sus tareas y quien no, en el periodo. El reparto ya es
// equitativo por turno/disponibilidad => comparacion justa (dif. vs Jolt/Zenput).
// ============================================================

export async function generateEmployeeComplianceReportPdf(
  locationId: string,
  fromDate: string,
  toDate: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const rows = await analyticsService.getEmployeeCompliance(
    { from: fromDate, to: toDate },
    [locationId],
  )
  if (rows.length === 0) throw new Error('No hay tareas asignadas en este periodo')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  y = drawHeader(doc, y, margin, contentW, locationInfo, 'Rendimiento del equipo APPCC')

  doc.setFontSize(14)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text(`Rendimiento del equipo del ${fromDate} al ${toDate}`, margin, y)
  y += 6

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text('Reparto equilibrado por turno y disponibilidad: la comparacion es justa.', margin, y, { maxWidth: contentW })
  y += 7

  const totAssigned = rows.reduce((a, r) => a + r.assigned, 0)
  const totDone = rows.reduce((a, r) => a + r.done, 0)
  const totMissed = rows.reduce((a, r) => a + r.overdueMissed, 0)
  const totRate = totAssigned > 0 ? Math.round((totDone / totAssigned) * 100) : 0
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Asignadas: ${totAssigned}  |  Hechas: ${totDone}  |  Sin hacer: ${totMissed}  |  Cumplimiento global: ${totRate}%`, margin, y)
  y += 8

  const xAssign = margin + 105
  const xDone = margin + 125
  const xLate = margin + 145
  const xMissed = margin + 168
  const xRate = margin + contentW

  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(margin, y - 4, contentW, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('EMPLEADO', margin + 2, y)
  doc.text('Asign.', xAssign, y, { align: 'right' })
  doc.text('Hechas', xDone, y, { align: 'right' })
  doc.text('Tarde', xLate, y, { align: 'right' })
  doc.text('Sin hacer', xMissed, y, { align: 'right' })
  doc.text('Cumpl.', xRate, y, { align: 'right' })
  y += 7

  for (const r of rows) {
    if (y > 270) { doc.addPage(); y = margin }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    doc.text(r.employeeName, margin + 2, y, { maxWidth: 95 })
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(String(r.assigned), xAssign, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    doc.text(String(r.done), xDone, y, { align: 'right' })
    const lc = r.late > 0 ? ([0, 0, 0] as const) : GRAY
    doc.setTextColor(lc[0], lc[1], lc[2])
    doc.text(r.late > 0 ? String(r.late) : '-', xLate, y, { align: 'right' })
    const mc = r.overdueMissed > 0 ? DANGER : GRAY
    doc.setTextColor(mc[0], mc[1], mc[2])
    doc.text(r.overdueMissed > 0 ? String(r.overdueMissed) : '-', xMissed, y, { align: 'right' })
    const rc = r.completionRate >= 90 ? SUCCESS : r.completionRate >= 70 ? ([245, 158, 11] as const) : DANGER
    doc.setTextColor(rc[0], rc[1], rc[2])
    doc.setFont('helvetica', 'bold')
    doc.text(`${r.completionRate}%`, xRate, y, { align: 'right' })
    doc.setDrawColor(230, 230, 230)
    doc.setLineWidth(0.2)
    doc.line(margin, y + 2, margin + contentW, y + 2)
    y += 7
  }

  y += 4
  doc.setFontSize(7)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'italic')
  doc.text('Documento generado por Folvy APPCC. "Sin hacer" = tareas vencidas no completadas; lo pendiente aun a tiempo no cuenta. "Tarde" a granularidad de dia.', margin, y, { maxWidth: contentW })

  drawFooter(doc)
  return finalizePdf(doc, `APPCC_Rendimiento_${fromDate}_${toDate}_${locationInfo.name.replace(/\s/g, '_')}.pdf`, options)
}

// ============================================================
// 4. INFORME DE INCIDENCIAS (rango de fechas)
// ============================================================

export async function generateIncidentsReportPdf(
  locationId: string,
  fromDate: string,
  toDate: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const incidents = await incidentsService.listIncidentsByDateRange(locationId, fromDate, toDate)
  if (incidents.length === 0) throw new Error('No hay incidencias en este periodo')

  // Cargar acciones de cada incidencia
  const incidentsWithActions: { incident: AppccIncident; actions: AppccIncidentAction[] }[] = []
  for (const inc of incidents) {
    const detail = await incidentsService.getIncidentWithActions(inc.id)
    if (detail) incidentsWithActions.push(detail)
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  y = drawHeader(doc, y, margin, contentW, locationInfo, 'Informe de incidencias APPCC')

  doc.setFontSize(14)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text(`Incidencias del ${fromDate} al ${toDate}`, margin, y)
  y += 8

  // Estadísticas
  const open = incidents.filter(i => i.status === 'open').length
  const resolved = incidents.filter(i => i.status === 'corrected' || i.status === 'verified' || i.status === 'closed').length
  const critical = incidents.filter(i => i.severity === 'critical').length
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Total: ${incidents.length}  |  Abiertas: ${open}  |  Resueltas: ${resolved}  |  Críticas: ${critical}`, margin, y)
  y += 8

  const SEVERITY_COLORS: Record<string, readonly [number, number, number]> = {
    critical: DANGER,
    high: [234, 88, 12] as const,  // orange
    medium: [202, 138, 4] as const, // amber
    low: GRAY,
  }

  for (const { incident: inc, actions } of incidentsWithActions) {
    if (y > 240) { doc.addPage(); y = margin }

    // Severidad
    const sevColor = SEVERITY_COLORS[inc.severity] ?? GRAY
    doc.setFillColor(sevColor[0], sevColor[1], sevColor[2])
    doc.rect(margin, y - 3, contentW, 0.8, 'F')

    // Título
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    doc.text(inc.title, margin, y + 2)
    y += 6

    // Metadata
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(
      `Severidad: ${inc.severity.toUpperCase()}  |  Estado: ${inc.status}  |  Fuente: ${inc.source}  |  Creada: ${new Date(inc.created_at).toLocaleString('es-ES')}`,
      margin, y
    )
    y += 4

    if (inc.description) {
      doc.text(`Descripción: ${inc.description.slice(0, 120)}`, margin, y, { maxWidth: contentW })
      y += 4
    }

    if (inc.resolved_at) {
      doc.setTextColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
      doc.text(`Resuelta: ${new Date(inc.resolved_at).toLocaleString('es-ES')}`, margin, y)
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      y += 4
    }

    // Acciones correctivas
    if (actions.length > 0) {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.text('Acciones:', margin + 4, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      for (const act of actions) {
        if (y > 270) { doc.addPage(); y = margin }
        const typeLabel = act.action_type === 'corrective' ? '✓ Correctiva' : act.action_type === 'preventive' ? '→ Preventiva' : '· ' + (act.action_type ?? 'Nota')
        doc.text(`${typeLabel}: ${act.description.slice(0, 100)}`, margin + 8, y, { maxWidth: contentW - 12 })
        y += 4
        doc.setTextColor(180, 180, 180)
        doc.text(`${new Date(act.taken_at).toLocaleString('es-ES')}`, margin + 8, y)
        doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
        y += 4
      }
    }
    y += 4
  }

  doc.setFontSize(7)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'italic')
  doc.text('Documento generado por Folvy APPCC.', margin, y, { maxWidth: contentW })

  drawFooter(doc)
  return finalizePdf(doc, `APPCC_Incidencias_${fromDate}_${toDate}_${locationInfo.name.replace(/\s/g, '_')}.pdf`, options)
}

// ============================================================
// 5. INFORME COMPLETO INSPECTOR (controles + incidencias + resoluciones)
// ============================================================

export async function generateInspectorReportPdf(
  locationId: string,
  fromDate: string,
  toDate: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  // Cargar todo en paralelo
  const [executions, incidents] = await Promise.all([
    executionsService.listByDateRange(locationId, fromDate, toDate),
    incidentsService.listIncidentsByDateRange(locationId, fromDate, toDate),
  ])

  if (executions.length === 0 && incidents.length === 0) {
    throw new Error('No hay registros ni incidencias en este periodo')
  }

  // Templates
  const templateIds = [...new Set(executions.map(e => e.template_id))]
  const tplCache = new Map<string, AppccTemplateWithItems>()
  for (const tid of templateIds) {
    const t = await templatesService.getTemplateWithItems(tid)
    if (t) tplCache.set(tid, t)
  }

  // Acciones de incidencias
  const incActions = new Map<string, AppccIncidentAction[]>()
  for (const inc of incidents) {
    const detail = await incidentsService.getIncidentWithActions(inc.id)
    if (detail) incActions.set(inc.id, detail.actions)
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = W - margin * 2
  let y = margin

  y = drawHeader(doc, y, margin, contentW, locationInfo, 'INFORME INSPECCIÓN APPCC')

  // Título principal
  doc.setFontSize(16)
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFont('helvetica', 'bold')
  doc.text('Informe de registros APPCC', margin, y)
  y += 7
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`Periodo: ${fromDate} al ${toDate}`, margin, y)
  y += 8

  // === RESUMEN EJECUTIVO ===
  doc.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2])
  doc.rect(margin, y, contentW, 22, 'F')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.text('RESUMEN EJECUTIVO', margin + 3, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(8)

  const totalControls = executions.length
  const completedControls = executions.filter(e => e.status === 'completed').length
  const complianceRate = totalControls > 0 ? Math.round((completedControls / totalControls) * 100) : 0
  const totalIncidents = incidents.length
  const resolvedIncidents = incidents.filter(i => i.status === 'corrected' || i.status === 'verified' || i.status === 'closed').length
  const criticalIncidents = incidents.filter(i => i.severity === 'critical').length

  doc.text(`Controles programados: ${totalControls}  |  Completados: ${completedControls}  |  Tasa de cumplimiento: ${complianceRate}%`, margin + 3, y + 11)
  doc.text(`Incidencias: ${totalIncidents}  |  Resueltas: ${resolvedIncidents}  |  Críticas: ${criticalIncidents}`, margin + 3, y + 16)
  y += 28

  // === SECCIÓN 1: CONTROLES ===
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.text('1. Registro de controles', margin, y)
  y += 7

  // Tabla de controles por fecha
  const byDate = new Map<string, typeof executions>()
  for (const e of executions) {
    if (!byDate.has(e.scheduled_date)) byDate.set(e.scheduled_date, [])
    byDate.get(e.scheduled_date)!.push(e)
  }

  for (const [date, dayExecs] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (y > 255) { doc.addPage(); y = margin }

    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text(dateLabel, margin, y)
    y += 4.5

    for (const exec of dayExecs.sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''))) {
      if (y > 268) { doc.addPage(); y = margin }
      const tpl = tplCache.get(exec.template_id)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')

      if (exec.has_failures) {
        doc.setFillColor(DANGER[0], DANGER[1], DANGER[2])
      } else if (exec.status === 'completed') {
        doc.setFillColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
      } else {
        doc.setFillColor(200, 200, 200)
      }
      doc.circle(margin + 2, y - 0.5, 1, 'F')

      doc.setTextColor(0, 0, 0)
      doc.text(`${tpl?.name ?? '—'}`, margin + 5, y)
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(`${exec.scheduled_time?.slice(0, 5) ?? '—'}  ${exec.status === 'completed' ? '✓' : exec.status}${exec.failure_count > 0 ? ` (${exec.failure_count} inc.)` : ''}`, margin + 95, y)
      y += 3.8
    }
    y += 2
  }

  // === SECCIÓN 2: INCIDENCIAS ===
  if (incidents.length > 0) {
    if (y > 230) { doc.addPage(); y = margin }

    y += 4
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text('2. Incidencias y acciones correctoras', margin, y)
    y += 7

    for (const inc of incidents) {
      if (y > 240) { doc.addPage(); y = margin }

      const actions = incActions.get(inc.id) ?? []
      const isResolved = inc.status === 'corrected' || inc.status === 'verified' || inc.status === 'closed'

      // Barra de severidad
      const sevColors: Record<string, readonly [number, number, number]> = {
        critical: DANGER, high: [234, 88, 12] as const, medium: [202, 138, 4] as const, low: GRAY,
      }
      const sc = sevColors[inc.severity] ?? GRAY
      doc.setFillColor(sc[0], sc[1], sc[2])
      doc.rect(margin, y - 2.5, 2, 8, 'F')

      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(inc.title, margin + 5, y)
      y += 4

      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(`${inc.severity.toUpperCase()} | ${inc.source} | ${new Date(inc.created_at).toLocaleDateString('es-ES')} | ${isResolved ? 'RESUELTA' : inc.status.toUpperCase()}`, margin + 5, y)
      y += 4

      if (inc.description) {
        doc.text(inc.description.slice(0, 150), margin + 5, y, { maxWidth: contentW - 8 })
        y += 4
      }

      // Acciones
      for (const act of actions) {
        if (y > 270) { doc.addPage(); y = margin }
        doc.setFontSize(7)
        const prefix = act.action_type === 'corrective' ? '→ Correctiva' : act.action_type === 'preventive' ? '→ Preventiva' : '→ ' + (act.action_type ?? 'Nota')
        doc.setTextColor(isResolved ? SUCCESS[0] : GRAY[0], isResolved ? SUCCESS[1] : GRAY[1], isResolved ? SUCCESS[2] : GRAY[2])
        doc.text(`${prefix}: ${act.description.slice(0, 100)}  (${new Date(act.taken_at).toLocaleDateString('es-ES')})`, margin + 8, y, { maxWidth: contentW - 12 })
        y += 3.5
      }
      y += 4
    }
  }

  // Pie legal
  y += 6
  if (y > 270) { doc.addPage(); y = margin }
  doc.setFontSize(7)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.setFont('helvetica', 'italic')
  doc.text(
    'Informe generado automáticamente por Folvy APPCC. Todos los registros están respaldados por firma electrónica simple según Reglamento eIDAS UE 910/2014. ' +
    'Este documento puede ser presentado ante las autoridades sanitarias competentes conforme al Reglamento CE 852/2004 y RD 109/2010.',
    margin, y, { maxWidth: contentW }
  )

  drawFooter(doc)
  return finalizePdf(doc, `APPCC_Inspector_${fromDate}_${toDate}_${locationInfo.name.replace(/\s/g, '_')}.pdf`, options)
}

// ============================================================
// HELPERS DE DIBUJO
// ============================================================

function drawHeader(
  doc: jsPDF, y: number, margin: number, contentW: number,
  location: LocationInfo, subtitle: string,
): number {
  // Barra superior con color accent
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 12, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('FOLVY APPCC', margin, 8)
  doc.setFont('helvetica', 'normal')
  doc.text(subtitle, margin + 80, 8)
  doc.text(new Date().toLocaleDateString('es-ES'), margin + contentW - 20, 8)

  y = 18

  // Datos del local
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(location.name, margin, y)
  y += 5
  if (location.address) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(location.address, margin, y)
    y += 5
  }

  // Línea separadora
  y += 2
  doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setLineWidth(0.5)
  doc.line(margin, y, margin + contentW, y)
  y += 6

  return y
}

function drawItemRow(
  doc: jsPDF, y: number, margin: number, contentW: number,
  item: AppccTemplateItem & { options?: { id: string; label: string; is_failure: boolean }[] },
  resp: AppccExecutionResponse | undefined,
): number {
  const hasResponse = resp !== undefined
  const isOutOfRange = resp?.is_out_of_range === true

  // Fondo de la fila
  if (isOutOfRange) {
    doc.setFillColor(254, 242, 242) // red-50
  } else if (hasResponse) {
    doc.setFillColor(240, 253, 244) // green-50
  } else {
    doc.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2])
  }
  doc.rect(margin, y - 3.5, contentW, 10, 'F')

  // Indicador de estado
  if (isOutOfRange) {
    doc.setFillColor(DANGER[0], DANGER[1], DANGER[2])
  } else if (hasResponse) {
    doc.setFillColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
  } else {
    doc.setFillColor(200, 200, 200)
  }
  doc.circle(margin + 3, y + 0.5, 1.5, 'F')

  // Label del item
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text(item.label, margin + 8, y + 1, { maxWidth: contentW * 0.55 })

  // Valor
  const valueStr = formatResponseValue(item, resp)
  const valueX = margin + contentW * 0.65
  if (isOutOfRange) {
    doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
    doc.setFont('helvetica', 'bold')
  } else {
    const cc2 = hasResponse ? ([0, 0, 0] as const) : GRAY; doc.setTextColor(cc2[0], cc2[1], cc2[2])
    doc.setFont('helvetica', 'normal')
  }
  doc.text(valueStr, valueX, y + 1, { maxWidth: contentW * 0.3 })

  // Warning de rango
  if (isOutOfRange && item.numeric_min !== null && item.numeric_max !== null) {
    doc.setFontSize(7)
    doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
    doc.text(`Rango: ${item.numeric_min}–${item.numeric_max} ${item.numeric_unit ?? ''}`, valueX, y + 5)
    return y + 11
  }

  return y + 8
}

function formatResponseValue(
  item: AppccTemplateItem & { options?: { id: string; label: string }[] },
  resp: AppccExecutionResponse | undefined,
): string {
  if (!resp) return '— Sin respuesta —'

  if (resp.numeric_value !== null && resp.numeric_value !== undefined) {
    return `${resp.numeric_value} ${item.numeric_unit ?? ''}`
  }
  if (resp.boolean_value === true) return '✓ Sí'
  if (resp.boolean_value === false) return '✗ No'
  if (resp.text_value) return resp.text_value.slice(0, 60)
  if (resp.date_value) return resp.date_value
  if (resp.selected_option_id && item.options) {
    const opt = item.options.find(o => o.id === resp.selected_option_id)
    return opt?.label ?? resp.selected_option_id
  }
  return '— Sin respuesta —'
}

function drawSignatureBlock(
  doc: jsPDF, y: number, margin: number, contentW: number,
  signature: SignatureInfo | null,
): number {
  doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.setLineWidth(0.3)
  doc.rect(margin, y, contentW, 28, 'S')

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.text('FIRMA ELECTRÓNICA', margin + 3, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])

  if (signature) {
    doc.text(`Firmado: ${new Date(signature.signed_at).toLocaleString('es-ES')}`, margin + 3, y + 11)
    doc.text(`Hash SHA-256: ${signature.signature_hash.slice(0, 32)}...`, margin + 3, y + 16)
    doc.text(`ID usuario: ${signature.user_id.slice(0, 8)}...`, margin + 3, y + 21)
  } else {
    doc.text('No firmado', margin + 3, y + 11)
  }

  doc.setFontSize(6)
  doc.text(
    'Firma electrónica simple según Reglamento UE 910/2014 (eIDAS). Validez legal conforme al artículo 25.1.',
    margin + 3, y + 26
  )

  return y + 32
}

function drawFooter(doc: jsPDF): void {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.setFont('helvetica', 'normal')
    doc.text(`Folvy APPCC · Generado ${new Date().toLocaleString('es-ES')}`, 15, H - 8)
    doc.text(`Página ${i} de ${pages}`, W - 40, H - 8)
  }
}

async function getSignature(executionId: string): Promise<SignatureInfo | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('appcc_signatures')
    .select('signed_at, signature_hash, user_id')
    .eq('execution_id', executionId)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as SignatureInfo | null
}

/**
 * Descarga una imagen desde URL, la redimensiona a maxWidth (manteniendo aspect ratio)
 * y la devuelve como DataURL JPEG. Devuelve null si falla.
 *
 * Uso: para embeber fotos en PDFs sin saturar el tamaño final. Aplica:
 *   - Max maxWidth px de ancho (típico 800).
 *   - JPEG quality configurable (típico 0.7, balance peso/calidad).
 *   - No aplica rotación EXIF (deuda menor: fotos verticales de móvil pueden
 *     salir en horizontal según cómo se subieron originalmente).
 */
async function loadAndResizeImage(
  url: string,
  maxWidth: number,
  quality: number,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('img load failed'))
      i.src = URL.createObjectURL(blob)
    })
    const scale = Math.min(1, maxWidth / img.naturalWidth)
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    URL.revokeObjectURL(img.src)
    return { dataUrl, widthPx: w, heightPx: h }
  } catch (err) {
    console.warn('[pdfExportService] loadAndResizeImage failed:', err)
    return null
  }
}

// ============================================================
// 5. INFORME CAPA DE UNA INCIDENCIA INDIVIDUAL
// ============================================================

/**
 * PDF inspector-ready con todo el ciclo de vida de una incidencia:
 * detección, root cause, acciones correctivas/preventivas, verificación,
 * cierre y timeline cronológico.
 */
export async function generateIncidentCapaPdf(
  incidentId: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const detail = await incidentsService.getIncidentDetail(incidentId)
  if (!detail) throw new Error('Incidencia no encontrada')

  const { incident, events, photos } = detail

  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  let y = 18

  // ---------- HEADER ----------
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('INFORME DE INCIDENCIA CAPA', 15, 14)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Local: ${locationInfo.name}`, 15, 22)

  y = 38
  doc.setTextColor(0, 0, 0)

  // ---------- DATOS PRINCIPALES ----------
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(incident.title, 15, y)
  y += 7

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const sevColor =
    incident.severity === 'critical' ? DANGER :
    incident.severity === 'high' ? [251, 146, 60] as const :
    incident.severity === 'medium' ? [234, 179, 8] as const :
    GRAY
  doc.setFillColor(sevColor[0], sevColor[1], sevColor[2])
  doc.setTextColor(255, 255, 255)
  doc.roundedRect(15, y - 4, 28, 6, 1, 1, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text(`SEV: ${incident.severity.toUpperCase()}`, 16, y)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Estado: ${incident.status}  ·  Origen: ${incident.source}`, 48, y)
  y += 8

  doc.setFontSize(9)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Creada: ${new Date(incident.created_at).toLocaleString('es-ES')}`, 15, y)
  if (incident.due_at) {
    doc.text(`Plazo SLA: ${new Date(incident.due_at).toLocaleString('es-ES')}`, 110, y)
  }
  y += 5
  if (incident.escalated && incident.escalated_at) {
    doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
    doc.text(`⚠ Escalada automáticamente: ${new Date(incident.escalated_at).toLocaleString('es-ES')}`, 15, y)
    y += 5
  }

  doc.setTextColor(0, 0, 0)
  y += 3

  // ---------- DESCRIPCIÓN ----------
  if (incident.description) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Descripción', 15, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(incident.description, W - 30)
    doc.text(lines, 15, y)
    y += lines.length * 4 + 4
  }

  // Helper para imprimir secciones
  const printSection = (title: string, content: string | null | undefined, meta?: string) => {
    if (!content) return
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text(title, 15, y)
    y += 5
    if (meta) {
      doc.setFontSize(8)
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.setFont('helvetica', 'italic')
      doc.text(meta, 15, y)
      y += 4
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    const lines = doc.splitTextToSize(content, W - 30)
    doc.text(lines, 15, y)
    y += lines.length * 4 + 6
  }

  // ---------- ROOT CAUSE ----------
  if (incident.root_cause) {
    printSection(
      '1. ANÁLISIS DE CAUSA RAÍZ',
      incident.root_cause,
      `Método: ${incident.root_cause_method ?? 'directo'}`
    )
    // Si hay 5 whys, listarlos
    const whys = (incident.root_cause_data as { whys?: string[] } | null)?.whys
    if (Array.isArray(whys) && whys.length) {
      doc.setFontSize(9)
      whys.forEach((w, i) => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(`  ${i + 1}. ${w}`, 18, y)
        y += 4
      })
      y += 3
    }
  }

  // ---------- CORRECTIVA ----------
  if (incident.corrective_action) {
    printSection(
      '2. ACCIÓN CORRECTIVA',
      incident.corrective_action,
      incident.corrective_action_at
        ? `Aplicada: ${new Date(incident.corrective_action_at).toLocaleString('es-ES')}`
        : undefined
    )
  }

  // ---------- PREVENTIVA ----------
  if (incident.preventive_action) {
    printSection(
      '3. ACCIÓN PREVENTIVA',
      incident.preventive_action,
      incident.preventive_action_at
        ? `Aplicada: ${new Date(incident.preventive_action_at).toLocaleString('es-ES')}`
        : undefined
    )
  }

  // ---------- VERIFICACIÓN ----------
  if (incident.verified_at) {
    printSection(
      '4. VERIFICACIÓN DE EFECTIVIDAD',
      incident.verification_notes ?? '(sin notas)',
      `${incident.verification_effective ? '✓ EFECTIVA' : '✗ NO EFECTIVA'} · ${new Date(incident.verified_at).toLocaleString('es-ES')}`
    )
  }

  // ---------- CIERRE ----------
  if (incident.closed_at) {
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFillColor(SUCCESS[0], SUCCESS[1], SUCCESS[2])
    doc.setTextColor(255, 255, 255)
    doc.roundedRect(15, y - 4, W - 30, 14, 2, 2, 'F')
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('✓ INCIDENCIA CERRADA FORMALMENTE', 18, y + 2)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(`Cerrada: ${new Date(incident.closed_at).toLocaleString('es-ES')}`, 18, y + 7)
    if (incident.closure_signature) {
      doc.text(`Firma SHA-256: ${incident.closure_signature.slice(0, 32)}...`, 18, y + 11)
    }
    doc.setTextColor(0, 0, 0)
    y += 20
  }

  // ---------- TIMELINE ----------
  if (events.length > 0) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text('CRONOLOGÍA DE EVENTOS', 15, y)
    y += 6
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')

    events.forEach(evt => {
      if (y > 280) { doc.addPage(); y = 20 }
      const dt = new Date(evt.created_at).toLocaleString('es-ES', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(dt, 15, y)
      doc.setTextColor(0, 0, 0)
      const desc = `${evt.description ?? evt.event_type}${evt.actor_name ? ` — ${evt.actor_name}` : ''}`
      const lines = doc.splitTextToSize(desc, W - 70)
      doc.text(lines, 55, y)
      y += Math.max(4, lines.length * 4)
    })
  }

  // ---------- FOTOS (embebidas) ----------
  if (photos.length > 0 && supabase) {
    // Generar signed URLs en batch para todas las fotos.
    const paths = photos.map(p => p.storage_path)
    const { data: signed } = await supabase.storage
      .from('appcc-photos')
      .createSignedUrls(paths, 3600)

    // Cargar + redimensionar todas en paralelo (orden preservado).
    const loaded = await Promise.all(
      photos.map(async (_, i) => {
        const url = signed?.[i]?.signedUrl
        if (!url) return null
        return loadAndResizeImage(url, 800, 0.7)
      })
    )

    if (y > 240) { doc.addPage(); y = 20 }
    y += 5
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text('EVIDENCIAS FOTOGRÁFICAS', 15, y)
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'normal')
    y += 7

    const PAGE_H = doc.internal.pageSize.getHeight()
    const photoWidthMm = 80           // ~7-8 cm de ancho en A4
    const maxPhotoHeightMm = 100      // tope vertical razonable
    const captionHeightMm = 8

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i]
      const img = loaded[i]
      if (!img) {
        if (y + 20 > PAGE_H - 20) { doc.addPage(); y = 20 }
        doc.setFontSize(9)
        doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
        doc.setFont('helvetica', 'italic')
        doc.text(`Foto ${i + 1} — no se pudo cargar`, 15, y)
        doc.setTextColor(0, 0, 0)
        doc.setFont('helvetica', 'normal')
        y += 6
        continue
      }
      const aspectRatio = img.heightPx / img.widthPx
      let photoHeightMm = photoWidthMm * aspectRatio
      if (photoHeightMm > maxPhotoHeightMm) {
        photoHeightMm = maxPhotoHeightMm
      }
      const blockHeight = photoHeightMm + captionHeightMm + 4
      if (y + blockHeight > PAGE_H - 20) {
        doc.addPage()
        y = 20
      }
      doc.addImage(img.dataUrl, 'JPEG', 15, y, photoWidthMm, photoHeightMm)
      y += photoHeightMm + 2

      doc.setFontSize(8)
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.setFont('helvetica', 'italic')
      const ts = new Date(p.uploaded_at).toLocaleString('es-ES')
      const captionText = p.caption
        ? `Foto ${i + 1} — ${ts} — ${p.caption}`
        : `Foto ${i + 1} — ${ts}`
      doc.text(captionText, 15, y)
      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'normal')
      y += captionHeightMm
    }
  }

  // ---------- FOOTER ----------
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    const H = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.setFont('helvetica', 'normal')
    doc.text(`Folvy APPCC · CAPA Report · Generado ${new Date().toLocaleString('es-ES')}`, 15, H - 8)
    doc.text(`Página ${i} de ${pages}`, W - 40, H - 8)
  }

  return finalizePdf(
    doc,
    `incidencia-CAPA-${incident.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.pdf`,
    options,
  )
}
