// Los documentos exportados de Diez: clave por nombre, cruce con el Excel y PDF
// con cabeceras HTTP delante (medido en septiembre de 2026). Datos inventados
// con la forma medida; ningún PDF real.

import { describe, expect, it } from 'vitest'
import { claveDeCodigoExcel, claveDeFichero, cruzar, limpiarPdf } from '../../../supabase/functions/_shared/diezDocumentos'

const enc = (s: string) => new TextEncoder().encode(s)
const PDF_MIN = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'

describe('la clave del asiento', () => {
  it('del nombre del PDF', () => {
    expect(claveDeFichero('C0008_F2026_2_3172.PDF')).toEqual({ base: 'C0008', ejercicio: '2026', serie: '2', documento: 3172 })
    expect(claveDeFichero('C0008_F2026_1_1119.pdf')).toEqual({ base: 'C0008', ejercicio: '2026', serie: '1', documento: 1119 })
    expect(claveDeFichero('factura.pdf')).toBeNull()
    expect(claveDeFichero('C0008_F2026_2_3172.PDF.zip')).toBeNull()
  })
  it('del código del Excel', () => {
    expect(claveDeCodigoExcel('C0008_CON_202_RECIBIDA_2026_2_3172.pdf')).toEqual({ base: 'C0008', ejercicio: '2026', serie: '2', documento: 3172, libro: 'recibida' })
    expect(claveDeCodigoExcel('C0008_CON_201_EXPEDIDA_2026_1_1119.pdf')).toMatchObject({ serie: '1', documento: 1119, libro: 'expedida' })
    expect(claveDeCodigoExcel('')).toBeNull()
  })
})

describe('cruzar ficheros y Excel', () => {
  it('por la clave, y dice lo que sobra y lo que falta', () => {
    const r = cruzar(
      ['C0008_F2026_2_10.PDF', 'C0008_F2026_2_11.PDF', 'C0008_F2026_2_11.PDF', 'C0008_F2026_2_99.PDF', 'otro.pdf'],
      ['C0008_CON_202_RECIBIDA_2026_2_10.pdf', 'C0008_CON_202_RECIBIDA_2026_2_11.pdf', 'C0008_CON_202_RECIBIDA_2026_2_12.pdf'],
    )
    expect(r.enlazados.map((e) => e.clave)).toEqual(['C0008/2026/2/10', 'C0008/2026/2/11'])
    expect(r.sinFichero).toEqual(['C0008_CON_202_RECIBIDA_2026_2_12.pdf'])
    expect(r.sinCodigo).toEqual(['C0008_F2026_2_99.PDF'])
    expect(r.nombreRaro).toEqual(['otro.pdf'])
    expect(r.repetidos).toEqual(['C0008_F2026_2_11.PDF'])
  })
  it('el mismo documento en otra serie o ejercicio no casa', () => {
    const r = cruzar(['C0008_F2026_1_10.PDF', 'C0008_F2025_2_10.PDF'], ['C0008_CON_202_RECIBIDA_2026_2_10.pdf'])
    expect(r.enlazados).toEqual([])
  })
})

describe('limpiarPdf', () => {
  it('un PDF normal pasa tal cual', () => {
    const r = limpiarPdf(enc(PDF_MIN))
    expect(r).toMatchObject({ ok: true, cabeceraQuitada: false })
  })

  it('con las cabeceras HTTP delante (como la recibida 2026/2/3172): se quitan y cuadra content-length', () => {
    const cab = `content-length: ${enc(PDF_MIN).length}\naccept-ranges: bytes\ndate: Fri, 02 Oct 2026 09:10:56 GMT\nlast-modified: Wed, 30 Sep 2026 09:07:26 GMT\netag: "c4ff6d75"\ncontent-type: application/pdf\n`
    const r = limpiarPdf(enc(cab + PDF_MIN))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cabeceraQuitada).toBe(true)
      expect(new TextDecoder().decode(r.pdf)).toBe(PDF_MIN)
      expect(r.cabeceras).toEqual(['content-length', 'accept-ranges', 'date', 'last-modified', 'etag', 'content-type'])
    }
  })

  it.each([
    [new Uint8Array(), 'fichero vacío'],
    [enc('hola'), /no es un PDF/],
    [enc('%PDF-1.4\n1 0 obj\n'), /no acaba en %%EOF/],
    [enc(`content-length: 5\n${PDF_MIN}`), /dicen 5 bytes/],
    [enc(`content-type: text/html\n${PDF_MIN}`), /text\/html/],
    [enc(`<html>error</html>\n${PDF_MIN}`), /no son cabeceras HTTP/],
  ] as [Uint8Array, string | RegExp][])('rechaza con su porqué (%#)', (b, motivo) => {
    const r = limpiarPdf(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(motivo)
  })
})
