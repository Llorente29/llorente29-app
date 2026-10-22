// src/modules/conta/diseno/plantillas/valores.ts
//
// S02 · Lo que las plantillas deciden sin pintar (para que los ficheros de
// componentes solo exporten componentes y se prueben sin React).

import type { KeyboardEvent } from 'react'

/** Asistente · de dónde sale una casilla: verde si de los libros, blanca si la rellenas tú, gris si la calcula Sumied. */
export type OrigenCasilla = 'libros' | 'tu' | 'sumied'
export const NOMBRE_ORIGEN: Record<OrigenCasilla, string> = { libros: 'Sale de tus libros', tu: 'La rellenas tú', sumied: 'La calcula Sumied' }

/** Bandeja · el total de «Te toca hoy»: la suma de sus filas (no se pasa: no puede no cuadrar). */
export const totalTeToca = (filas: readonly { n: number }[]): number => filas.reduce((s, f) => s + f.n, 0)

/**
 * Hoja de líneas · Intro: al siguiente campo de la fila; en el último de la
 * fila, al primero de la siguiente, y si no la hay, `alFinal` (una línea
 * nueva). Devuelve true si la tecla era suya.
 */
export function introEnLaHoja(e: KeyboardEvent<HTMLElement>, alFinal: () => void): boolean {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false
  const campo = e.target as HTMLElement
  const hoja = campo.closest('.s-hoja')
  if (!hoja) return false
  const campos = [...hoja.querySelectorAll<HTMLElement>('[data-campo-hoja]')]
  const i = campos.indexOf(campo)
  if (i < 0) return false
  e.preventDefault()
  if (i === campos.length - 1) alFinal()
  else campos[i + 1].focus()
  return true
}
