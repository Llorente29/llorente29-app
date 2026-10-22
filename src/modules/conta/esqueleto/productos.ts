// src/modules/conta/esqueleto/productos.ts
//
// Los apartados de la barra y sus páginas. De aquí salen la barra lateral (y
// su cajón en el móvil), las páginas que se despliegan bajo el apartado activo
// y qué apartado y qué página están activos para cada dirección. Núcleo puro:
// se prueba sin React.
//
// S02 · Patrón único (Julio, 22/10, tablero 0 «El mapa»):
//   Inicio · Contabilidad · Facturación · Compras y gastos · Bancos · Laboral ·
//   Impuestos · Contactos · (abajo) Favoritos · Ajustes
// Y, solo en una cuenta que es asesoría, «Clientes del despacho» arriba del
// todo: para el asesor es su Inicio (respuesta de Julio al paso 1 del S02).
// Las páginas de cada apartado ya no van en pestañas de la cabecera: el
// apartado activo se abre en la barra y enseña sus páginas debajo.
//
// Tres reglas (S01, se quedan):
//   1. Las pantallas NO cambian de dirección: cada página dice qué direcciones
//      son suyas (`prefijos`) y gana el prefijo más largo.
//   2. Nada vacío delante del cliente: un apartado o una página sin pantalla
//      (`ruta: null`) no sale. Facturación, Laboral e Impuestos llevan además
//      su interruptor por cuenta en `feature_flags`.
//   3. Hostelería, Diez y la asesoría son de la EMPRESA o de la CUENTA: lo que
//      solo tiene sentido con ellas solo sale si lo tienen.
// Y una del S02: los grupos de la barra (Finanzas · Personas · Operaciones)
// están previstos en cada apartado (`grupo`), pero NO se pintan hasta que
// entren más apartados (encargo S02, «Barra lateral»).

import { CONTA, INDICE_AJUSTES } from '@/config/navegacion'
import type { NombreIcono } from '@/modules/conta/diseno/iconos'

export type IdProducto = 'despacho' | 'inicio' | 'contabilidad' | 'facturacion' | 'compras' | 'bancos' | 'laboral' | 'impuestos' | 'contactos' | 'ajustes'

/** Lo que solo sale si la empresa (o la cuenta) lo tiene. */
export type Condicion = 'hosteleria' | 'diez' | 'asesoria'

export type Interruptor = 'conta_facturacion' | 'conta_laboral' | 'conta_impuestos'
export const INTERRUPTORES: readonly Interruptor[] = ['conta_facturacion', 'conta_laboral', 'conta_impuestos']

/** S02 · Los grupos de la barra, previstos y sin pintar (encargo S02). */
export type GrupoBarra = 'finanzas' | 'personas' | 'operaciones'
export const NOMBRE_GRUPO: Record<GrupoBarra, string> = { finanzas: 'Finanzas', personas: 'Personas', operaciones: 'Operaciones' }

/** Una página de un apartado (hasta el S02, una «pestaña» de la cabecera). */
export interface Pestana {
  id: string
  etiqueta: string
  icono: NombreIcono
  /** Dirección relativa al módulo; null = aún no tiene pantalla (no sale). */
  ruta: string | null
  /** Las direcciones que caen en esta página. */
  prefijos: string[]
  solo?: Condicion
  /**
   * La página es una vista de la misma pantalla (`?ver=`): Contactos. Se marca
   * cuando la dirección la pide; la que no lleva `ver` es la de serie.
   */
  ver?: string
  /** La página existe pero aún dice «aún no» (Ajustes): no sale en el producto vendido solo. */
  hueco?: boolean
}

export interface Producto {
  id: IdProducto
  etiqueta: string
  icono: NombreIcono
  /** Dirección de entrada; null = sin pantalla (no sale). */
  ruta: string | null
  /** Direcciones del apartado que no son de ninguna página (la portada, el alta). */
  prefijos: string[]
  pestanas: Pestana[]
  interruptor?: Interruptor
  /** El apartado entero solo sale si la empresa o la cuenta lo tiene (el despacho). */
  solo?: Condicion
  /** Va abajo del todo en la barra (Ajustes). */
  abajo?: boolean
  /** S02 · Su grupo, cuando la barra se agrupe (hoy no se pinta). */
  grupo?: GrupoBarra
  /**
   * En el móvil, la pantalla va por niveles (patrón M4: portada con sus
   * apartados y «‹ Volver»). Bancos.
   */
  portadaMovil?: boolean
}

