// tests/unit/modules/conta/conciliacionB01r21.test.ts
//
// B01·21 · Las propuestas mal hechas de octubre en Foodint, con sus conceptos
// REALES del banco (regla 31): todas de la misma familia, proponer lo que no es
// en vez de decir que no sabe.
//   · Cloudtown (+3.757,54, 05/10) y Nobleza Vacuna (−1.174,18, 20/10), tomados
//     como traspaso entre cuentas propias porque el nombre de la empresa sale
//     en el concepto.
//   · Anthropic (9,24) y Supabase (32,29), «COMISIÓN 3 % INCLUÍDA», enteros
//     como comisión del banco.
//   · Europastry: el pago del 15/10 (175,47) propuesto como pago en parte de la
//     24093211, que es del 27/10; era la 24056932 (175,46), con un céntimo.
//   · Mercadona (75,80, pago con tarjeta), propuesto como anticipo.

import { describe, expect, it } from 'vitest'
import { comisionIncluida, conciliar, decidir, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'

const P = 'cta-6536', D = 'cta-0133'
function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: P, nombre: 'Cuenta principal', cuenta: '57200001', ultimos4: '6536' }, { id: D, nombre: 'BBVA ···0133', cuenta: '57200003', ultimos4: '0133' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
    nombres: { '62600000': 'Comisiones del banco y del datáfono', '62900000': 'Otros servicios', '40700000': 'Anticipos a proveedores' },
    cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: null,
    // Los nombres de la empresa, como los saca nombresDeEmpresa de su ficha.
    nombresPropios: ['LLORENTE29 FOOD', 'FOODINT'], cuentaDiferenciaGasto: '66900000', cuentaDiferenciaIngreso: '76900000',
    ...p,
  }
}
let n = 0
const mov = (p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento =>
  ({ id: `m${++n}`, cuentaId: P, fecha: '2026-10-15', conceptoComun: null, referencias: [], antesDelCorte: false, contraparte: null, ...p })

describe('un cliente o un proveedor no es un traspaso entre cuentas propias', () => {
  it('Cloudtown (+3.757,54, «SERVICIOS septiembre de FOODINT»): no es un traspaso', () => {
    const d = decidir(mov({ importeCent: 375_754, fecha: '2026-10-05', concepto: 'Transferencias · CLOUDTOWN BRANDS SL · SERVICIOS septiembre de FOODINT', contraparte: 'Cloudtown Brands SL' }), ctx())
    expect(d.origen).not.toBe('traspaso')
    expect(d.que).not.toMatch(/Traspaso/)
  })
  it('Nobleza Vacuna (−1.174,18, «Pago llorente29 food»): no es un traspaso', () => {
    const d = decidir(mov({ importeCent: -117_418, fecha: '2026-10-20', concepto: 'TRANSFERENCIAS · NOBLEZA VACUNA, S.L. · Pago llorente29 food', contraparte: 'Nobleza Vacuna SL' }), ctx())
    expect(d.origen).not.toBe('traspaso')
  })
  it('el traspaso de verdad sigue saliendo: el banco lo llama traspaso, o hay pareja en otra cuenta propia', () => {
    const solo = decidir(mov({ importeCent: -32_200, fecha: '2026-11-04', concepto: 'Traspaso // traspaso a cuenta // LLORENTE29 FOOD S L' }), ctx())
    expect(solo).toMatchObject({ origen: 'traspaso', que: 'Traspaso a tu cuenta ···0133' })
    expect(solo.porque).toBe('El banco lo llama traspaso y la otra cuenta aún no tiene este movimiento subido: cuando lo subas, se enlaza solo.')
    const sale = mov({ id: 'sale', cuentaId: D, importeCent: -32_200, fecha: '2026-11-04', concepto: 'Traspaso // traspaso a cuenta // LLORENTE29 FOOD S L' })
    const entra = mov({ id: 'entra', importeCent: 32_200, fecha: '2026-11-04', concepto: 'Traspaso // traspaso DESDE cuenta // LLORENTE29 FOOD S L' })
    expect(decidir(entra, ctx({ sinCasar: [entra, sale] }))).toMatchObject({ confianza: 'seguro', origen: 'traspaso', destino: { tipo: 'traspaso', otro_movimiento_id: 'sale' } })
  })
})

describe('una compra en el extranjero: solo el 3 % es comisión', () => {
  it('lee el porcentaje que dice el banco', () => {
    expect(comisionIncluida('Compra en COMERCIO EXTRANJERO-COMISIÓN 3 % INCLUÍDA · 6300 ANTHROPIC I')).toBe(3)
    expect(comisionIncluida('COMISION MANTENIMIENTO')).toBeNull()
  })
  it('Anthropic (9,24): no es «Comisión del banco»; por aclarar con las dos cifras y pidiendo la factura', () => {
    const d = decidir(mov({ importeCent: -924, concepto: 'Compra en COMERCIO EXTRANJERO-COMISIÓN 3 % INCLUÍDA · 6300 ANTHROPIC I', contraparte: 'Anthropic' }), ctx())
    expect(d.que).not.toBe('Comisión del banco')
    expect(d).toMatchObject({ confianza: 'duda', pideTicket: true, que: 'Compra en el extranjero · ¿factura?', destino: null })
    expect(d.porque).toBe('Compra en el extranjero en ANTHROPIC: 8,97 € de gasto y 0,27 € de comisión del banco (el 3 % que va dentro). Sube la factura o dime qué es y lo aprendo.')
  })
  it('Supabase (32,29), con dos veces antes en «Otros servicios»: las dos líneas, el gasto y la comisión', () => {
    const d = decidir(mov({ importeCent: -3229, fecha: '2026-10-20', concepto: 'Compra en COMERCIO EXTRANJERO-COMISIÓN 3 % INCLUÍDA · 6300 SUPABASE', contraparte: 'Supabase' }),
      ctx({ aprendido: [{ contraparte: 'SUPABASE', cuenta: '62900000', terceroId: null, veces: 2 }, { contraparte: 'SUPABASE', cuenta: '62600000', terceroId: null, veces: 3 }] }))
    expect(d).toMatchObject({ confianza: 'probable', que: 'Otros servicios · 62900000 y la comisión del banco',
      destino: { tipo: 'cuenta', lineas: [{ cuenta: '62900000', importe: 31.35 }, { cuenta: '62600000', importe: 0.94 }] } })
  })
  it('una comisión de verdad sigue siendo «Comisión del banco»', () => {
    expect(decidir(mov({ importeCent: -1250, concepto: 'COMISION MANTENIMIENTO' }), ctx()).que).toBe('Comisión del banco')
  })
})

describe('Europastry: la misma factura no se propone en dos pagos', () => {
  const eu = (id: string, numero: string, fecha: string, totalCent: number) => ({ id, numero, fecha, totalCent, pagadoCent: 0, proveedor: 'EUROPASTRY, S.A.',
    alias: ['EUROPASTRY'], terceroId: 't-eu', cuentaTercero: '40000020', aprobada: true })
  const facturas = [eu('f756', '24039756', '2026-10-06', 9_595), eu('f932', '24056932', '2026-10-14', 17_546), eu('f211', '24093211', '2026-10-27', 22_174)]
  const p15 = mov({ id: 'p15', importeCent: -17_547, fecha: '2026-10-15', concepto: 'Pago con tarjeta en SUPERMERCADOS · 6300 EUROPASTRY S.A.', contraparte: 'Europastry' })
  const p28 = mov({ id: 'p28', importeCent: -22_173, fecha: '2026-10-28', concepto: 'Pago con tarjeta en SUPERMERCADOS // pago con tarjeta // EUROPASTRY S.', contraparte: 'Europastry' })
  const ds = conciliar([p15, p28], ctx({ facturas }))
  const de = (id: string) => ds.find((d) => d.movimientoId === id)!
  it('el del 15/10 paga la 24056932 (175,46) con un céntimo de diferencia, no un trozo de la del 27/10', () => {
    expect(de('p15').destino).toMatchObject({ tipo: 'factura_recibida', facturas: [{ id: 'f932', importe: 175.46 }] })
  })
  it('el del 28/10 paga la 24093211 (221,74), también con un céntimo', () => {
    expect(de('p28').destino).toMatchObject({ tipo: 'factura_recibida', facturas: [{ id: 'f211', importe: 221.74 }] })
  })
  it('y ninguna factura sale en los dos', () => {
    const ids = ds.flatMap((d) => (d.destino?.tipo === 'factura_recibida' ? d.destino.facturas.map((f) => f.id) : []))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Mercadona: un pago con tarjeta no es un anticipo', () => {
  it('pago con tarjeta en Mercadona sin factura (75,80): pide el ticket, no «Anticipo a Mercadona»', () => {
    const d = decidir(mov({ importeCent: -7_580, fecha: '2026-10-19', concepto: 'Pago con tarjeta en SUPERMERCADOS · 4171 MERCADONA COLMENA GETAFE GETA', contraparte: 'Mercadona' }),
      ctx({ proveedores: [{ terceroId: 't-me', proveedor: 'Mercadona S.A', alias: ['MERCADONA'], cuentaTercero: '40000030', cuentaAnticipo: '40700000' }] }))
    expect(d.origen).not.toBe('anticipo')
    expect(d.pideTicket).toBe(true)
  })
  it('una transferencia a un proveedor sin factura sigue siendo un anticipo', () => {
    const d = decidir(mov({ importeCent: -50_000, concepto: 'TRANSFERENCIAS · MERCADONA S.A · ANTICIPO' }),
      ctx({ proveedores: [{ terceroId: 't-me', proveedor: 'Mercadona S.A', alias: ['MERCADONA'], cuentaTercero: '40000030', cuentaAnticipo: '40700000' }] }))
    expect(d.origen).toBe('anticipo')
  })
})
