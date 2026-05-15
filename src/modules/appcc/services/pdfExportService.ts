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
import type {
  AppccExecutionResponse,
  AppccTemplateWithItems,
  AppccTemplateItem,
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
// 1. CERTIFICADO DE CHECKLIST INDIVIDUAL
// ============================================================

export async function generateChecklistPdf(
  executionId: string,
  locationInfo: LocationInfo,
): Promise<void> {
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

  // Descargar
  const fileName = `APPCC_${template.code}_${execution.scheduled_date}_${locationInfo.name.replace(/\s/g, '_')}.pdf`
  doc.save(fileName)
}

// ============================================================
// 2. RESUMEN DIARIO
// ============================================================

export async function generateDailySummaryPdf(
  locationId: string,
  date: string,
  locationInfo: LocationInfo,
): Promise<void> {
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
    'Documento generado automáticamente por Foodint APPCC. Los registros están respaldados por firma electrónica simple según Reglamento eIDAS UE 910/2014.',
    margin, y, { maxWidth: contentW }
  )

  drawFooter(doc)

  const fileName = `APPCC_Resumen_${date}_${locationInfo.name.replace(/\s/g, '_')}.pdf`
  doc.save(fileName)
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
  doc.text('FOODINT APPCC', margin, 8)
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
    doc.text(`Foodint APPCC · Generado ${new Date().toLocaleString('es-ES')}`, 15, H - 8)
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
