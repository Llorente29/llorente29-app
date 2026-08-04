// src/services/trainingCompliancePdfService.ts
//
// Formación C2 — "Listo para la inspección". Mismo motor que
// allergenCompliancePdfService.ts (jsPDF + ensureFraunces, tablas dibujadas
// a mano, sin autotable) — no se monta un motor nuevo.
//
// Dos escenarios de uso (gobiernan cada decisión de diseño): la inspectora
// delante (tiene que entenderse solo, sin que nadie lo explique) y la demo
// comercial a un CEO (tiene que verse serio). Regla dura: ninguna casilla se
// pinta "formado" sin evidencia que lo respalde — los huecos van en rojo,
// nunca se esconden.
//
// DEUDA DECLARADA (permitido explícitamente por el encargo si no da tiempo):
// el QR de verificación online del pie de portada NO está implementado en
// C2 — requeriría una página pública de verificación nueva, fuera de lo que
// pidió esta capa. `qrcode` ya está en package.json para cuando se aborde.

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import type { TrainingCellState, TrainingComplianceRow } from './trainingComplianceService'

const NAVY: [number, number, number] = [30, 58, 95]
const TERRA: [number, number, number] = [214, 116, 66]
const INK: [number, number, number] = [31, 36, 33]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [227, 230, 226]
const LIGHT: [number, number, number] = [245, 244, 240]
const WHITE: [number, number, number] = [255, 255, 255]
const DANGER: [number, number, number] = [224, 73, 46]
const DANGER_BG: [number, number, number] = [251, 232, 227]
const WARNING: [number, number, number] = [194, 137, 15]
const WARNING_BG: [number, number, number] = [250, 240, 216]
const SUCCESS: [number, number, number] = [31, 157, 107]
const SUCCESS_BG: [number, number, number] = [231, 244, 238]
const UNKNOWN_BG: [number, number, number] = [238, 239, 241]

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 14
const CONTENT_W = PAGE_W - 2 * MARGIN
const SLIM_HEADER_H = 12
const FOOTER_LEGEND_Y = PAGE_H - 8
const NAME_COL_W = 62
const TABLE_HEADER_H = 7
const ROW_H = 6.2

// Record<TrainingCellState, ...> (no Record<string, ...>) a propósito: si el
// tipo de estado gana un miembro nuevo, tsc debe romper aquí en vez de dejar
// que el PDF pinte una celda en blanco/undefined ante el inspector.
const STATE_LETTER: Record<TrainingCellState, string> = {
  vigente: 'V', caducado: 'C', pendiente: 'P', en_curso: 'E', pendiente_practica: 'X', no_aplica: '·',
}
const STATE_COLOR: Record<TrainingCellState, [number, number, number]> = {
  vigente: SUCCESS, caducado: DANGER, pendiente: WARNING, en_curso: WARNING, pendiente_practica: WARNING, no_aplica: MUTED,
}
const STATE_BG: Record<TrainingCellState, [number, number, number]> = {
  vigente: SUCCESS_BG, caducado: DANGER_BG, pendiente: WARNING_BG, en_curso: WARNING_BG, pendiente_practica: WARNING_BG, no_aplica: UNKNOWN_BG,
}
export interface TrainingPdfCourseInfo {
  code: string
  title: string
  legalBasis: string | null
  sectionTitles: string[]
  estimatedMinutes: number | null
  assignedCount: number
}

export interface TrainingPdfAttendeeSignature {
  employeeName: string
  employeeDni: string | null
  role: string | null
  courseTitle: string
  scorePct: number | null
  signedAtLabel: string | null
  /** dataURL (image/png;base64) ya resuelta antes de llamar — null si no se pudo recuperar. */
  signatureDataUrl: string | null
}

export interface TrainingPdfExternalCert {
  employeeName: string
  name: string
  expiryLabel: string | null
  statusLabel: string
  statusColor: 'green' | 'yellow' | 'orange' | 'red' | 'gray'
}

export interface TrainingPdfGapRow {
  employeeName: string
  courseTitle: string
  detail: string
}

