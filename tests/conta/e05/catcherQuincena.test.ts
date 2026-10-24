// E05 · Tarea 2 · La quincena de Catcher leída: los tres ficheros reconocidos,
// una factura por PDF con su emisor, su local y lo que pide la norma, y el
// PDF comprobado contra el Excel (con el texto que saca pdfjs de verdad).
// Ejemplo inventado con la forma de los reales (ejemplo.ts).
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  comprobarPdf, confianzaDe, etiquetaQuincena, textoPorPosicion, loteParaRegistrar, fechaExcel, leerFacturas, leerQuincena, LoteNoValido, madridAUtc, reconocer, resumen, type Fichero,
} from '../../../src/modules/conta/lib/catcherQuincena'
import * as XLSX from 'xlsx'
import { eurosExactos } from '../../../src/modules/conta/lib/formato'
import { EMPRESA, excelFacturas, excelPedidos, FACTURAS, pdf, quincenaInventada, TIENDA_A, TIENDA_B, zip } from './ejemplo'

const TIENDAS = { [TIENDA_A]: 'local-carabanchel', [TIENDA_B]: 'local-alcala' }
const o = { tiendas: TIENDAS, empresa: { nif: EMPRESA.nif } }

type Trozo = { str?: string; transform?: number[] }
async function trozos(bytes: Uint8Array): Promise<Trozo[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const r: Trozo[][] = []
  for (let i = 1; i <= doc.numPages; i++) r.push((await (await doc.getPage(i)).getTextContent()).items as Trozo[])
  return r
}
/** Lo mismo que textoPdf de catcherService: por posición. */
async function textoPdf(bytes: Uint8Array): Promise<string> {
  return (await trozos(bytes)).map((p) => textoPorPosicion(p)).join('\n')
}
/** Como se leía hasta el 22/10: los trozos en el orden en que el PDF los dibuja. */
async function textoEnOrdenDeDibujo(bytes: Uint8Array): Promise<string> {
  return (await trozos(bytes)).map((p) => p.map((x) => x.str ?? '').join(' ')).join('\n')
}

describe('reconocer: qué es cada fichero, por lo que lleva dentro', () => {
  it('los tres, en cualquier orden y con cualquier nombre', () => {
    const [z, f, p] = quincenaInventada()
    for (const orden of [[z, f, p], [p, z, f], [f, p, z]]) {
      const r = reconocer(orden.map((x, i) => ({ ...x, nombre: `fichero-${i}${x.nombre.slice(x.nombre.lastIndexOf('.'))}` })))
      expect(r.clases.map((x) => x.clase).sort()).toEqual(['facturas', 'pedidos', 'zip'])
    }
  })
  it('si falta uno, dice cuál; si sobra uno, lo dice; dos del mismo, también', () => {
    const [z, f, p] = quincenaInventada()
    expect(() => reconocer([z, f])).toThrow(/Falta el Excel de PEDIDOS/)
    expect(() => reconocer([f, p])).toThrow(/Falta el ZIP/)
    expect(() => reconocer([z, f, p, { nombre: 'notas.txt', bytes: new TextEncoder().encode('hola') }])).toThrow(/No sé qué es notas\.txt/)
    expect(() => reconocer([z, f, f, p])).toThrow(/dos Excel de FACTURAS/)
    expect(() => reconocer([z, f, p])).not.toThrow()
  })
})

