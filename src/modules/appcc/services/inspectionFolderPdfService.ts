// src/modules/appcc/services/inspectionFolderPdfService.ts
//
// Carpeta de inspección (T6) — PDF de una pieza con el ESTADO del archivo
// documental: portada + estado por familia + documentos en archivo + huecos.
// Mismo stack que allergenCompliancePdfService.ts (jsPDF + ensureFraunces +
// paleta de marca). No fusiona los PDFs reales de cada ficha (eso requiere
// pdf-lib; declarado como v2): los documentos siguen accesibles en el Archivo.

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import { sanitizeDishName } from '@/modules/appcc/services/allergenCompliancePdfService'
import type { DocFamily, DocStatus } from '@/modules/appcc/services/complianceDocumentService'

// Paleta (idéntica a allergenCompliancePdfService / purchaseOrderPdf)
const NAVY: [number, number, number] = [30, 58, 95]
const INK: [number, number, number] = [31, 36, 33]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [227, 230, 226]
const LIGHT: [number, number, number] = [245, 244, 240]
const WHITE: [number, number, number] = [255, 255, 255]
const DANGER: [number, number, number] = [224, 73, 46]
const WARNING: [number, number, number] = [194, 137, 15]
const SUCCESS: [number, number, number] = [31, 157, 107]

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16
const CONTENT_W = PAGE_W - 2 * MARGIN
const SLIM_HEADER_H = 12
const BOTTOM = PAGE_H - 14

const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  pending_ocr: 'Leyendo', pending_review: 'Por revisar', active: 'Vigente',
  superseded: 'Sustituido', expired: 'Caducado',
}
const DOC_STATUS_COLOR: Record<DocStatus, [number, number, number]> = {
  pending_ocr: WARNING, pending_review: WARNING, active: SUCCESS,
  superseded: MUTED, expired: DANGER,
}

export type CoverageStatus = 'missing' | 'expired' | 'expiring' | 'ok'
const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  ok: 'Vigente', expiring: 'Caduca pronto', expired: 'Caducado', missing: 'Sin documentos',
}
const COVERAGE_COLOR: Record<CoverageStatus, [number, number, number]> = {
  ok: SUCCESS, expiring: WARNING, expired: DANGER, missing: MUTED,
}

export interface InspectionFolderAccount { legalName: string | null; cif: string | null }
export interface InspectionFolderCoverage {
  familyLabel: string
  total: number
  status: CoverageStatus
  expired: number
  expiringSoon: number
}
export interface InspectionFolderDoc {
  family: DocFamily
  familyLabel: string
  title: string
  supplierName: string | null
  reference: string | null
  issuedAt: string | null
  expiresAt: string | null
  reviewDueAt: string | null
  status: DocStatus
}
export interface InspectionFolderData {
  account: InspectionFolderAccount
  generatedAtLabel: string
  generatedAtFilename: string
  coverage: InspectionFolderCoverage[]
  docs: InspectionFolderDoc[]
}

