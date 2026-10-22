// tests/unit/modules/conta/conciliarVistaB02.test.ts
//
// B02 · tarea 4: lo que enseña «Bancos · Conciliar» (N17b). Lo principal: el
// cuadre, la barra, la banda y los contadores de las bandejas salen de UNA
// cuenta y no pueden decir cosas distintas; se comprueba con todos los
// estados que puede tener un movimiento, y contando las filas que enseña cada
// bandeja con la misma vara (regla 31).

import { describe, expect, it } from 'vitest'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import {
  BANDEJAS, asientoQueSeCrea, bandejaDe, coincide, confirmable, cuadreDe, destinoDelReparto, diaConNombre, facturasDe, importeBuscado, porDia,
  preseleccionado, puntoDePartida, quienEs, repartir, saldoDelExtractoA, textoBloque, textoDelBanco, type ExtractoSaldos, type FacturaParaCasar,
} from '@/modules/conta/lib/conciliarVista'

let n = 0
function mov(p: Partial<MovimientoBanco> = {}): MovimientoBanco {
  n++
  return {
    id: `m${n}`, cuentaId: 'b1', fecha: '2026-10-13', importeCent: -10_000, conceptoBanco: 'PAGO CON TARJETA · RECARGAS INVENTADAS', conceptoLimpio: 'Recargas inventadas',
    contraparte: 'Recargas Inventadas', tipo: 'PAGO CON TARJETA', estado: 'pendiente', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null,
    ...p,
  }
}
const DESTINO: Destino = { tipo: 'cuenta', concepto: 'Recarga', lineas: [{ cuenta: '40700001', importe: 100 }] }
const propuesto = (p: Partial<MovimientoBanco['propuesta']> = {}, extra: Partial<MovimientoBanco> = {}) =>
  mov({ estado: 'propuesto', confianza: 'probable', porque: 'Por la regla', propuesta: { que: 'Recarga de saldo', destino: DESTINO as never, origen: 'regla', ...p }, ...extra })
const casado = (porQuien: 'folvy' | 'persona') => mov({ estado: 'casado', casado: { id: `c${n}`, tipo: 'cuenta', porque: 'Casado solo: por la regla', porQuien, asientoId: 'a1', asientoConcepto: 'Recarga' } })

// Un mes con un movimiento de cada estado y forma: lo que puede llegar a la pantalla.
const MES: MovimientoBanco[] = [
  propuesto({ preseleccionar: true }), propuesto({ preseleccionar: true }), propuesto({ preseleccionar: false }),
  propuesto({ preseleccionar: true, facturaSinAprobar: true }), propuesto({ preseleccionar: true, pideTicket: true }),
  propuesto({ preseleccionar: true, alternativas: [{ etiqueta: 'Traspaso desde Banco 2', destino: {} }] }),
  mov({ estado: 'por_aclarar', porque: 'No sé qué es' }), mov({ estado: 'pendiente' }), mov({ estado: 'posible_repetido' }),
  casado('folvy'), casado('folvy'), casado('persona'), mov({ estado: 'ignorado', motivoIgnorado: 'Personal' }), mov({ estado: 'antes_corte_sin_pareja' }),
]

describe('el cuadre, la barra, la banda y las bandejas dicen lo mismo', () => {
  const c = cuadreDe(MES, 50_000, 30_000, '2026-10')
  it('cada contador es el número de filas que enseña su bandeja', () => {
    for (const b of BANDEJAS) {
      const filas = MES.filter((m) => b.id === 'todos' || bandejaDe(m) === b.id)
      expect(c.cuenta[b.id], b.nombre).toBe(filas.length)
    }
  })
  it('la banda usa las mismas cifras que la barra', () => {
    expect(c.cuenta).toEqual({ confirmar: 6, aclarar: 3, validar: 0, casados: 2, todos: 14 })
    expect(c.frase).toBe('He casado yo 2 de 14 movimientos de octubre. Te quedan 6 por confirmar y 3 por aclarar.')
  })
  it('en el banco − en contabilidad = te falta por casar', () => {
    expect(c.faltaCent).toBe(20_000)
    expect(cuadreDe(MES, null, 30_000, '2026-10').faltaCent).toBeNull()
  })
  it('lo casado por una persona solo está en «Todos»; lo apartado y lo de antes del corte, también', () => {
    expect(MES.filter((m) => bandejaDe(m) === null).map((m) => m.estado)).toEqual(['casado', 'ignorado', 'antes_corte_sin_pareja'])
  })
})

