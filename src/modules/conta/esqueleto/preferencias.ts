// src/modules/conta/esqueleto/preferencias.ts
//
// S01 · Lo que cada persona deja a su gusto, ahora en la BASE (conta_user_pref,
// una fila por cuenta y usuario), para que Favoritos y el nivel le sigan de un
// ordenador a otro. Antes (M01) vivía en el navegador; al primer uso se traen
// las de allí (`deNavegador`) y se guardan en la base.
//
//   · nivel: sin experiencia · medio · experto (cambia palabras, ayuda y lo
//     que se ofrece de serie; nunca dónde está cada cosa);
//   · favoritos: ids del catálogo de órdenes, en el orden en que se fijaron;
//   · la cinta oculta, la densidad, la barra desplegada y el documento oculto.
//
// Núcleo puro: se prueba sin base ni navegador.

export type Nivel = 'sin_experiencia' | 'medio' | 'experto'
export const NIVELES: readonly Nivel[] = ['sin_experiencia', 'medio', 'experto']
export const NOMBRE_NIVEL: Record<Nivel, string> = { sin_experiencia: 'Sin experiencia', medio: 'Medio', experto: 'Experto' }

export type Densidad = 'compacta' | 'comoda'

export interface Preferencias {
  nivel: Nivel
  favoritos: string[]
  cintaOculta: boolean
  densidad: Densidad
  /** La barra de productos con sus nombres (desplegada) o solo con iconos. */
  barraDesplegada: boolean
  documentoOculto: boolean
}

export const DE_SERIE: Preferencias = {
  nivel: 'medio', favoritos: [], cintaOculta: false, densidad: 'compacta', barraDesplegada: true, documentoOculto: false,
}

type Fila = Record<string, unknown>

const esNivel = (v: unknown): v is Nivel => typeof v === 'string' && (NIVELES as readonly string[]).includes(v)
const lista = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : [])
const si = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)

/** La fila de conta_user_pref, o lo de serie en lo que falte o no se entienda. */
export function deFila(f: Fila | null | undefined): Preferencias {
  if (!f) return { ...DE_SERIE }
  return {
    nivel: esNivel(f.nivel) ? f.nivel : DE_SERIE.nivel,
    favoritos: lista(f.favoritos),
    cintaOculta: si(f.cinta_oculta, DE_SERIE.cintaOculta),
    densidad: f.densidad === 'comoda' || f.densidad === 'compacta' ? f.densidad : DE_SERIE.densidad,
    barraDesplegada: si(f.barra_desplegada, DE_SERIE.barraDesplegada),
    documentoOculto: si(f.documento_oculto, DE_SERIE.documentoOculto),
  }
}

/** Lo que se escribe en la base de un cambio (solo las columnas que cambian). */
export function aFila(c: Partial<Preferencias>): Fila {
  const f: Fila = {}
  if (c.nivel !== undefined) f.nivel = c.nivel
  if (c.favoritos !== undefined) f.favoritos = c.favoritos
  if (c.cintaOculta !== undefined) f.cinta_oculta = c.cintaOculta
  if (c.densidad !== undefined) f.densidad = c.densidad
  if (c.barraDesplegada !== undefined) f.barra_desplegada = c.barraDesplegada
  if (c.documentoOculto !== undefined) f.documento_oculto = c.documentoOculto
  return f
}

/** La clave del navegador del M01 (marco/nuevo/preferencias.ts), por usuario. */
export const claveDelNavegador = (usuario: string): string => `folvy.conta.marco.${usuario}`

/**
 * Lo que el M01 guardó en el navegador de esta persona (densidad, barra y
 * documento), para traerlo a la base la primera vez. Lo que no esté, nada.
 */
export function deNavegador(usuario: string, almacen: Pick<Storage, 'getItem'> | null): Partial<Preferencias> {
  let v: unknown
  try { v = JSON.parse(almacen?.getItem(claveDelNavegador(usuario)) ?? 'null') } catch { v = null }
  if (!v || typeof v !== 'object') return {}
  const o = v as Fila
  const r: Partial<Preferencias> = {}
  if (o.densidad === 'comoda' || o.densidad === 'compacta') r.densidad = o.densidad
  if (typeof o.barraDesplegada === 'boolean') r.barraDesplegada = o.barraDesplegada
  if (typeof o.documentoOculto === 'boolean') r.documentoOculto = o.documentoOculto
  return r
}
