// src/modules/conta/nucleo/teclado.ts
//
// K03 · El teclado común del marco del núcleo, en un solo sitio (encargo K03;
// decisión 10 de Julio). Lo que hace cada tecla cuando la pantalla no la ha
// cogido antes (una pantalla que la usa la marca con preventDefault, como F4
// en la casilla de una cuenta, o Esc en la ficha):
//
//   F5            el mayor de la cuenta elegida, en otra pestaña. Sin cuenta
//                 elegida, nada (y la página NO recarga). Con Ctrl o
//                 Mayúsculas, del navegador: recargar, la salida a mano.
//   F4            buscar (el buscador de arriba): la cuenta o el proveedor.
//   F8            cambiar de clase de documento: factura recibida → factura
//                 emitida → asiento → factura recibida (cuando lo que se tiene
//                 delante es uno nuevo de esos tres).
//   Esc           desde el marco (la cinta, los módulos, las pestañas), volver
//                 a la pantalla, donde se estaba.
//   Alt Av Pág    la pestaña siguiente; Alt Re Pág, la anterior. (Ctrl Av Pág
//                 y Ctrl Tab son del navegador y no llegan a la página.)
//
// Intro no se toca aquí: va con la ficha (K04). Núcleo puro: se prueba sin
// navegador (tests/unit/modules/conta/k03/teclado.test.ts).

import { CONTA } from '@/config/navegacion'
import { relativa } from '@/modules/conta/esqueleto/productos'
import { accionDeTecla } from '@/modules/conta/ui/formulario/formulario'

export type AccionDelMarco =
  | { que: 'mayor'; cuenta: string }
  | { que: 'nada' }
  | { que: 'buscar' }
  | { que: 'clase'; a: string }
  | { que: 'pestana'; paso: 1 | -1 }
  | { que: 'volver' }

export interface Tecla { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean }

const R = CONTA.rutas
/** F8 · La vuelta de las tres clases de documento nuevo (la recibida a mano, la emitida, el asiento). */
export const VUELTA_F8 = [R.recibidaAMano, R.nuevaFacturaVenta, R.nuevoAsiento] as const

/**
 * Qué hace el marco con una tecla. null: nada, y la tecla sigue su camino (el
 * navegador o la pantalla). `{ que: 'nada' }`: nada, pero se le quita al
 * navegador (F5 sin cuenta: no recarga).
 */
export function teclaDelMarco(e: Tecla, ctx: { cuenta: string | null; pathname: string; enElMarco: boolean }): AccionDelMarco | null {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) return { que: 'pestana', paso: e.key === 'PageDown' ? 1 : -1 }
  if (e.defaultPrevented) return null
  if (e.key === 'F5') {
    if (accionDeTecla(e) !== 'mayor') return null
    return ctx.cuenta ? { que: 'mayor', cuenta: ctx.cuenta } : { que: 'nada' }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'F4') return { que: 'buscar' }
  if (e.key === 'F8') {
    const i = (VUELTA_F8 as readonly string[]).indexOf(relativa(ctx.pathname))
    return i < 0 ? null : { que: 'clase', a: VUELTA_F8[(i + 1) % VUELTA_F8.length] }
  }
  if (e.key === 'Escape' && ctx.enElMarco) return { que: 'volver' }
  return null
}

const DE_UN_MAYOR = new RegExp(`/${CONTA.modulo}/plan/([0-9]{3,})(?:[/?#]|$)`)

/**
 * La cuenta «elegida» desde un elemento (el que tiene el foco o el que se ha
 * pulsado): la que dice él o su fila con `data-cuenta`; si no, la de un enlace
 * a su mayor (el elemento, o en su fila). Así vale en todas las pantallas que
 * ya enlazan cada cuenta con su mayor, sin tocarlas. Null: ninguna.
 */
export function cuentaDe(el: Element | null): string | null {
  if (!el) return null
  const dicha = el.closest('[data-cuenta]')?.getAttribute('data-cuenta')
  if (dicha && /^[0-9]{3,}$/.test(dicha)) return dicha
  const deEnlace = (a: Element | null) => (a ? DE_UN_MAYOR.exec(a.getAttribute('href') ?? '')?.[1] ?? null : null)
  const propio = deEnlace(el.closest('a[href]'))
  if (propio) return propio
  const fila = el.closest('tr, [role="row"], li')
  return fila ? deEnlace(fila.querySelector(`a[href*="/${CONTA.modulo}/plan/"]`)) : null
}
