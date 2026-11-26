// supabase/functions/_shared/cegidMandar.ts
//
// Q10 · respuesta 3 (25/11) · MANDAR A CEGID TODO LO COBRADO, como incidencias del mes: Cegid solo factura lo que manda
// Sumied. Puro (sin red ni base): lo usan la pantalla («Facturas del mes», paso 2) y el servidor (conta-cegid-mandar),
// que vuelve a comprobarlo todo antes de escribir.
//
// LA REGLA (Julio, de siempre): no se factura nada sin el cobro confirmado. Solo salen cobros de GoCardless en estado
// confirmed o paid_out, con su cliente atado, con código de Cegid y con un concepto de la tabla aprobada. Lo demás no
// sale y se dice por qué. Los conceptos fijos de la ficha de Cegid NO paran a nadie (añadido a la respuesta 3): Julio
// quita «Noviembre» del periodo MENSUAL en Cegid, y la API los sigue devolviendo en la ficha.
//
// LA TABLA DE EQUIVALENCIAS, aprobada por Julio el 25/11 (respuesta 3):
//   Gestoría mensual → 00001 (serie 1) · Gestión laboral → 0008 (1) · Contasimple → 0016 (3) ·
//   Vigilancia de notificaciones → 0021 (1) · Oficina virtual → 0034 (1).
// «Gestoría mensual» lleva las variantes que iban en su fila de la tabla (SERVICIOS GESTORIA, SERVICIOS MENSUALES,
// GESTION MENSUAL y la de un cliente); GESTORIA FISCAL MENSUAL, también (respuesta 4, 26/11).

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
  // Respuesta 4 (Julio, 26/11): como su concepto fijo en Cegid y sus facturas de septiembre y octubre.
  'GESTORIA FISCAL MENSUAL': GESTORIA,
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

// ── El plan: qué se manda y qué no sale ─────────────────────────

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
export type PorQueNoSale = 'no_cobrado' | 'sin_cliente' | 'sin_codigo' | 'sin_concepto' | 'no_cuadra' | 'ya_mandado'
export interface NoSale { gcId: string; nombre: string | null; concepto: string | null; totalCent: number; porque: PorQueNoSale; frase: string }

/** Q10 · respuesta 4 · Una vuelta por serie: la incidencia no lleva serie (la pone la «Facturación automática»), así que
 * se manda primero todo menos Contasimple (Julio factura con la serie 1) y después Contasimple (con la serie 3). */
export type SerieVuelta = '1' | '3'
export interface Vuelta { serie: SerieVuelta; listos: ClienteParaMandar[]; cent: number; lineas: number; frase: string }

export interface PlanMandar {
  mes: string
  vueltas: Record<SerieVuelta, Vuelta>
  noSalen: NoSale[]
  yaMandados: number
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
 * El plan de un mes: por vuelta (serie) y por cliente de Cegid, sus incidencias (una por cobro, con su concepto). Los
 * cobros ya mandados no vuelven a salir.
 */
export function planMandar(mes: string, cobros: readonly CobroParaMandar[], yaMandados: ReadonlySet<string>): PlanMandar {
  const por: Record<SerieVuelta, Map<number, ClienteParaMandar>> = { '1': new Map(), '3': new Map() }
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
    const m = por[concepto.serie === '3' ? '3' : '1']
    const k = m.get(c.codigoCegid) ?? { codigo: c.codigoCegid, nombre: c.nombre ?? String(c.codigoCegid), lineas: [], totalCent: 0 }
    k.lineas.push({ gcId: c.gcId, concepto, texto: (c.concepto ?? '').replace(/\s+/g, ' ').trim(), fecha: c.fecha, baseCent, totalCent })
    k.totalCent += totalCent
    m.set(c.codigoCegid, k)
  }
  const vuelta = (serie: SerieVuelta): Vuelta => {
    const listos = [...por[serie].values()].sort((a, b) => a.codigo - b.codigo)
    for (const k of listos) k.lineas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))
    const cent = listos.reduce((t, k) => t + k.totalCent, 0)
    const n = `${listos.length} ${listos.length === 1 ? 'cliente' : 'clientes'}, ${eur(cent)}`
    return { serie, listos, cent, lineas: listos.reduce((t, k) => t + k.lineas.length, 0),
      frase: serie === '1' ? `Primero: ${n} → factura con la serie 1` : `Después: Contasimple, ${n} → factura con la serie 3` }
  }
  return { mes, vueltas: { '1': vuelta('1'), '3': vuelta('3') }, noSalen, yaMandados: ya }
}

