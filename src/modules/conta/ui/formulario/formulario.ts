// src/modules/conta/ui/formulario/formulario.ts
//
// M01 · Pieza común · El formulario por bloques (maqueta N30 §5, como el de
// factura de ERP10): lo que decide sin pintar, con pruebas en
// tests/unit/modules/conta/m01/piezas.test.ts.
//   · el estado de un campo que propone la máquina (azul claro mientras sigue
//     siendo lo propuesto y nadie lo ha aceptado);
//   · qué hace cada tecla. Las de la maqueta: Tab e Intro, siguiente campo;
//     F4, buscar subcuenta; Ctrl S, guardar; Ctrl Intro, validar y pasar al
//     siguiente; Av Pág y Re Pág, documento siguiente o anterior. NUNCA F5,
//     F10, F11 ni F12: son del navegador (recargar, menú, pantalla completa,
//     herramientas). Lo comprueba una prueba;
//   · buscar una subcuenta por su número o por su nombre.

import { miles } from '@/modules/conta/ui/tabla/tablaDensa'

export type EstadoCampo = 'propuesto' | 'aceptado' | 'cambiado' | 'normal'

/**
 * Un campo con propuesta está «propuesto» (azul claro) mientras su valor es el
 * propuesto y no se ha aceptado; aceptado con Tab, «aceptado»; con otro valor
 * escrito, «cambiado». Sin propuesta, «normal».
 */
export function estadoCampo(valor: string, propuesto: string | undefined, aceptado: boolean): EstadoCampo {
  if (propuesto === undefined || propuesto === '') return 'normal'
  if (valor.trim() !== propuesto.trim()) return 'cambiado'
  return aceptado ? 'aceptado' : 'propuesto'
}

export type AccionTecla = 'siguiente' | 'buscar' | 'guardar' | 'validar' | 'documento-siguiente' | 'documento-anterior'

/** Las que la maqueta prohíbe, porque son del navegador. */
export const TECLAS_DEL_NAVEGADOR = ['F5', 'F10', 'F11', 'F12'] as const

/**
 * Qué hace una tecla dentro del formulario. Tab no se toca (el navegador ya
 * pasa al siguiente; la pieza solo lo usa para aceptar lo propuesto). Intro
 * pasa al siguiente salvo en un texto largo.
 */
export function accionDeTecla(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }, enTextoLargo = false): AccionTecla | null {
  const ctrl = !!(e.ctrlKey || e.metaKey)
  if ((TECLAS_DEL_NAVEGADOR as readonly string[]).includes(e.key)) return null
  if (ctrl && e.key === 'Enter') return 'validar'
  if (ctrl && (e.key === 's' || e.key === 'S')) return 'guardar'
  if (ctrl || e.altKey) return null
  if (e.key === 'F4') return 'buscar'
  if (e.key === 'PageDown') return 'documento-siguiente'
  if (e.key === 'PageUp') return 'documento-anterior'
  if (e.key === 'Enter' && !e.shiftKey && !enTextoLargo) return 'siguiente'
  return null
}

/** «3 de 12»; sin documentos, nada. */
export const textoPosicion = (actual: number, total: number): string => (total > 0 ? `${miles(actual)} de ${miles(total)}` : '')

export interface Subcuenta { codigo: string; nombre: string }

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * F4 · Busca una subcuenta: por número, las que empiezan por lo escrito
 * («6290» → 62900000…); por nombre, las que tienen todas las palabras. Primero
 * las de número, y como mucho `max`.
 */
export function buscarSubcuentas(lista: readonly Subcuenta[], q: string, max = 12): Subcuenta[] {
  const t = sinAcentos(q)
  if (!t) return lista.slice(0, max)
  if (/^\d+$/.test(t)) return lista.filter((s) => s.codigo.startsWith(t)).slice(0, max)
  const palabras = t.split(/\s+/)
  return lista.filter((s) => { const n = sinAcentos(`${s.codigo} ${s.nombre}`); return palabras.every((p) => n.includes(p)) }).slice(0, max)
}
