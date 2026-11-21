// tests/unit/modules/conta/erp10/dias.test.ts
//
// X08 · Los días del TPV salen a ERP10 (respuestas X08 · 3 y X08 · 4, 19/11): cada día, UNA
// factura expedida por día y local (el resumen del día: el cliente es «Clientes de contado», el
// rango seguido en el «Resumen de facturas», Campo069 a 071) y su cobro aparte, en el fichero de
// asientos (cada cuenta a la que va lo cobrado, contra «Clientes de contado»). Celda a celda, con
// las columnas de XML_EXPEDIDAS y XML_ASIENTOS (no escritas a mano), y lo que no sale, con su
// frase. Datos inventados y que se ven inventados (T11).

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnas } from '../../../../../supabase/functions/_shared/diezExcel.ts'
import {
  FRASE_SIN_CONTADO, FRASE_SIN_RANGO, columnasAsientos, leerDia, prepararAsientos, prepararDiasTpv, type CuentaContado, type DiaParaErp10, type LineaDia,
} from '@/modules/conta/erp10/ficheros'
import { XML_EXPEDIDAS } from '@/modules/conta/erp10/configuracion'
import { armarSalida, prepararDescarga, soloUna } from '@/modules/conta/erp10/salida'
import { comparar, type Comprobar } from '@/modules/conta/erp10/comparar'
import { SIN_ASIENTOS, aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas } from '@/modules/conta/services/erp10Service'

const PLAN = new Map(Object.entries({
  '57000000': '570', '57200001': '572', '43000001': '4300', '43000002': '4300', '43000099': '4300', '70000000': '700', '70000001': '700', '47700000': '477', '47700021': '477',
}))
const OPC = { plan: PLAN, largo: 8 }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CONTADO: CuentaContado[] = [{ codigo: '43000099', plantilla: '4300', nombre: 'Clientes de contado' }]
const L = (cuenta: string, debe: number, haber: number, iva?: [number, number]): LineaDia =>
  ({ cuenta, plantilla: PLAN.get(cuenta) ?? '', nombre: `Cuenta inventada ${cuenta}`, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, libro: iva ? 'issued' : null })
/** Un día de Revo: 300 cobrados en caja y 250 por Glovo; 500 de ventas al 10 %. */
const dia = (n: number, o: Partial<DiaParaErp10> = {}): DiaParaErp10 => ({
  entryId: id(n), serie: 1, numero: n, fecha: '2026-10-05', concepto: 'Ventas del día · TPV Revo', origen: 'revo', local: 'Revo', localId: null,
  primero: '5001', ultimo: '5048', facturas: 48, contadores: 1,
  lineas: [L('57000000', 300, 0), L('43000001', 250, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)],
  ...o,
})
const celdas = (fila: (string | number)[]) => Object.fromEntries(fila.flatMap((v, i) => (v === '' ? [] : [[XLSX.utils.encode_col(i), v]])))
const F = (d: string) => `${d}T12:00:00.000Z`
const letraE = (campo: string) => XLSX.utils.encode_col(columnas(XML_EXPEDIDAS)[campo] - 1)
const letraA = (campo: string) => XLSX.utils.encode_col(columnasAsientos()[campo] - 1)

describe('La configuración de expedidas, con el resumen de facturas', () => {
  it('N.º facturas (069), primer número (070) y último (071), en AJ, AK y AL; la I (nº factura) existe y en el día va vacía', () => {
    expect(['069', '070', '071', '006'].map(letraE)).toEqual(['AJ', 'AK', 'AL', 'I'])
  })
})

