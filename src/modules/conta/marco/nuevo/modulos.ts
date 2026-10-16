// src/modules/conta/marco/nuevo/modulos.ts
//
// M01 · Los módulos del marco nuevo (maqueta N30, decisiones de Julio sobre el
// F01, 15/10): la barra de la izquierda y las pestañas de arriba salen de aquí,
// y de aquí sale qué módulo y qué pestaña están activos para cada dirección.
// Núcleo puro: se prueba sin React ni navegador.
//
//   · Inicio, arriba del todo, con la casa: el «Te toca hoy» de todos juntos
//     (es también el «Por hacer»).
//   · V Ventas · C Compras (con Documentos dentro) · B Bancos · L Libros (con
//     el Mayor del plan) · I Impuestos · P Clientes y proveedores, y debajo de
//     una línea, A Ajustes.
//   · Impuestos no tiene pantalla: sale apagado, con «Próximamente» al pasar
//     el ratón. No se esconde.
//
// Las pantallas no cambian de dirección: cada módulo dice qué direcciones son
// suyas (`prefijos`) y el marco lo deduce. Una pantalla vieja no se entera.

import { CONTA } from '@/config/navegacion'
import { AREAS_LIBROS, accionesDe } from '@/modules/conta/libros/navegacion'

export interface PestanaModulo {
  id: string
  etiqueta: string
  /** Dirección relativa al módulo («libros/mayor/libro-mayor»). */
  ruta: string
  /** Las direcciones que caen en esta pestaña. */
  prefijos: string[]
}

export type IdModulo = 'inicio' | 'ventas' | 'compras' | 'bancos' | 'libros' | 'impuestos' | 'terceros' | 'ajustes'

export interface ModuloConta {
  id: IdModulo
  /** La letra del círculo; null en Inicio, que lleva la casa. */
  letra: string | null
  etiqueta: string
  /** Dirección relativa al módulo; null = aún no tiene pantalla (sale apagado). */
  ruta: string | null
  /** Las direcciones que son de este módulo. */
  prefijos: string[]
  /** En el producto vendido solo no sale: su pantalla aún dice «Aún no.» (C06). */
  noEnSolo?: boolean
  pestanas: PestanaModulo[]
  /**
   * Las pestañas las sigue pintando la pantalla (Bancos, hasta que el frente B
   * la pase al marco): arriba no se repiten.
   */
  pestanasEnLaPantalla?: boolean
  /** En el móvil la pantalla va por niveles y pinta las suyas (Libros): arriba, solo en el ordenador. */
  pestanasSoloOrdenador?: boolean
  /** Qué número de lo que hay por mirar lleva (useCuentasMenu). */
  cuenta?: 'compras' | 'terceros' | 'libros' | 'bancos'
  /** Dónde va en la barra. */
  grupo: 'arriba' | 'modulos' | 'abajo'
}

export const TEXTO_PROXIMAMENTE = 'Próximamente'

const R = CONTA.rutas

const pestanasLibros: PestanaModulo[] = AREAS_LIBROS.map((a) => ({
  id: a.id,
  etiqueta: a.nombre,
  ruta: `${R.libros}/${a.id}/${accionesDe(a)[0].id}`,
  // El Mayor de una cuenta del plan (plan/:codigo) es «Mayor y saldos».
  prefijos: a.id === 'mayor' ? [`${R.libros}/${a.id}`, 'plan'] : [`${R.libros}/${a.id}`],
}))

