// src/services/courseCertificatePdfService.ts
// Formación C1 — Acta PDF (jsPDF + ensureFraunces, mismo motor que
// allergenCompliancePdfService.ts — no se monta otro).
//
// Dos documentos:
//   - Diploma individual: se genera en el móvil justo tras firmar.
//   - Acta de sesión: portada + contenidos impartidos + tabla de asistentes
//     con nota + anexo de firmas. Se genera desde oficina (Seguimiento).
//
// Ninguno de los dos persiste nada por sí solo: issueDiplomaCertificate() es
// quien sube el PDF y escribe la fila course_certificate (evidencia).

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import { supabase } from '../lib/supabase'

const NAVY: [number, number, number] = [30, 58, 95]
const TERRA: [number, number, number] = [214, 116, 66]
const INK: [number, number, number] = [31, 36, 33]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [227, 230, 226]
const LIGHT: [number, number, number] = [245, 244, 240]
const WHITE: [number, number, number] = [255, 255, 255]
const SUCCESS: [number, number, number] = [31, 157, 107]
const DANGER: [number, number, number] = [224, 73, 46]

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

// ─────────────────────────────────────────────────────────────────
// DIPLOMA individual
// ─────────────────────────────────────────────────────────────────

export interface DiplomaData {
  accountLegalName: string
  courseTitle: string
  courseLegalBasis: string | null
  courseVersion: number
  employeeName: string
  employeeDni: string
  scorePct: number
  signedAtLabel: string
  /** dataURL (image/png;base64) de la firma manuscrita. */
  signatureDataUrl: string
  serial: string
}

