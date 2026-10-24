// supabase/functions/_shared/recibidaPdf.ts
//
// D02 · Toda factura recibida tiene su PDF desde que entra (Julio, 22/10). Lo
// hace el servidor (la función conta-recibida-pdf, que despierta un cron de un
// minuto solo si hay algo), no la pantalla, no el envío a Diez ni el validar:
// así da igual por dónde entró la foto (correo, OCR, subida o la foto de la
// recepción) y si la empresa tiene «Enviar a Diez» o no.
//
// Dos pasos, cada uno con sus frenos en la base (migración 0470):
//
//   1. HACER. Las recibidas cuyo original es una foto y aún no tienen PDF
//      (conta_recibida_pdf_reclamar, que las aparta 10 minutos para que no las
//      coja otra pasada). Se bajan sus fotos de receipt-uploads, se hace el PDF
//      (_shared/imagenAPdf.ts), se sube a conta-documentos en
//      <cuenta>/recibidas/<factura>/<huella>.pdf y se apunta
//      (conta_recibida_pdf_hecho). Si no se puede, el motivo se apunta
//      (conta_recibida_pdf_fallo) y se reintenta a los 15 minutos, como mucho 3
//      veces: no se pierde en silencio.
//   2. ENLAZAR. Los asientos validados de una recibida que no tienen su PDF
//      enlazado (conta_recibida_pdf_por_enlazar): el PDF hecho en el paso 1 o,
//      si el original ya era un PDF, ese. Se copia a la ruta del asiento
//      (<cuenta>/<asiento>/<huella>.pdf, la que lee el envío a Diez) y se enlaza
//      (conta_recibida_pdf_enlazar, que llama a conta_documento_factura_guardar
//      como el servidor y despierta su envío a Diez si esperaba por el
//      documento: EUROPASTRY sale sola).
//
// Aquí no hay red ni base: lo hacen los puertos, y las pruebas los cambian por
// dobles (tests/conta/d02/recibidaPdf.test.ts). En el registro de la función,
// solo recuentos: ni nombres, ni números de factura, ni rutas.

import { fotosAPdf } from './imagenAPdf.ts'

export interface Fichero { bucket: string; ruta: string }
export interface PorHacer { factura: string; cuenta: string; ficheros: Fichero[] }
export interface PorEnlazar { asiento: string; cuenta: string; factura: string; fuente: Fichero; nombre: string }

export interface PuertoPdf {
  reclamar(limite: number): Promise<PorHacer[]>
  bajar(f: Fichero): Promise<Uint8Array>
  /** Sube a conta-documentos, sin pisar: si ya está (un reintento con la misma huella), vale. */
  subir(ruta: string, pdf: Uint8Array): Promise<void>
  hecho(factura: string, ruta: string, sha256: string, bytes: number, paginas: number): Promise<void>
  fallo(factura: string, motivo: string, enlace: boolean): Promise<void>
  porEnlazar(limite: number): Promise<PorEnlazar[]>
  enlazar(asiento: string, ruta: string, nombre: string, sha256: string, bytes: number): Promise<void>
  sha256(b: Uint8Array): Promise<string>
}

export interface Pasada { hechos: number; fallos: number; enlazados: number; sinEnlazar: number; sinTiempo: number }

/** El PDF de una recibida, en conta-documentos, antes de tener asiento. */
export const rutaDeLaFactura = (cuenta: string, factura: string, sha: string) => `${cuenta}/recibidas/${factura}/${sha.slice(0, 16)}.pdf`
/** El mismo PDF, en la ruta de su asiento (la que lee el envío a Diez). */
export const rutaDelAsiento = (cuenta: string, asiento: string, sha: string) => `${cuenta}/${asiento}/${sha.slice(0, 16)}.pdf`

const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)
const esPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46

/** Paso 1: las fotos que entran, a PDF. */
export async function hacerPdfs(p: PuertoPdf, o: { limite: number; seguir: () => boolean }): Promise<Pick<Pasada, 'hechos' | 'fallos' | 'sinTiempo'>> {
  const r = { hechos: 0, fallos: 0, sinTiempo: 0 }
  const cola = await p.reclamar(o.limite)
  for (const f of cola) {
    if (!o.seguir()) { r.sinTiempo++; continue }   // apartada 10 minutos: la coge la pasada siguiente
    try {
      if (!f.ficheros.length) throw new Error('la factura no tiene ningún fichero guardado')
      const fotos = []
      for (const x of f.ficheros) fotos.push({ bytes: await p.bajar(x) })
      const pdf = await fotosAPdf(fotos)
      const sha = await p.sha256(pdf.pdf)
      const ruta = rutaDeLaFactura(f.cuenta, f.factura, sha)
      await p.subir(ruta, pdf.pdf)
      await p.hecho(f.factura, ruta, sha, pdf.pdf.length, pdf.paginas)
      r.hechos++
    } catch (e) {
      r.fallos++
      await p.fallo(f.factura, motivo(e), false).catch(() => undefined)
    }
  }
  return r
}

/** Paso 2: el PDF de la recibida, enlazado a su asiento validado. */
export async function enlazarPdfs(p: PuertoPdf, o: { limite: number; seguir: () => boolean }): Promise<Pick<Pasada, 'enlazados' | 'sinEnlazar' | 'sinTiempo'>> {
  const r = { enlazados: 0, sinEnlazar: 0, sinTiempo: 0 }
  const cola = await p.porEnlazar(o.limite)
  for (const a of cola) {
    if (!o.seguir()) { r.sinTiempo++; continue }
    try {
      const pdf = await p.bajar(a.fuente)
      if (!esPdf(pdf)) throw new Error('el documento guardado de la factura no es un PDF')
      const sha = await p.sha256(pdf)
      const ruta = rutaDelAsiento(a.cuenta, a.asiento, sha)
      await p.subir(ruta, pdf)
      await p.enlazar(a.asiento, ruta, a.nombre, sha, pdf.length)
      r.enlazados++
    } catch (e) {
      r.sinEnlazar++
      await p.fallo(a.factura, motivo(e), true).catch(() => undefined)
    }
  }
  return r
}

/** Una pasada entera: primero hacer (así lo recién hecho se enlaza en la misma), luego enlazar. */
export async function pasada(p: PuertoPdf, o: { limite: number; seguir: () => boolean }): Promise<Pasada> {
  const h = await hacerPdfs(p, o)
  const e = await enlazarPdfs(p, o)
  return { hechos: h.hechos, fallos: h.fallos, enlazados: e.enlazados, sinEnlazar: e.sinEnlazar, sinTiempo: h.sinTiempo + e.sinTiempo }
}
