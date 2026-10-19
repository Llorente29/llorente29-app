// tests/unit/modules/conta/i01c/sede.test.ts
//
// I01c · El lector con los ORIGINALES de Hacienda del 111, el 115 y el 202 (los
// que trae la consulta por CSV). El 19/10 los siete de Julio daban «no se
// encuentra el ejercicio ni el periodo»: en esos originales el valor no va
// pegado a su rótulo.
//
// La estructura se midió el 19/10 en Hacienda (run 39296209103, intento 2: tres
// consultas por CSV, una de cada modelo) y sacó SOLO la clase de cada palabra y
// su posición: ni un valor, ni el CSV, ni el NIF. Aquí:
//   1. las FIRMAS medidas de las líneas que importan (clases y orden, tal cual
//      salieron), contra los PDF inventados que las imitan (pdfJustificante.mjs,
//      opciones.sede): si el inventado deja de parecerse al de verdad, falla;
//   2. el lector contra esos inventados: modelo, ejercicio, periodo, casillas y
//      resultado, y que no coge la tira de cifras de la cabecera ni el rótulo
//      del presentador como su nombre.

import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'
import { esCasillaDePersonas, leerJustificante, lineas } from '@/modules/conta/lib/justificanteAeat'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_SEDE, justificantePdf } from '../../../../conta/fixtures/justificantes/pdfJustificante.mjs'

type J = { modelo: string; ejercicio: number; periodo: string; csv: string; justificante: string; nif: string; casillas: Record<string, number> }
const SEDE = JUSTIFICANTES_SEDE as Record<string, J>
const PDFJS = pdfjs as unknown as PdfJs
const paginas = async (j: J) => celdasPdf(PDFJS, justificantePdf(j, { sede: true }))

/** La clase de una palabra, con las mismas reglas que la medición (sin el texto, salvo los rótulos que importan). */
function clase(t: string): string {
  const w = t.replace(/^[[(«"']+|[\])».,;:"']+$/g, '')
  if (!w) return 'sig'
  if (/^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(w)) return 'imp'
  if (/^[1-4]T$|^[1-3]P$|^0A$/i.test(w)) return 'per'
  if (/^0\d$/.test(w)) return 'n2c'
  if (/^\d{1,3}$/.test(w)) return `n${w.length}`
  if (/^\d{4}$/.test(w)) return 'n4'
  const r = w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return ['ejercicio', 'periodo', 'resultado', 'ingresar', 'a', 'nrc', 'importe'].includes(r) ? r : 'pal'
}
/** La línea como clases, juntando las palabras sin interés («pal») seguidas. */
const firma = (tokens: { texto: string }[]) => tokens.map((x) => clase(x.texto)).filter((c, i, a) => !(c === 'pal' && a[i - 1] === 'pal')).join(' ')

describe('las firmas medidas en los originales (19/10), en los inventados', () => {
  // Tal cual las dio la medición, con las palabras que no importan como «pal».
  const MEDIDAS: Record<string, { pagina: number; firmas: string[] }[]> = {
    '111-1T-2026': [{ pagina: 2, firmas: [
      'n1 ejercicio sig periodo sig', // «Ejercicio · Período ·»: los rótulos…
      'n4 per', // …y sus valores, 4 puntos más abajo
      'pal sig n2c n1 n2c imp n2c imp', // «Rendimientos dinerarios . 01 3 02 14.250,00 03 1.567,50»
      'resultado a ingresar sig n2 pal n2 sig sig n2 imp', // «( 28 - 29 ) : 30 importe»
    ] }],
    '115-1T-2026': [{ pagina: 2, firmas: [
      'ejercicio sig n4', 'periodo sig per',
      'n1 imp', // la casilla «2» y su importe; su rótulo, 2 puntos más abajo
      'resultado a ingresar sig n1 pal n1 sig sig n1 imp', // «( 3 - 4 ) . 5 importe»
    ] }],
    '202-1P-2026': [
      { pagina: 1, firmas: ['nrc pal importe imp'] },
      { pagina: 2, firmas: ['pal ejercicio sig n4', 'periodo sig per', 'pal sig n2c imp', 'a ingresar sig n2c imp'] },
    ],
  }
  for (const [k, ms] of Object.entries(MEDIDAS)) {
    it(`${k}: cada línea medida está en el inventado`, async () => {
      const ps = await paginas(SEDE[k])
      for (const m of ms) {
        const hay = lineas(ps[m.pagina - 1]).map((l) => firma(l.tokens))
        for (const f of m.firmas) expect(hay, `página ${m.pagina}: «${f}»`).toContain(f)
      }
    })
  }
})

describe('el lector con los originales del 111, el 115 y el 202', () => {
  for (const [k, j] of Object.entries(SEDE)) {
    it(`${k}: ejercicio, periodo, casillas y resultado`, async () => {
      const l = leerJustificante(await paginas(j))
      if (!l.ok) throw new Error(l.motivo)
      expect([l.datos.modelo, l.datos.ejercicio, l.datos.periodo, l.datos.csv, l.datos.justificante, l.datos.nif])
        .toEqual([j.modelo, j.ejercicio, j.periodo, j.csv, j.justificante, j.nif])
      // Exactamente las del impreso: ni la tira de cifras de la cabecera («10 1 2 3…»), ni las vacías.
      expect(l.datos.casillas).toEqual(j.casillas)
      expect(l.datos.presentador).toEqual({ nif: '00000000T', nombre: 'GESTORIA INVENTADA DE PRUEBA' })
      expect(l.avisos).toEqual([])
    })
  }
  it('el resultado: [30] en el 111, [05] en el 115 y lo ingresado (la línea del NRC) en el 202', async () => {
    const r = await Promise.all(Object.values(SEDE).map(async (j) => { const l = leerJustificante(await paginas(j)); return l.ok ? l.datos.resultado : null }))
    expect(r).toEqual([{ casilla: '30', importe: 1702.5 }, { casilla: '05', importe: 855 }, { casilla: null, importe: 1080 }])
  })
  it('las casillas de perceptores son personas, no euros: [01] y [07] del 111, [01] del 115', () => {
    expect([esCasillaDePersonas('111', '01'), esCasillaDePersonas('111', '07'), esCasillaDePersonas('115', '01')]).toEqual([true, true, true])
    expect([esCasillaDePersonas('111', '02'), esCasillaDePersonas('115', '02'), esCasillaDePersonas('303', '01')]).toEqual([false, false, false])
  })
})