describe('el punto verde y el bloque', () => {
  it('viene marcado solo lo que se puede confirmar tal cual, y nunca una factura sin aprobar', () => {
    const c = cuadreDe(MES, null, null, '2026-10')
    expect(c.preseleccionados).toEqual([MES[0].id, MES[1].id])
    expect(preseleccionado(MES[3])).toBe(false) // factura sin aprobar
    expect(preseleccionado(MES[4])).toBe(false) // falta el ticket
    expect(preseleccionado(MES[5])).toBe(false) // hay que elegir entre dos
    expect(confirmable(MES[2])).toBe(true)
    expect(confirmable(MES[6])).toBe(false)
  })
  it('«24 seguros seleccionados · Confirmar los 24»; si se quita o añade uno, ya no son «los seguros»', () => {
    const seguros = Array.from({ length: 24 }, (_, i) => `s${i}`)
    expect(textoBloque(seguros, seguros)).toEqual({ etiqueta: '24 seguros seleccionados', boton: 'Confirmar los 24', seguros: true })
    expect(textoBloque(seguros.slice(1), seguros)).toEqual({ etiqueta: '23 seleccionados', boton: 'Confirmar los 23', seguros: false })
    expect(textoBloque(['x'], [])).toEqual({ etiqueta: '1 seleccionado', boton: 'Confirmar el 1', seguros: false })
  })
})

describe('nunca una fila sin nombre', () => {
  it('si el banco solo trae su etiqueta (va al tipo), la fila y el panel la enseñan', () => {
    const soloEtiqueta = mov({ conceptoBanco: '', conceptoLimpio: '', contraparte: null, tipo: 'RECARGA MONEDERO INVENTADO' })
    expect(quienEs(soloEtiqueta)).toBe('RECARGA MONEDERO INVENTADO')
    expect(textoDelBanco(soloEtiqueta)).toBe('RECARGA MONEDERO INVENTADO')
    expect(quienEs(mov({ conceptoBanco: '', conceptoLimpio: '', contraparte: null, tipo: null }))).toBe('Sin texto del banco')
  })
})

describe('el buscador: por nombre, importe o concepto', () => {
  const m = mov({ importeCent: -123_456, contraparte: 'Almacenes del Sur SL', conceptoBanco: 'RECIBO · ALMACENES DEL SUR SL · REF 99' })
  it.each([['almacenes', true], ['ALMACÉNES', true], ['1.234,56', true], ['1234,56', true], ['-1234.56', true], ['1234', false], ['recibo', true], ['otra cosa', false], ['', true]])(
    '«%s» → %s', (q, sale) => expect(coincide(m, q)).toBe(sale))
  it('lee los importes como se escriben aquí', () => {
    expect(importeBuscado('12,50')).toBe(1250)
    expect(importeBuscado('12.5')).toBe(1250)
    expect(importeBuscado('1.234')).toBe(123_400)
    expect(importeBuscado('100 €')).toBe(10_000)
    expect(importeBuscado('Catcher')).toBeNull()
  })
})

describe('por día, con los iguales seguidos en una fila', () => {
  it('las recargas del mismo día, iguales, van juntas; otro día u otro importe, no', () => {
    const r = (fecha: string, importeCent = -10_000) => propuesto({ preseleccionar: true }, { fecha, importeCent })
    const movs = [r('2026-10-14'), r('2026-10-14'), r('2026-10-13'), r('2026-10-13'), r('2026-10-13'), r('2026-10-13', -5_000), r('2026-10-13')]
    const dias = porDia(movs)
    expect(dias.map((d) => [d.fecha, d.grupos.map((g) => g.ids.length)])).toEqual([['2026-10-14', [2]], ['2026-10-13', [3, 1, 1]]])
  })
  it('lo casado no se junta (cada uno se deshace por su lado)', () => {
    expect(porDia([casado('folvy'), casado('folvy')])[0].grupos).toHaveLength(2)
  })
  it('«Martes 13 de octubre»', () => expect(diaConNombre('2026-10-13')).toBe('Martes 13 de octubre'))
})

const factura = (p: Partial<FacturaParaCasar> = {}): FacturaParaCasar => ({
  id: `f${++n}`, numero: `F-${n}`, fecha: '2026-09-30', totalCent: 24_861, pagadoCent: 0, proveedor: 'Distribuciones Inventadas', alias: ['Distribuciones Inventadas SL'],
  terceroId: 't1', cuentaTercero: '40000001', enRevision: false, ...p,
})
const CUENTAS = { c626: '62600000', c669: '66900000', c769: '76900000' }

