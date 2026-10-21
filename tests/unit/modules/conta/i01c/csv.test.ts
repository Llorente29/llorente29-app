// tests/unit/modules/conta/i01c/csv.test.ts
//
// I01c · P1 definitiva · El justificante por CSV: lo que el navegador saca del
// PDF antes y después de traerlo de Hacienda, contra PDF INVENTADOS
// (tests/conta/fixtures/justificantes/pdfJustificante.mjs) pasados por pdfjs de
// verdad y por el mismo celdasPdf del navegador.
//
// · Del original: el expediente y el presentador (la gestoría), además de lo de
//   la pieza 1.
// · Del REIMPRESO («Microsoft Print to PDF»): no se lee nada más que el CSV, que
//   es lo que hace falta para traer el original de Hacienda.

import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'
import { csvDelPdf, csvValido, leerJustificante, limpiarCsv } from '@/modules/conta/lib/justificanteAeat'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf, otroDocumentoPdf, sinTextoPdf } from '../../../../conta/fixtures/justificantes/pdfJustificante.mjs'

const PDFJS = pdfjs as unknown as PdfJs
type J = { modelo: string; ejercicio: number; periodo: string; csv: string; casillas: Record<string, number> }
const TODOS = JUSTIFICANTES_A as Record<string, J>
const paginas = (b: ArrayBuffer) => celdasPdf(PDFJS, b)

describe('el original: también el expediente y el presentador', () => {
  it('303 del 3T: expediente de la primera página y el presentador con su NIF y su nombre', async () => {
    const l = leerJustificante(await paginas(justificantePdf(TODOS['303-3T-2025'])))
    if (!l.ok) throw new Error(l.motivo)
    expect(l.datos.expediente).toBe('2026PRUEBA3033T')
    expect(l.datos.presentador).toEqual({ nif: '00000000T', nombre: 'GESTORIA INVENTADA DE PRUEBA' })
    // Y el NIF del declarante sigue siendo el de la empresa, no el del presentador.
    expect(l.datos.nif).toBe('B28000016')
  })
})

describe('el CSV de un PDF', () => {
  it('del original, por su rótulo', async () => {
    for (const j of Object.values(TODOS)) expect(csvDelPdf(await paginas(justificantePdf(j)))).toEqual({ csv: j.csv, candidatos: [j.csv] })
  })
  it('del REIMPRESO, sin rótulos: el código de 16 que más se repite (primera página y pie)', async () => {
    for (const j of Object.values(TODOS)) {
      const p = await paginas(justificantePdf(j, { reimpreso: true }))
      // La trampa estaba: el reimpreso no se lee (sin «Modelo» ni casillas), pero el CSV sí sale.
      expect(leerJustificante(p).ok).toBe(false)
      expect(csvDelPdf(p).csv).toBe(j.csv)
    }
  })
  it('si dos códigos empatan, no se elige uno: se dan los dos', () => {
    const p = [{ celdas: [{ x: 10, y: 700, texto: 'PRUEBA0001AAAA11' }, { x: 10, y: 680, texto: 'PRUEBA0002BBBB22' }] }]
    expect(csvDelPdf(p as never)).toEqual({ csv: null, candidatos: ['PRUEBA0001AAAA11', 'PRUEBA0002BBBB22'] })
  })
  it('una factura o un escaneado no tienen CSV', async () => {
    expect(csvDelPdf(await paginas(otroDocumentoPdf())).csv).toBeNull()
    expect(csvDelPdf(await paginas(sinTextoPdf()))).toEqual({ csv: null, candidatos: [] })
  })
  it('un número de justificante (13 cifras) o un NRC (22) no son un CSV', () => {
    const p = [{ celdas: [{ x: 10, y: 700, texto: '9993030000003 PRUEBA0NRC0000000000ZZ 1234567890123456' }] }]
    expect(csvDelPdf(p as never).csv).toBeNull()
  })
})

describe('el formato, antes de llamar a Hacienda (cada fallo gasta un intento del día)', () => {
  it('16 letras y cifras; se quitan espacios y guiones y se pasa a mayúsculas', () => {
    expect([csvValido('prueba3t2025aaaa'), csvValido(' PRUE BA3T-2025AAAA '), csvValido('PRUEBA3T2025AAA'), csvValido('PRUEBA3T2025AAAA1'), csvValido('PRUEBA3T2025AAA!')])
      .toEqual([true, true, false, false, false])
    expect(limpiarCsv(' prue ba3t-2025aaaa ')).toBe('PRUEBA3T2025AAAA')
  })
})

