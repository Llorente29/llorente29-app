// supabase/functions/_shared/resumenVentasPdf.ts
//
// C04b · R14 · EL «RESUMEN DE VENTAS» DEL DÍA, el PDF que acompaña a cada
// factura de ventas que va a Diez (Julio, 13/10: sin documento no se envía).
//
// Un día, un local y una plataforma = una factura = un PDF. Lleva:
//   · cabecera: empresa y NIF, local, plataforma, fecha, número de factura y
//     «Generado por Folvy el …»;
//   · los pedidos (hora, nº de pedido de la plataforma, marca, base, IVA y
//     total) y, aparte y en negativo, los reembolsos;
//   · los totales por marca, que son EXACTAMENTE las líneas de la factura;
//   · el total del día, igual a la base, la cuota y el total de la factura y
//     al cobro de la plataforma (430);
//   · el pie que dice qué es.
// Si algo de eso no cuadra, NO hay PDF: lanza y dice qué. Un documento que no
// cuadra con su factura es peor que ninguno.
//
// Sin dependencias de Node ni de Deno: jsPDF se pasa desde fuera (en Node,
// `import { jsPDF } from 'jspdf'`; en una edge function, `npm:jspdf`).
// Estilo: el de las maquetas de contabilidad (tinta #0E1A2B, gris #5B6678,
// líneas #E6EAF0, azul #2F5BFF, menta #2EE6A8) en Helvetica, como los libros.

/**
 * Un pedido. C06b (16/10): `promocion` y `envio`, en base, si el asiento las
 * lleva aparte: la venta de su marca es base + promoción − envío.
 */
export type PedidoResumen = { hora: string; codigo: string; marca: string; base: number; cuota: number; total: number; promocion?: number; envio?: number }
/** Una línea de la factura. C06b: `papel` en la de promociones (resta) y la de envíos cobrados. */
export type MarcaResumen = { marca: string; cuenta: string; importe: number; papel?: 'promociones' | 'envios' }
export type DatosResumenVentas = {
  empresa: { nombre: string; nif: string }
  local: string
  plataforma: string
  /** AAAA-MM-DD */
  fecha: string
  /**
   * El número de la factura de Diez. null = la plataforma aún no tiene su
   * factura medida en Diez (R15: Glovo, Just Eat): el PDF lleva el asiento.
   */
  numeroFactura: string | null
  /** El asiento de Folvy («Ventas nº 1.287»); obligatorio si no hay factura. */
  asiento?: string
  /** Cuándo se genera (se escribe en hora de Madrid). */
  generado: Date
  /** IVA de las ventas, en %. */
  tipoIva: number
  pedidos: PedidoResumen[]
  /** Importes en positivo: el PDF los pinta en negativo. */
  reembolsos: PedidoResumen[]
  /** Las líneas de la factura: ventas en positivo, reembolsos en negativo. */
  lineasFactura: MarcaResumen[]
  factura: { base: number; cuota: number; total: number }
  /** Lo que cobra la plataforma (la 430 del asiento). */
  cobro: number
}

// jsPDF entra desde fuera: aquí no se importan sus tipos, para que el mismo
// fichero sirva en Node y en Deno sin resolver «jspdf».
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPdfCtor = new (o: { unit: 'mm'; format: 'a4'; orientation: 'portrait' }) => any

const TINTA: [number, number, number] = [14, 26, 43]
const GRIS: [number, number, number] = [91, 102, 120]
const LINEA: [number, number, number] = [230, 234, 240]
const SUAVE: [number, number, number] = [245, 247, 250]
const MENTA: [number, number, number] = [46, 230, 168]
const MENTA_SUAVE: [number, number, number] = [227, 251, 242]
const AMBAR: [number, number, number] = [138, 75, 0]