/** Lo que decide qué sale: de la empresa activa y de la cuenta. */
export interface Contexto {
  hosteleria: boolean
  diez: boolean
  interruptores: ReadonlySet<string>
  /** S01 · El logo de la empresa (URL firmada del bucket company-logos), o null. No decide qué sale. */
  logoEmpresa?: string | null
  /** S02 · El color que eligió la empresa (company.color, '#RRGGBB'), o null. No decide qué sale. */
  colorEmpresa?: string | null
  /**
   * S01 · Los ejes de analítica encendidos de la empresa (conta_eje_analitico):
   * null = no se han podido leer: todo sale, como antes.
   */
  analitica?: Analitica | null
  /** P01 · La CUENTA es una asesoría o ya lleva clientes con permiso. Sin leer, no lo es. */
  asesoria?: boolean
  /** S02 · El producto vendido solo (C06): sin las páginas que aún dicen «aún no». */
  solo?: boolean
}

/** Un eje de analítica encendido, con el nombre que le da la empresa. */
export interface EjeVista { nombre: string; plural: string }
/** Los dos ejes; null = apagado (ni se pide ni se enseña; lo guardado se queda). */
export interface Analitica { local: EjeVista | null; marca: EjeVista | null }

const R = CONTA.rutas

/**
 * S02 · Las páginas de Ajustes son las entradas de su índice (C02), menos las
 * que son de Contabilidad › Definiciones (el plan, las tablas y la numeración,
 * que vive en las tablas): una cosa, un solo sitio.
 */
const DE_DEFINICIONES = new Set(['plan', 'tablas', 'numeracion'])
const PAGINAS_AJUSTES: Pestana[] = INDICE_AJUSTES.flatMap((g) => g.entradas)
  .filter((e) => !DE_DEFINICIONES.has(e.id))
  .map((e): Pestana => ({
    id: e.id, etiqueta: e.etiqueta, icono: e.id === 'folvy' ? 'ia' : e.id === 'empresa' ? 'empresa' : e.id === 'personas' ? 'usuarios' : e.id === 'avisos' ? 'avisos' : e.id === 'impuestos' ? 'impuestos' : e.id === 'socios' ? 'socios' : e.id === 'ejercicio' ? 'fecha' : 'ajustes',
    ruta: e.ruta,
    // «Tu empresa» es también la portada de Ajustes (la dirección «ajustes» a secas).
    prefijos: e.id === 'empresa' ? [R.empresa, e.ruta] : [e.ruta],
    hueco: !!e.hueco,
  }))

