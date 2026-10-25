// src/modules/conta/esqueleto/ordenes.ts
//
// S01 · El catálogo de ÓRDENES: todo lo que se puede pedir desde el marco,
// con un id que no cambia. De aquí salen las acciones de cada página, los
// Favoritos (se guarda el id, no la dirección) y la paleta de Ctrl K. Un solo
// sitio: la página y la paleta no pueden decir cosas distintas.
//
// Dos clases de orden:
//   · las de una página: «Expedida», «Para revisar», «Búsqueda»…;
//   · una por página («ir a Libros y listados»), para fijar una pantalla.
//
// S02 · Patrón único: se acabó la CINTA (grupos de botones con su título
// debajo). Los grupos de cada página se quedan como dato y el marco los pinta
// con la regla del patrón (marco/acciones.ts): un solo botón principal, azul;
// como mucho dos blancos; lo demás en «Más acciones ▾», con el título del
// grupo DENTRO del menú. Un grupo marcado `ver` no son acciones sino a dónde
// ir dentro de la página (los libros, las tablas): sale como «Ver: … ▾».
//
// «Vigilancia» y «Anular» de la maqueta no están: Vigilancia no tiene pantalla
// todavía, y Anular es del asiento abierto (su botón está en el asiento). No
// se pinta un botón que no lleva a nada (regla del encargo: nada vacío).

import { CONTA, rutaConta, rutaLibros } from '@/config/navegacion'
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
  /** S02 · El botón principal de su página (azul, uno solo por página). */
  principal?: boolean
}

export interface GrupoCinta {
  titulo: string
  ordenes: string[]
  /** El grupo lo llena la pantalla (useEntradasEnCinta) con lo que solo ella sabe: los bancos de la empresa. */
  dePantalla?: string
  /** S02 · No son acciones: son a dónde ir dentro de la página (sale como «Ver: … ▾»). */
  ver?: boolean
}

const R = CONTA.rutas

