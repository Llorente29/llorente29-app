// supabase/functions/_shared/cobro/revision.ts
//
// G05 · Tarea 2 (09/11/2026). «REVISAR EL COBRO»: los recibos del mes de una
// empresa, separados para un administrativo, y lo que dice «Enviar el cobro»
// antes de enviar (regla 8: confirma con contenido). Puro. Los textos son los
// de la maqueta (Cobro.dc.html, 09/11; pendiente de que Julio la apruebe).
//
//   · Arriba: «236 recibos · 22.849 € · 14 con cambios» y, debajo, cuánto
//     cambia frente al mes anterior y por qué («1 cliente nuevo, 2 trabajadores
//     menos y 1 más»).
//   · «Igual que noviembre»: mismo cliente, mismos servicios, mismo importe. Se
//     aprueban de una vez («Aprobar los 22»).
//   · «Con cambios»: uno a uno, cada uno con su porqué. «Aprobar» o, si sube
//     o baja más de un 30 %, «Lo he mirado, aprobar». O «Este mes no».
//   · «No entran en este cobro»: los parados (sin precio, sin mandato…) y los
//     que no tienen recibo (de baja, sin cuota). Sumied los deja fuera solo.
//     Un umbral ordena, no esconde (regla 7): salen todos.
//   · «Enviar el cobro» no se puede pulsar mientras falte algo («Falta: 3
//     cambios por revisar y aprobar los 22 iguales.»). Antes de enviar, el
//     aviso dice a cuántos, cuánto, desde dónde y qué días.
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/revision.test.ts.

import { euros } from '../tarifa/precio.ts'
import { miles } from '../tarifa/proximoCobro.ts'
import { nombreDelMes, mesAnterior, type Recibo } from './recibo.ts'

/** Lo que alguien ha decidido de un recibo con cambios. */
export type Decision = 'pendiente' | 'aprobado' | 'este_mes_no'

/** Un recibo en la revisión: el calculado, su mandato y lo que se ha decidido. */
export interface ReciboEnRevision {
  recibo: Recibo
  /** El nombre del cliente, para la lista. */
  cliente: string
  /** Si tiene un mandato con el que GoCardless deja cobrar; si no, por qué no. */
  mandato: { vale: true } | { vale: false; porque: string }
  decision: Decision
}

/** Un cliente que se cobra pero este mes no tiene recibo (de baja, sin cuota…), con lo que se puede hacer. */
export interface SinReciboEnRevision { cliente: string; porque: string; boton: string | null }

export type Grupo = 'igual' | 'con_cambios' | 'no_entra'

/** A qué grupo va un recibo: lo que no se puede enviar no entra; después, si cambia algo o pide clic. */
export function grupoDelRecibo(x: ReciboEnRevision): Grupo {
  if (x.recibo.parado.length || !x.mandato.vale) return 'no_entra'
  return x.recibo.igualQueElMesPasado && !x.recibo.pideClic ? 'igual' : 'con_cambios'
}

/** Lo que impide enviar un recibo, en palabras (lo del recibo y lo del mandato). */
export const loQueFalta = (x: ReciboEnRevision): string[] => [...x.recibo.parado, ...(x.mandato.vale ? [] : [x.mandato.porque])]

/** El botón de aprobar de un recibo con cambios: si cambia más de un 30 %, hay que decir que se ha mirado. */
export const botonDeAprobar = (x: ReciboEnRevision) => (x.recibo.pideClic ? 'Lo he mirado, aprobar' : 'Aprobar')

const recibos = (n: number) => `${miles(n)} ${n === 1 ? 'recibo' : 'recibos'}`
const eurosRedondos = (cent: number) => `${miles(Math.round(cent / 100))} €`
const enLista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

export interface Revision {
  /** «236 recibos · 22.849 € · 14 con cambios». */
  titulo: string
  totalCent: number
  /** «+120,50 € frente a noviembre · 1 cliente nuevo, 2 trabajadores menos y 1 más». Null si no hay mes anterior. */
  frente: string | null
  igual: ReciboEnRevision[]
  conCambios: ReciboEnRevision[]
  noEntran: { recibo: ReciboEnRevision | null; cliente: string; porque: string; boton: string | null }[]
  /** Los que se enviarían ahora: iguales (si se han aprobado) y con cambios aprobados. */
  listos: { n: number; cent: number; texto: string }
  /** Los de «con cambios» sin decidir, y cuántos de ellos cambian más de un 30 %. */
  porRevisar: { n: number; fuertes: number }
  /** Lo que falta para poder enviar; vacío: «Todo revisado. Puedes enviarlo.». */
  falta: string
  puedeEnviar: boolean
}

const porImporte = (a: ReciboEnRevision, b: ReciboEnRevision) => b.recibo.totalCent - a.recibo.totalCent || a.cliente.localeCompare(b.cliente, 'es')

