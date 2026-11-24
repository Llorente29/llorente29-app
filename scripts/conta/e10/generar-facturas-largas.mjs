// scripts/conta/e10/generar-facturas-largas.mjs
//
// E10 · Los PDF de la factura larga INVENTADA (facturaLarga.mjs), como la mensual de un
// proveedor de aves: cabecera, un bloque por albarán con sus líneas (cada una con su lote y su
// caducidad debajo), y al final el cuadro de impuestos, el total, el vencimiento, la forma de
// pago y el IBAN. Filas fijas por página, así que alguna línea queda partida: su importe en una
// página y su lote en la siguiente (lo que tiene que saber juntar la lectura por páginas).
//
//   node scripts/conta/e10/generar-facturas-largas.mjs
// escribe tests/conta/e10/factura-larga-5.pdf (20 albaranes, 34 líneas) y
//         tests/conta/e10/factura-larga-10.pdf (40 albaranes, 68 líneas).
// pdfFacturaLarga({ albaranes, numero }) devuelve los bytes (la e2e hace uno con su número).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsPDF } from 'jspdf'
import { facturaLarga } from './facturaLarga.mjs'

const eur = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n)
const num = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3, useGrouping: 'always' }).format(n)
const fecha = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Filas por página (cada línea son dos: la del importe y la del lote). */
const FILAS = 19
const ALTO = 9.4

export function pdfFacturaLarga({ albaranes = 20, numero = 'AV-2026-0000011' } = {}) {
  const f = facturaLarga({ albaranes, numero })
  // Las filas, en orden: el albarán, y cada línea con su lote debajo.
  const filas = []
  for (const a of f.albaranes) {
    filas.push({ tipo: 'albaran', a })
    for (const l of a.lineas) { filas.push({ tipo: 'linea', l }); filas.push({ tipo: 'lote', l }) }
  }
  const paginas = []
  for (let i = 0; i < filas.length; i += FILAS) paginas.push(filas.slice(i, i + FILAS))
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Factura ${numero}`, creator: 'Folvy · prueba E10 (inventada)' })
  const total = paginas.length
  paginas.forEach((pag, p) => {
    if (p > 0) doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text(f.proveedor.nombre, 14, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    doc.text(`NIF ${f.proveedor.nif} · ${f.proveedor.direccion}`, 14, 21)
    doc.setFontSize(9)
    doc.text(`FACTURA ${numero}`, 196, 16, { align: 'right' })
    doc.text(`Fecha ${fecha(f.fecha)} · Página ${p + 1} de ${total}`, 196, 21, { align: 'right' })
    if (p === 0) {
      doc.setDrawColor(150); doc.rect(110, 26, 86, 18)
      doc.text('Cliente', 112, 31)
      doc.setFont('helvetica', 'bold'); doc.text(f.cliente.nombre, 112, 36)
      doc.setFont('helvetica', 'normal'); doc.text(`NIF ${f.cliente.nif}`, 112, 40.5); doc.text(f.cliente.direccion, 112, 43.5)
      doc.text('Periodo: octubre de 2026 · Albaranes del mes', 14, 36)
    }
    let y = 56
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
    doc.text('Código', 14, y - 6); doc.text('Artículo', 32, y - 6); doc.text('Cantidad', 128, y - 6, { align: 'right' }); doc.text('Ud.', 132, y - 6)
    doc.text('Precio', 160, y - 6, { align: 'right' }); doc.text('IVA', 172, y - 6, { align: 'right' }); doc.text('Importe', 196, y - 6, { align: 'right' })
    doc.line(14, y - 4.5, 196, y - 4.5)
    doc.setFont('helvetica', 'normal')
    for (const r of pag) {
      if (r.tipo === 'albaran') {
        doc.setFont('helvetica', 'bold'); doc.text(`Albarán ${r.a.numero} · ${fecha(r.a.fecha)}`, 14, y); doc.setFont('helvetica', 'normal')
      } else if (r.tipo === 'linea') {
        const l = r.l
        doc.text(l.supplier_code, 14, y); doc.text(l.raw_text, 32, y); doc.text(num(l.quantity), 128, y, { align: 'right' }); doc.text(l.unit, 132, y)
        doc.text(eur(l.unit_price_net), 160, y, { align: 'right' }); doc.text(`${l.vat_pct}%`, 172, y, { align: 'right' }); doc.text(eur(l.line_amount), 196, y, { align: 'right' })
      } else {
        doc.setFontSize(7.5); doc.setTextColor(90)
        doc.text(`Lote ${r.l.lot_code} · Cad. ${fecha(r.l.expiry_date)}`, 32, y - 2.2)
        doc.setFontSize(8.5); doc.setTextColor(0)
      }
      y += r.tipo === 'lote' ? ALTO * 0.55 : ALTO
    }
    if (p < total - 1) { doc.setFontSize(8); doc.text('Sigue en la página siguiente', 196, 287, { align: 'right' }); doc.setFontSize(8.5) }
    if (p === total - 1) {
      y = Math.max(y + 6, 222)
      doc.line(14, y - 5, 196, y - 5)
      doc.setFont('helvetica', 'bold'); doc.text('Base imponible', 120, y); doc.text('IVA', 160, y); doc.text('Cuota', 196, y, { align: 'right' }); doc.setFont('helvetica', 'normal')
      for (const t of f.tipos) { y += 5; doc.text(eur(t.base), 150, y, { align: 'right' }); doc.text(`${t.vat_pct}%`, 166, y, { align: 'right' }); doc.text(eur(t.vat_amount), 196, y, { align: 'right' }) }
      y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      doc.text('TOTAL FACTURA', 120, y); doc.text(`${eur(f.total)} EUR`, 196, y, { align: 'right' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text(`Forma de pago: ${f.formaPago} · Vencimiento ${fecha(f.vence)}`, 14, y + 9)
      doc.text(`IBAN para el pago: ${f.iban.replace(/(.{4})/g, '$1 ').trim()}`, 14, y + 14)
      doc.text('Documento inventado para pruebas: no es una factura real.', 14, y + 19)
    }
  })
  // Las líneas partidas: las que tienen el importe al final de una página y el lote en la siguiente.
  const partidas = paginas.slice(0, -1).filter((pag) => pag[pag.length - 1].tipo === 'linea').length
  return { bytes: new Uint8Array(doc.output('arraybuffer')), paginas: total, partidas, factura: f }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [albaranes, nombre] of [[20, 'factura-larga-5.pdf'], [40, 'factura-larga-10.pdf']]) {
    const r = pdfFacturaLarga({ albaranes, numero: albaranes === 20 ? 'AV-2026-0000011' : 'AV-2026-0000012' })
    writeFileSync(`tests/conta/e10/${nombre}`, r.bytes)
    console.log(`${nombre}: ${r.paginas} páginas, ${r.factura.lineas.length} líneas, ${r.partidas} partida(s) entre dos páginas, total ${eur(r.factura.total)} €`)
  }
}
