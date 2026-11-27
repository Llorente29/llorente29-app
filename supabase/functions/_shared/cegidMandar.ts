// supabase/functions/_shared/cegidMandar.ts
//
// Q10 · respuesta 3 (25/11) · MANDAR A CEGID TODO LO COBRADO, como incidencias del mes: Cegid solo factura lo que manda
// Sumied. Puro (sin red ni base): lo usan la pantalla («Facturas del mes», paso 2) y el servidor (conta-cegid-mandar),
// que vuelve a comprobarlo todo antes de escribir.
//
// LA REGLA (Julio, de siempre): no se factura nada sin el cobro confirmado. Solo salen cobros de GoCardless en estado
// confirmed o paid_out, con su cliente atado, con código de Cegid y con un concepto de la tabla aprobada. Lo demás no
// sale y se dice por qué.
// LAS CUOTAS FIJAS (respuesta 6, 26/11): Julio las corta en Cegid con «Facturar hasta 10/2026», y la API no devuelve esa
// fecha (GetCustomer no la trae). Los 190 clientes de QBO con cuotas fijas revisados el 26/11 están en
// conta_cegid_cuota_revisada; a un cliente con cuotas fijas que no está ahí no se le manda nada: «Cliente nuevo con
// cuota fija en Cegid: ponle el Facturar hasta». Sumied no da de alta clientes en Cegid (diezRec.ts no lo deja).
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

/**
 * Respuesta 4 · Los conceptos de Cegid que se pueden elegir para lo que no está en la tabla (un cobro suelto, una
 * suscripción con nombre propio): todos en la serie 1, con IVA general. El 0039 es el global de Julio para lo que no
 * tiene concepto propio.
 */
export const CONCEPTOS_CEGID: Readonly<Record<string, ConceptoCegidAprobado>> = {
  '00001': GESTORIA,
  '0008': { codigo: '0008', serie: '1', nombre: 'Gestión laboral' },
  '0016': { codigo: '0016', serie: '3', nombre: 'Contasimple' },
  '0017': { codigo: '0017', serie: '1', nombre: 'Renta' },
  '00016': { codigo: '00016', serie: '1', nombre: 'Fiscalización' },
  '00007': { codigo: '00007', serie: '1', nombre: 'Trámite de ayuda' },
  '0021': { codigo: '0021', serie: '1', nombre: 'Vigilancia de notificaciones' },
  '0034': { codigo: '0034', serie: '1', nombre: 'Oficina virtual' },
  '0039': { codigo: '0039', serie: '1', nombre: 'Otros trámites y gestiones' },
  // Q10 · respuesta 8 · «CONSULTA Y ALTA DE AUTONOMO» en Cegid: lo pagado con tarjeta por alta de autónomo.
  '0022': { codigo: '0022', serie: '1', nombre: 'Consulta y alta de autónomo' },
  // Q10 · respuesta 9 · «CITA ONLINE- CONSULTAS» en Cegid.
  '0035': { codigo: '0035', serie: '1', nombre: 'Cita online, consultas' },
  // Q10 · respuesta 7 · El recargo por cobro devuelto: lo que pagó de verdad, con el IVA (21 %) incluido.
  '0018': { codigo: '0018', serie: '1', nombre: 'Recargo por cobro devuelto' },
}
export const conceptoDeCodigo = (codigo: string | null | undefined): ConceptoCegidAprobado | null => {
  const c = String(codigo ?? '').trim().toUpperCase()
  return CONCEPTOS_CEGID[c] ?? (/^[0-9A-Z]{1,5}$/.test(c) ? { codigo: c, serie: '1', nombre: `Concepto ${c}` } : null)
}
/**
 * Respuesta 4 · La propuesta para lo que no tiene concepto, por palabras de su texto (Julio la confirma): laboral →
 * 0008, renta → 0017, fiscalización → 00016, ayuda → 00007, lo demás → 0039.
 */
