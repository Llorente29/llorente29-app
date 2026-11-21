// tests/unit/modules/conta/erp10/expedidas.test.ts
//
// X05 · El fichero de expedidas de la salida a ERP10 (expedidas.xlsx), con la
// configuración medida en ERP10 el 17/11 (docs/conta/erp10/configuracion/
// ConfiguracionExpedidas.XML). Las columnas se leen de la configuración, no de un
// ejemplo escrito a mano. Celda a celda: una interior de un tipo, una de dos
// tipos y dos cuentas de ingreso, una con retención, una intracomunitaria y las
// que no pueden salir, cada una con su frase.
// Las facturas tienen la forma de las que hace conta_venta_emitir (la 430 por el
// total, la 70x por cuenta, la 477 por tipo con su libro; la retención, a la 473):
// la misma que devuelve conta_erp10_emitidas_por_salir en la prueba de staging.
// Datos inventados y que se ven inventados (T11): NIF B00000000.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnas } from '../../../../../supabase/functions/_shared/diezExcel.ts'
import {
  contrapartidasDelXml, cuadreEmitida, filaExpedida, leerEmitida, libroErp10, prepararExpedidas, tiposIvaDelXml,
  type EmitidaParaErp10, type LineaEmitida, type OperacionEmitida,
} from '@/modules/conta/erp10/ficheros'
import { XML_EXPEDIDAS } from '@/modules/conta/erp10/configuracion'

const RAIZ = resolve(__dirname, '../../../../..')
const PLAN = new Map(Object.entries({
  '70000000': '700', '70500000': '705', '70400000': '704', '70800000': '708', '75900000': '759',
  '47700021': '477', '47700010': '477', '47700004': '477', '47700000': '477', '43000001': '4300', '4300000001': '4300', '47300000': '473',
}))
const OPC = { plan: PLAN, largo: 8, carpetaPdf: 'C:\\Sumied\\0007\\' }

const L = (cuenta: string, debe: number, haber: number, iva?: [number, number]): LineaEmitida =>
  ({ cuenta, debe, haber, tipoIva: iva ? iva[0] : null, baseIva: iva ? iva[1] : null })

let n = 0
function emitida(lineas: LineaEmitida[], o: Partial<Omit<EmitidaParaErp10, 'lineas'>> & { numero?: string } = {}): EmitidaParaErp10 {
  n++
  return {
    entryId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fecha: '2026-10-05', factura: { numero: o.numero ?? `F-2026/${String(n).padStart(4, '0')}`, fecha: '2026-10-05' },
    cliente: { nombre: 'Cliente Inventado X05, S.L.', nif: 'B00000000' },
    rectificativa: false, tipoFactura: 'F1', operacion: 'interior' as OperacionEmitida, recargo: 0, retencion: 0, tienePdf: true,
    ...o, lineas,
  }
}

/** La fila como {letra: valor}, sin las vacías: para comparar celda a celda. */
function celdas(fila: (string | number)[]): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  fila.forEach((v, i) => { if (v !== '') out[XLSX.utils.encode_col(i)] = v })
  return out
}
const F = (d: string) => `${d}T12:00:00.000Z`
/** La letra de la columna de un campo, leída de la configuración de ERP10. */
const COL = columnas(XML_EXPEDIDAS)
const letra = (campo: string) => XLSX.utils.encode_col(COL[campo] - 1)

