// tests/unit/modules/conta/r16/diaPorSerie.test.ts
//
// R16 · El día del TPV sale a ERP10 como su libro de IVA (R15b): una expedida por serie (a «Clientes de contado», con su
// primer y su último número), una por cada factura con NIF (a su cliente, con su número) y una por cada devolución (en
// negativo, con su número). El total y el I.V.A. del día, los de siempre (regla 31). El cobro descarga a cada cliente con
// NIF lo suyo. Un día repartido no sale por la conexión: «Sale por el fichero». Celda a celda, con las columnas de
// XML_EXPEDIDAS y XML_ASIENTOS. Datos inventados (T11): las cifras del ejemplo de Revo, sumadas de sus documentos.

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnas } from '../../../../../supabase/functions/_shared/diezExcel.ts'
import {
  FRASE_SALE_POR_EL_FICHERO, columnasAsientos, prepararDiasTpv, seReparte, type CuentaContado, type DiaParaErp10, type FilaLibroErp10, type LineaDia,
} from '@/modules/conta/erp10/ficheros'
import { XML_EXPEDIDAS } from '@/modules/conta/erp10/configuracion'
import { armarSalida } from '@/modules/conta/erp10/salida'
import { aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas } from '@/modules/conta/services/erp10Service'

const PLAN = new Map(Object.entries({
  '57000000': '570', '43000001': '4300', '43000099': '4300', '43000101': '4300', '43000102': '4300', '70000000': '700', '47700000': '477',
}))
const OPC = { plan: PLAN, largo: 8 }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CONTADO: CuentaContado[] = [{ codigo: '43000099', plantilla: '4300', nombre: 'Clientes de contado' }]
const COBRO = id(91)
const L = (cuenta: string, debe: number, haber: number, iva?: [number, number]): LineaDia =>
  ({ cuenta, plantilla: PLAN.get(cuenta) ?? '', nombre: `Cuenta inventada ${cuenta}`, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, libro: iva ? 'issued' : null })
const fila = (x: Partial<FilaLibroErp10> & Pick<FilaLibroErp10, 'tipo' | 'base' | 'cuota' | 'total'>): FilaLibroErp10 =>
  ({ serie: null, numero: null, hasta: null, documentos: 1, nif: null, nombre: null, pct: 10, cliente: null, ...x })

/** Su libro (R15b): Facturas 5001–5030 y Barra 5031–5048, dos facturas con NIF (5007 con su cliente en el plan; 5020, también, salvo en el 2) y la devolución 5047. */
const LIBRO: FilaLibroErp10[] = [
  fila({ tipo: 'F4', serie: 'Facturas', numero: '5001', hasta: '5030', documentos: 28, base: 612.32, cuota: 61.23, total: 673.55, nombre: 'VENTAS A CONSUMIDOR FINAL' }),
  fila({ tipo: 'F4', serie: 'Barra', numero: '5031', hasta: '5048', documentos: 17, base: 345.66, cuota: 34.58, total: 380.24, nombre: 'VENTAS A CONSUMIDOR FINAL' }),
  fila({ tipo: 'F1', serie: 'Facturas', numero: '5007', nif: '00000000T', nombre: 'Cliente de ejemplo 7', base: 36.44, cuota: 3.64, total: 40.08, cliente: '43000101' }),
  fila({ tipo: 'F1', serie: 'Facturas', numero: '5020', nif: '00000001R', nombre: 'Cliente de ejemplo 20', base: 15.57, cuota: 1.56, total: 17.13, cliente: '43000102' }),
  fila({ tipo: 'R5', serie: 'Barra', numero: '5047', base: -10, cuota: -1, total: -11, nombre: 'VENTAS A CONSUMIDOR FINAL' }),
]
/** La factura del día (R07, el día en dos asientos): 1.100,00 a Clientes de contado, 999,99 de ventas y 100,01 de I.V.A. al 10 %. */
const dia = (o: Partial<DiaParaErp10> = {}): DiaParaErp10 => ({
  entryId: id(1), serie: 1, numero: 1, fecha: '2026-10-13', concepto: 'Factura del día · TPV Revo · tickets 5001 a 5048', origen: 'revo', local: 'Revo', localId: null,
  primero: '5001', ultimo: '5048', facturas: 48, contadores: 2, cobroId: COBRO,
  lineas: [L('43000099', 1100, 0), L('47700000', 0, 100.01, [10, 999.99]), L('70000000', 0, 999.99)],
  libro: LIBRO, ...o,
})
const celdas = (f: (string | number)[]) => Object.fromEntries(f.flatMap((v, i) => (v === '' ? [] : [[XLSX.utils.encode_col(i), v]])))
const letraE = (campo: string) => XLSX.utils.encode_col(columnas(XML_EXPEDIDAS)[campo] - 1)
const letraA = (campo: string) => XLSX.utils.encode_col(columnasAsientos()[campo] - 1)

