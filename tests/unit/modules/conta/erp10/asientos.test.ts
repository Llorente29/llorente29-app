// tests/unit/modules/conta/erp10/asientos.test.ts
//
// X07 · El fichero de asientos de la salida a ERP10 (asientos.xlsx), con la forma medida en
// los asientos que entraron en ERP10 en el traspaso de octubre (erp10_formatos_de_salida.md,
// sección 15) y las columnas de XML_ASIENTOS (no escritas a mano). Celda a celda: dos
// apuntes, cinco apuntes, varias líneas al debe y una al haber, céntimos, dos asientos el
// mismo día; y la regla de qué sale (2.2 del encargo), cada clase con su frase.
// Datos inventados y que se ven inventados (T11).

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnasAsientos, leerAsiento, libroErp10, prepararAsientos, type AsientoParaErp10, type LineaAsiento } from '@/modules/conta/erp10/ficheros'
import { XML_ASIENTOS } from '@/modules/conta/erp10/configuracion'
import { armarSalida, prepararDescarga } from '@/modules/conta/erp10/salida'
import { aAsientos, aEmitidas, aPorSalir, aRecibidas } from '@/modules/conta/services/erp10Service'
import { abrirExcel, reconocer } from '@/modules/conta/lib/traer'

const COL = columnasAsientos()
const letra = (campo: string) => XLSX.utils.encode_col(COL[campo] - 1)
const PLAN = new Map(Object.entries({
  '57200001': '572', '41000012': '4100', '64000000': '640', '47600000': '476', '46500000': '465', '47510000': '4751', '64200000': '642',
  '55500000': '555', '4100012': '4100',
}))
const OPC = { plan: PLAN, largo: 8 }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const L = (cuenta: string, debe: number, haber: number, concepto: string | null = null): LineaAsiento => ({ cuenta, nombre: `Cuenta inventada ${cuenta}`, concepto, debe, haber })
const asiento = (n: number, fecha: string, lineas: LineaAsiento[], o: Partial<AsientoParaErp10> = {}): AsientoParaErp10 =>
  ({ entryId: id(n), serie: 4, numero: n, fecha, concepto: `Asiento inventado ${n}`, lineas, ...o })
/** La fila como {letra: valor}, sin las vacías. */
const celdas = (fila: (string | number)[]) => Object.fromEntries(fila.flatMap((v, i) => (v === '' ? [] : [[XLSX.utils.encode_col(i), v]])))
const F = (d: string) => `${d}T12:00:00.000Z`

describe('La configuración de asientos', () => {
  it('campo a campo, lo medido en el fichero de octubre: A n.º, B fecha, C a F el debe, G a J el haber, L la serie, Z el n.º de factura', () => {
    expect(Object.fromEntries(Object.keys(COL).sort().map((k) => [k, letra(k)]))).toEqual({
      '001': 'A', '002': 'B', '003': 'L', '005': 'C', '006': 'D', '007': 'E', '008': 'F', '010': 'G', '011': 'H', '012': 'I', '013': 'J', '019': 'Z',
    })
    expect(() => columnasAsientos('<Configuracion></Configuracion>')).toThrow('La configuración de asientos no trae <Configuracion_Asientos>.')
    expect(XML_ASIENTOS).toContain('<Configuracion_Asientos>')
  })
})

