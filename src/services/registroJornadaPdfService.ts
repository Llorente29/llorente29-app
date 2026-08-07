// src/services/registroJornadaPdfService.ts
// F5.1 — PDF de registro de jornada, por empleado y mes (RD-ley 8/2019,
// art. 34.9 ET). Mismo motor que los demás PDF de marca (jsPDF + ensureFraunces,
// tablas dibujadas a mano) — ver purchaseOrderPdf.ts / trainingCompliancePdfService.ts.
//
// Reglas del encargo que gobiernan este render:
// - TODOS los días del periodo constan, incluidos los no trabajados (no se
//   ocultan) — cada fila del array `days` se pinta, sin filtrar.
// - Una jornada partida llega como dos filas del mismo `dia`: se pintan
//   ambas, nunca se colapsan (agrupación visual por color de franja + la
//   fecha del segundo tramo se atenúa para indicar continuación).
// - Las horas de los totales son las REALES que da la RPC (2 decimales),
//   nunca redondeadas a una cuadrícula — el redondeo no es oponible en
//   una inspección de trabajo.

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import type { RegistroJornadaDia, RegistroJornadaTotales } from './registroJornadaService'

const NAVY: [number, number, number] = [30, 58, 95]
const TERRA: [number, number, number] = [214, 116, 66]
const INK: [number, number, number] = [31, 36, 33]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [227, 230, 226]
const LIGHT: [number, number, number] = [245, 244, 240]
const WHITE: [number, number, number] = [255, 255, 255]
const ZEBRA: [number, number, number] = [250, 251, 250]

const FOLVY_URL = 'https://folvy.app'
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16
const CONTENT_W = PAGE_W - 2 * MARGIN
const ROW_H = 6.4
const SLIM_HEADER_H = 11

const VACATION_LABEL: Record<string, string> = {
  vacaciones: 'Vacaciones',
  asuntos_propios: 'Asuntos propios',
  baja_medica: 'Baja médica',
  permiso_matrimonio: 'Permiso matrimonio',
  permiso_fallecimiento: 'Permiso fallecimiento',
  permiso_mudanza: 'Permiso mudanza',
  otro: 'Otro permiso',
}

const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function fechaLabel(diaISO: string): string {
  const d = new Date(`${diaISO}T00:00:00`)
  const wd = WD[d.getDay()]
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${wd} ${dd}/${mm}`
}

function horaLabel(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function fmtMinutos(mins: number): string {
  const total = Math.round(mins)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function fmtHoras(n: number): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`
}

// Rango combining diacritical marks (U+0300–U+036F), construido por código de
// carácter a propósito: evita depender de cómo se represente literalmente un
// carácter combinante dentro del código fuente.
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g')