// ── Q10 · respuesta 4 · Lo que hay en Cegid para facturar, cobro por cobro ─────────────

/** Una incidencia del mes leída de Cegid (GET /api/Incidences): las de Sumied y las de cualquiera. */
export interface IncidenciaCegid {
  cliente: number
  incidencia: number
  concepto: string | null
  titulo: string | null
  texto: string | null
  importe: number | null
  total: number | null
  facturada: boolean
  serieFactura: string | null
  numeroFactura: number | null
}
/** Lo que Sumied mandó (conta_cegid_incidencia): de qué cobro es cada incidencia. */
export interface MandadaCuadre { gcCobroId: string; cliente: number; incidencia: number | null; estado: string }
export interface FilaCuadre {
  gcId: string | null
  fecha: string | null
  cliente: string | null
  importeCent: number | null
  codigo: number | null
  nombreCegid: string | null
  concepto: string | null
  texto: string | null
  importeCegidCent: number | null
  serie: string | null
  cuadra: boolean
  porque: string
}
export interface Cuadre {
  filas: FilaCuadre[]
  diferencias: number
  cuadra: boolean
  cegidCent: number
  clientesCegid: number
  cobradoCent: number
  porSerie: Record<SerieVuelta, { cent: number; clientes: number; lineas: number }>
  frase: string
}

/** El total de una incidencia, en céntimos: su total, o su importe con el 21 %. */
export const totalIncidenciaCent = (x: IncidenciaCegid): number => x.total != null ? Math.round(x.total * 100) : x.importe != null ? Math.round(x.importe * 121) : 0
/** La serie de una incidencia: la de su factura si ya está facturada; si no, la de su concepto (0016 en la 3). */
export const serieDeIncidencia = (x: IncidenciaCegid): SerieVuelta => (x.facturada && x.serieFactura ? (x.serieFactura.trim() === '3' ? '3' : '1') : (x.concepto ?? '').trim() === '0016' ? '3' : '1')

/**
 * El cruce, cobro por cobro, de lo cobrado por GoCardless (confirmado) con las incidencias del mes en Cegid. Primero por
 * lo que mandó Sumied (cobro → cliente e incidencia); lo demás, por cliente e importe. Cada cobro con su incidencia;
 * lo que sobra en Cegid; lo que falta. Un cobro que no va a Cegid (sin concepto aprobado, sin ficha…) es una diferencia.
 */
