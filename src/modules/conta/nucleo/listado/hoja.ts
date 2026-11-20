// src/modules/conta/nucleo/listado/hoja.ts
//
// Q06 · La hoja impresa del listado (maqueta nucleo_8): cómo es la página, y el
// PDF y el Excel con lo mismo. Las páginas salen de `paginar` (arbol.ts), las
// mismas que se ven en «Ver como se imprime», así que el PDF dice lo que se ve:
// la cabecera de la empresa y su NIF, el título y las fechas, las líneas, y al
// pie «Suma y sigue» y «Listado del … · Página 1 de 6».

import { jsPDF } from 'jspdf'
import { excelTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { cifra } from '../ficha/textos'
import { columnasHoja, lineasDeLaHoja, paginar, SUMA_Y_SIGUE, TITULO_HOJA, type Arbol, type Celda, type Columna, type Pagina, type QueListado } from './arbol'

/** El mayor y el libro de IVA, apaisados (más columnas); sumas y saldos y el diario, en vertical. */
export const APAISADA: Record<QueListado, boolean> = { sumas: false, diario: false, mayor: true, emitidas: true, recibidas: true }

/** Líneas por página: las mismas en la pantalla, el PDF y la impresora. */
export const LINEAS_POR_PAGINA = (que: QueListado): number => (APAISADA[que] ? 26 : 40)

/** El ancho de cada columna en la hoja, en milímetros (A4 con 14 de margen). */
const ANCHOS: Record<QueListado, number[]> = {
  sumas: [25, 61, 24, 24, 24, 24],
  diario: [24, 98, 30, 30],
  mayor: [22, 22, 105, 30, 30, 30, 30],
  emitidas: [22, 34, 26, 85, 28, 14, 28, 32],
  recibidas: [22, 34, 26, 85, 28, 14, 28, 32],
}
export const anchosDeLaHoja = (que: QueListado): number[] => ANCHOS[que]

/** Una celda como se escribe en la hoja: las cifras con dos decimales y su punto de miles. */
export function textoCelda(v: Celda, col: Columna): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return col.titulo === '%' ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : cifra(v)
  return v
}

export interface CabeceraHoja { empresa: string; nif: string | null; subtitulo: string; hoy: string }

export interface Hoja { que: QueListado; columnas: Columna[]; paginas: Pagina[]; cabecera: CabeceraHoja; titulo: string }

/** La hoja de un listado: sus columnas y sus páginas. */
export function hojaDe(a: Arbol, que: QueListado, cabecera: CabeceraHoja): Hoja {
  return { que, columnas: columnasHoja(que), paginas: paginar(lineasDeLaHoja(a, que), LINEAS_POR_PAGINA(que), SUMA_Y_SIGUE[que]), cabecera, titulo: TITULO_HOJA[que] }
}

const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

/** «Suma y sigue · 74.927,30 · 46.240,77». */
export const textoSigue = (p: Pagina): string => (p.sigue ? `Suma y sigue · ${p.sigue.map((x) => cifra(x)).join(' · ')}` : '')
/** «Listado del 17/11/2026 · Página 1 de 6». */
export const textoPagina = (h: Hoja, p: Pagina): string => `Listado del ${ddmmaaaa(h.cabecera.hoy)} · Página ${p.numero} de ${h.paginas.length}`

/** El PDF de la hoja, página a página como se ve. */
export function pdfDeLaHoja(h: Hoja): jsPDF {
  const doc = new jsPDF({ orientation: APAISADA[h.que] ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const m = 14
  const anchos = ANCHOS[h.que]
  h.paginas.forEach((p, i) => {
    if (i) doc.addPage()
    let y = 18
    doc.setTextColor(31, 41, 51)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(h.cabecera.empresa, m, y)
    doc.text(h.titulo, ancho - m, y, { align: 'right' })
    y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    if (h.cabecera.nif) doc.text(`N.I.F. ${h.cabecera.nif}`, m, y)
    doc.text(h.cabecera.subtitulo, ancho - m, y, { align: 'right' })
    y += 3.5
    doc.setDrawColor(31, 41, 51); doc.setLineWidth(0.4); doc.line(m, y, ancho - m, y)
    y += 6
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    let x = m
    h.columnas.forEach((c, k) => { doc.text(c.titulo, c.cifra ? x + anchos[k] - 1 : x, y, { align: c.cifra ? 'right' : 'left' }); x += anchos[k] })
    y += 2; doc.setLineWidth(0.3); doc.line(m, y, ancho - m, y); y += 4.6
    doc.setFontSize(8.5)
    for (const l of p.lineas) {
      doc.setFont('helvetica', l.clase === 'linea' ? 'normal' : 'bold')
      x = m
      l.celdas.forEach((v, k) => {
        const col = h.columnas[k]
        const t = textoCelda(v, col)
        const corto = col.cifra ? t : (doc.splitTextToSize(t, anchos[k] - 2)[0] ?? '')
        doc.text(corto, col.cifra ? x + anchos[k] - 1 : x, y, { align: col.cifra ? 'right' : 'left' })
        x += anchos[k]
      })
      y += 1.6; doc.setDrawColor(223, 227, 232); doc.setLineWidth(0.1); doc.line(m, y, ancho - m, y); y += 3.4
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(91, 102, 112)
    doc.text(textoSigue(p), m, alto - 10)
    doc.text(textoPagina(h, p), ancho - m, alto - 10, { align: 'right' })
  })
  return doc
}

/** El nombre de los ficheros: «Sumas y saldos 01-01-2026 a 31-07-2026». */
export function nombreDeFichero(titulo: string, desde: string, hasta: string): string {
  return `${titulo} ${ddmmaaaa(desde).replace(/\//g, '-')} a ${ddmmaaaa(hasta).replace(/\//g, '-')}`
}

/** El Excel: las mismas líneas, en una hoja, con su cabecera (las cifras como números). */
export function excelDeLaHoja(h: Hoja, nombre: string): boolean {
  const filas: FilaTabla[] = h.paginas.flatMap((p) => p.lineas.map((l) => l.celdas.map((v) => (v === undefined ? null : v))))
  return excelTabla(`${nombre}.xlsx`, h.titulo, h.columnas.map((c) => c.titulo), filas)
}
