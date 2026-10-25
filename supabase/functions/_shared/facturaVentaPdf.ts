// supabase/functions/_shared/facturaVentaPdf.ts
//
// V01 · Entrega 1 · EL PDF DE UNA FACTURA DE VENTA (tablero 11, Julio 24/10).
// Una página A4 blanca: la empresa a la izquierda y «FACTURA F-2026/0087» con
// su fecha a la derecha; «Para:» el cliente con su NIF y su dirección; las
// líneas (cantidad × concepto, precio, IVA, importe); la base y el IVA por
// tipo, el recargo y la retención si los hay, y el TOTAL; el vencimiento y la
// forma de cobro; y, en una rectificativa, a cuál corrige, el motivo y que los
// importes son la diferencia.
//
// V03 · E1: si la factura tiene su registro de Verifactu, lleva arriba a la
// derecha el QR tributario (32 mm, nivel M, «QR tributario:» encima y
// «VERI*FACTU» debajo: especificaciones del QR v0.5.0, §6). En el entorno de
// pruebas, además, «PRUEBA» y una nota al pie: no vale ante Hacienda. Sin
// registro (Verifactu apagado, traídas de Diez, anteriores a pasar a real), sin QR.
//
// Si las cifras no cuadran con las líneas, NO hay PDF: lanza y dice qué (un
// documento que no cuadra con su factura es peor que ninguno).
//
// Sin dependencias de Node ni de Deno: jsPDF se pasa desde fuera (en Node,
// `import { jsPDF } from 'jspdf'`; en una edge function, `npm:jspdf`).

export interface LineaPdf { concepto: string; cantidad: number; precio: number; descuento: number; tipo: number; importe: number }
export interface DatosFacturaPdf {
  empresa: { nombre: string; nif: string; direccion: string | null }
  numero: string
  /** AAAA-MM-DD */
  fecha: string
  vence: string | null
  formaCobro: string | null
  cliente: { nombre: string; nif: string; direccion: string | null }
  lineas: LineaPdf[]
  porTipo: { tipo: number; base: number; iva: number; recargo: number }[]
  base: number
  iva: number
  recargo: number
  retencion: { pct: number; importe: number } | null
  total: number
  notas: string | null
  /** En una rectificativa: a cuál corrige, por qué y qué se corrige. */
  rectifica: { numero: string; motivo: string; que: string } | null
  /** V03: el QR de su registro de Verifactu (la matriz de módulos, ya calculada), o nada. */
  verifactu?: { modulos: boolean[][]; prueba: boolean } | null
}

/** V03: el lado del QR en mm (entre 30 y 40, §6; el mismo que QR_MM.elegido de qr.ts) y sus leyendas. */
export const QR_PDF = { mm: 32, encima: 'QR tributario:', debajo: 'VERI*FACTU', prueba: 'PRUEBA' } as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPdfCtor = new (o: { unit: 'mm'; format: 'a4'; orientation: 'portrait' }) => any

const TINTA: [number, number, number] = [11, 31, 59]
const GRIS: [number, number, number] = [74, 91, 115]
const LINEA: [number, number, number] = [226, 232, 240]
const SUAVE: [number, number, number] = [234, 242, 248]
const AZUL: [number, number, number] = [30, 99, 201]

