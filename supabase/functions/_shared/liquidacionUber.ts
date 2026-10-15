// supabase/functions/_shared/liquidacionUber.ts
//
// D01 · Liquidaciones por correo · T2 · EL LECTOR DEL «RESUMEN DE PAGOS» DE
// UBER EATS. Puro: ni red ni base. Lo llama recibirCorreo (facturasEntrada.ts)
// cuando el correo llega a una dirección liquidaciones-<empresa>@…; las pruebas
// (tests/conta/d01/liquidacionUber.test.ts) le dan correos INVENTADOS con la
// forma de los de verdad: ni una cifra ni una tienda reales en el repositorio.
//
// La forma, medida en los correos de verdad (15/10):
//   · uno por marca × local, de noreply@uber.com, el domingo por la noche;
//   · asunto «Resumen de pagos de Uber Eats correspondiente a <Marca> del
//     <Mmm dd, aaaa> - <Mmm dd, aaaa>»; la tienda va en el saludo:
//     «Hola <Marca> (<dirección>),»;
//   · tres tarjetas arriba (etiqueta gris y valor debajo): «Periodo de pago»,
//     «ID de referencia del pago» y «Depósito iniciado» (las dos últimas casi
//     siempre vacías);
//   · «Ventas totales»: «Pedidos» y «Pago neto»;
//   · «Resumen diario»: Fecha (m/d/aaaa) | Pedidos | Ventas | Impuesto sobre
//     las ventas | Ventas (impuestos incluidos), y una fila Total;
//   · «Desglose de pagos»: Ganancias, Precios de Uber, Gastos de marketing,
//     Modificaciones y «Pago neto». Las líneas a cero a veces no salen;
//   · el primero del mes trae además «Resumen unificado del mes pasado», con
//     LAS MISMAS etiquetas: el desglose se lee hasta ahí, nunca después;
//   · periodos de 1 a 13 semanas (si una semana no llega al pago, se acumula),
//     y un neto puede ser negativo (no hay transferencia y pasa al siguiente).
//
// La factura de comisión (comprobada al céntimo contra las de Diez, 15/10):
//   · 62300002 = (Tasas de mercado + Otros cargos + Otros cargos de la
//     promoción), IVA dentro; 62700002 = Gastos en anuncios, IVA dentro; 21 %;
//   · la base total es la del total (total ÷ 1,21, al céntimo), la de anuncios
//     la suya, y la de comisión LA DIFERENCIA: así base + IVA da el total exacto
//     (por cada línea suelta, a veces sale un céntimo de más);
//   · «Promociones en artículos» NO va en la factura: se guarda aparte, hasta
//     que Julio decida cómo se apunta.

export const MESES_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const
const MESES_LARGOS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const
const MESES_LARGOS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const

export class NoEsResumenUber extends Error {}

export interface DiaUber { fecha: string; pedidos: number; ventas: number; impuesto: number; total: number }
export interface ContracargoUber { pedido: string; momento: string | null; venta: number | null; contracargo: number | null; tipo: string | null }

export interface ResumenUber {
  /** La marca, como la dice el asunto. */
  marca: string
  /** La tienda, como la dice el saludo: «Marca (dirección)». Es la clave del mapa de tiendas. */
  tienda: string
  desde: string
  hasta: string
  /** «ID de referencia del pago», si viene. */
  referencia: string | null
  /** «Depósito iniciado», si viene (AAAA-MM-DD). */
  depositoIniciado: string | null
  pedidos: number
  diario: DiaUber[]
  /** La fila Total del resumen diario. */
  ventas: { base: number; iva: number; total: number; pedidos: number }
  ganancias: { ventas: number; pedidosVentas: number; otras: number; total: number }
  uber: { tasas: number; otros: number; total: number }
  marketing: { promociones: number; otrosPromo: number; anuncios: number; total: number }
  modificaciones: { contracargo: number; pedidosContracargo: number; ajustes: number; total: number }
  neto: number
  contracargos: ContracargoUber[]
  /** «Resumen unificado del mes pasado – <Mes> <Año>»: el mes (AAAA-MM). */
  mensual: { mes: string } | null
  /** Lo que no cuadra al leer (cada total contra sus líneas): la liquidación queda por revisar. */
  avisos: string[]
}

