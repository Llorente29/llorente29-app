// src/modules/conta/diseno/plantillas/cambios.ts
//
// «Cambios sin guardar» (encargo «Ficha de la recibida completa», punto 2):
// el núcleo, sin pintar, y el hook que lo usa. Vale para CUALQUIER ficha que
// se edita, no solo la de la recibida. Nada se guarda solo: se edita una copia
// (`valor`) contra lo leído (`base`), y la ficha guarda cuando se pulsa
// «Guardar cambios».
//
// Lo que decide aquí:
//   · comparar por VALOR, no por identidad: JSON estable (las claves en orden),
//     así que unas líneas de IVA iguales con otro objeto no son un cambio;
//   · vacío es vacío: '', null y undefined son lo mismo (un campo que estaba
//     sin rellenar, que se escribe y se borra, no ha cambiado);
//   · una relectura (el `original` llega con otra identidad) se ADOPTA: los
//     campos que no has tocado toman lo nuevo; los que has cambiado se quedan
//     como los dejaste. Lo tuyo no se pisa nunca.
//
// Los componentes (la marca, la barra, el aviso al salir) están en
// CambiosSinGuardar.tsx; éste fichero no pinta (react-refresh pide que los
// ficheros de componentes solo exporten componentes).

import { useCallback, useMemo, useState } from 'react'

export type Registro = Record<string, unknown>

/** Un campo cambiado, ya contado para la pantalla. */
export interface CambioCampo<K extends string = string> {
  campo: K
  /** Su rótulo («Vence»); sin etiqueta, el nombre del campo. */
  etiqueta: string
  /** Cómo estaba y cómo está, ya escritos («19/10/2026» → «18/11/2026»). */
  antes: string
  ahora: string
}

export type FormatoCampo<T extends Registro> = (campo: keyof T & string, valor: unknown) => string

const vacio = (v: unknown) => v === undefined || v === null || v === ''

