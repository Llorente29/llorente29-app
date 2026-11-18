// tests/unit/modules/conta/erp10/ficheros.test.ts
//
// X03 · Los ficheros de la salida a ERP10 (subcuentas.xlsx y recibidas.xlsx).
// Población inventada que imita la medida en el fichero que entró en ERP10 el
// 15-16/11 (regla 31): una normal al 21 %, dos y tres tipos de IVA, dos cuentas de
// gasto, un abono, una al 0 %, una ISP, una AIS, retención de alquiler y de
// profesional, una sin PDF y una sin NIF. Cada fila, celda a celda, y su cuadre.
// Datos inventados y que se ven inventados (T11): NIF B00000000, A00000000…

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  convertirCuentas, cuadre, filaRecibida, filaSubcuenta, huellaFila, leerRecibida, libroErp10, nombrePdf, prepararRecibidas,
  rutaPdf, subcuentaErp10, tiposOperacionDelXml, tiposRetencionDelXml, type LineaRecibida, type Operacion, type RecibidaParaErp10,
} from '@/modules/conta/erp10/ficheros'
import { XML_ASIENTOS, XML_EXPEDIDAS, XML_RECIBIDAS, XML_SUBCUENTAS } from '@/modules/conta/erp10/configuracion'

const RAIZ = resolve(__dirname, '../../../../..')
const PLAN = new Map(Object.entries({
  '60000000': '600', '62100000': '621', '62300000': '623', '62900000': '629', '47200000': '472', '47700000': '477',
  '40000001': '4000', '40000002': '4000', '41000003': '4100', '41000004': '4100', '47510019': '4751', '47510015': '4751',
  '4000123456': '4000', '4000000001': '4000', '62800000': '628', '60200000': '602',
}))
const OPC = { plan: PLAN, largo: 8, carpetaPdf: 'C:\\ERP10\\Documentos\\E01' }

const L = (cuenta: string, debe: number, haber: number, iva?: [number, number], extra: Partial<LineaRecibida> = {}): LineaRecibida =>
  ({ cuenta, debe, haber, tipoIva: iva ? iva[0] : null, baseIva: iva ? iva[1] : null, ...extra })

let n = 0
function recibida(lineas: LineaRecibida[], o: { operacion?: Operacion; numero?: string; nif?: string | null; pdf?: boolean; nombre?: string } = {}): RecibidaParaErp10 {
  n++
  return {
    entryId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fecha: '2026-11-05', factura: { numero: o.numero ?? `INV-X03-${n}`, fecha: '2026-10-28' },
    proveedor: { nombre: o.nombre ?? 'Proveedor Inventado X03, S.L.', nif: o.nif === undefined ? 'B00000000' : o.nif },
    lineas, operacion: o.operacion ?? 'interior', tienePdf: o.pdf ?? true,
  }
}

/** La fila como {letra: valor}, sin las vacías: para comparar celda a celda. */
function celdas(fila: (string | number)[]): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  fila.forEach((v, i) => { if (v !== '') out[XLSX.utils.encode_col(i)] = v })
  return out
}
const F = (d: string) => `${d}T12:00:00.000Z`

describe('La configuración de ERP10, en el repositorio', () => {
  it('las constantes son los XML de docs/conta/erp10/configuracion, salvo los finales de línea', () => {
    const leer = (n: string) => readFileSync(resolve(RAIZ, `docs/conta/erp10/configuracion/Configuracion${n}.XML`), 'utf8').replace(/\r\n/g, '\n')
    expect(XML_RECIBIDAS).toBe(leer('Recibidas'))
    expect(XML_EXPEDIDAS).toBe(leer('Expedidas'))
    expect(XML_SUBCUENTAS).toBe(leer('Subcuentas'))
    expect(XML_ASIENTOS).toBe(leer('Asientos'))
  })
  it('recibidas conoce OI, AIS e ISP, y la retención PRO (añadida, como en Diez) y ALQ', () => {
    expect(tiposOperacionDelXml()).toEqual(['OI', 'AIS', 'ISP'])
    expect(tiposRetencionDelXml()).toEqual(['PRO', 'ALQ'])
    const bloque = (xml: string) => xml.match(/<Configuracion2>[\s\S]*?(<Campo034>[\s\S]*?<\/Campo034>)/)?.[1]
    const diez = readFileSync(resolve(RAIZ, 'docs/conta/diez/configuracion/ConfiguracionRecibidas-b01r26.XML'), 'utf8').replace(/\r\n/g, '\n')
    expect(bloque(XML_RECIBIDAS)).toBe(bloque(diez))
  })
})

