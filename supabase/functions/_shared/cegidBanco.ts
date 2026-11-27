// supabase/functions/_shared/cegidBanco.ts
//
// Q10 · respuesta 7 (27/11) · LO COBRADO POR EL BANCO Y CON TARJETA, A CEGID. Regla de Julio: en noviembre se factura
// todo lo cobrado, por cualquier vía, en una sola factura por cliente, y nada se genera en Cegid hasta que el cuadre dé
// 0 €. Puro (sin red ni base): lo usan la pantalla («Facturas del mes») y el servidor (conta-cegid-mandar, que vuelve a
// comprobarlo todo, con las facturas de Cegid leídas en ese momento, antes de escribir).
//
// LAS REGLAS (Julio, 27/11):
//   1. Lo que paga un recibo de un mes que ya está facturado en Cegid (para ese cliente) no sale nunca: es el cobro de
//      una factura que ya existe.
//   2. Lo que paga un recibo de un mes sin factura va en la de noviembre, con el mes en la descripción («Cuota agosto
//      2026»).
//   3. El recargo es lo que pagó de verdad (lo cobrado menos sus recibos), como 0018 con el IVA incluido.
//   4. Lo que no paga ningún recibo (transferencias sueltas, traspasos, la DEH, los «por confirmar») lo decide Julio en
//      la pantalla: «Paga una factura que ya existe», «Facturar con este concepto» o «No es un cobro». Con tarjeta, los
//      pagos que ató K (conta_banco_cobro_tarjeta) a un cliente con código: Julio elige el concepto. Los ya facturados
//      («factura_final» en el CRM) pagan una factura que ya existe.
// El cuadre: lo cobrado en el mes por cada vía = lo mandado + lo que paga facturas que ya existen + lo que no es cobro.

import { baseDelCobro, COBRADO_GC, conceptoAprobado, conceptoDeCodigo, CONCEPTOS_CEGID, palabrasNombre, type CobroParaMandar, type LineaIncidencia } from './cegidMandar.ts'

/**
 * Respuesta 8 (Julio, 27/11) · Las vías del banco que no son cobros de un cliente: «otra» (Uber, Decathlon, descuentos,
 * la DEH…: devoluciones y abonos de tarjeta). No salen en la lista de Julio ni cuentan en el cuadre de facturación.
 */
export const VIAS_QUE_NO_SON_COBRO: readonly string[] = ['otra']
export const esCobroDeCliente = (via: string) => !VIAS_QUE_NO_SON_COBRO.includes(via)

export interface ReciboBanco { gcId: string; importe: number; fecha: string; texto: string | null; elegido: string | null }
export type QueDecide = 'paga_factura' | 'facturar' | 'no_es_cobro'
export interface DecisionBanco { decision: QueDecide; concepto: string | null; cliente: number | null; texto: string | null; quien: string | null; at: string | null
  /** La factura de Cegid que paga («1/2745»), si se sabe. */
  factura?: string | null }