describe('el panel: las facturas de la contraparte y lo que queda por casar', () => {
  const pago = mov({ importeCent: -24_861, contraparte: 'Distribuciones Inventadas', conceptoBanco: 'TRANSFERENCIAS · DISTRIBUCIONES INVENTADAS · pago fact' })
  it('solo las de esa contraparte y con algo por pagar', () => {
    const fs = [factura(), factura({ proveedor: 'Otra Casa', alias: [] }), factura({ pagadoCent: 24_861 })]
    expect(facturasDe(pago, fs).map((f) => f.proveedor)).toEqual(['Distribuciones Inventadas'])
  })
  it('justo: queda 0 y el destino es el de bank_casar', () => {
    const f = factura()
    const r = repartir(pago, [f], CUENTAS)
    expect(r).toMatchObject({ quedaPorCasarCent: 0, diferencia: null, noSePuede: null })
    expect(destinoDelReparto([f], r)).toMatchObject({ tipo: 'factura_recibida', facturas: [{ id: f.id, importe: 248.61 }], cuenta_tercero: '40000001' })
  })
  it('varias facturas: cada una hasta lo que le queda; la última, en parte', () => {
    const a = factura({ totalCent: 20_000 }), b = factura({ totalCent: 10_000 })
    const r = repartir(pago, [a, b], CUENTAS)
    expect(r.facturas).toEqual([{ id: a.id, importeCent: 20_000, quedaCent: 0 }, { id: b.id, importeCent: 4_861, quedaCent: 5_139 }])
    expect(r.noSePuede).toBeNull()
  })
  it('pagas de más un poco: diferencia a la 669 (a la 626 si el banco dice comisión); de más mucho: no se deja', () => {
    expect(repartir(pago, [factura({ totalCent: 24_661 })], CUENTAS).diferencia).toEqual({ cuenta: '66900000', importeCent: 200, concepto: 'Diferencia del pago a Distribuciones Inventadas' })
    const conComision = { ...pago, conceptoBanco: `${pago.conceptoBanco} COMISION` }
    expect(repartir(conComision, [factura({ totalCent: 24_661 })], CUENTAS).diferencia?.cuenta).toBe('62600000')
    expect(repartir(pago, [factura({ totalCent: 20_000 })], CUENTAS).noSePuede).toBe('Quedan 48,61 € sin factura: elige otra, o apunta el pago sin factura.')
  })
  it('pagas de menos un poco: se puede cerrar la factura con la diferencia a la 769', () => {
    const f = factura({ totalCent: 25_000 })
    const parte = repartir(pago, [f], CUENTAS)
    expect(parte).toMatchObject({ sePuedeCerrar: true, diferencia: null, facturas: [{ importeCent: 24_861, quedaCent: 139 }] })
    const cerrada = repartir(pago, [f], CUENTAS, true)
    expect(cerrada).toMatchObject({ diferencia: { cuenta: '76900000', importeCent: -139 }, facturas: [{ importeCent: 25_000, quedaCent: 0 }] })
    // bank_casar: lo de las facturas más la diferencia es el movimiento.
    const d = destinoDelReparto([f], cerrada) as Extract<Destino, { tipo: 'factura_recibida' }>
    expect(Math.round((d.facturas[0].importe + d.diferencia!.importe) * 100)).toBe(24_861)
  })
  it('no se deja mezclar proveedores ni casar sin cuenta de proveedor', () => {
    expect(repartir(pago, [factura({ totalCent: 10_000 }), factura({ totalCent: 20_000, cuentaTercero: '40000002' })], CUENTAS).noSePuede).toBe('Las facturas son de proveedores distintos: elige las de uno.')
    expect(repartir(pago, [factura({ cuentaTercero: null })], CUENTAS).noSePuede).toBe('Distribuciones Inventadas no tiene su cuenta de proveedor: dala de alta en su ficha.')
  })
})

