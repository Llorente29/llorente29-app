// src/modules/appcc/services/allergenComplianceExcelService.ts
//
// Exportación a Excel (.xlsx) de la matriz de cumplimiento de alérgenos —
// mismo patrón que storageZonesIo.ts (SheetJS ya en el proyecto, sin
// dependencia nueva). Para trabajar el dato y compartirlo, no para
// enseñar (eso es el PDF) — aquí sí caben las etiquetas completas en cada
// celda (Excel no tiene la limitación de fuente de jsPDF).
//
// Una hoja "Resumen" + una hoja por marca + una hoja "Ingredientes
// bloqueantes".

import * as XLSX from 'xlsx'
import {
  ALLERGEN_CODES,
  allergenLabel,
  allergenStateLabel,
} from '@/modules/kitchen/lib/allergens'
import type {
  ComplianceMatrixRow,
  BlockingIngredient,
  DataHealthRow,
  AllergenSource,
} from '@/modules/kitchen/services/allergenComplianceService'

const SOURCE_LABEL: Record<AllergenSource, string> = {
  manual: 'Ficha técnica del proveedor',
  inherited: 'Heredado del escandallo',
  automatic: 'Automático',
  ai_enrich: 'Estimación pendiente de confirmar',
}

function dishIsIncomplete(row: ComplianceMatrixRow): boolean {
  return ALLERGEN_CODES.some((code) => {
    const cell = row.allergens[code]
    return !cell || cell.state === 'unknown'
  })
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

// Nombre de hoja Excel: máx 31 caracteres, sin : \ / ? * [ ].
function sheetSafeName(name: string, usedNames: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Marca'
  let candidate = base
  let n = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
    n++
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

export interface AllergenExcelData {
  account: { legalName: string | null; cif: string | null }
  brandCount: number
  locationCount: number
  generatedAtLabel: string
  generatedAtFilename: string
  rows: ComplianceMatrixRow[]
  blocking: BlockingIngredient[]
  health: DataHealthRow[]
}

export function generateAllergenComplianceExcel(data: AllergenExcelData): { filename: string } {
  const wb = XLSX.utils.book_new()

  // ── Hoja "Resumen" ──
  const total = data.rows.length
  const incomplete = data.rows.filter(dishIsIncomplete).length
  const complete = total - incomplete
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0
  const bySource = new Map<AllergenSource, number>()
  for (const h of data.health) bySource.set(h.source, (bySource.get(h.source) ?? 0) + h.rowCount)

  const summaryRows: Record<string, string>[] = [
    { 'Campo': 'Cliente', 'Valor': data.account.legalName ?? '—' },
    { 'Campo': 'CIF', 'Valor': data.account.cif ?? '—' },
    { 'Campo': 'Generado', 'Valor': data.generatedAtLabel },
    { 'Campo': 'Alcance', 'Valor': `${data.brandCount} marca(s) · ${data.locationCount} local(es)` },
    { 'Campo': '', 'Valor': '' },
    { 'Campo': 'Platos a la venta', 'Valor': String(total) },
    { 'Campo': 'Con declaración completa', 'Valor': String(complete) },
    { 'Campo': 'Pendientes de dato', 'Valor': String(incomplete) },
    { 'Campo': 'Cobertura', 'Valor': `${pct}%` },
    { 'Campo': '', 'Valor': '' },
    { 'Campo': SOURCE_LABEL.manual, 'Valor': String(bySource.get('manual') ?? 0) },
    { 'Campo': SOURCE_LABEL.inherited, 'Valor': String(bySource.get('inherited') ?? 0) },
    { 'Campo': SOURCE_LABEL.ai_enrich, 'Valor': String(bySource.get('ai_enrich') ?? 0) },
  ]
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows, { header: ['Campo', 'Valor'] })
  summaryWs['!cols'] = [{ wch: 36 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Resumen')

  // ── Una hoja por marca — etiquetas completas, sin código de letra ──
  const usedNames = new Set<string>(['resumen', 'ingredientes bloqueantes'])
  for (const [brand, brandRows] of groupByBrand(data.rows)) {
    const sheetRows = brandRows.map((row) => {
      const record: Record<string, string> = { 'Plato': row.recipeName }
      for (const code of ALLERGEN_CODES) {
        const cell = row.allergens[code]
        record[allergenLabel(code)] = cell ? allergenStateLabel(cell.state) : 'Sin declarar'
      }
      return record
    })
    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ['Plato', ...ALLERGEN_CODES.map((c) => allergenLabel(c))],
    })
    ws['!cols'] = [{ wch: 40 }, ...ALLERGEN_CODES.map(() => ({ wch: 16 }))]
    XLSX.utils.book_append_sheet(wb, ws, sheetSafeName(brand, usedNames))
  }

  // ── Hoja "Ingredientes bloqueantes" ──
  const blockingRows = data.blocking.map((ing) => ({
    'Ingrediente': ing.ingredientName,
    'Platos afectados': ing.dishCount,
    'Qué falta': ing.declaredCount === 0
      ? 'Pendiente de ficha técnica del proveedor'
      : 'Sin declarar (dato parcial)',
  }))
  const blockingWs = XLSX.utils.json_to_sheet(blockingRows, {
    header: ['Ingrediente', 'Platos afectados', 'Qué falta'],
  })
  blockingWs['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 36 }]
  XLSX.utils.book_append_sheet(wb, blockingWs, 'Ingredientes bloqueantes')

  const filename = `alergenos_${data.generatedAtFilename}.xlsx`
  XLSX.writeFile(wb, filename)
  return { filename }
}