export function proponerConcepto(texto: string | null | undefined): ConceptoCegidAprobado {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  if (/LABORAL/.test(t)) return CONCEPTOS_CEGID['0008']
  if (/\bRENTA\b/.test(t)) return CONCEPTOS_CEGID['0017']
  if (/FISCALIZACION/.test(t)) return CONCEPTOS_CEGID['00016']
  if (/\bAYUDAS?\b/.test(t)) return CONCEPTOS_CEGID['00007']
  return CONCEPTOS_CEGID['0039']
}

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
  /** El nombre de la suscripción en GoCardless (el texto de la incidencia); null en un cobro suelto. */
  concepto: string | null
  /** Respuesta 4 · La suscripción del cobro (null: suelto), el texto del cobro y el concepto que eligió una persona. */
  suscripcionId?: string | null
  descripcion?: string | null
  elegido?: string | null
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
export type PorQueNoSale = 'no_cobrado' | 'sin_cliente' | 'sin_codigo' | 'cuota_sin_hasta' | 'sin_concepto' | 'sin_texto' | 'no_cuadra' | 'ya_mandado'
export interface NoSale {
  gcId: string
  nombre: string | null
  concepto: string | null
  totalCent: number
  porque: PorQueNoSale
  frase: string
  /** Respuesta 4 · Sin concepto: lo que se propone y qué se confirma (el cobro suelto o su suscripción). */
  propuesta?: ConceptoCegidAprobado
  elegir?: { que: 'cobro' | 'suscripcion'; gcId: string }
}

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
  cuota_sin_hasta: 'Cliente nuevo con cuota fija en Cegid: ponle el Facturar hasta.',
  sin_concepto: 'Su concepto no está en la tabla aprobada: confirma el que se propone o elige otro.',
  sin_texto: 'Falta el texto del cobro en GoCardless: vuelve a leer GoCardless.',
  no_cuadra: 'Ninguna base con el IVA del 21 % da el cobro al céntimo.',
  ya_mandado: 'Ya está mandado a Cegid.',
}
const eur = (c: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(c / 100)} €`

/** Respuesta 6 · La frase de la guarda de las cuotas fijas, la misma en la pantalla y en el servidor. */
export const FRASE_CUOTA_SIN_HASTA = FRASE_NO_SALE.cuota_sin_hasta
/**
 * Respuesta 6 · Los clientes de Cegid con cuotas fijas en su ficha que no están entre los revisados (los que ya
 * llevan «Facturar hasta»): a ellos no se les manda nada.
 */
export function cuotasSinHasta(clientes: readonly { codigo: number; conceptos: readonly unknown[] | null }[], revisados: Iterable<number>): Set<number> {
  const r = new Set(revisados)
  return new Set(clientes.filter((c) => (c.conceptos?.length ?? 0) > 0 && !r.has(c.codigo)).map((c) => c.codigo))
}

/**
 * El plan de un mes: por vuelta (serie) y por cliente de Cegid, sus incidencias (una por cobro, con su concepto). Los
 * cobros ya mandados no vuelven a salir.
 */
export function planMandar(mes: string, cobros: readonly CobroParaMandar[], yaMandados: ReadonlySet<string>, cuotaSinHasta: ReadonlySet<number> = new Set()): PlanMandar {
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
    if (cuotaSinHasta.has(c.codigoCegid)) { no('cuota_sin_hasta'); continue }
    const suelto = !c.concepto
    const concepto = c.elegido ? conceptoDeCodigo(c.elegido) : conceptoAprobado(c.concepto)
    if (!concepto) {
      const texto = suelto ? c.descripcion : c.concepto
      noSalen.push({ gcId: c.gcId, nombre: c.nombre, concepto: texto ?? null, totalCent, porque: 'sin_concepto', frase: FRASE_NO_SALE.sin_concepto,
        propuesta: proponerConcepto(texto), elegir: suelto || !c.suscripcionId ? { que: 'cobro', gcId: c.gcId } : { que: 'suscripcion', gcId: c.suscripcionId } })
      continue
    }
    // El texto de la incidencia: el nombre de la suscripción o, en un cobro suelto, el texto del cobro.
    const texto = (suelto ? c.descripcion ?? '' : c.concepto ?? '').replace(/\s+/g, ' ').trim()
    if (!texto) { no('sin_texto'); continue }
    const baseCent = baseDelCobro(totalCent)
    if (baseCent === null) { no('no_cuadra'); continue }
    const m = por[concepto.serie === '3' ? '3' : '1']
    const k = m.get(c.codigoCegid) ?? { codigo: c.codigoCegid, nombre: c.nombre ?? String(c.codigoCegid), lineas: [], totalCent: 0 }
    k.lineas.push({ gcId: c.gcId, concepto, texto, fecha: c.fecha, baseCent, totalCent })
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

/**
 * Lo que va a cobrar una incidencia, con su IVA, en céntimos: su importe (la base) con el 21 %, redondeado como
 * baseDelCobro. Respuesta 6: el «total» de la API es la base (lo corrigió Julio el 26/11), así que no vale para
 * compararlo con lo cobrado; solo cuando no hay importe.
 */
export const totalIncidenciaCent = (x: IncidenciaCegid): number => {
  if (x.importe != null) { const b = Math.round(x.importe * 100); return b + Math.round((b * 21) / 100) }
  return x.total != null ? Math.round(x.total * 100) : 0
}
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
      const ap = c.elegido ? conceptoDeCodigo(c.elegido) : conceptoAprobado(c.concepto)
      const porque = !c.partyId ? 'Cobrado y no está en Cegid: el cobro no tiene su ficha.' : c.codigoCegid === null ? 'Cobrado y no está en Cegid: la ficha no tiene código de Cegid.'
        : !ap ? 'Cobrado y no está en Cegid: su concepto no está en la tabla aprobada.' : 'Cobrado y no está en Cegid: falta mandarlo.'
      filas.push({ ...base, codigo: c.codigoCegid, nombreCegid: c.codigoCegid != null ? nombresCegid.get(c.codigoCegid) ?? null : null, concepto: ap?.codigo ?? null,
        texto: c.concepto ?? c.descripcion ?? null, importeCegidCent: null, serie: ap?.serie ?? null, cuadra: false, porque })
      continue
    }
    const ap = c.elegido ? conceptoDeCodigo(c.elegido) : conceptoAprobado(c.concepto)
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

// ── La incidencia, como la pide la API (POST y PUT /api/Incidences/incidence) ───────────────
//
// Respuesta 6 (26/11) · Cómo la quiere Cegid para facturar, sacado de la 9/2 que corrigió Julio a mano (run 45901138694):
//   · textoIncidencia: la descripción de la línea de la factura, en RTF, con el mismo formato que la 9/2;
//   · ivaConcepto: el código del TIPO de IVA en Cegid (no el del concepto): el «1» es «I.V.A. GENERAL», el 21 %. La
//     API no da la tabla de tipos de IVA: con otro porcentaje, se para y se dice;
//   · total: el importe sin IVA (la base). Cegid toma el total como base: con 84,70 facturaba 84,70 + IVA.
// fecha y serieFactura no se tocan.

/** El código del tipo de IVA de Cegid de cada porcentaje que se conoce (Julio, 26/11). Ninguno más: no se inventa. */
export const TIPO_IVA_CEGID: Readonly<Record<number, string>> = { 21: '1' }
export const tipoIvaCegid = (porcentaje: unknown): string | null => {
  const n = Number(porcentaje)
  return porcentaje == null || porcentaje === '' || !Number.isFinite(n) ? null : TIPO_IVA_CEGID[n] ?? null
}

/** Un carácter del texto, como lo escribe RTF con la página de códigos 1252 (la de la 9/2). */
const CP1252: Readonly<Record<string, number>> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b,
  'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f }
function caracterRtf(ch: string): string {
  if (ch === '\\' || ch === '{' || ch === '}') return `\\${ch}`
  const c = ch.codePointAt(0)!
  if (c < 0x20) return ' '
  if (c < 0x80) return ch
  const b = c >= 0xa0 && c <= 0xff ? c : CP1252[ch]
  if (b !== undefined) return `\\'${b.toString(16).padStart(2, '0')}`
  // Fuera de la 1252: \uN con «?» de reserva (\uc1).
  return c > 0xffff ? '?' : `\\u${c > 0x7fff ? c - 0x10000 : c}?`
}
/**
 * La descripción de la línea, en RTF, copiada tal cual de la 9/2 (Julio, 26/11) y cambiando solo el texto. El RTF de
 * Cegid acaba en un carácter nulo: va también.
 */
