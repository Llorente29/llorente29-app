// Prueba de scripts/conta/diez/c12-excel-recibidas.mjs contra la configuración
// REAL de Julio (ConfiguracionRecibidas.XML, 24/10, segunda) y contra los dos
// fallos REALES de la primera importación en la C0009: el N.I.F. con una fecha
// («24102026») y la R003 sin tipo de retención (asiento descuadrado en 30 €).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
// @ts-expect-error módulo .mjs sin tipos
import { CAMPOS, FECHA, PROVEEDOR, TIPO_RETENCION, XML, columnas, libro, revisar } from '../../../scripts/conta/diez/c12-excel-recibidas.mjs'

const col = columnas() as Record<string, number>
const letra = (cod: string) => XLSX.utils.encode_col(col[cod] - 1)

describe('C12 · Excel de recibidas para Diez', () => {
  it('cada código va a la columna del XML de Julio', () => {
    expect(letra('006')).toBe('A') // nº factura
    expect(letra('001')).toBe('B') // fecha
    expect(letra('003')).toBe('C') // N.I.F.
    expect(letra('005')).toBe('D') // nombre
    expect(letra('056')).toBe('K') // Url documento
    expect([letra('035'), letra('036'), letra('037')]).toEqual(['T', 'U', 'V']) // base, %, cuota retención
    expect(letra('034')).toBe('W') // tipo retención
    expect(Object.keys(col).every((c) => c in CAMPOS)).toBe(true)
    expect(XML).toContain(`<Valor01>${TIPO_RETENCION}</Valor01>`)
  })

  it('el XML que se entrega es el de Julio, byte a byte (salvo los finales de línea)', () => {
    const julio = readFileSync('docs/conta/c12/prueba-excel/ConfiguracionRecibidas-c12.XML', 'utf8')
    expect(julio.replace(/\r\n/g, '\n')).toBe(XML)
  })

  it('leído de vuelta, todo asiento cuadra y la R003 lleva su retención PRO', () => {
    const buf = libro()
    expect(revisar(buf)).toEqual([])
    const [, ...rs] = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(buf).Sheets.Recibidas, { header: 1, defval: '' })
    expect(rs.map((r) => r[col['003'] - 1])).toEqual([PROVEEDOR.nif, PROVEEDOR.nif, PROVEEDOR.nif])
    const r3 = rs.find((r) => r[0] === 'PRB-C12-R003')!
    expect([r3[col['035'] - 1], r3[col['036'] - 1], r3[col['037'] - 1], r3[col['034'] - 1]]).toEqual([200, 15, 30, 'PRO'])
  })

  it('caza los dos fallos de la primera prueba', () => {
    const wb = XLSX.read(libro(), { cellDates: true })
    const ws = wb.Sheets.Recibidas
    for (let i = 2; i <= 4; i++) {
      ws[`C${i}`] = { t: 'd', v: FECHA } // una fecha donde va el N.I.F.
      delete ws[`W${i}`] // sin tipo de retención
      delete ws[`V${i}`] // y Diez, sin tipo, no apunta la cuota
    }
    const mal = revisar(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    expect(mal.filter((m: string) => m.includes('N.I.F.'))).toHaveLength(3)
    expect(mal).toContain('PRB-C12-R003: el asiento no cuadra (debe 242, haber 212)')
  })
})
