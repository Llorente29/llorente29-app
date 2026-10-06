// src/modules/conta/marco/ejemploPregunta.ts
//
// El ejemplo de la barra «Pregunta o pide algo» lo pone la ruta (module.tsx).
// Una pantalla que sabe más que su ruta —la ficha de un tercero sabe si es una
// plataforma, un socio o un cliente— lo cambia con useEjemploPregunta; al
// salir de ella vuelve el de la ruta.

import { createContext, useContext, useEffect } from 'react'

export const EjemploPreguntaContexto = createContext<((texto: string | null) => void) | null>(null)

export function useEjemploPregunta(texto: string | null) {
  const poner = useContext(EjemploPreguntaContexto)
  useEffect(() => {
    if (!poner) return
    poner(texto)
    return () => poner(null)
  }, [poner, texto])
}
