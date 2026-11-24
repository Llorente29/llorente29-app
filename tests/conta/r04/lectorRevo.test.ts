// R04 · El lector de las ventas de Revo (src/modules/conta/lib/lectorRevo.ts),
// contra el ejemplo INVENTADO de Julio (16/11), tal como llegó: cuatro CSV con
// CRLF y espacios delante (revo_ejemplo/, con su LEEME). NIF B00000000 y
// «Cliente de ejemplo N» / «Empleado de ejemplo N»: inventados a la vista (T11).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  fechaRevo, importeRevo, leer, leerRevo, reconocer, tipoRevo, type FicheroRevo, type Lectura,
} from '../../../src/modules/conta/lib/lectorRevo'

const DIR = resolve(__dirname, 'revo_ejemplo')
const NOMBRES = ['Ordenes_2026-11-09.csv', 'Documentos_2026-11-09.csv', 'Impuestos_2026-11-09.csv', 'Pagos_2026-11-09.csv'] as const
const bytes = (n: string) => new Uint8Array(readFileSync(resolve(DIR, n)))
const texto = (n: string) => readFileSync(resolve(DIR, n), 'utf8')
const ejemplo = (): FicheroRevo[] => NOMBRES.map((n) => ({ nombre: n, contenido: bytes(n) }))

/** Lee y exige que se haya reconocido. */
function lee(fs: FicheroRevo[]): Lectura {
  const r = leerRevo(fs)
  if (!r.ok) throw new Error(r.problemas.join(' | '))
  return r.lectura
}
/** Cambia líneas de un fichero del ejemplo (la 1 es la de los títulos), conservando sus CRLF. */
function cambiar(n: string, f: (linea: string, i: number) => string | null): FicheroRevo {
  const lineas = texto(n).split('\r\n')
  return { nombre: n, contenido: lineas.map((l, i) => (l === '' ? l : f(l, i + 1))).filter((l): l is string => l !== null).join('\r\n') }
}
const conCambio = (n: string, f: (linea: string, i: number) => string | null) => ejemplo().map((x) => (x.nombre === n ? cambiar(n, f) : x))
/** La celda k (0…) de una línea separada por «;». */
const conCelda = (l: string, k: number, v: string) => l.split(';').map((c, i) => (i === k ? v : c)).join(';')

describe('los títulos y los valores: cómo se lee cada celda', () => {
  it('importes con coma decimal, signo y miles; lo demás no se entiende', () => {
    expect(importeRevo('33,25')).toBe(3325)
    expect(importeRevo('-11')).toBe(-1100)
    expect(importeRevo('0')).toBe(0)
    expect(importeRevo(' 1.234,56 ')).toBe(123456)
    expect(importeRevo('1.234.567,8')).toBe(123456780)
    expect(importeRevo('−4,5')).toBe(-450)
    for (const mal of ['12,5,0', '12.5', '1.23,45', 'abc', '', '12,3456', '1,234.56']) expect(importeRevo(mal)).toBeNull()
    // R10 · Hasta 3 decimales (los ficheros de verdad): se redondea a céntimos.
    expect(importeRevo('12,345')).toBe(1235)
  })
  it('fechas «AAAA-MM-DD hh:mm:ss» que existen; el tipo de IVA de su texto', () => {
    expect(fechaRevo('2026-11-09 12:40:30')).toBe('2026-11-09 12:40:30')
    for (const mal of ['2026-02-30 10:00:00', '09/11/2026 12:40', '2026-11-09', '2026-11-09 25:00:00']) expect(fechaRevo(mal)).toBeNull()
    expect(tipoRevo('IVA 10%')).toBe(10)
    expect(tipoRevo('IVA 21 %')).toBe(21)
    expect(tipoRevo('IVA 5,5%')).toBe(5.5)
    expect(tipoRevo('IVA')).toBeNull()
  })
})

