// tests/unit/modules/conta/conciliacionB02.test.ts
//
// B02 · El motor rehecho: lo que falló con el banco real de Foodint (15/10),
// con datos INVENTADOS que copian su forma. Las recargas de saldo prepago con
// una tarjeta sin dar de alta, el traspaso desde otra cuenta propia con un solo
// lado subido, el pago a un proveedor con su factura en revisión, varios con
// varios, pagos en parte con «queda por casar», la diferencia pequeña y el
// cobro de plataforma sin su liquidación.

import { describe, expect, it } from 'vitest'
import { conciliar, contraparteDe, decidir, preguntasDeTarjeta, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'

const A = 'cta-6536', B = 'cta-0133', C = 'cta-4525'

function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: A, nombre: 'BBVA principal', cuenta: '57200001', ultimos4: '6536' }, { id: B, nombre: 'BBVA dos', cuenta: '57200002', ultimos4: '0133' },
      { id: C, nombre: 'BBVA tres', cuenta: '57200003', ultimos4: '4525' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
    nombres: { '40700001': 'Saldo prepago', '62600000': 'Servicios bancarios', '76900000': 'Otros ingresos financieros', '40700000': 'Anticipos a proveedores' },
    cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: null,
    nombresPropios: ['EMPRESA INVENTADA FOOD'], cuentaDiferenciaGasto: '66900000', cuentaDiferenciaIngreso: '76900000',
    ...p,
  }
}
let n = 0
function mov(p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento {
  return { id: `m${++n}`, cuentaId: A, fecha: '2026-10-07', conceptoComun: null, referencias: [], antesDelCorte: false, contraparte: null, ...p }
}
const proveedor = { id: 'f1', numero: 'F-101', fecha: '2026-10-01', totalCent: 24_861, pagadoCent: 0, proveedor: 'Distribuciones Inventadas',
  alias: ['DISTRIBUCIONES INVENTADAS'], terceroId: 't-di', cuentaTercero: '40000009' }

describe('recargas de saldo prepago con una tarjeta sin dar de alta', () => {
  const regla = { id: 'r-cat', palabras: 'Cuando el concepto tenga «RECARGAS INVENTADAS» → Saldo prepago · 40700001', contiene: 'RECARGAS INVENTADAS',
    signo: -1 as const, cuenta: '40700001', terceroId: null, confirmaciones: 0 }
  const recargas = [1, 2, 3].map((i) => mov({ id: `rc${i}`, importeCent: -10_000, fecha: `2026-10-0${i}`, conceptoComun: null,
    concepto: 'PAGO CON TARJETA EN DISCOS, LIBROS · ************3085 RECARGAS INVENTADAS', contraparte: 'Recargas Inventadas' }))
  const ds = conciliar(recargas, ctx({ reglas: [regla] }))
  it('cada recarga va a su cuenta por la regla, con punto verde, sin pedir ticket', () => {
    for (const d of ds) expect(d).toMatchObject({ confianza: 'probable', preseleccionar: true, origen: 'regla', pideTicket: false, que: 'Saldo prepago · 40700001',
      destino: { tipo: 'cuenta', lineas: [{ cuenta: '40700001', importe: 100 }] } })
  })
  it('y de quién es la tarjeta ···3085 se pregunta UNA vez, no tres', () => {
    expect(preguntasDeTarjeta(ds)).toEqual([{ ultimos4: '3085', movimientos: ['rc1', 'rc2', 'rc3'] }])
  })
})

describe('traspasos entre cuentas propias', () => {
  it('con un solo lado subido y sin el extracto de las otras: espera el de las dos («···0133 o ···4525»), con las dos para elegir', () => {
    const d = decidir(mov({ importeCent: 24_861, concepto: 'TRASPASO · EMPRESA INVENTADA FOOD S.L.', contraparte: 'Empresa Inventada Food SL' }), ctx())
    expect(d).toMatchObject({ confianza: 'duda', preseleccionar: false, origen: 'traspaso', que: 'Traspaso desde otra cuenta tuya', destino: null, contraparte: null,
      esperaExtracto: '···0133 o ···4525' })
    expect(d.porque).toBe('Lo manda tu propia empresa y aún no está subido el extracto de ···0133 o ···4525 de esos días: cuando lo subas, le busco su pareja.')
    expect(d.alternativas.map((a) => a.etiqueta)).toEqual(['Desde ···0133', 'Desde ···4525'])
    expect(d.alternativas[0].destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '57200002', importe: 248.61 }] })
  })
  it('con una sola cuenta más, la nombra y la espera: «Espera el extracto de ···0133»', () => {
    const solo = ctx({ cuentas: ctx().cuentas.slice(0, 2) })
    const d = decidir(mov({ importeCent: 24_861, concepto: 'TRASPASO · EMPRESA INVENTADA FOOD S.L.' }), solo)
    expect(d).toMatchObject({ que: 'Traspaso desde tu cuenta ···0133', esperaExtracto: '···0133', destino: { tipo: 'cuenta', lineas: [{ cuenta: '57200002', importe: 248.61 }] } })
    expect(d.alternativas.map((a) => a.etiqueta)).toEqual(['Desde ···0133'])
  })

  // Los extractos de producción (16/10) tienen esta forma: los tres del 01/10 al 13 o 14/10, corte el 01/10.
  const subidos = [{ cuentaId: A, desde: '2026-10-01', hasta: '2026-10-14' }, { cuentaId: B, desde: '2026-10-01', hasta: '2026-10-14' },
    { cuentaId: C, desde: '2026-10-01', hasta: '2026-10-13' }]
  it('si el extracto de la otra cuenta YA cubre esos días y no lo tiene: por aclarar, con el porqué y sin esperar', () => {
    const d = decidir(mov({ importeCent: 24_861, fecha: '2026-10-07', concepto: 'TRASPASO · EMPRESA INVENTADA FOOD S.L.' }), ctx({ extractos: subidos, corte: '2026-10-01' }))
    expect(d).toMatchObject({ confianza: 'duda', esperaExtracto: null, destino: null, que: 'Traspaso desde otra cuenta tuya' })
    expect(d.porque).toBe('Lo manda tu propia empresa, pero los extractos de ···0133 y ···4525 ya están subidos y no tienen este movimiento (mismo importe, ±2 días): mira si es de otra cuenta, de otro día o no es un traspaso.')
    expect(d.alternativas.map((a) => a.etiqueta)).toEqual(['Desde ···0133', 'Desde ···4525'])
  })
  it('si una la cubre y la otra no llega a esos días (acaba el 13 y el traspaso es del 12, ±2 = 14): espera solo la que falta', () => {
    const d = decidir(mov({ importeCent: 24_861, fecha: '2026-10-12', concepto: 'TRASPASO · EMPRESA INVENTADA FOOD S.L.' }), ctx({ extractos: subidos, corte: '2026-10-01' }))
    expect(d).toMatchObject({ esperaExtracto: '···4525', destino: { tipo: 'cuenta', lineas: [{ cuenta: '57200003', importe: 248.61 }] } })
    expect(d.alternativas.map((a) => a.etiqueta)).toEqual(['Desde ···4525'])
  })
  it('el corte no se espera: un traspaso del 01/10 no busca su pareja del 29 o el 30/09', () => {
    const d = decidir(mov({ importeCent: 24_861, fecha: '2026-10-01', concepto: 'TRASPASO A CUENTA PROPIA' }), ctx({ extractos: subidos, corte: '2026-10-01' }))
    expect(d).toMatchObject({ confianza: 'duda', esperaExtracto: null })
    expect(d.porque).toMatch(/^El banco lo llama traspaso, pero los extractos/)
  })
  it('y cuando llega el otro lado, el que esperaba se casa solo con él', () => {
    const espera = mov({ id: 'w1', importeCent: 24_861, fecha: '2026-10-15', concepto: 'TRASPASO · EMPRESA INVENTADA FOOD S.L.' })
    expect(decidir(espera, ctx({ extractos: subidos, corte: '2026-10-01', sinCasar: [espera] })).esperaExtracto).toBe('···0133 o ···4525')
    const llega = mov({ id: 'w2', cuentaId: B, importeCent: -24_861, fecha: '2026-10-15', concepto: 'TRASPASO A CUENTA PROPIA' })
    const ds = conciliar([espera, llega], ctx({ extractos: [...subidos, { cuentaId: B, desde: '2026-10-15', hasta: '2026-10-20' }], corte: '2026-10-01', sinCasar: [espera, llega] }))
    expect(ds.find((d) => d.movimientoId === 'w1')).toMatchObject({ confianza: 'seguro', esperaExtracto: null, destino: { tipo: 'traspaso', otro_movimiento_id: 'w2' } })
  })
  it('con los dos lados subidos, ±2 días y la empresa en el concepto: se casa solo; a 3 días, no es la pareja', () => {
    const entra = mov({ id: 'e1', importeCent: 50_000, fecha: '2026-10-08', concepto: 'TRASPASO · EMPRESA INVENTADA FOOD SL' })
    const sale = mov({ id: 's1', cuentaId: B, importeCent: -50_000, fecha: '2026-10-06', concepto: 'TRASPASO A CUENTA PROPIA' })
    const d = decidir(entra, ctx({ sinCasar: [entra, sale] }))
    expect(d).toMatchObject({ confianza: 'seguro', origen: 'traspaso', destino: { tipo: 'traspaso', otro_movimiento_id: 's1' } })
    const lejos = mov({ id: 's2', cuentaId: B, importeCent: -50_000, fecha: '2026-10-05', concepto: 'TRASPASO A CUENTA PROPIA' })
    const d2 = decidir(entra, ctx({ sinCasar: [entra, lejos] }))
    expect(d2.destino?.tipo).not.toBe('traspaso')
  })
})

