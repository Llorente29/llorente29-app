// C02c · El lector de los PDF de Cegid Diez (respuesta 1.4), contra la fixture
// INVENTADA con la forma de los PDF reales (tests/conta/fixtures/importar/diez/,
// generada por generar.mjs + pdfDiez.mjs). Pasa por pdfjs-dist de verdad (su
// build «legacy», la de node) y por el mismo celdasPdf que usa el navegador.
//
// La vara (regla 31): lo que sale del PDF se compara con lo que sale del CSV de
// los MISMOS datos, leído por el camino del Excel. Y la trampa de los nombres
// partidos se demuestra presente en la fixture antes de probar que no muerde.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { adivinarColumnas, juntar, leerTabla, partirCsv, type Lectura } from '@/modules/conta/lib/importarPlan'
import { codigoPostal, leerPdfDiez, PdfNoReconocido, queListado, textoDeGlifos, type PaginaPdf } from '@/modules/conta/lib/lectorDiez'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'

const dir = join(__dirname, '../../../conta/fixtures/importar/diez')
const bytes = (f: string) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }
const PDFJS = pdfjs as unknown as PdfJs
const celdas = (f: string) => celdasPdf(PDFJS, bytes(f))

function lecturaCsv(f: string): Lectura {
  const filas = partirCsv(readFileSync(join(dir, f), 'utf8'))
  const { columnas, cabecera } = adivinarColumnas(filas)
  if (!columnas) throw new Error(`sin columnas en ${f}`)
  return leerTabla('diez', filas, columnas, cabecera)
}

/** El texto «montado» de pdfjs (getTextContent), el que parte palabras. */
async function textoMontado(f: string): Promise<string[]> {
  const carga = pdfjs.getDocument({ data: new Uint8Array(bytes(f)), verbosity: 0 })
  const doc = await carga.promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent()
    for (const it of tc.items) if ('str' in it && it.str.trim()) out.push(it.str)
  }
  await carga.destroy()
  return out
}

describe('textoDeGlifos: las letras, sin los ajustes de posición', () => {
  it('un ajuste grande no es un espacio; el carácter espacio, sí', () => {
    const g = (s: string) => [...s].map((unicode) => ({ unicode }))
    // Como en el PDF real: un ajuste de -111,75 dentro de una palabra y uno pequeño antes de un espacio.
    expect(textoDeGlifos([...g('NOR'), -111.75, ...g('TE')])).toBe('NORTE')
    expect(textoDeGlifos([...g('UBER'), 34.7, ...g(' '), ...g('EATS')])).toBe('UBER EATS')
    expect(textoDeGlifos([null, 12, ...g('Ñ')])).toBe('Ñ')
  })
})

