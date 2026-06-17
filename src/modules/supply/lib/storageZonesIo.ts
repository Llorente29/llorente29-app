// src/modules/supply/lib/storageZonesIo.ts
//
// AL1 — Exportar / importar la asignación zona↔artículo en Excel (SheetJS).
//
// Mismo formato en ambos sentidos, para que el export sirva de plantilla del
// import: columnas "Artículo", "Zona" y "Principal" (opcional). Exportas la
// asignación actual (con los huérfanos como filas de Zona vacía), la editas en
// Excel y la reimportas.
//
// Requiere la dependencia `xlsx` (SheetJS) en el front: `npm i xlsx`.

import * as XLSX from 'xlsx'

export interface AssignmentRow {
  articulo: string
  zona: string          // vacío = sin zona (huérfano)
  principal: boolean
}

export interface ParsedAssignmentRow {
  articulo: string
  zona: string
  principal: boolean
  rowNum: number        // fila del Excel (para mensajes de revisión)
}

const PRINCIPAL_TRUE = new Set(['si', 'sí', 'x', 'true', 'verdadero', '1', 'principal'])

function normHeader(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

/** Genera y descarga un .xlsx con la asignación dada. */
export function exportAssignmentXlsx(filename: string, rows: AssignmentRow[]): void {
  const data = rows.map(r => ({
    'Artículo': r.articulo,
    'Zona': r.zona,
    'Principal': r.principal ? 'Sí' : '',
  }))
  const ws = XLSX.utils.json_to_sheet(data, { header: ['Artículo', 'Zona', 'Principal'] })
  ws['!cols'] = [{ wch: 42 }, { wch: 30 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Asignación')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * Lee un .xlsx/.csv y devuelve sus filas mapeadas. Reconoce las cabeceras
 * Artículo / Zona / Principal sin distinguir mayúsculas ni acentos.
 */
export async function parseAssignmentFile(file: File): Promise<ParsedAssignmentRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return raw.map((r, i) => {
    let articulo = ''
    let zona = ''
    let principalRaw = ''
    for (const [k, v] of Object.entries(r)) {
      const key = normHeader(k)
      const val = String(v ?? '').trim()
      if (key === 'articulo' || key.startsWith('articul')) articulo = val
      else if (key === 'zona' || key.startsWith('zon')) zona = val
      else if (key === 'principal' || key.startsWith('princip')) principalRaw = val
    }
    return {
      articulo,
      zona,
      principal: PRINCIPAL_TRUE.has(normHeader(principalRaw)),
      rowNum: i + 2, // +1 por la cabecera, +1 por índice base 1
    }
  }).filter(r => r.articulo !== '')
}