describe('las palabras de la ficha y de Presentados', async () => {
  const { resultadoEnPalabras, compensadoEnPalabras, motivoEnPalabras } = await import('@/modules/conta/impuestos/justificantes')
  it('un 303 que sale a cero porque se compensó: «0,00 €» y debajo lo compensado (Julio, 19/10)', () => {
    expect(resultadoEnPalabras({ modelo: '303', resultado: { casilla: '71', importe: 0 }, casillas: { '27': 6131.5, '78': 647.28, '71': 0 } }))
      .toEqual({ importe: '0,00 €', que: 'resultado cero', compensado: '647,28 € compensado con trimestres anteriores' })
    expect(compensadoEnPalabras({ importe: 0, compensado: 647.28 })).toBe('647,28 € compensado con trimestres anteriores')
  })
  it('a compensar, con su importe sin signo; a ingresar; sin actividad (todo a cero); y sin leer', () => {
    expect(resultadoEnPalabras({ modelo: '303', resultado: { casilla: '71', importe: -2134.18 }, casillas: { '71': -2134.18 } }))
      .toEqual({ importe: '2.134,18 €', que: 'a compensar', compensado: null })
    expect(resultadoEnPalabras({ modelo: '111', resultado: { casilla: '30', importe: 1702.5 }, casillas: { '30': 1702.5 } }).que).toBe('a ingresar')
    expect(resultadoEnPalabras({ modelo: '303', resultado: { casilla: '71', importe: 0 }, casillas: { '71': 0 } }).que).toBe('sin actividad')
    expect(resultadoEnPalabras({ modelo: '303', resultado: null, casillas: {} })).toEqual({ importe: '—', que: 'resultado sin leer', compensado: null })
    // En Presentados, sin [78] o con resultado distinto de cero, no se dice nada de compensar.
    expect([compensadoEnPalabras({ importe: 0, compensado: null }), compensadoEnPalabras({ importe: 12, compensado: 30 })]).toEqual([null, null])
  })
  it('el de otro NIF, en palabras de oficina: «es de otra empresa»', () => {
    expect(motivoEnPalabras('Es de otro NIF (B12345674), no del de Taberna de Prueba Norte, S.L. (B28000016): no se guarda.'))
      .toBe('Ese justificante es de otra empresa (NIF B12345674).')
    expect(motivoEnPalabras('El ejercicio «1999» no es un año que pueda estar presentado.')).toBe('El ejercicio «1999» no es un año que pueda estar presentado.')
  })
})

describe('por qué no se lee, en una frase (Julio, 19/10)', async () => {
  const { fraseNoSeLee, fraseDeHacienda } = await import('@/modules/conta/impuestos/justificantes')
  it('traído de Hacienda y de un modelo que Sumied aún no lee: lo dice con su número', () => {
    expect(fraseNoSeLee({ motivo: 'No se encuentra el ejercicio ni el periodo.', causa: 'faltan_datos', parcial: { modelo: '111' } }, true))
      .toBe('Traído de Hacienda, pero Sumied aún no lee el modelo 111. Puedes escribir las cifras a mano.')
    expect(fraseNoSeLee({ motivo: '…', causa: 'modelo_ajeno', parcial: { modelo: '390' } }, true))
      .toBe('Traído de Hacienda, pero Sumied aún no lee el modelo 390. Puedes escribir las cifras a mano.')
  })
  it('sin CSV en el PDF, da igual por qué: que lo pegue', async () => {
    for (const b of [sinTextoPdf(), otroDocumentoPdf()]) {
      const l = leerJustificante(await paginas(b))
      if (l.ok) throw new Error('se ha leído')
      expect(fraseNoSeLee(l, false)).toBe('No encontramos el CSV en este PDF. Pégalo a mano.')
    }
  })
  it('lo que no es un PDF dice lo suyo, y nada se encadena', () => {
    expect(fraseNoSeLee({ motivo: 'Pasa de 10 MB: no parece un justificante.', causa: 'no_pdf', parcial: {} }, false)).toBe('Pasa de 10 MB: no parece un justificante.')
  })
  it('lo que contesta Hacienda, una frase por motivo', () => {
    const f = (motivo: string, mensaje = 'texto de la función') => fraseDeHacienda({ motivo, mensaje })
    expect(f('formato')).toBe('Ese CSV no tiene la forma de los de Hacienda: son 16 letras y números.')
    expect(f('no_encontrado')).toBe('Hacienda no tiene ningún justificante con ese CSV: revísalo letra a letra.')
    expect(f('no_responde')).toBe('Hacienda no responde ahora mismo: vuelve a intentarlo en un rato.')
    expect(f('ya_estaba', 'Ese justificante ya está en Presentados: el 303 del 2T/2026. No hace falta traerlo otra vez.'))
      .toBe('Ese justificante ya está en Presentados: el 303 del 2T/2026.')
    // Ninguna frase lleva dos puntos finales: una sola frase cada una.
    for (const m of ['formato', 'no_encontrado', 'no_responde']) expect(f(m).split('. ').length).toBe(1)
  })
})
