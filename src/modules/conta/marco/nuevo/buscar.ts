// src/modules/conta/marco/nuevo/buscar.ts
//
// M01 · El buscador general (Ctrl K, maqueta N30 §8). Ctrl K es del marco
// (decisión de Julio, F01 respuesta 4): lo que hoy abrían Libros, Bancos y la
// barra de la IA pasa a ser grupos de aquí dentro.
//
// Núcleo puro: qué se busca, cómo se lee lo escrito, las opciones (pantallas,
// pestañas, libros, Bancos y Ajustes) y el orden de los grupos. Lo que vive en
// la base (asientos, facturas, terceros y subcuentas) lo trae
// services/buscadorService.ts y entra con los mismos tipos.

import { INDICE_AJUSTES, rutaBancos, rutaConta, rutaLibros } from '@/config/navegacion'
import { buscar as buscarEnLibros } from '@/modules/conta/libros/navegacion'
import { buscarEnBancos } from '@/modules/conta/bancos/navegacion'
import { pestanasVisibles, productosVisibles, type Contexto } from '@/modules/conta/esqueleto/productos'

/** Sin saber la empresa, lo que sale seguro: nada de hostelería, Diez ni productos con interruptor. */
const SIN_EMPRESA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }

export type TipoResultado = 'asiento' | 'factura' | 'tercero' | 'subcuenta' | 'opcion' | 'pregunta'

export interface Resultado {
  /** Única en toda la lista (sirve de key y de id para el teclado). */
  clave: string
  tipo: TipoResultado
  titulo: string
  apoyo?: string
  /** Un número o un importe que va a la derecha, en mono. */
  cifra?: string
  /** A dónde lleva; null = no navega (la pregunta). */
  ruta: string | null
  /** Lo que ya no cuenta (un asiento anulado, un tercero archivado): sale, en gris y al final de su grupo. */
  apagado?: boolean
}

export interface Grupo { tipo: TipoResultado; nombre: string; resultados: Resultado[]; buscando?: boolean; error?: string | null }

export const NOMBRE_GRUPO: Record<TipoResultado, string> = {
  asiento: 'Asientos',
  factura: 'Facturas',
  tercero: 'Clientes y proveedores',
  subcuenta: 'Subcuentas',
  opcion: 'Opciones',
  pregunta: 'Preguntar',
}

/** El orden en que salen los grupos: primero lo que es un documento, luego las opciones. */
export const ORDEN_GRUPOS: TipoResultado[] = ['asiento', 'factura', 'tercero', 'subcuenta', 'opcion', 'pregunta']

/** Cuántos de cada grupo: «mucha información», pero que quepa en una ventana. */
export const POR_GRUPO = 5

export const normal = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export interface Consulta {
  /** Lo escrito, sin espacios a los lados. */
  texto: string
  /** Si es un número entero (un asiento, una subcuenta): «1287», «40000002». */
  entero: number | null
  /** Si es un importe: «1.278,17», «1278,17», «1278.17» → 1278.17. */
  importe: number | null
}

/** Lee lo escrito. Menos de dos letras no busca nada en la base (sería todo). */
export function interpretar(q: string): Consulta {
  const texto = q.trim()
  const entero = /^\d{1,9}$/.test(texto) ? Number(texto) : null
  let importe: number | null = null
  const sinPuntosDeMil = texto.replace(/\.(?=\d{3}(\D|$))/g, '')
  const m = /^-?\d+([.,]\d{1,2})?$/.exec(sinPuntosDeMil)
  if (m && (m[1] || entero === null)) importe = Number(sinPuntosDeMil.replace(',', '.'))
  else if (entero !== null) importe = entero
  return { texto, entero, importe }
}

export const buscaEnLaBase = (c: Consulta): boolean => c.texto.length >= 2 || c.entero !== null