describe('leerQuincena: una factura por PDF, con los datos del Excel', () => {
  const q = leerQuincena(quincenaInventada(), o)
  it('el periodo, la etiqueta y el resumen', () => {
    expect([q.desde, q.hasta, q.etiqueta]).toEqual(['2026-09-16', '2026-09-30', '2.ª quincena de septiembre de 2026'])
    const total = FACTURAS.reduce((t, f) => t + Math.round(f.total * 100), 0) / 100
    expect(resumen(q)).toBe(`2.ª quincena de septiembre de 2026 · 5 facturas · ${eurosExactos(total)}`)
    expect(q.problemas).toEqual([]); expect(q.avisos).toEqual([])
  })
  it('los totales: la suma de las facturas del Excel, por tipo', () => {
    const base = FACTURAS.reduce((t, f) => t + Math.round(f.base * 100), 0) / 100
    expect(q.totales).toMatchObject({ facturas: 5, base, porTipo: { rider: { facturas: 3 }, flota: { facturas: 1 }, catcher: { facturas: 1 } } })
    expect(q.totales.porTipo.rider.total + q.totales.porTipo.flota.total + q.totales.porTipo.catcher.total).toBeCloseTo(q.totales.total, 2)
  })
  it('cada una: su tipo, su emisor con NIF/NIE (normalizado), su PDF y el 21 %', () => {
    expect(q.facturas.map((f) => [f.numero, f.tipo, f.emisor.nif, f.pdf?.nombre, f.tipoIva])).toEqual(FACTURAS.map((f) => [f.numero, f.tipo, f.nif, f.pdf, 21]))
  })
  it('el local: el de su tienda; si reparte en dos tiendas, ninguno y el reparto lo dice', () => {
    const por = Object.fromEntries(q.facturas.map((f) => [f.numero, f]))
    expect(por.ES_I_1002_26_7.localId).toBe('local-alcala')
    expect(por.ES_I_1003_26_7.localId).toBe('local-carabanchel')
    expect(por.ES_F_2001_26_7.localId).toBe('local-alcala')
    expect(por.ES_I_1001_26_7.localId).toBeNull()
    expect(por.ES_I_1001_26_7.reparto).toEqual([{ tienda: TIENDA_A, localId: 'local-carabanchel', total: 12.24 }, { tienda: TIENDA_B, localId: 'local-alcala', total: 8.16 }])
    expect(por.CMS_2026_09_2.reparto.map((x) => x.localId)).toEqual(['local-alcala', 'local-carabanchel'])
  })
  it('los pedidos: el código se repite, la clave es código + fecha y hora (en UTC desde la de Madrid)', () => {
    const g901 = q.pedidos.filter((p) => p.codigo === 'G901' && p.tipo === 'rider to pitcher')
    expect(g901.map((p) => p.momento)).toEqual(['2026-09-16T11:05:00.000Z', '2026-09-27T18:15:00.000Z'])
    const g236 = q.pedidos.filter((p) => p.codigo === 'G236')
    expect(g236).toEqual([{ factura: 'CMS_2026_09_2', tipo: 'pitcher commissions', codigo: 'G236', estado: 'canceled', momento: '2026-09-23T14:29:00.000Z', base: 0.79, cuota: 0.17, total: 0.96 }])
  })
  it('la norma (RD 1619/2012, art. 6): todas la cumplen', () => {
    for (const f of q.facturas) expect(f.requisitos.filter((x) => !x.ok).map((x) => x.id), f.numero).toEqual([])
  })
})

