// src/modules/conta/esqueleto/productos.ts
//
// S01 · El esqueleto de contabilidad: los productos de la barra y sus pestañas
// (encargo S01 y visto bueno de Julio del 17/10). De aquí salen la barra de la
// izquierda, las pestañas de la cabecera y qué producto y qué pestaña están
// activos para cada dirección. Núcleo puro: se prueba sin React.
//
//   Inicio · Contabilidad · Facturación · Compras y gastos · Bancos · Laboral ·
//   Impuestos · Contactos · (abajo) Ajustes
//
// Tres reglas:
//   1. Las pantallas NO cambian de dirección: cada pestaña dice qué direcciones
//      son suyas (`prefijos`) y gana el prefijo más largo. Una pantalla vieja
//      no se entera de que ahora cuelga de otro sitio.
//   2. Nada vacío delante del cliente: un producto o una pestaña sin pantalla
//      (`ruta: null`) no sale. Facturación, Laboral e Impuestos llevan además
//      su interruptor por cuenta en `feature_flags` (sin caducidad): salen
//      cuando lo tengan encendido Y tengan pantalla.
//   3. Hostelería y Diez son de la EMPRESA: lo que solo tiene sentido con ellas
//      (Liquidaciones, Importar de Diez) solo sale si la empresa lo tiene.

import { CONTA } from '@/config/navegacion'
import type { NombreIcono } from '@/modules/conta/diseno/iconos'

export type IdProducto = 'inicio' | 'contabilidad' | 'facturacion' | 'compras' | 'bancos' | 'laboral' | 'impuestos' | 'contactos' | 'ajustes'

/** Lo que solo sale si la empresa lo tiene. */
export type Condicion = 'hosteleria' | 'diez'

export type Interruptor = 'conta_facturacion' | 'conta_laboral' | 'conta_impuestos'
export const INTERRUPTORES: readonly Interruptor[] = ['conta_facturacion', 'conta_laboral', 'conta_impuestos']

export interface Pestana {
  id: string
  etiqueta: string
  /** Dirección relativa al módulo; null = aún no tiene pantalla (no sale). */
  ruta: string | null
  /** Las direcciones que caen en esta pestaña. */
  prefijos: string[]
  solo?: Condicion
}

export interface Producto {
  id: IdProducto
  etiqueta: string
  icono: NombreIcono
  /** Dirección de entrada; null = sin pantalla (no sale). */
  ruta: string | null
  /** Direcciones del producto que no son de ninguna pestaña (la portada, el alta). */
  prefijos: string[]
  pestanas: Pestana[]
  interruptor?: Interruptor
  /** Va abajo del todo en la barra (Ajustes). */
  abajo?: boolean
  /**
   * La pantalla aún pinta sus propias pestañas (Bancos, hasta el paso 3 del
   * S01): la cabecera no las repite.
   */
  pestanasEnLaPantalla?: boolean
}

/** Lo que decide qué sale: de la empresa activa y de la cuenta. */
export interface Contexto {
  hosteleria: boolean
  diez: boolean
  interruptores: ReadonlySet<string>
}

const R = CONTA.rutas

