// src/modules/personal/laboral/informePdf.ts
//
// L1a · PR 2 (28/10/2026). El informe para la Inspección en PDF: lo mismo que
// la pantalla, día a día, con cada corrección a la vista, los totales por
// semana, la firma de la persona y la nota de la ley. Apaisado, para que «cómo
// se registró» quepa al lado de las horas.

import jsPDF from 'jspdf'
import { fechaYHora } from './calculoJornada'
import type { InformeJornada } from './informeJornada'

const W = 297
const H = 210
const M = 12
const LINEA = 4.2
// Las columnas: día, entrada, pausas, salida, horas y cómo se registró.
const COL = [M, M + 22, M + 40, M + 72, M + 98, M + 116]
const ANCHO_REGISTRO = W - M - COL[5]

/** El PDF del informe, como Blob, listo para descargar. */
export function pdfDelInforme(inf: InformeJornada, generadoAt: string): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  let y = M

  const salto = (alto: number) => {
    if (y + alto > H - M - 6) {
      doc.addPage()
      y = M
      cabeceraTabla()
    }
  }
  const cabeceraTabla = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(90)
    ;['DÍA', 'ENTRADA', 'PAUSAS', 'SALIDA', 'HORAS', 'CÓMO SE REGISTRÓ'].forEach((t, i) => doc.text(t, COL[i], y))
    y += 2
    doc.setDrawColor(200); doc.line(M, y, W - M, y)
    y += 3.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(20)
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20)
  doc.text(inf.titulo, M, y + 4)
  y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80)
  for (const l of doc.splitTextToSize(inf.subtitulo, W - 2 * M) as string[]) { doc.text(l, M, y); y += LINEA }
  y += 2
  for (const a of inf.avisos) {
    doc.setTextColor(150, 80, 0)
    for (const l of doc.splitTextToSize(`Atención: ${a}`, W - 2 * M) as string[]) { doc.text(l, M, y); y += LINEA }
  }
  y += 2
  cabeceraTabla()

  for (const f of inf.filas) {
    const registro = f.tramos.length ? f.registro : [f.sinJornada ?? '']
    const lineasRegistro = registro.flatMap(r => doc.splitTextToSize(r, ANCHO_REGISTRO) as string[])
    const alto = Math.max(f.tramos.length || 1, lineasRegistro.length) * LINEA + 1.5
    salto(alto)
    doc.setTextColor(20)
    doc.setFont('helvetica', f.corregido ? 'bold' : 'normal')
    doc.text(`${f.diaTexto}`, COL[0], y)
    doc.setFont('helvetica', 'normal')
    f.tramos.forEach((t, i) => {
      const yy = y + i * LINEA
      doc.text(t.entrada, COL[1], yy)
      doc.text(t.pausas, COL[2], yy)
      if (t.sinSalida) doc.setTextColor(170, 40, 40)
      doc.text(t.salida, COL[3], yy)
      doc.setTextColor(20)
      doc.text(t.total, COL[4], yy)
    })
    doc.setTextColor(f.enDesacuerdo ? 170 : 70, f.enDesacuerdo ? 40 : 70, f.enDesacuerdo ? 40 : 70)
    lineasRegistro.forEach((l, i) => doc.text(l, COL[5], y + i * LINEA))
    doc.setTextColor(20)
    y += alto
    doc.setDrawColor(235); doc.line(M, y - 3, W - M, y - 3)
  }

  salto(10 + inf.semanas.length * LINEA)
  y += 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Por semana', M, y); y += LINEA + 1
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  for (const s of inf.semanas) {
    doc.text(`${s.texto}: trabajadas ${s.trabajadas} · contrato ${s.contrato} · ordinarias ${s.ordinarias} · extra ${s.extra}`, M, y)
    y += LINEA
  }

  salto(12)
  y += 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(`Total: ${inf.totales.total}   ·   Ordinarias: ${inf.totales.ordinarias}   ·   Extra: ${inf.totales.extra}   ·   Marcas corregidas: ${inf.totales.corregidas}`, M, y)
  y += LINEA + 2

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60)
  for (const texto of [inf.firma, inf.ley]) {
    const l = doc.splitTextToSize(texto, W - 2 * M) as string[]
    salto(l.length * LINEA)
    l.forEach(x => { doc.text(x, M, y); y += LINEA })
    y += 1
  }

  const paginas = doc.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5); doc.setTextColor(120)
    doc.text(`Generado el ${fechaYHora(generadoAt)} · página ${p} de ${paginas}`, M, H - 6)
  }
  return doc.output('blob')
}

/** El nombre del fichero: «registro-de-jornada-nombre-2026-10.pdf». */
export function nombreDeFichero(nombre: string, desde: string, hasta: string, extension: 'pdf' | 'csv'): string {
  const persona = nombre.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().replace(/^-|-$/g, '')
  const periodo = desde.slice(0, 7) === hasta.slice(0, 7) ? desde.slice(0, 7) : `${desde}_${hasta}`
  return `registro-de-jornada-${persona}-${periodo}.${extension}`
}

/** Descarga un Blob con su nombre. */
export function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
