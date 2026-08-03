// src/modules/appcc/services/allergenCompliancePdfService.ts
//
// Informe PDF de alérgenos — rediseño completo (ENCARGO CODE, 06/08). Tres
// escenarios de uso: enseñárselo a una inspectora sanitaria, colgarlo en
// cocina, enseñarlo comercialmente a un CEO de 150 ubicaciones. Mismo motor
// y paleta que purchaseOrderPdf.ts (jsPDF + ensureFraunces) — no se monta
// un motor nuevo.
//
// Estructura: portada/resumen ejecutivo → matriz agrupada POR MARCA (salto
// de página entre marcas, para que cocina pueda imprimir solo la suya) →
// página final de ingredientes bloqueantes + discrepancias.
//
// Regla que gobierna todo el fichero: ninguna celda puede leerse como
// "libre" sin dato que lo respalde. Un código AUSENTE del mapa de alérgenos
// de un plato es "sin declarar" — nunca se pinta como libre.

import jsPDF from 'jspdf'
import { ensureFraunces } from '@/modules/supply/services/folvyPdfFont'
import {
  ALLERGEN_CODES,
  allergenLabel,
  type AllergenState,
} from '@/modules/kitchen/lib/allergens'
import type {
  ComplianceMatrixRow,
  BlockingIngredient,
  AllergenDiscrepancy,
  DataHealthRow,
  AllergenSource,
} from '@/modules/kitchen/services/allergenComplianceService'

// ── Paleta de marca Folvy (idéntica a purchaseOrderPdf.ts) + estados
// (idéntica a src/index.css, --color-danger/-success/-warning + sus *-bg) ──
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

const STATE_COLOR: Record<AllergenState, [number, number, number]> = {
  contains: DANGER, may_contain: WARNING, free: SUCCESS, unknown: MUTED,
}
const STATE_BG: Record<AllergenState, [number, number, number]> = {
  contains: DANGER_BG, may_contain: WARNING_BG, free: SUCCESS_BG, unknown: UNKNOWN_BG,
}
// 'L' de Libre, no el check ✓: en jsPDF con fuentes estándar (helvetica) el
// check U+2713 no tiene glifo fiable y salía como apóstrofo — letra, no
// símbolo, es lo que nunca se rompe (regla de Julio tras verlo en un PDF real).
const STATE_LETTER: Record<AllergenState, string> = {
  contains: 'C', may_contain: 'T', free: 'L', unknown: '?',
}
const SOURCE_LABEL: Record<AllergenSource, string> = {
  manual: 'Ficha técnica del proveedor', inherited: 'Heredado del escandallo',
  automatic: 'Automático', ai_enrich: 'Estimación pendiente de confirmar',
}

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 14
const CONTENT_W = PAGE_W - 2 * MARGIN
const SLIM_HEADER_H = 12
const FOOTER_LEGEND_Y = PAGE_H - 8
const NAME_COL_W = 72
const COL_W = (CONTENT_W - NAME_COL_W) / ALLERGEN_CODES.length
const ROW_H = 5.8
const TABLE_HEADER_H = 7