export const PRODUCTOS: Producto[] = [
  { id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: R.inicio, prefijos: [R.inicio], pestanas: [] },
  {
    id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'contabilidad', ruta: R.libroDiario, prefijos: [],
    pestanas: [
      { id: 'asientos', etiqueta: 'Asientos', ruta: R.libroDiario, prefijos: [R.libroDiario] },
      {
        id: 'listados', etiqueta: 'Libros y listados', ruta: `${R.libros}/mayor/libro-mayor`,
        prefijos: [R.libros, R.diarioResumido, `${R.libros}/mayor`, `${R.libros}/registro`, `${R.libros}/balances`, 'plan'],
      },
      { id: 'definiciones', etiqueta: 'Definiciones', ruta: R.plan, prefijos: [R.plan, R.tablas] },
      { id: 'cierre', etiqueta: 'Cierre y Registro', ruta: `${R.libros}/cierre/ejercicios`, prefijos: [`${R.libros}/cierre`, `${R.libros}/anuales`] },
      { id: 'importar', etiqueta: 'Importar', ruta: R.pendientesDiez, prefijos: [R.pendientesDiez], solo: 'diez' },
    ],
  },
  {
    id: 'facturacion', etiqueta: 'Facturación', icono: 'facturacion', ruta: null, prefijos: [], interruptor: 'conta_facturacion',
    pestanas: [
      { id: 'facturas', etiqueta: 'Facturas', ruta: null, prefijos: [] },
      { id: 'presupuestos', etiqueta: 'Presupuestos', ruta: null, prefijos: [] },
      { id: 'recurrentes', etiqueta: 'Recurrentes', ruta: null, prefijos: [] },
      { id: 'rectificativas', etiqueta: 'Rectificativas', ruta: null, prefijos: [] },
      { id: 'cobros', etiqueta: 'Cobros', ruta: null, prefijos: [] },
      { id: 'productos', etiqueta: 'Productos y servicios', ruta: null, prefijos: [] },
      { id: 'series', etiqueta: 'Series y plantillas', ruta: null, prefijos: [] },
    ],
  },
  {
    id: 'compras', etiqueta: 'Compras y gastos', icono: 'compras', ruta: R.compras, prefijos: [],
    pestanas: [
      { id: 'por-revisar', etiqueta: 'Por revisar', ruta: R.compras, prefijos: [R.compras] },
      { id: 'recibidas', etiqueta: 'Facturas recibidas', ruta: R.documentos, prefijos: [R.documentos] },
      { id: 'recurrentes', etiqueta: 'Recurrentes', ruta: null, prefijos: [] },
      { id: 'pagos', etiqueta: 'Pagos', ruta: null, prefijos: [] },
      { id: 'liquidaciones', etiqueta: 'Liquidaciones', ruta: R.liquidacionNueva, prefijos: [`${R.compras}/liquidacion`, `${R.documentos}/catcher`], solo: 'hosteleria' },
    ],
  },
  {
    id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: R.bancos, prefijos: [], pestanasEnLaPantalla: true,
    pestanas: [
      { id: 'movimientos', etiqueta: 'Movimientos', ruta: R.bancos, prefijos: [R.bancos] },
      { id: 'reglas', etiqueta: 'Reglas', ruta: `${R.bancos}/reglas`, prefijos: [`${R.bancos}/reglas`] },
      { id: 'cuentas', etiqueta: 'Cuentas y extractos', ruta: `${R.bancos}/cuentas`, prefijos: [`${R.bancos}/cuentas`] },
      { id: 'cierre', etiqueta: 'Cierre del mes', ruta: `${R.bancos}/cierre`, prefijos: [`${R.bancos}/cierre`] },
    ],
  },
  { id: 'laboral', etiqueta: 'Laboral', icono: 'laboral', ruta: null, prefijos: [], interruptor: 'conta_laboral', pestanas: [] },
  { id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', ruta: null, prefijos: [], interruptor: 'conta_impuestos', pestanas: [] },
  {
    id: 'contactos', etiqueta: 'Contactos', icono: 'contactos', ruta: R.terceros, prefijos: [],
    pestanas: [
      { id: 'todos', etiqueta: 'Todos', ruta: R.terceros, prefijos: [R.terceros] },
    ],
  },
  {
    id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: R.empresa, prefijos: [R.alta], abajo: true,
    pestanas: [
      { id: 'empresa', etiqueta: 'Empresa', ruta: R.empresa, prefijos: [R.empresa] },
      { id: 'usuarios', etiqueta: 'Usuarios', ruta: null, prefijos: [] },
      { id: 'registro-ia', etiqueta: 'Registro de la IA', ruta: `${R.empresa}/folvy`, prefijos: [`${R.empresa}/folvy`] },
    ],
  },
]

const cumple = (c: Condicion | undefined, ctx: Contexto) => !c || (c === 'hosteleria' ? ctx.hosteleria : ctx.diez)

/** Las pestañas que salen: con pantalla y, si piden algo de la empresa, que lo tenga. */
export function pestanasVisibles(p: Producto, ctx: Contexto): Pestana[] {
  return p.pestanas.filter((t) => t.ruta !== null && cumple(t.solo, ctx))
}

/** ¿Sale el producto? Con pantalla y, si lleva interruptor, encendido. */
export function productoVisible(p: Producto, ctx: Contexto): boolean {
  if (p.ruta === null) return false
  if (p.interruptor && !ctx.interruptores.has(p.interruptor)) return false
  return true
}

export function productosVisibles(ctx: Contexto, lista: Producto[] = PRODUCTOS): Producto[] {
  return lista.filter((p) => productoVisible(p, ctx))
}

/** «/conta/libros/diario?x» → «libros/diario». */
export function relativa(pathname: string): string {
  const sin = pathname.split(/[?#]/)[0].replace(/^\/+/, '')
  const base = `${CONTA.modulo}`
  if (sin === base) return ''
  return sin.startsWith(`${base}/`) ? sin.slice(base.length + 1).replace(/\/+$/, '') : sin.replace(/\/+$/, '')
}

const casa = (rel: string, prefijo: string) => rel === prefijo || rel.startsWith(`${prefijo}/`)

/** Todos los prefijos de un producto: los suyos y los de sus pestañas. */
const prefijosDe = (p: Producto) => [...p.prefijos, ...p.pestanas.flatMap((t) => t.prefijos)]

/**
 * El producto y la pestaña de una dirección: los del prefijo más largo, mirando
 * TODAS las pestañas (también las que no salen: una dirección de una pestaña
 * oculta sigue siendo de su producto, y la cabecera no marca ninguna).
 */
export function dondeEsta(pathname: string, lista: Producto[] = PRODUCTOS): { producto: Producto; pestana: Pestana | null } | null {
  const rel = relativa(pathname)
  let mejor: { producto: Producto; pestana: Pestana | null; largo: number } | null = null
  for (const producto of lista) {
    for (const x of producto.prefijos) if (casa(rel, x) && (!mejor || x.length > mejor.largo)) mejor = { producto, pestana: null, largo: x.length }
    for (const pestana of producto.pestanas) for (const x of pestana.prefijos) {
      if (casa(rel, x) && (!mejor || x.length > mejor.largo)) mejor = { producto, pestana, largo: x.length }
    }
  }
  return mejor ? { producto: mejor.producto, pestana: mejor.pestana } : null
}

export const productoDe = (pathname: string): Producto | null => dondeEsta(pathname)?.producto ?? null

/** Todas las direcciones que son de algún producto (las prueba la unitaria contra CONTA.rutas). */
export const TODOS_LOS_PREFIJOS = PRODUCTOS.flatMap(prefijosDe)

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
