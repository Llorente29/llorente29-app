// src/modules/conta/gestoria/r21/armar.ts
//
// R21 · «Facturar el mes» · de lo que ya calcula «Facturas del mes» (Q10) a lo que pinta el asistente. Puro. No hay motor
// nuevo: los cobros que salen o no (planMandar), el plan de cada cobro del banco y de la tarjeta (planCobro), la factura
// que paga (proponerFactura), el cuadre por vía (cuadreVias) y los clientes sin código de Cegid (codigosCegid y
// proponerAtado) son los de main. Aquí se ordenan en casos del paso 2, cada uno con sus botones; cada botón escribe donde
// escribe hoy «Facturas del mes» (atarFichaCegid, decidirBancoCegid, elegirConceptoCegid).
// Lo prueba tests/unit/modules/conta/r21/armar.test.ts.

import { CONCEPTOS_CEGID, proponerConcepto, tipoNif, type NoSale, type PlanMandar, type PropuestaAtado } from '../../../../../supabase/functions/_shared/cegidMandar'
import { COBRADO_GC } from '../../../../../supabase/functions/_shared/cegidMandar'
import { esCobroDeCliente, proponerFactura, type FacturaParaCruce, type PlanCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import { euros, mesLargo, type CasoEntrada, type PiezaDiferencia, type TipoCaso } from '../../../../../supabase/functions/_shared/factura/facturarMes'

/** Lo que hace un botón de un caso (lo ejecuta la página con los servicios de hoy). */
export type Efecto =
  | { que: 'atar'; partyId: string; codigo: number; como: 'correo' | 'nombre' | 'a_mano' }
  | { que: 'atar_a_mano'; partyId: string }
  | { que: 'paga_factura'; clave: string; cliente: number | null; factura: string }
  | { que: 'facturar'; clave: string; cliente: number; concepto: string }
  | { que: 'facturar_a_mano'; clave: string; cliente: number | null; concepto: string | null }
  | { que: 'concepto'; elegir: { que: 'cobro' | 'suscripcion'; gcId: string }; concepto: string }
  | { que: 'concepto_a_mano'; elegir: { que: 'cobro' | 'suscripcion'; gcId: string } }
  | { que: 'dejar'; motivo: string }
  | { que: 'releer' }

export interface Accion { id: string; texto: string; principal: boolean; efecto: Efecto }
export interface CasoConBotones extends CasoEntrada { acciones: Accion[] }

const dia = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const VIA: Record<string, string> = { transferencia: 'por transferencia', traspaso: 'por traspaso', bizum: 'por Bizum', cajero: 'en el cajero', tarjeta: 'con tarjeta', otra: '' }
const DEJAR = (motivo: string): Accion => ({ id: 'dejar', texto: 'Dejar para después', principal: false, efecto: { que: 'dejar', motivo } })

export interface SinCodigoQ10 { partyId: string; nombre: string; nif: string | null; porque: string; propuestas: PropuestaAtado[] }

export interface EntradaArmar {
  mes: string
  /** El plan de GoCardless (planMandar) y, por cobro, su ficha y cuánto. */
  plan: PlanMandar
  cobrosGc: readonly { gcId: string; partyId: string | null; nombre: string | null; importe: number; fecha: string; estado: string }[]
  /** Las fichas con cobro y sin código de Cegid, con lo que se propone (codigosCegid + proponerAtado, como en «Facturas del mes»). */
  sinCodigo: readonly SinCodigoQ10[]
  /** Las fichas sin NIF con cobro del mes (facturasDelMes · pendientes «sin_nif»). */
  sinNif: readonly { gcId: string; partyId: string; nombre: string; importe: number; fecha: string }[]
  /** Los clientes de Cegid a los que se manda algo (por código), con su NIF tal como está en Cegid. */
  clientesCegid: readonly { codigo: number; nombre: string | null; nif: string | null }[]
  /** El plan de cada cobro del banco y de la tarjeta (planCobro), y las facturas de Cegid para proponer cuál paga. */
  planesBanco: readonly PlanCobro[]
  facturasCegid: readonly FacturaParaCruce[]
  /** R21c · El nombre que tiene en GoCardless cada cobro (por gcId), para el cobro sin ficha. */
  nombresGc?: ReadonlyMap<string, string>
}

// ── R21c · Lo que se le enseña a QBO: nombres, no números; el concepto del que paga, no el texto del banco en bruto ──

/** Palabras que el banco escribe con «**» en lugar de la tilde. */
const CON_TILDE = ['gestoría', 'autónomo', 'autónoma', 'préstamo', 'económico', 'económica', 'regularización', 'constitución', 'devolución', 'cotización',
  'liquidación', 'declaración', 'facturación', 'renovación', 'anotación', 'inscripción', 'tramitación', 'gestión', 'asesoría', 'nómina', 'nóminas',
  'trámite', 'trámites', 'jurídico', 'jurídica', 'según', 'también', 'más', 'compañía', 'día']
const TILDES: [RegExp, string][] = CON_TILDE.map((w) => [new RegExp(w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('').map((ch, i) => {
  const orig = w[i]
  return orig !== ch ? '\\*\\*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}).join(''), 'gi'), w])

/** Devuelve las tildes que el banco cambió por «**». Lo que no está en la lista se deja sin los asteriscos. */
export function arreglarTildes(t: string): string {
  let r = t
  for (const [re, w] of TILDES) r = r.replace(re, (m) => (m[0] === m[0].toUpperCase() && m[1] && m[1] === m[1].toUpperCase() ? w.toUpperCase() : m[0] === m[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w))
  return r.replace(/\*\*/g, '')
}

const BIC = /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/
/** Del texto del banco, solo lo que escribió el que paga («baja autónomo»). Si no escribió nada, null. Con tarjeta, el texto es de Sumied (técnico): null. */
export function conceptoDelBanco(texto: string | null, via: string): string | null {
  if (!texto) return null
  if (via === 'tarjeta') return null
  const partes = texto.split(', ').map((x) => x.trim())
  if (partes.length < 2) return arreglarTildes(texto).trim() || null
  const nombre = partes.slice(1, -1).find((x) => /[a-zA-Z]/.test(x) && !/^\d/.test(x)) ?? ''
  const ultima = partes[partes.length - 1]
  if (!ultima || /ORIGEN:/i.test(ultima) || BIC.test(ultima) || /^[\d\s-]+$/.test(ultima)) return null
  const n = nombre.toLowerCase(), u = ultima.toLowerCase()
  if (partes.length > 2 && n && (u === n || u.startsWith(n) || n.startsWith(u))) return null
  const limpio = arreglarTildes(ultima).replace(/\s+/g, ' ').trim()
  return limpio || null
}

/** «Nombre (código)» con el nombre de su cliente de Cegid; si no hay nombre, «El cliente 122». */
export function quienEs(codigo: number | null, nombres: ReadonlyMap<number, string | null>): string | null {
  if (codigo == null) return null
  const n = nombres.get(codigo)
  return n ? `${n} (${codigo})` : `El cliente ${codigo}`
}

// ── R21c · Qué es cada euro del cuadre ───────────────────────────────────────────────────────────────────────────

export interface EntradaDiferencia {
  mes: string
  gc: readonly { gcId: string; estado: string; fecha: string; importe: number; nombre: string | null; codigoCegid: number | null; partyId: string | null }[]
  planes: readonly PlanCobro[]
  /** Lo vivo en Cegid, por clave (gcId, «mov:…», «tpv:…», «…:recargo»). */
  mandadas: ReadonlyMap<string, number>
  /** Lo listo para mandar en la serie 1 (aún no mandado): los gcId. */
  porMandarGc: ReadonlySet<string>
  /** Lo listo para la serie 3 (Contasimple), por gcId: se manda después de la serie 1. */
  serie3: ReadonlyMap<string, number>
  /** Las claves de los pendientes del mes (casos dejados o fuera de lo mandado). */
  pendientes: readonly { clave: string }[]
  nombresGc?: ReadonlyMap<string, string>
  nombresCegid: ReadonlyMap<number, string | null>
}

/**
 * Cada cobro del mes, en una sola fila del cuadre: mandado, paga una factura, serie 3, pendiente o sin explicar. Usa los
 * mismos cobros que cuadreVias (los de GoCardless cobrados y los del banco y la tarjeta con abono), así que
 * cobrado − mandado − paga facturas − serie 3 − pendientes = la suma de lo sin explicar.
 */
export function explicarDiferencia(e: EntradaDiferencia): { despuesCent: number; pendientesCent: number; sinExplicar: PiezaDiferencia[] } {
  const claves = new Set(e.pendientes.map((p) => p.clave))
  const fichas = new Set([...claves].filter((k) => k.startsWith('ficha:')).map((k) => k.replace(/^ficha:(nif:)?/, '')))
  const cegid = new Set([...claves].filter((k) => k.startsWith('cegid:')).map((k) => Number(k.slice(6))))
  let despuesCent = 0, pendientesCent = 0
  const sinExplicar: PiezaDiferencia[] = []
  for (const c of e.gc) {
    if (c.fecha.slice(0, 7) !== e.mes || !(COBRADO_GC as readonly string[]).includes(c.estado)) continue
    const t = Math.round(c.importe * 100)
    const m = e.mandadas.get(c.gcId)
    const nombre = c.nombre ?? e.nombresGc?.get(c.gcId) ?? quienEs(c.codigoCegid, e.nombresCegid) ?? 'Un cobro de GoCardless'
    if (m != null) { if (m !== t) sinExplicar.push({ clave: c.gcId, texto: `${nombre}: lo mandado a Cegid no es lo cobrado por GoCardless`, cent: t - m }); continue }
    if (e.porMandarGc.has(c.gcId)) continue
    if (e.serie3.has(c.gcId)) { despuesCent += t; continue }
    if (claves.has(`gc:${c.gcId}`) || (c.partyId && fichas.has(c.partyId)) || (c.codigoCegid != null && cegid.has(c.codigoCegid))) { pendientesCent += t; continue }
    sinExplicar.push({ clave: c.gcId, texto: `${nombre}, GoCardless del ${dia(c.fecha)}`, cent: t })
  }
  for (const p of e.planes) {
    const c = p.cobro
    if (c.fecha.slice(0, 7) !== e.mes || (c.tipo === 'tarjeta' && !c.movementId) || !esCobroDeCliente(c.via)) continue
    if (p.noCobroCent) continue
    const t = Math.round(c.importe * 100)
    const ks = new Set([c.clave, `${c.clave}:recargo`, ...c.recibos.map((r) => r.gcId)])
    const mandado = [...ks].reduce((s, k) => s + (e.mandadas.get(k) ?? 0), 0)
    const resto = t - mandado - p.pagaFacturaCent
    if (resto === 0) continue
    if (p.estado === 'listo' && mandado === 0) continue
    if (claves.has(c.clave)) { pendientesCent += resto; continue }
    const quien = quienEs(p.cliente ?? c.codigo, e.nombresCegid) ?? 'Sin cliente'
    sinExplicar.push({ clave: c.clave, texto: `${quien}, ${c.tipo === 'tarjeta' ? 'tarjeta' : 'banco'} del ${dia(c.fecha)}`, cent: resto })
  }
  return { despuesCent, pendientesCent, sinExplicar }
}

/** Los casos que Sumied no puede decidir solo, con sus botones. Lo decidido (en «Facturas del mes» o aquí) ya no llega. */
export function armarCasos(e: EntradaArmar): CasoConBotones[] {
  const casos: CasoConBotones[] = []
  const nombresCegid = new Map(e.clientesCegid.map((c) => [c.codigo, c.nombre]))
  const cobrosDe = new Map<string, { cent: number; fecha: string }>()
  for (const c of e.cobrosGc) {
    if (!c.partyId || c.fecha.slice(0, 7) !== e.mes || !['confirmed', 'paid_out'].includes(c.estado)) continue
    const x = cobrosDe.get(c.partyId) ?? { cent: 0, fecha: c.fecha }
    x.cent += Math.round(c.importe * 100); if (c.fecha < x.fecha) x.fecha = c.fecha
    cobrosDe.set(c.partyId, x)
  }

  // Cliente sin unir a Cegid: la ficha cobra por GoCardless y no tiene código de cliente de Cegid.
  for (const f of e.sinCodigo) {
    const de = cobrosDe.get(f.partyId)
    if (!de) continue
    const p = f.propuestas[0] ?? null
    casos.push({ clave: `ficha:${f.partyId}`, tipo: 'sin_unir_cegid', cliente: f.nombre, importeCent: de.cent, fecha: de.fecha,
      frase: `GoCardless cobró ${euros(de.cent)} a ${f.nombre}, que no está unido a ningún cliente de Cegid.`,
      propuesta: p ? `unirlo al cliente ${p.codigo} de Cegid, «${p.nombre ?? p.codigo}» (${p.por === 'correo' ? 'mismo correo' : 'mismo nombre'}).` : null,
      falta: p ? null : `${f.porque} Busca su cliente de Cegid; si no tiene, se pide a QBO que lo cree.`, decidido: false,
      acciones: [
        ...(p ? [{ id: 'atar', texto: `Sí, unir al ${p.codigo}`, principal: true, efecto: { que: 'atar' as const, partyId: f.partyId, codigo: p.codigo, como: p.por } }] : []),
        { id: 'otro', texto: p ? 'Es otro cliente' : 'Buscar el cliente', principal: !p, efecto: { que: 'atar_a_mano', partyId: f.partyId } },
        DEJAR(`${f.nombre}: sin unir a ningún cliente de Cegid.`),
      ] })
  }

  // Cliente sin datos: su ficha no tiene NIF; sin NIF no se puede facturar.
  const sinNif = new Map<string, { nombre: string; cent: number; fecha: string }>()
  for (const s of e.sinNif) {
    if (s.fecha.slice(0, 7) !== e.mes) continue
    const x = sinNif.get(s.partyId) ?? { nombre: s.nombre, cent: 0, fecha: s.fecha }
    x.cent += Math.round(s.importe * 100); sinNif.set(s.partyId, x)
  }
  for (const [partyId, x] of sinNif) {
    casos.push({ clave: `ficha:nif:${partyId}`, tipo: 'sin_datos', cliente: x.nombre, importeCent: x.cent, fecha: x.fecha,
      frase: `${x.nombre} pagó ${euros(x.cent)} y su ficha no tiene NIF.`, propuesta: null,
      falta: 'Sin NIF no se puede facturar. Se piden los datos a QBO y, mientras tanto, queda fuera.', decidido: false,
      acciones: [{ id: 'pedir', texto: 'Pedir los datos a QBO', principal: true, efecto: { que: 'dejar', motivo: `${x.nombre}: sin NIF. Pedidos los datos a QBO.` } }] })
  }

  // A la ficha de Cegid le falta un dato: de lo que Sumied ve de Cegid, solo el NIF (falta o no es válido).
  const aQuien = new Set(e.plan.vueltas['1'].listos.concat(e.plan.vueltas['3'].listos).map((k) => k.codigo))
  for (const c of e.clientesCegid) {
    if (!aQuien.has(c.codigo)) continue
    const t = tipoNif(c.nif)
    if (t && t.valido) continue
    const k = e.plan.vueltas['1'].listos.concat(e.plan.vueltas['3'].listos).find((x) => x.codigo === c.codigo)
    casos.push({ clave: `cegid:${c.codigo}`, tipo: 'falta_dato_cegid', cliente: c.nombre, importeCent: k?.totalCent ?? 0, fecha: `${e.mes}-01`,
      frase: `${c.nombre ?? `El cliente ${c.codigo}`} (${c.codigo}) ${c.nif ? `tiene en Cegid un NIF que no es válido (${c.nif})` : 'no tiene NIF en su ficha de Cegid'}.`,
      propuesta: null, falta: `Sin un NIF válido, Verifactu no deja emitir su factura de ${euros(k?.totalCent ?? 0)}. Sumied solo ve el NIF de la ficha de Cegid: la provincia, el periodo y la forma de pago no los ve.`, decidido: false,
      acciones: [
        { id: 'pedir', texto: 'Pedir el NIF a QBO', principal: true, efecto: { que: 'dejar', motivo: `${c.nombre ?? c.codigo} (${c.codigo}): sin NIF válido en Cegid. Pedido a QBO.` } },
        { id: 'puesto', texto: 'Ya lo he puesto en Cegid', principal: false, efecto: { que: 'releer' } },
      ] })
  }

  // Lo de GoCardless que no sale por otra razón (concepto, texto, cuota sin «Facturar hasta», no cuadra).
  for (const n of e.plan.noSalen) {
    if (n.porque === 'no_cobrado' || n.porque === 'ya_mandado' || n.porque === 'sin_codigo') continue
    casos.push(casoNoSale(e.mes, { ...n, nombre: n.nombre ?? e.nombresGc?.get(n.gcId) ?? null }, e.cobrosGc.find((c) => c.gcId === n.gcId)?.fecha ?? `${e.mes}-01`))
  }

  // Los cobros del banco y de la tarjeta que esperan a una persona.
  for (const p of e.planesBanco) {
    const c = p.cobro
    if (c.fecha.slice(0, 7) !== e.mes || c.decision) continue
    if (p.estado !== 'para_julio' && p.estado !== 'espera' && p.estado !== 'parar') continue
    const t = Math.round(c.importe * 100)
    const como = VIA[c.via] ?? ''
    const quien = quienEs(c.codigo, nombresCegid)
    const texto = conceptoDelBanco(c.texto, c.via)
    if (p.estado !== 'para_julio') {
      // R21g · Con tarjeta, el porqué técnico (cómo se intentó casar con la negociación) no se enseña: se dice en palabras.
      const tarjeta = c.via === 'tarjeta'
      const porque = tarjeta ? (c.codigo == null ? 'El TPV no dice de qué cliente es este pago. Si lo sabes, dilo; si no, se pregunta a QBO.' : 'Falta saber qué servicio paga.')
        : (p.porque || c.falta || 'Falta algo para facturarlo.')
      casos.push({ clave: c.clave, tipo: c.codigo == null ? 'no_se_sabe_quien' : 'paga_sin_recibo', cliente: quien, importeCent: t, fecha: c.fecha,
        frase: tarjeta ? `${quien ?? 'Alguien'} pagó ${euros(t)} con tarjeta el ${dia(c.fecha)}.` : `Entró un cobro de ${euros(t)} ${como} el ${dia(c.fecha)}${texto ? ` («${texto}»)` : ''}.`.replace('  ', ' '), propuesta: null,
        falta: porque, decidido: false, acciones: [DEJAR(`Cobro de ${euros(t)} del ${dia(c.fecha)}: ${porque}`)] })
      continue
    }
    const f = proponerFactura(c, e.facturasCegid)
    const anterior = f && esDeAntes(f.factura, e.facturasCegid, e.mes)
    if (f && anterior) {
      casos.push({ clave: c.clave, tipo: 'paga_factura_antes', cliente: quien, importeCent: t, fecha: c.fecha,
        frase: `${quien ?? 'Alguien'} pagó ${euros(t)} ${como} el ${dia(c.fecha)}.`.replace('  ', ' '),
        propuesta: `es el pago de su factura ${f.factura}${anterior.fecha ? ` del ${anterior.fecha}` : ''} (${euros(f.totalCent)}), hecha con el sistema de antes, que facturaba sin esperar al pago. No se factura otra vez.`,
        falta: null, decidido: false,
        acciones: [
          { id: 'si', texto: `Sí, paga la ${f.factura}`, principal: true, efecto: { que: 'paga_factura', clave: c.clave, cliente: f.cliente ?? c.codigo, factura: f.factura } },
          { id: 'no', texto: 'No, es otra cosa', principal: false, efecto: { que: 'dejar', motivo: `Cobro de ${euros(t)} del ${dia(c.fecha)}: no es el pago de la ${f.factura}. Para QBO.` } },
          DEJAR(`Cobro de ${euros(t)} del ${dia(c.fecha)}: ¿paga la factura ${f.factura}?`),
        ] })
      continue
    }
    if (c.codigo != null) {
      const con = proponerConcepto(c.texto)
      casos.push({ clave: c.clave, tipo: 'paga_sin_recibo', cliente: quien, importeCent: t, fecha: c.fecha,
        frase: `${quien} pagó ${euros(t)} ${como} el ${dia(c.fecha)}${texto ? ` («${texto}»)` : ''}.`.replace('  ', ' '),
        propuesta: `facturarle con el concepto ${con.codigo} ${con.nombre}, ${euros(t)} IVA incluido.`, falta: null, decidido: false,
        acciones: [
          { id: 'si', texto: 'Sí, facturar', principal: true, efecto: { que: 'facturar', clave: c.clave, cliente: c.codigo, concepto: con.codigo } },
          { id: 'otro', texto: 'Otro concepto', principal: false, efecto: { que: 'facturar_a_mano', clave: c.clave, cliente: c.codigo, concepto: null } },
          DEJAR(`Cobro de ${euros(t)} del ${dia(c.fecha)} de ${quien}: sin decidir qué se factura.`),
        ] })
      continue
    }
    casos.push({ clave: c.clave, tipo: 'no_se_sabe_quien', cliente: null, importeCent: t, fecha: c.fecha,
      frase: `Entró un cobro de ${euros(t)} ${como} el ${dia(c.fecha)}${texto ? ` con el texto «${texto}»` : ''}.`.replace('  ', ' '), propuesta: null,
      falta: 'El banco no dice quién lo manda. Busca el cliente si lo sabes; si no, se pregunta a QBO y queda fuera de la factura hasta que conteste.', decidido: false,
      acciones: [
        { id: 'buscar', texto: 'Buscar el cliente', principal: false, efecto: { que: 'facturar_a_mano', clave: c.clave, cliente: null, concepto: null } },
        { id: 'preguntar', texto: 'Preguntar a QBO', principal: true, efecto: { que: 'dejar', motivo: `Cobro de ${euros(t)} del ${dia(c.fecha)} sin saber quién paga. Preguntado a QBO.` } },
      ] })
  }
  return casos
}

/** La factura que paga es de un mes de antes (si no se sabe su fecha, se toma como de antes: el sistema de antes). */
function esDeAntes(factura: string, facturas: readonly FacturaParaCruce[], mes: string): { fecha: string | null } | null {
  const [serie, codigo] = factura.split('/')
  const f = facturas.find((x) => x.serie === serie && String(x.codigo) === codigo) as (FacturaParaCruce & { fecha?: number | null }) | undefined
  const n = f?.fecha ?? null
  if (n == null) return { fecha: null }
  const s = String(n)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}` < mes ? { fecha: `${s.slice(6, 8)}/${s.slice(4, 6)}` } : null
}

const TIPO_NO_SALE: Record<string, TipoCaso> = { sin_cliente: 'sin_unir_cegid', cuota_sin_hasta: 'falta_dato_cegid', sin_concepto: 'paga_sin_recibo', sin_texto: 'sin_datos', no_cuadra: 'paga_sin_recibo' }
function casoNoSale(mes: string, n: NoSale, fecha: string): CasoConBotones {
  const quien = n.nombre ?? 'un cliente sin nombre en GoCardless'
  const base: CasoConBotones = { clave: `gc:${n.gcId}`, tipo: TIPO_NO_SALE[n.porque] ?? 'sin_datos', cliente: n.nombre, importeCent: n.totalCent, fecha,
    frase: `GoCardless cobró ${euros(n.totalCent)} a ${quien} el ${dia(fecha)}${n.concepto ? ` («${n.concepto}»)` : ''}.`, propuesta: null, falta: n.frase, decidido: false,
    acciones: [DEJAR(`${quien}: ${n.frase}`)] }
  if (n.porque === 'sin_concepto' && n.propuesta && n.elegir) {
    return { ...base, propuesta: `facturarlo con el concepto ${n.propuesta.codigo} ${n.propuesta.nombre} de Cegid.`, falta: null,
      acciones: [
        { id: 'si', texto: `Sí, con el ${n.propuesta.codigo}`, principal: true, efecto: { que: 'concepto', elegir: n.elegir, concepto: n.propuesta.codigo } },
        { id: 'otro', texto: 'Otro concepto', principal: false, efecto: { que: 'concepto_a_mano', elegir: n.elegir } },
        DEJAR(`${quien}: sin concepto de Cegid.`),
      ] }
  }
  void mes
  return base
}

/** Los conceptos de Cegid para «Otro concepto» (los aprobados). */
export const CONCEPTOS = Object.values(CONCEPTOS_CEGID).filter((c, i, xs) => xs.findIndex((y) => y.codigo === c.codigo) === i).sort((a, b) => a.codigo.localeCompare(b.codigo))

/** Los meses del selector: desde noviembre de 2026 (el primero que factura Sumied) hasta el siguiente al de hoy. */
export function mesesDelSelector(hoy: string): { valor: string; texto: string }[] {
  const r: { valor: string; texto: string }[] = []
  let a = 2026, m = 11
  const [ha, hm] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))]
  const fin = Math.max(ha * 12 + hm + 1, 2026 * 12 + 12)
  while (a * 12 + m <= fin) {
    const v = `${a}-${String(m).padStart(2, '0')}`
    r.push({ valor: v, texto: mesLargo(v).replace(' de ', ' ') })
    m += 1; if (m === 13) { m = 1; a += 1 }
  }
  return r
}