export function cuadreCegid(mes: string, cobros: readonly CobroParaMandar[], incidencias: readonly IncidenciaCegid[], mandadas: readonly MandadaCuadre[],
  nombresCegid: ReadonlyMap<number, string>): Cuadre {
  const cobrados = cobros.filter((c) => c.fecha.slice(0, 7) === mes && (COBRADO_GC as readonly string[]).includes(c.estado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))
  const libres = new Map(incidencias.map((x) => [`${x.cliente}/${x.incidencia}`, x]))
  const deSumied = new Map(mandadas.filter((m) => m.incidencia != null && ['mandada', 'facturada'].includes(m.estado)).map((m) => [m.gcCobroId, `${m.cliente}/${m.incidencia}`]))
  const pareja = new Map<string, IncidenciaCegid>()
  for (const c of cobrados) {
    const k = deSumied.get(c.gcId)
    if (k && libres.has(k)) { pareja.set(c.gcId, libres.get(k)!); libres.delete(k) }
  }
  for (const c of cobrados) {
    if (pareja.has(c.gcId) || c.codigoCegid === null) continue
    const t = Math.round(c.importe * 100)
    const x = [...libres.values()].find((y) => y.cliente === c.codigoCegid && totalIncidenciaCent(y) === t)
    if (x) { pareja.set(c.gcId, x); libres.delete(`${x.cliente}/${x.incidencia}`) }
  }
  const filas: FilaCuadre[] = []
  const deCegid = (x: IncidenciaCegid) => ({ codigo: x.cliente, nombreCegid: nombresCegid.get(x.cliente) ?? null, concepto: x.concepto, texto: x.texto ?? x.titulo,
    importeCegidCent: totalIncidenciaCent(x), serie: serieDeIncidencia(x) })
  for (const c of cobrados) {
    const t = Math.round(c.importe * 100)
    const base = { gcId: c.gcId, fecha: c.fecha, cliente: c.nombre, importeCent: t }
    const x = pareja.get(c.gcId)
    if (!x) {
      const ap = conceptoAprobado(c.concepto)
      const porque = !c.partyId ? 'Cobrado y no está en Cegid: el cobro no tiene su ficha.' : c.codigoCegid === null ? 'Cobrado y no está en Cegid: la ficha no tiene código de Cegid.'
        : !ap ? 'Cobrado y no está en Cegid: su concepto no está en la tabla aprobada.' : 'Cobrado y no está en Cegid: falta mandarlo.'
      filas.push({ ...base, codigo: c.codigoCegid, nombreCegid: c.codigoCegid != null ? nombresCegid.get(c.codigoCegid) ?? null : null, concepto: ap?.codigo ?? null,
        texto: c.concepto, importeCegidCent: null, serie: ap?.serie ?? null, cuadra: false, porque })
      continue
    }
    const ap = conceptoAprobado(c.concepto)
    const malo = x.cliente !== c.codigoCegid ? `En Cegid está en el cliente ${x.cliente}, y su ficha es el ${c.codigoCegid ?? '(sin código)'}.`
      : totalIncidenciaCent(x) !== t ? `En Cegid son ${eur(totalIncidenciaCent(x))} y GoCardless cobró ${eur(t)}.`
      : ap && (x.concepto ?? '').trim() !== ap.codigo ? `En Cegid va con el concepto ${x.concepto ?? '(ninguno)'} y le toca el ${ap.codigo}.` : null
    filas.push({ ...base, ...deCegid(x), cuadra: !malo, porque: malo ?? 'Cuadra.' })
  }
  for (const x of [...libres.values()].sort((a, b) => a.cliente - b.cliente || a.incidencia - b.incidencia)) {
    filas.push({ gcId: null, fecha: null, cliente: null, importeCent: null, ...deCegid(x), cuadra: false, porque: 'Está en Cegid y no tiene cobro de GoCardless.' })
  }
  const porSerie: Cuadre['porSerie'] = { '1': { cent: 0, clientes: 0, lineas: 0 }, '3': { cent: 0, clientes: 0, lineas: 0 } }
  const clientes: Record<SerieVuelta, Set<number>> = { '1': new Set(), '3': new Set() }
  for (const x of incidencias) { const s = serieDeIncidencia(x); porSerie[s].cent += totalIncidenciaCent(x); porSerie[s].lineas++; clientes[s].add(x.cliente) }
  porSerie['1'].clientes = clientes['1'].size; porSerie['3'].clientes = clientes['3'].size
  const cegidCent = porSerie['1'].cent + porSerie['3'].cent
  const clientesCegid = new Set(incidencias.map((x) => x.cliente)).size
  const cobradoCent = cobrados.reduce((t, c) => t + Math.round(c.importe * 100), 0)
  const diferencias = filas.filter((f) => !f.cuadra).length
  const frase = `Cegid va a facturar ${eur(cegidCent)} en ${clientesCegid} ${clientesCegid === 1 ? 'cliente' : 'clientes'}. GoCardless cobró ${eur(cobradoCent)}. `
    + (diferencias ? `No cuadra: ${diferencias} ${diferencias === 1 ? 'diferencia' : 'diferencias'}.` : 'Cuadra cobro por cobro.')
  return { filas, diferencias, cuadra: diferencias === 0, cegidCent, clientesCegid, cobradoCent, porSerie, frase }
}

/** Lo mandado a Cegid de un mes (conta_cegid_incidencia), lo justo para la puerta de la vuelta 3. */
export interface MandadaQ10 { estado: string; serie: string; serieFactura: string | null }

/** Si la vuelta 3 (Contasimple) se puede mandar ya: todo lo de la vuelta 1 del mes, facturado en la serie 1. */
export function puertaContasimple(mandadas: readonly MandadaQ10[]): { abierta: boolean; porque: string } {
  const s1 = mandadas.filter((x) => x.serie === '1' && ['mandando', 'mandada', 'facturada'].includes(x.estado))
  if (!s1.length) return { abierta: false, porque: 'Primero se manda y se factura con la serie 1 todo lo demás.' }
  const sin = s1.filter((x) => x.estado !== 'facturada').length
  if (sin) return { abierta: false, porque: `Aún hay ${sin} ${sin === 1 ? 'línea' : 'líneas'} de la serie 1 sin facturar en Cegid: factura con la serie 1 y vuelve a leer de Cegid.` }
  const otra = s1.filter((x) => (x.serieFactura ?? '').trim() !== '1').length
  if (otra) return { abierta: false, porque: `${otra} ${otra === 1 ? 'línea' : 'líneas'} de la vuelta 1 se facturaron en otra serie que la 1: míralo en Cegid.` }
  return { abierta: true, porque: '' }
}