describe('un día con dos series, dos facturas con NIF y una devolución', () => {
  const r = prepararDiasTpv([dia()], CONTADO, OPC)
  const d = r.dias[0]

  it('sale como su libro de IVA: cada serie, cada factura con NIF a su cliente y la devolución', () => {
    expect(r.noSalen).toEqual([])
    expect(d.partes).toEqual([
      { clase: 'serie', numero: '5001-5030', cliente: 'Clientes de contado', nif: null, total: 673.55 },
      { clase: 'serie', numero: '5031-5048', cliente: 'Clientes de contado', nif: null, total: 380.24 },
      { clase: 'nif', numero: '5007', cliente: 'Cliente de ejemplo 7', nif: '00000000T', total: 40.08 },
      { clase: 'nif', numero: '5020', cliente: 'Cliente de ejemplo 20', nif: '00000001R', total: 17.13 },
      { clase: 'devolucion', numero: '5047', cliente: 'Clientes de contado', nif: null, total: -11 },
    ])
    expect(d.filas).toHaveLength(5)
  })
  it('regla 31: lo que suman sus facturas en ERP10 es el total del día de siempre (1.100,00)', () => {
    expect(d.total).toBe(1100)
    expect(Math.round(d.partes!.reduce((t, p) => t + p.total * 100, 0)) / 100).toBe(1100)
  })
  it('una serie, celda a celda: Clientes de contado, su total, su I.V.A., sus ventas y el resumen (cuántas, primera y última)', () => {
    expect(celdas(d.filas[0])).toMatchObject({ [letraE('004')]: '43000099', [letraE('045')]: 673.55, [letraE('010')]: 612.32, [letraE('011')]: 10, [letraE('012')]: 61.23,
      [letraE('041')]: '70000000', [letraE('043')]: 612.32, [letraE('069')]: 28, [letraE('070')]: '5001', [letraE('071')]: '5030' })
    expect(celdas(d.filas[0])[letraE('006')]).toBeUndefined()
  })
  it('la factura con NIF, a su cliente y con su número, sin resumen', () => {
    const c = celdas(d.filas[2])
    expect(c).toMatchObject({ [letraE('004')]: '43000101', [letraE('006')]: '5007', [letraE('045')]: 40.08, [letraE('010')]: 36.44, [letraE('012')]: 3.64 })
    expect([c[letraE('069')], c[letraE('070')], c[letraE('071')]]).toEqual([undefined, undefined, undefined])
  })
  it('la devolución, en negativo y con su número, a Clientes de contado', () => {
    expect(celdas(d.filas[4])).toMatchObject({ [letraE('004')]: '43000099', [letraE('006')]: '5047', [letraE('045')]: -11, [letraE('010')]: -10, [letraE('012')]: -1 })
  })
  it('no sale por la conexión: «Sale por el fichero»', () => {
    expect(d.api).toBeNull()
    expect(d.porLaConexion).toBe(FRASE_SALE_POR_EL_FICHERO)
  })
  it('lo que debe cada cliente con NIF, para su cobro', () => {
    expect(d.clientes).toEqual([{ cuenta: '43000101', nombre: 'Cliente de ejemplo 7', importe: 4008 }, { cuenta: '43000102', nombre: 'Cliente de ejemplo 20', importe: 1713 }])
  })
})

describe('una factura con NIF sin su cliente en el plan', () => {
  it('el día no sale, y dice qué hacer (la salida lo da de alta al abrirse)', () => {
    const r = prepararDiasTpv([dia({ libro: LIBRO.map((f) => (f.numero === '5020' ? { ...f, cliente: null } : f)) })], CONTADO, OPC)
    expect(r.dias).toEqual([])
    expect(r.noSalen[0].porque).toBe('La factura 5020 (Cliente de ejemplo 20, 00000001R) no tiene la cuenta de su cliente: abre otra vez la salida para darlo de alta. No sale.')
  })
})

describe('un día que no se reparte', () => {
  it('con una sola fila en su libro, sale como siempre: una factura, y por la conexión', () => {
    const solo = [fila({ tipo: 'F4', numero: '5001', hasta: '5048', documentos: 48, base: 999.99, cuota: 100.01, total: 1100 })]
    expect(seReparte(solo)).toBe(false)
    const r = prepararDiasTpv([dia({ libro: solo, contadores: 1 })], CONTADO, OPC)
    expect(r.dias[0].filas).toHaveLength(1)
    expect(r.dias[0].partes).toBeNull()
    expect(r.dias[0].api).not.toBeNull()
  })
  it('si el libro no suma lo que el día, no sale (regla 31)', () => {
    const r = prepararDiasTpv([dia({ libro: LIBRO.map((f) => (f.numero === '5047' ? { ...f, total: -12, cuota: -2 } : f)) })], CONTADO, OPC)
    expect(r.noSalen[0].porque).toBe('Sus facturas del libro suman 1.099,00 € y el día 1.100,00 €. No sale.')
  })
})

