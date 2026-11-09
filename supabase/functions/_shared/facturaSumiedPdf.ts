// supabase/functions/_shared/facturaSumiedPdf.ts
//
// G05 · T4 · EL MODELO DE FACTURA «SUMIED» (Julio, nº 38): el primero de las
// plantillas de factura que vendrán después del 17/11 (decisiones, pendiente
// 17). Lo usan las facturas que salen de un recibo de la gestoría; las de la
// V01 siguen con su PDF (facturaVentaPdf.ts) hasta que se elija modelo.
//
// Fiel a la maqueta aprobada (Factura.dc.html), punto por punto, con sus
// medidas pasadas a milímetros (la hoja de la maqueta mide 720 px de ancho:
// 1 px = 210/720 mm) y sus letras incrustadas (Space Grotesk en los títulos,
// Inter en el texto: fuentes/sumied.ts):
//   · cabecera: el logo (o las iniciales en un cuadrado azul #0E2240) con el
//     nombre del emisor y sus datos; arriba a la derecha, Verifactu: el QR con
//     «VERI*FACTU» y «Factura verificable en la sede electrónica de la AEAT»,
//     o sin QR el recuadro de trazos «Verifactu de pruebas: pendiente»;
//   · «Factura» grande con «Servicios de …» y, a la derecha, Número · Fecha ·
//     Pagada, sobre su línea azul;
//   · el cliente y la forma de pago en dos tarjetas grises, lado a lado;
//   · las líneas sin columna de IVA, con la explicación de cada servicio
//     debajo de su nombre y sus trabajadores debajo (hasta 10; con más, en la
//     hoja aparte, al final);
//   · los totales a la derecha y el total grande con su línea encima;
//   · la franja verde «Pagada el … por domiciliación. No tienes que hacer nada.»;
//   · en una cuenta de demostración, la marca de agua suave en diagonal;
//   · el pie con el emisor y «Hoja N de M».
// Si las cifras no cuadran con las líneas, NO hay PDF: lanza y dice qué.
// Sin dependencias de Node ni de Deno: jsPDF se pasa desde fuera.

import { INTER_400, INTER_600, INTER_700, SPACE_GROTESK_700 } from './fuentes/sumied.ts'

export interface TrabajadorSumied { nombre: string; /** «Desde el 3 de marzo de 2019» o «Alta el 12 de noviembre de 2026». */ desde: string | null }

export interface LineaSumied {
  /** El nombre del servicio: «Gestión laboral». */
  concepto: string
  /** Lo que es, debajo del nombre: «Nóminas y seguros sociales · 4 trabajadores». */
  explicacion: string | null
  cantidad: number
  precioCent: number
  importeCent: number
  trabajadores: TrabajadorSumied[] | null
  /** Debajo de la línea (hasta 10) o en la hoja aparte (más de 10). */
  trabajadoresEn: 'linea' | 'hoja' | null
}

export interface DatosFacturaSumied {
  emisor: {
    nombre: string
    nif: string
    /** Las líneas debajo del NIF: la dirección y el contacto. */
    lineas: string[]
    /** El logo (PNG o JPEG en base64) o, sin él, las iniciales. */
    logo: { base64: string; formato: 'PNG' | 'JPEG' } | null
  }
  numero: string
  /** AAAA-MM-DD */
  fecha: string
  /** AAAA-MM-DD, si está pagada. */
  pagadaEl: string | null
  /** «Servicios de diciembre de 2026». */
  periodo: string
  cliente: { nombre: string; nif: string; codigo: number | null; direccion: string | null }
  pago: { forma: string; cuenta: string | null; texto: string | null }
  lineas: LineaSumied[]
  porTipo: { tipo: number; baseCent: number; ivaCent: number }[]
  baseCent: number
  ivaCent: number
  retencion: { pct: number; cent: number } | null
  totalCent: number
  /** El QR de su registro de Verifactu (la matriz ya calculada) o, sin registro aún, nada: «pendiente». */
  verifactu: { modulos: boolean[][]; prueba: boolean } | null
  /** Cuenta de demostración: la marca de agua y «Datos inventados para la demostración» al pie. */
  demo: boolean
}