const cts = (x: number) => Math.round(x * 100)
const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x) + ' €'
const fechaLarga = (iso: string) => {
  const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const madrid = (d: Date) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(d).replace(',', ' a las')

/** Lo que tiene que cuadrar antes de pintar nada. Devuelve los fallos; vacío = cuadra. */
export function comprobarResumen(d: DatosResumenVentas): string[] {
  const mal: string[] = []
  const suma = (xs: PedidoResumen[], k: 'base' | 'cuota' | 'total') => xs.reduce((t, x) => t + cts(x[k]), 0)
  for (const p of [...d.pedidos, ...d.reembolsos]) if (cts(p.base) + cts(p.cuota) !== cts(p.total)) mal.push(`el pedido ${p.codigo}: base + IVA no es su total`)
  // Por marca: lo de sus pedidos menos sus reembolsos = su línea de la factura.
  // C06b: la marca a precio de carta (base + promoción − envío); la promoción
  // y el envío, cada uno contra su línea.
  const porMarca = new Map<string, number>()
  const promo = d.lineasFactura.find((l) => l.papel === 'promociones')?.marca
  const envio = d.lineasFactura.find((l) => l.papel === 'envios')?.marca
  for (const p of d.pedidos) {
    porMarca.set(p.marca, (porMarca.get(p.marca) ?? 0) + cts(p.base) + cts(p.promocion ?? 0) - cts(p.envio ?? 0))
    if (p.promocion) porMarca.set(promo ?? 'Promociones (sin línea)', (porMarca.get(promo ?? 'Promociones (sin línea)') ?? 0) - cts(p.promocion))
    if (p.envio) porMarca.set(envio ?? 'Envíos (sin línea)', (porMarca.get(envio ?? 'Envíos (sin línea)') ?? 0) + cts(p.envio))
  }
  for (const p of d.reembolsos) porMarca.set(p.marca, (porMarca.get(p.marca) ?? 0) - cts(p.base))
  const lineas = new Map<string, number>()
  for (const l of d.lineasFactura) lineas.set(l.marca, (lineas.get(l.marca) ?? 0) + cts(l.importe))
  for (const m of new Set([...porMarca.keys(), ...lineas.keys()])) {
    if ((porMarca.get(m) ?? 0) !== (lineas.get(m) ?? 0)) mal.push(`la marca ${m}: sus pedidos suman ${euros((porMarca.get(m) ?? 0) / 100)} y su línea de la factura ${euros((lineas.get(m) ?? 0) / 100)}`)
  }
  const base = suma(d.pedidos, 'base') - suma(d.reembolsos, 'base')
  const cuota = suma(d.pedidos, 'cuota') - suma(d.reembolsos, 'cuota')
  const total = suma(d.pedidos, 'total') - suma(d.reembolsos, 'total')
  if (base !== cts(d.factura.base)) mal.push(`la base del día (${euros(base / 100)}) no es la de la factura (${euros(d.factura.base)})`)
  if (cuota !== cts(d.factura.cuota)) mal.push(`el IVA del día (${euros(cuota / 100)}) no es el de la factura (${euros(d.factura.cuota)})`)
  if (total !== cts(d.factura.total)) mal.push(`el total del día (${euros(total / 100)}) no es el de la factura (${euros(d.factura.total)})`)
  if (total !== cts(d.cobro)) mal.push(`el total del día (${euros(total / 100)}) no es lo que cobra la plataforma (${euros(d.cobro)})`)
  return mal
}

/** El PDF, en bytes. Lanza si no cuadra (comprobarResumen). */
export function resumenVentasPdf(JsPDF: JsPdfCtor, d: DatosResumenVentas): Uint8Array {
  const mal = comprobarResumen(d)
  if (mal.length) throw new Error(`El resumen de ventas no cuadra con su factura: ${mal.join('; ')}`)

  if (d.numeroFactura == null && !d.asiento) throw new Error('El resumen de ventas lleva el número de su factura o el de su asiento: no tiene ninguno.')
  // A qué documento acompaña: la factura de Diez o, si aún no la hay, el asiento.
  const ref = d.numeroFactura != null
    ? { etiqueta: 'Factura', valor: d.numeroFactura, de: `de la factura ${d.numeroFactura}`, el: `La factura ${d.numeroFactura}`, cuadra: 'con la factura' }
    : { etiqueta: 'Asiento', valor: d.asiento!, de: `del asiento ${d.asiento}`, el: `El asiento ${d.asiento}`, cuadra: 'con el asiento' }

  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const W = 210, H = 297, M = 16, ANCHO = W - 2 * M
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const relleno = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const trazo = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const letra = (estilo: 'normal' | 'bold', tam: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam) }
  const generado = madrid(d.generado)
  let y = 0

  // ── Cabecera ────────────────────────────────────────────────────────────────
  const cabecera = (primera: boolean) => {
    relleno(TINTA); doc.rect(0, 0, W, primera ? 40 : 14, 'F')
    relleno(MENTA); doc.rect(0, primera ? 40 : 14, W, 1.2, 'F')
    if (!primera) {
      letra('bold', 9); doc.setTextColor(255, 255, 255)
      doc.text(`Resumen de ventas · ${d.plataforma} · ${d.local} · ${fechaLarga(d.fecha)}`, M, 9)
      letra('normal', 9); doc.text(`${ref.etiqueta} ${ref.valor}`, W - M, 9, { align: 'right' })
      y = 26
      return
    }
    letra('bold', 8); doc.setTextColor(46, 230, 168); doc.text('RESUMEN DE VENTAS', M, 12)
    letra('bold', 18); doc.setTextColor(255, 255, 255); doc.text(`${d.plataforma} · ${d.local}`, M, 21)
    letra('normal', 11); doc.setTextColor(201, 208, 220); doc.text(fechaLarga(d.fecha), M, 28)
    letra('normal', 8.5); doc.text(`${d.empresa.nombre} · NIF ${d.empresa.nif}`, M, 35)
    // A la derecha, la factura (o el asiento).
    letra('normal', 8); doc.setTextColor(201, 208, 220); doc.text(ref.etiqueta, W - M, 12, { align: 'right' })
    letra('bold', 12); doc.setTextColor(255, 255, 255); doc.text(ref.valor, W - M, 19, { align: 'right' })
    letra('normal', 8); doc.setTextColor(201, 208, 220); doc.text(`Generado por Folvy el ${generado}`, W - M, 35, { align: 'right' })
    y = 50
  }
  const pie = () => {
    const n = doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      doc.setPage(i)
      trazo(LINEA); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16)
      letra('normal', 8); color(GRIS)
      doc.text('Este documento resume las ventas registradas en Folvy para este día y plataforma.', M, H - 10.5)
      doc.text(`Página ${i} de ${n}`, W - M, H - 10.5, { align: 'right' })
    }
  }
  const sitio = (alto: number) => { if (y + alto > H - 22) { doc.addPage(); cabecera(false) } }
  const titulo = (t: string, nota?: string) => {
    sitio(16)
    letra('bold', 11); color(TINTA); doc.text(t, M, y)
    if (nota) { letra('normal', 8.5); color(GRIS); doc.text(nota, W - M, y, { align: 'right' }) }
    y += 3; trazo(TINTA); doc.setLineWidth(0.4); doc.line(M, y, W - M, y); y += 5
  }

  cabecera(true)

  // ── Las cifras del día ─────────────────────────────────────────────────────
  const tarjetas: [string, string, boolean][] = [
    ['Pedidos', String(d.pedidos.length) + (d.reembolsos.length ? ` · ${d.reembolsos.length} reembolso${d.reembolsos.length === 1 ? '' : 's'}` : ''), false],
    ['Base imponible', euros(d.factura.base), false],
    [`IVA ${d.tipoIva} %`, euros(d.factura.cuota), false],
    ['Total del día', euros(d.factura.total), true],
  ]
  const tw = (ANCHO - 3 * 4) / 4
  tarjetas.forEach(([k, v, fuerte], i) => {
    const x = M + i * (tw + 4)
    relleno(fuerte ? MENTA_SUAVE : SUAVE); trazo(fuerte ? MENTA : LINEA); doc.setLineWidth(0.3)
    doc.roundedRect(x, y, tw, 19, 2, 2, 'FD')
    letra('normal', 8); color(GRIS); doc.text(k, x + 4, y + 6.5)
    letra('bold', 13); color(TINTA); doc.text(v, x + 4, y + 14.5)
  })
  y += 29

  // ── Tablas ─────────────────────────────────────────────────────────────────
  type Col = { t: string; w: number; der?: boolean }
  const tabla = (cols: Col[], filas: string[][], o: { negativo?: boolean; total?: string[] } = {}) => {
    const cab = () => {
      relleno(SUAVE); doc.rect(M, y - 4.2, ANCHO, 6.4, 'F')
      letra('bold', 8); color(GRIS)
      let x = M + 2
      for (const c of cols) { doc.text(c.t, c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w }
      y += 6
    }
    cab()
    filas.forEach((f) => {
      if (y + 6 > H - 22) { doc.addPage(); cabecera(false); cab() }
      letra('normal', 9); color(o.negativo ? AMBAR : TINTA)
      let x = M + 2
      cols.forEach((c, i) => {
        const txt = doc.splitTextToSize(f[i], c.w - 4)[0] as string
        doc.text(txt, c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w
      })
      trazo(LINEA); doc.setLineWidth(0.2); doc.line(M, y + 2, W - M, y + 2)
      y += 6
    })
    if (o.total) {
      sitio(8)
      letra('bold', 9); color(o.negativo ? AMBAR : TINTA)
      let x = M + 2
      cols.forEach((c, i) => { if (o.total![i]) doc.text(o.total![i], c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w })
      y += 6
    }
    y += 6
  }
  const cols: Col[] = [{ t: 'Hora', w: 18 }, { t: 'Nº de pedido', w: 44 }, { t: 'Marca', w: 52 }, { t: 'Base', w: 22, der: true }, { t: 'IVA', w: 20, der: true }, { t: 'Total', w: 22, der: true }]
  const ordenados = [...d.pedidos].sort((a, b) => a.hora.localeCompare(b.hora) || a.codigo.localeCompare(b.codigo))
  const sumaDe = (xs: PedidoResumen[], k: 'base' | 'cuota' | 'total') => xs.reduce((t, x) => t + cts(x[k]), 0) / 100
  titulo('Pedidos', `${d.pedidos.length} pedidos de tus marcas`)
  tabla(cols, ordenados.map((p) => [p.hora, p.codigo, p.marca, euros(p.base), euros(p.cuota), euros(p.total)]),
    { total: ['', '', 'Suma de los pedidos', euros(sumaDe(d.pedidos, 'base')), euros(sumaDe(d.pedidos, 'cuota')), euros(sumaDe(d.pedidos, 'total'))] })

  if (d.reembolsos.length) {
    titulo('Reembolsos', 'lo que la plataforma devolvió al cliente: resta')
    tabla(cols, [...d.reembolsos].sort((a, b) => a.hora.localeCompare(b.hora)).map((p) => [p.hora, p.codigo, p.marca, euros(-p.base), euros(-p.cuota), euros(-p.total)]),
      { negativo: true, total: ['', '', 'Suma de los reembolsos', euros(-sumaDe(d.reembolsos, 'base')), euros(-sumaDe(d.reembolsos, 'cuota')), euros(-sumaDe(d.reembolsos, 'total'))] })
  }

  // Por marca: exactamente las líneas de la factura (o las del asiento).
  titulo('Por marca', `son las líneas ${ref.de}`)
  const nPed = (l: MarcaResumen) => (l.papel === 'promociones' ? d.pedidos.filter((p) => p.promocion).length
    : l.papel === 'envios' ? d.pedidos.filter((p) => p.envio).length : d.pedidos.filter((p) => p.marca === l.marca).length)
  const reembolso = (l: MarcaResumen) => !l.papel && l.importe < 0
  tabla([{ t: 'Marca', w: 82 }, { t: 'Subcuenta', w: 34 }, { t: 'Pedidos', w: 24, der: true }, { t: 'Base', w: 38, der: true }],
    [...d.lineasFactura].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((l) => [l.marca + (reembolso(l) ? ' (reembolsos)' : ''), l.cuenta, reembolso(l) ? '' : String(nPed(l)), euros(l.importe)]),
    { total: ['Base imponible', '', '', euros(d.factura.base)] })

  // ── El total del día ───────────────────────────────────────────────────────
  sitio(44)
  const bx = W - M - 92
  relleno(SUAVE); trazo(LINEA); doc.setLineWidth(0.3); doc.roundedRect(bx, y - 2, 92, 38, 2, 2, 'FD')
  const fila = (k: string, v: string, fuerte = false, dy = 7) => {
    letra(fuerte ? 'bold' : 'normal', fuerte ? 11 : 9.5); color(fuerte ? TINTA : GRIS)
    doc.text(k, bx + 5, y + 4); color(TINTA); doc.text(v, bx + 87, y + 4, { align: 'right' }); y += dy
  }
  fila('Base imponible', euros(d.factura.base))
  fila(`IVA (${d.tipoIva} %)`, euros(d.factura.cuota))
  trazo(TINTA); doc.setLineWidth(0.4); doc.line(bx + 5, y + 0.5, bx + 87, y + 0.5); y += 2
  fila('Total del día', euros(d.factura.total), true, 9)
  letra('normal', 8.5); color(GRIS)
  doc.text(`Cobra ${d.plataforma} (cuenta 430): ${euros(d.cobro)}`, bx + 5, y + 3)
  relleno(MENTA); doc.circle(bx + 85, y + 2.2, 1.6, 'F')
  y += 6
  letra('normal', 8); color(GRIS)
  doc.text(`Cuadra ${ref.cuadra} y con el cobro, al céntimo.`, bx + 5, y + 3)
  // A la izquierda, en palabras, qué es.
  const izq = doc.splitTextToSize(`Las ventas de tus marcas en ${d.plataforma} en ${d.local} el ${fechaLarga(d.fecha).toLowerCase()}, una a una y sumadas, tal como Folvy las ha registrado. ${ref.el} recoge estas mismas cifras.`, bx - M - 16)
  letra('normal', 9); color(GRIS); doc.text(izq, M, y - 30)

  pie()
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}