describe('«Ver el asiento que se crea»: cuadra, y el banco va a su lado', () => {
  const sale = mov({ importeCent: -24_861 })
  const entra = mov({ importeCent: 24_861 })
  const cuadra = (ls: { debeCent: number; haberCent: number }[]) => ls.reduce((t, l) => t + l.debeCent - l.haberCent, 0)
  const DESTINOS: [string, MovimientoBanco, Destino][] = [
    ['factura', sale, { tipo: 'factura_recibida', facturas: [{ id: 'f', importe: 246.61 }], cuenta_tercero: '40000001', tercero_id: null, concepto: 'x', diferencia: { cuenta: '66900000', importe: 2, concepto: 'x' } }],
    ['factura de menos', sale, { tipo: 'factura_recibida', facturas: [{ id: 'f', importe: 250 }], cuenta_tercero: '40000001', tercero_id: null, concepto: 'x', diferencia: { cuenta: '76900000', importe: -1.39, concepto: 'x' } }],
    ['liquidación', entra, { tipo: 'liquidacion', liquidacion_id: 'l', cuenta_cliente: '43000001', tercero_id: null, concepto: 'x' }],
    ['traspaso', entra, { tipo: 'traspaso', otro_movimiento_id: 'o', concepto: 'x' }],
    ['cuenta, pago', sale, { tipo: 'cuenta', concepto: 'x', lineas: [{ cuenta: '62800000', importe: 248.61 }] }],
    ['cuenta, cobro', entra, { tipo: 'cuenta', concepto: 'x', lineas: [{ cuenta: '57200002', importe: 248.61 }] }],
  ]
  it.each(DESTINOS)('%s', (_, m, d) => {
    const ls = asientoQueSeCrea(m, d, '57200001', '57200002')!
    expect(cuadra(ls)).toBe(0)
    expect(ls[0]).toEqual({ cuenta: '57200001', debeCent: m.importeCent > 0 ? 24_861 : 0, haberCent: m.importeCent > 0 ? 0 : 24_861 })
  })
  it('si se enlaza un asiento que ya existe, no se crea ninguno', () => expect(asientoQueSeCrea(sale, { tipo: 'asiento', entry_id: 'e' }, '57200001')).toBeNull())
})

describe('de dónde parte el cuadre: con fecha de corte, del saldo del extracto (regla de Julio, 16/10)', () => {
  // Las cifras de producción medidas el 16/10 en solo lectura: el extracto de ···4525 empieza el 01/10
  // con 0,01 € y su 572 dice 290,01 € a 30/09 (la gestoría casi no concilió de enero a septiembre);
  // la 572 ha movido +462,00 € desde el 01/10.
  const ext4525: ExtractoSaldos[] = [{ desde: '2026-10-01', hasta: '2026-10-14', saldoInicialCent: 1, saldoFinalCent: 46_301 }]
  it('···4525: parte de 0,01 € (el extracto), no de 290,01 € (el contable), y lo dice', () => {
    const p = puntoDePartida('2026-10-01', '2026-10-16', ext4525, 29_001, 29_001 + 46_200)
    expect(p.libroCent).toBe(1 + 46_200)
    expect(p.apertura).toEqual({ fecha: '2026-09-30', bancoCent: 1, contableCent: 29_001,
      frase: 'Parto del saldo del extracto a 30/09 (0,01 €), no del contable (290,01 €): hasta esa fecha la contabilidad está cerrada y casi sin conciliar.' })
  })
  it('···6536: el extracto y el contable coinciden (105,58 €): el mismo número, y también lo dice', () => {
    const p = puntoDePartida('2026-10-01', '2026-10-16', [{ desde: '2026-10-01', hasta: '2026-10-14', saldoInicialCent: 10_558, saldoFinalCent: 47_919 }], 10_558, 10_558 + 307_661)
    expect(p.libroCent).toBe(10_558 + 307_661)
    expect(p.apertura?.frase).toBe('Parto del saldo del extracto a 30/09 (105,58 €), que coincide con el contable.')
  })
  it('sin el extracto que empieza el día del corte (ni uno que acabe la víspera), parte del contable y pide el extracto', () => {
    const p = puntoDePartida('2026-10-01', '2026-10-16', [{ desde: '2026-10-05', hasta: '2026-10-14', saldoInicialCent: 0, saldoFinalCent: 0 }], 29_001, 75_201)
    expect(p.libroCent).toBe(75_201)
    expect(p.apertura?.frase).toBe('No tengo el saldo del extracto a 30/09: parto del contable (290,01 €). Sube el extracto que empieza el 01/10.')
  })
  it('un extracto que acaba la víspera también vale', () => {
    expect(saldoDelExtractoA([{ desde: '2026-09-01', hasta: '2026-09-30', saldoInicialCent: 0, saldoFinalCent: 1 }], '2026-09-30')).toBe(1)
  })
  it('sin fecha de corte, o con el cuadre antes del corte, el contable de siempre y sin frase', () => {
    expect(puntoDePartida(null, '2026-10-16', ext4525, 29_001, 75_201)).toEqual({ libroCent: 75_201, apertura: null })
    expect(puntoDePartida('2026-10-01', '2026-09-30', ext4525, 29_001, 29_001)).toEqual({ libroCent: 29_001, apertura: null })
  })
})