const DE_LA_CINTA: Orden[] = [
  // S02 · PR 2 · Cada cosa en su sitio (regla 1 del patrón). La emitida es de
  // Facturación › Facturas emitidas; las recibidas, de Compras y gastos. Los id se
  // quedan: los Favoritos guardados los nombran.
  { id: 'asiento.expedida', etiqueta: 'Nueva factura', icono: 'expedida', producto: 'facturacion', pestana: 'emitidas', a: { ruta: R.nuevaFacturaVenta }, sinonimos: ['expedida', 'nueva expedida', 'factura emitida', 'emitir factura', 'factura de venta', 'facturar'], principal: true },
  { id: 'asiento.recibida', etiqueta: 'Facturas recibidas por revisar', icono: 'recibida', producto: 'compras', pestana: 'recibidas', a: { ruta: `${R.documentos}?ver=por-revisar` }, sinonimos: ['recibida', 'nueva recibida', 'factura recibida', 'factura de proveedor'] },
  // S01d: la recibida sin papel, escrita a mano (proveedor, número, fecha, base e IVA).
  { id: 'asiento.recibida-a-mano', etiqueta: 'Escribir una a mano', icono: 'nuevo', producto: 'compras', pestana: 'recibidas', a: { ruta: R.recibidaAMano }, sinonimos: ['recibida a mano', 'nueva recibida a mano', 'factura sin fichero', 'dar de alta una factura'] },
  { id: 'asiento.tesoreria', etiqueta: 'Tesorería', icono: 'tesoreria', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.nuevoAsiento}?tipo=tesoreria` }, sinonimos: ['cobro', 'pago'] },
  { id: 'asiento.general', etiqueta: 'General', icono: 'general', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.nuevoAsiento }, sinonimos: ['nuevo asiento', 'asiento a mano'] },
  { id: 'asiento.predefinidos', etiqueta: 'Predefinidos', icono: 'predefinidos', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.nuevoAsiento}?tipo=predefinido` }, sinonimos: ['plantilla', 'asiento tipo'] },
  // · REVISAR
  { id: 'asiento.para-revisar', etiqueta: 'Para revisar', icono: 'revisar', producto: 'contabilidad', pestana: 'asientos', a: { ruta: `${R.libroDiario}?ver=revisar` }, sinonimos: ['propuestos', 'pendientes'] },
  { id: 'asiento.libro-diario', etiqueta: 'Libro diario', producto: 'contabilidad', pestana: 'asientos', a: { ruta: R.libroDiario }, sinonimos: ['diario', 'asientos'] },
  // · UTILIDADES
  { id: 'asiento.busqueda', etiqueta: 'Búsqueda', icono: 'buscar', producto: 'contabilidad', pestana: 'asientos', a: { accion: 'buscar' }, sinonimos: ['buscar'] },
  { id: 'asiento.digitalizar', etiqueta: 'Digitalizar', icono: 'digitalizar', producto: 'compras', pestana: 'recibidas', a: { ruta: `${R.documentos}?subir=1` }, sinonimos: ['subir factura', 'escanear'] },

  // Bancos (paso 3; antes, la barra de B01 en la pantalla). «Tus bancos» los
  // pone la pantalla: son los de la empresa (dePantalla en CINTAS).
  { id: 'bancos.subir', etiqueta: 'Subir extracto', icono: 'subir', producto: 'bancos', pestana: 'movimientos', a: { ruta: `${R.bancos}/subir` }, sinonimos: ['extracto', 'norma 43', 'n43', 'excel', 'importar movimientos'], principal: true },
  { id: 'bancos.reglas', etiqueta: 'Reglas', icono: 'ia', producto: 'bancos', pestana: 'reglas', a: { ruta: `${R.bancos}/reglas` }, sinonimos: ['aprender', 'siempre', 'concepto'] },
  { id: 'bancos.casados', etiqueta: HECHO_POR, icono: 'ok', producto: 'bancos', pestana: 'movimientos', a: { ruta: `${R.bancos}?ver=casados` }, sinonimos: ['casado solo', 'automatico', 'deshacer'] },
  // Compras y gastos. S02: un solo «Subir factura», en Facturas recibidas (regla 1 del patrón).
  { id: 'compras.subir', etiqueta: 'Subir factura', icono: 'subir', producto: 'compras', pestana: 'recibidas', a: { ruta: `${R.documentos}?subir=1` }, sinonimos: ['subir una factura', 'factura de proveedor', 'albaran', 'digitalizar'], principal: true },
  // Contactos (paso 3): «Nuevo cliente», con el diálogo de siempre (?nuevo).
  { id: 'contactos.nuevo', etiqueta: 'Nuevo cliente', icono: 'nuevo', producto: 'contactos', pestana: 'todos', a: { ruta: `${R.terceros}?nuevo=` }, sinonimos: ['alta cliente', 'nuevo contacto', 'crear cliente'], principal: true },
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
// V02: un apartado cuya entrada no es ninguna de sus páginas (Inicio, con Inicio ›
// Documentos debajo) conserva también su «ir a…» propio, y la página va con su nombre.
const entradaPropia = (p: (typeof PRODUCTOS)[number]) => p.ruta !== null && !p.pestanas.some((t) => t.ruta === p.ruta)
const DE_PESTANA: Orden[] = PRODUCTOS.flatMap((p) => [
  ...p.pestanas.filter((t) => t.ruta !== null).map((t): Orden => ({
    id: `ir.${p.id}.${t.id}`, etiqueta: p.pestanas.length > 1 || entradaPropia(p) ? `${p.etiqueta} › ${t.etiqueta}` : p.etiqueta,
    producto: p.id, pestana: t.id, a: { ruta: t.ruta! }, solo: t.solo ?? p.solo,
  })),
  ...((p.pestanas.length === 0 || entradaPropia(p)) && p.ruta !== null ? [{ id: `ir.${p.id}`, etiqueta: p.etiqueta, producto: p.id, pestana: '', a: { ruta: p.ruta }, solo: p.solo }] : []),
])

export const ORDENES: Orden[] = [...DE_LA_CINTA, ...DE_LIBROS, ...DE_DEFINICIONES, ...DE_PESTANA]
const POR_ID = new Map(ORDENES.map((o) => [o.id, o]))
export const ordenPorId = (id: string): Orden | null => POR_ID.get(id) ?? null

