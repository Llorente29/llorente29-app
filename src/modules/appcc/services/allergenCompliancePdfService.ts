// src/modules/appcc/services/allergenCompliancePdfService.ts
//
// PDF de la matriz de cumplimiento de alérgenos — documento para enseñar a
// Sanidad (mismo espíritu que pdfExportService.ts: jsPDF cliente, sin
// backend, hoja a mano igual que el resto de informes APPCC — no se añade
// jspdf-autotable, se reutiliza el mismo patrón de cursor `y` + addPage()
// ya establecido en pdfExportService.ts).
//
// Lleva los pictogramas reales (public/allergens/allergen-{code}.png, ya
// montados para las etiquetas de pedidos) en la cabecera de cada columna y
// en la leyenda — SIEMPRE junto a la abreviatura/letra de estado, nunca en
// su lugar: impreso en blanco y negro o a baja calidad el icono puede no
// distinguirse, el texto es lo que salva la lectura (decisión de Julio).

import jsPDF from 'jspdf'
import {
  ALLERGEN_CODES,
  allergenLabel,
  allergenIconUrl,
  type AllergenCode,
  type AllergenState,
} from '@/modules/kitchen/lib/allergens'
import type { ComplianceMatrixRow } from '@/modules/kitchen/services/allergenComplianceService'

const ACCENT: [number, number, number] = [30, 58, 95]
const GRAY: [number, number, number] = [107, 114, 128]
const INK: [number, number, number] = [40, 40, 40]
const DANGER: [number, number, number] = [220, 38, 38]
const WARNING: [number, number, number] = [194, 137, 15]
const SUCCESS: [number, number, number] = [31, 157, 107]
const LIGHT: [number, number, number] = [245, 244, 240]
const BORDER: [number, number, number] = [223, 219, 210]

const STATE_COLOR: Record<AllergenState, [number, number, number]> = {
  contains: DANGER,
  may_contain: WARNING,
  free: SUCCESS,
  unknown: GRAY,
}
const STATE_LETTER: Record<AllergenState, string> = {
  contains: 'C',
  may_contain: 'T',
  free: '✓', // ✓
  unknown: '?',
}
const STATE_LEGEND: { state: AllergenState | null; label: string }[] = [
  { state: 'contains', label: 'Contiene' },
  { state: 'may_contain', label: 'Puede contener (trazas)' },
  { state: 'free', label: 'Libre de' },
  { state: 'unknown', label: 'Sin determinar' },
  { state: null, label: 'Sin declarar' },
]

// Descarga un icono local y lo deja como data URL para doc.addImage. Best-
// effort: si uno falla (red, archivo movido), esa columna se queda solo
// con el texto — nunca rompe la generación entera del PDF por un icono.
async function loadIconDataUrl(code: AllergenCode): Promise<string | null> {
  try {
    const res = await fetch(allergenIconUrl(code))
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('icon read failed'))
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    console.warn(`[allergenCompliancePdfService] icono ${code} no cargó:`, err)
    return null
  }
}

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 12
const NAME_COL_W = 60
const COL_W = (PAGE_W - 2 * MARGIN - NAME_COL_W) / ALLERGEN_CODES.length
const ROW_H = 6.2
const HEADER_H = 15
const TITLE_H = 16

export interface AllergenPdfOptions {
  /** Ya resuelto por el caller: "Todas las marcas" o el nombre de una. */
  brandLabel: string
  /** Fecha/hora ya formateada para mostrar (no se calcula aquí). */
  generatedAtLabel: string
  /** Solo dígitos, para el nombre de fichero (p.ej. "20260806-1130"). */
  generatedAtFilename: string
}