function fmt(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function generateInspectionFolderPdf(data: InspectionFolderData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  ensureFraunces(doc)
  const fontList = doc.getFontList() as Record<string, unknown>
  const hasFraunces = Object.prototype.hasOwnProperty.call(fontList, 'Fraunces')
  const display = (style: 'normal' | 'bold' = 'normal') => doc.setFont(hasFraunces ? 'Fraunces' : 'helvetica', style)
  const sans = (style: 'normal' | 'bold' = 'normal') => doc.setFont('helvetica', style)
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  const clientName = data.account.legalName ?? 'Cliente'
  const familiesCovered = data.coverage.filter((c) => c.total > 0).length

  function slimHeader() {
    fill(NAVY); doc.rect(0, 0, PAGE_W, SLIM_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8.5)
    doc.text(clientName, MARGIN, 7.5)
    sans('normal'); doc.setFontSize(7.5)
    doc.text('Carpeta de inspección', MARGIN + doc.getTextWidth(clientName) + 5, 7.5)
  }

  let y = 0
  function ensureSpace(needed: number) {
    if (y + needed > BOTTOM) {
      doc.addPage(); slimHeader(); y = SLIM_HEADER_H + 8
    }
  }
  function sectionTitle(t: string) {
    ensureSpace(12)
    display('bold'); doc.setFontSize(12); ink(NAVY)
    doc.text(t, MARGIN, y); y += 2
    stroke(LINE); doc.setLineWidth(0.3); doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 6
  }
  function chip(x: number, cy: number, label: string, color: [number, number, number]) {
    sans('bold'); doc.setFontSize(7.5); ink(color)
    doc.text(label, x, cy)
  }

  // ── Portada ──
  fill(NAVY); doc.rect(0, 0, PAGE_W, 52, 'F')
  ink(WHITE); sans('bold'); doc.setFontSize(12)
  doc.text(clientName, MARGIN, 16)
  if (data.account.cif) { sans('normal'); doc.setFontSize(9); doc.text(`CIF ${data.account.cif}`, MARGIN, 21.5) }
  display('bold'); doc.setFontSize(22)
  doc.text('Carpeta de inspección', MARGIN, 34)
  sans('normal'); doc.setFontSize(9.5)
  doc.text('Archivo documental de cumplimiento', MARGIN, 41)
  doc.setFontSize(8.5)
  doc.text(`Generado ${data.generatedAtLabel}`, MARGIN, 47)

  y = 62
  sans('normal'); doc.setFontSize(9); ink(INK)
  doc.text(
    `${data.docs.length} documento${data.docs.length === 1 ? '' : 's'} en archivo · ${familiesCovered} de 9 familias con documentación.`,
    MARGIN, y,
  )
  y += 10

  // ── Estado por familia ──
  sectionTitle('Estado por familia')
  for (const c of data.coverage) {
    ensureSpace(7)
    fill(LIGHT); doc.rect(MARGIN, y - 4, CONTENT_W, 6.5, 'F')
    sans('normal'); doc.setFontSize(9); ink(INK)
    doc.text(sanitizeDishName(c.familyLabel), MARGIN + 2, y)
    const countTxt = c.total === 0 ? '—' : `${c.total} doc.`
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(countTxt, PAGE_W - MARGIN - 46, y, { align: 'right' })
    let label = COVERAGE_LABEL[c.status]
    if (c.expired > 0) label += ` (${c.expired} caducado)`
    else if (c.expiringSoon > 0) label += ` (${c.expiringSoon} pronto)`
    chip(PAGE_W - MARGIN - 44, y, label, COVERAGE_COLOR[c.status])
    y += 7
  }
  y += 4

  // ── Documentos en archivo (por familia) ──
  sectionTitle('Documentos en archivo')
  const byFamily = new Map<string, InspectionFolderDoc[]>()
  for (const d of data.docs) {
    const arr = byFamily.get(d.familyLabel) ?? []
    arr.push(d); byFamily.set(d.familyLabel, arr)
  }
  if (byFamily.size === 0) {
    sans('normal'); doc.setFontSize(9); ink(MUTED)
    ensureSpace(7); doc.text('No hay documentos en el archivo.', MARGIN + 2, y); y += 7
  } else {
    for (const [famLabel, docs] of byFamily) {
      ensureSpace(9)
      sans('bold'); doc.setFontSize(9.5); ink(NAVY)
      doc.text(`${sanitizeDishName(famLabel)}  ·  ${docs.length}`, MARGIN, y); y += 5
      for (const d of docs) {
        ensureSpace(9)
        sans('bold'); doc.setFontSize(8.5); ink(INK)
        doc.text(sanitizeDishName(d.title), MARGIN + 2, y)
        chip(PAGE_W - MARGIN - 24, y, DOC_STATUS_LABEL[d.status], DOC_STATUS_COLOR[d.status])
        y += 4
        sans('normal'); doc.setFontSize(7.5); ink(MUTED)
        const parts: string[] = []
        if (d.supplierName) parts.push(d.supplierName)
        if (d.reference) parts.push(`Ref. ${d.reference}`)
        parts.push(`Emitido ${fmt(d.issuedAt)}`)
        if (d.expiresAt || d.reviewDueAt) parts.push(`Caduca/revisa ${fmt(d.expiresAt ?? d.reviewDueAt)}`)
        doc.text(parts.join('  ·  '), MARGIN + 2, y)
        y += 5.5
      }
      y += 2
    }
  }

  // ── Huecos declarados ──
  y += 2
  sectionTitle('Huecos declarados')
  const missing = data.coverage.filter((c) => c.status === 'missing')
  const expiredFams = data.coverage.filter((c) => c.expired > 0)
  if (missing.length === 0 && expiredFams.length === 0) {
    sans('normal'); doc.setFontSize(9); ink(SUCCESS)
    ensureSpace(7); doc.text('Sin huecos: todas las familias con documentación y ninguna caducada.', MARGIN + 2, y); y += 7
  } else {
    for (const c of missing) {
      ensureSpace(6)
      sans('normal'); doc.setFontSize(8.5); ink(MUTED)
      doc.text(`•  Falta documentación: ${sanitizeDishName(c.familyLabel)}`, MARGIN + 2, y); y += 5.5
    }
    for (const c of expiredFams) {
      ensureSpace(6)
      sans('normal'); doc.setFontSize(8.5); ink(DANGER)
      doc.text(`•  Documento caducado en: ${sanitizeDishName(c.familyLabel)} (${c.expired})`, MARGIN + 2, y); y += 5.5
    }
  }
  y += 6
  ensureSpace(10)
  sans('normal'); doc.setFontSize(7.5); ink(MUTED)
  doc.text(
    'La declaración de alérgenos por plato se aporta como documento aparte (Alérgenos → Exportar PDF).',
    MARGIN, y,
  )

  // ── Numeración en la cabecera fina de páginas 2..N ──
  const pages = doc.getNumberOfPages()
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p)
    sans('normal'); doc.setFontSize(7.5); ink(WHITE)
    doc.text(`Generado ${data.generatedAtLabel} · Página ${p} de ${pages}`, PAGE_W - MARGIN, 7.5, { align: 'right' })
  }

  const filename = `carpeta_inspeccion_${data.generatedAtFilename}.pdf`
  return { blob: doc.output('blob'), filename }
}
