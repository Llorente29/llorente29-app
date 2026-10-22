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

/** Hoja de líneas · una cuenta para F4: su número y su nombre. */
export interface CuentaHoja { codigo: string; nombre: string }

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Hoja de líneas · F4 busca la cuenta: por número, las que empiezan por lo
 * escrito («572» → 57200001…); por nombre, las que tienen todas las palabras,
 * sin mirar acentos. Como mucho `max`. Es la misma regla que la búsqueda de
 * subcuenta del formulario del M01 (ui/formulario/formulario.ts), escrita aquí
 * porque las plantillas no cogen piezas de ui/ (diseno-reglas.test.ts, regla 4).
 */
export function buscarCuentasHoja(lista: readonly CuentaHoja[], q: string, max = 12): CuentaHoja[] {
  const t = sinAcentos(q)
  if (!t) return lista.slice(0, max)
  if (/^\d+$/.test(t)) return lista.filter((c) => c.codigo.startsWith(t)).slice(0, max)
  const palabras = t.split(/\s+/)
  return lista.filter((c) => { const n = sinAcentos(`${c.codigo} ${c.nombre}`); return palabras.every((p) => n.includes(p)) }).slice(0, max)
}