export interface CobroBanco {
  /** «mov:<movimiento>» (banco) o «tpv:<cuándo>|<importe>» (un pago con tarjeta). */
  clave: string
  tipo: 'banco' | 'tarjeta'
  movementId: string | null
  /** AAAA-MM-DD */
  fecha: string
  importe: number
  /** La vía del banco (transferencia, traspaso, otra) o «tarjeta». */
  via: string
  /** El estado de conta_banco_cobro o de conta_banco_cobro_tarjeta. */
  estado: string
  /** Lo que dice el banco (o el porqué de K, en un pago con tarjeta). */
  texto: string | null
  /** El código de Cegid de su ficha (null: sin ficha o sin código). */
  codigo: number | null
  recibos: ReciboBanco[]
  /** Tarjeta: la etapa del CRM y lo que falta para facturarlo. */
  etapa?: string | null
  falta?: string | null
  decision: DecisionBanco | null
}
export type EstadoBanco = 'listo' | 'ya_mandado' | 'paga_factura' | 'no_es_cobro' | 'para_julio' | 'espera' | 'parar'
export interface LineaBanco extends LineaIncidencia { clave: string; parte: 'recibo' | 'recargo' | 'decision'; reciboGcId: string | null }
export interface PlanCobro {
  cobro: CobroBanco
  estado: EstadoBanco
  cliente: number | null
  lineas: LineaBanco[]
  porque: string
  /** Lo que paga facturas que ya existen (recibos de meses facturados, o todo) y lo que no es cobro, en céntimos. */
  pagaFacturaCent: number
  noCobroCent: number
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2026-08» → «agosto 2026». */
export const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`
const eur = (c: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(c / 100)} €`
const cent = (n: number) => Math.round(n * 100)
/** La clave de un pago con tarjeta: su momento (ISO, en UTC, sin milisegundos) y su importe. */
export const claveTarjeta = (pagadoEn: string, importe: number) => `tpv:${new Date(pagadoEn).toISOString().replace('.000Z', 'Z')}|${Number(importe).toFixed(2)}`

/**
 * El plan de un cobro del banco o de tarjeta: qué incidencias lleva, o por qué no sale. `facturado(cliente, mes)` dice
 * si ese cliente tiene factura en Cegid de ese mes (AAAA-MM); `vivas`, las claves ya mandadas (conta_cegid_incidencia
 * mandando, mandada o facturada).
 */
export function planCobro(mes: string, c: CobroBanco, facturado: (cliente: number, mes: string) => boolean, vivas: ReadonlySet<string>): PlanCobro {
  const total = cent(c.importe)
  const base = { cobro: c, cliente: c.codigo, lineas: [] as LineaBanco[], pagaFacturaCent: 0, noCobroCent: 0 }
  const parar = (porque: string): PlanCobro => ({ ...base, estado: 'parar', porque })
  const linea = (clave: string, parte: LineaBanco['parte'], reciboGcId: string | null, codigo: string, texto: string, totalCent: number): LineaBanco | string => {
    const concepto = conceptoDeCodigo(codigo)
    if (!concepto) return `el concepto ${codigo} no es un código de Cegid`
    const b = baseDelCobro(totalCent)
    if (b === null) return `ninguna base al 21 % da ${eur(totalCent)}`
    return { clave, parte, reciboGcId, gcId: clave, concepto, texto: texto.replace(/\s+/g, ' ').trim(), fecha: c.fecha, baseCent: b, totalCent }
  }
  const cerrar = (lineas: LineaBanco[], cliente: number | null, extra: Partial<PlanCobro> = {}, porque = ''): PlanCobro => {
    const quedan = lineas.filter((l) => !vivas.has(l.clave))
    if (lineas.length && !quedan.length) return { ...base, ...extra, cliente, lineas, estado: 'ya_mandado', porque: 'Ya está mandado a Cegid.' }
    return { ...base, ...extra, cliente, lineas: quedan, estado: 'listo', porque: porque || (quedan.length < lineas.length ? `Falta mandar ${quedan.length} de ${lineas.length} líneas.` : '') }
  }

  // Lo que decidió Julio manda sobre todo lo demás.
  const d = c.decision
  if (d) {
    const quien = d.quien ? ` (${d.quien}${d.at ? `, ${d.at.slice(8, 10)}/${d.at.slice(5, 7)}` : ''})` : ''
    // Respuesta 9 · El cliente que dice la decisión (QBO: «es el 718, no el 1014») manda sobre el de la ficha.
    if (d.decision === 'paga_factura') return { ...base, cliente: d.cliente ?? c.codigo, estado: 'paga_factura', porque: `${d.factura ? `Paga la factura ${d.factura}, que ya existe` : 'Paga una factura que ya existe'}${quien}.`, pagaFacturaCent: total }
    if (d.decision === 'no_es_cobro') return { ...base, estado: 'no_es_cobro', porque: `No es un cobro${quien}.`, noCobroCent: total }
    if (!d.cliente || !d.concepto) return parar('La decisión de facturar no tiene cliente o concepto.')
    const l = linea(c.clave, 'decision', null, d.concepto, d.texto || conceptoDeCodigo(d.concepto)?.nombre || d.concepto, total)
    if (typeof l === 'string') return parar(`No se puede facturar: ${l}.`)
    return cerrar([l], d.cliente, {}, `Se factura con el concepto ${l.concepto.codigo}${quien}.`)
  }

  if (c.tipo === 'tarjeta') {
    if (c.etapa === 'factura_final') return { ...base, estado: 'paga_factura', porque: 'Ya facturado en Cegid (el CRM lo da por facturado): paga una factura que ya existe.', pagaFacturaCent: total }
    if (c.estado !== 'casado') return { ...base, estado: 'espera', porque: `Aún no está atado a su cliente: ${c.texto ?? 'lo ata K'}.` }
    if (c.falta) return { ...base, estado: 'espera', porque: `Falta algo para facturarlo: ${c.falta}.` }
    if (c.codigo === null) return { ...base, estado: 'espera', porque: 'Su ficha aún no tiene código de Cegid.' }
    return { ...base, estado: 'para_julio', porque: 'Pagado con tarjeta: elige con qué concepto se factura.' }
  }

  if (c.estado !== 'casado') return { ...base, estado: 'para_julio', porque: 'Su cliente está por confirmar: decide qué es.' }
  if (!c.recibos.length) return { ...base, estado: 'para_julio', porque: 'No paga ningún recibo: decide qué es.' }
  if (c.codigo === null) return parar('Su ficha no tiene código de Cegid.')
  const lineas: LineaBanco[] = []
  const facturados: string[] = []
  let pagaFacturaCent = 0
  for (const r of [...c.recibos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))) {
    const m = r.fecha.slice(0, 7)
    if (facturado(c.codigo, m)) { facturados.push(nombreMes(m)); pagaFacturaCent += cent(r.importe); continue }
    const concepto = r.elegido ? conceptoDeCodigo(r.elegido) : conceptoAprobado(r.texto)
    if (!concepto) return parar(`El recibo de ${nombreMes(m)} es de una cuota fuera de la tabla aprobada («${r.texto ?? 'sin texto'}»): elige su concepto en «Facturas del mes».`)
    const texto = `${r.texto ?? concepto.nombre}${m < mes ? ` · Cuota ${nombreMes(m)}` : ''}`
    const l = linea(r.gcId, 'recibo', r.gcId, concepto.codigo, texto, cent(r.importe))
    if (typeof l === 'string') return parar(`El recibo de ${nombreMes(m)}: ${l}.`)
    lineas.push(l)
  }
  const recargoCent = total - c.recibos.reduce((t, r) => t + cent(r.importe), 0)
  if (recargoCent < 0) return parar(`Cobró ${eur(total)} y sus recibos suman más: míralo.`)
  const yaFacturado = facturados.length ? `Los recibos de ${[...new Set(facturados)].join(', ')} ya están facturados en Cegid: no salen (regla 1).` : ''
  if (!lineas.length) return { ...base, estado: 'paga_factura', porque: `${yaFacturado} Paga una factura que ya existe${recargoCent ? `, con su recargo de ${eur(recargoCent)}` : ''}.`.trim(), pagaFacturaCent: total }
  if (recargoCent > 0) {
    const l = linea(`${c.clave}:recargo`, 'recargo', null, '0018', CONCEPTOS_CEGID['0018'].nombre, recargoCent)
    if (typeof l === 'string') return parar(`El recargo: ${l}.`)
    lineas.push(l)
  }
  return cerrar(lineas, c.codigo, { pagaFacturaCent }, yaFacturado)
}

