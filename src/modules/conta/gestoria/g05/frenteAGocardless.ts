// src/modules/conta/gestoria/g05/frenteAGocardless.ts
//
// Q08 · Paso 3 · «Revisar el cobro» con los datos reales de QBO: lo que
// cobraría Sumied (sus recibos del mes, conta_recibo) al lado de lo que
// GoCardless va a cobrar ese mes (las suscripciones activas con su próximo
// cobro en el mes, conta_gc_suscripcion), cliente a cliente. Las diferencias
// van arriba, con su motivo en palabras de la calle:
//   · «nueva en diciembre»: GoCardless la cobra y Sumied no tiene recibo;
//   · «no se cobra en diciembre»: Sumied tiene recibo y GoCardless no cobra;
//   · «importe distinto»: los dos cobran, cada uno una cosa;
//   · «sin atar a su ficha»: lo que cobra GoCardless a un cliente que no está
//     atado a ninguna ficha (no se puede comparar con nada).
// Sin pintar y sin base: lo prueba tests/unit/modules/conta/q08/frenteAGocardless.test.ts.
// Con los datos reales, Sumied solo lee: esto no cobra ni envía nada.

import { nombreDelMes } from '../../../../../supabase/functions/_shared/cobro/recibo'

export interface ReciboSumied { partyId: string; cliente: string; totalCent: number; decision?: string }
export interface SuscripcionGc { gcClienteId: string; nombre: string; importe: number; fecha: string | null; estado: string }
export interface ClienteGc { gcId: string; nombre: string | null; partyId: string | null }
export interface EnlaceGc { gcClienteId: string; partyId: string | null; estado: string }

export type Motivo = 'nueva' | 'no_se_cobra' | 'importe_distinto' | 'sin_atar'

export interface FilaFrente {
  clave: string
  cliente: string
  partyId: string | null
  sumiedCent: number
  gcCent: number
  /** Los días de cargo de GoCardless en el mes («04/12»), de menos a más. */
  fechas: string[]
  suscripciones: string[]
  motivo: Motivo | null
}

export interface Frente {
  mes: string
  filas: FilaFrente[]
  /** Las que tienen diferencia, en el orden de arriba: por motivo y, dentro, por importe. */
  diferencias: FilaFrente[]
  iguales: FilaFrente[]
  totalSumiedCent: number
  totalGcCent: number
  cuantas: Record<Motivo, number>
}

const ORDEN: Motivo[] = ['sin_atar', 'nueva', 'no_se_cobra', 'importe_distinto']

/** El motivo de una diferencia, en palabras de la calle («nueva en diciembre»). */
export function motivoEnPalabras(m: Motivo, mes: string): string {
  const en = `en ${nombreDelMes(mes)}`
  if (m === 'nueva') return `Nueva ${en}`
  if (m === 'no_se_cobra') return `No se cobra ${en}`
  if (m === 'importe_distinto') return 'Importe distinto'
  return 'Sin atar a su ficha'
}

const cent = (n: number) => Math.round(n * 100)
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/**
 * La comparación de un mes («2026-12»). La ficha de cada cliente de GoCardless
 * es la del enlace atado (lo que decidió una persona o el casado) y, si no hay,
 * la que ya tenía (conta_gc_cliente.party_id). Los recibos «este mes no» de
 * Sumied no cuentan como cobro.
 */
export function frenteAGocardless(mes: string, recibos: readonly ReciboSumied[], suscripciones: readonly SuscripcionGc[], clientes: readonly ClienteGc[], enlaces: readonly EnlaceGc[]): Frente {
  const fichaDe = new Map<string, string>()
  for (const c of clientes) if (c.partyId) fichaDe.set(c.gcId, c.partyId)
  for (const e of enlaces) if (e.estado === 'atado' && e.partyId) fichaDe.set(e.gcClienteId, e.partyId)
  const nombreGc = new Map(clientes.map((c) => [c.gcId, c.nombre ?? c.gcId]))

  const porClave = new Map<string, FilaFrente>()
  const fila = (clave: string, cliente: string, partyId: string | null) => {
    let f = porClave.get(clave)
    if (!f) { f = { clave, cliente, partyId, sumiedCent: 0, gcCent: 0, fechas: [], suscripciones: [], motivo: null }; porClave.set(clave, f) }
    return f
  }
  for (const r of recibos) {
    if (r.decision === 'este_mes_no') continue
    fila(`p:${r.partyId}`, r.cliente, r.partyId).sumiedCent += r.totalCent
  }
  for (const s of suscripciones) {
    if (s.estado !== 'active' || !s.fecha || s.fecha.slice(0, 7) !== mes) continue
    const party = fichaDe.get(s.gcClienteId) ?? null
    const f = party ? fila(`p:${party}`, porClave.get(`p:${party}`)?.cliente ?? nombreGc.get(s.gcClienteId) ?? s.gcClienteId, party)
      : fila(`g:${s.gcClienteId}`, nombreGc.get(s.gcClienteId) ?? s.gcClienteId, null)
    f.gcCent += cent(s.importe)
    if (!f.fechas.includes(ddmm(s.fecha))) f.fechas.push(ddmm(s.fecha))
    f.suscripciones.push(s.nombre)
  }
  const filas = [...porClave.values()]
  for (const f of filas) {
    f.fechas.sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b))
    f.motivo = !f.partyId ? 'sin_atar' : f.sumiedCent === 0 && f.gcCent > 0 ? 'nueva' : f.gcCent === 0 && f.sumiedCent > 0 ? 'no_se_cobra' : f.gcCent !== f.sumiedCent ? 'importe_distinto' : null
  }
  const diferencias = filas.filter((f) => f.motivo)
    .sort((a, b) => ORDEN.indexOf(a.motivo!) - ORDEN.indexOf(b.motivo!) || Math.abs(b.gcCent - b.sumiedCent) - Math.abs(a.gcCent - a.sumiedCent) || a.cliente.localeCompare(b.cliente, 'es'))
  const iguales = filas.filter((f) => !f.motivo).sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'))
  const cuantas = Object.fromEntries(ORDEN.map((m) => [m, diferencias.filter((f) => f.motivo === m).length])) as Record<Motivo, number>
  return {
    mes, filas: [...diferencias, ...iguales], diferencias, iguales, cuantas,
    totalSumiedCent: filas.reduce((x, f) => x + f.sumiedCent, 0), totalGcCent: filas.reduce((x, f) => x + f.gcCent, 0),
  }
}

/** Las filas del Excel para QBO: lo mismo que la pantalla, una por cliente, las diferencias primero. */
export function filasExcel(f: Frente): (string | number | null)[][] {
  return f.filas.map((x) => [x.cliente, x.motivo ? motivoEnPalabras(x.motivo, f.mes) : 'Igual', x.sumiedCent / 100, x.gcCent / 100, (x.gcCent - x.sumiedCent) / 100, x.fechas.join(', '), x.suscripciones.join(' | ')])
}

export const CABECERA_EXCEL = ['Cliente', 'Qué pasa', 'Cobraría Sumied (€)', 'Cobrará GoCardless (€)', 'Diferencia (€)', 'Día del cargo en GoCardless', 'Qué cobra GoCardless']