describe('Las cuentas, al largo de ERP10', () => {
  it('la misma regla que conta_erp10_subcuenta (los 7 casos de la prueba de staging de la X02)', () => {
    expect(subcuentaErp10('40000001', '4000', 8)).toBe('40000001')
    expect(subcuentaErp10('40000001', '4000', 10)).toBe('4000000001')
    expect(subcuentaErp10('4000000123', '4000', 8)).toBe('40000123')
    expect(subcuentaErp10('70000000', '700', 6)).toBe('700000')
    expect(subcuentaErp10('5720000001', '572', 8)).toBe('57200001')
    expect(subcuentaErp10('4000123456', '4000', 8)).toBeNull()
    expect(subcuentaErp10('6290012345', '6290', 6)).toBeNull()
  })
  it('la que no cabe y las dos que chocan no salen, con su frase', () => {
    const r = convertirCuentas(['40000001', '4000000001', '4000123456', '62900000'], PLAN, 8)
    expect([...r.erp]).toEqual([['62900000', '62900000']])
    expect(r.noCaben.get('4000123456')).toBe('La cuenta 4000123456 no cabe en ERP10, que usa 8 cifras.')
    expect(r.noCaben.get('40000001')).toBe('Las cuentas 40000001 y 4000000001 quedarían en ERP10 como la misma, 40000001: no sale ninguna de las dos hasta que se cambie una.')
    expect(r.noCaben.get('4000000001')).toBe(r.noCaben.get('40000001'))
  })
  it('choca también con una que ya salió en otro lote', () => {
    const r = convertirCuentas(['4000000001'], PLAN, 8, new Map([['40000001', '40000001']]))
    expect(r.noCaben.get('4000000001')).toMatch(/^Las cuentas 40000001 y 4000000001 quedarían en ERP10 como la misma/)
  })
})

