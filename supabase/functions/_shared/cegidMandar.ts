// supabase/functions/_shared/cegidMandar.ts
//
// Q10 · respuesta 3 (25/11) · MANDAR A CEGID TODO LO COBRADO, como incidencias del mes: Cegid solo factura lo que manda
// Sumied. Puro (sin red ni base): lo usan la pantalla («Facturas del mes», paso 2) y el servidor (conta-cegid-mandar),
// que vuelve a comprobarlo todo antes de escribir.
//
// LA REGLA (Julio, de siempre): no se factura nada sin el cobro confirmado. Solo salen cobros de GoCardless en estado
// confirmed o paid_out, con su cliente atado, con código de Cegid y con un concepto de la tabla aprobada. Lo demás no
// sale y se dice por qué. Un cliente que aún tiene conceptos fijos en su ficha de Cegid NO se manda (Cegid le
// facturaría dos veces): sale en la lista de «quítalos antes».
//
// LA TABLA DE EQUIVALENCIAS, aprobada por Julio el 25/11 (respuesta 3):
//   Gestoría mensual → 00001 (serie 1) · Gestión laboral → 0008 (1) · Contasimple → 0016 (3) ·
//   Vigilancia de notificaciones → 0021 (1) · Oficina virtual → 0034 (1).
// «Gestoría mensual» lleva las variantes que iban en su fila de la tabla (SERVICIOS GESTORIA, SERVICIOS MENSUALES,
// GESTION MENSUAL y la de un cliente); GESTORIA FISCAL MENSUAL queda fuera hasta que Julio diga su concepto, y lo «sin
// propuesta», también.

export const COBRADO_GC = ['confirmed', 'paid_out'] as const

const FAMILIAS: [RegExp, string][] = [
  [/GESTI[OÓ]N LABORAL|N[OÓ]MINA/, 'GESTION LABORAL'],
  [/CONTA ?SIMPLE/, 'CONTASIMPLE SOFTWARE'],
  [/VIGILANCIA/, 'VIGILANCIA DE NOTIFICACIONES'],
  [/\bRENTA\b/, 'RENTA'],
  [/SERVICIOS? MENSUALES/, 'SERVICIOS MENSUALES'],
  [/SERVICIOS? (DE )?GESTOR[IÍ]A/, 'SERVICIOS GESTORIA'],
  [/GESTOR[IÍ]AL? MENSUAL/, 'GESTORIA MENSUAL'],
]
/** La familia de un concepto de GoCardless; uno que no es de ninguna, su nombre tal cual (en mayúsculas). */
export function familia(nombre: string | null | undefined): string {
  const u = (nombre ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!u) return '(sin suscripción)'
  for (const [re, f] of FAMILIAS) if (re.test(u)) return f
  return u
}

export interface ConceptoCegidAprobado { codigo: string; serie: string; nombre: string }
const GESTORIA: ConceptoCegidAprobado = { codigo: '00001', serie: '1', nombre: 'Gestoría mensual' }
/** La tabla aprobada, por familia de GoCardless. Lo que no está aquí no se manda. */
export const CONCEPTOS_APROBADOS: Readonly<Record<string, ConceptoCegidAprobado>> = {
  'GESTORIA MENSUAL': GESTORIA,
  'SERVICIOS GESTORIA': GESTORIA,
  'SERVICIOS MENSUALES': GESTORIA,
  'GESTION MENSUAL': GESTORIA,
  'INVERSIONES LOYOLAMAR SL': GESTORIA,
  'GESTION LABORAL': { codigo: '0008', serie: '1', nombre: 'Gestión laboral' },
  'CONTASIMPLE SOFTWARE': { codigo: '0016', serie: '3', nombre: 'Contasimple' },
  'VIGILANCIA DE NOTIFICACIONES': { codigo: '0021', serie: '1', nombre: 'Vigilancia de notificaciones' },
  'OFICINA VIRTUAL MENSUAL': { codigo: '0034', serie: '1', nombre: 'Oficina virtual' },
}
export const conceptoAprobado = (nombreGc: string | null | undefined): ConceptoCegidAprobado | null => CONCEPTOS_APROBADOS[familia(nombreGc)] ?? null

/** La base (sin IVA, al 21 %) que da EXACTAMENTE el cobro, en céntimos; null si ninguna (no se manda: a revisar). */
export function baseDelCobro(totalCent: number, ivaPct = 21): number | null {
  const cerca = Math.round(totalCent / (1 + ivaPct / 100))
  for (const b of [cerca, cerca - 1, cerca + 1]) if (b > 0 && b + Math.round((b * ivaPct) / 100) === totalCent) return b
  return null
}

// ── El plan: qué se manda, quién está parado y qué no sale ─────────────────────────

export interface CobroParaMandar {
  gcId: string
  estado: string
  /** AAAA-MM-DD */
  fecha: string
  importe: number
  /** El nombre de la suscripción en GoCardless (el texto de la incidencia). */
  concepto: string | null
  /** La ficha (party) y su código de cliente de Cegid; null si no tiene. */
  partyId: string | null
  nombre: string | null
  codigoCegid: number | null
}
export interface ClienteCegidFijos { codigo: number; conceptos: { codigoConcepto: string | null; descripcion: string | null; totalLinea: number | null }[] | null }

