// src/modules/conta/esqueleto/ordenes.ts
//
// S01 · El catálogo de ÓRDENES: todo lo que se puede pedir desde el esqueleto,
// con un id que no cambia. De aquí salen la cinta de cada pestaña, los
// Favoritos (se guarda el id, no la dirección) y, en el paso 4, la paleta de
// Ctrl K. Un solo sitio: la cinta y la paleta no pueden decir cosas distintas.
//
// Dos clases de orden:
//   · las de la cinta: «Expedida», «Para revisar», «Búsqueda»…;
//   · una por pestaña («ir a Libros y listados»), para fijar una pantalla.
//
// La cinta de cada pestaña, por grupos con su nombre (maqueta 1: NUEVO ·
// REVISAR · UTILIDADES). Las pestañas pasan a la cinta según se mudan sus
// pantallas (paso 3): una pestaña sin cinta aún pinta su propia barra, y así no
// sale lo mismo dos veces.
//
// «Vigilancia» y «Anular» de la maqueta no están: Vigilancia no tiene pantalla
// todavía, y Anular es del asiento abierto (su botón está en el asiento). No
// se pinta un botón que no lleva a nada (regla del encargo: nada vacío).

import { CONSULTA_RECIBIDA_A_MANO, CONTA, rutaConta, rutaLibros } from '@/config/navegacion'
import { AREAS_LIBROS } from '@/modules/conta/libros/navegacion'
import { TABLAS_GENERALES } from '@/modules/conta/tablas/registro'
import { HECHO_POR, LO_HECHO } from '@/modules/conta/bancos/marca'
import type { NombreIcono } from '@/modules/conta/diseno/iconos'
import { PRODUCTOS, pestanasVisibles, productoVisible, type Condicion, type Contexto, type IdProducto } from './productos'

export interface Orden {
  id: string
  etiqueta: string
  icono?: NombreIcono
  producto: IdProducto
  /** La pestaña donde vive (la cinta) y la que se marca. */
  pestana: string
  /** A dónde lleva, relativa al módulo (con su consulta); o qué hace. */
  a: { ruta: string } | { accion: 'buscar' }
  /** Palabras con las que también se encuentra (la paleta, paso 4). */
  sinonimos?: string[]
  solo?: Condicion
}

export interface GrupoCinta {
  titulo: string
  ordenes: string[]
  /** El grupo lo llena la pantalla (useEntradasEnCinta) con lo que solo ella sabe: los bancos de la empresa. */
  dePantalla?: string
}

const R = CONTA.rutas