export const PRODUCTOS: Producto[] = [
  // S02 · Solo en una cuenta que es asesoría: la cartera de sus clientes, arriba del todo.
  {
    id: 'despacho', etiqueta: 'Clientes del despacho', icono: 'despacho', ruta: `${R.impuestos}/clientes`,
    prefijos: [`${R.impuestos}/clientes`], solo: 'asesoria', pestanas: [],
  },
  { id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: R.inicio, prefijos: [R.inicio], pestanas: [] },
  {
    id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'contabilidad', ruta: R.libroDiario, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'asientos', etiqueta: 'Asientos', icono: 'asientos', ruta: R.libroDiario, prefijos: [R.libroDiario] },
      {
        id: 'listados', etiqueta: 'Libros y listados', icono: 'listados', ruta: `${R.libros}/mayor/libro-mayor`,
        prefijos: [R.libros, R.diarioResumido, `${R.libros}/mayor`, `${R.libros}/registro`, `${R.libros}/balances`, 'plan'],
      },
      { id: 'definiciones', etiqueta: 'Definiciones', icono: 'definiciones', ruta: R.plan, prefijos: [R.plan, R.tablas, R.analitica] },
      { id: 'cierre', etiqueta: 'Cierre y Registro', icono: 'cierre', ruta: `${R.libros}/cierre/ejercicios`, prefijos: [`${R.libros}/cierre`, `${R.libros}/anuales`] },
      { id: 'importar', etiqueta: 'Importar', icono: 'importar', ruta: R.pendientesDiez, prefijos: [R.pendientesDiez], solo: 'diez' },
    ],
  },
  {
    // S02 · Facturas emitidas · Cobros · Series. Aún sin pantalla: no sale.
    id: 'facturacion', etiqueta: 'Facturación', icono: 'facturacion', ruta: null, prefijos: [], interruptor: 'conta_facturacion', grupo: 'finanzas',
    pestanas: [
      { id: 'emitidas', etiqueta: 'Facturas emitidas', icono: 'facturas', ruta: null, prefijos: [] },
      { id: 'cobros', etiqueta: 'Cobros', icono: 'cobros', ruta: null, prefijos: [] },
      { id: 'series', etiqueta: 'Series', icono: 'plantillas', ruta: null, prefijos: [] },
    ],
  },
  {
    // S02 · Facturas recibidas · Tickets · Pagos · Liquidaciones. Tickets y Pagos aún sin pantalla.
    // «Por revisar» (las recepciones de Cocina que esperan factura, compras/) cuelga de
    // Facturas recibidas: es de donde salen esas facturas.
    id: 'compras', etiqueta: 'Compras y gastos', icono: 'compras', ruta: R.documentos, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'recibidas', etiqueta: 'Facturas recibidas', icono: 'recibida', ruta: R.documentos, prefijos: [R.documentos, R.compras] },
      { id: 'tickets', etiqueta: 'Tickets', icono: 'documento', ruta: null, prefijos: [] },
      { id: 'pagos', etiqueta: 'Pagos', icono: 'pagos', ruta: null, prefijos: [] },
      { id: 'liquidaciones', etiqueta: 'Liquidaciones', icono: 'liquidaciones', ruta: R.liquidacionNueva, prefijos: [`${R.compras}/liquidacion`, `${R.documentos}/catcher`], solo: 'hosteleria' },
    ],
  },
  {
    id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: R.bancos, prefijos: [], portadaMovil: true, grupo: 'finanzas',
    pestanas: [
      { id: 'movimientos', etiqueta: 'Movimientos', icono: 'movimientos', ruta: R.bancos, prefijos: [R.bancos] },
      { id: 'cuentas', etiqueta: 'Cuentas y extractos', icono: 'cuentasBanco', ruta: `${R.bancos}/cuentas`, prefijos: [`${R.bancos}/cuentas`] },
      { id: 'reglas', etiqueta: 'Reglas', icono: 'reglas', ruta: `${R.bancos}/reglas`, prefijos: [`${R.bancos}/reglas`] },
      // Se muda a Contabilidad › Cierre y Registro en el PR 2 del S02.
      { id: 'cierre', etiqueta: 'Cierre del mes', icono: 'cierreMes', ruta: `${R.bancos}/cierre`, prefijos: [`${R.bancos}/cierre`] },
    ],
  },
  {
    // S02 · Empleados · Nóminas · Seguros sociales · Fichajes y ausencias · Portal del empleado. Aún sin pantalla: no sale.
    id: 'laboral', etiqueta: 'Laboral', icono: 'laboral', ruta: null, prefijos: [], interruptor: 'conta_laboral', grupo: 'personas',
    pestanas: [
      { id: 'empleados', etiqueta: 'Empleados', icono: 'usuarios', ruta: null, prefijos: [] },
      { id: 'nominas', etiqueta: 'Nóminas', icono: 'facturas', ruta: null, prefijos: [] },
      { id: 'seguros', etiqueta: 'Seguros sociales', icono: 'certificados', ruta: null, prefijos: [] },
      { id: 'fichajes', etiqueta: 'Fichajes y ausencias', icono: 'fecha', ruta: null, prefijos: [] },
      { id: 'portal', etiqueta: 'Portal del empleado', icono: 'clientes', ruta: null, prefijos: [] },
    ],
  },
  // I01b · Impuestos, con su interruptor por cuenta. El IVA de un periodo (impuestos/iva/…)
  // cuelga del Calendario. Sus páginas pasan a Calendario · Declaraciones · Certificados en el PR 3 del S02.
  {
    id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', ruta: R.impuestos, prefijos: [], interruptor: 'conta_impuestos', grupo: 'finanzas',
    pestanas: [
      { id: 'calendario', etiqueta: 'Calendario', icono: 'fecha', ruta: R.impuestos, prefijos: [R.impuestos] },
      { id: 'trimestre', etiqueta: 'Trimestre', icono: 'trimestre', ruta: `${R.impuestos}/trimestre`, prefijos: [`${R.impuestos}/trimestre`, `${R.impuestos}/empresa`] },
      { id: 'presentados', etiqueta: 'Presentados', icono: 'presentados', ruta: `${R.impuestos}/presentados`, prefijos: [`${R.impuestos}/presentados`] },
      { id: 'sociedades', etiqueta: 'Impuesto de sociedades', icono: 'empresa', ruta: `${R.impuestos}/sociedades`, prefijos: [`${R.impuestos}/sociedades`] },
      { id: 'certificados', etiqueta: 'Certificados', icono: 'certificados', ruta: `${R.impuestos}/certificados`, prefijos: [`${R.impuestos}/certificados`] },
    ],
  },
  {
    id: 'contactos', etiqueta: 'Contactos', icono: 'contactos', ruta: R.terceros, prefijos: [], grupo: 'operaciones',
    pestanas: [
      // Plataformas y Socios de marca, solo con hostelería (en otra empresa siguen en «Todos»:
      // ninguna fila se esconde, regla 7).
      { id: 'todos', etiqueta: 'Todos', icono: 'contactos', ruta: R.terceros, prefijos: [R.terceros] },
      { id: 'clientes', etiqueta: 'Clientes', icono: 'clientes', ruta: `${R.terceros}?ver=clientes`, prefijos: [R.terceros], ver: 'clientes' },
      { id: 'proveedores', etiqueta: 'Proveedores', icono: 'proveedores', ruta: `${R.terceros}?ver=proveedores`, prefijos: [R.terceros], ver: 'proveedores' },
      { id: 'plataformas', etiqueta: 'Plataformas', icono: 'plataformas', ruta: `${R.terceros}?ver=plataformas`, prefijos: [R.terceros], ver: 'plataformas', solo: 'hosteleria' },
      { id: 'socios', etiqueta: 'Socios de marca', icono: 'socios', ruta: `${R.terceros}?ver=socios`, prefijos: [R.terceros], ver: 'socios', solo: 'hosteleria' },
    ],
  },
  // S02 · Ajustes es un apartado con sus páginas (las de su índice), abajo, con Favoritos.
  { id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: R.empresa, prefijos: [R.alta], abajo: true, pestanas: PAGINAS_AJUSTES },
]

