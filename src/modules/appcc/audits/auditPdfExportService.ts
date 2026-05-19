// src/modules/appcc/audits/auditPdfExportService.ts
// PDF de auditoría con scoring por sección y firma.

import jsPDF from 'jspdf'
import * as auditsService from './auditsService'
import type {
  PdfExportOptions,
  PdfPreviewResult,
} from '@/modules/appcc/services/pdfExportService'

interface LocationInfo {
  name: string
  address?: string
}

const ACCENT = [30, 58, 95] as const
const SUCCESS = [16, 185, 129] as const
const DANGER = [220, 38, 38] as const
const WARNING = [245, 158, 11] as const
const GRAY = [107, 114, 128] as const

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

export async function generateAuditPdf(
  auditId: string,
  locationInfo: LocationInfo,
  options?: PdfExportOptions,
): Promise<PdfPreviewResult | null> {
  const detail = await auditsService.getAuditDetail(auditId)
  if (!detail) throw new Error('Auditoría no encontrada')

  const scoring = auditsService.calculateScoring(detail.template, detail.responses)
  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  let y = 18

  // ---------- HEADER ----------
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(0, 0, W, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('INFORME DE AUDITORÍA APPCC', 15, 14)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Local: ${locationInfo.name}`, 15, 22)
  doc.text(`Fecha: ${new Date(detail.audit.scheduled_date).toLocaleDateString('es-ES')}`, 15, 28)

  y = 42
  doc.setTextColor(0, 0, 0)

  // ---------- RESULTADO ----------
  const passed = detail.audit.passed ?? false
  const resultColor = passed ? SUCCESS : DANGER
  doc.setFillColor(resultColor[0], resultColor[1], resultColor[2])
  doc.roundedRect(15, y, W - 30, 28, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.text(`${scoring.totalScore}/100`, 20, y + 18)
  doc.setFontSize(12)
  doc.text(passed ? 'APROBADA' : 'NO APROBADA', W - 20, y + 13, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Umbral: ${detail.template.pass_score}%`, W - 20, y + 22, { align: 'right' })
  doc.setTextColor(0, 0, 0)
  y += 36

  // ---------- DATOS ----------
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(detail.template.name, 15, y)
  y += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(`Estado: ${detail.audit.status}`, 15, y)
  if (detail.audit.completed_at) {
    doc.text(
      `Completada: ${new Date(detail.audit.completed_at).toLocaleString('es-ES')}`,
      75, y
    )
  }
  y += 5
  doc.text(
    `Auditor: ${detail.audit.auditor_name ?? '(no asignado)'}`,
    15, y
  )
  y += 8
  doc.setTextColor(0, 0, 0)

  // ---------- RESUMEN POR SECCIÓN ----------
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.text('Resumen por sección', 15, y)
  y += 6
  doc.setTextColor(0, 0, 0)

  for (const sec of scoring.sectionScores) {
    if (y > 270) { doc.addPage(); y = 20 }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(sec.sectionName, 15, y)

    // Barra de progreso
    const barX = 90
    const barW = 70
    const barH = 5
    doc.setFillColor(229, 231, 235)
    doc.roundedRect(barX, y - 4, barW, barH, 1, 1, 'F')
    const fillColor = sec.score >= detail.template.pass_score ? SUCCESS
      : sec.score >= detail.template.pass_score * 0.7 ? WARNING
      : DANGER
    doc.setFillColor(fillColor[0], fillColor[1], fillColor[2])
    doc.roundedRect(barX, y - 4, (barW * sec.score) / 100, barH, 1, 1, 'F')

    doc.setFont('helvetica', 'bold')
    doc.text(`${sec.score}%`, W - 15, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 7
  }

  y += 4

  // ---------- KPIs adicionales ----------
  if (y > 250) { doc.addPage(); y = 20 }
  doc.setFontSize(9)
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
  doc.text(
    `Ítems totales: ${scoring.itemsTotal}  ·  Respondidos: ${scoring.itemsAnswered}  ·  N/A: ${scoring.itemsNa}  ·  Fallos: ${scoring.itemsFailures}`,
    15, y
  )
  doc.setTextColor(0, 0, 0)
  y += 8

  // ---------- DETALLE POR ÍTEM ----------
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.text('Detalle de respuestas', 15, y)
  y += 6
  doc.setTextColor(0, 0, 0)

  const respByItem = new Map(detail.responses.map(r => [r.item_id, r]))

  for (const section of detail.template.sections) {
    if (y > 260) { doc.addPage(); y = 20 }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setFillColor(245, 244, 240)
    doc.rect(15, y - 5, W - 30, 7, 'F')
    doc.text(section.name, 17, y)
    y += 7

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')

    for (const item of section.items) {
      if (y > 275) { doc.addPage(); y = 20 }
      const r = respByItem.get(item.id)
      const valueLabel = !r?.value || r.value === 'na' ? 'N/A'
        : r.value === 'yes' ? '✓ Sí'
        : r.value === 'no' ? '✗ No'
        : r.value

      const valueColor = !r?.value || r.value === 'na' ? GRAY
        : r.value === 'no' || (item.scoring_type === 'scale_0_5' && parseInt(r.value) <= 2) ? DANGER
        : SUCCESS

      // Código del ítem
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.setFontSize(8)
      doc.text(item.code, 15, y)

      // Pregunta
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
      const questionLines = doc.splitTextToSize(item.question, W - 60)
      doc.text(questionLines, 28, y)

      // Respuesta
      doc.setTextColor(valueColor[0], valueColor[1], valueColor[2])
      doc.setFont('helvetica', 'bold')
      doc.text(valueLabel, W - 15, y, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)

      y += Math.max(4, questionLines.length * 4) + 1

      if (r?.notes) {
        doc.setFontSize(8)
        doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
        const noteLines = doc.splitTextToSize(`Notas: ${r.notes}`, W - 50)
        doc.text(noteLines, 28, y)
        y += noteLines.length * 4 + 1
        doc.setTextColor(0, 0, 0)
        doc.setFontSize(9)
      }

      if (r?.incident_id) {
        doc.setFontSize(8)
        doc.setTextColor(DANGER[0], DANGER[1], DANGER[2])
        doc.text('⚠ Incidencia generada automáticamente', 28, y)
        y += 4
        doc.setTextColor(0, 0, 0)
        doc.setFontSize(9)
      }

      y += 1
    }
    y += 2
  }

  // ---------- NOTAS Y FIRMA ----------
  if (detail.audit.notes) {
    if (y > 250) { doc.addPage(); y = 20 }
    y += 4
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
    doc.text('Notas finales', 15, y)
    y += 5
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    const noteLines = doc.splitTextToSize(detail.audit.notes, W - 30)
    doc.text(noteLines, 15, y)
    y += noteLines.length * 4 + 4
  }

  if (detail.audit.signature) {
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFillColor(245, 244, 240)
    doc.roundedRect(15, y, W - 30, 18, 2, 2, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Firma electrónica (SHA-256)', 20, y + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.text(detail.audit.signature.slice(0, 64) + '...', 20, y + 11)
    if (detail.audit.completed_at) {
      doc.text(
        `Firmada: ${new Date(detail.audit.completed_at).toLocaleString('es-ES')}`,
        20, y + 15
      )
    }
    doc.setTextColor(0, 0, 0)
  }

  // ---------- FOOTER ----------
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Foodint APPCC · Auditoría · Generado ${new Date().toLocaleString('es-ES')}`,
      15, H - 8
    )
    doc.text(`Página ${i} de ${pages}`, W - 40, H - 8)
  }

  return finalizePdf(
    doc,
    `auditoria-${detail.template.code}-${detail.audit.scheduled_date}-${locationInfo.name.replace(/\s/g, '_')}.pdf`,
    options,
  )
}