describe('lo que no cuadra no se inventa', () => {
  it('una tienda sin local: la factura queda sin local y lo avisa', () => {
    const q = leerQuincena(quincenaInventada(), { ...o, tiendas: { [TIENDA_A]: 'local-carabanchel' } })
    expect(q.facturas.find((f) => f.numero === 'ES_I_1002_26_7')!.localId).toBeNull()
    expect(q.avisos).toContain(`La tienda «${TIENDA_B}» de la factura ES_I_1002_26_7 no tiene local.`)
  })
  it('un PDF sin factura y una factura sin PDF, los dos avisados', () => {
    const [, f, p] = quincenaInventada()
    const z = { nombre: 'q.zip', bytes: zip(FACTURAS.slice(1), { 'invoice_9999_ES_I_9999_26_7.pdf': pdf(FACTURAS[0], { numero: 'ES_I_9999_26_7' }) }) }
    const q = leerQuincena([z, f, p], o)
    expect(q.avisos).toEqual(expect.arrayContaining(['El PDF invoice_9999_ES_I_9999_26_7.pdf no es de ninguna factura del Excel.', 'La factura ES_I_1001_26_7 no tiene su PDF en el ZIP.']))
    expect(q.facturas[0].pdf).toBeNull()
  })
  it('facturas de dos periodos: no se lee como una quincena', () => {
    const wb = XLSX.read(excelFacturas(), { type: 'array' })
    const h = wb.Sheets.Invoices
    h.P3 = { t: 's', v: '2026-09-01' }; h.Q3 = { t: 's', v: '2026-09-15' }
    const f: Fichero = { nombre: 'f.xlsx', bytes: new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })) }
    const q = leerQuincena([{ nombre: 'z.zip', bytes: zip() }, f, { nombre: 'p.xlsx', bytes: excelPedidos() }], o)
    expect(q.problemas).toContain('Las facturas son de 2 periodos distintos: sube una quincena cada vez.')
  })
  it('la norma: un NIF sin forma, otra empresa de destinataria o una cuota que no es el 21 %, cada uno con su porqué', () => {
    const wb = XLSX.read(excelFacturas(), { type: 'array' })
    const h = wb.Sheets.Invoices
    h.F2 = { t: 's', v: 'X12' }; h.C3 = { t: 'n', v: 1 }; h.K4 = { t: 's', v: 'B99999999' }
    const { facturas } = leerFacturas(wb)
    const q = leerQuincena([{ nombre: 'z.zip', bytes: zip() }, { nombre: 'f.xlsx', bytes: new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })) }, { nombre: 'p.xlsx', bytes: excelPedidos() }], o)
    const mal = (n: string) => q.facturas.find((f) => f.numero === n)!.requisitos.filter((x) => !x.ok).map((x) => x.id)
    expect(facturas[0].emisor.nif).toBe('X12')
    expect(mal('ES_I_1001_26_7')).toEqual(['emisor_nif'])
    expect(mal('ES_I_1002_26_7')).toEqual(['tipo', 'cuota', 'total'])
    expect(mal('ES_I_1003_26_7')).toEqual(['es_a_la_empresa'])
  })
  it('un fichero que no es lo que dice ser: ZIP roto', () => {
    const [, f, p] = quincenaInventada()
    const roto = { nombre: 'z.zip', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) }
    expect(() => leerQuincena([roto, f, p], o)).toThrow(LoteNoValido)
  })
})

describe('comprobarPdf: el PDF dice lo mismo que el Excel (texto de pdfjs)', () => {
  const q = leerQuincena(quincenaInventada(), o)
  it('los cinco PDF cuadran en todo', async () => {
    for (const f of q.facturas) {
      const ex = leerFacturas(XLSX.read(excelFacturas(), { type: 'array' })).facturas.find((x) => x.numero === f.numero)!
      const r = comprobarPdf(ex, await textoPdf(f.pdf!.bytes))
      expect(r.filter((x) => !x.ok).map((x) => x.id), f.numero).toEqual([])
      // Las que reparten en dos tiendas, con local las dos, también son seguras: es su reparto.
      expect(confianzaDe({ ...f, contraPdf: r })).toBe('seguro')
    }
  })
  it('un PDF con otro total, otro NIF y otros pedidos: lo dice, cada cosa por su nombre', async () => {
    const ex = leerFacturas(XLSX.read(excelFacturas(), { type: 'array' })).facturas[1]
    const r = comprobarPdf(ex, await textoPdf(pdf(FACTURAS[1], { total: 9.99, nif: '00000009Z', pedidos: 3 })))
    expect(r.filter((x) => !x.ok).map((x) => x.id)).toEqual(['pdf_nif', 'pdf_total', 'pdf_pedidos'])
  })
  it('«Pedidos entregados:» y su número, dos trozos que el PDF no dibuja seguidos: por posición cuadra; en orden de dibujo, no (las 83 del 18/10)', async () => {
    const ex = leerFacturas(XLSX.read(excelFacturas(), { type: 'array' })).facturas[1]
    const bytes = pdf(FACTURAS[1])
    const pos = await textoPdf(bytes)
    expect(pos).toMatch(new RegExp(`Pedidos entregados: ${FACTURAS[1].pedidos}\\n`))
    expect(pos).toMatch(/Servicio de recogida y entrega de paquetes o comida a \d+,\d\d € \d+,\d\d €\ndomicilio\nEjercicio: /)
    expect(comprobarPdf(ex, pos).find((x) => x.id === 'pdf_pedidos')!.ok).toBe(true)
    const dibujo = await textoEnOrdenDeDibujo(bytes)
    expect(comprobarPdf(ex, dibujo).filter((x) => !x.ok).map((x) => x.id)).toEqual(['pdf_pedidos'])
  })
  it('textoPorPosicion: de arriba abajo y de izquierda a derecha, una línea por altura', () => {
    const t = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] })
    expect(textoPorPosicion([t('Total:', 300, 100), t('2', 120, 200), t('Pedidos entregados:', 40, 200.8), t(' ', 0, 50), t('6,81 €', 400, 100)]))
      .toBe('Pedidos entregados: 2\nTotal: 6,81 €')
  })
  it('sin comprobar el PDF, no es segura', () => {
    expect(confianzaDe(q.facturas[1])).toBe('duda')
  })
})

