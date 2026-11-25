// src/modules/conta/gestoria/g04/asignar.ts
//
// G04 · Tarea 4 · «Cobros de GoCardless sin cliente» → «Asignar a un
// cliente» (Julio, 08/11): cada cliente de GoCardless con alguna suscripción
// activa que aún no está unido a un cliente de Sumied, con lo que cobra al mes
// y el cliente más probable (por NIF, después email y después nombre:
// lista.ts · proponerCliente). Solo propone: lo confirma una persona, con
// conta_gestoria_enlazar. Ordenados por lo que cobran al mes, de más a menos.
// Puro: lo prueba tests/unit/modules/conta/gestoria/g04/asignar.test.ts.

import { proponerCliente, type ClienteParaCasar, type Propuesta } from '../../../../../supabase/functions/_shared/tarifa/lista'
import type { DatosClientes, Fila } from './datos'
import { clave, normal } from '../decisionesQbo'

export interface PorAsignar {
  empresaId: string
  empresa: string
  gcClienteId: string
  nombre: string
  correo: string | null
  nif: string | null
  suscripciones: { nombre: string; alMesCent: number }[]
  alMesCent: number
  propuesta: Propuesta
  /** Q08 · Lo que escribió QBO en su Excel para este cliente (un nombre en vez del nº de ficha), con las fichas que encajan. */
  deQbo: DeQbo | null
  /** R19 · Lo que propuso la lectura de GoCardless (por correo o por nombre) y nadie ha confirmado aún. */
  propuestoPorSumied: boolean
  /** R19 · Sus mandatos (banco y últimos dígitos), para distinguirlo cuando el correo se repite. */
  mandatos: { banco: string | null; cuentaFinal: string | null; estado: string | null }[]
  /** R19 · El correo lo tienen también otros clientes de GoCardless, o varias fichas: se enseñan el banco y los dígitos. */
  correoRepetido: boolean
}

/** R19 · Los apuntados como «No tiene ficha: apuntar para QBO» (conta_gc_enlace en «sin_ficha»), para la lista que se da a QBO. */
export interface ApuntadoParaQbo {
  empresaId: string
  empresa: string
  gcClienteId: string
  nombre: string
  correo: string | null
  nif: string | null
  alMesCent: number
  quien: string | null
}

/**
 * Q08 · Las fichas que dice el texto de QBO. Primero, las que se llaman EXACTAMENTE
 * así (sin tildes, mayúsculas, espacios ni signos: «S.L.» = «SL»). Si no hay
 * ninguna, las que llevan todas sus palabras en el nombre, y se dice que no es
 * igual. Solo propone: nada se ata solo. Con varias o ninguna, se dice.
 */
export interface DeQbo { texto: string; como: 'igual' | 'contiene' | 'ninguna'; clienteIds: string[] }

const FORMAS = new Set(['sl', 'sll', 'slu', 'sa', 'cb', 'scp', 'sc', 'de', 'del', 'la', 'las', 'el', 'los', 'y'])

export function fichasDeQbo(texto: string, clientes: readonly ClienteParaCasar[]): DeQbo {
  const k = clave(texto)
  const iguales = k ? clientes.filter((c) => clave(c.nombre) === k).map((c) => c.id) : []
  if (iguales.length) return { texto, como: 'igual', clienteIds: iguales }
  const palabras = normal(texto).split(' ').filter((x) => x.length > 1 && !FORMAS.has(x))
  if (!palabras.length || palabras.length > 8) return { texto, como: 'ninguna', clienteIds: [] }
  const contienen = clientes.filter((c) => { const n = ` ${normal(c.nombre)} `; return palabras.every((x) => n.includes(` ${x} `)) }).map((c) => c.id)
  return contienen.length ? { texto, como: 'contiene', clienteIds: contienen } : { texto, como: 'ninguna', clienteIds: [] }
}

/** «QBO escribió «X»: …», en palabras de oficina. */
export function textoDeQbo(q: DeQbo, nombreDe: (id: string) => string): string {
  const dijo = `QBO escribió «${q.texto}»`
  if (q.como === 'ninguna') return `${dijo}: ninguna ficha de Bitrix24 se llama así. Búscala abajo o créala allí.`
  const n = q.clienteIds.length
  if (q.como === 'igual') return n === 1 ? `${dijo}: la ficha «${nombreDe(q.clienteIds[0])}» se llama así. Confírmala con un clic.` : `${dijo}: ${n} fichas se llaman así. Elige cuál.`
  return n === 1 ? `${dijo}: ninguna ficha se llama exactamente así; «${nombreDe(q.clienteIds[0])}» lleva ese nombre. Mira que sea ella antes de unir.`
    : `${dijo}: ninguna ficha se llama exactamente así; ${n} llevan ese nombre. Elige cuál.`
}

