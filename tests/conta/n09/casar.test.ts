// tests/conta/n09/casar.test.ts
//
// N09 · El casado de los pagos con sus facturas (src/modules/conta/lib/traer/casarPagos.ts), contra los
// ficheros de ejemplo de ERP10 del N04 (tests/conta/fixtures/importar/erp10, inventados: T11). El
// ejemplo trae dos facturas pagadas enteras (A-10 y F-1) y tres pendientes (B-7, ALQ-3 y F-2); los
// casos que no trae (a medias, dos pagos, un pago de dos facturas, uno por importe y uno que no casa)
// se hacen añadiendo pagos al diario leído del mismo ejemplo.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { abrirExcel, leerCarga } from '@/modules/conta/lib/traer'
import { casarPagos, fraseDelTercero, llevaNumero } from '@/modules/conta/lib/traer/casarPagos'
import type { Asiento, DiarioLeido } from '@/modules/conta/lib/traer/leer'

const D = 'tests/conta/fixtures/importar/erp10/'
const carga = leerCarga(readdirSync(D).filter((f) => f.endsWith('.xlsx')).map((f) => {
  const b = readFileSync(D + f)
  return abrirExcel(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
}))
const diario = carga.diario!
const facturas = [...carga.recibidas!.facturas, ...carga.expedidas!.facturas]
const terceros = [...carga.proveedores!.terceros.map((t) => ({ t, clase: 'proveedor' as const })), ...carga.clientes!.terceros.map((t) => ({ t, clase: 'cliente' as const }))]

/** Un pago (proveedor: al debe de su cuenta) o un cobro (cliente: al haber), contra el banco. */
function pago(fecha: string, cuenta: string, importe: number, concepto: string, cliente = false): Asiento {
  const t = { subcuenta: cuenta, nombre: '', concepto, debe: cliente ? 0 : importe, haber: cliente ? importe : 0 }
  const b = { subcuenta: '57200001', nombre: '', concepto, debe: cliente ? importe : 0, haber: cliente ? 0 : importe }
  return { clave: `3.${fecha}`, serie: '3', documento: '99', fecha, apuntes: [t, b], debe: importe, haber: importe }
}
const con = (...mas: Asiento[]): DiarioLeido => ({ ...diario, asientos: [...diario.asientos, ...mas] })
const sin = (concepto: string): DiarioLeido => ({ ...diario, asientos: diario.asientos.filter((a) => !a.apuntes.some((x) => x.concepto === concepto)) })
const de = (r: ReturnType<typeof casarPagos>, codigo: string) => r.find((t) => t.codigo === codigo)!
const fac = (r: ReturnType<typeof casarPagos>, codigo: string, numero: string) => de(r, codigo).facturas.find((f) => f.numero === numero)!

describe('el ejemplo de ERP10 tal cual', () => {
  const r = casarPagos(diario, terceros, facturas, carga.sumas)
  it('A-10, pagada entera por su documento («Pago A-10»); F-1, cobrada («Cobro F-1»)', () => {
    expect(fac(r, '40000001', 'A-10')).toMatchObject({ pendiente: 0, como: 'pagada', conPagosSinCasar: false })
    expect(fac(r, '43000001', 'F-1')).toMatchObject({ pendiente: 0, como: 'pagada' })
  })
  it('B-7, ALQ-3 (sin la retención) y F-2, pendientes enteras', () => {
    expect(fac(r, '40000002', 'B-7')).toMatchObject({ pendiente: 34100, como: 'pendiente' })
    expect(fac(r, '41000001', 'ALQ-3')).toMatchObject({ pendiente: 102000, aPagar: 102000, como: 'pendiente' })
    expect(fac(r, '43000001', 'F-2')).toMatchObject({ pendiente: 55000, como: 'pendiente' })
  })
  it('lo pendiente de cada tercero da igual que su saldo en el sumas y saldos', () => {
    for (const t of r.filter((x) => x.facturas.length)) expect([t.codigo, t.saldoDe, t.cuadra]).toEqual([t.codigo, 'sumas', true])
    expect(r.flatMap((t) => t.pagosSinCasar)).toEqual([])
  })
})

describe('los casos que el ejemplo no trae', () => {
  it('una a medias: «Pago B-7» de 100,00 → le quedan 241,00', () => {
    const r = casarPagos(con(pago('2026-03-10', '40000002', 10000, 'Pago B-7')), terceros, facturas, null)
    expect(fac(r, '40000002', 'B-7')).toMatchObject({ pendiente: 24100, como: 'a_medias', conPagosSinCasar: false })
    expect(de(r, '40000002')).toMatchObject({ saldo: 24100, saldoDe: 'diario', cuadra: true })
  })
  it('una en dos pagos: 100,00 y 241,00 a la B-7 → pagada', () => {
    const r = casarPagos(con(pago('2026-03-10', '40000002', 10000, 'Pago B-7'), pago('2026-03-20', '40000002', 24100, 'Pago resto B-7')), terceros, facturas, null)
    expect(fac(r, '40000002', 'B-7')).toMatchObject({ pendiente: 0, como: 'pagada' })
  })
  it('un pago de dos facturas: «Cobro F-1 y F-2» de 1.650,00 → las dos cobradas', () => {
    const s = casarPagos({ ...sin('Cobro F-1'), asientos: [...sin('Cobro F-1').asientos, pago('2026-03-15', '43000001', 165000, 'Cobro F-1 y F-2', true)] }, terceros, facturas, null)
    expect(fac(s, '43000001', 'F-1').como).toBe('pagada')
    expect(fac(s, '43000001', 'F-2').como).toBe('pagada')
    expect(de(s, '43000001')).toMatchObject({ pendiente: 0, saldo: 0, cuadra: true })
  })
  it('sin número en el concepto, por importe: «Transferencia» de 341,00 → la B-7, que es la única con eso pendiente', () => {
    const r = casarPagos(con(pago('2026-03-10', '40000002', 34100, 'Transferencia')), terceros, facturas, null)
    expect(fac(r, '40000002', 'B-7').como).toBe('pagada')
  })
  it('uno que no casa: «Pago a cuenta» de 50,00 → la B-7 entra pendiente entera y marcada, y no cuadra con el saldo', () => {
    const r = casarPagos(con(pago('2026-03-10', '40000002', 5000, 'Pago a cuenta')), terceros, facturas, null)
    expect(fac(r, '40000002', 'B-7')).toMatchObject({ pendiente: 34100, como: 'pendiente', conPagosSinCasar: true })
    expect(de(r, '40000002')).toMatchObject({ pendiente: 34100, saldo: 29100, cuadra: false })
    expect(de(r, '40000002').pagosSinCasar).toEqual([{ fecha: '2026-03-10', importe: 5000, concepto: 'Pago a cuenta', porque: 'no nombra ninguna factura suya y no es lo que le queda a ninguna' }])
    expect(fraseDelTercero(de(r, '40000002'))).toBe('40000002 · Proveedor Ejemplo Dos, S.A.: un pago que no he podido casar (50,00 del 10/03/2026: no nombra ninguna factura suya y no es lo que le queda a ninguna); y lo que le queda por pagar de sus facturas, 341,00, no da igual que su saldo en el diario, 291,00. Míralas.')
  })
  it('un pago de más que lo que le queda a la factura que nombra no se casa', () => {
    const r = casarPagos(con(pago('2026-03-10', '40000002', 40000, 'Pago B-7')), terceros, facturas, null)
    expect(fac(r, '40000002', 'B-7')).toMatchObject({ pendiente: 34100, conPagosSinCasar: true })
  })
})

describe('el número de la factura, entero', () => {
  it('«A-10» no está en «A-100», y sí en «Pago A-10»', () => {
    expect(llevaNumero('Pago A-10', 'A-10')).toBe(true)
    expect(llevaNumero('Pago A-100', 'A-10')).toBe(false)
    expect(llevaNumero('cobro f-1 y f-2', 'F-2')).toBe(true)
  })
})
