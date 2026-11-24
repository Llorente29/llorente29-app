// tests/unit/conta/traspasoExcelLibro.test.ts · B01r26 · el xlsx que se importa en Diez (ensayo del 14/11).
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { diaDeExcel, libroXlsx } from '../../../src/modules/conta/lib/traspasoExcelLibro'

describe('el xlsx del traspaso', () => {
  it('las fechas, como día de Excel sin hora y en dd/mm/yyyy (Diez no lee «01/10/2026 14:00»)', async () => {
    expect(diaDeExcel('2026-10-01T12:00:00.000Z')).toBe(46296)
    const buf = await libroXlsx([['43000002', 'UBR-2026/00016', 110.5, '2026-10-01T12:00:00.000Z']], 'Emitidas')
    const wb = XLSX.read(buf, { cellNF: true })
    const c = wb.Sheets.Emitidas.D1
    expect([c.t, c.v, c.z, c.w]).toEqual(['n', 46296, 'dd/mm/yyyy', '01/10/2026'])
    expect(Number.isInteger(c.v)).toBe(true)
  })
  it('un xlsx estándar: los textos en sharedStrings (t="s"), no en línea (t="str")', async () => {
    const buf = await libroXlsx([['43000002', 'UBR-2026/00016', 110.5]], 'Emitidas')
    const zip = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' })
    const nombres = zip.FullPaths.join(' ')
    expect(nombres).toContain('sharedStrings.xml')
    const hoja = zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith('xl/worksheets/sheet1.xml'))]
    const xml = new TextDecoder().decode(hoja.content as Uint8Array)
    expect(xml).toMatch(/<c r="A1"[^>]*t="s"/)
    expect(xml).not.toMatch(/t="str"/)
    expect(xml).toMatch(/<c r="C1"[^>]*><v>110.5<\/v>/)
  })
  it('sin fila de títulos: la fila 1 es la primera factura', async () => {
    const wb = XLSX.read(await libroXlsx([['43000002', 'UBR-2026/00016']], 'Emitidas'))
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Emitidas, { header: 1 })[0]).toEqual(['43000002', 'UBR-2026/00016'])
  })
})
