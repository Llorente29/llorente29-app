// supabase/functions/_shared/correoPdf.ts
//
// S01p·20 · El PDF de una factura que viene ESCRITA en el cuerpo del correo (Just Eat):
// sin adjunto no hay papel, y el PDF es obligatorio en Sumied y para Diez (Julio, 13/11).
// Se hace del propio correo, tal como llega: arriba, de dónde sale (el asunto, quién lo
// manda y cuándo llegó); debajo, el cuerpo en su orden, fila a fila como en su tabla
// HTML: una celda es un párrafo y varias celdas van en columnas (así la factura sale
// con su «Nº Factura», sus dos direcciones, sus líneas, «Base · IVA · Cuota» y su total
// en su sitio). Sin imágenes ni estilos: el texto del correo, entero.
//
// Puro: sin red ni base. jsPDF se pasa desde fuera (en una edge function, `npm:jspdf`;
// en las pruebas, `jspdf`), como facturaVentaPdf.

import { decodificar } from './liquidacionUber.ts'

/** Una fila del correo: sus celdas, cada una con sus líneas (los <br> de dentro). */
export type FilaCorreo = string[][]

const limpio = (s: string) => s.replace(/[\s\u00a0]+/g, ' ').trim()
/** Lo que no es contenido: la barra de navegación del correo y «Volver al inicio». */
const RUIDO = /^(Resumen \| Tu factura \|.*|Volver al inicio|MI Restaurante)$/i

/** El cuerpo del correo en filas (las <tr> de sus tablas), con sus celdas y sus líneas. Sin HTML, del texto. */
export function filasDelCorreo(c: { html?: string | null; text?: string | null }): FilaCorreo[] {
  if (!c.html || !/<\w/.test(c.html)) {
    return (c.text ?? '').split(/\r?\n/).map(limpio).filter(Boolean).map((l) => [[l]])
  }
  const sin = c.html.replace(/[\r\n]+/g, ' ').replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  const filas: FilaCorreo[] = []
  // Cada fila de tabla (o, fuera de tablas, cada bloque) es una fila.
  for (const tr of sin.split(/<tr\b[^>]*>/i)) {
    const celdas: string[][] = []
    for (const td of tr.split(/<\/t[dh]>/i)) {
      // Lo que va antes de su celda, si es otra tabla, no es de esta fila.
      const dentro = td.replace(/^[\s\S]*<t[dh]\b[^>]*>/i, '')
      // Solo lo que no es otra tabla anidada (sus filas salen solas).
      if (/<table\b/i.test(dentro)) continue
      const texto = decodificar(dentro.replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, ''))
      const lineas = texto.split('\n').map(limpio).filter((l) => l && !RUIDO.test(l))
      if (lineas.length) celdas.push(lineas)
    }
    if (celdas.length) filas.push(celdas)
  }
  return filas
}

/** Lo mínimo de jsPDF que se usa (para no atarse a su tipo en Deno y en Node). */
export interface PdfMinimo {
  setFont(f: string, e?: string): unknown
  setFontSize(n: number): unknown
  setTextColor(r: number, g?: number, b?: number): unknown
  setDrawColor(r: number, g?: number, b?: number): unknown
  setFillColor(r: number, g?: number, b?: number): unknown
  text(t: string | string[], x: number, y: number, o?: Record<string, unknown>): unknown
  line(x1: number, y1: number, x2: number, y2: number): unknown
  rect(x: number, y: number, w: number, h: number, s?: string): unknown
  splitTextToSize(t: string, w: number): string[]
  addPage(): unknown
  output(t: 'arraybuffer'): ArrayBuffer
}

export interface DatosPdfCorreo {
  asunto: string | null
  de: string | null
  /** Cuándo llegó (ISO o AAAA-MM-DD): se enseña en Madrid. */
  recibido: string | null
  html?: string | null
  text?: string | null
}

const fechaMadrid = (s: string | null) => {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** El PDF (A4) del correo tal como llega. Lanza si el correo no tiene cuerpo: sin texto no hay papel. */
export function pdfDelCorreo(Pdf: new (o?: Record<string, unknown>) => PdfMinimo, c: DatosPdfCorreo): Uint8Array {
  const filas = filasDelCorreo(c)
  if (!filas.length) throw new Error('El correo no tiene cuerpo: no hay nada que poner en el PDF.')
  const doc = new Pdf({ unit: 'mm', format: 'a4' })
  const X = 16, ANCHO = 178, ALTO = 297, PIE = 282, LINEA = 4.6
  let y = 18
  const letra = (estilo: 'normal' | 'bold', tam: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam) }
  const salto = (h: number) => { if (y + h > PIE) { doc.addPage(); y = 18 } }

  // De dónde sale: el correo, con su asunto, quién lo manda y cuándo llegó.
  doc.setFillColor(245, 245, 245); doc.setDrawColor(200, 200, 200)
  doc.rect(X, y - 6, ANCHO, 25, 'FD')
  letra('bold', 11); doc.setTextColor(30, 30, 30)
  doc.text(doc.splitTextToSize(c.asunto ?? 'Correo sin asunto', ANCHO - 8).slice(0, 1), X + 4, y)
  letra('normal', 9); doc.setTextColor(90, 90, 90)
  doc.text(`De: ${c.de ?? '—'}`, X + 4, y + 6)
  doc.text(`Recibido: ${fechaMadrid(c.recibido) ?? '—'}`, X + 4, y + 11)
  doc.text('Copia del cuerpo del correo: la factura venía escrita en él, sin PDF adjunto.', X + 4, y + 16)
  y += 27
  doc.setTextColor(30, 30, 30)

  for (const celdas of filas) {
    if (celdas.length === 1) {
      // Un párrafo: los títulos de sección («Tu factura de Just Eat»…), en negrita.
      const titulo = celdas[0].length === 1 && /^(Tu factura( de Just Eat)?|Estado de tu cuenta.*|Tus pedidos.*|Tus datos en Just Eat.*)$/i.test(celdas[0][0])
      letra(titulo ? 'bold' : 'normal', titulo ? 11 : 9)
      const lineas = celdas[0].flatMap((l) => doc.splitTextToSize(l, ANCHO))
      salto(lineas.length * LINEA + (titulo ? 3 : 1))
      if (titulo) { y += 2; doc.setDrawColor(200, 200, 200); doc.line(X, y - 4.5, X + ANCHO, y - 4.5) }
      doc.text(lineas, X, y)
      y += lineas.length * LINEA + 1
      continue
    }
    // Varias celdas: en columnas; la última, a la derecha (los importes).
    letra('normal', 9)
    const w = ANCHO / celdas.length
    const partidas = celdas.map((cel) => cel.flatMap((l) => doc.splitTextToSize(l, w - 3)))
    const alto = Math.max(...partidas.map((p) => p.length)) * LINEA
    salto(alto + 1)
    partidas.forEach((p, i) => {
      const ultima = i === partidas.length - 1 && partidas.length > 1
      doc.text(p, ultima ? X + ANCHO : X + i * w, y, ultima ? { align: 'right' } : undefined)
    })
    y += alto + 1
  }
  letra('normal', 7); doc.setTextColor(140, 140, 140)
  doc.text('Generado por Sumied a partir del correo recibido.', X, ALTO - 8)
  return new Uint8Array(doc.output('arraybuffer'))
}

/** El nombre del PDF: «just-eat-<número>.pdf» (o el del asunto). */
export const nombrePdfCorreo = (numero: string | null, asunto: string | null) =>
  `${(numero ? `just-eat-${numero}` : (asunto ?? 'correo')).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'correo'}.pdf`