export const MODULOS: ModuloConta[] = [
  { id: 'inicio', letra: null, etiqueta: 'Inicio', ruta: R.inicio, prefijos: [R.inicio], pestanas: [], grupo: 'arriba' },
  { id: 'ventas', letra: 'V', etiqueta: 'Ventas', ruta: R.ventas, prefijos: [R.ventas], pestanas: [], noEnSolo: true, grupo: 'modulos' },
  {
    id: 'compras', letra: 'C', etiqueta: 'Compras', ruta: R.compras, prefijos: [R.compras, R.documentos], cuenta: 'compras', grupo: 'modulos',
    pestanas: [
      { id: 'compras', etiqueta: 'Compras', ruta: R.compras, prefijos: [R.compras] },
      { id: 'documentos', etiqueta: 'Documentos', ruta: R.documentos, prefijos: [R.documentos] },
    ],
  },
  {
    id: 'bancos', letra: 'B', etiqueta: 'Bancos', ruta: R.bancos, prefijos: [R.bancos], cuenta: 'bancos', grupo: 'modulos',
    pestanas: [], pestanasEnLaPantalla: true,
  },
  {
    id: 'libros', letra: 'L', etiqueta: 'Libros', ruta: R.libros, prefijos: [R.libros, 'plan'], cuenta: 'libros', grupo: 'modulos',
    pestanas: pestanasLibros, pestanasSoloOrdenador: true,
  },
  { id: 'impuestos', letra: 'I', etiqueta: 'Impuestos', ruta: null, prefijos: [], pestanas: [], grupo: 'modulos' },
  { id: 'terceros', letra: 'P', etiqueta: 'Clientes y proveedores', ruta: R.terceros, prefijos: [R.terceros], cuenta: 'terceros', pestanas: [], grupo: 'modulos' },
  { id: 'ajustes', letra: 'A', etiqueta: 'Ajustes', ruta: R.empresa, prefijos: ['ajustes', R.alta], pestanas: [], grupo: 'abajo' },
]

/** Los módulos que salen, en su orden. En el producto solo, sin los que dicen «Aún no.». */
export function modulosVisibles(solo: boolean): ModuloConta[] {
  return MODULOS.filter((m) => !(solo && m.noEnSolo))
}

/** «/conta/libros/diario?x» → «libros/diario». */
export function relativa(pathname: string): string {
  const sin = pathname.split(/[?#]/)[0].replace(/^\/+/, '')
  const base = `${CONTA.modulo}`
  if (sin === base) return ''
  return sin.startsWith(`${base}/`) ? sin.slice(base.length + 1).replace(/\/+$/, '') : sin.replace(/\/+$/, '')
}

const casa = (rel: string, prefijo: string) => rel === prefijo || rel.startsWith(`${prefijo}/`)

/** El módulo de una dirección: el del prefijo más largo que casa. */
export function moduloDe(pathname: string, lista: ModuloConta[] = MODULOS): ModuloConta | null {
  const rel = relativa(pathname)
  let mejor: { m: ModuloConta; largo: number } | null = null
  for (const m of lista) for (const p of m.prefijos) {
    if (casa(rel, p) && (!mejor || p.length > mejor.largo)) mejor = { m, largo: p.length }
  }
  return mejor?.m ?? null
}

/**
 * La pestaña activa de un módulo para una dirección: la del prefijo más largo.
 * En la portada del módulo («libros» a secas) es la primera, que es lo que la
 * pantalla enseña.
 */
export function pestanaDe(m: ModuloConta, pathname: string): PestanaModulo | null {
  const rel = relativa(pathname)
  let mejor: { p: PestanaModulo; largo: number } | null = null
  for (const p of m.pestanas) for (const x of p.prefijos) {
    if (casa(rel, x) && (!mejor || x.length > mejor.largo)) mejor = { p, largo: x.length }
  }
  if (mejor) return mejor.p
  return m.ruta !== null && rel === m.ruta ? m.pestanas[0] ?? null : null
}

/** ¿Pinta el marco las pestañas de este módulo arriba? */
export function pestanasArriba(m: ModuloConta | null, movil: boolean): boolean {
  if (!m || m.pestanas.length === 0 || m.pestanasEnLaPantalla) return false
  return !(movil && m.pestanasSoloOrdenador)
}

/**
 * Cuántas pestañas caben en el ancho que hay; el resto va a «Más ▾». Si caben
 * todas, todas (sin «Más»); si no, se reserva el sitio de «Más».
 */
export function cuantasCaben(anchos: number[], disponible: number, anchoMas: number, hueco = 0): number {
  const total = anchos.reduce((s, a, i) => s + a + (i ? hueco : 0), 0)
  if (total <= disponible) return anchos.length
  let usado = anchoMas
  for (let i = 0; i < anchos.length; i++) {
    const siguiente = usado + hueco + anchos[i]
    if (siguiente > disponible) return i
    usado = siguiente
  }
  return anchos.length
}