export function generateDiplomaPdf(data: DiplomaData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { display, sans, fill, stroke, ink } = setupDoc(doc)
  const PAGE_W = 210
  const MARGIN = 20
  const CONTENT_W = PAGE_W - 2 * MARGIN

  fill(NAVY); doc.rect(0, 0, PAGE_W, 38, 'F')
  ink(WHITE); display('bold'); doc.setFontSize(10)
  doc.text(data.accountLegalName, MARGIN, 15)
  sans('normal'); doc.setFontSize(8)
  doc.text('Diploma de formación interna', MARGIN, 21)
  fill(NAVY); doc.rect(MARGIN, 41, CONTENT_W * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(MARGIN + CONTENT_W * 0.4, 41, CONTENT_W * 0.12, 1.1, 'F')

  let y = 60
  ink(MUTED); sans('normal'); doc.setFontSize(9)
  doc.text('Se certifica que', PAGE_W / 2, y, { align: 'center' })
  y += 12
  ink(INK); display('bold'); doc.setFontSize(20)
  doc.text(data.employeeName, PAGE_W / 2, y, { align: 'center' })
  y += 7
  sans('normal'); doc.setFontSize(9); ink(MUTED)
  doc.text(`DNI/NIE ${data.employeeDni}`, PAGE_W / 2, y, { align: 'center' })
  y += 14
  ink(INK); sans('normal'); doc.setFontSize(10.5)
  doc.text('ha superado la formación', PAGE_W / 2, y, { align: 'center' })
  y += 9
  display('bold'); doc.setFontSize(15); ink(NAVY)
  doc.text(data.courseTitle, PAGE_W / 2, y, { align: 'center', maxWidth: CONTENT_W })
  y += 10
  if (data.courseLegalBasis) {
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(data.courseLegalBasis, PAGE_W / 2, y, { align: 'center' })
    y += 8
  }

  y += 4
  const statW = CONTENT_W / 2
  display('bold'); doc.setFontSize(18); ink(SUCCESS)
  doc.text(`${data.scorePct}%`, MARGIN + statW * 0.5, y, { align: 'center' })
  sans('normal'); doc.setFontSize(8); ink(MUTED)
  doc.text('Nota obtenida', MARGIN + statW * 0.5, y + 5, { align: 'center' })
  display('bold'); doc.setFontSize(11); ink(INK)
  doc.text(data.signedAtLabel, MARGIN + statW * 1.5, y, { align: 'center' })
  sans('normal'); doc.setFontSize(8); ink(MUTED)
  doc.text('Fecha y hora de la firma', MARGIN + statW * 1.5, y + 5, { align: 'center' })

  y += 20
  stroke(LINE); doc.setLineWidth(0.2); doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 12

  sans('normal'); doc.setFontSize(8); ink(MUTED)
  doc.text('Firma del asistente', MARGIN, y)
  try {
    doc.addImage(data.signatureDataUrl, 'PNG', MARGIN, y + 3, 55, 22)
  } catch {
    // Firma ilegible/corrupta: no bloquea la emisión del diploma, se deja el hueco.
  }
  y += 30

  fill(LIGHT); stroke(LINE); doc.roundedRect(MARGIN, y, CONTENT_W, 14, 2, 2, 'FD')
  sans('normal'); doc.setFontSize(7.5); ink(MUTED)
  doc.text(
    'Firma manuscrita electrónica (no cualificada) recogida en sesión autenticada del trabajador. ' +
    `Versión del curso firmada: v${data.courseVersion}. Serial: ${data.serial}.`,
    MARGIN + 3, y + 6, { maxWidth: CONTENT_W - 6 },
  )

  return { blob: doc.output('blob'), filename: `diploma_${data.serial}.pdf` }
}

// ─────────────────────────────────────────────────────────────────
// ACTA de sesión (oficina — inspección)
// ─────────────────────────────────────────────────────────────────

export interface ActaAttendee {
  employeeName: string
  employeeDni: string
  scorePct: number | null
  signedAtLabel: string | null
  signatureDataUrl: string | null
}
export interface ActaData {
  accountLegalName: string
  accountCif: string | null
  courseTitle: string
  courseLegalBasis: string | null
  generatedAtLabel: string
  sections: { title: string }[]
  attendees: ActaAttendee[]
}

export function generateSessionActaPdf(data: ActaData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { display, sans, fill, stroke, ink } = setupDoc(doc)
  const PAGE_W = 210
  const PAGE_H = 297
  const MARGIN = 16
  const CONTENT_W = PAGE_W - 2 * MARGIN

  // Portada
  fill(NAVY); doc.rect(0, 0, PAGE_W, 34, 'F')
  ink(WHITE); display('bold'); doc.setFontSize(11)
  doc.text(data.accountLegalName, MARGIN, 12)
  if (data.accountCif) { sans('normal'); doc.setFontSize(8); doc.text(`CIF ${data.accountCif}`, MARGIN, 17) }
  display('bold'); doc.setFontSize(17)
  doc.text('Acta de formación', MARGIN, 25)
  sans('normal'); doc.setFontSize(8)
  doc.text(`Generado ${data.generatedAtLabel}`, PAGE_W - MARGIN, 12, { align: 'right' })

  let y = 44
  ink(INK); display('bold'); doc.setFontSize(14)
  doc.text(data.courseTitle, MARGIN, y, { maxWidth: CONTENT_W })
  y += 7
  if (data.courseLegalBasis) {
    sans('normal'); doc.setFontSize(9); ink(MUTED)
    doc.text(data.courseLegalBasis, MARGIN, y)
    y += 8
  }

  sans('bold'); doc.setFontSize(9.5); ink(NAVY)
  doc.text('CONTENIDOS IMPARTIDOS', MARGIN, y)
  y += 6
  sans('normal'); doc.setFontSize(9); ink(INK)
  for (const s of data.sections) {
    doc.text(`•  ${s.title}`, MARGIN + 2, y)
    y += 5.5
  }
  y += 4

  sans('bold'); doc.setFontSize(9.5); ink(NAVY)
  doc.text('ASISTENTES Y RESULTADO', MARGIN, y)
  y += 3
  const headerH = 7
  fill(NAVY); doc.rect(MARGIN, y, CONTENT_W, headerH, 'F')
  ink(WHITE); sans('bold'); doc.setFontSize(8)
  doc.text('NOMBRE', MARGIN + 2, y + headerH - 2)
  doc.text('DNI/NIE', MARGIN + 80, y + headerH - 2)
  doc.text('NOTA', MARGIN + 115, y + headerH - 2)
  doc.text('FIRMADO', MARGIN + 135, y + headerH - 2)
  y += headerH

  const rowH = 6.5
  for (const a of data.attendees) {
    if (y + rowH > PAGE_H - MARGIN - 60) { doc.addPage(); y = MARGIN }
    stroke(LINE); doc.setLineWidth(0.15); doc.line(MARGIN, y + rowH, PAGE_W - MARGIN, y + rowH)
    sans('normal'); doc.setFontSize(8); ink(INK)
    doc.text(a.employeeName, MARGIN + 2, y + rowH - 1.8, { maxWidth: 76 })
    doc.text(a.employeeDni || '—', MARGIN + 80, y + rowH - 1.8)
    ink(a.scorePct != null && a.scorePct >= 70 ? SUCCESS : DANGER)
    doc.text(a.scorePct != null ? `${a.scorePct}%` : '—', MARGIN + 115, y + rowH - 1.8)
    ink(a.signedAtLabel ? SUCCESS : MUTED)
    doc.text(a.signedAtLabel ?? 'Pendiente', MARGIN + 135, y + rowH - 1.8, { maxWidth: CONTENT_W - 135 })
    y += rowH
  }

  // Anexo de firmas
  doc.addPage()
  y = MARGIN
  display('bold'); doc.setFontSize(13); ink(INK)
  doc.text('Anexo de firmas', MARGIN, y)
  y += 8
  for (const a of data.attendees) {
    if (!a.signatureDataUrl) continue
    if (y + 34 > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN }
    sans('bold'); doc.setFontSize(9); ink(INK)
    doc.text(a.employeeName, MARGIN, y)
    sans('normal'); doc.setFontSize(8); ink(MUTED)
    doc.text(`DNI/NIE ${a.employeeDni || '—'} · ${a.signedAtLabel ?? ''}`, MARGIN, y + 4.5)
    try { doc.addImage(a.signatureDataUrl, 'PNG', MARGIN, y + 6, 50, 20) } catch { /* firma ilegible, se omite */ }
    y += 30
    stroke(LINE); doc.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2)
  }

  const filename = `acta_${data.courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`
  return { blob: doc.output('blob'), filename }
}