/** Las acciones de cada página ('producto.página'), por grupos. Sin entrada, la página no lleva. */
export const CINTAS: Record<string, GrupoCinta[]> = {
  'contabilidad.asientos': [
    // S02 · PR 2: la emitida y las recibidas, fuera (Facturación y Compras y gastos).
    { titulo: 'Nuevo', ordenes: ['asiento.tesoreria', 'asiento.general', 'asiento.predefinidos'] },
    { titulo: 'Revisar', ordenes: ['asiento.para-revisar', 'asiento.libro-diario'], ver: true },
    { titulo: 'Utilidades', ordenes: ['asiento.busqueda'] },
  ],
  // Paso 3: las áreas de Libros, en la cinta de su pestaña (antes, áreas y segunda fila en la pantalla).
  'contabilidad.listados': [
    { titulo: 'Diario', ordenes: ['libros.diario-resumido'], ver: true },
    { titulo: 'Mayor', ordenes: ['libros.libro-mayor', 'libros.sumas-saldos', 'libros.acumulados'], ver: true },
    // Estados antes que IVA (medido a 1440 px con sus números): IVA, con siete
    // libros, va solo en la segunda fila y la cinta ocupa dos, no tres.
    { titulo: 'Estados', ordenes: ['libros.balance', 'libros.pyg', 'libros.ecpn'], ver: true },
    { titulo: 'IVA', ordenes: ['libros.expedidas', 'libros.recibidas', 'libros.intracomunitarias', 'libros.bienes-inversion', 'libros.suplidos', 'libros.formato-aeat'], ver: true },
    // S01e: el 111 y el 115 son retenciones de IRPF, no IVA: su propio grupo.
    { titulo: 'Retenciones', ordenes: ['libros.retenciones'], ver: true },
  ],
  'contabilidad.cierre': [
    { titulo: 'Cierre', ordenes: ['libros.ejercicios', 'libros.cerrar-mes', 'libros.cierre-ejercicio'], ver: true },
    { titulo: 'Cuentas anuales', ordenes: ['libros.cuentas-anuales', 'libros.mapeo'], ver: true },
  ],
  // Paso 3: Definiciones, que no tenía cinta: el plan, las tablas y la analítica.
  'contabilidad.definiciones': [
    { titulo: 'Plan', ordenes: ['def.plan', 'def.sitio'], ver: true },
    { titulo: 'Tablas', ordenes: TABLAS_GENERALES.map((t) => `def.tabla.${t.id}`), ver: true },
    { titulo: 'Analítica', ordenes: ['def.analitica'], ver: true },
  ],
  'contabilidad.importar': [
    { titulo: 'Diez', ordenes: ['libros.pendientes-diez'] },
  ],
  // Paso 3: Compras y gastos. Facturas recibidas: la barra de la N22 (TRAER ·
  // ESPERADAS · LEÍDAS), que depende de la empresa (el correo, Cocina): la pone la pantalla.
  // S02: Facturas recibidas lleva su propio encabezado (Lista): sus acciones las pone la pantalla.
  // Paso 3: Contactos, la misma en todas sus pestañas.
  ...Object.fromEntries(['todos', 'clientes', 'proveedores', 'plataformas', 'socios'].map((t) => [`contactos.${t}`, [{ titulo: 'Nuevo', ordenes: ['contactos.nuevo', 'contactos.nuevo-proveedor'] }]])),
  // S02 · PR 2: Bancos pinta su encabezado (bancos/acciones.ts): sus acciones las pone la pantalla.
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
  return !o.solo || (o.solo === 'hosteleria' ? ctx.hosteleria : o.solo === 'diez' ? ctx.diez : ctx.asesoria === true)
}

/** Las acciones de una página, con lo que no se puede usar aquí ya quitado; los grupos vacíos, fuera. */
export interface GrupoDeCinta { titulo: string; ordenes: Orden[]; dePantalla?: string; ver?: boolean }
export function cintaDe(producto: IdProducto, pestana: string | null, ctx: Contexto): GrupoDeCinta[] {
  if (!pestana) return []
  return (CINTAS[`${producto}.${pestana}`] ?? [])
    .map((g) => ({ titulo: g.titulo, ordenes: g.ordenes.map(ordenPorId).filter((o): o is Orden => !!o && ordenDisponible(o, ctx)), dePantalla: g.dePantalla, ver: g.ver }))
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