describe('Un día con un solo cliente (lo cobrado en una cuenta)', () => {
  it('la factura del día, celda a celda: fecha E, «Clientes de contado» G, total AB, I.V.A. J-L, ventas AA/AC, rango AJ-AL; sin número ni PDF', () => {
    const d = dia(1, { lineas: [L('43000001', 550, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)] })
    const r = prepararDiasTpv([d], CONTADO, OPC)
    expect(r.noSalen).toEqual([])
    expect(celdas(r.dias[0].fila)).toEqual({ E: F('2026-10-05'), G: '43000099', J: 500, K: 10, L: 50, AA: '70000000', AB: 550, AC: 500, AJ: 48, AK: '5001', AL: '5048' })
    expect(r.dias[0].numero).toBe('5001–5048')
  })
  it('su cobro, un asiento de dos apuntes: la 430 de la plataforma al debe, «Clientes de contado» al haber, el mismo día', () => {
    const d = dia(1, { lineas: [L('43000001', 550, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)] })
    const a = prepararAsientos(prepararDiasTpv([d], CONTADO, OPC).dias.map((x) => x.cobro), OPC)
    const f = a.asientos[0].filas.map(celdas)
    expect(f.map((x) => [x[letraA('005')] ?? null, x[letraA('008')] ?? null, x[letraA('010')] ?? null, x[letraA('013')] ?? null])).toEqual([
      ['43000001', 550, null, null], [null, null, '43000099', 550],
    ])
    expect(f.every((x) => x[letraA('002')] === F('2026-10-05') && x[letraA('001')] === 1)).toBe(true)
    expect(f[0][letraA('007')]).toBe('Cobro de las ventas del 05/10/2026 · Revo')
  })
})

describe('Un día con tres clientes y dos tipos de I.V.A.', () => {
  const d = dia(2, {
    lineas: [L('57000000', 200, 0), L('43000001', 130, 0), L('43000002', 121, 0),
      L('47700000', 0, 30, [10, 300]), L('47700021', 0, 21, [21, 100]), L('70000000', 0, 300), L('70000001', 0, 100), L('57200001', 0.0, 0)],
  })
  const r = prepararDiasTpv([d], CONTADO, OPC)
  it('una sola factura del día: los dos tipos en J-L y M-O, dos cuentas de ventas en AA/AC y AD/AE, el total de los tres cobros', () => {
    expect(celdas(r.dias[0].fila)).toEqual({
      E: F('2026-10-05'), G: '43000099', J: 300, K: 10, L: 30, M: 100, N: 21, O: 21, AA: '70000000', AB: 451, AC: 300, AD: '70000001', AE: 100, AJ: 48, AK: '5001', AL: '5048',
    })
  })
  it('el cobro: cada cuenta al debe (caja, Glovo, Uber) y «Clientes de contado» al haber por el total; cuadra', () => {
    const a = prepararAsientos([r.dias[0].cobro], OPC).asientos[0].filas.map(celdas)
    expect(a.map((x) => x[letraA('005')] ?? x[letraA('010')])).toEqual(['57000000', '43000001', '43000002', '43000099'])
    expect(a.reduce((t, x) => t + Math.round(Number(x[letraA('008')] ?? 0) * 100) - Math.round(Number(x[letraA('013')] ?? 0) * 100), 0)).toBe(0)
  })
})

describe('Las ventas cobradas en caja: con cliente de contado y sin él', () => {
  it('con «Clientes de contado», la caja va en el cobro como una cuenta más', () => {
    const r = prepararDiasTpv([dia(3)], CONTADO, OPC)
    expect(r.dias[0].cobro.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['57000000', 300, 0], ['43000001', 250, 0], ['43000099', 0, 550]])
  })
  it('sin «Clientes de contado», el día no sale, y dice dónde se elige', () => {
    expect(leerDia(dia(3), [])).toMatchObject({ porque: FRASE_SIN_CONTADO })
    expect(FRASE_SIN_CONTADO).toBe('Falta la cuenta de Clientes de contado: ponla en A qué cuenta va cada forma de pago.')
  })
  it('con dos cuentas «de contado», no elige: no sale, y las nombra', () => {
    expect(leerDia(dia(3), [...CONTADO, { codigo: '43000098', plantilla: '4300', nombre: 'Clientes contado 2' }]))
      .toMatchObject({ porque: 'Hay 2 cuentas de Clientes de contado (43000099, 43000098): deja una. No sale.' })
  })
  it('una devolución en caja (la caja en negativo) va al haber del cobro', () => {
    const r = prepararDiasTpv([dia(4, { lineas: [L('57000000', 0, 20), L('43000001', 570, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)] })], CONTADO, OPC)
    expect(r.dias[0].cobro.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['57000000', 0, 20], ['43000001', 570, 0], ['43000099', 0, 550]])
  })
})