const cts = (x: number) => Math.round(x * 100)
const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)
const cantidad = (x: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)
const pct = (x: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(x)} %`
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Lo que tiene que cuadrar antes de pintar nada. Vacío = cuadra. */
export function comprobarFactura(d: DatosFacturaPdf): string[] {
  const mal: string[] = []
  // En una rectificativa los importes son la diferencia: sus líneas son lo que debía ser, no lo que suma.
  if (!d.rectifica) {
    const lineas = d.lineas.reduce((t, l) => t + cts(l.importe), 0)
    if (lineas !== cts(d.base)) mal.push(`las líneas suman ${euros(lineas / 100)} € y la base es ${euros(d.base)} €`)
  }
  const base = d.porTipo.reduce((t, x) => t + cts(x.base), 0)
  const iva = d.porTipo.reduce((t, x) => t + cts(x.iva), 0)
  const rec = d.porTipo.reduce((t, x) => t + cts(x.recargo), 0)
  if (base !== cts(d.base)) mal.push(`la base por tipos (${euros(base / 100)}) no es la base (${euros(d.base)})`)
  if (iva !== cts(d.iva)) mal.push(`el IVA por tipos (${euros(iva / 100)}) no es el IVA (${euros(d.iva)})`)
  if (rec !== cts(d.recargo)) mal.push(`el recargo por tipos (${euros(rec / 100)}) no es el recargo (${euros(d.recargo)})`)
  const total = cts(d.base) + cts(d.iva) + cts(d.recargo) - cts(d.retencion?.importe ?? 0)
  if (total !== cts(d.total)) mal.push(`base + IVA + recargo − retención (${euros(total / 100)}) no es el total (${euros(d.total)})`)
  return mal
}

/** El nombre del fichero: «F-2026-0087.pdf». */
export const nombreFacturaPdf = (numero: string): string => `${numero.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`

/** El PDF, en bytes. Lanza si no cuadra. */
export function facturaVentaPdf(JsPDF: JsPdfCtor, d: DatosFacturaPdf): Uint8Array {
  const mal = comprobarFactura(d)
  if (mal.length) throw new Error(`La factura ${d.numero} no cuadra: ${mal.join('; ')}`)
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const W = 210, M = 18, ANCHO = W - 2 * M
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const relleno = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const trazo = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const letra = (estilo: 'normal' | 'bold', tam: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam) }
  const titulo = d.rectifica ? 'FACTURA RECTIFICATIVA' : 'FACTURA'

  // ── Cabecera: la empresa y el número ──────────────────────────────────────
  // Con QR, el número y la fecha van a su izquierda.
  const vf = d.verifactu && d.verifactu.modulos.length ? d.verifactu : null
  const derecha = vf ? W - M - QR_PDF.mm - 4 : W - M
  let y = M + 4
  color(TINTA); letra('bold', 13); doc.text(d.empresa.nombre, M, y)
  letra('bold', 10); doc.text(`${titulo} ${d.numero}`, derecha, y, { align: 'right' })
  letra('normal', 9); color(GRIS)
  doc.text(`NIF ${d.empresa.nif}`, M, y + 5)
  if (d.empresa.direccion) doc.text(doc.splitTextToSize(d.empresa.direccion, 90), M, y + 10)
  doc.text(fecha(d.fecha), derecha, y + 5, { align: 'right' })

  // ── El QR tributario (V03) ──────────────────────────────────────────────────
  if (vf) {
    const x0 = W - M - QR_PDF.mm, y0 = M + 1, n = vf.modulos.length, lado = QR_PDF.mm / n
    color(TINTA); letra('normal', 7); doc.text(QR_PDF.encima, x0 + QR_PDF.mm / 2, y0 - 1.5, { align: 'center' })
    relleno(TINTA)
    vf.modulos.forEach((fila, i) => fila.forEach((negro, j) => { if (negro) doc.rect(x0 + j * lado, y0 + i * lado, lado, lado, 'F') }))
    letra('bold', 8); doc.text(QR_PDF.debajo, x0 + QR_PDF.mm / 2, y0 + QR_PDF.mm + 4, { align: 'center' })
    if (vf.prueba) { doc.setTextColor(200, 30, 30); letra('bold', 10); doc.text(QR_PDF.prueba, derecha, y + 11, { align: 'right' }) }
  }

  // ── Para ───────────────────────────────────────────────────────────────────
  y += vf ? 34 : 22
  color(GRIS); letra('normal', 9); doc.text('Para:', M, y)
  color(TINTA); letra('bold', 10); doc.text(`${d.cliente.nombre} · ${d.cliente.nif}`, M + 12, y)
  if (d.cliente.direccion) { letra('normal', 9); color(GRIS); doc.text(doc.splitTextToSize(d.cliente.direccion, ANCHO - 12), M + 12, y + 5) }
  y += d.cliente.direccion ? 12 : 8

  if (d.rectifica) {
    relleno(SUAVE); doc.rect(M, y, ANCHO, 12, 'F')
    color(TINTA); letra('bold', 9); doc.text(`Rectifica la factura ${d.rectifica.numero} · ${d.rectifica.que}`, M + 3, y + 5)
    letra('normal', 9); doc.text(doc.splitTextToSize(`Motivo: ${d.rectifica.motivo}`, ANCHO - 6)[0], M + 3, y + 9.5)
    y += 16
  }

  // ── Las líneas ───────────────────────────────────────────────────────────────
  const X = { concepto: M, cantidad: M + 96, precio: M + 122, iva: M + 146, importe: W - M }
  trazo(LINEA); doc.setLineWidth(0.3)
  color(GRIS); letra('bold', 8)
  doc.text('Concepto', X.concepto, y + 4)
  doc.text('Cantidad', X.cantidad, y + 4, { align: 'right' })
  doc.text('Precio', X.precio, y + 4, { align: 'right' })
  doc.text('IVA', X.iva, y + 4, { align: 'right' })
  doc.text(d.rectifica ? 'Debía ser' : 'Importe', X.importe, y + 4, { align: 'right' })
  doc.line(M, y + 6, W - M, y + 6)
  y += 11
  letra('normal', 9); color(TINTA)
  for (const l of d.lineas) {
    if (y > 250) { doc.addPage(); y = M + 6 }
    const texto = doc.splitTextToSize(l.descuento ? `${l.concepto} (dto. ${pct(l.descuento)})` : l.concepto, 92) as string[]
    doc.text(texto, X.concepto, y)
    doc.text(cantidad(l.cantidad), X.cantidad, y, { align: 'right' })
    doc.text(euros(l.precio), X.precio, y, { align: 'right' })
    doc.text(pct(l.tipo), X.iva, y, { align: 'right' })
    doc.text(euros(l.importe), X.importe, y, { align: 'right' })
    y += 4.5 * texto.length + 2
    doc.line(M, y - 3, W - M, y - 3)
  }

  // ── Los totales ──────────────────────────────────────────────────────────────
  y += 4
  const fila = (etiqueta: string, valor: string, fuerte = false) => {
    letra(fuerte ? 'bold' : 'normal', fuerte ? 11 : 9); color(fuerte ? TINTA : GRIS)
    doc.text(etiqueta, W - M - 62, y); color(TINTA); doc.text(valor, W - M, y, { align: 'right' })
    y += fuerte ? 7 : 5
  }
  if (d.rectifica) { color(GRIS); letra('normal', 8); doc.text('Los importes son la diferencia con la factura que rectifica.', W - M, y, { align: 'right' }); y += 6 }
  for (const t of d.porTipo) {
    fila(`Base ${pct(t.tipo)}`, euros(t.base))
    fila(`IVA ${pct(t.tipo)}`, euros(t.iva))
    if (t.recargo) fila(`Recargo de equivalencia`, euros(t.recargo))
  }
  if (d.retencion && d.retencion.importe) fila(`Retención IRPF ${pct(d.retencion.pct)}`, `−${euros(d.retencion.importe)}`)
  trazo(TINTA); doc.setLineWidth(0.5); doc.line(W - M - 62, y - 2, W - M, y - 2); y += 3
  fila('TOTAL', `${euros(d.total)} €`, true)

  // ── El cobro y las notas ─────────────────────────────────────────────────────
  y += 4
  color(GRIS); letra('normal', 9)
  const cobro = [d.vence ? `Vence el ${fecha(d.vence)}` : null, d.formaCobro ? `Forma de cobro: ${d.formaCobro}` : null].filter(Boolean).join(' · ')
  if (cobro) { relleno(SUAVE); doc.rect(M, y, ANCHO, 9, 'F'); color(AZUL); doc.text(cobro, M + 3, y + 5.8); y += 13 }
  if (d.notas) { color(GRIS); doc.text(doc.splitTextToSize(d.notas, ANCHO), M, y) }
  if (vf?.prueba) {
    doc.setTextColor(200, 30, 30); letra('normal', 8)
    doc.text('Factura de PRUEBA: enviada al entorno de pruebas de Hacienda, no tiene validez.', W / 2, 287, { align: 'center' })
  }

  const out = doc.output('arraybuffer') as ArrayBuffer
  return new Uint8Array(out)
}
