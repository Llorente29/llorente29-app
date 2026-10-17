// src/modules/conta/ui/tabla/exportar.ts
//
// M01 · Pieza común · Exportar la tabla densa a Excel, CSV y PDF (maqueta N30
// §4). Baja lo que se ve con los filtros puestos, o solo lo marcado si hay
// algo marcado. Cada función devuelve false si no había nada que bajar (como
// src/lib/descargaXlsx.ts y libros/exportar.ts): un fichero vacío parece decir
// que el dato no existe.
//
// En el PDF cada columna va alineada como en la pantalla: las cifras a la
// derecha y el texto a la izquierda (pdfTabla de Libros pone todo menos la
// primera a la derecha, que va bien para un libro de cuentas, no para esto).

import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import { csv, nombreFichero, type Celda } from '@/modules/conta/ui/tabla/tablaDensa'

export type FormatoExportar = 'xlsx' | 'csv' | 'pdf'

export interface ColumnaExportar { titulo: string; cifra?: boolean; peso?: number }

export interface Exportacion {
  /** Sin extensión: «Libro diario 2026». */
  nombre: string
  titulo: string
  subtitulo: string
  columnas: readonly ColumnaExportar[]
  filas: readonly (readonly Celda[])[]
  /** Una línea al final (el cuadre). */
  pie?: string
}

function bajar(contenido: BlobPart, tipo: string, fichero: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = fichero
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function excel(e: Exportacion, fichero: string) {
  const cabecera = e.columnas.map((c) => c.titulo)
  const ws = XLSX.utils.aoa_to_sheet([cabecera, ...e.filas.map((f) => [...f])])
  ws['!cols'] = cabecera.map((c, i) => ({ wch: Math.min(60, Math.max(c.length, ...e.filas.map((f) => String(f[i] ?? '').length)) + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, e.titulo.slice(0, 31))
  XLSX.writeFile(wb, fichero)
}

function pdf(e: Exportacion, fichero: string) {
  const doc = new jsPDF({ orientation: e.columnas.length > 5 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const margen = 12
  const util = ancho - 2 * margen
  const pesos = e.columnas.map((c) => c.peso ?? 1)
  const suma = pesos.reduce((a, b) => a + b, 0)
  const w = pesos.map((p) => (util * p) / suma)
  let y = 16
  const cabeza = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(14, 26, 43); doc.text(e.titulo, margen, y); y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(91, 102, 120); doc.text(e.subtitulo, margen, y); y += 7
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    let x = margen
    e.columnas.forEach((c, i) => { doc.text(c.titulo.toUpperCase(), c.cifra ? x + w[i] - 1 : x, y, { align: c.cifra ? 'right' : 'left' }); x += w[i] })
    y += 2; doc.setDrawColor(221, 227, 235); doc.line(margen, y, ancho - margen, y); y += 4.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(14, 26, 43)
  }
  cabeza()
  for (const f of e.filas) {
    if (y > alto - 14) { doc.addPage(); y = 16; cabeza() }
    let x = margen
    f.forEach((v, i) => {
      const c = e.columnas[i]
      const t = v === null ? '' : typeof v === 'number' ? v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v
      const corto = (doc.splitTextToSize(t, Math.max(4, w[i] - 2)) as string[])[0] ?? ''
      doc.text(corto, c?.cifra ? x + w[i] - 1 : x, y, { align: c?.cifra ? 'right' : 'left' })
      x += w[i]
    })
    y += 5.2
  }
  if (e.pie) { y += 3; doc.setFontSize(8); doc.setTextColor(91, 102, 120); doc.text(doc.splitTextToSize(e.pie, util), margen, Math.min(y, alto - 8)) }
  doc.save(fichero)
}

/** Baja la tabla en el formato pedido. Devuelve el nombre del fichero, o null si no había filas. */
export function exportarTabla(formato: FormatoExportar, e: Exportacion): string | null {
  if (e.filas.length === 0) return null
  const fichero = nombreFichero(e.nombre, formato)
  if (formato === 'xlsx') excel(e, fichero)
  else if (formato === 'pdf') pdf(e, fichero)
  else bajar(csv(e.columnas.map((c) => c.titulo), e.filas), 'text/csv;charset=utf-8', fichero)
  return fichero
}
