// src/modules/conta/lib/fotoAPdf.ts
//
// D01 · Tarea 5 · Una FOTO de factura, como PDF, para guardarla en
// conta-documentos (que solo admite PDF) y mandarla a Diez con su asiento
// (Julio, R1 punto 4). El original se queda en receipt-uploads tal cual: la
// lectura usa siempre la foto, no este PDF.
//
// Una página A4 con la foto entera, sin recortar ni deformar: se ajusta al
// ancho o al alto (lo que limite) con un margen de 10 mm, y se centra. Una
// foto apaisada va en una página apaisada.

import { jsPDF } from 'jspdf'

export type FotoPdf = { pdf: Uint8Array; paginas: 1; orientacion: 'vertical' | 'apaisada' }

const A4 = { ancho: 210, alto: 297 }
const MARGEN = 10

/** Dónde va la foto en la página (mm): el cálculo, aparte para probarlo. */
export function encaje(anchoPx: number, altoPx: number): { orientacion: 'vertical' | 'apaisada'; x: number; y: number; w: number; h: number } {
  if (!(anchoPx > 0 && altoPx > 0)) throw new Error('la foto no tiene tamaño')
  const orientacion = anchoPx > altoPx ? 'apaisada' : 'vertical'
  const pw = orientacion === 'apaisada' ? A4.alto : A4.ancho
  const ph = orientacion === 'apaisada' ? A4.ancho : A4.alto
  const escala = Math.min((pw - 2 * MARGEN) / anchoPx, (ph - 2 * MARGEN) / altoPx)
  const w = anchoPx * escala, h = altoPx * escala
  return { orientacion, x: (pw - w) / 2, y: (ph - h) / 2, w, h }
}

/** JPEG o PNG → un PDF de una página. */
export function fotoAPdf(foto: Uint8Array, tipo: 'image/jpeg' | 'image/png', anchoPx: number, altoPx: number): FotoPdf {
  const e = encaje(anchoPx, altoPx)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: e.orientacion === 'apaisada' ? 'landscape' : 'portrait' })
  doc.addImage(foto, tipo === 'image/png' ? 'PNG' : 'JPEG', e.x, e.y, e.w, e.h)
  return { pdf: new Uint8Array(doc.output('arraybuffer')), paginas: 1, orientacion: e.orientacion }
}