describe('Las filas de un asiento, celda a celda', () => {
  it('dos apuntes: dos filas con el mismo número en A, cada una con un solo lado; B la fecha, L la serie 1', () => {
    const r = prepararAsientos([asiento(1, '2026-10-10', [L('41000012', 121, 0, 'Pago A-1402'), L('57200001', 0, 121)])], OPC)
    expect(r.asientos[0].filas.map(celdas)).toEqual([
      { A: 1, B: F('2026-10-10'), C: '41000012', D: 'Cuenta inventada 41000012', E: 'Pago A-1402', F: 121, L: 1 },
      { A: 1, B: F('2026-10-10'), G: '57200001', H: 'Cuenta inventada 57200001', I: 'Asiento inventado 1', J: 121, L: 1 },
    ])
  })
  it('cinco apuntes (una nómina): cinco filas con el mismo número; el concepto del asiento donde la línea no trae', () => {
    const nomina = asiento(2, '2026-10-31', [L('64000000', 1500, 0), L('64200000', 450.27, 0), L('47600000', 0, 545.12), L('47510000', 0, 210.5), L('46500000', 0, 1194.65)],
      { concepto: 'Nómina inventada de octubre' })
    const r = prepararAsientos([nomina], OPC)
    const f = r.asientos[0].filas.map(celdas)
    expect(f).toHaveLength(5)
    expect(f.map((x) => x.A)).toEqual([1, 1, 1, 1, 1])
    expect(f.map((x) => [x.C ?? x.G, x.F ?? null, x.J ?? null])).toEqual([
      ['64000000', 1500, null], ['64200000', 450.27, null], ['47600000', null, 545.12], ['47510000', null, 210.5], ['46500000', null, 1194.65],
    ])
    expect(f.every((x) => x.E === 'Nómina inventada de octubre' || x.I === 'Nómina inventada de octubre')).toBe(true)
  })
  it('varias líneas al debe y una al haber, con céntimos; los importes, siempre en positivo', () => {
    const r = prepararAsientos([asiento(3, '2026-10-12', [L('64000000', 0.01, 0), L('64200000', 99.99, 0), L('57200001', 0, 100)])], OPC)
    expect(r.asientos[0].filas.map(celdas).map((x) => [x.F ?? null, x.J ?? null])).toEqual([[0.01, null], [99.99, null], [null, 100]])
  })
  it('dos asientos el mismo día: en orden de serie y número de Sumied, y numerados 1 y 2; el fichero, igual dos veces', () => {
    const b = asiento(8, '2026-10-05', [L('57200001', 10, 0), L('55500000', 0, 10)])
    const a = asiento(7, '2026-10-05', [L('55500000', 20, 0), L('57200001', 0, 20)])
    const c = asiento(1, '2026-10-06', [L('55500000', 30, 0), L('57200001', 0, 30)])
    const r1 = prepararAsientos([c, b, a], OPC)
    const r2 = prepararAsientos([b, a, c], OPC)
    expect(r1.asientos.map((x) => [x.numero, x.filas.map((f) => celdas(f).A)])).toEqual([['4/7', [1, 1]], ['4/8', [2, 2]], ['4/1', [3, 3]]])
    expect(r2.asientos).toEqual(r1.asientos)
  })
  it('las cuentas, al largo de ERP10; una que no cabe no deja salir el asiento', () => {
    const r = prepararAsientos([asiento(4, '2026-10-05', [L('4100012', 10, 0), L('57200001', 0, 10)])], OPC)
    expect(celdas(r.asientos[0].filas[0]).C).toBe('41000012')
    const no = prepararAsientos([asiento(5, '2026-10-05', [L('41000012345', 10, 0), L('57200001', 0, 10)])], { ...OPC, plan: new Map([...PLAN, ['41000012345', '4100']]) })
    expect(no.noSalen[0].porque).toBe('La cuenta 41000012345 no cabe en ERP10, que usa 8 cifras.')
  })
  it('el libro: una hoja, sin títulos; la fecha como fecha, la cuenta como texto y el importe como número', async () => {
    const r = prepararAsientos([asiento(1, '2026-10-10', [L('41000012', 121, 0), L('57200001', 0, 121)])], OPC)
    const h = XLSX.read(new Uint8Array(await libroErp10(r.asientos.flatMap((a) => a.filas))), { type: 'array', cellDates: true }).Sheets.Hoja1
    expect([h.A1.v, h.B1.t, h.C1.t, h.C1.v, h.F1.t, h.F1.v, h.L1.v, h.A2.v, h.J2.v]).toEqual([1, 'd', 's', '41000012', 'n', 121, 1, 1, 121])
    expect(h.G1).toBeUndefined()
    expect(h.C2).toBeUndefined()
  })
})

describe('Lo que no puede salir como asiento', () => {
  it('uno que no cuadra, uno de un solo apunte y uno con un importe en negativo, cada uno con su frase', () => {
    const porque = (a: AsientoParaErp10) => { const x = leerAsiento(a); return 'porque' in x ? x.porque : null }
    expect(porque(asiento(1, '2026-10-01', [L('57200001', 10, 0), L('55500000', 0, 9.99)]))).toBe('No cuadra: 10 al debe y 9.99 al haber.')
    expect(porque(asiento(2, '2026-10-01', [L('57200001', 10, 0), L('55500000', 0, 0)]))).toBe('No tiene dos apuntes con importe. Míralo en Sumied.')
    expect(porque(asiento(3, '2026-10-01', [L('57200001', -10, 0), L('55500000', 0, -10)]))).toBe('Lleva un importe en negativo, y ERP10 los quiere en positivo. Métela a mano en ERP10.')
  })
})