// Quita emojis y marcas de variación/ZWJ antes de pintar cualquier nombre —
// no se intenta pintar el emoji (jsPDF/helvetica no tiene esos glifos, sale
// basura tipo "Ø<ß?"), se retira. \p{Extended_Pictographic} cubre el grueso
// de emoji Unicode (regex con flag u, soportado en navegadores actuales).
export function sanitizeDishName(name: string): string {
  const cleaned = name
    .replace(/\p{Extended_Pictographic}/gu, '')
    // Zero-width joiner (U+200D), selector de variacion emoji (U+FE0F) y
    // el bloque de formato invisible U+2060-U+206F -- restos que quedan
    // sueltos tras quitar el emoji si el nombre combinaba varios codepoints.
    // Escapes hex explicitos a proposito (no el caracter literal: un
    // invisible pegado tal cual en el fichero no es auditable a simple vista).
    .replace(/[\u200D\uFE0F\u2060-\u206F]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : '(sin nombre)'
}

function dishAllergenState(row: ComplianceMatrixRow, code: (typeof ALLERGEN_CODES)[number]) {
  return row.allergens[code]
}
function dishIsIncomplete(row: ComplianceMatrixRow): boolean {
  return ALLERGEN_CODES.some((code) => {
    const cell = dishAllergenState(row, code)
    return !cell || cell.state === 'unknown'
  })
}
function dishIsFullyFree(row: ComplianceMatrixRow): boolean {
  return ALLERGEN_CODES.every((code) => dishAllergenState(row, code)?.state === 'free')
}

function groupByBrand(rows: ComplianceMatrixRow[]): [string, ComplianceMatrixRow[]][] {
  const map = new Map<string, ComplianceMatrixRow[]>()
  for (const row of rows) {
    const brands = row.brands.length > 0 ? row.brands : ['Sin marca asignada']
    for (const b of brands) {
      const list = map.get(b) ?? []
      list.push(row)
      map.set(b, list)
    }
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}

function blockingReason(ing: BlockingIngredient): string {
  return ing.declaredCount === 0
    ? 'Pendiente de ficha técnica del proveedor'
    : 'Sin declarar (dato parcial)'
}

export interface AllergenPdfAccount {
  legalName: string | null
  cif: string | null
}
export interface AllergenPdfData {
  account: AllergenPdfAccount
  brandCount: number
  locationCount: number
  generatedAtLabel: string
  generatedAtFilename: string
  rows: ComplianceMatrixRow[]
  blocking: BlockingIngredient[]
  discrepancies: AllergenDiscrepancy[]
  health: DataHealthRow[]
}

export function generateAllergenCompliancePdf(data: AllergenPdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  ensureFraunces(doc)
  const fontList = doc.getFontList() as Record<string, unknown>
  const hasFraunces = Object.prototype.hasOwnProperty.call(fontList, 'Fraunces')
  const display = (style: 'normal' | 'bold' = 'normal') =>
    doc.setFont(hasFraunces ? 'Fraunces' : 'helvetica', style)
  const sans = (style: 'normal' | 'bold' = 'normal') => doc.setFont('helvetica', style)
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  const clientName = data.account.legalName ?? 'Cliente'
  const scopeLabel = `${data.brandCount} marca${data.brandCount === 1 ? '' : 's'} · ${data.locationCount} local${data.locationCount === 1 ? '' : 'es'}`

  // ── Cabecera fina, repetida en TODAS las páginas salvo la portada
  // (que lleva su propia cabecera grande) ──
  function drawSlimHeader() {
    fill(NAVY); doc.rect(0, 0, PAGE_W, SLIM_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8.5)
    doc.text(clientName, MARGIN, 7.5)
    sans('normal'); doc.setFontSize(7.5)
    doc.text('Declaración de alérgenos', MARGIN + doc.getTextWidth(clientName) + 5, 7.5)
    // Fecha + nº de página van en un ÚNICO pase final (necesita el total de
    // páginas, que no se conoce hasta terminar) — ver bucle de numeración
    // al final de la función. Aquí solo se reserva la franja.
  }

  function drawFooterLegend(y: number) {
    stroke(LINE); doc.setLineWidth(0.2); doc.line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3)
    sans('bold'); doc.setFontSize(6.5); ink(MUTED)
    doc.text('LEYENDA', MARGIN, y)
    let x = MARGIN + 16
    const items: { letter: string; color: [number, number, number]; label: string }[] = [
      { letter: 'C', color: DANGER, label: 'Contiene' },
      { letter: 'T', color: WARNING, label: 'Puede contener (trazas)' },
      { letter: 'L', color: SUCCESS, label: 'Libre de' },
      { letter: '?', color: MUTED, label: 'Sin determinar — consultar antes de servir' },
    ]
    for (const it of items) {
      sans('bold'); doc.setFontSize(7); ink(it.color)
      doc.text(it.letter, x, y)
      sans('normal'); doc.setFontSize(6.5); ink(INK)
      doc.text(it.label, x + 3.5, y)
      x += 3.5 + doc.getTextWidth(it.label) + 7
    }
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
  doc.text('Declaración de alérgenos', MARGIN, 24.5)
  sans('normal'); doc.setFontSize(9)
  doc.text('Reglamento (UE) 1169/2011 · Anexo II', MARGIN, 29.5)

  sans('normal'); doc.setFontSize(8.5)
  doc.text(`Generado ${data.generatedAtLabel}`, PAGE_W - MARGIN, 11, { align: 'right' })
  doc.text(scopeLabel, PAGE_W - MARGIN, 16, { align: 'right' })

  // Regla de marca navy→terracota (separador Folvy, igual que purchaseOrderPdf.ts).
  fill(NAVY); doc.rect(MARGIN, headerH + 3, CONTENT_W * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(MARGIN + CONTENT_W * 0.4, headerH + 3, CONTENT_W * 0.12, 1.1, 'F')
  fill(LINE); doc.rect(MARGIN + CONTENT_W * 0.52, headerH + 3, CONTENT_W * 0.48, 1.1, 'F')

  let y = headerH + 12

  // Cuatro cifras grandes.
  const total = data.rows.length
  const incomplete = data.rows.filter(dishIsIncomplete).length
  const complete = total - incomplete
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0
  const stats: { label: string; value: string; color: [number, number, number] }[] = [
    { label: 'Platos a la venta', value: String(total), color: INK },
    { label: 'Con declaración completa', value: String(complete), color: SUCCESS },
    { label: 'Pendientes de dato', value: String(incomplete), color: incomplete > 0 ? WARNING : SUCCESS },
    { label: 'Cobertura', value: `${pct}%`, color: pct === 100 ? SUCCESS : WARNING },
  ]
  const statW = CONTENT_W / 4
  stats.forEach((s, i) => {
    const x = MARGIN + i * statW
    display('bold'); doc.setFontSize(24); ink(s.color)
    doc.text(s.value, x, y + 10)
    sans('normal'); doc.setFontSize(8); ink(MUTED)
    doc.text(s.label, x, y + 15)
  })
  y += 24

  // Barra de cobertura.
  const barH = 5
  fill(WARNING_BG); doc.roundedRect(MARGIN, y, CONTENT_W, barH, 1, 1, 'F')
  if (pct > 0) {
    fill(SUCCESS)
    doc.roundedRect(MARGIN, y, Math.max(CONTENT_W * (pct / 100), barH), barH, 1, 1, 'F')
  }
  y += barH + 4
  sans('normal'); doc.setFontSize(7); ink(MUTED)
  doc.text(`Verde = declaración completa (${pct}%) · Ámbar = falta al menos un ingrediente por declarar`, MARGIN, y)
  y += 9

  // Bloque "Cómo se ha elaborado" — defensa legal del método.
  function textBlock(title: string, body: string, boxH: number): number {
    fill(LIGHT); stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD')
    sans('bold'); doc.setFontSize(8); ink(NAVY)
    doc.text(title.toUpperCase(), MARGIN + 4, y + 6)
    sans('normal'); doc.setFontSize(8); ink(INK)
    const lines = doc.splitTextToSize(body, CONTENT_W - 8) as string[]
    doc.text(lines, MARGIN + 4, y + 11)
    return y + boxH + 5
  }
  y = textBlock(
    'Cómo se ha elaborado',
    'Los alérgenos de cada plato se calculan a partir de los de sus ingredientes, recorriendo el ' +
      'escandallo completo incluidas las sub-recetas. Un plato solo se declara libre de un alérgeno ' +
      'cuando todos sus ingredientes lo declaran libre de forma expresa. Si algún ingrediente carece ' +
      'de dato, el plato queda como «sin determinar» — nunca como libre.',
    22,
  )

  // Bloque "Origen del dato".
  const bySource = new Map<AllergenSource, number>()
  for (const h of data.health) bySource.set(h.source, (bySource.get(h.source) ?? 0) + h.rowCount)
  const originLine =
    `${SOURCE_LABEL.manual}: ${bySource.get('manual') ?? 0}   ·   ` +
    `${SOURCE_LABEL.inherited}: ${bySource.get('inherited') ?? 0}   ·   ` +
    `${SOURCE_LABEL.ai_enrich}: ${bySource.get('ai_enrich') ?? 0}`
  y = textBlock(
    'Origen del dato',
    originLine +
      '\nLas estimaciones pendientes de confirmar no sustituyen a la ficha técnica del proveedor y ' +
      'se identifican como tales en el detalle.',
    18,
  )

  // ─────────────────────────────────────────────────────────────────
  // PÁGINAS 2..N — Matriz agrupada por marca
  // ─────────────────────────────────────────────────────────────────
  function drawBrandTableHeader(startY: number, brand: string, count: number): number {
    let yy = startY
    display('bold'); doc.setFontSize(13); ink(INK)
    doc.text(brand, MARGIN, yy)
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(`${count} plato${count === 1 ? '' : 's'}`, MARGIN + doc.getTextWidth(brand) + 4, yy)
    yy += 5

    fill(NAVY); doc.rect(MARGIN, yy, CONTENT_W, TABLE_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text('PLATO', MARGIN + 2, yy + TABLE_HEADER_H - 2.3)
    doc.setFontSize(6.3)
    ALLERGEN_CODES.forEach((code, i) => {
      const cx = MARGIN + NAME_COL_W + i * COL_W
      doc.text(allergenLabel(code).slice(0, 3).toUpperCase(), cx + COL_W / 2, yy + TABLE_HEADER_H - 2.3, { align: 'center' })
    })
    return yy + TABLE_HEADER_H
  }

  const brands = groupByBrand(data.rows)
  if (brands.length > 0) doc.addPage()
  brands.forEach(([brand, brandRows], brandIdx) => {
    if (brandIdx > 0) doc.addPage()
    drawSlimHeader()
    let ty = drawBrandTableHeader(SLIM_HEADER_H + 10, brand, brandRows.length)

    brandRows.forEach((row) => {
      if (ty + ROW_H > FOOTER_LEGEND_Y - 6) {
        doc.addPage()
        drawSlimHeader()
        ty = drawBrandTableHeader(SLIM_HEADER_H + 10, `${brand} (continuación)`, brandRows.length)
      }
      const fullyFree = dishIsFullyFree(row)
      if (fullyFree) { fill(SUCCESS_BG); doc.rect(MARGIN, ty, CONTENT_W, ROW_H, 'F') }

      sans('normal'); doc.setFontSize(7.5); ink(INK)
      const name = sanitizeDishName(row.recipeName)
      const displayName = name.length > 48 ? name.slice(0, 47) + '…' : name
      doc.text(displayName, MARGIN + 2, ty + ROW_H - 1.7, { maxWidth: NAME_COL_W - 4 })

      ALLERGEN_CODES.forEach((code, i) => {
        const cx = MARGIN + NAME_COL_W + i * COL_W
        const cell = dishAllergenState(row, code)
        if (!fullyFree) {
          fill(cell ? STATE_BG[cell.state] : WHITE)
          doc.rect(cx, ty, COL_W, ROW_H, 'F')
        }
        if (cell) {
          ink(STATE_COLOR[cell.state]); sans('bold'); doc.setFontSize(7.5)
          doc.text(STATE_LETTER[cell.state], cx + COL_W / 2, ty + ROW_H - 1.7, { align: 'center' })
        } else {
          ink(MUTED); sans('normal'); doc.setFontSize(7)
          doc.text('s/d', cx + COL_W / 2, ty + ROW_H - 1.7, { align: 'center' })
        }
        stroke(LINE); doc.setLineWidth(0.15); doc.line(cx, ty, cx, ty + ROW_H)
      })
      stroke(LINE); doc.line(MARGIN, ty + ROW_H, PAGE_W - MARGIN, ty + ROW_H)
      ty += ROW_H
    })

    drawFooterLegend(FOOTER_LEGEND_Y)
  })

  // ─────────────────────────────────────────────────────────────────
  // ÚLTIMA PÁGINA — Qué falta y por qué
  // ─────────────────────────────────────────────────────────────────
  doc.addPage()
  drawSlimHeader()
  let fy = SLIM_HEADER_H + 12
  display('bold'); doc.setFontSize(15); ink(INK)
  doc.text('Qué falta y por qué', MARGIN, fy)
  fy += 8

  if (data.blocking.length === 0) {
    sans('normal'); doc.setFontSize(9); ink(SUCCESS)
    doc.text('Ningún ingrediente bloqueante — declaración completa en todos los platos evaluados.', MARGIN, fy)
    fy += 8
  } else {
    fill(NAVY); doc.rect(MARGIN, fy, CONTENT_W, TABLE_HEADER_H, 'F')
    ink(WHITE); sans('bold'); doc.setFontSize(8)
    doc.text('INGREDIENTE', MARGIN + 2, fy + TABLE_HEADER_H - 2.3)
    doc.text('PLATOS AFECTADOS', MARGIN + 150, fy + TABLE_HEADER_H - 2.3, { align: 'right' })
    doc.text('QUÉ FALTA', MARGIN + 156, fy + TABLE_HEADER_H - 2.3)
    fy += TABLE_HEADER_H

    let zebra = false
    for (const ing of data.blocking) {
      if (fy + ROW_H > PAGE_H - MARGIN - 14) {
        doc.addPage(); drawSlimHeader(); fy = SLIM_HEADER_H + 10
      }
      if (zebra) { fill(LIGHT); doc.rect(MARGIN, fy, CONTENT_W, ROW_H, 'F') }
      zebra = !zebra
      sans('normal'); doc.setFontSize(8); ink(INK)
      doc.text(sanitizeDishName(ing.ingredientName), MARGIN + 2, fy + ROW_H - 1.6, { maxWidth: 144 })
      doc.text(String(ing.dishCount), MARGIN + 150, fy + ROW_H - 1.6, { align: 'right' })
      ink(ing.declaredCount === 0 ? DANGER : WARNING)
      doc.text(blockingReason(ing), MARGIN + 156, fy + ROW_H - 1.6, { maxWidth: CONTENT_W - 156 })
      fy += ROW_H
    }
    fy += 6
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    const closing = doc.splitTextToSize(
      'Cada ficha técnica pendiente desbloquea la declaración completa de los platos indicados.',
      CONTENT_W,
    ) as string[]
    doc.text(closing, MARGIN, fy)
    fy += closing.length * 4.5 + 4
  }

  if (data.discrepancies.length > 0) {
    if (fy + 20 > PAGE_H - MARGIN) { doc.addPage(); drawSlimHeader(); fy = SLIM_HEADER_H + 10 }
    display('bold'); doc.setFontSize(12); ink(INK)
    doc.text('Discrepancias manual vs. heredado', MARGIN, fy)
    fy += 6
    sans('normal'); doc.setFontSize(7.5); ink(MUTED)
    doc.text('Platos donde alguien declaró algo a mano que ya no coincide con lo que dicen hoy sus ingredientes.', MARGIN, fy)
    fy += 6
    for (const d of data.discrepancies) {
      if (fy + 5.5 > PAGE_H - MARGIN) { doc.addPage(); drawSlimHeader(); fy = SLIM_HEADER_H + 10 }
      sans('bold'); doc.setFontSize(8); ink(INK)
      const dishName = sanitizeDishName(d.recipeName)
      doc.text(dishName, MARGIN + 2, fy)
      sans('normal'); doc.setFontSize(8); ink(MUTED)
      const label = `${allergenLabel(d.allergenCode)}: declarado ${d.declaredState} · heredaría ${d.wouldInherit}`
      doc.text(label, MARGIN + 2 + doc.getTextWidth(dishName) + 3, fy)
      fy += 5.5
    }
  }

  // ── Fecha + numeración en la cabecera fina de las páginas 2..N (un solo
  // pase, aquí, porque hasta ahora no se sabía el total de páginas). La
  // portada (página 1) ya lleva su propia fecha en la franja grande — no
  // necesita "Página X de Y" (es la portada, no una hoja suelta). ──
  const pages = doc.getNumberOfPages()
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p)
    sans('normal'); doc.setFontSize(7.5); ink(WHITE)
    doc.text(`Generado ${data.generatedAtLabel} · Página ${p} de ${pages}`, PAGE_W - MARGIN, 7.5, { align: 'right' })
  }

  const filename = `alergenos_${data.generatedAtFilename}.pdf`
  return { blob: doc.output('blob'), filename }
}
