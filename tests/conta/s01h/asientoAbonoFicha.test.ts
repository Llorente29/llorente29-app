// S01h · 1 (31/10) · El asiento del abono tal como lo enseña la FICHA, no solo
// la propuesta. En producción la ficha del 1506416 enseñaba la 60000000 y el
// IVA sin cuenta al Debe y la 60800000 al Haber por 175,46: cuentasDeLaPropuesta
// buscaba la 472 en el Debe y el proveedor en el Haber, y la propuesta del abono
// ya viene girada. Las pruebas de antes solo miraban comoAbono, no lo que pinta
// asientoVistaPrevia con esa propuesta.
//
// Las cifras del 1506416 (4 % sobre 26,58 y 10 % sobre 134,38; cuotas 1,06 y
// 13,44; total 175,46) y el plan de Foodint: la 400 propia del proveedor, la
// 472 propia de cada tipo y la 608 de plantilla. El proveedor es inventado.
import { describe, expect, it } from 'vitest'
import { comoAbono, facturaProveedor, plantillaDevolucion } from '@/modules/conta/lib/asientosPropuestos'
import { asientoVistaPrevia, borradorDe, cuentasDeLaPropuesta } from '@/modules/conta/documentos/fichaRecibida'
import { sinSigno } from '@/modules/conta/documentos/abono'
import type { FacturaRevisar } from '@/modules/conta/services/documentosService'

const PLAN: Record<string, string> = {
  '40000006': 'Proveedores · Obrador de prueba',
  '47200004': 'IVA soportado 4 %',
  '47200010': 'IVA soportado 10 %',
  '60000000': 'Compras de mercaderías',
  '60800000': 'Devoluciones de compras de mercaderías',
}
const nombre = (c: string) => PLAN[c] ?? 'Cuenta'

// La propuesta, como la arma propuestasLibroService: importes en positivo y girada con comoAbono.
const propuesta = comoAbono(facturaProveedor({
  id: 'a1', numero: '1506416', fecha: '2026-10-13', proveedor: 'Obrador de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 26.58, tipo: { id: 't4', porcentaje: 4 }, cuentaGasto: '60000000' }, { base: 134.38, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }],
  total: 175.46, retencion: null,
  cuotas: [{ porcentaje: 4, base: 26.58, cuota: 1.06 }, { porcentaje: 10, base: 134.38, cuota: 13.44 }],
}, {
  proveedor: '40000006', retencion: '47510000',
  ivaSoportado: (p: number) => ({ 4: { cuenta: '47200004', tipoId: 't4' }, 10: { cuenta: '47200010', tipoId: 't10' } } as Record<number, { cuenta: string; tipoId: string }>)[p] ?? null,
}).propuesta!, (c) => (plantillaDevolucion(c) ? '60800000' : null), 'la 24056558')

// La ficha: la factura como la da conta_factura_para_revisar (en negativo), sin signo como la pinta la página.
const fac = sinSigno({
  clase: 'credit_note', base: -160.96, cuota: -14.5, recargo: null, retencion: null, total: -175.46,
  tipos: [{ tipo: 10, base: -134.38, cuota: -13.44, recargo: 0 }, { tipo: 4, base: -26.58, cuota: -1.06, recargo: 0 }],
  lineas: [],
} as unknown as FacturaRevisar)
const borrador = borradorDe({
  proveedorId: 'p1', numero: '1506416', fecha: '2026-10-13', vence: null, retencion: null, recargo: null,
  gasto: '60000000', local: 'l1', formaPago: null, pagada: false,
  tipos: fac.tipos, lineas: fac.lineas, base: fac.base, cuota: fac.cuota,
})

describe('S01h · 1 · el asiento del abono en la ficha', () => {
  it('cada línea con su cuenta, su columna y su importe: Debe el proveedor; Haber la 608 y la 472 de cada tipo', () => {
    const v = asientoVistaPrevia(borrador, cuentasDeLaPropuesta(propuesta.lineas, nombre), nombre, () => null)
    expect(v.lineas.map((l) => [l.codigo, l.debe, l.haber])).toEqual([
      ['40000006', 175.46, null],
      ['60800000', null, 160.96],
      ['47200004', null, 1.06],
      ['47200010', null, 13.44],
    ])
    expect(v.faltan).toEqual([])
    expect(v.cuadra).toBe(true)
    expect([v.debe, v.haber]).toEqual([175.46, 175.46])
  })

  it('la propuesta que se valida, línea a línea, es la misma', () => {
    const porCuenta = (ls: readonly { cuenta: string; debe: number; haber: number }[]) =>
      Object.fromEntries(ls.map((l) => [l.cuenta, [l.debe, l.haber]]))
    expect(porCuenta(propuesta.lineas)).toEqual({
      '40000006': [175.46, 0], '60800000': [0, 160.96], '47200004': [0, 1.06], '47200010': [0, 13.44],
    })
  })

  it('sin cuenta de devoluciones en el plan, la compra va al Haber de su misma cuenta', () => {
    const sin = comoAbono(facturaProveedor({
      id: 'a2', numero: 'A-1', fecha: '2026-10-13', proveedor: 'Obrador de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: 'l1',
      lineas: [{ base: 100, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }], total: 110, retencion: null,
    }, { proveedor: '40000006', retencion: '47510000', ivaSoportado: () => ({ cuenta: '47200010', tipoId: 't10' }) }).propuesta!, () => null, null)
    const b = borradorDe({ proveedorId: 'p1', numero: 'A-1', fecha: '2026-10-13', vence: null, retencion: null, recargo: null, gasto: '60000000', local: 'l1',
      formaPago: null, pagada: false, tipos: [{ tipo: 10, base: 100, cuota: 10, recargo: 0 }], lineas: [], base: 100, cuota: 10 })
    const v = asientoVistaPrevia(b, cuentasDeLaPropuesta(sin.lineas, nombre), nombre, () => null)
    expect(v.lineas.map((l) => [l.codigo, l.debe, l.haber])).toEqual([['40000006', 110, null], ['60000000', null, 100], ['47200010', null, 10]])
  })

  it('una factura de siempre sigue igual: el gasto y el IVA al Debe, el proveedor al Haber', () => {
    const f = facturaProveedor({
      id: 'f1', numero: 'F-1', fecha: '2026-10-13', proveedor: 'Obrador de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: 'l1',
      lineas: [{ base: 100, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }], total: 110, retencion: null,
    }, { proveedor: '40000006', retencion: '47510000', ivaSoportado: () => ({ cuenta: '47200010', tipoId: 't10' }) }).propuesta!
    const b = borradorDe({ proveedorId: 'p1', numero: 'F-1', fecha: '2026-10-13', vence: null, retencion: null, recargo: null, gasto: '60000000', local: 'l1',
      formaPago: null, pagada: false, tipos: [{ tipo: 10, base: 100, cuota: 10, recargo: 0 }], lineas: [], base: 100, cuota: 10 })
    const v = asientoVistaPrevia(b, cuentasDeLaPropuesta(f.lineas, nombre), nombre, () => null)
    expect(v.lineas.map((l) => [l.codigo, l.debe, l.haber])).toEqual([['60000000', 100, null], ['47200010', 10, null], ['40000006', null, 110]])
  })
})