describe('reconocer: qué es cada fichero, por sus títulos', () => {
  it('los cuatro, con los nombres cambiados y en cualquier orden', () => {
    const fs = ejemplo()
    for (const orden of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
      const r = reconocer(orden.map((i, j) => ({ nombre: `export (${j}).csv`, contenido: fs[i].contenido })))
      expect(r.ok).toBe(true)
      expect(r.clases.map((c) => c.clase).sort()).toEqual(['documentos', 'impuestos', 'ordenes', 'pagos'])
    }
  })
  it('falta uno', () => {
    const r = reconocer(ejemplo().filter((f) => !f.nombre.startsWith('Pagos')))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problemas).toEqual(['Falta el fichero de pagos.'])
  })
  it('sobra uno: dos del mismo', () => {
    const r = reconocer([...ejemplo(), { nombre: 'documentos (copia).csv', contenido: bytes('Documentos_2026-11-09.csv') }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problemas).toEqual(['Has subido dos ficheros de documentos: «Documentos_2026-11-09.csv» y «documentos (copia).csv». Sube solo uno.'])
  })
  it('uno ajeno, y el que falta', () => {
    const r = reconocer([...ejemplo().slice(0, 3), { nombre: 'extracto banco.csv', contenido: 'Fecha;Concepto;Importe\r\n2026-11-09;Algo;1,00\r\n' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problemas).toEqual([
      'No reconozco el fichero «extracto banco.csv»: no es ninguno de los cuatro de Revo (órdenes, documentos, impuestos y pagos).',
      'Falta el fichero de pagos.',
    ])
  })
})

describe('leer el ejemplo: lo que dice su LEEME', () => {
  const l = lee(ejemplo())
  const d = l.dias[0]

  it('un día, leído entero y sin nada que decir', () => {
    expect(l.dias.map((x) => x.dia)).toEqual(['2026-11-09'])
    expect(d.leido).toBe(true)
    expect(l.problemas).toEqual([])
    expect(l.avisos).toEqual([])
  })
  it('48 facturas, de la 5001 a la 5048; 1.100,00 = 999,99 + 100,01', () => {
    expect(d.lectura.documentos).toHaveLength(48)
    expect(d.lectura.impuestos).toHaveLength(48)
    expect(d.lectura.cobros).toHaveLength(49)
    expect([d.resumen.facturas, d.resumen.primero, d.resumen.ultimo]).toEqual([48, 5001, 5048])
    expect([d.resumen.total, d.resumen.base, d.resumen.cuota]).toEqual([1100, 999.99, 100.01])
    expect(d.resumen.contadores).toEqual(['Facturas'])
  })
  it('por forma de pago y por canal', () => {
    expect(d.resumen.porForma).toEqual([{ forma: 'Deliverect', importe: 500 }, { forma: 'Efectivo', importe: 180 }, { forma: 'Tarjeta', importe: 420 }])
    expect(d.resumen.porCanal).toEqual([{ canal: 'en el local', importe: 600 }, { canal: 'Glovo', importe: 300 }, { canal: 'UberEats', importe: 200 }])
  })
  it('la 700028 en dos cobros, la 700047 en negativo', () => {
    expect(d.lectura.cobros.filter((c) => c.orden === '700028').map((c) => [c.forma, c.importe])).toEqual([['Efectivo', 20], ['Tarjeta', 24]])
    expect(d.lectura.documentos.filter((x) => x.total < 0).map((x) => [x.orden, x.numero, x.canal, x.total])).toEqual([['700047', 5047, 'Glovo', -11]])
    expect(d.resumen.devoluciones).toEqual([{ numero: 5047, total: -11 }])
  })
  it('NIF y nombre en la 5007 y la 5020; ningún nombre en las otras 46', () => {
    const conNif = d.lectura.documentos.filter((x) => x.nif)
    expect(conNif.map((x) => [x.numero, x.nif])).toEqual([[5007, 'B00000000'], [5020, 'B00000000']])
    expect(conNif.every((x) => x.cliente)).toBe(true)
    const sin = d.lectura.documentos.filter((x) => !x.nif)
    expect(sin).toHaveLength(46)
    expect(sin.every((x) => x.cliente === null)).toBe(true)
  })
  it('cada cobro con su línea en el fichero de pagos (la 1 es la de los títulos)', () => {
    expect(d.lectura.cobros.map((c) => c.fila)).toEqual(Array.from({ length: 49 }, (_, i) => i + 2))
  })
  it('el resumen, en una frase', () => {
    expect(d.resumen.texto).toBe(
      '09/11/2026: 48 facturas, de la 5001 a la 5048, 1.100,00 € (base 999,99 € e IVA 100,01 €). '
      + 'Por forma de pago: Deliverect 500,00 € · Efectivo 180,00 € · Tarjeta 420,00 €. '
      + 'Por canal: en el local 600,00 € · Glovo 300,00 € · UberEats 200,00 €. '
      + 'Con NIF: la 5007 y la 5020. Una devolución: la 5047 (−11,00 €).')
  })
})

describe('la misma lectura que la prueba SQL del R03, valor por valor', () => {
  // La prueba de staging del R03 lleva el ejemplo escrito como valores, entre $ejemplo$.
  const sql = readFileSync(resolve(__dirname, '../../../supabase/staging/sql/20261117_r03_ventas_tpv_prueba.sql'), 'utf8')
  const r03 = JSON.parse(sql.split('$ejemplo$')[1]) as { documentos: Record<string, unknown>[]; impuestos: Record<string, unknown>[]; cobros: Record<string, unknown>[] }
  const l = lee(ejemplo()).dias[0].lectura

  it('las facturas: iguales, salvo el nombre de las que no llevan NIF (decisión 5)', () => {
    expect(l.documentos.map((x) => ({ ...x, cliente: x.nif ? x.cliente : null })))
      .toEqual(r03.documentos.map((x) => ({ ...x, cliente: x.nif ? x.cliente : null })))
    expect(r03.documentos.filter((x) => !x.nif && x.cliente)).toHaveLength(22)   // la prueba SQL sí manda los 22 que trae el fichero
  })
  it('el IVA: igual', () => {
    expect(l.impuestos).toEqual(r03.impuestos)
  })
  it('los cobros: iguales, salvo la fila (la prueba SQL cuenta desde el primer pago; el lector, la línea del fichero)', () => {
    expect(l.cobros.map((c) => ({ ...c, fila: c.fila - 1 }))).toEqual(r03.cobros)
  })
})

describe('varios días en una exportación', () => {
  // Las facturas de la 5025 en adelante, al día siguiente. Los pagos y el IVA
  // siguen diciendo 09/11 en su propia fecha: van al día de SU documento.
  const fs = conCambio('Documentos_2026-11-09.csv', (l, i) => {
    if (i === 1) return l
    const c = l.split(';')
    return Number(c[1]) >= 5025 ? conCelda(l, 6, c[6].replace('2026-11-09', '2026-11-10')) : l
  })
  const l = lee(fs)

  it('dos lecturas, cada pago en el día de su documento', () => {
    expect(l.dias.map((d) => [d.dia, d.leido, d.resumen.facturas, d.resumen.primero, d.resumen.ultimo])).toEqual([
      ['2026-11-09', true, 24, 5001, 5024], ['2026-11-10', true, 24, 5025, 5048]])
    for (const d of l.dias) {
      const ordenes = new Set(d.lectura.documentos.map((x) => x.orden))
      expect(d.lectura.cobros.every((c) => ordenes.has(c.orden))).toBe(true)
      expect(d.lectura.impuestos.every((c) => ordenes.has(c.orden))).toBe(true)
      expect(d.lectura.documentos.every((x) => x.fecha.startsWith(d.dia))).toBe(true)
    }
    expect(l.dias.map((d) => d.lectura.cobros.length)).toEqual([24, 25])   // la 700028 es la 5028: sus dos cobros caen el 10
    expect(l.dias[1].lectura.cobros.filter((c) => c.orden === '700028')).toHaveLength(2)
    expect(l.dias.reduce((a, d) => a + Math.round(d.resumen.total * 100), 0)).toBe(110000)
  })
})

describe('la forma del fichero: marca de inicio, finales de línea, miles', () => {
  const base = lee(ejemplo()).dias
  it('con marca de inicio (BOM), igual', () => {
    const fs = ejemplo().map((f) => ({ ...f, contenido: '\uFEFF' + texto(f.nombre) }))
    expect(lee(fs).dias).toEqual(base)
  })
  it('con LF en vez de CRLF, igual', () => {
    const fs = ejemplo().map((f) => ({ ...f, contenido: texto(f.nombre).replace(/\r\n/g, '\n') }))
    expect(lee(fs).dias).toEqual(base)
  })
  it('en Windows-1252 (como lo guarda Excel), igual', () => {
    const win = (s: string) => new Uint8Array([...s].map((ch) => ({ 'ó': 0xf3, 'á': 0xe1, 'é': 0xe9, 'í': 0xed, 'ú': 0xfa, 'ñ': 0xf1 } as Record<string, number>)[ch] ?? ch.charCodeAt(0)))
    const fs = ejemplo().map((f) => ({ ...f, contenido: win(texto(f.nombre)) }))
    expect(lee(fs).dias).toEqual(base)
  })
  it('un importe de miles: «1.234,56»', () => {
    const t = (cab: string, fila: string) => `${cab}\r\n${fila}\r\n`
    const fs: FicheroRevo[] = [
      { nombre: 'o.csv', contenido: t('ID;Mesa;Sala;Empleado;Comensales;Abierto;Cerrado;Valor medio;Suma;Descuento;Subtotal;Impuesto total;Total;Entrega',
        '    900001;1;Local;Empleado de ejemplo 1;4;2026-11-09 21:00:00;2026-11-09 22:30:00;1.234,56;1.234,56;0;1.122,33;112,23;1.234,56;--') },
      { nombre: 'd.csv', contenido: t('Orden;Documento;Contador;Cliente;NIF;Grupos de clientes;Fecha;Suma;Descuento;Subtotal;Impuesto total;Total',
        '    900001;1;Facturas;;;;2026-11-09 21:00:00;1.234,56;0;1.122,33;112,23;1.234,56') },
      { nombre: 'i.csv', contenido: t('Orden;Impuesto;Total;Subtotal;Impuesto total;Fecha', '    900001;IVA 10%;1.234,56;1.122,33;112,23;2026-11-09 21:00:00') },
      { nombre: 'p.csv', contenido: t(';Orden;Total de la orden;Cliente;Factura;Caja;Fecha;Forma de pago;Turno;Empleado;Motivo de cancelación;Información adicional;Propina;Importe;Total',
        '    900001;900001;1.234,56;;1;Caja Principal;2026-11-09 22:30:00;Tarjeta;1;Empleado de ejemplo 1;;;0;1.234,56;1.234,56') },
    ]
    const d = lee(fs).dias[0]
    expect(d.leido).toBe(true)
    expect(d.lectura.documentos[0]).toMatchObject({ base: 1122.33, cuota: 112.23, total: 1234.56, canal: '--', cliente: null })
    expect(d.lectura.cobros).toEqual([{ fila: 2, orden: '900001', forma: 'Tarjeta', importe: 1234.56 }])
    expect(d.resumen.porCanal).toEqual([{ canal: 'en el local', importe: 1234.56 }])
  })
})

describe('lo que no se entiende se dice, y ese día no se da por leído', () => {
  it('un importe ilegible, con su fichero y su línea', () => {
    const l = lee(conCambio('Pagos_2026-11-09.csv', (x, i) => (i === 37 ? conCelda(x, 13, '12,5,0') : x)))
    expect(l.problemas).toEqual(['Línea 37 del fichero de pagos («Pagos_2026-11-09.csv»): no entiendo el importe «12,5,0».'])
    expect(l.dias.map((d) => [d.dia, d.leido])).toEqual([['2026-11-09', false]])
    expect(l.dias[0].problemas).toEqual(l.problemas)
    expect(l.dias[0].lectura.cobros).toHaveLength(48)   // ese pago no entra
  })
  it('una fecha ilegible en un documento: sin día, ningún día se da por leído', () => {
    const l = lee(conCambio('Documentos_2026-11-09.csv', (x, i) => (i === 10 ? conCelda(x, 6, '09/11/2026 13:00') : x)))
    expect(l.problemas[0]).toBe('Línea 10 del fichero de documentos («Documentos_2026-11-09.csv»): no entiendo la fecha «09/11/2026 13:00».')
    expect(l.dias.every((d) => !d.leido)).toBe(true)
  })
  it('una orden con pagos y sin documento', () => {
    const fs = ejemplo().map((f) => f.nombre.startsWith('Pagos')
      ? { ...f, contenido: texto(f.nombre) + '    799999;799999;5,00;;;Caja Principal;2026-11-09 23:30:00;Efectivo;8002;Empleado de ejemplo 1;;;0;5,00;5,00\r\n' }
      : f)
    const l = lee(fs)
    expect(l.problemas).toEqual(['La orden 799999 tiene pagos (línea 51 del fichero de pagos) y ningún documento.'])
    expect(l.dias[0].leido).toBe(false)
  })
  it('una forma de pago que el ejemplo no tiene se lee como viene', () => {
    const l = lee(conCambio('Pagos_2026-11-09.csv', (x, i) => (i === 2 ? conCelda(x, 7, 'Too Good To Go') : x)))
    expect(l.dias[0].leido).toBe(true)
    expect(l.dias[0].resumen.porForma.map((x) => x.forma)).toEqual(['Deliverect', 'Efectivo', 'Tarjeta', 'Too Good To Go'])
  })
  it('una orden sin documento ni pagos es un aviso, no impide leer el día', () => {
    const fs = ejemplo().map((f) => f.nombre.startsWith('Ordenes')
      ? { ...f, contenido: texto(f.nombre) + '    799998;5;Local;Empleado de ejemplo 1;2;2026-11-09 23:00:00;2026-11-09 23:10:00;7,50;7,50;0;6,82;0,68;7,50;--\r\n' }
      : f)
    const l = lee(fs)
    expect(l.problemas).toEqual([])
    expect(l.avisos).toEqual(['La orden 799998 (7,50 €) no tiene documento ni pagos: no entra en ningún día.'])
    expect(l.dias[0].leido).toBe(true)
  })
})

describe('leer sin reconocer antes', () => {
  it('leer() con lo que devuelve reconocer() da lo mismo que leerRevo()', () => {
    const r = reconocer(ejemplo())
    expect(r.ok).toBe(true)
    if (r.ok) expect(leer(r.ficheros)).toEqual(lee(ejemplo()))
  })
})