/** El texto que escribió QBO, sacado del porqué del pendiente («… escribió: «X».»). */
export function textoDelPendiente(porque: string | null | undefined): string | null {
  const m = /escribió: «([\s\S]*)»\.$/.exec(porque ?? '')
  const t = m?.[1]?.replace(/ \(la ficha nº \d+ no está en lo leído de Bitrix24\)$/, '').trim()
  return t || null
}

const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Los clientes de Sumied para casar (uno por cliente, con los correos de su ficha: los trae cada fila de la lista). */
export function clientesParaCasar(d: DatosClientes): ClienteParaCasar[] {
  const vistos = new Map<string, ClienteParaCasar>()
  for (const c of d.clientes) {
    const id = String(c.cliente_id)
    if (!vistos.has(id)) vistos.set(id, { id, nombre: String(c.cliente ?? ''), nif: texto(c.nif), correos: Array.isArray(c.correos) ? c.correos.map(String) : [] })
  }
  return [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Las suscripciones activas y los clientes de GoCardless que las pagan llegan en su propia llamada (conta_pantalla_asignar).
 * R19 (Julio, 25/11): salen TODAS las que GoCardless cobrará en el mes y no están ATADAS a una ficha (conta_gc_enlace en
 * «atado»), también las propuestas por correo sin confirmar: la misma forma de contar que la copia (próximo cobro dentro
 * del mes del próximo cobro, y su próximo importe). Las apuntadas «sin ficha» van aparte (apuntadosParaQbo).
 */
export function porAsignar(d: DatosClientes, suscripciones: readonly Fila[], gcClientes: readonly Fila[], empresas: readonly { id: string; nombre: string }[], elegidas: readonly string[],
  pendientesQbo: readonly Fila[] = []): PorAsignar[] {
  const deQbo = new Map<string, string>()
  for (const e of pendientesQbo) { const t = textoDelPendiente(texto(e.porque)); if (t) deQbo.set(`${String(e.company_id)}|${String(e.gc_cliente_id)}`, t) }
  const delGc = new Map(gcClientes.map((g) => [`${String(g.company_id)}|${String(g.gc_id)}`, g]))
  const enlace = (k: string) => (delGc.get(k)?.enlace ?? null) as Fila | null
  const correos = new Map<string, number>()
  for (const g of gcClientes) { const c = texto(g.correo)?.toLowerCase(); if (c) correos.set(c, (correos.get(c) ?? 0) + 1) }
  const grupos = new Map<string, PorAsignar>()
  const casar = clientesParaCasar(d)
  const existe = new Set(casar.map((c) => c.id))
  for (const s of cuentan(suscripciones)) {
    const empresaId = String(s.company_id)
    if (!elegidas.includes(empresaId) || !s.gc_cliente_id) continue
    const k = `${empresaId}|${String(s.gc_cliente_id)}`
    const e = enlace(k)
    if (e && (e.estado === 'atado' || e.estado === 'sin_ficha')) continue
    let g = grupos.get(k)
    if (!g) {
      const gc = delGc.get(k)
      const nombre = texto(gc?.nombre) ?? String(s.gc_cliente_id)
      const correo = texto(gc?.correo)
      const nif = texto(gc?.nif)
      // La propuesta de la lectura (propuesto por correo o por nombre, sin confirmar) manda sobre la de la pantalla.
      const candidatas = (Array.isArray(e?.candidatas) ? (e!.candidatas as unknown[]).map(String) : []).filter((id) => existe.has(id))
      const por: 'NIF' | 'email' | 'nombre' = e?.por === 'correo' ? 'email' : e?.por === 'nif' ? 'NIF' : 'nombre'
      const deLaLectura = e?.estado === 'propuesto' && candidatas.length > 0
      const propuesta: Propuesta = deLaLectura
        ? (candidatas.length === 1 ? { tipo: 'una', clienteId: candidatas[0], por } : { tipo: 'varias', clienteIds: candidatas, por })
        : proponerCliente({ nombre: texto(gc?.nombre), correo, nif }, casar)
      const mandatos = (Array.isArray(gc?.mandatos) ? (gc!.mandatos as Fila[]) : []).map((m) => ({ banco: texto(m.banco), cuentaFinal: texto(m.cuenta_final), estado: texto(m.estado) }))
      g = { empresaId, empresa: empresas.find((x) => x.id === empresaId)?.nombre ?? '', gcClienteId: String(s.gc_cliente_id), nombre, correo, nif, suscripciones: [], alMesCent: 0,
        propuesta, deQbo: deQbo.has(k) ? fichasDeQbo(deQbo.get(k)!, casar) : null, propuestoPorSumied: deLaLectura, mandatos,
        correoRepetido: (!!correo && (correos.get(correo.toLowerCase()) ?? 0) > 1) || (propuesta.tipo === 'varias' && propuesta.por === 'email') }
      grupos.set(k, g)
    }
    const al = cobraEnElMes(s)
    g.suscripciones.push({ nombre: String(s.nombre ?? 'Suscripción'), alMesCent: al })
    g.alMesCent += al
  }
  // Q08: los que QBO contestó en su Excel van primero (son los que hay que confirmar ahora).
  return [...grupos.values()].sort((a, b) => Number(!!b.deQbo) - Number(!!a.deQbo) || b.alMesCent - a.alMesCent || a.nombre.localeCompare(b.nombre, 'es'))
}

/** R19 · Las que cuentan: activas y con su próximo cobro en el mes que se cuenta (lo dice la base: cobra_en_el_mes). */
const cuentan = (xs: readonly Fila[]) => xs.filter((s) => s.estado === 'active' && (s.cobra_en_el_mes === undefined ? true : s.cobra_en_el_mes === true))
/** R19 · Lo que cobrará: su próximo importe (si no lo trae, lo de al mes). */
const cobraEnElMes = (s: Fila) => cent(s.proximo_cobro_importe ?? s.al_mes)

/** R19 · Los apuntados «sin ficha», para dárselos a QBO, con lo que GoCardless les cobrará en el mes. */
export function apuntadosParaQbo(suscripciones: readonly Fila[], gcClientes: readonly Fila[], empresas: readonly { id: string; nombre: string }[], elegidas: readonly string[]): ApuntadoParaQbo[] {
  const out = new Map<string, ApuntadoParaQbo>()
  const delGc = new Map(gcClientes.map((g) => [`${String(g.company_id)}|${String(g.gc_id)}`, g]))
  for (const s of cuentan(suscripciones)) {
    const empresaId = String(s.company_id)
    const k = `${empresaId}|${String(s.gc_cliente_id)}`
    const gc = delGc.get(k)
    const e = (gc?.enlace ?? null) as Fila | null
    if (!elegidas.includes(empresaId) || e?.estado !== 'sin_ficha') continue
    const x = out.get(k) ?? { empresaId, empresa: empresas.find((y) => y.id === empresaId)?.nombre ?? '', gcClienteId: String(s.gc_cliente_id),
      nombre: texto(gc?.nombre) ?? String(s.gc_cliente_id), correo: texto(gc?.correo), nif: texto(gc?.nif), alMesCent: 0,
      quien: texto(e?.porque)?.replace(/ dijo que no tiene ficha en Bitrix24\.$/, '') ?? null }
    x.alMesCent += cobraEnElMes(s)
    out.set(k, x)
  }
  return [...out.values()].sort((a, b) => b.alMesCent - a.alMesCent || a.nombre.localeCompare(b.nombre, 'es'))
}

/** R19 · «Banco Ejemplo · ···1234», de los mandatos de un cliente de GoCardless. */
export function textoDeMandatos(ms: PorAsignar['mandatos']): string | null {
  const t = ms.filter((m) => m.banco || m.cuentaFinal).map((m) => [m.banco, m.cuentaFinal ? `···${m.cuentaFinal}` : null].filter(Boolean).join(' · '))
  return t.length ? `Mandato: ${[...new Set(t)].join(' / ')}` : null
}

/** «Propuesto por NIF», «2 posibles por nombre», «Sin propuesta». */
export function textoDePropuesta(p: Propuesta, nombreDe: (id: string) => string): string {
  if (p.tipo === 'una') return `Propuesto por ${p.por}: ${nombreDe(p.clienteId)}`
  if (p.tipo === 'varias') return `${p.clienteIds.length} posibles por ${p.por}: elige cuál`
  return 'Sin propuesta: ni el NIF, ni el email ni el nombre coinciden con ningún cliente'
}