describe('El número: el rango del día, en sus campos', () => {
  it('de una sola factura, el rango es ese número', () => {
    expect(prepararDiasTpv([dia(5, { primero: '5001', ultimo: '5001', facturas: 1 })], CONTADO, OPC).dias[0].numero).toBe('5001')
  })
  it('sin rango (el TPV de Folvy hoy), no sale: «Falta el rango de facturas del día»', () => {
    expect(leerDia(dia(6, { origen: 'folvy', primero: null, ultimo: null }), CONTADO)).toMatchObject({ porque: FRASE_SIN_RANGO })
    expect(FRASE_SIN_RANGO).toBe('Falta el rango de facturas del día.')
  })
  it('con dos contadores del TPV (dos rangos), no los junta: no sale', () => {
    expect(leerDia(dia(7, { contadores: 2 }), CONTADO))
      .toMatchObject({ porque: 'Lleva facturas de 2 contadores del TPV, con un rango cada uno, y la factura del día lleva uno: no se juntan. No sale.' })
  })
  it('el mismo día y local en dos asientos (uno por plataforma): ninguno sale, porque la factura es una por día y local', () => {
    const r = prepararDiasTpv([dia(8, { origen: 'folvy', localId: 'L1', local: 'Local inventado' }), dia(9, { origen: 'folvy', localId: 'L1', local: 'Local inventado' })], CONTADO, OPC)
    expect(r.dias).toEqual([])
    expect(r.noSalen.map((x) => x.porque)).toEqual([
      'Ese día y ese local van en 2 asientos (uno por plataforma), y la factura del día es una por día y local. No sale.',
      'Ese día y ese local van en 2 asientos (uno por plataforma), y la factura del día es una por día y local. No sale.',
    ])
  })
})

describe('Las contrapartidas: las cuentas de ventas del asiento del día', () => {
  it('hasta cuatro; con cinco, no sale y lo dice', () => {
    const cinco = [1, 2, 3, 4, 5].map((k) => L(`7000000${k}`, 0, 100))
    expect(leerDia(dia(10, { lineas: [L('57000000', 550, 0), L('47700000', 0, 50, [10, 500]), ...cinco] }), CONTADO))
      .toMatchObject({ porque: 'Reparte las ventas en 5 cuentas y ERP10 admite 4 al importar. No sale.' })
  })
  it('las ventas que no suman la base del I.V.A. no salen', () => {
    expect(leerDia(dia(11, { lineas: [L('57000000', 550, 0), L('47700000', 0, 50, [10, 400]), L('70000000', 0, 500)] }), CONTADO))
      .toMatchObject({ porque: 'Las cuentas de ingreso no suman las bases del IVA. No sale.' })
  })
})