export interface TrainingCompliancePdfData {
  account: { legalName: string | null; cif: string | null }
  responsibleName: string | null
  generatedAtLabel: string
  generatedAtFilename: string
  kpi: { vigente: number; applicable: number; pct: number }
  /** Filas de la matriz agrupadas por local, en el orden en que se imprimen. */
  rowsByLocation: [string, TrainingComplianceRow[]][]
  courses: TrainingPdfCourseInfo[]
  attendeeSignatures: TrainingPdfAttendeeSignature[]
  externalCerts: TrainingPdfExternalCert[]
  gaps: TrainingPdfGapRow[]
}

function setupDoc(doc: jsPDF) {
  ensureFraunces(doc)
  const fontList = doc.getFontList() as Record<string, unknown>
  const hasFraunces = Object.prototype.hasOwnProperty.call(fontList, 'Fraunces')
  const display = (style: 'normal' | 'bold' = 'normal') => doc.setFont(hasFraunces ? 'Fraunces' : 'helvetica', style)
  const sans = (style: 'normal' | 'bold' = 'normal') => doc.setFont('helvetica', style)
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  return { display, sans, fill, stroke, ink }
}

export function generateTrainingCompliancePdf(data: TrainingCompliancePdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const { display, sans, fill, stroke, ink } = setupDoc(doc)

  const clientName = data.account.legalName ?? 'Cliente'
  const totalEmployees = data.rowsByLocation.reduce((s, [, rows]) => s + rows.length, 0)
  const locationCount = data.rowsByLocation.length

  function drawSlimHeader() {
    fill(NAVY); doc.rect(0, 0, PAGE_W, SLIM_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8.5)
    doc.text(clientName, MARGIN, 7.5)
    sans('normal'); doc.setFontSize(7.5)
    doc.text('Formación — listo para la inspección', MARGIN + doc.getTextWidth(clientName) + 5, 7.5)
  }

  function textBlock(y: number, title: string, body: string, boxH: number): number {
    fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD')
    sans('bold'); doc.setFontSize(8); ink(NAVY)
    doc.text(title.toUpperCase(), MARGIN + 4, y + 6)
    sans('normal'); doc.setFontSize(8); ink(INK)
    const lines = doc.splitTextToSize(body, CONTENT_W - 8) as string[]
    doc.text(lines, MARGIN + 4, y + 11)
    return y + boxH + 5
  }

  // ─────────────────────────────────────────────────────────────────
  // PÁGINA 1 — Portada / resumen ejecutivo
  // ─────────────────────────────────────────────────────────────────
  const headerH = 32
  fill(NAVY); doc.rect(0, 0, PAGE_W, headerH, 'F')
  ink(WHITE)
  display('bold'); doc.setFontSize(11)
  doc.text(clientName, MARGIN, 11)
  if (data.account.cif) {
    sans('normal'); doc.setFontSize(8)
    doc.text(`CIF ${data.account.cif}`, MARGIN, 16)
  }
  display('bold'); doc.setFontSize(19)
  doc.text('Formación del personal — listo para la inspección', MARGIN, 24.5)
  sans('normal'); doc.setFontSize(9)
  doc.text('Formación interna acreditada con firma electrónica identificada', MARGIN, 29.5)

  sans('normal'); doc.setFontSize(8.5)
  doc.text(`Generado ${data.generatedAtLabel}`, PAGE_W - MARGIN, 11, { align: 'right' })
  doc.text(`${totalEmployees} trabajador${totalEmployees === 1 ? '' : 'es'} · ${locationCount} local${locationCount === 1 ? '' : 'es'}`, PAGE_W - MARGIN, 16, { align: 'right' })
  if (data.responsibleName) {
    doc.text(`Responsable de formación: ${data.responsibleName}`, PAGE_W - MARGIN, 21, { align: 'right' })
  }

  fill(NAVY); doc.rect(MARGIN, headerH + 3, CONTENT_W * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(MARGIN + CONTENT_W * 0.4, headerH + 3, CONTENT_W * 0.12, 1.1, 'F')
  fill(LINE); doc.rect(MARGIN + CONTENT_W * 0.52, headerH + 3, CONTENT_W * 0.48, 1.1, 'F')

  let y = headerH + 14

  // El KPI grande, el que mira el inspector.
  const kpiColor = data.kpi.pct === 100 ? SUCCESS : data.kpi.pct >= 80 ? WARNING : DANGER
  display('bold'); doc.setFontSize(34); ink(kpiColor)
  doc.text(`${data.kpi.vigente} de ${data.kpi.applicable}`, MARGIN, y + 14)
  sans('normal'); doc.setFontSize(10); ink(MUTED)
  doc.text('trabajadores con la formación obligatoria vigente', MARGIN, y + 21)
  display('bold'); doc.setFontSize(22); ink(kpiColor)
  doc.text(`${data.kpi.pct}%`, PAGE_W - MARGIN - 30, y + 12, { align: 'right' })

  y += 30
  const barH = 5
  fill(DANGER_BG); doc.roundedRect(MARGIN, y, CONTENT_W, barH, 1, 1, 'F')
  if (data.kpi.pct > 0) {
    fill(SUCCESS)
    doc.roundedRect(MARGIN, y, Math.max(CONTENT_W * (data.kpi.pct / 100), barH), barH, 1, 1, 'F')
  }
  y += barH + 8

  y = textBlock(
    y,
    'Cómo se ha elaborado',
    'Cada trabajador se considera "vigente" en un curso SOLO si existe una firma electrónica capturada en su ' +
      'sesión autenticada sobre un intento de test aprobado. Un test aprobado sin firmar no cuenta como vigente. ' +
      'Si el curso exige verificación práctica en el puesto, tampoco cuenta como vigente hasta que un responsable ' +
      'la registre, aunque la teoría esté superada y firmada. ' +
      'Los huecos (nunca formado, caducado, pendiente de firma, pendiente de práctica) se listan explícitamente más adelante — no se ocultan.',
    18,
  )

  if (data.gaps.length > 0) {
    sans('bold'); doc.setFontSize(9); ink(DANGER)
    doc.text(
      `${data.gaps.length} hueco${data.gaps.length === 1 ? '' : 's'} detectado${data.gaps.length === 1 ? '' : 's'} — ver "Huecos declarados" al final de este informe.`,
      MARGIN, y,
    )
    y += 7
  } else {
    sans('normal'); doc.setFontSize(9); ink(SUCCESS)
    doc.text('Sin huecos detectados sobre las formaciones obligatorias evaluadas.', MARGIN, y)
    y += 7
  }

  // ─────────────────────────────────────────────────────────────────
  // PÁGINAS 2..N — Matriz por local
  // ─────────────────────────────────────────────────────────────────
  const courseCols = data.courses
  const colW = courseCols.length > 0 ? (CONTENT_W - NAME_COL_W) / courseCols.length : 0

  function drawLegend(yy: number) {
    stroke(LINE); doc.setLineWidth(0.2); doc.line(MARGIN, yy - 3, PAGE_W - MARGIN, yy - 3)
    sans('bold'); doc.setFontSize(6.5); ink(MUTED)
    doc.text('LEYENDA', MARGIN, yy)
    let x = MARGIN + 16
    const items: { letter: string; color: [number, number, number]; label: string }[] = [
      { letter: 'V', color: SUCCESS, label: 'Vigente' },
      { letter: 'C', color: DANGER, label: 'Caducado' },
      { letter: 'P', color: WARNING, label: 'Pendiente' },
      { letter: 'E', color: WARNING, label: 'En curso (sin firmar)' },
      { letter: 'X', color: WARNING, label: 'Falta verificación práctica' },
      { letter: '·', color: MUTED, label: 'No aplica' },
    ]
    for (const it of items) {
      sans('bold'); doc.setFontSize(7); ink(it.color)
      doc.text(it.letter, x, yy)
      sans('normal'); doc.setFontSize(6.5); ink(INK)
      doc.text(it.label, x + 3.5, yy)
      x += 3.5 + doc.getTextWidth(it.label) + 7
    }
  }

  function drawMatrixHeader(startY: number, locationName: string, count: number): number {
    let yy = startY
    display('bold'); doc.setFontSize(13); ink(INK)
    doc.text(locationName, MARGIN, yy)
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(`${count} trabajador${count === 1 ? '' : 'es'}`, MARGIN + doc.getTextWidth(locationName) + 4, yy)
    yy += 5

    fill(NAVY); doc.rect(MARGIN, yy, CONTENT_W, TABLE_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text('TRABAJADOR', MARGIN + 2, yy + TABLE_HEADER_H - 2.3)
    doc.setFontSize(6.3)
    courseCols.forEach((c, i) => {
      const cx = MARGIN + NAME_COL_W + i * colW
      const label = c.title.length > 14 ? c.title.slice(0, 13) + '…' : c.title
      doc.text(label, cx + colW / 2, yy + TABLE_HEADER_H - 2.3, { align: 'center', maxWidth: colW - 2 })
    })
    return yy + TABLE_HEADER_H
  }

  if (data.rowsByLocation.length > 0) doc.addPage()
  data.rowsByLocation.forEach(([locationName, rows], locIdx) => {
    if (locIdx > 0) doc.addPage()
    drawSlimHeader()
    let ty = drawMatrixHeader(SLIM_HEADER_H + 10, locationName, rows.length)

    rows.forEach((row) => {
      if (ty + ROW_H > FOOTER_LEGEND_Y - 6) {
        doc.addPage()
        drawSlimHeader()
        ty = drawMatrixHeader(SLIM_HEADER_H + 10, `${locationName} (continuación)`, rows.length)
      }
      sans('normal'); doc.setFontSize(7.5); ink(INK)
      const label = `${row.employeeName}${row.role ? ' · ' + row.role : ''}`
      doc.text(label.length > 46 ? label.slice(0, 45) + '…' : label, MARGIN + 2, ty + ROW_H - 1.7, { maxWidth: NAME_COL_W - 4 })

      courseCols.forEach((c, i) => {
        const cx = MARGIN + NAME_COL_W + i * colW
        const cell = row.courses[c.code]
        const state = cell?.state ?? 'no_aplica'
        fill(STATE_BG[state]); doc.rect(cx, ty, colW, ROW_H, 'F')
        ink(STATE_COLOR[state]); sans('bold'); doc.setFontSize(7.5)
        doc.text(STATE_LETTER[state], cx + colW / 2, ty + ROW_H - 1.7, { align: 'center' })
        stroke(LINE); doc.setLineWidth(0.15); doc.line(cx, ty, cx, ty + ROW_H)
      })
      stroke(LINE); doc.line(MARGIN, ty + ROW_H, PAGE_W - MARGIN, ty + ROW_H)
      ty += ROW_H
    })

    drawLegend(FOOTER_LEGEND_Y)
  })

  // ─────────────────────────────────────────────────────────────────
  // Ficha por curso
  // ─────────────────────────────────────────────────────────────────
  doc.addPage()
  drawSlimHeader()
  let fy = SLIM_HEADER_H + 12
  display('bold'); doc.setFontSize(15); ink(INK)
  doc.text('Ficha de cada curso', MARGIN, fy)
  fy += 9

  for (const c of data.courses) {
    if (fy + 30 > PAGE_H - MARGIN) { doc.addPage(); drawSlimHeader(); fy = SLIM_HEADER_H + 10 }
    fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
    const boxH = 12 + c.sectionTitles.length * 4.5
    doc.roundedRect(MARGIN, fy, CONTENT_W, boxH, 2, 2, 'FD')
    sans('bold'); doc.setFontSize(10); ink(NAVY)
    doc.text(c.title, MARGIN + 4, fy + 6)
    sans('normal'); doc.setFontSize(7.5); ink(MUTED)
    doc.text(
      `${c.legalBasis ?? 'Sin base legal declarada'} · ${c.assignedCount} asignado${c.assignedCount === 1 ? '' : 's'}` +
        (c.estimatedMinutes ? ` · ${c.estimatedMinutes} min` : ''),
      MARGIN + 4, fy + 10.5,
    )
    let cy = fy + 15
    sans('bold'); doc.setFontSize(7); ink(INK)
    doc.text('CONTENIDOS IMPARTIDOS:', MARGIN + 4, cy)
    sans('normal'); doc.setFontSize(7.5); ink(INK)
    c.sectionTitles.forEach((title) => {
      cy += 4.5
      doc.text(`•  ${title}`, MARGIN + 6, cy)
    })
    fy += boxH + 5
  }

  // ─────────────────────────────────────────────────────────────────
  // 🔴 ANEXO DE FIRMAS — el corazón legal
  // ─────────────────────────────────────────────────────────────────
  doc.addPage()
  drawSlimHeader()
  let sy = SLIM_HEADER_H + 12
  display('bold'); doc.setFontSize(15); ink(INK)
  doc.text('Anexo de firmas', MARGIN, sy)
  sy += 6
  sans('normal'); doc.setFontSize(8); ink(MUTED)
  doc.text('Sustituye al Documento 4 en papel del dosier: evidencia de quién se formó, cuándo y con qué nota.', MARGIN, sy)
  sy += 8

  if (data.attendeeSignatures.length === 0) {
    sans('normal'); doc.setFontSize(9); ink(WARNING)
    doc.text('Ningún trabajador tiene todavía una firma registrada.', MARGIN, sy)
  } else {
    const colHalf = CONTENT_W / 2 - 4
    let sx = MARGIN
    for (const s of data.attendeeSignatures) {
      if (sy + 30 > PAGE_H - MARGIN) {
        doc.addPage(); drawSlimHeader(); sy = SLIM_HEADER_H + 10; sx = MARGIN
      }
      stroke(LINE); doc.setLineWidth(0.2)
      doc.roundedRect(sx, sy, colHalf, 26, 2, 2, 'D')
      sans('bold'); doc.setFontSize(8.5); ink(INK)
      doc.text(s.employeeName, sx + 3, sy + 6, { maxWidth: colHalf - 6 })
      sans('normal'); doc.setFontSize(7); ink(MUTED)
      doc.text(`DNI/NIE ${s.employeeDni ?? '—'}${s.role ? ' · ' + s.role : ''}`, sx + 3, sy + 10.5)
      doc.text(`${s.courseTitle} · nota ${s.scorePct != null ? s.scorePct + '%' : '—'}`, sx + 3, sy + 14.5, { maxWidth: colHalf - 6 })
      doc.text(s.signedAtLabel ?? '—', sx + 3, sy + 18.5)
      if (s.signatureDataUrl) {
        try { doc.addImage(s.signatureDataUrl, 'PNG', sx + colHalf - 32, sy + 6, 30, 14) } catch { /* firma ilegible, se omite sin romper el PDF */ }
      }
      if (sx === MARGIN) {
        sx = MARGIN + colHalf + 8
      } else {
        sx = MARGIN
        sy += 30
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Certificados externos
  // ─────────────────────────────────────────────────────────────────
  doc.addPage()
  drawSlimHeader()
  let ey = SLIM_HEADER_H + 12
  display('bold'); doc.setFontSize(15); ink(INK)
  doc.text('Certificados externos', MARGIN, ey)
  ey += 6
  sans('normal'); doc.setFontSize(8); ink(MUTED)
  doc.text('Archivados por Folvy pero impartidos y emitidos por un tercero (incluido PRL, que Folvy vigila pero no imparte).', MARGIN, ey)
  ey += 8

  if (data.externalCerts.length === 0) {
    sans('normal'); doc.setFontSize(9); ink(MUTED)
    doc.text('Ningún certificado externo archivado.', MARGIN, ey)
  } else {
    fill(NAVY); doc.rect(MARGIN, ey, CONTENT_W, TABLE_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text('TRABAJADOR', MARGIN + 2, ey + TABLE_HEADER_H - 2.3)
    doc.text('CERTIFICADO', MARGIN + 90, ey + TABLE_HEADER_H - 2.3)
    doc.text('CADUCIDAD', MARGIN + 180, ey + TABLE_HEADER_H - 2.3)
    doc.text('ESTADO', MARGIN + 230, ey + TABLE_HEADER_H - 2.3)
    ey += TABLE_HEADER_H
    let zebra = false
    for (const cert of data.externalCerts) {
      if (ey + ROW_H > PAGE_H - MARGIN) { doc.addPage(); drawSlimHeader(); ey = SLIM_HEADER_H + 10 }
      if (zebra) { fill(LIGHT); doc.rect(MARGIN, ey, CONTENT_W, ROW_H, 'F') }
      zebra = !zebra
      sans('normal'); doc.setFontSize(7.5); ink(INK)
      doc.text(cert.employeeName, MARGIN + 2, ey + ROW_H - 1.6, { maxWidth: 86 })
      doc.text(cert.name, MARGIN + 90, ey + ROW_H - 1.6, { maxWidth: 88 })
      doc.text(cert.expiryLabel ?? 'Sin caducidad', MARGIN + 180, ey + ROW_H - 1.6)
      const statusRgb = cert.statusColor === 'green' ? SUCCESS : cert.statusColor === 'red' ? DANGER
        : cert.statusColor === 'orange' || cert.statusColor === 'yellow' ? WARNING : MUTED
      ink(statusRgb)
      doc.text(cert.statusLabel, MARGIN + 230, ey + ROW_H - 1.6)
      ey += ROW_H
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Huecos declarados (rojo, sin esconder)
  // ─────────────────────────────────────────────────────────────────
  doc.addPage()
  drawSlimHeader()
  let gy = SLIM_HEADER_H + 12
  display('bold'); doc.setFontSize(15); ink(DANGER)
  doc.text('Huecos declarados', MARGIN, gy)
  gy += 8

  if (data.gaps.length === 0) {
    sans('normal'); doc.setFontSize(9); ink(SUCCESS)
    doc.text('Ningún hueco pendiente sobre las formaciones obligatorias evaluadas.', MARGIN, gy)
  } else {
    fill(DANGER); doc.rect(MARGIN, gy, CONTENT_W, TABLE_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text('TRABAJADOR', MARGIN + 2, gy + TABLE_HEADER_H - 2.3)
    doc.text('CURSO', MARGIN + 90, gy + TABLE_HEADER_H - 2.3)
    doc.text('QUÉ FALTA', MARGIN + 180, gy + TABLE_HEADER_H - 2.3)
    gy += TABLE_HEADER_H
    let zebra = false
    for (const gap of data.gaps) {
      if (gy + ROW_H > PAGE_H - MARGIN - 20) { doc.addPage(); drawSlimHeader(); gy = SLIM_HEADER_H + 10 }
      if (zebra) { fill(DANGER_BG); doc.rect(MARGIN, gy, CONTENT_W, ROW_H, 'F') }
      zebra = !zebra
      sans('normal'); doc.setFontSize(7.5); ink(INK)
      doc.text(gap.employeeName, MARGIN + 2, gy + ROW_H - 1.6, { maxWidth: 86 })
      doc.text(gap.courseTitle, MARGIN + 90, gy + ROW_H - 1.6, { maxWidth: 88 })
      ink(DANGER)
      doc.text(gap.detail, MARGIN + 180, gy + ROW_H - 1.6, { maxWidth: CONTENT_W - 180 })
      gy += ROW_H
    }
  }

  gy += 8
  if (gy + 20 < PAGE_H - MARGIN) {
    fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, gy, CONTENT_W, 16, 2, 2, 'FD')
    sans('bold'); doc.setFontSize(7); ink(NAVY)
    doc.text('VALIDEZ DE LA FIRMA', MARGIN + 4, gy + 6)
    sans('normal'); doc.setFontSize(7); ink(INK)
    doc.text(
      'Firma manuscrita electrónica (no cualificada), capturada en sesión autenticada del trabajador con sello ' +
        'de tiempo automático. No equivale a una firma electrónica cualificada eIDAS.',
      MARGIN + 4, gy + 11, { maxWidth: CONTENT_W - 8 },
    )
  }

  // ── Fecha + numeración en la cabecera fina (2..N) ──
  const pages = doc.getNumberOfPages()
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p)
    sans('normal'); doc.setFontSize(7.5); ink(WHITE)
    doc.text(`Generado ${data.generatedAtLabel} · Página ${p} de ${pages}`, PAGE_W - MARGIN, 7.5, { align: 'right' })
  }

  const filename = `formacion_inspeccion_${data.generatedAtFilename}.pdf`
  return { blob: doc.output('blob'), filename }
}