describe('fechas y horas: Madrid → UTC (regla 4)', () => {
  it('verano (+2) e invierno (+1), y el serial de Excel', () => {
    expect(madridAUtc(2026, 9, 23, 16, 29)).toBe('2026-09-23T14:29:00.000Z')
    expect(madridAUtc(2026, 11, 2, 16, 29)).toBe('2026-11-02T15:29:00.000Z')
    expect(fechaExcel('23/09/2026 16:29')).toEqual({ dia: '2026-09-23', utc: '2026-09-23T14:29:00.000Z' })
    // 46288.6868… = 23/09/2026 16:29 (hora de pared).
    expect(fechaExcel(46288 + (16 * 60 + 29) / 1440)).toEqual({ dia: '2026-09-23', utc: '2026-09-23T14:29:00.000Z' })
    expect(etiquetaQuincena('2026-09-01')).toBe('1.ª quincena de septiembre de 2026')
  })
})

describe('loteParaRegistrar: lo que se manda a la base', () => {
  it('cada factura con su PDF subido (ruta y huella, sin los bytes), su confianza y los pedidos', () => {
    const q = leerQuincena(quincenaInventada(), o)
    const pdfs = { ES_I_1002_26_7: { ruta: 'acc/lote/00-invoice.pdf', nombre: 'invoice_1002_ES_I_1002_26_7.pdf', sha256: 'f'.repeat(64), bytes: 2000 } }
    const l = loteParaRegistrar(q, pdfs, [{ clase: 'zip', nombre: 'z.zip', sha256: 'a'.repeat(64), bytes: 10 }])
    expect(l).toMatchObject({ proveedor: 'catcher', desde: '2026-09-16', hasta: '2026-09-30', etiqueta: '2.ª quincena de septiembre de 2026' })
    expect(l.facturas).toHaveLength(5)
    const f = l.facturas.find((x) => x.numero === 'ES_I_1002_26_7')!
    expect(f.pdf).toEqual(pdfs.ES_I_1002_26_7)
    expect(JSON.stringify(l)).not.toMatch(/"bytes":\{/)
    expect(l.facturas.filter((x) => x.pdf === null)).toHaveLength(4)
    expect(l.pedidos).toHaveLength(q.pedidos.length)
  })
})

describe('confianzaDe: el reparto entre tiendas no es un problema; una tienda sin local, sí', () => {
  it('dos tiendas con local, segura; una sin local, por mirar', async () => {
    const q = leerQuincena(quincenaInventada(), o)
    const f = q.facturas.find((x) => x.numero === 'ES_I_1001_26_7')!
    const ex = leerFacturas(XLSX.read(excelFacturas(), { type: 'array' })).facturas.find((x) => x.numero === f.numero)!
    const r = comprobarPdf(ex, await textoPdf(f.pdf!.bytes))
    expect(f.localId).toBeNull()
    expect(confianzaDe({ ...f, contraPdf: r })).toBe('seguro')
    expect(confianzaDe({ ...f, contraPdf: r, reparto: [f.reparto[0], { ...f.reparto[1], localId: null }] })).toBe('duda')
    expect(confianzaDe({ ...f, contraPdf: r, reparto: [] })).toBe('duda')
  })
})