describe('facturas: en revisión, varios con varios, en parte y la diferencia pequeña', () => {
  it('el pago a un proveedor con su factura «en revisión»: en ámbar, «factura sin aprobar», nunca preseleccionada (no anticipo)', () => {
    const d = decidir(mov({ importeCent: -24_861, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS · PAGO FACT', contraparte: 'Distribuciones Inventadas' }), ctx({
      facturas: [{ ...proveedor, aprobada: false }],
      proveedores: [{ terceroId: 't-di', proveedor: 'Distribuciones Inventadas', alias: ['DISTRIBUCIONES INVENTADAS'], cuentaTercero: '40000009', cuentaAnticipo: '40700000' }] }))
    expect(d).toMatchObject({ confianza: 'probable', preseleccionar: false, facturaSinAprobar: true, origen: 'factura',
      que: 'Pago de la factura F-101 de Distribuciones Inventadas · factura sin aprobar', destino: { tipo: 'factura_recibida', facturas: [{ id: 'f1', importe: 248.61 }] } })
    expect(d.porque).toContain('Está en revisión: confirmar el pago no la aprueba.')
  })
  it('la misma, aprobada: punto verde (la casaría sola, pero sin referencia aún no puedo)', () => {
    const d = decidir(mov({ importeCent: -24_861, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }), ctx({ facturas: [proveedor] }))
    expect(d).toMatchObject({ confianza: 'probable', preseleccionar: true, facturaSinAprobar: false })
  })
  it('dos pagos para una factura: el primero deja «queda por casar» y el segundo la cierra', () => {
    const f = { ...proveedor, totalCent: 30_000 }
    const ds = conciliar([mov({ id: 'p1', importeCent: -10_000, fecha: '2026-10-02', concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }),
      mov({ id: 'p2', importeCent: -20_000, fecha: '2026-10-09', concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' })], ctx({ facturas: [f] }))
    expect(ds[0]).toMatchObject({ quedaPorCasarCent: 20_000, destino: { facturas: [{ id: 'f1', importe: 100 }] } })
    expect(ds[1]).toMatchObject({ destino: { facturas: [{ id: 'f1', importe: 200 }] } })
  })
  it('un pago con varias facturas del mismo proveedor', () => {
    const fs = [{ ...proveedor, id: 'a', numero: 'F-1', totalCent: 12_000 }, { ...proveedor, id: 'b', numero: 'F-2', totalCent: 8_000 }, { ...proveedor, id: 'c', numero: 'F-3', totalCent: 5_000 }]
    const d = decidir(mov({ importeCent: -17_000, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }), ctx({ facturas: fs }))
    expect(d).toMatchObject({ que: 'Pago de 2 facturas de Distribuciones Inventadas', destino: { facturas: [{ id: 'a', importe: 120 }, { id: 'c', importe: 50 }] } })
  })
  it('la diferencia pequeña se propone con su cuenta y nunca se crea sola: de más a la 669, de menos a la 769, comisión a la 626 (Julio, 15/10)', () => {
    const deMas = decidir(mov({ importeCent: -25_011, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }), ctx({ facturas: [proveedor] }))
    expect(deMas).toMatchObject({ confianza: 'probable', preseleccionar: false, quedaPorCasarCent: 0,
      destino: { tipo: 'factura_recibida', facturas: [{ id: 'f1', importe: 248.61 }], diferencia: { cuenta: '66900000', importe: 1.5 } } })
    const comision = decidir(mov({ importeCent: -25_011, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS · COMISION TRANSFERENCIA' }), ctx({ facturas: [proveedor] }))
    expect(comision.destino).toMatchObject({ diferencia: { cuenta: '62600000', importe: 1.5 } })
    const deMenos = decidir(mov({ importeCent: -24_860, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }), ctx({ facturas: [proveedor] }))
    expect(deMenos.destino).toMatchObject({ diferencia: { cuenta: '76900000', importe: -0.01 } })
    // Más del 3 % (o de 3 €) no es una diferencia pequeña: no se propone como pago de esa factura entera.
    const grande = decidir(mov({ importeCent: -27_000, concepto: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS' }), ctx({ facturas: [proveedor] }))
    expect(grande.destino?.tipo).not.toBe('factura_recibida')
  })
  it('mismo importe que una factura aunque el banco no nombre al proveedor: por aclarar, con la propuesta (antes que anticipo)', () => {
    const d = decidir(mov({ importeCent: -24_861, concepto: 'TRANSFERENCIAS · PAGO FACT 101' }), ctx({ facturas: [{ ...proveedor, numero: null }] }))
    expect(d).toMatchObject({ confianza: 'duda', origen: 'factura', que: '¿Pago de la factura de Distribuciones Inventadas?', destino: { facturas: [{ id: 'f1' }] } })
  })
})

describe('cobros de plataforma: por su texto propio y con su liquidación', () => {
  const plataforma = { nombre: 'Uber Eats', alias: ['Uber Eats', 'STICHTING CUSTODIAN UBER'], cuenta430: '43000002', terceroId: 't-ue', comisionHabitual: 0.3, pendiente: [] }
  const cobro = mov({ importeCent: 81_234, concepto: 'TRANSFERENCIA RECIBIDA · STICHTING CUSTODIAN UBER PAYMENTS' })
  it('sin su liquidación: «falta su liquidación», sin inventar nada', () => {
    expect(decidir(cobro, ctx({ plataformas: [plataforma] }))).toMatchObject({ confianza: 'duda', destino: null, falta: 'su liquidación' })
  })
  it('en cuanto existe la liquidación, se casa con ella sin cambiar nada', () => {
    const liq = { id: 'l1', plataforma: 'Uber Eats', fecha: '2026-10-06', desde: '2026-09-29', hasta: '2026-10-05', netoCent: 81_234, cuenta430: '43000002', terceroId: 't-ue' }
    expect(decidir(cobro, ctx({ plataformas: [plataforma], liquidaciones: [liq] }))).toMatchObject({ confianza: 'seguro', origen: 'liquidacion',
      destino: { tipo: 'liquidacion', liquidacion_id: 'l1' } })
  })
})

describe('la contraparte con la que se aprende', () => {
  it('la limpia del banco, normalizada; si no hay, la de siempre sacada del concepto', () => {
    expect(contraparteDe({ concepto: 'PAGO CON TARJETA EN DISCOS, LIBROS', contraparte: 'Recargas Inventadas' })).toBe('RECARGAS INVENTADAS')
    expect(contraparteDe({ concepto: 'RECIBO PLENITUDE ENERGIA', contraparte: null })).toBe('PLENITUDE ENERGIA')
  })
})
