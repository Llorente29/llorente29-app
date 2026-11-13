// src/modules/conta/lib/sinTienda.ts
//
// S01p·18 · punto 6 (Julio, 13/11) · Ningún aviso dice que falta algo sin haberlo
// mirado antes en los libros. Una semana de una tienda «sin liquidación» puede tener
// la suya en los libros, pero sin local ni marca (las 8 de Uber de Foodint, medidas
// el 13/11): el mes casa por local y marca y no la ve. Antes de decir «No ha llegado
// su liquidación», se mira si hay alguna de esa plataforma y esas fechas sin tienda
// asignada. Sin React.

import type { SinTienda } from '@/modules/conta/services/liquidacionesMotorService'
import { eurosExactos } from '@/modules/conta/lib/formato'

/** La primera palabra del nombre, en minúsculas: «Uber» y «Uber Eats» son la misma plataforma. */
const plataforma = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().split(/\s+/)[0] ?? ''

/** Las liquidaciones sin tienda de la misma plataforma que pisan esas fechas. */
export function sinTiendaDeLaSemana(canal: string, desde: string | null, hasta: string | null, sin: readonly SinTienda[]): SinTienda[] {
  if (!desde || !hasta) return []
  return sin.filter((x) => plataforma(x.canal) === plataforma(canal) && !!x.desde && !!x.hasta && x.desde <= hasta && x.hasta >= desde)
}

const dm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')
const eur = (n: number | null) => (n === null ? '—' : eurosExactos(n))

/** La frase de una fila que diría «No ha llegado su liquidación» y tiene alguna en los libros sin asignar. */
export function fraseHaySinTienda(canal: string, xs: readonly SinTienda[]): string {
  const n = xs.length
  return `Puede que sí haya llegado: en los libros ${n === 1 ? 'hay 1 liquidación' : `hay ${n} liquidaciones`} de ${canal} de estas fechas sin tienda asignada`
    + ` (${xs.map((x) => `«${x.tienda}», ${dm(x.desde)}–${dm(x.hasta)}, ${eur(x.neto)}`).join('; ')}). Asígnala arriba antes de pedirla.`
}

/** El título del aviso: «8 liquidaciones de Uber sin tienda asignada». */
export function tituloSinTienda(xs: readonly SinTienda[]): string {
  const canales = [...new Set(xs.map((x) => x.canal))]
  return `${xs.length === 1 ? '1 liquidación' : `${xs.length} liquidaciones`} de ${canales.join(' y ')} sin tienda asignada`
}

/** Una línea de la lista: «Uber · «Meraki Pita (…)» · 12/10–18/10 · 782,16 €». */
export function lineaSinTienda(x: SinTienda): string {
  return `${x.canal} · «${x.tienda}» · ${dm(x.desde)}–${dm(x.hasta)} · ${eur(x.neto)}`
}