/** Lo que va dentro de un `ilike` de PostgREST sin romperlo: fuera comodines, comillas y separadores. */
export function paraIlike(texto: string): string {
  return texto.replace(/[%_*,()"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Las opciones: módulos y pestañas, las acciones de Libros (las que abría su
 * Ctrl K), las de Bancos (las del suyo) y las entradas de Ajustes. Sin
 * repetir dirección.
 */
export function opciones(q: string, solo: boolean, ctx: Contexto = SIN_EMPRESA): Resultado[] {
  const n = normal(q)
  if (!n) return []
  const fuera: Resultado[] = []
  const vistas = new Set<string>()
  const poner = (r: Omit<Resultado, 'clave' | 'tipo'>) => {
    if (!r.ruta || vistas.has(r.ruta)) return
    vistas.add(r.ruta)
    fuera.push({ ...r, tipo: 'opcion', clave: `opcion:${r.ruta}` })
  }
  // S01: los productos del esqueleto y sus pestañas, los que salen en esta empresa.
  const productos = productosVisibles(ctx)
  for (const p of productos) {
    if (normal(p.etiqueta).includes(n)) poner({ titulo: p.etiqueta, apoyo: 'Producto', ruta: rutaConta(p.ruta!) })
  }
  // Lo más concreto antes que la pestaña que lleva al mismo sitio: «Balance de
  // situación» gana a «Balances» (las dos abren libros/balances/balance).
  for (const x of buscarEnLibros(q)) poner({ titulo: x.accion.nombre, apoyo: `Libros › ${x.area.nombre}`, ruta: rutaLibros(x.area.id, x.accion.id) })
  for (const b of buscarEnBancos(q)) poner({ titulo: b.nombre, apoyo: `Bancos › ${b.donde}`, ruta: rutaBancos(b.vista === 'movimientos' ? undefined : b.vista) })
  for (const g of INDICE_AJUSTES) for (const e of g.entradas) {
    if (solo && e.hueco) continue
    if (normal(e.etiqueta).includes(n)) poner({ titulo: e.etiqueta, apoyo: `Ajustes › ${g.grupo}`, ruta: rutaConta(e.ruta) })
  }
  for (const p of productos) for (const t of pestanasVisibles(p, ctx)) {
    if (normal(t.etiqueta).includes(n)) poner({ titulo: t.etiqueta, apoyo: p.etiqueta, ruta: rutaConta(t.ruta!) })
  }
  return fuera
}

/** La pregunta a la IA: lo que hacía la barra «Pregunta o pide algo». */
export function pregunta(q: string): Resultado | null {
  const t = q.trim()
  return t ? { clave: 'pregunta', tipo: 'pregunta', titulo: `Preguntar: «${t}»`, ruta: null } : null
}

/** Los grupos en su orden, sin los vacíos que ya han terminado de buscar sin error. */
export function ordenar(grupos: Grupo[]): Grupo[] {
  return ORDEN_GRUPOS.flatMap((t) => grupos.filter((g) => g.tipo === t))
    .filter((g) => g.resultados.length > 0 || g.buscando || g.error)
}

/**
 * Primero lo vivo y después lo apagado, cada parte en el orden en que venía
 * (Julio, 16/10). Ordena, no esconde (regla 7): lo apagado sigue saliendo.
 */
export function vivoPrimero<T extends { apagado?: boolean }>(lista: readonly T[]): T[] {
  return [...lista.filter((r) => !r.apagado), ...lista.filter((r) => r.apagado)]
}

/** Todos los resultados en el orden en que se ven: ↑ ↓ se mueven por aquí. */
export const enFila = (grupos: Grupo[]): Resultado[] => grupos.flatMap((g) => g.resultados)

/** ↑ ↓ dan la vuelta: del último al primero y al revés. */
export function mover(actual: number, paso: 1 | -1, total: number): number {
  if (total === 0) return -1
  if (actual < 0) return paso === 1 ? 0 : total - 1
  return (actual + paso + total) % total
}