/** Los textos fijos del modelo (los de la maqueta). */
export const SUMIED_PDF = {
  marca: 'DEMOSTRACIÓN · SIN VALIDEZ',
  verifactu: 'VERI*FACTU',
  verificable: 'Factura verificable en la sede electrónica de la AEAT',
  pendiente: 'Verifactu de pruebas: pendiente',
  demoPie: 'Datos inventados para la demostración',
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPdfCtor = new (o: { unit: 'mm'; format: 'a4'; orientation: 'portrait' }) => any
type Rgb = [number, number, number]

// Los colores de la maqueta.
const TINTA: Rgb = [15, 27, 45]
const APOYO: Rgb = [74, 91, 116]
const TEXTO2: Rgb = [51, 68, 94]
const TENUE: Rgb = [106, 122, 146]
const NOCHE: Rgb = [14, 34, 64]
const TARJETA: Rgb = [246, 248, 251]
const RAYA: Rgb = [238, 241, 246]
const RAYA_CABEZA: Rgb = [220, 226, 235]
const TRAZOS: Rgb = [201, 211, 227]
const VERDE: Rgb = [11, 107, 79]
const VERDE_FONDO: Rgb = [230, 245, 238]

// Medidas: la hoja de la maqueta mide 720 px de ancho.
const PX = 210 / 720
const PT = PX / 0.352778 // 1 px en puntos
const IZQ = 15.8
const DER = 194.3
const ANCHO = DER - IZQ
// La línea base desde arriba de la caja del texto (ascendente de cada letra).
const ASC = { Inter: 0.96875, SpaceGrotesk: 0.984 }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const fechaLarga = (iso: string, conAnio = true) =>
  `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}${conAnio ? ` de ${iso.slice(0, 4)}` : ''}`
const eur = (cent: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(cent / 100)} €`
const cant = (x: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(x)
const pct = (x: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(x)} %`

/** Las iniciales del emisor: «Gestoría Demo, S.L.» → «GD». */
export const iniciales = (nombre: string) => {
  const p = nombre.replace(/,?\s*(S\.?L\.?U?|S\.?A\.?|S\.?L\.?P\.?|S\.?C\.?)\.?$/i, '').replace(/[,.]/g, ' ').split(/\s+/).filter((x) => x.length > 1 || /\d/.test(x))
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

/** Lo que tiene que cuadrar antes de pintar nada. Vacío = cuadra. */
export function comprobarFacturaSumied(d: DatosFacturaSumied): string[] {
  const mal: string[] = []
  const lineas = d.lineas.reduce((t, l) => t + l.importeCent, 0)
  if (lineas !== d.baseCent) mal.push(`las líneas suman ${eur(lineas)} y la base es ${eur(d.baseCent)}`)
  const base = d.porTipo.reduce((t, x) => t + x.baseCent, 0)
  const iva = d.porTipo.reduce((t, x) => t + x.ivaCent, 0)
  if (base !== d.baseCent) mal.push(`la base por tipos (${eur(base)}) no es la base (${eur(d.baseCent)})`)
  if (iva !== d.ivaCent) mal.push(`el IVA por tipos (${eur(iva)}) no es el IVA (${eur(d.ivaCent)})`)
  const total = d.baseCent + d.ivaCent - (d.retencion?.cent ?? 0)
  if (total !== d.totalCent) mal.push(`base + IVA − retención (${eur(total)}) no es el total (${eur(d.totalCent)})`)
  return mal
}

/** El PDF del modelo «Sumied», en bytes. Lanza si no cuadra. */
export function facturaSumiedPdf(JsPDF: JsPdfCtor, d: DatosFacturaSumied): Uint8Array {
  const mal = comprobarFacturaSumied(d)
  if (mal.length) throw new Error(`La factura ${d.numero} no cuadra: ${mal.join('; ')}`)
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  for (const [fichero, nombre, b64] of [['Inter-400.ttf', 'Inter', INTER_400], ['Inter-600.ttf', 'InterSemi', INTER_600], ['Inter-700.ttf', 'InterBold', INTER_700], ['SpaceGrotesk-700.ttf', 'SpaceGrotesk', SPACE_GROTESK_700]] as const) {
    doc.addFileToVFS(fichero, b64); doc.addFont(fichero, nombre, 'normal')
  }
  type Letra = 'Inter' | 'InterSemi' | 'InterBold' | 'SpaceGrotesk'
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2])
  const relleno = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2])
  const trazo = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2])
  /** Escribe con la letra y el tamaño (en px de la maqueta) y la caja del texto arriba en `arriba` (mm). */
  const texto = (t: string | string[], x: number, arriba: number, letra: Letra, px: number, c: Rgb, opciones: Record<string, unknown> = {}) => {
    doc.setFont(letra, 'normal'); doc.setFontSize(px * PT); color(c)
    const asc = letra === 'SpaceGrotesk' ? ASC.SpaceGrotesk : ASC.Inter
    doc.text(t, x, arriba + asc * px * PX, { baseline: 'alphabetic', ...opciones })
  }
  const ancho = (t: string, letra: Letra, px: number) => { doc.setFont(letra, 'normal'); doc.setFontSize(px * PT); return doc.getTextWidth(t) }
  const partir = (t: string, letra: Letra, px: number, w: number): string[] => { doc.setFont(letra, 'normal'); doc.setFontSize(px * PT); return doc.splitTextToSize(t, w) }
  const raya = (y: number, c: Rgb, grosorPx: number, x0 = IZQ, x1 = DER) => { trazo(c); doc.setLineWidth(grosorPx * PX); doc.line(x0, y, x1, y) }

  // La marca, centrada a media hoja (52 % de la altura), girada 28° y por encima de todo con un 5 % de
  // opacidad, como en la maqueta (rgba(14,34,64,.05) en una capa encima). Se pinta al final de cada hoja.
  const pintarMarca = () => {
    if (!d.demo) return
    doc.setFont('SpaceGrotesk', 'normal'); doc.setFontSize(44 * PT); color(NOCHE)
    const w = doc.getTextWidth(SUMIED_PDF.marca), a = (28 * Math.PI) / 180, cy = 297 * 0.52, medio = 44 * PX * 0.35
    doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.05 }))
    // El punto de partida para que el centro del texto caiga en (105, cy).
    doc.text(SUMIED_PDF.marca, 105 - (w / 2) * Math.cos(a) + medio * Math.sin(a), cy + (w / 2) * Math.sin(a) + medio * Math.cos(a), { angle: 28 })
    doc.restoreGraphicsState()
  }

  // ── Cabecera: el emisor y Verifactu ───────────────────────────────────────
  const LOGO = 38 * PX
  if (d.emisor.logo) {
    doc.addImage(d.emisor.logo.base64, d.emisor.logo.formato, IZQ, 13.6, LOGO, LOGO)
  } else {
    relleno(NOCHE); doc.roundedRect(IZQ, 13.6, LOGO, LOGO, 10 * PX, 10 * PX, 'F')
    texto(iniciales(d.emisor.nombre), IZQ + LOGO / 2, 13.6 + (LOGO - 15 * PX * 1.21) / 2, 'SpaceGrotesk', 15, [255, 255, 255], { align: 'center' })
  }
  texto(d.emisor.nombre, 29.8, 13.6 + (LOGO - 19 * PX * 1.276) / 2, 'SpaceGrotesk', 19, TINTA)
  const emisor = [`NIF ${d.emisor.nif}`, ...d.emisor.lineas]
  emisor.forEach((l, i) => texto(l, IZQ, 27.9 + i * 5.2, 'Inter', 11.5, APOYO))
  const finEmisor = 27.6 + emisor.length * 5.2

  const vfX = 161.9, vfW = 104 * PX, vfC = vfX + vfW / 2
  let finVf: number
  if (d.verifactu && d.verifactu.modulos.length) {
    texto(SUMIED_PDF.verifactu, vfC, 13.6, 'InterBold', 9.5, TINTA, { align: 'center' })
    const n = d.verifactu.modulos.length, lado = vfW / n
    relleno(TINTA)
    d.verifactu.modulos.forEach((fila, i) => fila.forEach((negro, j) => { if (negro) doc.rect(vfX + j * lado, 18.0 + i * lado, lado, lado, 'F') }))
    texto(partir(SUMIED_PDF.verificable, 'Inter', 8.5, 33), vfC, 49.5, 'Inter', 8.5, APOYO, { align: 'center', lineHeightFactor: 1.3 })
    finVf = 55.9
  } else {
    trazo(TRAZOS); doc.setLineWidth(1.5 * PX); doc.setLineDashPattern([1.2, 0.9], 0)
    doc.roundedRect(vfX, 13.6, vfW, vfW, 6 * PX, 6 * PX, 'S'); doc.setLineDashPattern([], 0)
    const l = partir(SUMIED_PDF.pendiente, 'Inter', 10, vfW - 16 * PX)
    const alto = l.length * 10 * PX * 1.35
    texto(l, vfC, 13.6 + (vfW - alto) / 2, 'Inter', 10, APOYO, { align: 'center', lineHeightFactor: 1.35 })
    finVf = 13.6 + vfW
  }

  // ── «Factura» y su número, sobre su línea ─────────────────────────────────
  const T = Math.max(finEmisor, finVf) + 26 * PX // 26 px entre bloques, como la maqueta
  texto('Factura', IZQ, T, 'SpaceGrotesk', 30, TINTA)
  texto(d.periodo, IZQ, T + 12.5, 'Inter', 12, APOYO)
  const datos: [string, string][] = [['Número', d.numero], ['Fecha', fechaLarga(d.fecha)], ...(d.pagadaEl ? [['Pagada', fechaLarga(d.pagadaEl)] as [string, string]] : [])]
  const anchoValor = Math.max(...datos.map(([, v]) => ancho(v, 'InterBold', 12)))
  const xValor = DER - anchoValor, xEtiqueta = xValor - 16 * PX - Math.max(...datos.map(([e]) => ancho(e, 'Inter', 12)))
  const y0datos = T + 12.5 - (datos.length - 1) * 5.25
  datos.forEach(([e, v], i) => { texto(e, xEtiqueta, y0datos + i * 5.25, 'Inter', 12, APOYO); texto(v, xValor, y0datos + i * 5.25, 'InterBold', 12, TINTA) })
  raya(T + 21.3, NOCHE, 2)

  // ── El cliente y la forma de pago, lado a lado ────────────────────────────
  const C = T + 21.6 + 26 * PX
  const tarjetaW = 86.9, tarjetaX = [IZQ, 107.3], dentro = 14 * PX
  const cliente = [`NIF ${d.cliente.nif}${d.cliente.codigo ? ` · Código cliente ${d.cliente.codigo}` : ''}`, ...(d.cliente.direccion ? partir(d.cliente.direccion, 'Inter', 11.5, tarjetaW - 2 * dentro) : [])]
  const pago = [d.pago.cuenta, d.pago.texto].filter((x): x is string => !!x)
  const tarjetaH = 14.9 + Math.max(cliente.length, pago.length) * 5.03 + 3.2
  relleno(TARJETA)
  tarjetaX.forEach((x) => doc.roundedRect(x, C, tarjetaW, tarjetaH, 10 * PX, 10 * PX, 'F'))
  const tarjeta = (x: number, titulo: string, nombre: string, lineas: string[]) => {
    doc.setCharSpace(0.4 * PX); texto(titulo, x + dentro, C + 3.5, 'InterBold', 10.5, APOYO); doc.setCharSpace(0)
    texto(nombre, x + dentro, C + 8.5, 'InterBold', 14, TINTA)
    lineas.forEach((l, i) => texto(l, x + dentro, C + 14.9 + i * 5.03, 'Inter', 11.5, TEXTO2))
  }
  tarjeta(tarjetaX[0], 'CLIENTE', d.cliente.nombre, cliente)
  tarjeta(tarjetaX[1], 'FORMA DE PAGO', d.pago.forma, pago)

  // ── Las líneas ───────────────────────────────────────────────────────────────
  const col = { cant: 144.6, precio: 168.0, importe: DER }
  let y = C + tarjetaH + 9.9 // arriba del texto de la cabecera de la tabla
  const cabeza = () => {
    texto('Concepto', IZQ, y, 'InterSemi', 11, APOYO)
    texto('Cant.', col.cant, y, 'InterSemi', 11, APOYO, { align: 'right' })
    texto('Precio', col.precio, y, 'InterSemi', 11, APOYO, { align: 'right' })
    texto('Importe', col.importe, y, 'InterSemi', 11, APOYO, { align: 'right' })
    y += 6.6; raya(y, RAYA_CABEZA, 1)
  }
  cabeza()
  const hojas: LineaSumied[] = []
  const LIMITE = 232 // por debajo de aquí las líneas no caben: a la hoja siguiente
  for (const [i, l] of d.lineas.entries()) {
    const debajo = l.trabajadoresEn === 'linea' ? l.trabajadores ?? [] : []
    const alto = 3.3 + 4.4 + (l.explicacion || l.trabajadoresEn === 'hoja' ? 4.9 : 0) + (debajo.length ? 1.9 + debajo.length * 5.8 + 1.9 : 3.2)
    if (y + alto > LIMITE && i > 0) { doc.addPage(); y = 20; cabeza() }
    const top = y + 3.3
    texto(l.concepto, IZQ, top, 'InterSemi', 12.5, TINTA)
    const explicacion = l.trabajadoresEn === 'hoja' && l.trabajadores?.length ? [l.explicacion, 'detalle en la hoja aparte'].filter(Boolean).join(' · ') : l.explicacion
    if (explicacion) texto(explicacion, IZQ, top + 5.0, 'Inter', 11, APOYO)
    texto(cant(l.cantidad), col.cant, top, 'Inter', 12.5, TINTA, { align: 'right' })
    texto(eur(l.precioCent), col.precio, top, 'Inter', 12.5, TINTA, { align: 'right' })
    texto(eur(l.importeCent), col.importe, top, 'InterSemi', 12.5, TINTA, { align: 'right' })
    y = top + 4.4 + (explicacion ? 4.9 : 0)
    if (l.trabajadoresEn === 'hoja' && l.trabajadores?.length) hojas.push(l)
    if (debajo.length) {
      y += 1.9
      const precio = l.cantidad === debajo.length ? eur(l.precioCent) : null
      for (const t of debajo) {
        const nombre = `· ${t.nombre}`
        texto(nombre, IZQ + 16 * PX, y + 0.8, 'Inter', 11.5, TEXTO2)
        if (t.desde) texto(` — ${t.desde}`, IZQ + 16 * PX + ancho(nombre, 'Inter', 11.5), y + 0.8, 'Inter', 11.5, TENUE)
        if (precio) texto(precio, DER, y + 0.8, 'Inter', 11.5, TEXTO2, { align: 'right' })
        y += 5.8
      }
      y += 1.9
    } else y += 3.2
    raya(y, RAYA, 1)
  }

  // ── Los totales ──────────────────────────────────────────────────────────────
  y += 26 * PX
  if (y + 6.2 * (2 + d.porTipo.length) + 12 > 263.5 - 26 * PX) { doc.addPage(); y = 20 }
  const totX = 118.4
  const fila = (etiqueta: string, valor: string) => { texto(etiqueta, totX, y, 'Inter', 12.5, APOYO); texto(valor, DER, y, 'Inter', 12.5, TINTA, { align: 'right' }); y += 6.2 }
  fila('Base imponible', eur(d.baseCent))
  for (const t of d.porTipo) fila(`IVA ${pct(t.tipo)}`, eur(t.ivaCent))
  if (d.retencion && d.retencion.cent) fila(`Retención IRPF ${pct(d.retencion.pct)}`, `−${eur(d.retencion.cent)}`)
  y += 0.5
  raya(y, NOCHE, 2, totX, DER)
  texto('Total', totX, y + 5.5, 'InterBold', 13, TINTA)
  texto(eur(d.totalCent), DER, y + 2.9, 'SpaceGrotesk', 22, TINTA, { align: 'right' })

  // ── La franja verde, abajo ─────────────────────────────────────────────────────
  if (d.pagadaEl && /domiciliaci/i.test(d.pago.forma)) {
    relleno(VERDE_FONDO); doc.roundedRect(IZQ, 263.5, ANCHO, 10.2, 10 * PX, 10 * PX, 'F')
    texto(`Pagada el ${fechaLarga(d.pagadaEl, false)} por domiciliación. No tienes que hacer nada.`, 19.8, 266.4, 'InterSemi', 12, VERDE)
  }

  // ── La hoja aparte: los trabajadores de cada servicio que lleva más de 10 ───────
  for (const l of hojas) {
    doc.addPage(); y = 20
    texto(`Factura ${d.numero} · ${l.concepto}`, IZQ, y, 'SpaceGrotesk', 19, TINTA); y += 9
    texto(`Los ${l.trabajadores!.length} trabajadores de este servicio`, IZQ, y, 'Inter', 12, APOYO); y += 7
    raya(y, RAYA_CABEZA, 1); y += 2.5
    const precio = l.cantidad === l.trabajadores!.length ? eur(l.precioCent) : null
    for (const t of l.trabajadores!) {
      if (y > 268) { doc.addPage(); y = 20 }
      const nombre = `· ${t.nombre}`
      texto(nombre, IZQ, y, 'Inter', 11.5, TEXTO2)
      if (t.desde) texto(` — ${t.desde}`, IZQ + ancho(nombre, 'Inter', 11.5), y, 'Inter', 11.5, TENUE)
      if (precio) texto(precio, DER, y, 'Inter', 11.5, TEXTO2, { align: 'right' })
      y += 5.8
    }
  }

  // ── El pie de cada hoja ──────────────────────────────────────────────────────
  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p)
    pintarMarca()
    raya(276.6, RAYA, 1)
    texto(d.demo ? `${d.emisor.nombre} · ${SUMIED_PDF.demoPie}` : d.emisor.nombre, IZQ, 279.8, 'Inter', 10, TENUE)
    texto(`Hoja ${p} de ${n}`, DER, 279.8, 'Inter', 10, TENUE, { align: 'right' })
  }

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}