// ── Respuesta 7 · ¿Paga una factura que ya existe? El cruce con las facturas de Cegid ─────────────

/** Una factura de Cegid (lo leído: conta_cegid_factura), con el nombre de su cliente. */
export interface FacturaParaCruce { ejercicio: number; serie: string; codigo: number; cliente: number | null; total: number | null; nombre: string | null }
export interface PropuestaFactura { factura: string; cliente: number | null; totalCent: number; por: 'numero' | 'cliente' | 'nombre' | 'importe'; frase: string }
const POR: Record<PropuestaFactura['por'], string> = { numero: 'por su número en el concepto', cliente: 'por importe y por su cliente', nombre: 'por importe y por el nombre del que paga', importe: 'solo por importe: el concepto no dice quién paga' }

/**
 * Julio, 27/11: antes de que decida, cada cobro del banco sin recibo se cruza con las facturas de Cegid, por importe y por
 * el nombre del que paga; lo que encaja con UNA sola factura sale propuesto como «Paga una factura que ya existe», con su
 * número. En orden: el número de factura que trae el concepto («FRA-2026/1/274…», que el banco corta), el cliente de su
 * ficha, el nombre del que paga (dos palabras en común) y, si el concepto no trae ningún nombre, solo el importe. La API
 * de Cegid no dice si una factura está cobrada: es una propuesta, y la confirma Julio con el botón.
 */
