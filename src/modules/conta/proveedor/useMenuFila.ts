// src/modules/conta/proveedor/useMenuFila.ts
//
// S01e · El «···» de una fila de lista (Proveedores y Contactos). Antes se abría
// encima de la mitad de su propia fila y tapaba las de debajo hasta hacer clic
// fuera. Ahora:
//   · se abre justo debajo de su fila (nunca la tapa), por encima de las demás
//     con su sombra; y hacia arriba si abajo no cabe;
//   · se cierra al salir con el ratón (con un respiro), con clic fuera y con Escape.

import { useEffect, useRef, useState } from 'react'

/** Lo que ocupa el menú más su margen: si abajo queda menos, se abre hacia arriba. */
export const ALTO_MENU_FILA = 200

/** ¿Hacia arriba? Solo si abajo no cabe y arriba sí (si no cabe en ninguno, abajo: la página se desplaza). */
export function abrirHaciaArriba(caja: { top: number; bottom: number }, altoVentana: number, alto = ALTO_MENU_FILA): boolean {
  return altoVentana - caja.bottom < alto && caja.top >= alto
}

export function useMenuFila() {
  const [abierto, setAbierto] = useState(false)
  const [arriba, setArriba] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const espera = useRef<number | null>(null)
  const quieto = () => { if (espera.current !== null) { window.clearTimeout(espera.current); espera.current = null } }

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  useEffect(() => quieto, [])

  const alternar = () => {
    quieto()
    if (!abierto && caja.current) setArriba(abrirHaciaArriba(caja.current.getBoundingClientRect(), window.innerHeight))
    setAbierto((v) => !v)
  }
  const cerrar = () => { quieto(); setAbierto(false) }
  /** Al salir con el ratón se cierra (con un respiro, por si se vuelve). */
  const alSalir = () => { if (!abierto) return; quieto(); espera.current = window.setTimeout(() => setAbierto(false), 250) }
  return { abierto, arriba, caja, alternar, cerrar, alSalir, alEntrar: quieto }
}
