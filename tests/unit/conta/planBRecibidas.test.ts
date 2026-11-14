// B01r26 (14/11) · Plan B del traspaso: las que «Ya lo he importado» no encuentra
// en Diez, con su porqué, y lo que Diez tiene sin enlace. Datos inventados.
import { describe, expect, it } from 'vitest'
import { porQueNoCasa, sinEnlaceEnDiez, type FacturaDelTraspaso } from '../../../supabase/functions/_shared/diezTraspasoExcel'

const rec = (numero: string, cuenta: string, total: number): FacturaDelTraspaso => ({
  entry_id: `e-${numero}`, excel: 'recibidas', numero, cuenta, subcuentas: [cuenta],
  recibida: { numero, fechaFactura: '2026-10-20', fechaOperacion: '2026-10-20', concepto: numero, proveedor: { subcuenta: cuenta, nombre: 'Proveedor de prueba', nif: 'B00000000' }, gastos: [{ cuenta: '60000000', importe: total }], iva: [], retencion: null, total, url: 'https://x.invalid/pdf' },
})
const diez = (doc: number, numero: string, cuenta: string, total: number) => ({ Ejercicio: '2026', Serie: '2', Documento: doc, NumeroFactura: numero, CuentaCliente: cuenta, Fecha: 20261020, FechaFactura: 20261020, TotalFactura: total })

describe('porQueNoCasa', () => {
  it('con su número en otra subcuenta: lo dice, con el documento', () => {
    const r = porQueNoCasa(rec('A-0001', '41000003', 37.6), [diez(3305, 'A 0001', '41000100', 37.6)], [])
    expect(r.porque).toMatch(/subcuenta 41000100 y no en la 41000003 \(documento 2026\.2\.3305\)/)
    expect(r.en_diez).toBe('2026.2.3305')
  })
  it('de su subcuenta e importe con otro número, entre las libres: avisa de mirarla', () => {
    const libre = diez(3306, 'OTRO-9', '41000003', 37.6)
    const r = porQueNoCasa(rec('A-0002', '41000003', 37.6), [libre], [libre])
    expect(r.porque).toMatch(/otro número, «OTRO-9» \(documento 2026\.2\.3306\): mírala antes de mandarla/)
  })
  it('la parecida enlazada ya con otra no cuenta (solo las libres)', () => {
    const r = porQueNoCasa(rec('A-0003', '41000003', 37.6), [diez(3307, 'OTRO-8', '41000003', 37.6)], [])
    expect(r).toEqual({ porque: 'No está en Diez: ni con su número ni con su subcuenta y su importe.', en_diez: null })
  })
  it('una emitida busca en la serie 1', () => {
    const x: FacturaDelTraspaso = { entry_id: 'v1', excel: 'emitidas', numero: 'UBR-2026/00001', cuenta: '43000001', subcuentas: [] }
    expect(porQueNoCasa(x, [diez(3308, 'UBR-2026/00001', '43000001', 10)], []).en_diez).toBeNull()
  })
})

describe('sinEnlaceEnDiez', () => {
  it('las de las series 1 y 2 sin enlace, una vez cada una y en orden', () => {
    const xs = [diez(3310, 'B', '41000003', 2), diez(3309, 'A', '41000003', 1), diez(3309, 'A', '41000003', 1), { ...diez(10, 'C', '43000001', 3), Serie: '1' }, { ...diez(1, 'X', '57200000', 3), Serie: '4' }]
    const r = sinEnlaceEnDiez(xs, new Set(['2/3310']))
    expect(r.map((f) => f.ref)).toEqual(['2026.1.10', '2026.2.3309'])
  })
})
