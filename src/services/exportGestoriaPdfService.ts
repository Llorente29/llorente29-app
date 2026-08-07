// src/services/exportGestoriaPdfService.ts
// F5.2 — PDF del cierre de mes / export a gestoría (export_gestoria_mensual).
// Mismo motor de marca que registroJornadaPdfService.ts. Apaisado (landscape)
// porque son 12 columnas por empleado — la última, "incidencias", se pinta
// SIEMPRE, nunca se recorta ni se esconde tras un tooltip: es lo que
// diferencia un export honesto de uno que pasa datos sucios a la gestoría.

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import type { ExportGestoriaRow } from './exportGestoriaMensualService'

const NAVY: [number, number, number] = [30, 58, 95]
const TERRA: [number, number, number] = [214, 116, 66]
const INK: [number, number, number] = [31, 36, 33]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [227, 230, 226]
const WHITE: [number, number, number] = [255, 255, 255]
const DANGER: [number, number, number] = [224, 73, 46]
const DANGER_BG: [number, number, number] = [251, 232, 227]
const ZEBRA: [number, number, number] = [250, 251, 250]

const FOLVY_URL = 'https://folvy.app'
const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 14
const CONTENT_W = PAGE_W - 2 * MARGIN
const ROW_H = 7
const SLIM_HEADER_H = 11

