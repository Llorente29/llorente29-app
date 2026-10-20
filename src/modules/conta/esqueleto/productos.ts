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
export type Condicion = 'hosteleria' | 'diez' | 'asesoria'

export type Interruptor = 'conta_facturacion' | 'conta_laboral' | 'conta_impuestos'
export const INTERRUPTORES: readonly Interruptor[] = ['conta_facturacion', 'conta_laboral', 'conta_impuestos']

export interface Pestana {
  id: string
  etiqueta: string
  /** I01c (Julio, 20/10): cada pestaña lleva su icono en la cabecera, en todos los módulos. */
  icono?: NombreIcono
  /** Dirección relativa al módulo; null = aún no tiene pantalla (no sale). */
  ruta: string | null
  /** Las direcciones que caen en esta pestaña. */
  prefijos: string[]
  solo?: Condicion
  /**
   * La pestaña es una vista de la misma pantalla (`?ver=`): Contactos. Se marca
   * cuando la dirección la pide; la que no lleva `ver` es la de serie.
   */
  ver?: string
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
   * En el móvil, la pantalla va por niveles (patrón M4: portada con sus
   * apartados y «‹ Volver»): ni la fila de pestañas ni la cinta. Bancos.
   * En el ordenador, pestañas y cinta como todos (paso 3 del S01).
   */
  portadaMovil?: boolean
  /**
   * S01e · Alguna de sus pantallas pone el ejercicio o el mes en la cabecera
   * (PeriodoEnBarra): los px que se le guardan siempre, esté o no, con su hueco.
   */
  periodo?: number
}

/** Lo que decide qué sale: de la empresa activa y de la cuenta. */
export interface Contexto {
  hosteleria: boolean
  diez: boolean
  interruptores: ReadonlySet<string>
  /** S01 · El logo de la empresa (URL firmada del bucket company-logos), o null. No decide qué sale. */
  logoEmpresa?: string | null
  /**
   * S01 · Los ejes de analítica encendidos de la empresa (conta_eje_analitico):
   * null = no se han podido leer (la tabla aún no está): todo sale, como antes.
   */
  analitica?: Analitica | null
  /**
   * P01 · La CUENTA dice que es una asesoría («Soy una asesoría»,
   * accounts.tax_advisor_since) o ya lleva clientes con permiso: sale
   * «Tus clientes» en Impuestos. Sin leer (la 0100 sin aplicar), no sale.
   */
  asesoria?: boolean
}

/** Un eje de analítica encendido, con el nombre que le da la empresa. */
export interface EjeVista { nombre: string; plural: string }
/** Los dos ejes; null = apagado (ni se pide ni se enseña; lo guardado se queda). */
export interface Analitica { local: EjeVista | null; marca: EjeVista | null }

const R = CONTA.rutas