describe('En la salida del mes (armarSalida)', () => {
  const partida = (n: number, o: Record<string, unknown> = {}) => ({
    entry_id: id(n), serie: 1, numero: n, fecha: '2026-10-05', concepto: 'Ventas del día inventado', origen: 'sales_day', clase: 'emitida', importe: 550, base_iva: 500,
    numero_factura: null, nif: null, tercero: null, cuentas_base: 1, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
  })
  const ps = aPorSalir({ mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [
    partida(1), partida(2, { fecha: '2026-10-06' }),
    // Un día no validado o anulado no llega: conta_erp10_por_salir solo da lo validado (la X02). Uno que no sale, sí llega, con su porqué.
    partida(3, { fecha: '2026-10-07', sale: false, avisos: ['Cae en un trimestre de IVA ya presentado: no sale.'] }),
  ] })
  const ds = aDias({
    dias: [
      { ...dia(1), lineas: dia(1).lineas },
      { ...dia(2, { fecha: '2026-10-06', origen: 'folvy', primero: null, ultimo: null, local: 'Local inventado', localId: 'L1' }) },
    ],
    contado: CONTADO, cuentas: [...PLAN].map(([codigo, plantilla]) => ({ codigo, plantilla, nombre: `Cuenta inventada ${codigo}` })), yaSalidas: {},
  })
  const s = armarSalida(ps, aRecibidas({ recibidas: [], cuentas: [], yaSalidas: {} }), aEmitidas({ emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] }), 'C:\\Sumied\\0007\\', SIN_ASIENTOS, ds)

  it('la fila de los días: cuántos salen, cuántas facturas del TPV, su importe, y los que no pueden salir', () => {
    expect(s.filas.find((f) => f.id === 'tpv')).toEqual({ id: 'tpv', que: 'Días de ventas del TPV', cuantos: 1, importe: 550, sale: true, estado: 'Mira esto',
      texto: '48 facturas del TPV, una factura por día · 2 no pueden salir' })
    expect(s.listas.tpv).toEqual([{ entryId: id(1), fecha: '2026-10-05', local: 'Revo', rango: '5001–5048', facturas: 48, importe: 550 }])
    expect(s.noPuedenSalir.filter((x) => x.clase === 'dia').map((x) => [x.fecha, x.quien, x.porque])).toEqual([
      ['2026-10-06', 'Local inventado', 'Falta el rango de facturas del día.'],
      ['2026-10-07', 'Día de ventas', 'Cae en un trimestre de IVA ya presentado: no sale.'],
    ])
    expect(s.comprobaciones).toEqual(['Cada día lleva su rango de facturas', 'Cada cobro cuadra con su día'])
  })
  it('el cobro va con los asientos, pero no cuenta como asiento (la fila «Asientos» sigue a 0)', () => {
    expect(s.filas.find((f) => f.id === 'asientos')).toMatchObject({ cuantos: 0, importe: 0 })
    expect(s.ficheros.asientos.map((a) => a.entryId)).toEqual([id(1)])
  })
  it('la descarga: dias-tpv.xlsx detrás de las subcuentas y su cobro en asientos.xlsx; el día se apunta una vez, como emitida', async () => {
    const d = await prepararDescarga(s)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['subcuentas.xlsx', 4], ['dias-tpv.xlsx', 1], ['asientos.xlsx', 3]])
    expect(d.partidas.map((p) => [p.entry_id, p.clase])).toEqual([[id(1), 'emitida']])
  })
  it('volver a sacar solo ese día: su fila y su cobro, sin subcuentas', async () => {
    const una = soloUna(s, id(1))!
    const d = await prepararDescarga(una)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['dias-tpv.xlsx', 1], ['asientos.xlsx', 3]])
    expect(una.totalDias).toBe(550)
  })
  it('en el paso 3, un día que no puede salir cuenta como «no sale por aquí», no como un fallo de la salida', () => {
    const base: Comprobar = {
      fecha: '2026-10-31', ejercicio: { desde: '2026-01-01', hasta: '2026-12-31' }, desde: '2026-10-01', codigo: '0007', largo: 8,
      saldos: [{ codigo: '43000099', plantilla: '4300', nombre: 'Clientes de contado', saldo: 550, erp: '43000099' }, { codigo: '70000000', plantilla: '700', nombre: 'Ventas', saldo: -550, erp: '70000000' }],
      asientos: [{ entryId: id(2), serie: 1, numero: 2, fecha: '2026-10-06', concepto: 'Ventas del día', origen: 'sales_day', estado: 'validado', deshace: null, factura: null, tercero: null,
        salida: null, aMano: null, lineas: [{ cuenta: '43000099', importe: 550 }, { cuenta: '70000000', importe: -550 }] }],
      lotes: [], igualado: null,
    }
    const noSaleAqui = new Set(s.noPuedenSalir.filter((x) => x.clase === 'dia').map((x) => x.entryId))
    const r = comparar([], base, { porSacar: new Set(), noPueden: new Map(s.noPuedenSalir.map((x) => [x.entryId, x.porque])), noSaleAqui })
    expect(r.noSale.map((x) => x.cuenta).sort()).toEqual(['43000099', '70000000'])
    expect(r.igualable).toBe(true)
  })
})

