// tests/unit/modules/conta/i01c/justificante.test.ts
//
// I01c · P1 · El lector de justificantes de la AEAT, contra PDF INVENTADOS con
// la forma de los de verdad (tests/conta/fixtures/justificantes/pdfJustificante.mjs).
// Pasa por pdfjs-dist de verdad (su build «legacy», la de node) y por el mismo
// celdasPdf que usa el navegador.
//
// La vara (regla 31): lo que sale del PDF se compara con los datos con los que
// se generó, casilla a casilla: todas las que tienen importe, y ni una más.
// Y la trampa del NIF del presentador (la gestoría, en la primera página) se
// comprueba presente en el PDF antes de probar que no muerde.

import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'
import { importeDe, leerJustificante, tituloJustificante } from '@/modules/conta/lib/justificanteAeat'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf, otroDocumentoPdf, sinTextoPdf } from '../../../../conta/fixtures/justificantes/pdfJustificante.mjs'

const PDFJS = pdfjs as unknown as PdfJs
type J = { modelo: string; ejercicio: number; periodo: string; nif: string; presentada: string; csv: string; justificante: string; casillas: Record<string, number> }
const TODOS = JUSTIFICANTES_A as Record<string, J>
const leer = async (bytes: ArrayBuffer) => leerJustificante(await celdasPdf(PDFJS, bytes))

describe('los justificantes inventados de la empresa A, uno a uno', () => {
  for (const [clave, j] of Object.entries(TODOS)) {
    it(`${clave}: modelo, ejercicio, periodo, fecha, CSV, justificante, NIF y todas sus casillas`, async () => {
      const l = await leer(justificantePdf(j))
      if (!l.ok) throw new Error(l.motivo)
      const [d, h] = j.presentada.split(' ')
      const [dd, mm, aaaa] = d.split('-')
      expect(l.datos).toMatchObject({
        modelo: j.modelo, ejercicio: j.ejercicio, periodo: j.periodo, presentada: `${aaaa}-${mm}-${dd}T${h}`,
        csv: j.csv, justificante: j.justificante, nif: j.nif,
      })
      // Todas las casillas con importe, y ni una más (las vacías no se inventan).
      expect(l.datos.casillas).toEqual(j.casillas)
      expect(l.datos.resultado).not.toBeNull()
      expect(l.avisos).toEqual([])
    })
  }
  it('el resultado de cada uno sale de su casilla: [71] del 303, [30] del 111, [05] del 115 y «A ingresar» del 202', async () => {
    const r = await Promise.all(Object.values(TODOS).map(async (j) => { const l = await leer(justificantePdf(j)); return l.ok ? `${j.modelo}:${l.datos.resultado?.casilla}=${l.datos.resultado?.importe}` : 'no' }))
    expect(r).toEqual(['303:71=-1761.96', '303:71=0', '111:30=1702.5', '115:05=855', '202:05=960'])
  })
})

describe('las trampas', () => {
  it('el NIF del presentador (la gestoría) está en la primera página, y el que se lee es el del declarante', async () => {
    const paginas = await celdasPdf(PDFJS, justificantePdf(TODOS['303-3T-2025']))
    expect(paginas[0].celdas.map((c) => c.texto).join(' ')).toContain('00000000T')
    const l = leerJustificante(paginas)
    expect(l.ok && l.datos.nif).toBe('B28000016')
  })
  it('una casilla vacía no se queda con el importe de la siguiente: el 303 del 3T no tiene [10] ni [11]', async () => {
    const l = await leer(justificantePdf(TODOS['303-3T-2025']))
    expect(l.ok && Object.keys(l.datos.casillas).filter((k) => ['10', '11', '12', '13', '36', '37'].includes(k))).toEqual([])
  })
  it('«01 12 02»: 12 personas en nómina sí son un valor (el 12 no va entre el 01 y el 02)', async () => {
    const j = { ...TODOS['111-3T-2025'], casillas: { ...TODOS['111-3T-2025'].casillas, '01': 12 } }
    const l = await leer(justificantePdf(j))
    expect(l.ok && l.datos.casillas).toEqual(j.casillas)
  })
  it('el teléfono y el número de página del impreso no son casillas', async () => {
    const l = await leer(justificantePdf(TODOS['115-3T-2025']))
    expect(l.ok && Object.keys(l.datos.casillas).sort()).toEqual(['01', '02', '03', '05'])
  })
})

describe('lo que no se puede leer se dice, y por qué', () => {
  it('una factura no es un justificante', async () => {
    const l = await leer(otroDocumentoPdf())
    expect(l.ok).toBe(false)
    expect(!l.ok && l.motivo).toMatch(/^No se encuentra el modelo, .*¿Es el justificante de presentación de la Sede\?$/)
  })
  it('un PDF sin texto (escaneado)', async () => {
    const l = await leer(sinTextoPdf())
    expect(!l.ok && l.motivo).toBe('El PDF no tiene texto (parece escaneado o una foto): Sumied solo lee el justificante que descarga la Sede.')
  })
  it('solo la página de la presentación: se lee la presentación, no las casillas, y se piden a mano', async () => {
    const l = await leer(justificantePdf({ ...TODOS['303-3T-2025'] }, { sinImpreso: true }))
    expect(l.ok).toBe(false)
    // Sin impreso no hay ejercicio ni periodo ni NIF del declarante.
    expect(!l.ok && l.motivo).toMatch(/^No se encuentra el ejercicio, el periodo ni el NIF del declarante/)
  })
  it('un modelo que Sumied no lee todavía', async () => {
    const l = await leer(justificantePdf({ ...TODOS['115-3T-2025'], modelo: '390' }))
    expect(!l.ok && l.motivo).toBe('Es un justificante del modelo 390, y Sumied de momento lee el 303, el 111, el 115 y el 202.')
  })
  it('un 303 sin la [71]: se lee, y el resultado se pide', async () => {
    const sin = { ...TODOS['303-3T-2025'], casillas: { ...TODOS['303-3T-2025'].casillas } }
    delete sin.casillas['71']
    const l = await leer(justificantePdf(sin))
    expect(l.ok && l.datos.resultado).toBeNull()
    expect(l.ok && l.avisos).toEqual(['No se encuentra el resultado (casilla [71]): escríbelo antes de guardar.'])
  })
})

describe('palabras', () => {
  it('importes con coma decimal y punto de miles', () => {
    expect([importeDe('158.269,64'), importeDe('-2.134,18'), importeDe('0,00'), importeDe('51,75')]).toEqual([158269.64, -2134.18, 0, 51.75])
  })
  it('el título de cada uno', () => {
    expect([
      tituloJustificante({ modelo: '303', ejercicio: 2026, periodo: '1T' }), tituloJustificante({ modelo: '111', ejercicio: 2026, periodo: '2T' }),
      tituloJustificante({ modelo: '202', ejercicio: 2026, periodo: '1P' }), tituloJustificante({ modelo: '202', ejercicio: 2026, periodo: '2P' }),
    ]).toEqual(['IVA del trimestre · 1T 2026', 'Retenciones · 2T 2026', 'Pago a cuenta de sociedades · 1.er pago 2026', 'Pago a cuenta de sociedades · 2.º pago 2026'])
  })
})