describe('La configuración de expedidas', () => {
  it('es la del repositorio (X08: con el resumen de facturas añadido), y de ella salen 4 contrapartidas de ingreso y 4 tipos de IVA', () => {
    const xml = readFileSync(resolve(RAIZ, 'docs/conta/erp10/configuracion/ConfiguracionExpedidas.XML'), 'utf8').replace(/\r\n/g, '\n')
    expect(XML_EXPEDIDAS).toBe(xml.replace('<Campo126>24</Campo126>\n', '<Campo126>24</Campo126>\n    <Campo069>36</Campo069>\n    <Campo070>37</Campo070>\n    <Campo071>38</Campo071>\n'))
    expect(['069', '070', '071'].map(letra)).toEqual(['AJ', 'AK', 'AL'])
    expect(contrapartidasDelXml()).toBe(4)
    expect(tiposIvaDelXml()).toBe(4)
  })
  it('las columnas que se usan, de la configuración: fechas E, número I, cliente G, total AB, ruta Z, ingresos AA/AC…AH/AI, IVA J a U', () => {
    expect(['002', '001', '118', '006', '004', '045', '057'].map(letra)).toEqual(['E', 'E', 'E', 'I', 'G', 'AB', 'Z'])
    expect(['041', '043', '092', '094', '095', '097', '098', '100'].map(letra)).toEqual(['AA', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI'])
    expect(['010', '011', '012', '019', '020', '021'].map(letra)).toEqual(['J', 'K', 'L', 'S', 'T', 'U'])
  })
  it('no tiene columnas de NIF, retención, tipo de operación ni rectificativa: por eso esas no salen', () => {
    for (const campo of ['003', '009', '034', '035', '036', '037', '038', '072', '073']) expect(COL[campo]).toBeUndefined()
  })
})

describe('Una emitida, celda a celda', () => {
  const ruta = 'C:\\Sumied\\0007\\20261005_Cliente-Inventado-X05-S-L_F-2026-0001.pdf'

  it('interior, un tipo: la 430 por el total, la 700 por la base y la 477 al 21 %', () => {
    const x = leerEmitida(emitida([L('43000001', 121, 0), L('70000000', 0, 100), L('47700021', 0, 21, [21, 100])], { numero: 'F-2026/0001' }))
    if ('porque' in x) throw new Error(x.porque)
    expect(cuadreEmitida(x)).toBeNull()
    expect(celdas(filaExpedida(x, new Map(), ruta))).toEqual({
      E: F('2026-10-05'), G: '43000001', I: 'F-2026/0001',
      J: 100, K: 21, L: 21,
      Z: ruta, AA: '70000000', AB: 121, AC: 100,
    })
  })

  it('dos tipos y dos cuentas de ingreso, ordenados por tipo y con las cuentas convertidas', () => {
    const x = leerEmitida(emitida([
      L('4300000001', 176, 0), L('70000000', 0, 100), L('70500000', 0, 50),
      L('47700021', 0, 21, [21, 100]), L('47700010', 0, 5, [10, 50]),
    ], { numero: 'F-2026/0002' }))
    if ('porque' in x) throw new Error(x.porque)
    expect(celdas(filaExpedida(x, new Map([['4300000001', '43000001']]), ''))).toEqual({
      E: F('2026-10-05'), G: '43000001', I: 'F-2026/0002',
      J: 50, K: 10, L: 5, M: 100, N: 21, O: 21,
      AA: '70000000', AB: 176, AC: 100, AD: '70500000', AE: 50,
    })
  })

  it('cuatro cuentas de ingreso llenan las cuatro contrapartidas; con cinco, no sale', () => {
    const cuatro = [L('43000001', 121, 0), L('70000000', 0, 40), L('70500000', 0, 30), L('70400000', 0, 20), L('70800000', 0, 10), L('47700021', 0, 21, [21, 100])]
    const x = leerEmitida(emitida(cuatro))
    if ('porque' in x) throw new Error(x.porque)
    const c = celdas(filaExpedida(x, new Map(), ''))
    expect([c.AA, c.AC, c.AD, c.AE, c.AF, c.AG, c.AH, c.AI]).toEqual(['70000000', 40, '70500000', 30, '70400000', 20, '70800000', 10])
    const cinco = leerEmitida(emitida([...cuatro.slice(0, 5), L('75900000', 0, 0.01), L('47700021', 0, 21, [21, 100.01])]))
    expect(cinco).toMatchObject({ porque: 'Esta factura reparte el ingreso en 5 cuentas y ERP10 admite 4 al importar. Métela a mano en ERP10.' })
  })

  it('con retención (la 473), no sale: la configuración no tiene sus columnas', () => {
    const x = leerEmitida(emitida([L('43000001', 106, 0), L('47300000', 15, 0), L('70500000', 0, 100), L('47700021', 0, 21, [21, 100])], { retencion: 15 }))
    expect(x).toMatchObject({ porque: 'Lleva retención, y ERP10 no la admite al importar en las emitidas con esta configuración. Métela a mano en ERP10.' })
  })

  it('una entrega intracomunitaria, no sale, con su frase', () => {
    const x = leerEmitida(emitida([L('43000001', 100, 0), L('70000000', 0, 100), L('47700000', 0, 0, [0, 100])], { operacion: 'intra' }))
    expect(x).toMatchObject({ porque: 'Es una entrega a otro país de la UE, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.' })
  })

  it('las demás que no pueden salir, cada una con lo que hay que hacer en ERP10', () => {
    const base = [L('43000001', 121, 0), L('70000000', 0, 100), L('47700021', 0, 21, [21, 100])]
    const porque = (o: Partial<EmitidaParaErp10>, lineas = base) => {
      const x = leerEmitida(emitida(lineas, o))
      return 'porque' in x ? x.porque : null
    }
    expect(porque({ rectificativa: true, tipoFactura: 'R4' })).toBe('Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.')
    expect(porque({ tipoFactura: 'R1' })).toBe('Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.')
    expect(porque({ tipoFactura: 'F4' })).toBe('Es un resumen de varias facturas, y ERP10 no lo admite al importar con esta configuración. Métela a mano en ERP10.')
    expect(porque({ operacion: 'isp' })).toBe('Es una venta con inversión del sujeto pasivo, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.')
    expect(porque({ operacion: 'exenta' })).toBe('Es una venta exenta de IVA, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.')
    expect(porque({ recargo: 5.2 })).toBe('Lleva recargo de equivalencia, y ERP10 no lo admite al importar. Métela a mano en ERP10.')
    expect(porque({ factura: { numero: ' ', fecha: '2026-10-05' } })).toBe('No tiene número de factura.')
    expect(porque({}, [L('43000001', 100, 0), L('70000000', 0, 100)])).toBe('No lleva IVA, y ERP10 necesita saber por qué al importar. Métela a mano en ERP10.')
    expect(porque({}, [...base, L('57200001', 1, 0)])).toBe('Lleva la cuenta 57200001, que no es de ingreso, IVA, cliente ni retención. Métela a mano en ERP10.')
    expect(porque({}, [L('43000001', 122, 0), L('70000000', 0, 101), L('47700021', 0, 21, [21, 100])])).toBe('Las cuentas de ingreso no suman las bases del IVA. No sale.')
  })
})

describe('Las emitidas de una salida', () => {
  it('las que salen, con su PDF en la carpeta; las que no, con su porqué; y las cuentas que usan', async () => {
    const buena = emitida([L('43000001', 121, 0), L('70000000', 0, 100), L('47700021', 0, 21, [21, 100])], { numero: 'F-2026/0101' })
    const sinPdf = emitida([L('43000001', 110, 0), L('70500000', 0, 100), L('47700010', 0, 10, [10, 100])], { numero: 'F-2026/0102', tienePdf: false })
    const rect = emitida([L('43000001', 0, 24.2), L('70000000', 20, 0), L('47700021', 4.2, 0, [21, 20])], { numero: 'R-2026/0001', rectificativa: true, tipoFactura: 'R4' })
    const usados = new Set(['20261005_cliente-inventado-x05-s-l_f-2026-0101.pdf'])
    const r = prepararExpedidas([buena, sinPdf, rect], { ...OPC, usados })
    expect(r.filas.map((f) => [f.numero, f.pdf, f.usa])).toEqual([
      // El nombre ya lo usaba una recibida de la misma salida: lleva _2.
      ['F-2026/0101', '20261005_Cliente-Inventado-X05-S-L_F-2026-0101_2.pdf', ['43000001', '70000000']],
      ['F-2026/0102', null, ['43000001', '70500000']],
    ])
    expect(celdas(r.filas[0].fila).Z).toBe('C:\\Sumied\\0007\\20261005_Cliente-Inventado-X05-S-L_F-2026-0101_2.pdf')
    expect(celdas(r.filas[1].fila).Z).toBeUndefined()
    expect(r.noSalen).toEqual([{ entryId: rect.entryId, numero: 'R-2026/0001', porque: 'Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.' }])
    expect([...r.cuentas].sort()).toEqual(['43000001', '70000000', '70500000'])

    // El libro: una hoja, sin títulos; la fecha como fecha, la cuenta y el número como texto, el total como número.
    const wb = XLSX.read(new Uint8Array(await libroErp10(r.filas.map((f) => f.fila))), { type: 'array', cellDates: true })
    const h = wb.Sheets[wb.SheetNames[0]]
    expect(XLSX.utils.sheet_to_json(h, { header: 1 })).toHaveLength(2)
    expect(h.E1.t).toBe('d')
    expect([h.G1.t, h.G1.v, h.I1.t, h.I1.v, h.AB1.t, h.AB1.v]).toEqual(['s', '43000001', 's', 'F-2026/0101', 'n', 121])
  })

  it('una cuenta del cliente que no cabe en las cifras de ERP10 no sale, con su frase', () => {
    const plan = new Map([...PLAN, ['430012345', '4300']])
    const r = prepararExpedidas([emitida([L('430012345', 121, 0), L('70000000', 0, 100), L('47700021', 0, 21, [21, 100])])], { ...OPC, plan })
    expect(r.filas).toHaveLength(0)
    expect(r.noSalen[0].porque).toBe('La cuenta 430012345 no cabe en ERP10, que usa 8 cifras.')
  })
})