export function textoRtf(texto: string): string {
  const t = [...texto.replace(/\s+/g, ' ').trim()].map(caracterRtf).join('')
  return '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Verdana;}}\r\n{\\colortbl ;\\red0\\green0\\blue0;}\r\n'
    + `\\viewkind4\\uc1\\pard\\cf1\\lang3082\\f0\\fs18 ${t}\\par\r\n\\par\r\n}\r\n\u0000`
}

/** El cuerpo de una incidencia nueva (incidencia 0: la numera Cegid). Importe y total sin IVA, con el 21 % y su tipo aparte; sin retención (QBO). */
export function cuerpoIncidencia(cliente: number, l: LineaIncidencia, mes: string): Record<string, unknown> {
  return {
    cliente, incidencia: 0, concepto: l.concepto.codigo,
    titulo: l.texto.slice(0, 45), textoConcepto: l.texto.slice(0, 250), textoIncidencia: textoRtf(l.texto),
    importe: l.baseCent / 100, ivaConcepto: TIPO_IVA_CEGID[21], porcentajeIva: 21, unidades: 1, total: l.baseCent / 100,
    llevaRetencion: false, esSuplido: false, estaFacturado: false, incluyeIva: false,
    mes: Number(mes.slice(5, 7)), ano: Number(mes.slice(0, 4)),
  }
}

