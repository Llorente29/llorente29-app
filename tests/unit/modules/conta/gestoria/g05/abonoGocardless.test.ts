// G05 · nº 43 · Casar en Bancos el ingreso de GoCardless con su pago (payout):
// lib/conciliacion.ts, abonoDeGocardless y su rama del motor. Datos inventados (T11).
//   · El neto exacto, el día de llegada (o 4 días alrededor) y el banco nombra a
//     GoCardless: «seguro», se casa solo.
//   · Sin nombrarlo, o con dos pagos iguales esos días: para confirmar.
//   · Otro importe, o lejos del día de llegada: nada.
//   · Cada pago se casa una sola vez.
//   · El asiento que se enseña: el banco al debe contra la cuenta puente (57200002), por el neto.
import { describe, expect, it } from 'vitest'
import { abonoDeGocardless, conciliar, type AbonoGocardless, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'
import { asientoQueSeCrea, PILDORA } from '@/modules/conta/lib/conciliarVista'

const BANCO = 'cta-banco'
const ctx = (p: Partial<Contexto> = {}): Contexto => ({
  cuentas: [{ id: BANCO, nombre: 'Banco de prueba', cuenta: '57200000' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [],
  liquidaciones: [], plataformas: [], nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
  nombres: {}, cuentas626: '62600000', cuentas476: '47600000', ...p,
})
let n = 0
const mov = (p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento =>
  ({ id: `m${++n}`, cuentaId: BANCO, fecha: '2026-12-06', conceptoComun: null, referencias: [], antesDelCorte: false, ...p })
const pago = (id: string, llegada: string, netoCent: number, cobros = 21): AbonoGocardless => ({ id, llegada, netoCent, referencia: `PRUEBA-${id}`, cuenta: '57200002', cobros })

describe('G05 · nº 43 · el ingreso de GoCardless en Bancos', () => {
  it('neto exacto, su día y el banco nombra a GoCardless: seguro', () => {
    const a = abonoDeGocardless(mov({ importeCent: 310490, concepto: 'TRANSF GOCARDLESS LTD' }), [pago('PO1', '2026-12-06', 310490)])
    expect(a).toMatchObject({ abono: { id: 'PO1' }, confianza: 'seguro', que: 'Ingreso de GoCardless del 06/12 · 21 cobros' })
    expect(a!.porque).toBe('Pago de GoCardless con 21 cobros, que llegaba el 06/12: 3.104,90 € netos, exactos. Se casa solo.')
  })

  it('con su referencia también vale; sin nombrarlo, o con dos iguales, para confirmar', () => {
    expect(abonoDeGocardless(mov({ importeCent: 310490, concepto: 'TRANSFERENCIA', referencias: ['PRUEBA-PO1'] }), [pago('PO1', '2026-12-06', 310490)])?.confianza).toBe('seguro')
    const sin = abonoDeGocardless(mov({ importeCent: 310490, concepto: 'TRANSFERENCIA RECIBIDA' }), [pago('PO1', '2026-12-06', 310490)])
    expect(sin).toMatchObject({ confianza: 'probable' })
    expect(sin!.porque).toMatch(/El banco no nombra a GoCardless: confírmalo\.$/)
    const dos = abonoDeGocardless(mov({ importeCent: 310490, concepto: 'GOCARDLESS' }), [pago('PO1', '2026-12-05', 310490), pago('PO2', '2026-12-06', 310490)])
    expect(dos).toMatchObject({ abono: { id: 'PO2' }, confianza: 'probable' })
  })

  it('otro importe, un gasto o lejos del día de llegada: nada', () => {
    expect(abonoDeGocardless(mov({ importeCent: 310491, concepto: 'GOCARDLESS' }), [pago('PO1', '2026-12-06', 310490)])).toBeNull()
    expect(abonoDeGocardless(mov({ importeCent: -310490, concepto: 'GOCARDLESS' }), [pago('PO1', '2026-12-06', 310490)])).toBeNull()
    expect(abonoDeGocardless(mov({ importeCent: 310490, concepto: 'GOCARDLESS', fecha: '2026-12-15' }), [pago('PO1', '2026-12-06', 310490)])).toBeNull()
  })

  it('el motor lo casa solo, cada pago una vez, y el asiento es el banco contra la 57200002', () => {
    const m1 = mov({ importeCent: 15730, concepto: 'GOCARDLESS SEPA PAYOUT' }), m2 = mov({ importeCent: 15730, concepto: 'GOCARDLESS SEPA PAYOUT' })
    const ds = conciliar([m1, m2], ctx({ abonosGocardless: [pago('PO9', '2026-12-06', 15730, 1)] }))
    const d1 = ds.find((d) => d.movimientoId === m1.id)!, d2 = ds.find((d) => d.movimientoId === m2.id)!
    expect(d1).toMatchObject({ confianza: 'seguro', origen: 'gocardless', destino: { tipo: 'abono_gocardless', payout: 'PO9', cuenta_puente: '57200002' } })
    expect(d2.destino && 'payout' in d2.destino ? d2.destino.payout : null).toBeNull()
    expect(PILDORA.gocardless).toBe('GoCardless')
    const lineas = asientoQueSeCrea({ importeCent: 15730 } as Parameters<typeof asientoQueSeCrea>[0], d1.destino!, '57200000')
    expect(lineas).toEqual([{ cuenta: '57200000', debeCent: 15730, haberCent: 0 }, { cuenta: '57200002', debeCent: 0, haberCent: 15730 }])
  })
})