// R07 (respuesta R07 · 1, 20/11): desde que la empresa elige la cuenta de la factura del día, el día
// va en dos asientos del diario: la factura del día («Clientes de contado» al debe) y su cobro. La
// expedida sale igual, de la factura; el cobro sale con los asientos, solo junto a su factura. La
// misma vara que el día de antes (un asiento): la misma fila de expedidas y los mismos apuntes.
describe('R07 · El día en dos asientos: la factura del día y su cobro', () => {
  const COBRO = id(91)
  /** El mismo día que `dia(1)` (300 en caja, 250 por Glovo), ya partido por Sumied. */
  const factura = (o: Partial<DiaParaErp10> = {}) => dia(1, {
    concepto: 'Factura del día · TPV Revo · tickets 5001 a 5048', cobroId: COBRO,
    lineas: [L('43000099', 550, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)], ...o,
  })
  const cobro = (o: Record<string, unknown> = {}) => ({
    entryId: COBRO, serie: 1, numero: 92, fecha: '2026-10-05', concepto: 'Cobro del día · TPV Revo', origen: 'sales_day_payment',
    lineas: [
      { cuenta: '57000000', plantilla: '570', nombre: 'Caja inventada', concepto: 'Cobra Efectivo', debe: 300, haber: 0 },
      { cuenta: '43000001', plantilla: '4300', nombre: 'Glovo inventado', concepto: 'Cobra Glovo', debe: 250, haber: 0 },
      { cuenta: '43000099', plantilla: '4300', nombre: 'Clientes de contado', concepto: 'El cobro del día · Clientes de contado', debe: 0, haber: 550 },
    ], ...o,
  })
  const partida = (entryId: string, o: Record<string, unknown> = {}) => ({
    entry_id: entryId, serie: 1, numero: 1, fecha: '2026-10-05', concepto: 'Inventado', origen: 'sales_day', clase: 'emitida', importe: 550, base_iva: 500,
    numero_factura: null, nif: null, tercero: null, cuentas_base: 1, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
  })
  const cuentas = [...PLAN].map(([codigo, plantilla]) => ({ codigo, plantilla, nombre: `Cuenta inventada ${codigo}` }))
  const salida = (dias: DiaParaErp10[], asientos: Record<string, unknown>[]) => armarSalida(
    aPorSalir({ mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [
      ...dias.map((d) => partida(d.entryId)), ...asientos.map((a) => partida(String(a.entryId), { origen: 'sales_day_payment', clase: 'asiento' })),
    ] }),
    aRecibidas({ recibidas: [], cuentas: [], yaSalidas: {} }), aEmitidas({ emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] }), 'C:\\Sumied\\0007\\',
    aAsientos({ asientos, cuentas, yaSalidas: {} }), aDias({ dias, contado: CONTADO, cuentas, yaSalidas: {} }),
  )

  it('la factura del día: la misma fila de expedidas que el día de un asiento, y sin cobro que armar', () => {
    const antes = prepararDiasTpv([dia(1)], CONTADO, OPC)
    const ahora = prepararDiasTpv([factura()], CONTADO, OPC)
    expect(ahora.noSalen).toEqual([])
    expect(celdas(ahora.dias[0].fila)).toEqual(celdas(antes.dias[0].fila))
    expect(celdas(ahora.dias[0].fila)).toMatchObject({ G: '43000099', AB: 550, AK: '5001', AL: '5048' })
    expect([ahora.dias[0].cobro, ahora.dias[0].cobroId]).toEqual([null, COBRO])
  })
  it('lee el «cobroId» que da la base', () => {
    expect(aDias({ dias: [{ ...factura(), cobroId: COBRO }], contado: CONTADO, cuentas: [], yaSalidas: {} }).dias[0].cobroId).toBe(COBRO)
    expect(aDias({ dias: [dia(1)], contado: CONTADO, cuentas: [], yaSalidas: {} }).dias[0].cobroId).toBeNull()
  })
  it('en la salida del mes: la factura en dias-tpv.xlsx y su cobro en asientos.xlsx, con los mismos apuntes que el cobro armado de antes', () => {
    const antes = salida([dia(1)], [])
    const ahora = salida([factura()], [cobro()])
    expect(ahora.noPuedenSalir).toEqual([])
    expect(ahora.ficheros.dias).toMatchObject([{ entryId: id(1), fila: antes.ficheros.dias[0].fila, cobroId: COBRO }])
    expect(ahora.ficheros.asientos.map((a) => a.entryId)).toEqual([COBRO])
    const apuntes = (x: typeof ahora) => x.ficheros.asientos[0].filas.map(celdas).map((f) => [f[letraA('005')] ?? null, f[letraA('008')] ?? null, f[letraA('010')] ?? null, f[letraA('013')] ?? null])
    expect(apuntes(ahora)).toEqual(apuntes(antes))
    expect(ahora.ficheros.asientos[0].api).toBeUndefined()
    // Va con los días: la fila «Asientos» sigue a 0, y la de los días, igual que antes.
    expect(ahora.filas.find((f) => f.id === 'asientos')).toMatchObject({ cuantos: 0, importe: 0 })
    expect(ahora.filas.find((f) => f.id === 'tpv')).toEqual(antes.filas.find((f) => f.id === 'tpv'))
  })
  it('la descarga apunta la factura como emitida y su cobro como asiento; volver a sacar el día saca los dos', async () => {
    const s = salida([factura()], [cobro()])
    const d = await prepararDescarga(s)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['subcuentas.xlsx', 4], ['dias-tpv.xlsx', 1], ['asientos.xlsx', 3]])
    expect(d.partidas.map((p) => [p.entry_id, p.clase])).toEqual([[COBRO, 'asiento'], [id(1), 'emitida']])
    const una = soloUna(s, id(1))!
    expect((await prepararDescarga(una)).libros.map((l) => [l.nombre, l.filas])).toEqual([['dias-tpv.xlsx', 1], ['asientos.xlsx', 3]])
  })
  it('un cobro del día no sale solo: sin su factura (no sale este mes), no va al fichero y se dice', () => {
    const s = salida([factura({ primero: null, ultimo: null })], [cobro()])
    expect(s.ficheros.asientos).toEqual([])
    expect(s.ficheros.dias).toEqual([])
    expect(s.noPuedenSalir.map((x) => [x.entryId, x.clase, x.porque])).toEqual([
      [id(1), 'dia', 'Falta el rango de facturas del día.'],
      [COBRO, 'dia', 'Es el cobro de un día de ventas: sale junto a su factura del día, y esa no sale.'],
    ])
  })
  it('ni la factura sin su cobro: si su cobro no ha llegado para salir, no sale y lo dice', () => {
    const s = salida([factura()], [])
    expect(s.ficheros.dias).toEqual([])
    expect(s.noPuedenSalir.map((x) => [x.entryId, x.porque])).toEqual([[id(1), 'Su cobro del día no está para salir este mes: la factura del día sale junto a él.']])
  })
  it('una factura del día que lleva a la vez Clientes de contado y lo cobrado no sale', () => {
    const r = prepararDiasTpv([factura({ lineas: [L('43000099', 300, 0), L('57000000', 250, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)] })], CONTADO, OPC)
    expect(r.noSalen.map((x) => x.porque)).toEqual(['La factura del día lleva, además de Clientes de contado (43000099), lo cobrado en 57000000: lo cobrado va en su cobro. No sale.'])
  })
  it('el día de antes (un asiento) sigue como siempre: si cobra en Clientes de contado sin ir en dos, no sale', () => {
    const r = prepararDiasTpv([dia(1, { lineas: [L('43000099', 550, 0), L('47700000', 0, 50, [10, 500]), L('70000000', 0, 500)] })], CONTADO, OPC)
    expect(r.noSalen.map((x) => x.porque)).toEqual(['Cobra en la propia cuenta de Clientes de contado (43000099). No sale.'])
  })
})