// ─────────────────────────────────────────────────────────────────
// Emisión de diploma: sube el PDF y escribe course_certificate (evidencia).
// ─────────────────────────────────────────────────────────────────

const CERTIFICATES_BUCKET = 'course-certificates'

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export interface IssueDiplomaParams {
  accountId: string
  employeeId: string
  attemptId: string
  courseCode: string
  pdfBlob: Blob
}

export async function issueDiplomaCertificate(params: IssueDiplomaParams): Promise<{ path: string; serial: string }> {
  if (!supabase) throw new Error('Supabase no disponible')
  const serial = `FORM-${params.courseCode.toUpperCase().slice(0, 12)}-${Date.now().toString(36).toUpperCase()}`
  const path = `${params.accountId}/${params.employeeId}/${params.attemptId}.pdf`

  const { error: upErr } = await supabase.storage
    .from(CERTIFICATES_BUCKET)
    .upload(path, params.pdfBlob, { contentType: 'application/pdf', upsert: true })
  if (upErr) { console.error('[courseCertificatePdfService] upload', upErr); throw upErr }

  const { error: dbErr } = await supabase
    .from('course_certificate')
    .insert({ attempt_id: params.attemptId, pdf_url: path, serial })
  if (dbErr) { console.error('[courseCertificatePdfService] insert course_certificate', dbErr); throw dbErr }

  return { path, serial }
}

export async function getCertificateSignedUrl(path: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(CERTIFICATES_BUCKET).createSignedUrl(path, 3600)
  if (error) { console.error('[courseCertificatePdfService] getCertificateSignedUrl', error); return null }
  return data?.signedUrl ?? null
}