describe('La fila de una recibida, celda a celda', () => {
  const ruta = (pdf: string | null) => (pdf ? `C:\\ERP10\\Documentos\\E01\\${pdf}` : undefined)
  const casos: { nombre: string; r: RecibidaParaErp10; esperado: (pdf: string | null) => Record<string, string | number> }[] = [
    {
      nombre: 'normal al 21 %',
      r: recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('40000001', 0, 121)], { numero: 'INV-X03-A1' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A1', J: 100, K: 21, L: 21, Z: ruta(pdf)!, AA: '62900000', AB: 121, AC: 'B00000000', AD: 100, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'dos tipos de IVA',
      r: recibida([L('60000000', 300, 0), L('47200000', 10, 0, [10, 100]), L('47200000', 42, 0, [21, 200]), L('40000001', 0, 352)], { numero: 'INV-X03-A2' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A2', J: 100, K: 10, L: 10, M: 200, N: 21, O: 42, Z: ruta(pdf)!, AA: '60000000', AB: 352, AC: 'B00000000', AD: 300, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'tres tipos de IVA',
      r: recibida([L('60000000', 600, 0), L('47200000', 4, 0, [4, 100]), L('47200000', 20, 0, [10, 200]), L('47200000', 63, 0, [21, 300]), L('40000001', 0, 687)], { numero: 'INV-X03-A3' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A3', J: 100, K: 4, L: 4, M: 200, N: 10, O: 20, P: 300, Q: 21, R: 63, Z: ruta(pdf)!, AA: '60000000', AB: 687, AC: 'B00000000', AD: 600, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'dos cuentas de gasto',
      r: recibida([L('60000000', 60, 0), L('62900000', 40.5, 0), L('47200000', 21.11, 0, [21, 100.5]), L('40000001', 0, 121.61)], { numero: 'INV-X03-A4' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A4', J: 100.5, K: 21, L: 21.11, Z: ruta(pdf)!, AA: '60000000', AB: 121.61, AC: 'B00000000', AD: 60, AE: '62900000', AF: 40.5, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'un abono, entero en negativo',
      r: recibida([L('40000001', 60.5, 0), L('60000000', 0, 50), L('47200000', 0, 10.5, [21, 50])], { numero: 'ABN-X03-A5' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'ABN-X03-A5', J: -50, K: 21, L: -10.5, Z: ruta(pdf)!, AA: '60000000', AB: -60.5, AC: 'B00000000', AD: -50, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'al 0 %',
      r: recibida([L('62800000', 80, 0), L('40000002', 0, 80)], { numero: 'INV-X03-A6' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000002', I: 'INV-X03-A6', J: 80, K: 0, L: 0, Z: ruta(pdf)!, AA: '62800000', AB: 80, AC: 'B00000000', AD: 80, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'ISP: lleva la cuota, pero el total es la base',
      r: recibida([L('60200000', 1000, 0), L('47200000', 210, 0, [21, 1000]), L('47700000', 0, 210, [21, 1000]), L('40000002', 0, 1000)], { operacion: 'isp', numero: 'INV-X03-A7' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000002', I: 'INV-X03-A7', J: 1000, K: 21, L: 210, Z: ruta(pdf)!, AA: '60200000', AB: 1000, AC: 'B00000000', AD: 1000, AG: F('2026-11-05'), AM: 'ISP' }),
    },
    {
      nombre: 'AIS: lleva la cuota, pero el total es la base',
      r: recibida([L('62900000', 49.99, 0), L('47200000', 10.5, 0, [21, 49.99]), L('47700000', 0, 10.5, [21, 49.99]), L('40000002', 0, 49.99)], { operacion: 'intra_servicios', numero: 'INV-X03-A8', nif: 'IE0000000X' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000002', I: 'INV-X03-A8', J: 49.99, K: 21, L: 10.5, Z: ruta(pdf)!, AA: '62900000', AB: 49.99, AC: 'IE0000000X', AD: 49.99, AG: F('2026-11-05'), AM: 'AIS' }),
    },
    {
      nombre: 'con retención de alquiler',
      r: recibida([L('62100000', 1000, 0), L('47200000', 210, 0, [21, 1000]), L('47510019', 0, 190, undefined, { modeloRetencion: '115' }), L('41000003', 0, 1020)], { numero: 'ALQ-X03-A9' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '41000003', I: 'ALQ-X03-A9', J: 1000, K: 21, L: 210, Z: ruta(pdf)!, AA: '62100000', AB: 1020, AC: 'B00000000', AD: 1000, AG: F('2026-11-05'), AH: '47510019', AI: 1000, AJ: 19, AK: 190, AL: 'ALQ', AM: 'OI' }),
    },
    {
      nombre: 'con retención de profesional',
      r: recibida([L('62300000', 500, 0), L('47200000', 105, 0, [21, 500]), L('47510015', 0, 75, undefined, { modeloRetencion: '111' }), L('41000004', 0, 530)], { numero: 'PRO-X03-A10' }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '41000004', I: 'PRO-X03-A10', J: 500, K: 21, L: 105, Z: ruta(pdf)!, AA: '62300000', AB: 530, AC: 'B00000000', AD: 500, AG: F('2026-11-05'), AH: '47510015', AI: 500, AJ: 15, AK: 75, AL: 'PRO', AM: 'OI' }),
    },
    {
      nombre: 'sin PDF: la Z vacía, y entra igual',
      r: recibida([L('62900000', 10, 0), L('47200000', 2.1, 0, [21, 10]), L('40000001', 0, 12.1)], { numero: 'INV-X03-A11', pdf: false }),
      esperado: () => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A11', J: 10, K: 21, L: 2.1, AA: '62900000', AB: 12.1, AC: 'B00000000', AD: 10, AG: F('2026-11-05'), AM: 'OI' }),
    },
    {
      nombre: 'sin NIF: la AC vacía',
      r: recibida([L('62900000', 10, 0), L('47200000', 2.1, 0, [21, 10]), L('40000001', 0, 12.1)], { numero: 'INV-X03-A12', nif: null }),
      esperado: (pdf) => ({ E: F('2026-10-28'), G: '40000001', I: 'INV-X03-A12', J: 10, K: 21, L: 2.1, Z: ruta(pdf)!, AA: '62900000', AB: 12.1, AD: 10, AG: F('2026-11-05'), AM: 'OI' }),
    },
  ]

  const salida = prepararRecibidas(casos.map((k) => k.r), OPC)
  it('salen las 12, ninguna se queda fuera', () => {
    expect(salida.noSalen).toEqual([])
    expect(salida.filas).toHaveLength(12)
  })
  for (const [i, k] of casos.entries()) {
    it(`${k.nombre}: la fila entera, y cumple su regla de cuadre`, () => {
      const f = salida.filas[i]
      expect(f.entryId).toBe(k.r.entryId)
      expect(f.fila).toHaveLength(40) // hasta la AN (Campo091), la última columna de la configuración
      expect(celdas(f.fila)).toEqual(Object.fromEntries(Object.entries(k.esperado(f.pdf)).filter(([, v]) => v !== undefined)))
      const x = leerRecibida(k.r)
      if ('porque' in x) throw new Error(x.porque)
      expect(cuadre(x)).toBeNull()
    })
  }
  it('las cuentas que usan son las del fichero de subcuentas', () => {
    expect([...salida.cuentas].sort()).toEqual(['40000001', '40000002', '41000003', '41000004', '47510015', '47510019', '60000000', '60200000', '62100000', '62300000', '62800000', '62900000'])
  })
})

describe('Lo que no puede salir, con su frase', () => {
  const casos: [string, RecibidaParaErp10, string][] = [
    ['tres cuentas de gasto', recibida([L('60000000', 50, 0), L('62900000', 30, 0), L('62800000', 20, 0), L('47200000', 21, 0, [21, 100]), L('40000001', 0, 121)]),
      'Esta factura reparte el gasto en 3 cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.'],
    ['cinco tipos de IVA', recibida([L('60000000', 500, 0), ...[0, 2, 4, 10, 21].map((p) => L('47200000', p, 0, [p, 100])), L('40000001', 0, 537)]),
      'Esta factura lleva 5 tipos de IVA y ERP10 admite 4 al importar. Métela a mano en ERP10.'],
    ['una compra de bienes en la UE', recibida([L('60000000', 100, 0), L('47200000', 21, 0, [21, 100]), L('47700000', 0, 21, [21, 100]), L('40000002', 0, 100)], { operacion: 'intra_bienes' }),
      'Es una compra de bienes en otro país de la UE, y ERP10 solo la admite al importar si es de servicios. Métela a mano en ERP10.'],
    ['una importación', recibida([L('60000000', 100, 0), L('40000002', 0, 100)], { operacion: 'importacion' }),
      'Es una importación, y ERP10 no la admite al importar. Métela a mano en ERP10.'],
    ['otro tipo de operación', recibida([L('60000000', 100, 0), L('40000002', 0, 100)], { operacion: 'otra' }),
      'Tiene un tipo de operación que ERP10 no admite al importar. Métela a mano en ERP10.'],
    ['recargo de equivalencia', recibida([L('60000000', 100, 0), L('47200000', 26.2, 0, [21, 100], { recargo: 5.2 }), L('40000001', 0, 126.2)]),
      'Lleva recargo de equivalencia, y ERP10 no lo admite al importar. Métela a mano en ERP10.'],
    ['IVA no deducible', recibida([L('60000000', 100, 0), L('47200000', 21, 0, [21, 100], { deducible: 'no' }), L('40000001', 0, 121)]),
      'Lleva IVA no deducible, y ERP10 no lo admite al importar. Métela a mano en ERP10.'],
    ['IVA no deducible en la cuenta de gasto', recibida([L('60000000', 121, 0, [21, 100]), L('40000001', 0, 121)]),
      'Lleva IVA no deducible, y ERP10 no lo admite al importar. Métela a mano en ERP10.'],
    ['prorrata', recibida([L('60000000', 100, 0), L('47200000', 21, 0, [21, 100], { deducible: 'prorrata' }), L('40000001', 0, 121)]),
      'Lleva IVA con prorrata, y ERP10 no lo admite al importar. Métela a mano en ERP10.'],
    ['una retención que no es de alquiler ni de profesional', recibida([L('62900000', 100, 0), L('47510019', 0, 19, undefined, { modeloRetencion: '123' }), L('40000001', 0, 81)]),
      'Lleva una retención que no es de alquiler ni de profesional. Métela a mano en ERP10.'],
    ['una fila que no cuadra', recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('40000001', 0, 120)]),
      'El total no es bases más cuotas menos la retención. No sale.'],
    ['una ISP que suma la cuota al total', recibida([L('60200000', 100, 0), L('47200000', 21, 0, [21, 100]), L('47700000', 0, 21, [21, 100]), L('40000002', 0, 121)], { operacion: 'isp' }),
      'El total no es la base menos la retención (en una inversión del sujeto pasivo o intracomunitaria, la cuota no suma). No sale.'],
    ['una cuenta que no cabe', recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('4000123456', 0, 121)]),
      'La cuenta 4000123456 no cabe en ERP10, que usa 8 cifras.'],
  ]
  for (const [nombre, r, frase] of casos) {
    it(`${nombre}: no entra en el fichero y lo dice`, () => {
      const s = prepararRecibidas([r], OPC)
      expect(s.filas).toEqual([])
      expect(s.noSalen).toEqual([{ entryId: r.entryId, numero: r.factura.numero, porque: frase }])
    })
  }
  it('dos cuentas que dan el mismo código: no sale ninguna de las dos facturas', () => {
    const a = recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('40000001', 0, 121)])
    const b = recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('4000000001', 0, 121)])
    const s = prepararRecibidas([a, b], OPC)
    expect(s.filas).toEqual([])
    const frase = 'Las cuentas 40000001 y 4000000001 quedarían en ERP10 como la misma, 40000001: no sale ninguna de las dos hasta que se cambie una.'
    expect(s.noSalen.map((x) => x.porque)).toEqual([frase, frase])
  })
})

describe('Las columnas salen del XML', () => {
  it('si la configuración pone el número de factura en otra columna, la celda se mueve', () => {
    const r = recibida([L('62900000', 10, 0), L('47200000', 2.1, 0, [21, 10]), L('40000001', 0, 12.1)], { numero: 'INV-X03-MUEVE', pdf: false })
    const x = leerRecibida(r)
    if ('porque' in x) throw new Error(x.porque)
    const cuentas = new Map([['62900000', '62900000'], ['40000001', '40000001']])
    expect(celdas(filaRecibida(x, cuentas, '')).I).toBe('INV-X03-MUEVE')
    const otro = XML_RECIBIDAS.replace('<Campo006>9</Campo006>', '<Campo006>3</Campo006>')
    const movida = celdas(filaRecibida(x, cuentas, '', otro))
    expect(movida.C).toBe('INV-X03-MUEVE')
    expect(movida.I).toBeUndefined()
  })
  it('y en subcuentas igual', () => {
    const otro = XML_SUBCUENTAS.replace('<Campo002>2</Campo002>', '<Campo002>6</Campo002>')
    expect(celdas(filaSubcuenta({ codigo: '62900000', nombre: 'Otros servicios' }, new Map(), otro))).toEqual({ A: '62900000', F: 'Otros servicios' })
  })
})

describe('La fila de una cuenta nueva', () => {
  const cuentas = new Map([['4000000123', '40000123'], ['62900000', '62900000']])
  it('proveedor: subcuenta convertida, nombre, NIF y su cuenta de gasto habitual', () => {
    expect(filaSubcuenta({ codigo: '4000000123', nombre: ' Proveedor Inventado X03, S.L. ', nif: 'B00000000', gastoHabitual: '62900000' }, cuentas))
      .toEqual(['40000123', 'Proveedor Inventado X03, S.L.', 'B00000000', '62900000'])
  })
  it('una cuenta que no es de tercero: sin NIF ni gasto', () => {
    expect(filaSubcuenta({ codigo: '62900000', nombre: 'Otros servicios' }, cuentas)).toEqual(['62900000', 'Otros servicios', '', ''])
  })
})

describe('Los nombres de los PDF', () => {
  it('solo letras sin tilde, cifras, guion y guion bajo, y se reconocen: fecha, proveedor y número', () => {
    const usados = new Set<string>()
    const a = nombrePdf({ fechaFactura: '2026-10-28', proveedor: 'Panadería Ñandú & Cía., S.L.', numero: 'FA 2026/0001' }, usados)
    expect(a).toBe('20261028_Panaderia-Nandu-Cia-S-L_FA-2026-0001.pdf')
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.pdf$/)
  })
  it('sin repetidos dentro de una salida (también si solo cambia la caja)', () => {
    const usados = new Set<string>()
    const o = { fechaFactura: '2026-10-28', proveedor: 'Proveedor Inventado', numero: 'F-1' }
    expect([nombrePdf(o, usados), nombrePdf(o, usados), nombrePdf({ ...o, proveedor: 'PROVEEDOR INVENTADO' }, usados)])
      .toEqual(['20261028_Proveedor-Inventado_F-1.pdf', '20261028_Proveedor-Inventado_F-1_2.pdf', '20261028_PROVEEDOR-INVENTADO_F-1_3.pdf'])
  })
  it('largo acotado y nunca vacío', () => {
    const x = nombrePdf({ fechaFactura: '2026-10-28', proveedor: 'Ñ'.repeat(5) + '—'.repeat(80), numero: '///' }, new Set())
    expect(x).toBe('20261028_NNNNN_sin-nombre.pdf')
    expect(nombrePdf({ fechaFactura: '2026-10-28', proveedor: 'a'.repeat(100), numero: 'b'.repeat(100) }, new Set()).length).toBeLessThanOrEqual(9 + 31 + 31 + 4)
  })
  it('la ruta: la carpeta de la ficha y el nombre, sin barras dobles', () => {
    expect(rutaPdf('C:\\ERP10\\Documentos\\E01\\', 'x.pdf')).toBe('C:\\ERP10\\Documentos\\E01\\x.pdf')
    expect(rutaPdf('C:\\ERP10\\Documentos\\E01', 'x.pdf')).toBe('C:\\ERP10\\Documentos\\E01\\x.pdf')
  })
  it('el mismo nombre va en la fila y en la carpeta', () => {
    const s = prepararRecibidas([recibida([L('62900000', 10, 0), L('47200000', 2.1, 0, [21, 10]), L('40000001', 0, 12.1)])], OPC)
    expect(celdas(s.filas[0].fila).Z).toBe(`C:\\ERP10\\Documentos\\E01\\${s.filas[0].pdf}`)
  })
})

describe('El libro de Excel', () => {
  it('se vuelve a leer y da lo mismo: sin títulos, fechas como fecha, textos como texto, importes como número', async () => {
    const r = recibida([L('62900000', 100, 0), L('47200000', 21, 0, [21, 100]), L('40000001', 0, 121)], { numero: '000123', nif: '00000000T' })
    const s = prepararRecibidas([r], OPC)
    const sub = filaSubcuenta({ codigo: '40000001', nombre: 'Proveedor Inventado X03, S.L.', nif: '00000000T' }, new Map())
    for (const [filas, esperado] of [[s.filas.map((f) => f.fila), s.filas[0].fila], [[sub], sub]] as const) {
      const wb = XLSX.read(new Uint8Array(await libroErp10(filas)), { type: 'array', cellDates: false, cellNF: true })
      expect(wb.SheetNames).toHaveLength(1)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const leidas = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true, defval: '' })
      expect(leidas).toHaveLength(1) // una fila, sin la de títulos
      esperado.forEach((v, i) => {
        const celda = ws[XLSX.utils.encode_cell({ r: 0, c: i })]
        if (v === '') { expect(celda).toBeUndefined(); return }
        if (typeof v === 'string' && /T12:00:00\.000Z$/.test(v)) {
          expect(celda.t).toBe('n'); expect(celda.z).toBe('dd/mm/yyyy')
          expect(XLSX.SSF.format('dd/mm/yyyy', celda.v)).toBe(v.slice(0, 10).split('-').reverse().join('/'))
        } else if (typeof v === 'string') {
          expect(celda.t).toBe('s'); expect(celda.v).toBe(v)
        } else {
          expect(celda.t).toBe('n'); expect(celda.v).toBe(v)
        }
      })
    }
    // Un texto que empieza por cero lo conserva.
    const wb = XLSX.read(new Uint8Array(await libroErp10(s.filas.map((f) => f.fila))), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    expect(ws.I1.v).toBe('000123')
    expect(ws.AC1.v).toBe('00000000T')
  })
  it('la huella de cada fila: la misma fila, la misma huella; otra fila, otra', async () => {
    const a = ['40000001', 100, '2026-11-05T12:00:00.000Z']
    expect(await huellaFila(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(await huellaFila([...a])).toBe(await huellaFila(a))
    expect(await huellaFila(['40000001', 100.01, '2026-11-05T12:00:00.000Z'])).not.toBe(await huellaFila(a))
  })
})