export const PRODUCTOS: Producto[] = [
  { id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: R.inicio, prefijos: [R.inicio], pestanas: [] },
  {
    id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'contabilidad', ruta: R.libroDiario, prefijos: [], periodo: 210,   // «Ejercicio 2025 · cerrado»
    pestanas: [
      { id: 'asientos', etiqueta: 'Asientos', icono: 'general', ruta: R.libroDiario, prefijos: [R.libroDiario] },
      {
        id: 'listados', etiqueta: 'Libros y listados', icono: 'libro', ruta: `${R.libros}/mayor/libro-mayor`,
        prefijos: [R.libros, R.diarioResumido, `${R.libros}/mayor`, `${R.libros}/registro`, `${R.libros}/balances`, 'plan'],
      },
      { id: 'definiciones', etiqueta: 'Definiciones', icono: 'lista', ruta: R.plan, prefijos: [R.plan, R.tablas, R.analitica] },
      { id: 'cierre', etiqueta: 'Cierre y Registro', icono: 'candado', ruta: `${R.libros}/cierre/ejercicios`, prefijos: [`${R.libros}/cierre`, `${R.libros}/anuales`] },
      { id: 'importar', etiqueta: 'Importar', icono: 'subir', ruta: R.pendientesDiez, prefijos: [R.pendientesDiez], solo: 'diez' },
    ],
  },
  {
    id: 'facturacion', etiqueta: 'Facturación', icono: 'facturacion', ruta: null, prefijos: [], interruptor: 'conta_facturacion',
    pestanas: [
      { id: 'facturas', etiqueta: 'Facturas', icono: 'facturacion', ruta: null, prefijos: [] },
      { id: 'presupuestos', etiqueta: 'Presupuestos', icono: 'documento', ruta: null, prefijos: [] },
      { id: 'recurrentes', etiqueta: 'Recurrentes', icono: 'repetir', ruta: null, prefijos: [] },
      { id: 'rectificativas', etiqueta: 'Rectificativas', icono: 'anular', ruta: null, prefijos: [] },
      { id: 'cobros', etiqueta: 'Cobros', icono: 'tesoreria', ruta: null, prefijos: [] },
      { id: 'productos', etiqueta: 'Productos y servicios', icono: 'lista', ruta: null, prefijos: [] },
      { id: 'series', etiqueta: 'Series y plantillas', icono: 'predefinidos', ruta: null, prefijos: [] },
    ],
  },
  {
    id: 'compras', etiqueta: 'Compras y gastos', icono: 'compras', ruta: R.compras, prefijos: [], periodo: 100,   // «Oct 2026»
    pestanas: [
      { id: 'por-revisar', etiqueta: 'Por revisar', icono: 'bandeja', ruta: R.compras, prefijos: [R.compras] },
      { id: 'recibidas', etiqueta: 'Facturas recibidas', icono: 'recibida', ruta: R.documentos, prefijos: [R.documentos] },
      { id: 'recurrentes', etiqueta: 'Recurrentes', icono: 'repetir', ruta: null, prefijos: [] },
      { id: 'pagos', etiqueta: 'Pagos', icono: 'pagos', ruta: null, prefijos: [] },
      { id: 'liquidaciones', etiqueta: 'Liquidaciones', icono: 'documento', ruta: R.liquidacionNueva, prefijos: [`${R.compras}/liquidacion`, `${R.documentos}/catcher`], solo: 'hosteleria' },
    ],
  },
  {
    id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: R.bancos, prefijos: [], portadaMovil: true, periodo: 100,
    pestanas: [
      { id: 'movimientos', etiqueta: 'Movimientos', icono: 'movimientos', ruta: R.bancos, prefijos: [R.bancos] },
      { id: 'reglas', etiqueta: 'Reglas', icono: 'reglas', ruta: `${R.bancos}/reglas`, prefijos: [`${R.bancos}/reglas`] },
      { id: 'cuentas', etiqueta: 'Cuentas y extractos', icono: 'cuentas', ruta: `${R.bancos}/cuentas`, prefijos: [`${R.bancos}/cuentas`] },
      { id: 'cierre', etiqueta: 'Cierre del mes', icono: 'candado', ruta: `${R.bancos}/cierre`, prefijos: [`${R.bancos}/cierre`] },
    ],
  },
  { id: 'laboral', etiqueta: 'Laboral', icono: 'laboral', ruta: null, prefijos: [], interruptor: 'conta_laboral', pestanas: [] },
  // I01b · Impuestos (tableros 8, 9 y 10), con su interruptor por cuenta. El IVA de un
  // periodo (impuestos/iva/…) cuelga del Calendario.
  {
    id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', ruta: R.impuestos, prefijos: [], interruptor: 'conta_impuestos',
    pestanas: [
      // P01 · Lo primero para una asesoría: los impuestos de todos sus clientes.
      { id: 'clientes', etiqueta: 'Tus clientes', icono: 'maletin', ruta: `${R.impuestos}/clientes`, prefijos: [`${R.impuestos}/clientes`], solo: 'asesoria' },
      { id: 'calendario', etiqueta: 'Calendario', icono: 'fecha', ruta: R.impuestos, prefijos: [R.impuestos] },
      // I01c · El trimestre (maqueta_303_v2): sin año ni trimestre, el último acabado.
      { id: 'trimestre', etiqueta: 'Trimestre', icono: 'cuadricula', ruta: `${R.impuestos}/trimestre`, prefijos: [`${R.impuestos}/trimestre`, `${R.impuestos}/empresa`] },
      { id: 'presentados', etiqueta: 'Presentados', icono: 'presentado', ruta: `${R.impuestos}/presentados`, prefijos: [`${R.impuestos}/presentados`] },
      { id: 'sociedades', etiqueta: 'Impuesto de sociedades', icono: 'graficas', ruta: `${R.impuestos}/sociedades`, prefijos: [`${R.impuestos}/sociedades`] },
      { id: 'certificados', etiqueta: 'Certificados', icono: 'certificado', ruta: `${R.impuestos}/certificados`, prefijos: [`${R.impuestos}/certificados`] },
    ],
  },
  {
    id: 'contactos', etiqueta: 'Contactos', icono: 'contactos', ruta: R.terceros, prefijos: [],
    pestanas: [
      // Paso 3: los papeles de la lista (antes, sus filtros en la pantalla) pasan a pestañas.
      // Plataformas y Socios de marca, solo con hostelería (inventario §3; en otra empresa
      // siguen en «Todos»: ninguna fila se esconde, regla 7).
      { id: 'todos', etiqueta: 'Todos', icono: 'contactos', ruta: R.terceros, prefijos: [R.terceros] },
      { id: 'clientes', etiqueta: 'Clientes', icono: 'cliente', ruta: `${R.terceros}?ver=clientes`, prefijos: [R.terceros], ver: 'clientes' },
      { id: 'proveedores', etiqueta: 'Proveedores', icono: 'proveedor', ruta: `${R.terceros}?ver=proveedores`, prefijos: [R.terceros], ver: 'proveedores' },
      { id: 'plataformas', etiqueta: 'Plataformas', icono: 'plataforma', ruta: `${R.terceros}?ver=plataformas`, prefijos: [R.terceros], ver: 'plataformas', solo: 'hosteleria' },
      { id: 'socios', etiqueta: 'Socios de marca', icono: 'socio', ruta: `${R.terceros}?ver=socios`, prefijos: [R.terceros], ver: 'socios', solo: 'hosteleria' },
    ],
  },
  {
    id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: R.empresa, prefijos: [R.alta], abajo: true,
    pestanas: [
      { id: 'empresa', etiqueta: 'Empresa', icono: 'empresa', ruta: R.empresa, prefijos: [R.empresa] },
      { id: 'usuarios', etiqueta: 'Usuarios', icono: 'laboral', ruta: null, prefijos: [] },
      { id: 'registro-ia', etiqueta: 'Registro de la IA', icono: 'ia', ruta: `${R.empresa}/folvy`, prefijos: [`${R.empresa}/folvy`] },
    ],
  },
]

