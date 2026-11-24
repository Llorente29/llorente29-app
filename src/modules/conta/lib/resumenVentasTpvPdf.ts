// src/modules/conta/lib/resumenVentasTpvPdf.ts
//
// R05 · EL «RESUMEN DE VENTAS» DE UN DÍA DEL TPV (respuesta R05 · 1, §1): un PDF
// propio, con el mismo aspecto que el de las plataformas
// (supabase/functions/_shared/resumenVentasPdf.ts, que no se toca). Se hace al
// validar y se guarda con el asiento, obligatorio como el otro.
//
// Un día de una empresa = un asiento = un PDF. Lleva:
//   · cabecera: «TPV · Revo», el día, la empresa y su NIF, el asiento y cuándo
//     se generó;
//   · las cifras: cuántas facturas y su numeración (la del TPV: Sumied no emite
//     factura), la base, el IVA y el total;
//   · la base y el IVA por tipo;
//   · cómo se cobró: cada forma de pago (con su canal, si va por canal) y su
//     cuenta, que son las líneas del debe del asiento;
//   · las facturas una a una (hora, número, canal, NIF si lo lleva, base, IVA y
//     total), con las devoluciones en negativo;
//   · el total del día, que cuadra con el asiento y con lo cobrado.
// Si algo no cuadra, NO hay PDF: lanza y dice qué (como el de las plataformas).
//
// jsPDF entra desde fuera (conDiezService pone el suyo; las pruebas, también).

