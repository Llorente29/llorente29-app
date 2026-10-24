// src/modules/conta/ui/tabla/tablaDensa.ts
//
// M01 · Pieza común · La tabla densa (maqueta N30 §4): lo que decide sin
// pintar nada, con pruebas en tests/unit/modules/conta/m01/piezas.test.ts.
//   · los filtros de arriba (fechas, una lista, texto) y si una fila cumple;
//   · las vistas guardadas, por usuario, en el navegador (decisión de Julio,
//     F01 respuesta 9: sin tanda);
//   · moverse con ↑ ↓ sin dar la vuelta (una tabla no es un menú);
//   · el cuadre del pie y lo que dice el pie;
//   · el CSV (para Excel en español: «;», coma decimal y BOM).
//
// Regla 7: un filtro de la tabla ordena y etiqueta lo que la persona pide,
// nunca decide qué existe sin decirlo. El pie dice siempre cuántas filas hay
// con los filtros puestos y de cuántas («12 de 340 asientos»).

import { cent, deCent } from '@/modules/conta/lib/libro'
import { eurosExactos } from '@/modules/conta/lib/formato'

/**
 * Un entero con punto de miles también en cuatro cifras («1.250»): es-ES no
 * lo pone solo por debajo de 10.000 (lo mismo que numeroVisible del diario).
 */
export const miles = (n: number): string => (n < 0 ? '−' : '') + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

// ── Filtros ─────────────────────────────────────────────────────────────

export type TipoFiltro = 'desde' | 'hasta' | 'opciones' | 'texto'

export interface CampoFiltro {
  id: string
  etiqueta: string
  tipo: TipoFiltro
  /** Para `opciones`: la primera es «todas» (valor ''). */
  opciones?: readonly { valor: string; texto: string }[]
  /** Lo que se ve dentro del campo vacío (solo `texto`). */
  pista?: string
}

export type ValoresFiltro = Readonly<Record<string, string>>

/** Sin acentos ni mayúsculas, para buscar texto. */
export const normal = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** ¿Hay algún filtro puesto? */
export const hayFiltros = (v: ValoresFiltro): boolean => Object.values(v).some((x) => x.trim() !== '')

/**
 * ¿Cumple una fila los filtros? `fecha` es la ISO de la fila, `opcion(id)` lo
 * que tiene la fila en una lista y `texto` todo lo que se puede buscar en
 * ella. Todas las palabras escritas tienen que estar (en cualquier orden).
 */
export function cumpleFiltros(campos: readonly CampoFiltro[], v: ValoresFiltro, fila: { fecha?: string; opcion?: (id: string) => string | readonly string[]; texto?: string }): boolean {
  for (const c of campos) {
    const q = (v[c.id] ?? '').trim()
    if (!q) continue
    if (c.tipo === 'desde' && fila.fecha !== undefined && fila.fecha < q) return false
    if (c.tipo === 'hasta' && fila.fecha !== undefined && fila.fecha > q) return false
    if (c.tipo === 'opciones' && fila.opcion) {
      const tiene = fila.opcion(c.id)
      if (Array.isArray(tiene) ? !tiene.includes(q) : tiene !== q) return false
    }
    if (c.tipo === 'texto') {
      const donde = normal(fila.texto ?? '')
      if (!normal(q).split(/\s+/).every((p) => donde.includes(p))) return false
    }
  }
  return true
}

// ── Vistas guardadas ────────────────────────────────────────────────────

/** Una vista: un nombre, la vista de serie de la que sale y sus filtros. */
export interface VistaGuardada { id: string; nombre: string; base: string; filtros: Record<string, string> }

export const claveVistas = (tabla: string, usuario: string): string => `folvy.conta.vistas.${tabla}.${usuario}`

export function leerVistas(tabla: string, usuario: string, almacen: Pick<Storage, 'getItem'> | null): VistaGuardada[] {
  try {
    const crudo = almacen?.getItem(claveVistas(tabla, usuario))
    const x: unknown = crudo ? JSON.parse(crudo) : []
    if (!Array.isArray(x)) return []
    return x.flatMap((v: unknown) => {
      if (!v || typeof v !== 'object') return []
      const o = v as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.nombre !== 'string' || !o.nombre.trim()) return []
      const filtros: Record<string, string> = {}
      if (o.filtros && typeof o.filtros === 'object') for (const [k, val] of Object.entries(o.filtros)) if (typeof val === 'string') filtros[k] = val
      return [{ id: o.id, nombre: o.nombre.trim(), base: typeof o.base === 'string' ? o.base : 'todos', filtros }]
    })
  } catch { return [] }
}