const cumple = (c: Condicion | undefined, ctx: Contexto) => !c || (c === 'hosteleria' ? ctx.hosteleria : c === 'diez' ? ctx.diez : ctx.asesoria === true)

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
export function dondeEsta(pathname: string, lista: Producto[] = PRODUCTOS, search = ''): { producto: Producto; pestana: Pestana | null } | null {
  const rel = relativa(pathname)
  // Una pestaña con `ver` solo vale si la dirección lo pide, y entonces gana a la de serie
  // del mismo prefijo (en la ficha, sin `ver`, se marca la de serie).
  const ver = new URLSearchParams(search).get('ver')
  let mejor: { producto: Producto; pestana: Pestana | null; largo: number } | null = null
  for (const producto of lista) {
    for (const x of producto.prefijos) if (casa(rel, x) && (!mejor || x.length > mejor.largo)) mejor = { producto, pestana: null, largo: x.length }
    for (const pestana of producto.pestanas) for (const x of pestana.prefijos) {
      if (!casa(rel, x)) continue
      if (pestana.ver && (pestana.ver !== ver || rel !== x)) continue
      const largo = x.length + (pestana.ver ? 0.5 : 0)
      if (!mejor || largo > mejor.largo) mejor = { producto, pestana, largo }
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
 *
 * S01e · `anchosActiva[i]`: lo que mide el botón de «Más» si la pestaña i va
 * dentro y es la activa («Cierre y Registro ▾»). Se reserva el de la más ancha
 * de las que irían dentro: así la activa no lo ensancha ni pisa «Buscar», y
 * cuántas caben no depende de en qué pestaña se esté.
 */
export function cuantasCaben(anchos: number[], disponible: number, anchoMas: number, hueco = 0, anchosActiva: number[] = []): number {
  const total = anchos.reduce((s, a, i) => s + a + (i ? hueco : 0), 0)
  if (total <= disponible) return anchos.length
  // De atrás adelante: con más pestañas fuera, el botón de «Más» puede tener que ser más ancho.
  const masDesde: number[] = new Array(anchos.length + 1).fill(anchoMas)
  for (let i = anchos.length - 1; i >= 0; i--) masDesde[i] = Math.max(masDesde[i + 1], anchosActiva[i] ?? 0)
  let caben = 0
  let usado = 0
  for (let i = 0; i < anchos.length; i++) {
    usado += anchos[i] + hueco
    if (usado + masDesde[i + 1] <= disponible) caben = i + 1
  }
  return caben
}

/**
 * S01e · El ancho para las pestañas: el que hay, menos lo que le falta al hueco
 * del ejercicio y el mes para llegar a su reserva. En un producto que lo lleva
 * en unas pantallas y en otras no (Contabilidad), las pestañas caben igual en
 * todas y «Más ▾» no cambia de sitio.
 */
export function anchoParaPestanas(hay: number, periodo: number, reserva: number): number {
  return Math.max(0, hay - Math.max(0, reserva - periodo))
}