const DE_LA_CINTA: Orden[] = [
  // Contabilidad › Asientos · NUEVO. Lo que aún no tiene su pantalla propia
  // (expedida, tesorería, predefinidos) abre el asiento a mano con su tipo.
  { id: 'asiento.expedida', etiqueta: 'Expedida', icono: 'expedida', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.nuevoAsiento}?tipo=expedida` }, sinonimos: ['nueva expedida', 'factura emitida'] },
  { id: 'asiento.recibida', etiqueta: 'Recibida', icono: 'recibida', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.recibidasEnAsientos }, sinonimos: ['nueva recibida', 'factura recibida', 'factura de proveedor'] },
  // S01d: la recibida sin papel, escrita a mano (proveedor, número, fecha, base e IVA).
  { id: 'asiento.recibida-a-mano', etiqueta: 'Recibida a mano', icono: 'nuevo', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.recibidasEnAsientos}?${CONSULTA_RECIBIDA_A_MANO}` }, sinonimos: ['nueva recibida a mano', 'factura sin papel', 'dar de alta una factura'] },
  { id: 'asiento.tesoreria', etiqueta: 'Tesorería', icono: 'tesoreria', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.nuevoAsiento}?tipo=tesoreria` }, sinonimos: ['cobro', 'pago'] },
  { id: 'asiento.general', etiqueta: 'General', icono: 'general', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.nuevoAsiento }, sinonimos: ['nuevo asiento', 'asiento a mano'] },
  { id: 'asiento.predefinidos', etiqueta: 'Predefinidos', icono: 'predefinidos', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.nuevoAsiento}?tipo=predefinido` }, sinonimos: ['plantilla', 'asiento tipo'] },
  // · REVISAR
  { id: 'asiento.para-revisar', etiqueta: 'Para revisar', icono: 'revisar', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.libroDiario}?ver=revisar` }, sinonimos: ['propuestos', 'pendientes'] },
  { id: 'asiento.libro-diario', etiqueta: 'Libro diario', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.libroDiario }, sinonimos: ['diario', 'asientos'] },
  // · UTILIDADES
  { id: 'asiento.busqueda', etiqueta: 'Búsqueda', icono: 'buscar', producto: 'contabilidad', pestana: 'asientos', a: { accion: 'buscar' }, sinonimos: ['buscar'] },
  { id: 'asiento.digitalizar', etiqueta: 'Digitalizar', icono: 'digitalizar', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.documentos }, sinonimos: ['subir factura', 'escanear'] },

  // Bancos (paso 3; antes, la barra de B01 en la pantalla). «Tus bancos» los
  // pone la pantalla: son los de la empresa (dePantalla en CINTAS).
  { id: 'bancos.subir', etiqueta: 'Subir extracto', icono: 'subir', producto: 'bancos', pestana: 'movimientos', a: { ruta: `${R.bancos}/subir` }, sinonimos: ['extracto', 'norma 43', 'n43', 'excel', 'importar movimientos'] },
  { id: 'bancos.reglas', etiqueta: 'Reglas', icono: 'ia', producto: 'bancos', pestana: 'reglas', a: { ruta: `${R.bancos}/reglas` }, sinonimos: ['aprender', 'siempre', 'concepto'] },
  { id: 'bancos.casados', etiqueta: HECHO_POR, icono: 'ok', producto: 'bancos', pestana: 'movimientos', a: { ruta: `${R.bancos}?ver=casados` }, sinonimos: ['casado solo', 'automatico', 'deshacer'] },
  // Compras y gastos (paso 3). «Por revisar» (N18) sube con su diálogo
  // (?subir); Facturas recibidas (N22) pone sus grupos desde la pantalla.
  { id: 'compras.subir', etiqueta: 'Subir una factura', icono: 'subir', producto: 'compras', pestana: 'por-revisar', a: { ruta: `${R.compras}?subir=` }, sinonimos: ['subir factura', 'factura de proveedor', 'albaran'] },
  // Contactos (paso 3): «Nuevo cliente», con el diálogo de siempre (?nuevo).
  { id: 'contactos.nuevo', etiqueta: 'Nuevo cliente', icono: 'nuevo', producto: 'contactos', pestana: 'todos', a: { ruta: `${R.terceros}?nuevo=` }, sinonimos: ['alta cliente', 'nuevo contacto', 'crear cliente'] },
  // S01d: y «Nuevo proveedor», con el alta de Proveedores (?nuevo=proveedor).
  { id: 'contactos.nuevo-proveedor', etiqueta: 'Nuevo proveedor', icono: 'nuevo', producto: 'contactos', pestana: 'todos', a: { ruta: `${R.terceros}?nuevo=proveedor` }, sinonimos: ['alta proveedor', 'crear proveedor', 'dar de alta un proveedor'] },
  { id: 'bancos.hecho', etiqueta: LO_HECHO, icono: 'revisar', producto: 'bancos', pestana: 'movimientos', a: { ruta: `${R.bancos}/hecho` }, sinonimos: ['hecho', 'registro', 'deshacer'] },
]

/**
 * Las acciones de Libros (C05), sacadas de AREAS_LIBROS (una sola lista): cada
 * una a su pestaña de Contabilidad. Fuera de la cinta: el libro diario (es
 * Asientos), PDF y Excel (van en la acción, no son entradas) y lo que aún no
 * tiene pantalla (Registro Mercantil, C05b: nada vacío).
 */
const PESTANA_DE_AREA: Record<string, string> = {
  diario: 'listados', mayor: 'listados', registro: 'listados', balances: 'listados', anuales: 'cierre', cierre: 'cierre',
}
const FUERA_DE_LA_CINTA = new Set(['libro-diario', 'balances-pdf', 'balances-excel'])
const sinModulo = (absoluta: string) => absoluta.replace(new RegExp(`^/${CONTA.modulo}/`), '')
const DE_LIBROS: Orden[] = AREAS_LIBROS.flatMap((area) => area.grupos.flatMap((g) => g.acciones
  .filter((x) => !x.c05b && !FUERA_DE_LA_CINTA.has(x.id))
  .map((x): Orden => ({
    id: `libros.${x.id}`, etiqueta: x.nombre, producto: 'contabilidad',
    pestana: x.id === 'pendientes-diez' ? 'importar' : PESTANA_DE_AREA[area.id],
    a: { ruta: sinModulo(rutaLibros(area.id, x.id)) }, sinonimos: x.sinonimos, solo: x.id === 'pendientes-diez' ? 'diez' : undefined,
  }))))

/**
 * Contabilidad › Definiciones (paso 3): el plan, las nueve tablas generales
 * (sacadas de TABLAS_GENERALES: una sola lista) y la analítica.
 */
const DE_DEFINICIONES: Orden[] = [
  { id: 'def.plan', etiqueta: 'Plan contable', icono: 'contabilidad', producto: 'contabilidad', pestana: 'definiciones', a: { ruta: R.plan }, sinonimos: ['cuentas', 'pgc', 'subcuentas'] },
  { id: 'def.sitio', etiqueta: 'Qué va a cada sitio', producto: 'contabilidad', pestana: 'definiciones', a: { ruta: R.planSitio }, sinonimos: ['dónde va', 'a qué cuenta'] },
  ...TABLAS_GENERALES.map((t): Orden => ({
    id: `def.tabla.${t.id}`, etiqueta: t.titulo, producto: 'contabilidad', pestana: 'definiciones',
    a: { ruta: R.tabla.replace(':tabla', t.id) }, sinonimos: [t.singular],
  })),
  { id: 'def.analitica', etiqueta: 'Analítica', icono: 'graficas', producto: 'contabilidad', pestana: 'definiciones', a: { ruta: R.analitica }, sinonimos: ['local', 'marca', 'centro de coste', 'proyecto', 'ejes'] },
]

/** Una orden por pestaña: «ir a…», para fijar una pantalla en Favoritos. */
const DE_PESTANA: Orden[] = PRODUCTOS.flatMap((p) => p.pestanas.length > 0
  ? p.pestanas.filter((t) => t.ruta !== null).map((t): Orden => ({
      id: `ir.${p.id}.${t.id}`, etiqueta: p.pestanas.length > 1 ? `${p.etiqueta} › ${t.etiqueta}` : p.etiqueta,
      producto: p.id, pestana: t.id, a: { ruta: t.ruta! }, solo: t.solo,
    }))
  : p.ruta !== null ? [{ id: `ir.${p.id}`, etiqueta: p.etiqueta, producto: p.id, pestana: '', a: { ruta: p.ruta } }] : [])

export const ORDENES: Orden[] = [...DE_LA_CINTA, ...DE_LIBROS, ...DE_DEFINICIONES, ...DE_PESTANA]
const POR_ID = new Map(ORDENES.map((o) => [o.id, o]))
export const ordenPorId = (id: string): Orden | null => POR_ID.get(id) ?? null

const CINTA_BANCOS: GrupoCinta[] = [
  { titulo: 'Tus bancos', ordenes: [], dePantalla: 'bancos' },
  { titulo: 'Traer movimientos', ordenes: ['bancos.subir'] },
  { titulo: 'Automático', ordenes: ['bancos.reglas', 'bancos.casados'] },
  { titulo: 'Revisar', ordenes: ['bancos.hecho'] },
]

/** La cinta de cada pestaña ('producto.pestaña'). Sin entrada, la pestaña no lleva cinta. */
export const CINTAS: Record<string, GrupoCinta[]> = {
  'contabilidad.asientos': [
    { titulo: 'Nuevo', ordenes: ['asiento.expedida', 'asiento.recibida', 'asiento.recibida-a-mano', 'asiento.tesoreria', 'asiento.general', 'asiento.predefinidos'] },
    { titulo: 'Revisar', ordenes: ['asiento.para-revisar', 'asiento.libro-diario'] },
    { titulo: 'Utilidades', ordenes: ['asiento.busqueda', 'asiento.digitalizar'] },
  ],
  // Paso 3: las áreas de Libros, en la cinta de su pestaña (antes, áreas y segunda fila en la pantalla).
  'contabilidad.listados': [
    { titulo: 'Diario', ordenes: ['libros.diario-resumido'] },
    { titulo: 'Mayor', ordenes: ['libros.libro-mayor', 'libros.sumas-saldos', 'libros.acumulados'] },
    // Estados antes que IVA (medido a 1440 px con sus números): IVA, con siete
    // libros, va solo en la segunda fila y la cinta ocupa dos, no tres.
    { titulo: 'Estados', ordenes: ['libros.balance', 'libros.pyg', 'libros.ecpn'] },
    { titulo: 'IVA', ordenes: ['libros.expedidas', 'libros.recibidas', 'libros.intracomunitarias', 'libros.bienes-inversion', 'libros.suplidos', 'libros.formato-aeat'] },
    // S01e: el 111 y el 115 son retenciones de IRPF, no IVA: su propio grupo.
    { titulo: 'Retenciones', ordenes: ['libros.retenciones'] },
  ],
  'contabilidad.cierre': [
    { titulo: 'Cierre', ordenes: ['libros.ejercicios', 'libros.cerrar-mes', 'libros.cierre-ejercicio'] },
    { titulo: 'Cuentas anuales', ordenes: ['libros.cuentas-anuales', 'libros.mapeo'] },
  ],
  // Paso 3: Definiciones, que no tenía cinta: el plan, las tablas y la analítica.
  'contabilidad.definiciones': [
    { titulo: 'Plan', ordenes: ['def.plan', 'def.sitio'] },
    { titulo: 'Tablas', ordenes: TABLAS_GENERALES.map((t) => `def.tabla.${t.id}`) },
    { titulo: 'Analítica', ordenes: ['def.analitica'] },
  ],
  'contabilidad.importar': [
    { titulo: 'Diez', ordenes: ['libros.pendientes-diez'] },
  ],
  // Paso 3: Compras y gastos. Facturas recibidas: la barra de la N22 (TRAER ·
  // ESPERADAS · LEÍDAS), que depende de la empresa (el correo, Cocina): la pone la pantalla.
  'compras.por-revisar': [
    { titulo: 'Nuevo', ordenes: ['compras.subir'] },
  ],
  // S01e: los rótulos en palabras normales (antes TRAER · ESPERADAS · LEÍDAS, no se entendían).
  'compras.recibidas': [
    { titulo: 'Cómo llegan', ordenes: [], dePantalla: 'traer' },
    { titulo: 'Las que faltan', ordenes: [], dePantalla: 'esperadas' },
    { titulo: 'Apuntadas solas', ordenes: [], dePantalla: 'leidas' },
  ],
  // Paso 3: Contactos, la misma en todas sus pestañas.
  ...Object.fromEntries(['todos', 'clientes', 'proveedores', 'plataformas', 'socios'].map((t) => [`contactos.${t}`, [{ titulo: 'Nuevo', ordenes: ['contactos.nuevo', 'contactos.nuevo-proveedor'] }]])),
  // Paso 3: la barra de Bancos (B01), la misma en sus cuatro pestañas.
  'bancos.movimientos': CINTA_BANCOS,
  'bancos.reglas': CINTA_BANCOS,
  'bancos.cuentas': CINTA_BANCOS,
  'bancos.cierre': CINTA_BANCOS,
  // I01b · Impuestos: lo de la cabecera del tablero 8 («Ya presenté uno fuera», «Revisar y
  // presentar los de octubre»), que depende del mes y de lo que haya: lo pone la pantalla.
  'impuestos.calendario': [{ titulo: 'Presentar', ordenes: [], dePantalla: 'impuestos' }],
  // El tablero 10: «+ Añadir un certificado», solo para un administrador (lo pone la pantalla).
  'impuestos.certificados': [{ titulo: 'Certificado', ordenes: [], dePantalla: 'certificados' }],
}

/** ¿Se puede usar esta orden en esta empresa? (su producto sale, y su pestaña, y lo que pida). */
export function ordenDisponible(o: Orden, ctx: Contexto): boolean {
  const p = PRODUCTOS.find((x) => x.id === o.producto)
  if (!p || !productoVisible(p, ctx)) return false
  if (o.pestana && p.pestanas.length > 0 && !pestanasVisibles(p, ctx).some((t) => t.id === o.pestana)) return false
  return !o.solo || (o.solo === 'hosteleria' ? ctx.hosteleria : ctx.diez)
}

/** La cinta de una pestaña, con lo que no se puede usar aquí ya quitado; los grupos vacíos, fuera. */
export interface GrupoDeCinta { titulo: string; ordenes: Orden[]; dePantalla?: string }
export function cintaDe(producto: IdProducto, pestana: string | null, ctx: Contexto): GrupoDeCinta[] {
  if (!pestana) return []
  return (CINTAS[`${producto}.${pestana}`] ?? [])
    .map((g) => ({ titulo: g.titulo, ordenes: g.ordenes.map(ordenPorId).filter((o): o is Orden => !!o && ordenDisponible(o, ctx)), dePantalla: g.dePantalla }))
    .filter((g) => g.ordenes.length > 0 || !!g.dePantalla)
}

export interface Favorito { id: string; orden: Orden | null; disponible: boolean }

/**
 * Los favoritos guardados, en su orden. Uno que ya no existe en el catálogo o
 * que en esta empresa no se puede usar NO se esconde (regla 7): sale, y dice
 * por qué no se puede abrir. Quitarlo es cosa de la persona.
 */
export function favoritosDe(ids: readonly string[], ctx: Contexto): Favorito[] {
  return ids.map((id) => {
    const orden = ordenPorId(id)
    return { id, orden, disponible: !!orden && ordenDisponible(orden, ctx) }
  })
}

/** Fijar o quitar un favorito; sin repetidos y sin perder el orden de los demás. */
export function alternarFavorito(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/** ¿Lleva esta orden exactamente a donde se está (dirección y consulta)? */
export function esLaActual(o: Orden, pathname: string, search: string): boolean {
  if (!('ruta' in o.a)) return false
  const [ruta, consulta = ''] = o.a.ruta.split('?')
  const aqui = new URLSearchParams(search)
  const pide = new URLSearchParams(consulta)
  if (pathname.replace(/\/+$/, '') !== rutaConta(ruta)) return false
  // La consulta de la orden manda; lo demás de la dirección (el ejercicio) no cuenta.
  for (const [k, v] of pide) if (aqui.get(k) !== v) return false
  // Sin consulta, solo si la dirección tampoco pide una vista («Libro diario» no es «Para revisar»).
  return pide.toString() !== '' || !aqui.has('ver')
}

/**
 * Lo elegido viaja de una acción a otra: el ejercicio (Libros y el diario), el
 * mes y el banco (Bancos). La consulta de la orden manda sobre lo que viaja.
 */
const VIAJAN = ['ejercicio', 'mes', 'banco']
export function conConsulta(ruta: string, search: string): string {
  const [camino, propia = ''] = ruta.split('?')
  const aqui = new URLSearchParams(search)
  const q = new URLSearchParams(propia)
  for (const k of VIAJAN) { const v = aqui.get(k); if (v && !q.has(k)) q.set(k, v) }
  const t = q.toString()
  return t ? `${camino}?${t}` : camino
}