// ── Del correo a trozos de texto ────────────────────────────────────────────

const ENTIDADES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', ndash: '–', mdash: '—', minus: '−' }
function decodificar(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (x, n) => ENTIDADES[n.toLowerCase()] ?? x)
}
const limpio = (s: string) => s.replace(/[\s ]+/g, ' ').trim()

/**
 * El correo en trozos de texto, en su orden: cada bloque (div, p, celda) es un
 * trozo. Del HTML si lo hay; si no, del texto (las tablas «| a | b |» que deja
 * un reenvío en texto plano).
 */
export function trozos(c: { html?: string | null; text?: string | null }): string[] {
  if (c.html && /<\w/.test(c.html)) {
    // Un salto de línea DENTRO de una celda («Ventas\r\n(1 Pedidos)») no parte el trozo: solo los bloques.
    const sin = c.html.replace(/[\r\n]+/g, ' ').replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    const marcado = sin.replace(/<\/?(?:div|p|td|th|tr|table|tbody|thead|br|h[1-6]|li|ul|ol|header|main|footer|section|blockquote)\b[^>]*>/gi, '\n')
    return decodificar(marcado.replace(/<[^>]+>/g, '')).split('\n').map(limpio).filter(Boolean)
  }
  return (c.text ?? '').split(/\r?\n/).flatMap((l) => l.split('|')).map(limpio).filter((x) => x && !/^-{3,}$/.test(x))
}

// ── Importes y fechas ────────────────────────────────────────────────────────

