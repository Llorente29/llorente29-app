// src/modules/conta/marco/nuevo/useDesplegable.ts
//
// M01 · Un desplegable de la barra de arriba (la empresa, «Más ▾», el usuario):
// se cierra al pulsar fuera, con Escape (y el foco vuelve a su botón) y al
// cambiar de dirección.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function useDesplegable<T extends HTMLElement = HTMLDivElement>() {
  const { pathname } = useLocation()
  // Abierto EN una dirección: al cambiar de dirección queda cerrado solo.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null)
  const abierto = abiertoEn === pathname
  const setAbierto = (v: boolean) => setAbiertoEn(v ? pathname : null)
  const caja = useRef<T | null>(null)
  const boton = useRef<HTMLButtonElement | null>(null)
  // S02: el foco vuelve al botón DESPUÉS de cerrar (en el efecto), no en el
  // mismo evento: lo que el cierre pinta de nuevo no se lo puede llevar.
  const volverFoco = useRef(false)
  useEffect(() => {
    if (abierto || !volverFoco.current) return
    volverFoco.current = false
    boton.current?.focus()
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbiertoEn(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { volverFoco.current = true; setAbiertoEn(null); boton.current?.focus() } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  return { abierto, setAbierto, alternar: () => setAbierto(!abierto), caja, boton }
}