/** El porqué de la diferencia con el mes anterior, contado: «1 cliente nuevo, 1 baja, 2 trabajadores menos y 1 más». */
function porqueDeLaDiferencia(xs: readonly ReciboEnRevision[], sinRecibo: readonly SinReciboEnRevision[]): string {
  const cs = xs.flatMap((x) => x.recibo.cambios)
  const nuevos = cs.filter((c) => c.tipo === 'cliente_nuevo').length
  const menos = cs.reduce((s, c) => s + (c.bajas ?? 0), 0)
  const mas = cs.reduce((s, c) => s + (c.altas ?? 0), 0)
  const precios = cs.filter((c) => c.tipo === 'precio' || c.tipo === 'nivel').length
  const bajas = sinRecibo.length
  const partes: string[] = []
  if (nuevos) partes.push(`${nuevos} ${nuevos === 1 ? 'cliente nuevo' : 'clientes nuevos'}`)
  if (bajas) partes.push(`${bajas} ${bajas === 1 ? 'que no entra' : 'que no entran'}`)
  if (menos) partes.push(`${menos} ${menos === 1 ? 'trabajador' : 'trabajadores'} menos`)
  if (mas) partes.push(menos ? `${mas} más` : `${mas} ${mas === 1 ? 'trabajador' : 'trabajadores'} más`)
  if (precios) partes.push(`${precios} ${precios === 1 ? 'cambio de precio' : 'cambios de precio'}`)
  return enLista(partes)
}

/**
 * La revisión del cobro de un mes. `igualesAprobados`: si ya se ha pulsado
 * «Aprobar los N» de los que no cambian.
 */
export function revision(xs: readonly ReciboEnRevision[], sinRecibo: readonly SinReciboEnRevision[], igualesAprobados: boolean): Revision {
  const de = (g: Grupo) => xs.filter((x) => grupoDelRecibo(x) === g).sort(porImporte)
  const igual = de('igual'); const conCambios = de('con_cambios')
  const totalCent = xs.reduce((s, x) => s + x.recibo.totalCent, 0)
  const conAnterior = xs.filter((x) => x.recibo.anteriorCent !== null)
  const mes = xs[0]?.recibo.mes ?? null
  let frente: string | null = null
  if (mes && conAnterior.length) {
    const antes = xs.reduce((s, x) => s + (x.recibo.anteriorCent ?? 0), 0)
    const dif = totalCent - antes
    const porque = porqueDeLaDiferencia(xs, sinRecibo)
    frente = `${dif >= 0 ? '+' : '−'}${euros(Math.abs(dif))} frente a ${nombreDelMes(mesAnterior(mes))}${porque ? ` · ${porque}` : ''}`
  }
  const listosXs = [...(igualesAprobados ? igual : []), ...conCambios.filter((x) => x.decision === 'aprobado')]
  const listosCent = listosXs.reduce((s, x) => s + x.recibo.totalCent, 0)
  const pendientes = conCambios.filter((x) => x.decision === 'pendiente')
  const falta: string[] = []
  if (pendientes.length) falta.push(`${pendientes.length} ${pendientes.length === 1 ? 'cambio por revisar' : 'cambios por revisar'}`)
  if (igual.length && !igualesAprobados) falta.push(igual.length === 1 ? 'aprobar el que no cambia' : `aprobar los ${miles(igual.length)} iguales`)
  const noEntran = [
    ...de('no_entra').map((x) => ({ recibo: x, cliente: x.cliente, porque: loQueFalta(x).join('. '), boton: x.mandato.vale ? 'Ver la ficha' : 'Reenviar el mandato' })),
    ...sinRecibo.map((s) => ({ recibo: null, ...s })),
  ]
  const partes = [recibos(xs.length), eurosRedondos(totalCent), `${miles(conCambios.length)} con cambios`]
  return {
    titulo: partes.join(' · '), totalCent, frente, igual, conCambios, noEntran,
    listos: { n: listosXs.length, cent: listosCent, texto: `Listos para cobrar: ${recibos(listosXs.length)} · ${euros(listosCent)}` },
    porRevisar: { n: pendientes.length, fuertes: pendientes.filter((x) => x.recibo.pideClic).length },
    falta: falta.length ? `Falta: ${enLista(falta)}.` : 'Todo revisado. Puedes enviarlo.',
    puedeEnviar: !falta.length && listosXs.length > 0,
  }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`

export interface AvisoDeEnvio {
  titulo: string
  seCobraA: string
  enTotal: string
  desde: string
  avisoAlCliente: string
  cargo: string
  nota: string
}

/** Lo que dice el aviso de «Enviar el cobro» antes de enviar: a cuántos, cuánto, desde dónde y qué días. Null si aún no se puede enviar. */
export function avisoDeEnvio(r: Revision, mes: string, empresa: string, avisoEl: string, cargoEl: string, recibosDelMes: number): AvisoDeEnvio | null {
  if (!r.puedeEnviar) return null
  const fuera = recibosDelMes - r.listos.n
  return {
    titulo: `¿Enviamos el cobro de ${nombreDelMes(mes)}?`,
    seCobraA: `${miles(r.listos.n)} ${r.listos.n === 1 ? 'cliente' : 'clientes'}`,
    enTotal: euros(r.listos.cent),
    desde: `${empresa} · GoCardless`,
    avisoAlCliente: `${fechaLarga(avisoEl)}, por correo`,
    cargo: fechaLarga(cargoEl),
    nota: `${fuera > 0 ? `${recibos(fuera)} que has dejado fuera no se ${fuera === 1 ? 'cobra' : 'cobran'} este mes. ` : ''}`
      + 'Cada cliente recibe el aviso con el detalle de lo que se le cobra. Mientras GoCardless no lo mande al banco, cualquier cobro se puede parar desde la ficha del cliente.',
  }
}