export function proponerFactura(c: CobroBanco, facturas: readonly FacturaParaCruce[]): PropuestaFactura | null {
  if (c.tipo !== 'banco' || c.recibos.length) return null
  const t = cent(c.importe)
  const mismas = facturas.filter((f) => f.total != null && cent(f.total) === t)
  const una = (xs: readonly FacturaParaCruce[], por: PropuestaFactura['por']): PropuestaFactura | null => {
    if (xs.length !== 1) return null
    const f = xs[0], n = `${f.serie}/${f.codigo}`
    return { factura: n, cliente: f.cliente, totalCent: t, por, frase: `Propuesta: paga la factura ${n}${f.cliente != null ? ` del cliente ${f.cliente}` : ''}, de ${eur(t)} (${POR[por]}).` }
  }
  const ref = /FRA[\s.-]*(\d{4})\s*\/\s*([0-9A-Z]{1,5})\s*\/\s*(\d+)/i.exec(c.texto ?? '')
  if (ref) {
    const r = una(mismas.filter((f) => f.ejercicio === Number(ref[1]) && f.serie.toUpperCase() === ref[2].toUpperCase() && String(f.codigo).startsWith(ref[3])), 'numero')
    if (r) return r
  }
  if (c.codigo != null) { const r = una(mismas.filter((f) => f.cliente === c.codigo), 'cliente'); if (r) return r }
  const suyas = new Set(palabrasNombre((c.texto ?? '').replace(/^(TRANSFER INMEDIATA|TRANSF\. A SU FAVOR|TRASPASO)\b/i, '').replace(/\d+-/g, ' ')))
  for (const w of ['TRANSFER', 'INMEDIATA', 'TRANSF', 'FAVOR', 'TRASPASO', 'PAGO', 'PGO', 'MES', 'FRA']) suyas.delete(w)
  const conNombre = mismas.filter((f) => palabrasNombre(f.nombre).filter((w) => suyas.has(w)).length >= 2)
  { const r = una(conNombre, 'nombre'); if (r) return r }
  if (!/\p{L}{3,}/u.test([...suyas].join(' ')) || (c.via === 'traspaso' && !conNombre.length)) return una(mismas, 'importe')
  return null
}

// ── El cuadre por vía y cliente a cliente ─────────────────────────────────────

/** Lo mandado a Cegid (conta_cegid_incidencia viva): su clave (gc_cobro_id), su cliente y lo cobrado que lleva. */
export interface MandadaVia { clave: string; cliente: number; totalCent: number }
export interface FilaVia { via: string; cobradoCent: number; mandadoCent: number; pagaFacturaCent: number; noCobroCent: number; diferenciaCent: number }
export interface FilaClienteCuadre { cliente: number; cobradoCent: number; mandadoCent: number; pagaFacturaCent: number; diferenciaCent: number }
export interface CuadreVias { vias: FilaVia[]; total: FilaVia; clientes: FilaClienteCuadre[]; sinCliente: { clave: string; cent: number; porque: string }[]; cuadra: boolean; frase: string }

/**
 * El cuadre del mes: por cada vía, lo cobrado contra lo mandado + lo que paga facturas que ya existen + lo que no es
 * cobro; y cliente a cliente. `gc`, los cobros de GoCardless del mes; `planes`, los del banco y la tarjeta (los abonos
 * del TPV no cuentan: cuentan sus pagos, los que ya tienen abono); `mandadas`, lo vivo en Cegid.
 */