function fmtHoras(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export interface ExportGestoriaPdfData {
  account: { legalName: string | null; cif: string | null }
  periodLabel: string
  periodFrom: string
  periodTo: string
  rows: ExportGestoriaRow[]
}

export function generateExportGestoriaPdf(data: ExportGestoriaPdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  ensureFraunces(doc)
  const fontList = doc.getFontList() as Record<string, unknown>
  const hasFraunces = Object.prototype.hasOwnProperty.call(fontList, 'Fraunces')
  const display = (style: 'normal' | 'bold' = 'normal') => doc.setFont(hasFraunces ? 'Fraunces' : 'helvetica', style)
  const sans = (style: 'normal' | 'bold' = 'normal') => doc.setFont('helvetica', style)
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  const clientName = data.account.legalName ?? 'Empresa'
  const generatedAtLabel = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
  const withIncidents = data.rows.filter(r => r.incidencias.length > 0).length

  function drawSlimHeader() {
    fill(NAVY); doc.rect(0, 0, PAGE_W, SLIM_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text(`${clientName} — Cierre de mes`, MARGIN, 7.2)
    sans('normal'); doc.setFontSize(7.5)
    doc.text(data.periodLabel, PAGE_W - MARGIN, 7.2, { align: 'right' })
  }

  // ── Cabecera ──
  let y = MARGIN
  display('bold'); doc.setFontSize(9); ink(INK)
  doc.text(clientName, MARGIN, y)
  if (data.account.cif) {
    sans('normal'); doc.setFontSize(8); ink(MUTED)
    doc.text(`CIF ${data.account.cif}`, PAGE_W - MARGIN, y, { align: 'right' })
  }
  y += 6
  fill(NAVY); doc.rect(MARGIN, y, CONTENT_W * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(MARGIN + CONTENT_W * 0.4, y, CONTENT_W * 0.12, 1.1, 'F')
  fill(LINE); doc.rect(MARGIN + CONTENT_W * 0.52, y, CONTENT_W * 0.48, 1.1, 'F')
  y += 8

  display('bold'); doc.setFontSize(17); ink(INK)
  doc.text('Cierre de mes — export a gestoría', MARGIN, y)
  sans('normal'); doc.setFontSize(9.5); ink(TERRA)
  doc.text(data.periodLabel, PAGE_W - MARGIN, y, { align: 'right' })
  y += 8

  // Bloqueos visibles: nunca se ocultan, van arriba del todo.
  if (withIncidents > 0) {
    fill(DANGER_BG); stroke(DANGER); doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, y, CONTENT_W, 6.5, 1.5, 1.5, 'FD')
    sans('bold'); doc.setFontSize(8); ink(DANGER)
    doc.text(
      `${withIncidents} de ${data.rows.length} empleado${data.rows.length === 1 ? '' : 's'} con incidencias que revisar antes de enviar — ver columna INCIDENCIAS.`,
      MARGIN + 3, y + 4.4,
    )
    y += 9.5
  } else {
    sans('normal'); doc.setFontSize(8); ink(MUTED)
    doc.text('Sin incidencias detectadas en el periodo.', MARGIN, y + 3)
    y += 7
  }

  // ── Tabla ──
  const cols = [
    { key: 'empleado', label: 'EMPLEADO', x: MARGIN + 2, w: 42, align: 'left' as const },
    { key: 'dni', label: 'DNI', x: 0, w: 22, align: 'left' as const },
    { key: 'local', label: 'LOCAL', x: 0, w: 30, align: 'left' as const },
    { key: 'diasTrabajados', label: 'DÍAS TRAB.', x: 0, w: 18, align: 'right' as const },
    { key: 'horasTrabajadas', label: 'H. TRAB.', x: 0, w: 18, align: 'right' as const },
    { key: 'horasNocturnas', label: 'H. NOCT.', x: 0, w: 18, align: 'right' as const },
    { key: 'diasVacaciones', label: 'VACAC.', x: 0, w: 15, align: 'right' as const },
    { key: 'diasBaja', label: 'BAJA', x: 0, w: 13, align: 'right' as const },
    { key: 'diasFestivoTrabajado', label: 'FEST. TRAB.', x: 0, w: 18, align: 'right' as const },
    { key: 'horasContratadas', label: 'H. CONTR.', x: 0, w: 18, align: 'right' as const },
    { key: 'deltaHoras', label: 'DELTA', x: 0, w: 16, align: 'right' as const },
  ]
  let cx = MARGIN + 2
  for (const c of cols) { c.x = cx; cx += c.w }
  const incidentsX = cx + 3
  const incidentsW = PAGE_W - MARGIN - incidentsX

  function drawTableHeader(yy: number): number {
    fill(NAVY); doc.rect(MARGIN, yy, CONTENT_W, 7, 'F')
    sans('bold'); doc.setFontSize(6.8); ink(WHITE)
    for (const c of cols) doc.text(c.label, c.x + (c.align === 'right' ? c.w - 2 : 0), yy + 4.6, { align: c.align })
    doc.text('INCIDENCIAS', incidentsX, yy + 4.6)
    return yy + 7
  }
  y = drawTableHeader(y)

  let zebra = false
  for (const r of data.rows) {
    const hasIncidents = r.incidencias.length > 0
    // Cada incidencia puede envolver a más de una línea dentro de incidentsW
    // (ej. "desvío de -24.7 h sobre contrato" no cabe en una sola) — hay que
    // medir las líneas reales con splitTextToSize, no asumir 1 línea/incidencia,
    // o el texto se desborda encima de la fila siguiente.
    sans('bold'); doc.setFontSize(6.8)
    const incidentLines: string[] = hasIncidents
      ? r.incidencias.flatMap(txt => doc.splitTextToSize(`• ${txt}`, incidentsW) as string[])
      : []
    const rowH = Math.max(ROW_H, 3.6 * Math.max(1, incidentLines.length) + 1.5)
    if (y + rowH > PAGE_H - MARGIN - 4) {
      doc.addPage(); drawSlimHeader()
      y = drawTableHeader(SLIM_HEADER_H + 4)
      zebra = false
    }
    if (hasIncidents) { fill(DANGER_BG); doc.rect(MARGIN, y, CONTENT_W, rowH, 'F') }
    else if (zebra) { fill(ZEBRA); doc.rect(MARGIN, y, CONTENT_W, rowH, 'F') }
    zebra = !zebra

    sans('normal'); doc.setFontSize(7.5); ink(INK)
    const vals: Record<string, string> = {
      empleado: r.empleado,
      dni: r.dni,
      local: r.local,
      diasTrabajados: String(r.diasTrabajados),
      horasTrabajadas: fmtHoras(r.horasTrabajadas),
      horasNocturnas: fmtHoras(r.horasNocturnas),
      diasVacaciones: String(r.diasVacaciones),
      diasBaja: String(r.diasBaja),
      diasFestivoTrabajado: String(r.diasFestivoTrabajado),
      horasContratadas: fmtHoras(r.horasContratadas),
      deltaHoras: `${r.deltaHoras > 0 ? '+' : ''}${fmtHoras(r.deltaHoras)}`,
    }
    for (const c of cols) {
      if (c.key === 'deltaHoras') ink(r.deltaHoras < 0 ? DANGER : INK)
      else ink(INK)
      doc.text(vals[c.key], c.x + (c.align === 'right' ? c.w - 2 : 0), y + 4.6, {
        align: c.align, maxWidth: c.w - 2,
      })
    }

    if (hasIncidents) {
      ink(DANGER); sans('bold'); doc.setFontSize(6.8)
      incidentLines.forEach((line, i) => {
        doc.text(line, incidentsX, y + 4.2 + i * 3.6, { maxWidth: incidentsW })
      })
    } else {
      ink(MUTED); sans('normal'); doc.setFontSize(7)
      doc.text('—', incidentsX, y + 4.6)
    }

    stroke(LINE); doc.setLineWidth(0.15); doc.line(MARGIN, y + rowH, PAGE_W - MARGIN, y + rowH)
    y += rowH
  }
  y += 5

  // ── Nota de configuración de gestoría (ver AVISOS del encargo) ──
  if (y + 10 < PAGE_H - MARGIN) {
    sans('normal'); doc.setFontSize(7); ink(MUTED)
    doc.text(
      'Export generado desde Folvy Team. Las horas son reales (sin redondeo). El envío automático a gestoría se configura en la pantalla "Informes Gestoría".',
      MARGIN, y,
    )
  }

  // ── Pie + numeración ──
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = PAGE_H - 7
    sans('normal'); doc.setFontSize(7.5); ink([154, 162, 154])
    doc.text(`Generado el ${generatedAtLabel}`, MARGIN, fy)
    const pre = 'Generado con '
    const link = 'Folvy · folvy.app'
    const preW = doc.getTextWidth(pre)
    const linkW = doc.getTextWidth(link)
    const startX = (PAGE_W - (preW + linkW)) / 2
    doc.text(pre, startX, fy)
    ink(TERRA)
    doc.textWithLink(link, startX + preW, fy, { url: FOLVY_URL })
    ink([179, 185, 178])
    doc.text(`Página ${p} de ${pages}`, PAGE_W - MARGIN, fy, { align: 'right' })
  }

  const periodSafe = data.periodLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const filename = `cierre-mes-gestoria_${periodSafe}.pdf`
  return { blob: doc.output('blob'), filename }
}