const cumple = (c: Condicion | undefined, ctx: Contexto) => !c || (c === 'hosteleria' ? ctx.hosteleria : c === 'diez' ? ctx.diez : ctx.asesoria === true)

/** Las páginas que salen: con pantalla y, si piden algo de la empresa, que lo tenga. */
export function pestanasVisibles(p: Producto, ctx: Contexto): Pestana[] {
  return p.pestanas.filter((t) => t.ruta !== null && cumple(t.solo, ctx) && !(t.hueco && ctx.solo))
}

/** ¿Sale el apartado? Con pantalla, si lleva interruptor encendido, y si pide algo de la cuenta, que lo tenga. */
export function productoVisible(p: Producto, ctx: Contexto): boolean {
  if (p.ruta === null) return false
  if (p.interruptor && !ctx.interruptores.has(p.interruptor)) return false
  return cumple(p.solo, ctx)
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

/** Todos los prefijos de un apartado: los suyos y los de sus páginas. */
const prefijosDe = (p: Producto) => [...p.prefijos, ...p.pestanas.flatMap((t) => t.prefijos)]

/**
 * El apartado y la página de una dirección: los del prefijo más largo, mirando
 * TODAS las páginas (también las que no salen: una dirección de una página
 * oculta sigue siendo de su apartado, y la barra no marca ninguna).
 */
export function dondeEsta(pathname: string, lista: Producto[] = PRODUCTOS, search = ''): { producto: Producto; pestana: Pestana | null } | null {
  const rel = relativa(pathname)
  // Una página con `ver` solo vale si la dirección lo pide, y entonces gana a la de serie
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

/** Todas las direcciones que son de algún apartado (las prueba la unitaria contra CONTA.rutas). */
export const TODOS_LOS_PREFIJOS = PRODUCTOS.flatMap(prefijosDe)