/**
 * Guarda una vista con lo que hay puesto y devuelve la lista nueva. Con un
 * nombre que ya existe (sin mirar mayúsculas), la sustituye: dos botones con
 * el mismo nombre no se distinguen.
 */
export function guardarVista(tabla: string, usuario: string, nombre: string, base: string, filtros: ValoresFiltro,
  almacen: Pick<Storage, 'getItem' | 'setItem'> | null, id: string = `v${Date.now().toString(36)}`): VistaGuardada[] {
  const n = nombre.trim()
  if (!n) return leerVistas(tabla, usuario, almacen)
  const limpios: Record<string, string> = {}
  for (const [k, v] of Object.entries(filtros)) if (v.trim()) limpios[k] = v.trim()
  const antes = leerVistas(tabla, usuario, almacen)
  const igual = antes.find((v) => normal(v.nombre) === normal(n))
  const nueva: VistaGuardada = { id: igual?.id ?? id, nombre: n, base, filtros: limpios }
  const lista = igual ? antes.map((v) => (v.id === igual.id ? nueva : v)) : [...antes, nueva]
  try { almacen?.setItem(claveVistas(tabla, usuario), JSON.stringify(lista)) } catch { /* sin almacén: la vista vale para esta visita */ }
  return lista
}

export function borrarVista(tabla: string, usuario: string, id: string, almacen: Pick<Storage, 'getItem' | 'setItem'> | null): VistaGuardada[] {
  const lista = leerVistas(tabla, usuario, almacen).filter((v) => v.id !== id)
  try { almacen?.setItem(claveVistas(tabla, usuario), JSON.stringify(lista)) } catch { /* idem */ }
  return lista
}

// ── Teclado ─────────────────────────────────────────────────────────────

/** ↑ ↓ en una tabla: se para en la primera y en la última (no da la vuelta). */
export function moverEnTabla(actual: number, paso: number, total: number): number {
  if (total === 0) return -1
  if (actual < 0) return paso > 0 ? 0 : total - 1
  return Math.max(0, Math.min(total - 1, actual + paso))
}

/** Espacio: marca o desmarca una fila. */
export function alternarMarca(marcadas: ReadonlySet<string>, clave: string): Set<string> {
  const s = new Set(marcadas)
  if (s.has(clave)) s.delete(clave)
  else s.add(clave)
  return s
}

// ── El pie ──────────────────────────────────────────────────────────────

export interface Cuadre { debe: number; haber: number; cuadra: boolean; diferencia: number }

/** Suma al céntimo (nada de 0,1 + 0,2). */
export function cuadreDe(importes: readonly { debe: number; haber: number }[]): Cuadre {
  const d = importes.reduce((t, x) => t + cent(x.debe), 0)
  const h = importes.reduce((t, x) => t + cent(x.haber), 0)
  return { debe: deCent(d), haber: deCent(h), cuadra: d === h, diferencia: deCent(d - h) }
}

/** «1 asiento» / «12 asientos»; con filtros, «12 de 340 asientos». */
export function cuantas(n: number, total: number, nombre: readonly [string, string]): string {
  const palabra = (k: number) => (k === 1 ? nombre[0] : nombre[1])
  const num = miles
  return n === total ? `${num(n)} ${palabra(n)}` : `${num(n)} de ${num(total)} ${palabra(total)}`
}

/** Lo que dice el cuadre del pie: «Debe … · Haber … · Cuadra» o «No cuadra: … de diferencia». */
export function textoCuadre(c: Cuadre): string {
  const base = `Debe ${eurosExactos(c.debe)} · Haber ${eurosExactos(c.haber)}`
  return c.cuadra ? `${base} · Cuadra` : `${base} · No cuadra: ${eurosExactos(Math.abs(c.diferencia))} de diferencia`
}

// ── Exportar ────────────────────────────────────────────────────────────

export type Celda = string | number | null

const celdaCsv = (c: Celda): string => {
  if (c === null) return ''
  const t = typeof c === 'number' ? String(c).replace('.', ',') : c
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** El CSV que abre bien Excel en español: «;» entre columnas, coma decimal, BOM y CRLF. */
export function csv(cabecera: readonly string[], filas: readonly (readonly Celda[])[]): string {
  return `\uFEFF${[cabecera, ...filas].map((f) => f.map(celdaCsv).join(';')).join('\r\n')}\r\n`
}

/** El nombre del fichero: sin espacios ni acentos, con su extensión. */
export function nombreFichero(base: string, extension: 'xlsx' | 'csv' | 'pdf'): string {
  const limpio = normal(base).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${limpio || 'tabla'}.${extension}`
}