/** JSON con las claves en orden (y vacío = null), para comparar por valor. */
export function huella(v: unknown): string {
  if (vacio(v)) return 'null'
  if (Array.isArray(v)) return `[${v.map(huella).join(',')}]`
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${huella(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export const igual = (a: unknown, b: unknown): boolean => a === b || huella(a) === huella(b)

/** Cómo se escribe un valor si la ficha no dice otra cosa. */
export function formatoDeSerie(_campo: string, v: unknown): string {
  if (vacio(v)) return '—'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'number') return v.toLocaleString('es-ES')
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length === 1 ? '1 línea' : `${v.length} líneas`
  return JSON.stringify(v)
}

/** Los campos que difieren, en el orden de `etiquetas` (el del formulario) y luego los demás. */
export function contarCambios<T extends Registro>(
  base: T, valor: T, etiquetas: Partial<Record<keyof T, string>>, formato?: FormatoCampo<T>,
): CambioCampo<keyof T & string>[] {
  const orden = [...new Set([...Object.keys(etiquetas), ...Object.keys(base), ...Object.keys(valor)])] as (keyof T & string)[]
  const f = (c: keyof T & string, v: unknown) => (formato ? formato(c, v) : formatoDeSerie(c, v))
  return orden
    .filter((c) => !igual(base[c], valor[c]))
    .map((c) => ({ campo: c, etiqueta: etiquetas[c] ?? c, antes: f(c, base[c]), ahora: f(c, valor[c]) }))
}

/**
 * Llega una relectura (`nuevo`) mientras se edita: lo no tocado toma lo nuevo,
 * lo tocado se queda como lo dejaste. La base pasa a ser lo nuevo, así que
 * «Antes» dice lo que hay guardado AHORA.
 */
export function adoptar<T extends Registro>(base: T, valor: T, nuevo: T): { base: T; valor: T } {
  const v: Registro = { ...nuevo }
  for (const k of Object.keys(valor)) if (!igual(base[k], valor[k])) v[k] = valor[k]
  return { base: nuevo, valor: v as T }
}

/** «Vence: 19/10/2026 → 18/11/2026», o, con más de dos, solo los rótulos. */
export function resumenCambios(cambios: readonly CambioCampo[]): string {
  if (cambios.length === 0) return ''
  if (cambios.length <= 2) return cambios.map((c) => `${c.etiqueta}: ${c.antes} → ${c.ahora}`).join(' · ')
  return listaY(cambios.map((c) => c.etiqueta))
}

/** «1 cambio sin guardar», «3 cambios sin guardar». */
export const cuentaCambios = (n: number): string => `${n} ${n === 1 ? 'cambio' : 'cambios'} sin guardar`

/** «Vence», «Vence y Proveedor», «Vence, Proveedor y Base». */
export function listaY(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** Lo que dice el aviso al salir: «Has cambiado Vence en COHELDI P26 4.980. Si sales ahora, ese cambio se pierde.» */
export function textoSalir(cambios: readonly CambioCampo[], donde?: string): string {
  const n = cambios.length
  const en = donde ? ` en ${donde}` : ''
  return `Has cambiado ${listaY(cambios.map((c) => c.etiqueta))}${en}. Si sales ahora, ${n === 1 ? 'ese cambio se pierde' : `esos ${n} cambios se pierden`}.`
}

/** Lo que devuelve quien guarda: true si guardó; false o el motivo (texto) si no. */
export type ResultadoGuardar = boolean | string

export interface CambiosSinGuardar<T extends Registro> {
  /** Lo que se ve y se edita (la copia). */
  valor: T
  poner: <K extends keyof T>(campo: K, v: T[K]) => void
  /** Ese campo vuelve a lo guardado. */
  deshacer: (campo: keyof T) => void
  /** Todo vuelve a lo guardado. */
  descartar: () => void
  cambios: CambioCampo<keyof T & string>[]
  hay: boolean
  /**
   * Después de guardar (o al pasar a otra ficha): lo nuevo es lo guardado y no
   * hay cambios. Al pasar a OTRA ficha, llámalo (o descarta antes): la
   * relectura que conserva lo tuyo es para la misma ficha releída.
   */
  reiniciar: (nuevoOriginal: T) => void
  /** El campo, si ha cambiado (para <MarcaCambiado>). */
  cambioDe: (campo: keyof T) => CambioCampo<keyof T & string> | undefined
}

/**
 * La copia que se edita de una ficha. `original` es lo leído: si llega otro
 * (una relectura), se adopta sin pisar lo que has cambiado.
 */
export function useCambiosSinGuardar<T extends Registro>(
  original: T, etiquetas: Partial<Record<keyof T, string>>, formato?: FormatoCampo<T>,
): CambiosSinGuardar<T> {
  const [estado, setEstado] = useState(() => ({ de: original, base: original, valor: original }))
  // La relectura, al pintar y no en un efecto (el patrón de React para «lo que
  // venía del render anterior»): sin un pintado de más con lo viejo. Solo si
  // cambia el VALOR: un `original` escrito en línea (otro objeto en cada
  // pintado, con lo mismo) no toca el estado, o sería un bucle.
  let actual = estado
  if (estado.de !== original && !igual(estado.de, original)) {
    actual = { de: original, ...adoptar(estado.base, estado.valor, original) }
    setEstado(actual)
  }
  const { base, valor } = actual

  const poner = useCallback(<K extends keyof T>(campo: K, v: T[K]) => {
    setEstado((e) => ({ ...e, valor: { ...e.valor, [campo]: v } }))
  }, [])
  const deshacer = useCallback((campo: keyof T) => {
    setEstado((e) => ({ ...e, valor: { ...e.valor, [campo]: e.base[campo] } }))
  }, [])
  const descartar = useCallback(() => setEstado((e) => ({ ...e, valor: e.base })), [])
  // `de` (el último `original` visto) no se toca: si la ficha aún pasa lo leído
  // antes de guardar, no se vuelve a ello; cuando llegue la relectura (igual a
  // lo guardado), se adopta sin cambios.
  const reiniciar = useCallback((nuevo: T) => setEstado((e) => ({ de: e.de, base: nuevo, valor: nuevo })), [])
  const cambios = useMemo(() => contarCambios(base, valor, etiquetas, formato), [base, valor, etiquetas, formato])
  const cambioDe = useCallback((campo: keyof T) => cambios.find((c) => c.campo === campo), [cambios])
  return { valor, poner, deshacer, descartar, cambios, hay: cambios.length > 0, reiniciar, cambioDe }
}