describe('Qué sale como asiento (2.2 del encargo)', () => {
  const partida = (n: number, clase: string, o: Record<string, unknown> = {}) => ({
    entry_id: id(n), serie: 4, numero: n, fecha: '2026-10-05', concepto: `Inventado ${n}`, origen: 'manual', clase, importe: 100, base_iva: null, numero_factura: null,
    nif: null, tercero: null, cuentas_base: 0, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
  })
  const ps = aPorSalir({ mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [
    partida(1, 'asiento', { origen: 'bank' }), partida(2, 'asiento', { origen: 'payroll' }),
    partida(3, 'asiento', { sale: false, avisos: ['Lleva I.V.A. y no es una factura: métela a mano en ERP10 para que entre en su libro.'] }),
    partida(4, 'emitida', { origen: 'sales_day', numero_factura: null }),
  ] })
  const as = aAsientos({
    asientos: [
      { entryId: id(1), serie: 4, numero: 1, fecha: '2026-10-05', concepto: 'Pago inventado', origen: 'bank',
        lineas: [{ cuenta: '41000012', plantilla: '4100', nombre: 'Proveedor inventado', concepto: null, debe: 100, haber: 0 }, { cuenta: '57200001', plantilla: '572', nombre: 'Banco', concepto: null, debe: 0, haber: 100 }] },
      { entryId: id(2), serie: 4, numero: 2, fecha: '2026-10-05', concepto: 'Nómina inventada', origen: 'payroll',
        lineas: [{ cuenta: '64000000', plantilla: '640', nombre: 'Sueldos', concepto: null, debe: 100, haber: 0 }, { cuenta: '57200001', plantilla: '572', nombre: 'Banco', concepto: null, debe: 0, haber: 100 }] },
    ],
    cuentas: [{ codigo: '41000012', plantilla: '4100', nombre: 'Proveedor inventado', nif: 'B00000000' }, { codigo: '57200001', plantilla: '572', nombre: 'Banco' }, { codigo: '64000000', plantilla: '640', nombre: 'Sueldos' }],
    yaSalidas: {},
  })
  const s = armarSalida(ps, aRecibidas({ recibidas: [], cuentas: [], yaSalidas: {} }), aEmitidas({ emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] }), 'C:\\Sumied\\0007\\', as)

  it('los asientos sin I.V.A. (el pago y la nómina) salen, en su fila, con cuántos y su importe', () => {
    expect(s.filas.find((f) => f.id === 'asientos')).toEqual({ id: 'asientos', que: 'Asientos', cuantos: 2, importe: 200, sale: true, estado: 'Mira esto', texto: '1 no puede salir' })
    expect(s.ficheros.asientos.map((a) => a.entryId)).toEqual([id(1), id(2)])
    expect(s.comprobaciones).toEqual(['Cada asiento cuadra'])
  })
  it('lo que lleva I.V.A. y no es factura no sale, con su frase y qué hacer', () => {
    expect(s.noPuedenSalir.map((x) => [x.clase, x.porque])).toEqual([['asiento', 'Lleva I.V.A. y no es una factura: métela a mano en ERP10 para que entre en su libro.']])
  })
  it('el día del TPV sigue sin salir, en su fila', () => {
    expect(s.filas.find((f) => f.id === 'tpv')).toMatchObject({ cuantos: 1, estado: 'Todavía no sale por aquí', sale: false })
  })
  it('la descarga: asientos.xlsx detrás de las subcuentas, con una fila por apunte y una huella por asiento', async () => {
    const d = await prepararDescarga(s)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['subcuentas.xlsx', 3], ['asientos.xlsx', 4]])
    expect(d.partidas.map((p) => [p.entry_id, p.clase])).toEqual([[id(1), 'asiento'], [id(2), 'asiento']])
    expect(new Set(d.partidas.map((p) => p.huella)).size).toBe(2)
  })
})

describe('El fichero, contra los lectores del N04', () => {
  it('no hay lector de esta forma: el N04 lee el libro diario de ERP10 (con títulos y una columna «Serie»), no el Excel de importar asientos (sin títulos)', async () => {
    const r = prepararAsientos([asiento(1, '2026-10-10', [L('41000012', 121, 0), L('57200001', 0, 121)])], OPC)
    const f = abrirExcel('asientos.xlsx', await libroErp10(r.asientos.flatMap((a) => a.filas)))
    expect(reconocer(f)).toBeNull()
  })
})
