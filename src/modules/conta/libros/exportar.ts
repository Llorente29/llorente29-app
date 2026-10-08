// src/modules/conta/libros/exportar.ts
//
// C05 · Las salidas de los libros: Excel de cualquier libro, PDF sencillo, y
// el fichero de los libros registro tal cual lo pide la AEAT en un
// requerimiento (una hoja por libro con su nombre fijo, las dos filas de
// cabecera del diseño y las columnas exactas). Cada función devuelve false si
// no había nada que bajar (como src/lib/descargaXlsx.ts): un fichero vacío
// parece decir que el dato no existe.
//
// El diario e inventarios en el formato del Registro (Legalia) NO se construye
// aquí: va en el C05b. Desde aquí se bajan su PDF y su Excel.

import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import { COLUMNAS_EXPEDIDAS, COLUMNAS_RECIBIDAS, HOJAS, filaExpedidas, filaRecibidas, type AnotacionLibro } from '@/modules/conta/lib/libroRegistro'

export type FilaTabla = (string | number | null)[]

/** Excel de una tabla: una hoja, cabecera y filas, con ancho de columna por contenido. */
export function excelTabla(nombreFichero: string, hoja: string, cabecera: string[], filas: FilaTabla[]): boolean {
  if (!filas.length) return false
  const ws = XLSX.utils.aoa_to_sheet([cabecera, ...filas])
  ws['!cols'] = cabecera.map((c, i) => ({ wch: Math.min(60, Math.max(c.length, ...filas.map((f) => String(f[i] ?? '').length)) + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, hoja.slice(0, 31))
  XLSX.writeFile(wb, nombreFichero)
  return true
}

/** Las dos filas de cabecera del diseño de la AEAT («Grupo» arriba, «Sub» abajo). */
function cabeceraDoble(columnas: readonly string[]): [string[], string[]] {
  const arriba: string[] = []
  const abajo: string[] = []
  let anterior = ''
  for (const c of columnas) {
    const [g, s] = c.includes(' · ') ? [c.slice(0, c.indexOf(' · ')), c.slice(c.indexOf(' · ') + 3)] : [c, '']
    arriba.push(g === anterior && s ? '' : g)
    abajo.push(s)
    anterior = g
  }
  return [arriba, abajo]
}

/**
 * El fichero de los libros registro del IVA para un requerimiento: hojas
 * EXPEDIDAS y RECIBIDAS (y BIENES-INVERSIÓN si hay), con las cabeceras del
 * diseño. Las anuladas no van: su asiento y su contraasiento se compensan.
 */
export function excelAeat(nombreFichero: string, expedidas: AnotacionLibro[], recibidas: AnotacionLibro[], bienes: (string | number | null)[][] = [], columnasBienes: readonly string[] = []): boolean {
  const vivasE = expedidas.filter((a) => !a.voidedAt)
  const vivasR = recibidas.filter((a) => !a.voidedAt)
  if (!vivasE.length && !vivasR.length && !bienes.length) return false
  const wb = XLSX.utils.book_new()
  const hoja = (nombre: string, columnas: readonly string[], filas: FilaTabla[]) => {
    const [a, b] = cabeceraDoble(columnas)
    const ws = XLSX.utils.aoa_to_sheet([a, b, ...filas])
    ws['!cols'] = columnas.map(() => ({ wch: 16 }))
    XLSX.utils.book_append_sheet(wb, ws, nombre)
  }
  hoja(HOJAS.issued, COLUMNAS_EXPEDIDAS, vivasE.map(filaExpedidas))
  hoja(HOJAS.received, COLUMNAS_RECIBIDAS, vivasR.map(filaRecibidas))
  if (bienes.length) hoja(HOJAS.investment, columnasBienes, bienes)
  XLSX.writeFile(wb, nombreFichero)
  return true
}

/** Un PDF sencillo y legible de una tabla (balance, PyG, sumas y saldos, mayor). */
export function pdfTabla(nombreFichero: string, titulo: string, subtitulo: string, cabecera: string[], filas: FilaTabla[], anchos?: number[], pie?: string): boolean {
  if (!filas.length) return false
  const doc = new jsPDF({ orientation: cabecera.length > 5 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const margen = 14
  const util = ancho - 2 * margen
  const w = anchos ?? cabecera.map((_, i) => (i === 0 ? util * 0.46 : (util * 0.54) / Math.max(1, cabecera.length - 1)))
  let y = 18
  const encabezar = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(titulo, margen, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(91, 102, 120); doc.text(subtitulo, margen, y); doc.setTextColor(14, 26, 43); y += 8
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    let x = margen
    cabecera.forEach((c, i) => { doc.text(c.toUpperCase(), i === 0 ? x : x + w[i] - 1, y, { align: i === 0 ? 'left' : 'right' }); x += w[i] })
    y += 2; doc.setDrawColor(230, 234, 240); doc.line(margen, y, ancho - margen, y); y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  }
  encabezar()
  for (const f of filas) {
    if (y > alto - 16) { doc.addPage(); y = 18; encabezar() }
    let x = margen
    f.forEach((v, i) => {
      const t = v === null || v === undefined ? '' : typeof v === 'number' ? v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)
      const corto = i === 0 ? doc.splitTextToSize(t, w[0] - 2)[0] ?? '' : t
      doc.text(corto, i === 0 ? x : x + w[i] - 1, y, { align: i === 0 ? 'left' : 'right' })
      x += w[i]
    })
    y += 6
  }
  if (pie) { y += 4; doc.setFontSize(8); doc.setTextColor(91, 102, 120); doc.text(doc.splitTextToSize(pie, util), margen, Math.min(y, alto - 10)) }
  doc.save(nombreFichero)
  return true
}
