// src/modules/conta/diseno/plantillas/valores.ts
//
// S02 · Lo que las plantillas deciden sin pintar (para que los ficheros de
// componentes solo exporten componentes y se prueben sin React).

import type { KeyboardEvent } from 'react'
import { leerImporte } from '@/modules/conta/lib/lectorCsvBanco'
import { eurosExactos } from '@/modules/conta/lib/formato'

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

// ── El asiento, como un asiento de verdad (encargo «Ficha de la recibida
// completa», punto 7) ──────────────────────────────────────────────────

/** Una línea del asiento que se enseña: la cuenta (número y nombre) y su importe ya escrito en el debe o el haber. */
export interface LineaAsientoVista {
  /** El nombre de la cuenta («Compras de mercaderías»). */
  nombre: string
  /** Su número («60000000»). */
  codigo: string
  /** «263,66», o null si va al haber. */
  debe: string | null
  haber: string | null
  /** Tocada en «Editar el asiento a mano»: se marca «cambiado a mano». */
  aMano?: boolean
}

/** Céntimos de un importe escrito («1.234,56», «1.234,56 €»); vacío o ilegible, 0. */
export function centDeTexto(x: string | null | undefined): number {
  if (!x) return 0
  const c = leerImporte(x)
  return c ?? 0
}

/** Primero las líneas del debe y luego las del haber, cada grupo en el orden en que vino. */
export function ordenarAsiento<L extends LineaAsientoVista>(lineas: readonly L[]): L[] {
  const alDebe = (l: L) => centDeTexto(l.debe) !== 0 || centDeTexto(l.haber) === 0
  return [...lineas.filter(alDebe), ...lineas.filter((l) => !alDebe(l))]
}

export interface TotalesAsiento { debeCent: number; haberCent: number; cuadra: boolean; diferenciaCent: number; debe: string; haber: string; diferencia: string }

/** La fila de totales: lo que suma cada columna, si cuadra y, si no, la diferencia (debe − haber). */
export function totalesAsiento(lineas: readonly LineaAsientoVista[]): TotalesAsiento {
  const debeCent = lineas.reduce((s, l) => s + centDeTexto(l.debe), 0)
  const haberCent = lineas.reduce((s, l) => s + centDeTexto(l.haber), 0)
  const diferenciaCent = debeCent - haberCent
  const t = (c: number) => eurosExactos(c / 100).replace(/\s€$/, '')
  return { debeCent, haberCent, cuadra: lineas.length > 0 && diferenciaCent === 0, diferenciaCent, debe: t(debeCent), haber: t(haberCent), diferencia: eurosExactos(Math.abs(diferenciaCent) / 100) }
}
