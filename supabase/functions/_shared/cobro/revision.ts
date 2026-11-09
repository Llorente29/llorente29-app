// supabase/functions/_shared/cobro/revision.ts
//
// G05 · Tarea 2 (09/11/2026). «REVISAR EL COBRO»: los recibos del mes de una
// empresa, separados para un administrativo, y lo que dice «Enviar el cobro»
// antes de enviar (regla 8: confirma con contenido). Puro.
//
//   · Arriba, en cifras: «236 recibos · 22.849 € · 14 con cambios».
//   · «Igual que el mes pasado»: se aprueban de una vez.
//   · «Con cambios»: uno a uno, cada uno con su porqué. Los que cambian más de
//     un 30 % piden además su clic.
//   · «Parados»: los que no se pueden enviar (sin precio, sin mandato…), con lo
//     que falta. Un umbral ordena, no esconde (regla 7): salen todos.
//   · «Enviar el cobro» solo envía los aprobados que no están parados, y lo
//     dice en cifras antes: cuántos, cuánto, de qué empresa y qué día se cargan.
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/revision.test.ts.

import { euros } from '../tarifa/precio.ts'
import { miles } from '../tarifa/proximoCobro.ts'
import type { Recibo } from './recibo.ts'

/** Un recibo en la revisión: el calculado, su mandato y si alguien lo ha aprobado ya. */
export interface ReciboEnRevision {
  recibo: Recibo
  /** El nombre del cliente, para la lista. */
  cliente: string
  /** Si tiene un mandato con el que GoCardless deja cobrar; si no, por qué no. */
  mandato: { vale: true } | { vale: false; porque: string }
  aprobado: boolean
}

export type Grupo = 'igual' | 'con_cambios' | 'parado'

/** A qué grupo va un recibo: parado manda; después, si cambia algo o pide clic. */
export function grupoDelRecibo(x: ReciboEnRevision): Grupo {
  if (x.recibo.parado.length || !x.mandato.vale) return 'parado'
  return x.recibo.igualQueElMesPasado && !x.recibo.pideClic ? 'igual' : 'con_cambios'
}

/** Lo que impide enviar un recibo, en palabras (lo del recibo y lo del mandato). */
export const loQueFalta = (x: ReciboEnRevision): string[] => [...x.recibo.parado, ...(x.mandato.vale ? [] : [x.mandato.porque])]

const recibos = (n: number) => `${miles(n)} ${n === 1 ? 'recibo' : 'recibos'}`
/** Los euros de la línea de arriba, sin céntimos («22.849 €»). */
const eurosRedondos = (cent: number) => `${miles(Math.round(cent / 100))} €`

export interface Revision {
  /** «236 recibos · 22.849 € · 14 con cambios». */
  titulo: string
  totalCent: number
  igual: ReciboEnRevision[]
  conCambios: ReciboEnRevision[]
  parados: ReciboEnRevision[]
  /** Lo que se enviaría ahora (aprobados y sin parar). */
  listos: { n: number; cent: number }
  /** Los de «con cambios» que aún no ha aprobado nadie. */
  porAprobar: number
}

const porImporte = (a: ReciboEnRevision, b: ReciboEnRevision) => b.recibo.totalCent - a.recibo.totalCent || a.cliente.localeCompare(b.cliente, 'es')

export function revision(xs: readonly ReciboEnRevision[]): Revision {
  const de = (g: Grupo) => xs.filter((x) => grupoDelRecibo(x) === g).sort(porImporte)
  const igual = de('igual'); const conCambios = de('con_cambios'); const parados = de('parado')
  const totalCent = xs.reduce((s, x) => s + x.recibo.totalCent, 0)
  const listos = xs.filter((x) => x.aprobado && grupoDelRecibo(x) !== 'parado')
  const partes = [recibos(xs.length), eurosRedondos(totalCent), `${miles(conCambios.length)} con cambios`]
  if (parados.length) partes.push(`${miles(parados.length)} ${parados.length === 1 ? 'parado' : 'parados'}`)
  return {
    titulo: partes.join(' · '), totalCent, igual, conCambios, parados,
    listos: { n: listos.length, cent: listos.reduce((s, x) => s + x.recibo.totalCent, 0) },
    porAprobar: conCambios.filter((x) => !x.aprobado).length,
  }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`

/**
 * Lo que dice «Enviar el cobro» antes de enviar: cuántos, cuánto, de quién y
 * cuándo, y lo que se queda fuera. Si no hay nada listo, lo dice y no deja enviar.
 */
export function confirmacionDeEnvio(r: Revision, empresa: string, cargoEl: string): { puede: boolean; texto: string } {
  if (!r.listos.n) return { puede: false, texto: 'No hay ningún recibo aprobado y listo para enviar.' }
  const fuera: string[] = []
  if (r.porAprobar) fuera.push(`${miles(r.porAprobar)} con cambios sin aprobar`)
  if (r.parados.length) fuera.push(`${miles(r.parados.length)} ${r.parados.length === 1 ? 'parado' : 'parados'}`)
  return {
    puede: true,
    texto: `Se envían a GoCardless ${recibos(r.listos.n)} de ${empresa} por ${euros(r.listos.cent)}, con cargo el ${fechaLarga(cargoEl)}.`
      + (fuera.length ? ` Se quedan fuera: ${fuera.join(' y ')}.` : '')
      + ' No hay factura hasta que cada cobro se confirme.',
  }
}