function slug(s: string): string {
  return s
    .normalize('NFD').replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface RegistroJornadaPdfData {
  account: { legalName: string | null; cif: string | null }
  employee: { name: string; dni: string | null }
  periodLabel: string
  periodFrom: string
  periodTo: string
  days: RegistroJornadaDia[]
  totals: RegistroJornadaTotales
}

export function generateRegistroJornadaPdf(data: RegistroJornadaPdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
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

  function drawSlimHeader() {
    fill(NAVY); doc.rect(0, 0, PAGE_W, SLIM_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text(`${data.employee.name} — Registro de jornada`, MARGIN, 7.2)
    sans('normal'); doc.setFontSize(7.5)
    doc.text(data.periodLabel, PAGE_W - MARGIN, 7.2, { align: 'right' })
  }

  // ── Cabecera de portada ──
  let y = MARGIN
  sans('bold'); doc.setFontSize(9); ink(INK)
  doc.text(clientName, MARGIN, y)
  if (data.account.cif) {
    sans('normal'); doc.setFontSize(8); ink(MUTED)
    doc.text(`CIF ${data.account.cif}`, PAGE_W - MARGIN, y, { align: 'right' })
  }
  y += 6

  fill(NAVY); doc.rect(MARGIN, y, CONTENT_W * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(MARGIN + CONTENT_W * 0.4, y, CONTENT_W * 0.12, 1.1, 'F')
  fill(LINE); doc.rect(MARGIN + CONTENT_W * 0.52, y, CONTENT_W * 0.48, 1.1, 'F')
  y += 9

  display('bold'); doc.setFontSize(20); ink(INK)
  doc.text('Registro de jornada', MARGIN, y)
  sans('normal'); doc.setFontSize(10); ink(TERRA)
  doc.text(data.periodLabel, PAGE_W - MARGIN, y, { align: 'right' })
  y += 9

  // Tarjeta trabajador
  fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
  doc.roundedRect(MARGIN, y, CONTENT_W, 16, 2, 2, 'FD')
  sans('bold'); doc.setFontSize(7); ink(MUTED)
  doc.text('TRABAJADOR', MARGIN + 4, y + 5)
  display('bold'); doc.setFontSize(12); ink(INK)
  doc.text(data.employee.name, MARGIN + 4, y + 11.5)
  sans('normal'); doc.setFontSize(8.5); ink(MUTED)
  doc.text(`DNI/NIE ${data.employee.dni ?? '—'}`, PAGE_W - MARGIN - 4, y + 11.5, { align: 'right' })
  y += 20

  sans('normal'); doc.setFontSize(7.5); ink(MUTED)
  doc.text(
    'Registro diario de jornada del art. 34.9 del Estatuto de los Trabajadores (RD-ley 8/2019). ' +
      'Horas reales, sin redondeo. Se conserva a disposición de la Inspección de Trabajo y Seguridad Social durante 4 años.',
    MARGIN, y, { maxWidth: CONTENT_W },
  )
  y += 8

  // ── Tabla diaria ──
  const cols = {
    fecha: MARGIN + 2,
    entrada: MARGIN + 32,
    salida: MARGIN + 62,
    descanso: MARGIN + 92,
    total: PAGE_W - MARGIN - 2,
  }
  function drawTableHeader(yy: number): number {
    fill(NAVY); doc.rect(MARGIN, yy, CONTENT_W, 7, 'F')
    sans('bold'); doc.setFontSize(7.5); ink(WHITE)
    doc.text('FECHA', cols.fecha, yy + 4.7)
    doc.text('ENTRADA', cols.entrada, yy + 4.7)
    doc.text('SALIDA', cols.salida, yy + 4.7)
    doc.text('DESCANSO', cols.descanso, yy + 4.7)
    doc.text('TOTAL DÍA', cols.total, yy + 4.7, { align: 'right' })
    return yy + 7
  }
  y = drawTableHeader(y)

  let zebra = false
  let prevDia: string | null = null
  for (const row of data.days) {
    if (y + ROW_H > PAGE_H - MARGIN - 6) {
      doc.addPage(); drawSlimHeader()
      y = drawTableHeader(SLIM_HEADER_H + 6)
      zebra = false
    }
    const sameDay = row.dia === prevDia
    if (!sameDay) zebra = !zebra
    if (zebra) { fill(ZEBRA); doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F') }

    const worked = row.minutosTrabajados > 0

    sans(sameDay ? 'normal' : 'bold'); doc.setFontSize(8.5)
    ink(sameDay ? MUTED : INK)
    doc.text(sameDay ? `${fechaLabel(row.dia)} (2º tramo)` : fechaLabel(row.dia), cols.fecha, y + 4.3)

    sans('normal'); doc.setFontSize(8.5); ink(INK)
    doc.text(horaLabel(row.entrada), cols.entrada, y + 4.3)
    doc.text(horaLabel(row.salida), cols.salida, y + 4.3)
    doc.text(row.minutosPausa > 0 ? fmtMinutos(row.minutosPausa) : '—', cols.descanso, y + 4.3)

    if (worked) {
      sans('bold'); ink(INK)
      let totalText = fmtMinutos(row.minutosTrabajados)
      if (row.esFestivo) totalText += ' · festivo'
      doc.text(totalText, cols.total, y + 4.3, { align: 'right' })
    } else {
      sans('normal'); ink(MUTED)
      const label = row.ausenciaTipo
        ? (VACATION_LABEL[row.ausenciaTipo] ?? row.ausenciaTipo)
        : row.esFestivo
          ? `Festivo${row.festivoNombre ? ' — ' + row.festivoNombre : ''}`
          : '—'
      doc.text(label, cols.total, y + 4.3, { align: 'right', maxWidth: cols.total - cols.descanso - 4 })
    }

    stroke(LINE); doc.setLineWidth(0.15); doc.line(MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H)
    y += ROW_H
    prevDia = row.dia
  }
  y += 6

  // ── Totales del periodo ──
  const totalsH = 40
  if (y + totalsH > PAGE_H - MARGIN - 30) { doc.addPage(); drawSlimHeader(); y = SLIM_HEADER_H + 8 }

  fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
  doc.roundedRect(MARGIN, y, CONTENT_W, totalsH, 2, 2, 'FD')
  sans('bold'); doc.setFontSize(8); ink(NAVY)
  doc.text('TOTALES DEL PERIODO', MARGIN + 4, y + 6)

  const t = data.totals
  const pairs: [string, string][] = [
    ['Días trabajados', String(t.diasTrabajados)],
    ['Tramos', String(t.tramos)],
    ['Horas trabajadas', fmtHoras(t.horasTrabajadas)],
    ['Horas de pausa', fmtHoras(t.horasPausa)],
    ['Horas nocturnas', fmtHoras(t.horasNocturnas)],
    ['Días de vacaciones', String(t.diasVacaciones)],
    ['Días de baja', String(t.diasBaja)],
    ['Días festivo trabajado', String(t.diasFestivoTrabajado)],
    ['Horas contratadas', fmtHoras(t.horasContratadas)],
    ['Balance (delta)', `${t.deltaHoras > 0 ? '+' : ''}${fmtHoras(t.deltaHoras)}`],
  ]
  const colW = CONTENT_W / 2
  pairs.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const px = MARGIN + 4 + col * colW
    const py = y + 13 + row * 5.6
    sans('normal'); doc.setFontSize(7.5); ink(MUTED)
    doc.text(label, px, py)
    sans('bold'); doc.setFontSize(8.5); ink(INK)
    doc.text(value, px + colW - 8, py, { align: 'right' })
  })
  y += totalsH + 8

  // ── Firma ──
  const sigH = 22
  if (y + sigH > PAGE_H - MARGIN - 4) { doc.addPage(); drawSlimHeader(); y = SLIM_HEADER_H + 8 }
  const sigColW = (CONTENT_W - 6) / 2
  function drawSignatureBox(x: number, title: string, subtitle: string) {
    stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(x, y, sigColW, sigH, 2, 2, 'D')
    sans('bold'); doc.setFontSize(7.5); ink(MUTED)
    doc.text(title, x + 3, y + 5)
    sans('normal'); doc.setFontSize(7.5); ink(INK)
    doc.text(subtitle, x + 3, y + 9, { maxWidth: sigColW - 6 })
    stroke(LINE); doc.line(x + 3, y + sigH - 5, x + sigColW - 3, y + sigH - 5)
    sans('normal'); doc.setFontSize(6.5); ink(MUTED)
    doc.text('Fecha:', x + 3, y + sigH - 1.5)
  }
  drawSignatureBox(MARGIN, 'FIRMA DEL TRABAJADOR', `${data.employee.name} — DNI/NIE ${data.employee.dni ?? '—'}`)
  drawSignatureBox(MARGIN + sigColW + 6, 'FIRMA DE LA EMPRESA', clientName)

  // ── Pie + numeración ──
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = PAGE_H - 8
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

  const filename = `registro-jornada_${slug(data.employee.name)}_${data.periodFrom}_a_${data.periodTo}.pdf`
  return { blob: doc.output('blob'), filename }
}