describe('en la salida del mes: el cobro repartido y los clientes en las fichas nuevas', () => {
  const cobro = {
    entryId: COBRO, serie: 1, numero: 2, fecha: '2026-10-13', concepto: 'Cobro del día · TPV Revo', origen: 'sales_day_payment',
    lineas: [
      { cuenta: '57000000', plantilla: '570', nombre: 'Caja inventada', concepto: 'Cobra Efectivo', debe: 600, haber: 0 },
      { cuenta: '43000001', plantilla: '4300', nombre: 'Glovo inventado', concepto: 'Cobra Glovo', debe: 500, haber: 0 },
      { cuenta: '43000099', plantilla: '4300', nombre: 'Clientes de contado', concepto: 'El cobro del día · Clientes de contado', debe: 0, haber: 1100 },
    ],
  }
  const partida = (entryId: string, o: Record<string, unknown> = {}) => ({
    entry_id: entryId, serie: 1, numero: 1, fecha: '2026-10-13', concepto: 'Inventado', origen: 'sales_day', clase: 'emitida', importe: 1100, base_iva: 999.99,
    numero_factura: null, nif: null, tercero: null, cuentas_base: 1, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
  })
  const cuentas = [...PLAN].filter(([k]) => !k.startsWith('4300010')).map(([codigo, plantilla]) => ({ codigo, plantilla, nombre: `Cuenta inventada ${codigo}` }))
  const d = dia()
  // Lo que da la base: los días (sin el libro) y, aparte, su libro con las 430 de sus clientes (conta_erp10_dias_tpv_libro).
  const libroDeLaBase = {
    dias: { [d.entryId]: LIBRO },
    cuentas: [{ codigo: '43000101', plantilla: '4300', nombre: 'Cliente de ejemplo 7', nif: '00000000T' }, { codigo: '43000102', plantilla: '4300', nombre: 'Cliente de ejemplo 20', nif: '00000001R' }],
  }
  const s = armarSalida(
    aPorSalir({ mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [partida(d.entryId), partida(COBRO, { origen: 'sales_day_payment', clase: 'asiento' })] }),
    aRecibidas({ recibidas: [], cuentas: [], yaSalidas: {} }), aEmitidas({ emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] }), 'C:\\Sumied\\0007\\',
    aAsientos({ asientos: [cobro], cuentas, yaSalidas: {} }),
    aDias({ dias: [{ ...d, libro: undefined }], contado: CONTADO, cuentas, yaSalidas: {} }, libroDeLaBase),
  )

  it('el día sale con sus cinco facturas, y lo dice en la lista', () => {
    expect(s.noPuedenSalir).toEqual([])
    expect(s.ficheros.dias[0].filas).toHaveLength(5)
    expect(s.ficheros.dias[0].api).toBeUndefined()
    expect(s.ficheros.dias[0].porLaConexion).toBe(FRASE_SALE_POR_EL_FICHERO)
    expect(s.listas.tpv[0].partes?.map((p) => p.numero)).toEqual(['5001-5030', '5031-5048', '5007', '5020', '5047'])
    expect(s.filas.find((f) => f.id === 'tpv')?.texto).toBe('48 facturas del TPV, cada día como su libro de IVA')
  })
  it('su cobro descarga a cada cliente con NIF lo suyo y a Clientes de contado el resto: en ERP10 todo queda a cero', () => {
    // Un apunte al debe lleva su cuenta en 005 y su importe en 008; uno al haber, en 010 y 013.
    const apuntes = s.ficheros.asientos[0].filas.map(celdas).map((f) => [f[letraA('005')] ?? f[letraA('010')], f[letraA('008')] ?? 0, f[letraA('013')] ?? 0])
    expect(apuntes).toEqual([['57000000', 600, 0], ['43000001', 500, 0], ['43000099', 0, 1042.79], ['43000101', 0, 40.08], ['43000102', 0, 17.13]])
  })
  it('«Primero, las fichas nuevas»: los dos clientes, con su NIF y su nombre', () => {
    expect(s.listas.cuentas.filter((c) => c.codigo.startsWith('4300010')).map((c) => [c.codigo, c.nombre, c.nif])).toEqual([
      ['43000101', 'Cliente de ejemplo 7', '00000000T'], ['43000102', 'Cliente de ejemplo 20', '00000001R'],
    ])
  })
})