/** «1.074,37 €», «-17,35 €», «−2,47 €» → céntimos; null si no es un importe. */
export function centimos(s: string | null | undefined): number | null {
  if (!s) return null
  const t = s.replace(/[\s ]/g, '').replace(/[−–]/g, '-')
  const m = t.match(/^(-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?€?$/)
  if (!m || !/€|,/.test(t)) return null
  const entero = Number(m[2].replace(/\./g, ''))
  const dec = Number((m[3] ?? '0').padEnd(2, '0'))
  const v = entero * 100 + dec
  return m[1] === '-' ? -v : v
}
// Sin «-0»: cero es cero.
const euros = (c: number) => (c === 0 ? 0 : c / 100)

const mesDe = (s: string): number => {
  const k = s.toLowerCase().replace(/\.$/, '').slice(0, 3)
  const en = (MESES_EN as readonly string[]).indexOf(k)
  if (en >= 0) return en + 1
  const es = (MESES_ES as readonly string[]).indexOf(k)
  return es >= 0 ? es + 1 : 0
}
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const valida = (a: number, m: number, d: number) => {
  const x = new Date(Date.UTC(a, m - 1, d))
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d
}

/** «Sep 21, 2026» → 2026-09-21. */
export function fechaUber(s: string): string | null {
  const m = limpio(s).match(/^([A-Za-zé]{3,10})\.? (\d{1,2}),? (\d{4})$/)
  if (!m) return null
  const mes = mesDe(m[1]), d = Number(m[2]), a = Number(m[3])
  return mes && valida(a, mes, d) ? iso(a, mes, d) : null
}
/** «Sep 21, 2026 - Sep 27, 2026» → [desde, hasta]. */
export function periodoUber(s: string): [string, string] | null {
  const m = limpio(s).match(/([A-Za-zé]{3,10}\.? \d{1,2},? \d{4})\s*[-–—]\s*([A-Za-zé]{3,10}\.? \d{1,2},? \d{4})/)
  if (!m) return null
  const a = fechaUber(m[1]), b = fechaUber(m[2])
  return a && b && a <= b ? [a, b] : null
}
/** «9/24/2026» (mes/día/año) → 2026-09-24. */
export function fechaDiaria(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const mes = Number(m[1]), d = Number(m[2]), a = Number(m[3])
  return valida(a, mes, d) ? iso(a, mes, d) : null
}

// ── El lector ────────────────────────────────────────────────────────────────

const ETIQUETAS = [
  'Periodo de pago', 'ID de referencia del pago', 'Depósito iniciado', 'Ventas totales', 'Pedidos', 'Pago neto', 'Resumen diario',
  'Desglose de pagos', 'Ganancias', 'Precios de Uber', 'Gastos de marketing', 'Modificaciones',
]
const esEtiqueta = (t: string) => ETIQUETAS.some((e) => t.toLowerCase() === e.toLowerCase())

/** ¿Es un resumen de pagos de Uber Eats? Por el asunto o por el cuerpo (un reenvío a mano cambia el remitente). */
export function esResumenUber(c: { subject?: string | null }, ts: readonly string[]): boolean {
  const asunto = /resumen de pagos de uber eats/i.test(c.subject ?? '')
  const cuerpo = ts.some((t) => /^resumen de pagos del periodo de pago/i.test(t)) && ts.some((t) => /^desglose de pagos$/i.test(t))
  return asunto || cuerpo
}

/** El valor de una tarjeta: lo que sigue a la etiqueta en el mismo trozo, o el trozo siguiente (si no es otra etiqueta). */
function valorTras(ts: readonly string[], etiqueta: string, desde = 0, hasta = ts.length): string | null {
  const e = etiqueta.toLowerCase()
  for (let i = desde; i < hasta; i++) {
    const t = ts[i]
    if (t.toLowerCase() === e) {
      const sig = ts[i + 1]
      return sig !== undefined && i + 1 < hasta && !esEtiqueta(sig) ? sig : null
    }
    if (t.toLowerCase().startsWith(`${e} `)) return t.slice(etiqueta.length).trim() || null
  }
  return null
}

/** El importe de una línea del desglose (la etiqueta, y el importe en el trozo siguiente). La última que tenga importe. */
function lineaDesglose(ts: readonly string[], etiqueta: RegExp, desde: number, hasta: number): { centimos: number; pedidos: number | null } | null {
  let r: { centimos: number; pedidos: number | null } | null = null
  for (let i = desde; i < hasta; i++) {
    const m = ts[i].match(etiqueta)
    if (!m) continue
    const c = centimos(ts[i + 1])
    if (c !== null && i + 1 < hasta) r = { centimos: c, pedidos: m[1] !== undefined ? Number(m[1]) : null }
  }
  return r
}

export function leerResumenUber(c: { subject?: string | null; html?: string | null; text?: string | null }): ResumenUber {
  const ts = trozos(c)
  if (!esResumenUber(c, ts)) throw new NoEsResumenUber('No es un resumen de pagos de Uber Eats.')
  const avisos: string[] = []

  // La tienda: el saludo. La marca: el asunto (o, si no, lo de antes del paréntesis).
  const saludo = ts.map((t) => t.match(/^Hola (.+?),?$/)?.[1]).find((x) => x && /\(.+\)/.test(x)) ?? ts.map((t) => t.match(/^Hola (.+?),$/)?.[1]).find(Boolean)
  if (!saludo) throw new NoEsResumenUber('El resumen no dice de qué tienda es (falta el saludo «Hola <tienda>,»).')
  const tienda = limpio(saludo)
  const asunto = limpio(c.subject ?? '').match(/correspondiente a (.+?) del [A-Za-zé]{3,10}\.? \d/i)?.[1]
  const marca = limpio(asunto ?? tienda.replace(/\s*\(.*\)\s*$/, ''))

  // El periodo: la tarjeta; si no, el título del bloque o el asunto.
  const per = periodoUber(valorTras(ts, 'Periodo de pago') ?? '') ?? periodoUber(ts.find((t) => /^resumen de pagos del periodo de pago/i.test(t)) ?? '') ?? periodoUber(c.subject ?? '')
  if (!per) throw new NoEsResumenUber('El resumen no dice de qué periodo es.')
  const [desde, hasta] = per
  const referencia = valorTras(ts, 'ID de referencia del pago')
  const dep = valorTras(ts, 'Depósito iniciado')
  const depositoIniciado = dep ? fechaUber(dep) : null

  // El desglose: desde «Desglose de pagos» hasta el resumen del mes pasado (que repite las etiquetas).
  const iDes = ts.findIndex((t) => /^desglose de pagos$/i.test(t))
  if (iDes < 0) throw new NoEsResumenUber('El resumen no trae el desglose de pagos.')
  const iFin = (() => {
    const j = ts.findIndex((t, k) => k > iDes && /^(resumen unificado del mes pasado|una forma sencilla de ver|accede a tus resúmenes)/i.test(t))
    return j < 0 ? ts.length : j
  })()
  const L = (re: RegExp) => lineaDesglose(ts, re, iDes, iFin)
  const v = (re: RegExp) => L(re)?.centimos ?? 0
  const ventasL = L(/^Ventas \((\d+) Pedidos?\)$/i)
  const netoL = L(/^Pago neto$/i)
  if (!netoL) throw new NoEsResumenUber('El resumen no trae el pago neto.')
  const contracargoL = L(/^Importe neto del contracargo \((\d+) Pedidos?\)$/i)

  const g = { ventas: ventasL?.centimos ?? 0, pedidosVentas: ventasL?.pedidos ?? 0, otras: v(/^Otras ganancias$/i), total: v(/^Ganancias totales$/i) }
  const u = { tasas: v(/^Tasas de mercado$/i), otros: v(/^Otros cargos$/i), total: v(/^Precios totales de Uber$/i) }
  const mk = { promociones: v(/^Promociones en artículos$/i), otrosPromo: v(/^Otros cargos de la promoción$/i), anuncios: v(/^Gastos en anuncios$/i), total: v(/^Gastos totales de marketing$/i) }
  const md = { contracargo: contracargoL?.centimos ?? 0, pedidosContracargo: contracargoL?.pedidos ?? 0, ajustes: v(/^Ajustes$/i), total: v(/^Modificaciones totales$/i) }
  const neto = netoL.centimos

  // Cada total contra sus líneas, y el neto contra todo. Lo que no cuadra se dice.
  const cuadra = (que: string, total: number, partes: number[]) => {
    const s = partes.reduce((a, b) => a + b, 0)
    if (s !== total) avisos.push(`${que}: las líneas suman ${fmt(s)} y el total dice ${fmt(total)}.`)
  }
  cuadra('Ganancias', g.total, [g.ventas, g.otras])
  cuadra('Precios de Uber', u.total, [u.tasas, u.otros])
  cuadra('Gastos de marketing', mk.total, [mk.promociones, mk.otrosPromo, mk.anuncios])
  cuadra('Modificaciones', md.total, [md.contracargo, md.ajustes])
  cuadra('Pago neto', neto, [g.total, u.total, mk.total, md.total])
  const netoArriba = centimos(valorTras(ts, 'Pago neto', 0, iDes))
  if (netoArriba !== null && netoArriba !== neto) avisos.push(`El pago neto de arriba (${fmt(netoArriba)}) no es el del desglose (${fmt(neto)}).`)

  // El resumen diario.
  const diario: DiaUber[] = []
  let totalDiario: { base: number; iva: number; total: number; pedidos: number } | null = null
  const iDia = ts.findIndex((t) => /^resumen diario$/i.test(t))
  if (iDia >= 0) {
    for (let i = iDia + 1; i < (iDes > iDia ? iDes : ts.length); i++) {
      const f = fechaDiaria(ts[i])
      const fila = ts.slice(i + 1, i + 5)
      if (f || /^total$/i.test(ts[i])) {
        const [p, b, t, x] = [Number(fila[0]), centimos(fila[1]), centimos(fila[2]), centimos(fila[3])]
        if (!Number.isInteger(p) || b === null || t === null || x === null) continue
        if (f) diario.push({ fecha: f, pedidos: p, ventas: euros(b), impuesto: euros(t), total: euros(x) })
        else { totalDiario = { pedidos: p, base: b, iva: t, total: x }; break }
        i += 4
      }
    }
  }
  if (!totalDiario) {
    totalDiario = diario.reduce((a, d) => ({ pedidos: a.pedidos + d.pedidos, base: a.base + Math.round(d.ventas * 100), iva: a.iva + Math.round(d.impuesto * 100), total: a.total + Math.round(d.total * 100) }), { pedidos: 0, base: 0, iva: 0, total: 0 })
    if (diario.length) avisos.push('El resumen diario no trae la fila Total: se suma día a día.')
  } else {
    const s = diario.reduce((a, d) => a + Math.round(d.total * 100), 0)
    if (diario.length && s !== totalDiario.total) avisos.push(`El resumen diario: los días suman ${fmt(s)} y su Total dice ${fmt(totalDiario.total)}.`)
  }
  if (ventasL && totalDiario.total !== g.ventas) avisos.push(`Las ventas del desglose (${fmt(g.ventas)}) no son las del resumen diario (${fmt(totalDiario.total)}).`)
  const fuera = diario.filter((d) => (d.fecha < desde || d.fecha > hasta) && d.pedidos > 0)
  if (fuera.length) avisos.push(`${fuera.length} ${fuera.length === 1 ? 'día' : 'días'} del resumen diario con pedidos fuera del periodo.`)

  const pedidosArriba = Number(valorTras(ts, 'Pedidos', 0, iDia >= 0 ? iDia : iDes))
  const pedidos = Number.isInteger(pedidosArriba) ? pedidosArriba : totalDiario.pedidos

  // Los contracargos: «Detalles del error del pedido», fila a fila (pedido, momento, venta, contracargo, tipo).
  const contracargos: ContracargoUber[] = []
  const iCc = ts.findIndex((t) => /^detalles del error del pedido$/i.test(t))
  if (iCc >= 0) {
    for (let i = iCc + 1; i + 4 < ts.length; i++) {
      if (/^(desglose de pagos|resumen diario|ventas totales)$/i.test(ts[i])) break
      const venta = centimos(ts[i + 2]), cc = centimos(ts[i + 3])
      if (venta === null || cc === null || centimos(ts[i]) !== null) continue
      contracargos.push({ pedido: ts[i], momento: ts[i + 1] || null, venta: euros(venta), contracargo: euros(cc), tipo: ts[i + 4] && centimos(ts[i + 4]) === null ? ts[i + 4] : null })
      i += 4
    }
  }
  if (contracargoL && contracargoL.pedidos && contracargos.length && contracargos.length !== contracargoL.pedidos) {
    avisos.push(`El contracargo dice ${contracargoL.pedidos} pedidos y el detalle trae ${contracargos.length}.`)
  }

  // El resumen del mes pasado (solo se apunta de qué mes es: sus importes no se leen).
  const uni = ts.find((t) => /^resumen unificado del mes pasado/i.test(t))
  let mensual: { mes: string } | null = null
  if (uni) {
    const m = uni.match(/([A-Za-zé]+)\s*(\d{4})/g)?.map((x) => x.match(/([A-Za-zé]+)\s*(\d{4})/)!).find((x) => {
      const k = x[1].toLowerCase()
      return (MESES_LARGOS_EN as readonly string[]).includes(k) || (MESES_LARGOS_ES as readonly string[]).includes(k)
    })
    if (m) {
      const k = m[1].toLowerCase()
      const n = (MESES_LARGOS_EN as readonly string[]).indexOf(k) >= 0 ? (MESES_LARGOS_EN as readonly string[]).indexOf(k) + 1 : (MESES_LARGOS_ES as readonly string[]).indexOf(k) + 1
      mensual = { mes: `${m[2]}-${String(n).padStart(2, '0')}` }
    }
  }

  return {
    marca, tienda, desde, hasta, referencia, depositoIniciado, pedidos, diario,
    ventas: { base: euros(totalDiario.base), iva: euros(totalDiario.iva), total: euros(totalDiario.total), pedidos: totalDiario.pedidos },
    ganancias: { ventas: euros(g.ventas), pedidosVentas: g.pedidosVentas, otras: euros(g.otras), total: euros(g.total) },
    uber: { tasas: euros(u.tasas), otros: euros(u.otros), total: euros(u.total) },
    marketing: { promociones: euros(mk.promociones), otrosPromo: euros(mk.otrosPromo), anuncios: euros(mk.anuncios), total: euros(mk.total) },
    modificaciones: { contracargo: euros(md.contracargo), pedidosContracargo: md.pedidosContracargo, ajustes: euros(md.ajustes), total: euros(md.total) },
    neto: euros(neto), contracargos, mensual, avisos,
  }
}

function fmt(c: number): string {
  const s = Math.abs(c)
  const ent = Math.floor(s / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${c < 0 ? '−' : ''}${ent},${String(s % 100).padStart(2, '0')} €`
}

// ── La factura de comisión ──────────────────────────────────────────────────

export interface FacturaComision {
  /** Tasas de mercado + otros cargos + otros cargos de la promoción: base e IVA dentro. */
  comision: { total: number; base: number }
  /** Gastos en anuncios: base e IVA dentro. */
  publicidad: { total: number; base: number }
  base: number
  iva: number
  total: number
  tipoIva: 21
  /** Lo que NO va en la factura y se guarda aparte (para decidir). */
  fuera: { promocionesEnArticulos: number }
  avisos: string[]
}

/** La factura de comisión que sale del resumen (null si no hay nada que facturar). */
export function facturaDeComision(r: Pick<ResumenUber, 'uber' | 'marketing'>): FacturaComision | null {
  const c = (x: number) => Math.round(x * 100)
  const avisos: string[] = []
  const tc = -(c(r.uber.tasas) + c(r.uber.otros) + c(r.marketing.otrosPromo)) || 0
  const ta = -c(r.marketing.anuncios) || 0
  if (tc < 0) avisos.push('Los cargos de Uber salen a tu favor: la factura puede ser rectificativa.')
  if (ta < 0) avisos.push('Los anuncios salen a tu favor: la factura puede ser rectificativa.')
  const t = tc + ta
  if (t === 0) return null
  const baseT = Math.round(t / 1.21)
  const baseA = Math.round(ta / 1.21)
  return {
    comision: { total: euros(tc), base: euros(baseT - baseA) },
    publicidad: { total: euros(ta), base: euros(baseA) },
    base: euros(baseT), iva: euros(t - baseT), total: euros(t), tipoIva: 21,
    fuera: { promocionesEnArticulos: euros(-c(r.marketing.promociones)) },
    avisos,
  }
}

/** Lo que va a la base (conta_liquidacion_registrar): el resumen, su factura y de dónde salió. */
export function paraRegistrar(r: ResumenUber, x: { emailId: string; adjunto?: { ruta: string; nombre: string; sha256: string } | null }) {
  const f = facturaDeComision(r)
  return {
    proveedor: 'uber', email_id: x.emailId, tienda: r.tienda, marca: r.marca, desde: r.desde, hasta: r.hasta,
    referencia: r.referencia, deposito_iniciado: r.depositoIniciado, pedidos: r.pedidos,
    ventas: r.ventas, ganancias: r.ganancias, uber: r.uber, marketing: r.marketing, modificaciones: r.modificaciones, neto: r.neto,
    diario: r.diario, contracargos: r.contracargos, mensual: r.mensual ? { ...r.mensual, adjunto: x.adjunto ?? null } : null, avisos: r.avisos,
    factura: f ? { comision: f.comision, publicidad: f.publicidad, base: f.base, iva: f.iva, total: f.total, tipo_iva: f.tipoIva, avisos: f.avisos } : null,
  }
}