// ── Q10 · respuesta 4 · Atar una ficha a su cliente de Cegid ──────────────────────────

/** El tipo de un NIF: CIF de una empresa, DNI o NIE de una persona; y si su letra de control cuadra. */
export function tipoNif(n: string | null | undefined): { nif: string; tipo: 'cif' | 'dni' | 'nie' | 'otro'; valido: boolean } | null {
  const x = String(n ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES(?=[0-9A-Z]{9}$)/, '')
  if (!x) return null
  const L = 'TRWAGMYFPDXBNJZSQVHLCKE'
  if (/^\d{8}[A-Z]$/.test(x)) return { nif: x, tipo: 'dni', valido: L[Number(x.slice(0, 8)) % 23] === x[8] }
  if (/^[XYZ]\d{7}[A-Z]$/.test(x)) return { nif: x, tipo: 'nie', valido: L[Number('XYZ'.indexOf(x[0]) + x.slice(1, 8)) % 23] === x[8] }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(x)) return { nif: x, tipo: 'cif', valido: true }
  return { nif: x, tipo: 'otro', valido: false }
}
export type GanaNif = 'iguales' | 'sumied' | 'cegid' | 'mirar'
/**
 * La regla del NIF (Julio, respuesta 4): el que no pasa su letra pierde; el CIF de la empresa gana al DNI o NIE de una
 * persona; el DNI gana al NIE; si falta en un lado, se toma el del otro. Dos distintos del mismo tipo y válidos: a mirar.
 */
export function ganaNif(sumied: string | null | undefined, cegid: string | null | undefined): GanaNif {
  const a = tipoNif(sumied), b = tipoNif(cegid)
  if (!a && !b) return 'mirar'
  if (!a) return 'cegid'
  if (!b) return 'sumied'
  if (a.nif === b.nif) return 'iguales'
  if (a.valido !== b.valido) return a.valido ? 'sumied' : 'cegid'
  const peso = { cif: 3, dni: 2, nie: 1, otro: 0 }
  if (peso[a.tipo] !== peso[b.tipo]) return peso[a.tipo] > peso[b.tipo] ? 'sumied' : 'cegid'
  return 'mirar'
}

const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SL', 'SA', 'SLU', 'SLL', 'SC', 'CB', 'SOCIEDAD', 'LIMITADA'])
/** Las palabras de un nombre, sin tildes, signos ni las que no distinguen («de», «SL»…). */
export function palabrasNombre(n: string | null | undefined): string[] {
  return [...new Set(String(n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\bS\.\s?L\.?(U\.?)?/g, ' ').replace(/[^A-Z0-9Ñ ]/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 2 && !VACIAS.has(w)))]
}
export interface ClienteCegidAtar { codigo: number; nombre: string | null; nif: string | null; email: string | null }
export interface PropuestaAtado { codigo: number; nombre: string | null; por: 'nombre' | 'correo'; comunes: number }
/**
 * Las propuestas para atar una ficha sin código: los clientes de Cegid con su mismo correo, y los que comparten con su
 * nombre al menos dos palabras (o la única, si el nombre de Cegid solo tiene una). Primero el correo, después las que
 * más palabras comparten.
 */
export function proponerAtado(nombre: string | null, correos: readonly (string | null)[], clientes: readonly ClienteCegidAtar[]): PropuestaAtado[] {
  const mias = new Set(palabrasNombre(nombre))
  const mails = new Set(correos.map((c) => String(c ?? '').trim().toLowerCase()).filter(Boolean))
  const r: PropuestaAtado[] = []
  for (const c of clientes) {
    const e = String(c.email ?? '').trim().toLowerCase()
    if (e && mails.has(e)) { r.push({ codigo: c.codigo, nombre: c.nombre, por: 'correo', comunes: 99 }); continue }
    const suyas = palabrasNombre(c.nombre)
    const comunes = suyas.filter((w) => mias.has(w)).length
    if (comunes >= 2 || (comunes === 1 && suyas.length === 1 && mias.size === 1)) r.push({ codigo: c.codigo, nombre: c.nombre, por: 'nombre', comunes })
  }
  return r.sort((a, b) => b.comunes - a.comunes || a.codigo - b.codigo).slice(0, 3)
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
