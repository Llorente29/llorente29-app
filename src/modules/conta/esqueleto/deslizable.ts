// src/modules/conta/esqueleto/deslizable.ts
//
// S01e · Una fila que se desliza de lado (las pestañas y la cinta del móvil).
// Antes se cortaba por la derecha sin señal de que hubiera más, y la pestaña en
// la que se estaba podía quedar fuera de la vista. Ahora:
//   · un degradado en el borde dice que hay más por ese lado (marca
//     `data-mas-izquierda` y `data-mas-derecha` en la fila; lo pinta el CSS);
//   · al entrar, la fila se desliza hasta lo actual (aria-current) sin mover
//     la página.

import { useLayoutEffect, useRef } from 'react'

/** Si queda algo por ver a cada lado (1 px de margen por el redondeo). */
export function bordesOcultos(desde: number, visible: number, total: number): { izquierda: boolean; derecha: boolean } {
  return { izquierda: desde > 1, derecha: desde + visible < total - 1 }
}

/**
 * Cuánto deslizar para ver entero, centrado si se puede, un trozo que empieza
 * en `x` y mide `ancho` (medidas dentro de la fila). Nunca más allá de los bordes.
 */
export function desplazamientoParaVer(x: number, ancho: number, visible: number, total: number): number {
  const centrado = Math.round(x - (visible - ancho) / 2)
  return Math.max(0, Math.min(centrado, Math.max(0, total - visible)))
}

/**
 * La fila es el elemento de la referencia o, con `buscar`, lo que haya dentro
 * con ese selector (la cinta la pinta el sistema de diseño). `clave` cambia
 * al cambiar de pantalla: entonces vuelve a llevar lo actual a la vista.
 */
export function useDeslizable<T extends HTMLElement>(clave: string, buscar?: string) {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    const raiz = ref.current
    const fila = buscar ? raiz?.querySelector<HTMLElement>(buscar) ?? null : raiz
    if (!fila) return
    const marcar = () => {
      const b = bordesOcultos(fila.scrollLeft, fila.clientWidth, fila.scrollWidth)
      fila.toggleAttribute('data-mas-izquierda', b.izquierda)
      fila.toggleAttribute('data-mas-derecha', b.derecha)
    }
    const actual = fila.querySelector<HTMLElement>('[aria-current="page"]')
    if (actual && fila.scrollWidth > fila.clientWidth) {
      const r = actual.getBoundingClientRect()
      const f = fila.getBoundingClientRect()
      fila.scrollLeft = desplazamientoParaVer(r.left - f.left + fila.scrollLeft, r.width, fila.clientWidth, fila.scrollWidth)
    }
    marcar()
    fila.addEventListener('scroll', marcar, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(marcar)
    ro?.observe(fila)
    // Lo que la pantalla pone después (los bancos, los números) cambia lo que mide.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(marcar)
    mo?.observe(fila, { childList: true, subtree: true })
    return () => { fila.removeEventListener('scroll', marcar); ro?.disconnect(); mo?.disconnect() }
  }, [clave, buscar])
  return ref
}