describe('los tres PDF de la fixture', () => {
  it('cada uno se reconoce por su título y cuadra con su «(N registros)» y su «Página: X de Y»', async () => {
    const plan = leerPdfDiez(await celdas('plan.pdf'), 'plan.pdf')
    const prov = leerPdfDiez(await celdas('proveedores.pdf'), 'proveedores.pdf')
    const cli = leerPdfDiez(await celdas('clientes.pdf'), 'clientes.pdf')
    expect([plan.listado, prov.listado, cli.listado]).toEqual(['plan', 'proveedores', 'clientes'])
    expect(plan.registros).toBe(plan.lectura.cuentas.length)
    expect(prov.registros).toBe(57) // 55 terceros + 40000000 y 41000000, como en el listado real
    expect(cli.registros).toBe(9)
    expect(plan.lectura.avisos).toEqual([])
  })

  it('el plan del PDF es el del CSV de los mismos datos: mismos códigos, mismos nombres', async () => {
    const pdf = leerPdfDiez(await celdas('plan.pdf'), 'plan.pdf').lectura.cuentas
    // Del CSV, solo las subcuentas: grupo, subgrupo y cuenta van en la columna de títulos del PDF.
    const csv = lecturaCsv('plan.csv').cuentas
    expect(pdf.map((c) => [c.code, c.nombre])).toEqual(csv.map((c) => [c.code, c.nombre]))
    expect(pdf.length).toBe(711)
  })

  it('los terceros del PDF son los del CSV: mismo código, NIF y nombre', async () => {
    const terceros = async (f: string) => leerPdfDiez(await celdas(f), f).lectura.terceros
    const pdf = [...await terceros('proveedores.pdf'), ...await terceros('clientes.pdf')]
    const csv = [...lecturaCsv('proveedores.csv').terceros, ...lecturaCsv('clientes.csv').terceros]
    const clave = (t: { code: string; nif: string | null; nombre: string }) => `${t.code} ${t.nif} ${t.nombre}`
    expect(pdf.map(clave)).toEqual(csv.map(clave))
    expect(pdf).toHaveLength(44) // 41 + 3 con NIF
  })

  it('la trampa está en la fixture (pdfjs «montado» parte nombres) y el lector no cae', async () => {
    const montado = await textoMontado('proveedores.pdf')
    const buenos = new Set(lecturaCsv('proveedores.csv').cuentas.map((c) => c.nombre))
    // Un trozo montado que, quitando UN espacio, es un nombre bueno: está partido.
    const partidos = montado.filter((t) => !buenos.has(t) && [...t].some((ch, i) => ch === ' ' && buenos.has(t.slice(0, i) + t.slice(i + 1))))
    expect(partidos.length).toBeGreaterThan(5)
    const leidos = leerPdfDiez(await celdas('proveedores.pdf'), 'proveedores.pdf').lectura.cuentas.map((c) => c.nombre)
    for (const p of partidos) expect(leidos).not.toContain(p)
    // Y las cuentas «cabecera» del listado, también enteras.
    expect(leidos).toContain('PROVEEDORES (EUROS)')
  })

  it('el código postal sin su cero (Diez escribe 8018) vuelve a ser 08018; la dirección y la población llegan', async () => {
    const t = leerPdfDiez(await celdas('proveedores.pdf'), 'proveedores.pdf').lectura.terceros.find((x) => x.code === '40000005')!
    expect(t).toMatchObject({ cp: '08018', poblacion: 'BARCELONA', provincia: 'BARCELONA', direccion: 'CALLE INVENTADA DEL MAR, 86' })
    expect(codigoPostal('28005')).toBe('28005')
    expect(codigoPostal(null)).toBeNull()
  })

  it('juntos (plan + listados) dan la misma lectura que los tres CSV', async () => {
    const pdf = juntar('diez', await Promise.all(['plan.pdf', 'proveedores.pdf', 'clientes.pdf'].map(async (f) => leerPdfDiez(await celdas(f), f).lectura)))
    const csv = juntar('diez', ['plan.csv', 'proveedores.csv', 'clientes.csv'].map(lecturaCsv))
    expect(pdf.cuentas.map((c) => c.code)).toEqual(csv.cuentas.map((c) => c.code))
    expect(pdf.terceros.map((t) => [t.code, t.nif])).toEqual(csv.terceros.map((t) => [t.code, t.nif]))
  })
})

describe('lo que hace parar al lector (y lo dice)', () => {
  it('falta una página: «Página: X de Y» no cuadra', async () => {
    const p = await celdas('plan.pdf')
    expect(() => leerPdfDiez(p.slice(0, -1), 'plan.pdf')).toThrow(/dice que tiene \d+ páginas y llegan \d+/)
  })

  it('se pierde una fila: «(N registros)» no cuadra con lo leído', async () => {
    const p = await celdas('clientes.pdf')
    const sinUna: PaginaPdf[] = [{ celdas: p[0].celdas.filter((c) => c.texto !== '43000004' ) }]
    expect(() => leerPdfDiez(sinUna, 'clientes.pdf')).toThrow(/dice «9 registros» y Folvy ha leído 8/)
  })

  it('un PDF que no es de Diez no se lee a medias', () => {
    const otro: PaginaPdf[] = [{ celdas: [{ x: 30, y: 700, texto: 'Factura 2026/0012' }, { x: 30, y: 680, texto: 'Total 121,00' }] }]
    expect(queListado(otro)).toBeNull()
    expect(() => leerPdfDiez(otro, 'factura.pdf')).toThrow(PdfNoReconocido)
  })

  it('sin la fila de cabecera no adivina columnas', () => {
    const sinCabecera: PaginaPdf[] = [{ celdas: [{ x: 30.8, y: 745, texto: 'Plan de Cuentas' }, { x: 138.8, y: 700, texto: '10000000' }] }]
    expect(() => leerPdfDiez(sinCabecera, 'plan.pdf')).toThrow(/no encuentro la fila de cabecera/)
  })
})