export function cuadreVias(mes: string, gc: readonly CobroParaMandar[], planes: readonly PlanCobro[], mandadas: readonly MandadaVia[]): CuadreVias {
  const viva = new Map(mandadas.map((m) => [m.clave, m]))
  const porCliente = new Map<number, FilaClienteCuadre>()
  const cli = (n: number) => { const x = porCliente.get(n) ?? { cliente: n, cobradoCent: 0, mandadoCent: 0, pagaFacturaCent: 0, diferenciaCent: 0 }; porCliente.set(n, x); return x }
  const sinCliente: CuadreVias['sinCliente'] = []
  const filas = new Map<string, FilaVia>()
  const via = (v: string) => { const x = filas.get(v) ?? { via: v, cobradoCent: 0, mandadoCent: 0, pagaFacturaCent: 0, noCobroCent: 0, diferenciaCent: 0 }; filas.set(v, x); return x }

  for (const c of gc) {
    if (c.fecha.slice(0, 7) !== mes || !(COBRADO_GC as readonly string[]).includes(c.estado)) continue
    const t = cent(c.importe), m = viva.get(c.gcId)
    const f = via('GoCardless'); f.cobradoCent += t
    if (m) f.mandadoCent += m.totalCent
    const n = m?.cliente ?? c.codigoCegid
    if (n != null) { const k = cli(n); k.cobradoCent += t; if (m) k.mandadoCent += m.totalCent }
    else sinCliente.push({ clave: c.gcId, cent: t, porque: 'Cobro de GoCardless sin cliente de Cegid.' })
  }
  for (const p of planes) {
    const c = p.cobro
    if (c.fecha.slice(0, 7) !== mes || (c.tipo === 'tarjeta' && !c.movementId) || !esCobroDeCliente(c.via)) continue
    const t = cent(c.importe)
    const claves = new Set([c.clave, `${c.clave}:recargo`, ...c.recibos.map((r) => r.gcId)])
    const mandado = [...claves].reduce((s, k) => s + (viva.get(k)?.totalCent ?? 0), 0)
    const f = via(c.tipo === 'tarjeta' ? 'Tarjeta' : 'Banco')
    f.cobradoCent += t; f.mandadoCent += mandado; f.pagaFacturaCent += p.pagaFacturaCent; f.noCobroCent += p.noCobroCent
    if (p.noCobroCent) continue
    const n = p.cliente ?? [...claves].map((k) => viva.get(k)?.cliente).find((x) => x != null) ?? null
    if (n != null) { const k = cli(n); k.cobradoCent += t; k.mandadoCent += mandado; k.pagaFacturaCent += p.pagaFacturaCent }
    else sinCliente.push({ clave: c.clave, cent: t - mandado - p.pagaFacturaCent, porque: p.porque || 'Sin cliente.' })
  }
  const vias = ['GoCardless', 'Banco', 'Tarjeta'].filter((v) => filas.has(v)).map((v) => filas.get(v)!)
  for (const f of vias) f.diferenciaCent = f.cobradoCent - f.mandadoCent - f.pagaFacturaCent - f.noCobroCent
  const total = vias.reduce<FilaVia>((t, f) => ({ via: 'Total', cobradoCent: t.cobradoCent + f.cobradoCent, mandadoCent: t.mandadoCent + f.mandadoCent,
    pagaFacturaCent: t.pagaFacturaCent + f.pagaFacturaCent, noCobroCent: t.noCobroCent + f.noCobroCent, diferenciaCent: t.diferenciaCent + f.diferenciaCent }),
  { via: 'Total', cobradoCent: 0, mandadoCent: 0, pagaFacturaCent: 0, noCobroCent: 0, diferenciaCent: 0 })
  const clientes = [...porCliente.values()].map((k) => ({ ...k, diferenciaCent: k.cobradoCent - k.mandadoCent - k.pagaFacturaCent }))
    .filter((k) => k.diferenciaCent !== 0).sort((a, b) => a.cliente - b.cliente)
  const cuadra = total.diferenciaCent === 0 && !clientes.length && sinCliente.every((x) => x.cent === 0)
  const frase = `Cobrado en ${nombreMes(mes)}: ${eur(total.cobradoCent)}. Mandado a Cegid ${eur(total.mandadoCent)}, paga facturas que ya existen ${eur(total.pagaFacturaCent)}, `
    + `no es cobro ${eur(total.noCobroCent)}. ` + (cuadra ? 'Cuadra: 0,00 € de diferencia, cliente a cliente.' : `Diferencia: ${eur(total.diferenciaCent)}${clientes.length ? ` (${clientes.length} ${clientes.length === 1 ? 'cliente' : 'clientes'} con diferencia)` : ''}. Hasta que dé 0,00 €, no se genera nada en Cegid.`)
  return { vias, total, clientes, sinCliente: sinCliente.filter((x) => x.cent !== 0), cuadra, frase }
}
