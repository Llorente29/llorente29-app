// tests/unit/modules/conta/pc01/abonoPasarela.test.ts
//
// S01 · PR 1 · Casar en Bancos el abono de Stripe o del TPV (Redsys) con sus
// cobros por el enlace de pago (lib/conciliacion.ts, abonoDePasarela y la rama
// del motor). Foodint no tiene abonos de Stripe (el cobro está apagado): los
// abonos son INVENTADOS, uno que cuadra y otros que no, con las cifras de un
// abono de Stripe de verdad (1,5 % + 0,25 € por cobro con tarjeta europea).
//   · Stripe, nombrado y con el neto al céntimo: «seguro», con su porqué.
//   · Sin nombrar a Stripe, o con dos formas de juntarlos: para confirmar.
//   · Un abono que no cuadra con ningún tramo: nada.
//   · El TPV: tiene que nombrarlo el banco; comisión de 0 al 3 %, para confirmar.
//   · Un lote: cada cobro se casa una sola vez.
//   · Un cobro sin su asiento (la pasarela contra la 430): por aclarar, diciendo qué falta.
//   · El asiento que se enseña (Respuesta 1): 572 del banco + 626 al debe, la
//     cuenta de la pasarela («Stripe · por abonar») al haber, y cuadra.

import { describe, expect, it } from 'vitest'
import { abonoDePasarela, conciliar, decidir, type CobroPasarela, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'
import { asientoQueSeCrea, PILDORA } from '@/modules/conta/lib/conciliarVista'

const BANCO = 'cta-bbva'
function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: BANCO, nombre: 'BBVA', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [],
    liquidaciones: [], plataformas: [], nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
    nombres: { '62600000': 'Comisiones del banco y del datáfono' }, cuentas626: '62600000', cuentas476: '47600000', ...p,
  }
}
let n = 0
const mov = (p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento =>
  ({ id: `m${++n}`, cuentaId: BANCO, fecha: '2026-11-05', conceptoComun: null, referencias: [], antesDelCorte: false, ...p })

const STRIPE_POR_ABONAR = '57200021', TPV_POR_ABONAR = '57200022'
/** Un cobro con tarjeta por Stripe: 1,5 % + 0,25 €, como cobra Stripe a una tarjeta europea. Con su asiento contra «Stripe · por abonar». */
const conStripe = (id: string, fecha: string, brutoCent: number, conAsiento = true, cliente = 'Club Deportivo Vallecas'): CobroPasarela => {
  const comisionCent = Math.round(brutoCent * 0.015) + 25
  return { id, proveedor: 'stripe', fecha, brutoCent, comisionCent, netoCent: brutoCent - comisionCent, factura: `F-${id}`, cliente, cuenta: STRIPE_POR_ABONAR, conAsiento }
}
const conTpv = (id: string, fecha: string, brutoCent: number): CobroPasarela =>
  ({ id, proveedor: 'redsys', fecha, brutoCent, comisionCent: null, netoCent: null, factura: `A-${id}`, cliente: 'Academia de Baile Lavapiés', cuenta: TPV_POR_ABONAR, conAsiento: true })

// Tres cobros del 3 al 5/11 que suman 120,00 €: 40 + 50 + 30.
const S1 = conStripe('s1', '2026-11-03', 4_000), S2 = conStripe('s2', '2026-11-04', 5_000), S3 = conStripe('s3', '2026-11-05', 3_000)
const NETO = [S1, S2, S3].reduce((t, c) => t + c.netoCent!, 0)
const COMISION = [S1, S2, S3].reduce((t, c) => t + c.comisionCent!, 0)

describe('El abono de Stripe', () => {
  it('cuadra: nombrado y con el neto al céntimo, «seguro», con el porqué del encargo', () => {
    expect(NETO).toBe(11_745); expect(COMISION).toBe(255)
    const d = decidir(mov({ importeCent: NETO, concepto: 'TRANSFERENCIA DE STRIPE PAYMENTS EUROPE LTD' }), ctx({ cobrosPasarela: [S1, S2, S3] }))
    expect(d.confianza).toBe('seguro')
    expect(d.origen).toBe('pasarela')
    expect(d.que).toBe('Abono de Stripe del 03/11 al 05/11 · 3 cobros')
    expect(d.porque).toBe('Abono de Stripe del 03/11 al 05/11: 3 cobros, 120,00 € menos 2,55 € de comisión. Cuadra al céntimo con lo que Stripe dijo de cada cobro.')
    expect(d.destino).toEqual({ tipo: 'abono_pasarela', proveedor: 'stripe', cobros: ['s1', 's2', 's3'], comision: 2.55, cuenta_comision: '62600000',
      cuenta_pasarela: STRIPE_POR_ABONAR, cobrado: 120, concepto: 'Abono de Stripe del 03/11 al 05/11 · 3 cobros' })
    expect(PILDORA[d.origen!]).toBe('Cobro con tarjeta')
  })

  it('no cuadra: un céntimo de más o de menos, nada (va por su camino de siempre)', () => {
    for (const imp of [NETO + 1, NETO - 1, 12_000]) {
      expect(abonoDePasarela(mov({ importeCent: imp, concepto: 'STRIPE PAYMENTS EUROPE' }), [S1, S2, S3])).toBeNull()
    }
  })

  it('cuadra un tramo: el abono de los dos primeros días deja fuera el tercero', () => {
    const a = abonoDePasarela(mov({ importeCent: S1.netoCent! + S2.netoCent!, concepto: 'STRIPE' }), [S1, S2, S3])!
    expect(a.cobros.map((c) => c.id)).toEqual(['s1', 's2'])
    expect(a.confianza).toBe('seguro')
  })

  it('sin nombrar a Stripe, para confirmar y lo dice', () => {
    const d = decidir(mov({ importeCent: NETO, concepto: 'TRANSFERENCIA RECIBIDA' }), ctx({ cobrosPasarela: [S1, S2, S3] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toMatch(/el banco no nombra a Stripe: confírmalo\.$/)
  })

  it('dos formas de juntar los cobros que dan lo mismo: para confirmar', () => {
    const a1 = conStripe('a1', '2026-11-03', 4_000), a2 = conStripe('a2', '2026-11-04', 4_000)
    const a = abonoDePasarela(mov({ importeCent: a1.netoCent!, concepto: 'STRIPE' }), [a1, a2])!
    expect(a.confianza).toBe('probable')
    expect(a.cobros.map((c) => c.id)).toEqual(['a2'])
    expect(a.porque).toMatch(/hay 2 formas de juntar/)
  })

  it('sin el neto de algún cobro (Stripe aún no lo dijo), no se casa por neto', () => {
    expect(abonoDePasarela(mov({ importeCent: NETO, concepto: 'STRIPE' }), [S1, { ...S2, netoCent: null }, S3])).toBeNull()
  })

  it('un cobro de después del abono, o de hace más de 31 días, no entra', () => {
    expect(abonoDePasarela(mov({ importeCent: S3.netoCent!, concepto: 'STRIPE', fecha: '2026-11-04' }), [S3])).toBeNull()
    expect(abonoDePasarela(mov({ importeCent: S1.netoCent!, concepto: 'STRIPE', fecha: '2026-12-05' }), [S1])).toBeNull()
  })

  it('un cargo no es un abono', () => {
    expect(abonoDePasarela(mov({ importeCent: -NETO, concepto: 'STRIPE' }), [S1, S2, S3])).toBeNull()
  })
})

describe('El abono del TPV (Redsys)', () => {
  const T1 = conTpv('t1', '2026-11-04', 6_000), T2 = conTpv('t2', '2026-11-04', 6_100)

  it('nombrado y con comisión pequeña: para confirmar, con la comisión que sale', () => {
    const d = decidir(mov({ importeCent: 12_040, concepto: 'ABONO TPV COMERCIO 999008881' }), ctx({ cobrosPasarela: [T1, T2] }))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toBe('Abono del TPV del 04/11: 2 cobros, 121,00 € menos 0,60 € de comisión. El banco no dice la comisión: sale de lo cobrado menos lo abonado. Confírmalo.')
    expect(d.destino).toMatchObject({ tipo: 'abono_pasarela', proveedor: 'redsys', comision: 0.6, cuenta_pasarela: TPV_POR_ABONAR, cobrado: 121 })
  })

  it('sin comisión (el banco abona el bruto), también', () => {
    expect(abonoDePasarela(mov({ importeCent: 12_100, concepto: 'LIQUIDACION TPV' }), [T1, T2])?.comisionCent).toBe(0)
  })

  it('no cuadra: sin nombrar el TPV, o con más del 3 % de comisión, nada', () => {
    expect(abonoDePasarela(mov({ importeCent: 12_040, concepto: 'TRANSFERENCIA RECIBIDA' }), [T1, T2])).toBeNull()
    expect(abonoDePasarela(mov({ importeCent: 11_700, concepto: 'ABONO TPV' }), [T1, T2])).toBeNull()
  })
})

describe('En el motor', () => {
  it('un lote: cada cobro se casa una sola vez', () => {
    const a = mov({ importeCent: S1.netoCent!, concepto: 'STRIPE', fecha: '2026-11-04' })
    const b = mov({ importeCent: S1.netoCent!, concepto: 'STRIPE', fecha: '2026-11-05' })
    const [da, db] = conciliar([a, b], ctx({ cobrosPasarela: [S1] }))
    expect(da.destino).toMatchObject({ tipo: 'abono_pasarela', cobros: ['s1'] })
    expect(db.destino?.tipo).not.toBe('abono_pasarela')
  })

  it('un cobro sin su asiento: por aclarar, diciendo qué falta (sin él, en la pasarela no hay nada que saldar)', () => {
    const sin = conStripe('x1', '2026-11-03', 4_000, false, 'Eventos Rivas Catering SL')
    const d = decidir(mov({ importeCent: sin.netoCent!, concepto: 'STRIPE' }), ctx({ cobrosPasarela: [sin] }))
    expect(d.confianza).toBe('duda')
    expect(d.falta).toBe('el asiento del cobro de la F-x1 (Eventos Rivas Catering SL)')
    expect(d.destino).toBeNull()
  })

  it('el asiento que se enseña: banco y comisión al debe, la pasarela al haber por lo cobrado, y cuadra', () => {
    const otro = conStripe('s4', '2026-11-05', 2_000, true, 'Colegio Nuestra Señora del Pilar')
    const imp = NETO + otro.netoCent!
    const d = decidir(mov({ importeCent: imp, concepto: 'STRIPE' }), ctx({ cobrosPasarela: [S1, S2, S3, otro] }))
    const m = { importeCent: imp } as Parameters<typeof asientoQueSeCrea>[0]
    const lineas = asientoQueSeCrea(m, d.destino!, '57200001')!
    expect(lineas).toEqual([
      { cuenta: '57200001', debeCent: imp, haberCent: 0 },
      { cuenta: '62600000', debeCent: COMISION + otro.comisionCent!, haberCent: 0 },
      { cuenta: STRIPE_POR_ABONAR, debeCent: 0, haberCent: 14_000 },
    ])
    expect(lineas.reduce((t, l) => t + l.debeCent - l.haberCent, 0)).toBe(0)
  })
})