export interface LineaIncidencia {
  gcId: string
  concepto: ConceptoCegidAprobado
  /** El texto de GoCardless: «GESTION LABORAL TRABAJADOR UNO». */
  texto: string
  fecha: string
  baseCent: number
  totalCent: number
}
export interface ClienteParaMandar { codigo: number; nombre: string; lineas: LineaIncidencia[]; totalCent: number }
export interface Parado { codigo: number; nombre: string; conceptos: { codigo: string; descripcion: string; total: number | null }[]; cobros: number; totalCent: number }
export type PorQueNoSale = 'no_cobrado' | 'sin_cliente' | 'sin_codigo' | 'sin_concepto' | 'no_cuadra' | 'ya_mandado'
export interface NoSale { gcId: string; nombre: string | null; concepto: string | null; totalCent: number; porque: PorQueNoSale; frase: string }

export interface PlanMandar {
  mes: string
  listos: ClienteParaMandar[]
  parados: Parado[]
  noSalen: NoSale[]
  yaMandados: number
  listosCent: number
  frase: string
}

const FRASE_NO_SALE: Record<PorQueNoSale, string> = {
  no_cobrado: 'GoCardless no lo ha cobrado: no se factura (se sigue como deuda).',
  sin_cliente: 'El cobro no tiene su cliente atado a una ficha.',
  sin_codigo: 'La ficha no tiene código de cliente en Cegid.',
  sin_concepto: 'Su concepto no está en la tabla aprobada: Julio dice cuál es.',
  no_cuadra: 'Ninguna base con el IVA del 21 % da el cobro al céntimo.',
  ya_mandado: 'Ya está mandado a Cegid.',
}
const eur = (c: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(c / 100)} €`

/**
 * El plan de un mes: por cliente de Cegid, sus incidencias (una por cobro, con su concepto y su serie). Un cliente con
 * conceptos fijos en su ficha va a «parados» con todos sus cobros. Los cobros ya mandados no vuelven a salir.
 */
export function planMandar(mes: string, cobros: readonly CobroParaMandar[], clientesCegid: readonly ClienteCegidFijos[], yaMandados: ReadonlySet<string>): PlanMandar {
  const fijos = new Map(clientesCegid.map((c) => [c.codigo, c.conceptos ?? []]))
  const por = new Map<number, ClienteParaMandar>()
  const noSalen: NoSale[] = []
  let ya = 0
  for (const c of cobros) {
    if (c.fecha.slice(0, 7) !== mes) continue
    const totalCent = Math.round(c.importe * 100)
    const no = (porque: PorQueNoSale) => noSalen.push({ gcId: c.gcId, nombre: c.nombre, concepto: c.concepto, totalCent, porque, frase: FRASE_NO_SALE[porque] })
    if (!(COBRADO_GC as readonly string[]).includes(c.estado)) { no('no_cobrado'); continue }
    if (yaMandados.has(c.gcId)) { ya++; continue }
    if (!c.partyId) { no('sin_cliente'); continue }
    if (c.codigoCegid === null) { no('sin_codigo'); continue }
    const concepto = conceptoAprobado(c.concepto)
    if (!concepto) { no('sin_concepto'); continue }
    const baseCent = baseDelCobro(totalCent)
    if (baseCent === null) { no('no_cuadra'); continue }
    const k = por.get(c.codigoCegid) ?? { codigo: c.codigoCegid, nombre: c.nombre ?? String(c.codigoCegid), lineas: [], totalCent: 0 }
    k.lineas.push({ gcId: c.gcId, concepto, texto: (c.concepto ?? '').replace(/\s+/g, ' ').trim(), fecha: c.fecha, baseCent, totalCent })
    k.totalCent += totalCent
    por.set(c.codigoCegid, k)
  }
  const listos: ClienteParaMandar[] = [], parados: Parado[] = []
  for (const k of [...por.values()].sort((a, b) => a.codigo - b.codigo)) {
    k.lineas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))
    const f = (fijos.get(k.codigo) ?? []).filter((x) => (x.codigoConcepto ?? '').trim())
    if (f.length) parados.push({ codigo: k.codigo, nombre: k.nombre, conceptos: f.map((x) => ({ codigo: String(x.codigoConcepto).trim(), descripcion: (x.descripcion ?? '').trim(), total: x.totalLinea })), cobros: k.lineas.length, totalCent: k.totalCent })
    else listos.push(k)
  }
  const listosCent = listos.reduce((t, k) => t + k.totalCent, 0)
  const frase = `Listos para mandar: ${listos.length} ${listos.length === 1 ? 'cliente' : 'clientes'}, ${eur(listosCent)}. Parados por conceptos fijos en Cegid: ${parados.length}.`
  return { mes, listos, parados, noSalen, yaMandados: ya, listosCent, frase }
}

// ── La incidencia, como la pide la API (POST /api/Incidences/incidence) ───────────────

/** El cuerpo de una incidencia nueva (incidencia 0: la numera Cegid). Importe sin IVA, con el 21 % aparte; sin retención (QBO). */
export function cuerpoIncidencia(cliente: number, l: LineaIncidencia, mes: string): Record<string, unknown> {
  return {
    cliente, incidencia: 0, concepto: l.concepto.codigo,
    titulo: l.texto.slice(0, 45), textoConcepto: l.texto.slice(0, 250),
    importe: l.baseCent / 100, porcentajeIva: 21, unidades: 1, total: l.totalCent / 100,
    llevaRetencion: false, esSuplido: false, estaFacturado: false, incluyeIva: false,
    mes: Number(mes.slice(5, 7)), ano: Number(mes.slice(0, 4)),
  }
}