export type FacturaTpv = { hora: string; numero: number; canal: string; nif: string | null; base: number; cuota: number; total: number }
export type CobroTpv = { concepto: string; cuenta: string; nombreCuenta: string | null; importe: number }
export type DatosResumenTpv = {
  empresa: { nombre: string; nif: string }
  /** «Revo» */
  programa: string
  /** AAAA-MM-DD */
  fecha: string
  /** «Ventas nº 1.287» */
  asiento: string
  generado: Date
  primero: number
  ultimo: number
  facturas: FacturaTpv[]
  porTipo: { tipo: number; facturas: number; base: number; cuota: number }[]
  cobros: CobroTpv[]
  totales: { base: number; cuota: number; total: number }
}

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
const tipoTexto = (t: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(t)
const fechaLarga = (iso: string) => {
  const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const madrid = (d: Date) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(d).replace(',', ' a las')
const numeracion = (d: Pick<DatosResumenTpv, 'primero' | 'ultimo'>) => (d.primero === d.ultimo ? String(d.primero) : `${d.primero} a ${d.ultimo}`)

/** Lo que tiene que cuadrar antes de pintar nada. Devuelve los fallos; vacío = cuadra. */
export function comprobarResumenTpv(d: DatosResumenTpv): string[] {
  const mal: string[] = []
  const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + cts(f(x)), 0)
  for (const f of d.facturas) if (cts(f.base) + cts(f.cuota) !== cts(f.total)) mal.push(`la factura ${f.numero}: base + IVA no es su total`)
  if (!d.facturas.length) mal.push('no lleva ninguna factura')
  if (suma(d.facturas, (f) => f.base) !== cts(d.totales.base)) mal.push(`la base de las facturas (${euros(suma(d.facturas, (f) => f.base) / 100)}) no es la del asiento (${euros(d.totales.base)})`)
  if (suma(d.facturas, (f) => f.cuota) !== cts(d.totales.cuota)) mal.push(`el IVA de las facturas (${euros(suma(d.facturas, (f) => f.cuota) / 100)}) no es el del asiento (${euros(d.totales.cuota)})`)
  if (suma(d.facturas, (f) => f.total) !== cts(d.totales.total)) mal.push(`el total de las facturas (${euros(suma(d.facturas, (f) => f.total) / 100)}) no es el del día (${euros(d.totales.total)})`)
  if (suma(d.porTipo, (t) => t.base) !== cts(d.totales.base) || suma(d.porTipo, (t) => t.cuota) !== cts(d.totales.cuota)) mal.push('el IVA por tipo no suma lo del día')
  if (suma(d.cobros, (c) => c.importe) !== cts(d.totales.total)) mal.push(`lo cobrado (${euros(suma(d.cobros, (c) => c.importe) / 100)}) no es el total del día (${euros(d.totales.total)})`)
  const nums = d.facturas.map((f) => f.numero)
  if (nums.length && (Math.min(...nums) !== d.primero || Math.max(...nums) !== d.ultimo)) mal.push(`la numeración (${numeracion(d)}) no es la de las facturas`)
  return mal
}

/** El PDF, en bytes. Lanza si no cuadra (comprobarResumenTpv). */
export function resumenVentasTpvPdf(JsPDF: JsPdfCtor, d: DatosResumenTpv): Uint8Array {
  const mal = comprobarResumenTpv(d)
  if (mal.length) throw new Error(`El resumen de ventas no cuadra con su asiento: ${mal.join('; ')}`)

  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const W = 210, H = 297, M = 16, ANCHO = W - 2 * M
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const relleno = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const trazo = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const letra = (estilo: 'normal' | 'bold', tam: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam) }
  const origen = `TPV · ${d.programa}`
  let y = 0

  const cabecera = (primera: boolean) => {
    relleno(TINTA); doc.rect(0, 0, W, primera ? 40 : 14, 'F')
    relleno(MENTA); doc.rect(0, primera ? 40 : 14, W, 1.2, 'F')
    if (!primera) {
      letra('bold', 9); doc.setTextColor(255, 255, 255)
      doc.text(`Resumen de ventas · ${origen} · ${fechaLarga(d.fecha)}`, M, 9)
      letra('normal', 9); doc.text(d.asiento, W - M, 9, { align: 'right' })
      y = 26
      return
    }
    letra('bold', 8); doc.setTextColor(46, 230, 168); doc.text('RESUMEN DE VENTAS', M, 12)
    letra('bold', 18); doc.setTextColor(255, 255, 255); doc.text(origen, M, 21)
    letra('normal', 11); doc.setTextColor(201, 208, 220); doc.text(fechaLarga(d.fecha), M, 28)
    letra('normal', 8.5); doc.text(`${d.empresa.nombre} · NIF ${d.empresa.nif}`, M, 35)
    letra('normal', 8); doc.setTextColor(201, 208, 220); doc.text('Asiento', W - M, 12, { align: 'right' })
    letra('bold', 12); doc.setTextColor(255, 255, 255); doc.text(d.asiento, W - M, 19, { align: 'right' })
    letra('normal', 8); doc.setTextColor(201, 208, 220); doc.text(`Generado por Sumied el ${madrid(d.generado)}`, W - M, 35, { align: 'right' })
    y = 50
  }
  const pie = () => {
    const n = doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      doc.setPage(i)
      trazo(LINEA); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16)
      letra('normal', 8); color(GRIS)
      doc.text(`Este documento resume las ventas del TPV (${d.programa}) de este día. Las facturas son las del TPV, con su numeración.`, M, H - 10.5)
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
  const devoluciones = d.facturas.filter((f) => f.total < 0).length
  const tarjetas: [string, string, boolean][] = [
    [`Facturas · ${numeracion(d)}`, String(d.facturas.length) + (devoluciones ? ` · ${devoluciones} devolución${devoluciones === 1 ? '' : 'es'}` : ''), false],
    ['Base imponible', euros(d.totales.base), false],
    ['IVA', euros(d.totales.cuota), false],
    ['Total del día', euros(d.totales.total), true],
  ]
  const tw = (ANCHO - 3 * 4) / 4
  tarjetas.forEach(([k, v, fuerte], i) => {
    const x = M + i * (tw + 4)
    relleno(fuerte ? MENTA_SUAVE : SUAVE); trazo(fuerte ? MENTA : LINEA); doc.setLineWidth(0.3)
    doc.roundedRect(x, y, tw, 19, 2, 2, 'FD')
    letra('normal', 8); color(GRIS); doc.text(doc.splitTextToSize(k, tw - 6)[0] as string, x + 4, y + 6.5)
    letra('bold', 13); color(TINTA); doc.text(v, x + 4, y + 14.5)
  })
  y += 29

  type Col = { t: string; w: number; der?: boolean }
  const tabla = (cols: Col[], filas: { celdas: string[]; negativo?: boolean }[], total?: string[]) => {
    const cab = () => {
      relleno(SUAVE); doc.rect(M, y - 4.2, ANCHO, 6.4, 'F')
      letra('bold', 8); color(GRIS)
      let x = M + 2
      for (const c of cols) { doc.text(c.t, c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w }
      y += 6
    }
    cab()
    for (const f of filas) {
      if (y + 6 > H - 22) { doc.addPage(); cabecera(false); cab() }
      letra('normal', 9); color(f.negativo ? AMBAR : TINTA)
      let x = M + 2
      cols.forEach((c, i) => {
        const txt = doc.splitTextToSize(f.celdas[i] ?? '', c.w - 4)[0] as string
        doc.text(txt, c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w
      })
      trazo(LINEA); doc.setLineWidth(0.2); doc.line(M, y + 2, W - M, y + 2)
      y += 6
    }
    if (total) {
      sitio(8)
      letra('bold', 9); color(TINTA)
      let x = M + 2
      cols.forEach((c, i) => { if (total[i]) doc.text(total[i], c.der ? x + c.w - 4 : x, y, c.der ? { align: 'right' } : undefined); x += c.w })
      y += 6
    }
    y += 6
  }

  // ── El IVA por tipo ────────────────────────────────────────────────────────
  titulo('Base e IVA por tipo', d.porTipo.length === 1 ? 'un solo tipo' : `${d.porTipo.length} tipos`)
  tabla([{ t: 'Tipo', w: 40 }, { t: 'Facturas', w: 30, der: true }, { t: 'Base', w: 38, der: true }, { t: 'IVA', w: 34, der: true }, { t: 'Total', w: 36, der: true }],
    d.porTipo.map((t) => ({ celdas: [`IVA ${tipoTexto(t.tipo)} %`, String(t.facturas), euros(t.base), euros(t.cuota), euros(t.base + t.cuota)] })),
    ['Total', '', euros(d.totales.base), euros(d.totales.cuota), euros(d.totales.total)])

  // ── Cómo se cobró ──────────────────────────────────────────────────────────
  titulo('Cómo se cobró', 'son las líneas del debe del asiento')
  tabla([{ t: 'Forma de pago', w: 72 }, { t: 'Cuenta', w: 70 }, { t: 'Importe', w: 36, der: true }],
    d.cobros.map((c) => ({ celdas: [c.concepto.replace(/^Cobra /, ''), `${c.cuenta}${c.nombreCuenta ? ` · ${c.nombreCuenta}` : ''}`, euros(c.importe)], negativo: c.importe < 0 })),
    ['Total cobrado', '', euros(d.cobros.reduce((t, c) => t + cts(c.importe), 0) / 100)])

  // ── Las facturas ───────────────────────────────────────────────────────────
  const conNif = d.facturas.filter((f) => f.nif).length
  titulo('Facturas', [`${d.facturas.length} facturas del TPV`, conNif ? `${conNif} con NIF` : '', devoluciones ? `${devoluciones} en negativo (devoluciones)` : ''].filter(Boolean).join(' · '))
  tabla([{ t: 'Hora', w: 16 }, { t: 'Número', w: 22 }, { t: 'Canal', w: 34 }, { t: 'NIF', w: 30 }, { t: 'Base', w: 26, der: true }, { t: 'IVA', w: 22, der: true }, { t: 'Total', w: 28, der: true }],
    [...d.facturas].sort((a, b) => a.numero - b.numero).map((f) => ({ celdas: [f.hora, String(f.numero), f.canal, f.nif ?? '', euros(f.base), euros(f.cuota), euros(f.total)], negativo: f.total < 0 })),
    ['', '', '', 'Suma', euros(d.totales.base), euros(d.totales.cuota), euros(d.totales.total)])

  // ── El total del día ───────────────────────────────────────────────────────
  sitio(44)
  const bx = W - M - 92
  relleno(SUAVE); trazo(LINEA); doc.setLineWidth(0.3); doc.roundedRect(bx, y - 2, 92, 38, 2, 2, 'FD')
  const fila = (k: string, v: string, fuerte = false, dy = 7) => {
    letra(fuerte ? 'bold' : 'normal', fuerte ? 11 : 9.5); color(fuerte ? TINTA : GRIS)
    doc.text(k, bx + 5, y + 4); color(TINTA); doc.text(v, bx + 87, y + 4, { align: 'right' }); y += dy
  }
  fila('Base imponible', euros(d.totales.base))
  fila('IVA', euros(d.totales.cuota))
  trazo(TINTA); doc.setLineWidth(0.4); doc.line(bx + 5, y + 0.5, bx + 87, y + 0.5); y += 2
  fila('Total del día', euros(d.totales.total), true, 9)
  letra('normal', 8.5); color(GRIS)
  doc.text(`Facturas del TPV: ${numeracion(d)}`, bx + 5, y + 3)
  relleno(MENTA); doc.circle(bx + 85, y + 2.2, 1.6, 'F')
  y += 6
  letra('normal', 8); color(GRIS)
  doc.text('Cuadra con el asiento y con lo cobrado, al céntimo.', bx + 5, y + 3)
  const izq = doc.splitTextToSize(`Las ventas del ${fechaLarga(d.fecha).toLowerCase()} en el TPV (${d.programa}), factura a factura y sumadas. ${d.asiento} recoge estas mismas cifras. Sumied no emite factura: las facturas son las del TPV.`, bx - M - 16)
  letra('normal', 9); color(GRIS); doc.text(izq, M, y - 30)

  pie()
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}

/** Lo que devuelve conta_tpv_dia_para_validar (R05, 1602), con los números ya como números. */
export type ParaValidarTpv = {
  account_id: string
  numero_previsto: number
  empresa: { nombre: string; nif: string } | null
  dia: {
    id: string; dia: string; programa: string; primero: number; ultimo: number; base: number; cuota: number; total: number
    facturas: { numero: number; fecha: string; canal: string; nif: string | null; base: number; cuota: number; total: number; impuestos: { tipo: number; base: number; cuota: number }[] }[]
  }
  lineas: { cuenta: string; nombre: string | null; debe: number; haber: number; concepto: string; tipo?: number | null; forma?: string | null }[]
}

const canalDe = (c: string) => (c === 'local' || c === '--' || c === '' ? 'En el local' : c)

/** Los datos del PDF de un día del TPV, del día y del asiento que saldrá con ese número. Lanza si falta la empresa o su NIF. */
export function datosResumenTpv(p: ParaValidarTpv, numero: number, generado: Date): DatosResumenTpv {
  if (!p.empresa?.nombre || !p.empresa.nif) throw new Error('La empresa no tiene nombre o NIF: el resumen los lleva en la cabecera.')
  const porTipo = new Map<number, { facturas: number; base: number; cuota: number }>()
  for (const f of p.dia.facturas) for (const i of f.impuestos) {
    const t = porTipo.get(Number(i.tipo)) ?? { facturas: 0, base: 0, cuota: 0 }
    t.facturas += 1; t.base = (cts(t.base) + cts(Number(i.base))) / 100; t.cuota = (cts(t.cuota) + cts(Number(i.cuota))) / 100
    porTipo.set(Number(i.tipo), t)
  }
  return {
    empresa: { nombre: p.empresa.nombre, nif: p.empresa.nif },
    programa: p.dia.programa === 'revo' ? 'Revo' : p.dia.programa,
    fecha: p.dia.dia,
    asiento: `Ventas nº ${numero.toLocaleString('es-ES')}`,
    generado,
    primero: Number(p.dia.primero), ultimo: Number(p.dia.ultimo),
    facturas: p.dia.facturas.map((f) => ({ hora: f.fecha.slice(11, 16), numero: Number(f.numero), canal: canalDe(f.canal), nif: f.nif, base: Number(f.base), cuota: Number(f.cuota), total: Number(f.total) })),
    porTipo: [...porTipo].sort(([a], [b]) => a - b).map(([tipo, t]) => ({ tipo, ...t })),
    // Lo cobrado: las líneas que no son ni ventas ni IVA (las del debe; una devolución neta iría al haber, en negativo).
    cobros: p.lineas.filter((l) => !l.cuenta.startsWith('70') && !l.cuenta.startsWith('477'))
      .map((l) => ({ concepto: l.concepto, cuenta: l.cuenta, nombreCuenta: l.nombre, importe: (cts(Number(l.debe)) - cts(Number(l.haber))) / 100 })),
    totales: { base: Number(p.dia.base), cuota: Number(p.dia.cuota), total: Number(p.dia.total) },
  }
}

export const nombreFicheroTpv = (fecha: string, numero: number) => `ResumenDeVentas_TPV_${fecha}_${numero}.pdf`