// ── Respuesta 6 · Corregir una incidencia ya mandada (PUT) ──────────────────────────────

export type Corregir =
  | { que: 'corregir'; cuerpo: Record<string, unknown>; texto: string; tipoIva: string; baseCent: number }
  | { que: 'ya_bien' }
  | { que: 'parar'; porque: string }

const r2 = (n: number) => Math.round(n * 100) / 100
/**
 * Lo que hay que mandar por PUT para corregir una incidencia leída de Cegid (GET): la misma, con la descripción en
 * RTF, el tipo de IVA de su porcentaje y el total igual a la base. `base` es la que apuntó Sumied al mandarla: si Cegid
 * dice otra, se para. Si ya está así, no se toca (la 9/2). Con algo que no se sabe arreglar, se para y se dice por qué.
 */
export function corregirIncidencia(x: Record<string, unknown>, base: number): Corregir {
  const id = `${x.cliente}/${x.incidencia}`
  if (x.estaFacturado === true) return { que: 'parar', porque: `La ${id} ya está facturada en Cegid: no se toca.` }
  if (x.incluyeIva === true) return { que: 'parar', porque: `La ${id} dice que su importe incluye el IVA: no se sabe corregir.` }
  const tipoIva = tipoIvaCegid(x.porcentajeIva)
  if (!tipoIva) return { que: 'parar', porque: `La ${id} lleva el ${x.porcentajeIva ?? '(ninguno)'} % de IVA y no se sabe su tipo de IVA en Cegid: la API no da la tabla. Dime su código.` }
  const importe = x.importe == null || x.importe === '' ? NaN : Number(x.importe), unidades = x.unidades == null || x.unidades === '' ? 1 : Number(x.unidades)
  if (!Number.isFinite(importe) || !Number.isFinite(unidades)) return { que: 'parar', porque: `La ${id} no tiene importe en Cegid.` }
  const baseCent = Math.round(importe * unidades * 100)
  if (baseCent !== Math.round(base * 100)) return { que: 'parar', porque: `La ${id} tiene en Cegid una base de ${eur(baseCent)} y Sumied mandó ${eur(Math.round(base * 100))}: míralo antes.` }
  const texto = String(x.textoConcepto ?? x.titulo ?? '').replace(/\s+/g, ' ').trim()
  if (!texto) return { que: 'parar', porque: `La ${id} no tiene texto en Cegid para la descripción.` }
  const totalBien = x.total != null && x.total !== '' && Math.round(Number(x.total) * 100) === baseCent
  const textoBien = typeof x.textoIncidencia === 'string' && x.textoIncidencia.trim() !== ''
  if (String(x.ivaConcepto ?? '').trim() === tipoIva && totalBien && textoBien) return { que: 'ya_bien' }
  return { que: 'corregir', texto, tipoIva, baseCent, cuerpo: { ...x, ivaConcepto: tipoIva, total: r2(baseCent / 100), textoIncidencia: textoRtf(texto) } }
}

/** Después del PUT, si lo leído otra vez de Cegid tiene ya los tres campos; si no, qué falta. */
export function faltaTrasCorregir(x: Record<string, unknown>, c: { tipoIva: string; baseCent: number }): string | null {
  const falta: string[] = []
  if (!(typeof x.textoIncidencia === 'string' && x.textoIncidencia.trim() !== '')) falta.push('la descripción')
  if (String(x.ivaConcepto ?? '').trim() !== c.tipoIva) falta.push('el tipo de IVA')
  if (x.total == null || Math.round(Number(x.total) * 100) !== c.baseCent) falta.push('el total igual a la base')
  return falta.length ? `Cegid no ha guardado ${falta.join(', ')}` : null
}