export async function generateAllergenCompliancePdf(
  rows: ComplianceMatrixRow[],
  opts: AllergenPdfOptions,
): Promise<void> {
  const icons = new Map<AllergenCode, string>()
  await Promise.all(
    ALLERGEN_CODES.map(async (code) => {
      const url = await loadIconDataUrl(code)
      if (url) icons.set(code, url)
    }),
  )

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  function drawTitle() {
    doc.setFillColor(...ACCENT)
    doc.rect(0, 0, PAGE_W, TITLE_H, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Alérgenos — declaración obligatoria (Reglamento UE 1169/2011)', MARGIN, 10)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`${opts.brandLabel} · generado ${opts.generatedAtLabel}`, PAGE_W - MARGIN, 10, { align: 'right' })
  }

  // Leyenda (solo en la primera página): icono + nombre de los 14 alérgenos,
  // y debajo el significado de las letras de estado. Devuelve el `y` donde
  // puede empezar la tabla.
  function drawLegend(startY: number): number {
    let y = startY
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY)
    doc.text('ALÉRGENOS', MARGIN, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    const perRow = 7
    const itemW = (PAGE_W - 2 * MARGIN) / perRow
    const iconSize = 4.2
    ALLERGEN_CODES.forEach((code, i) => {
      const col = i % perRow
      const rowIdx = Math.floor(i / perRow)
      const cx = MARGIN + col * itemW
      const cy = y + rowIdx * 5.5
      const iconUrl = icons.get(code)
      if (iconUrl) {
        try {
          doc.addImage(iconUrl, 'PNG', cx, cy - 3.3, iconSize, iconSize)
        } catch (err) {
          console.warn(`[allergenCompliancePdfService] addImage leyenda ${code} falló:`, err)
        }
      }
      doc.setFontSize(7)
      doc.setTextColor(...INK)
      doc.text(allergenLabel(code), cx + iconSize + 1.5, cy)
    })
    y += Math.ceil(ALLERGEN_CODES.length / perRow) * 5.5 + 2.5

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY)
    doc.text('ESTADOS', MARGIN, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    let x = MARGIN
    for (const item of STATE_LEGEND) {
      const color = item.state ? STATE_COLOR[item.state] : BORDER
      doc.setDrawColor(...color)
      if (item.state) {
        doc.setFillColor(...color)
        doc.roundedRect(x, y - 3.2, 4, 4, 0.6, 0.6, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(6)
        doc.setFont('helvetica', 'bold')
        doc.text(STATE_LETTER[item.state], x + 2, y - 0.5, { align: 'center' })
      } else {
        doc.roundedRect(x, y - 3.2, 4, 4, 0.6, 0.6, 'S')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...INK)
      doc.text(item.label, x + 5.5, y)
      x += 5.5 + doc.getTextWidth(item.label) + 8
    }
    return y + 5
  }

  function drawTableHeader(startY: number): number {
    doc.setFillColor(...LIGHT)
    doc.rect(MARGIN, startY, PAGE_W - 2 * MARGIN, HEADER_H, 'F')
    doc.setDrawColor(...BORDER)
    doc.setTextColor(...INK)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.text('Plato', MARGIN + 2, startY + HEADER_H / 2 + 1)
    ALLERGEN_CODES.forEach((code, i) => {
      const cx = MARGIN + NAME_COL_W + i * COL_W
      const iconUrl = icons.get(code)
      if (iconUrl) {
        try {
          doc.addImage(iconUrl, 'PNG', cx + COL_W / 2 - 2.4, startY + 1.5, 4.8, 4.8)
        } catch (err) {
          console.warn(`[allergenCompliancePdfService] addImage cabecera ${code} falló:`, err)
        }
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...GRAY)
      doc.text(allergenLabel(code).slice(0, 3), cx + COL_W / 2, startY + HEADER_H - 2, { align: 'center' })
      doc.setDrawColor(...BORDER)
      doc.line(cx, startY, cx, startY + HEADER_H)
    })
    doc.setDrawColor(...BORDER)
    doc.rect(MARGIN, startY, PAGE_W - 2 * MARGIN, HEADER_H, 'S')
    return startY + HEADER_H
  }

  let y = drawLegend(TITLE_H + 6)
  drawTitle()
  y = drawTableHeader(y)

  rows.forEach((row) => {
    if (y + ROW_H > PAGE_H - MARGIN) {
      doc.addPage()
      drawTitle()
      y = drawTableHeader(TITLE_H + 4)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...INK)
    const label = row.brands.length > 0 ? `${row.recipeName} (${row.brands.join(', ')})` : row.recipeName
    doc.text(label.length > 46 ? label.slice(0, 45) + '…' : label, MARGIN + 2, y + ROW_H - 2)
    ALLERGEN_CODES.forEach((code, i) => {
      const cx = MARGIN + NAME_COL_W + i * COL_W
      const cell = row.allergens[code]
      doc.setDrawColor(...BORDER)
      doc.line(cx, y, cx, y + ROW_H)
      if (cell) {
        doc.setTextColor(...STATE_COLOR[cell.state])
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.text(STATE_LETTER[cell.state], cx + COL_W / 2, y + ROW_H - 1.6, { align: 'center' })
      } else {
        doc.setTextColor(...BORDER)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text('—', cx + COL_W / 2, y + ROW_H - 1.6, { align: 'center' })
      }
    })
    doc.setDrawColor(...BORDER)
    doc.line(MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H)
    y += ROW_H
  })

  doc.save(`alergenos_${opts.generatedAtFilename}.pdf`)
}
