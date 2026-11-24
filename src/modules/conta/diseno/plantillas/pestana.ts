// src/modules/conta/diseno/plantillas/pestana.ts
//
// K03 · Lo que una pantalla sabe de la pestaña de trabajo en la que vive (el
// marco del núcleo, nucleo/MarcoNucleo.tsx). Fuera del núcleo no hay pestaña:
// todo vale lo de siempre (activa, sin nombre propio, sin nada que avisar).
//
//   · `activa`: si la pestaña es la que se ve. Una pantalla de una pestaña
//     escondida sigue montada (conserva lo escrito, el filtro, la fila): lo que
//     escucha el teclado en `window` tiene que callarse mientras no se ve
//     (usePestanaActiva), o Intro validaría una factura que nadie está mirando.
//   · `ponerNombre`: la pantalla dice cómo se llama su pestaña («Factura
//     recibida · Distribuciones Ejemplo»); sin decirlo, el de la pantalla.
//   · `ponerCambios`: lo que hay sin guardar, para que el aspa pregunte y la
//     pestaña lo enseñe sin abrirla (lo pone useAvisoSalir).
//   · `esDeEstaPestana`: si un destino se abriría en ESTA pestaña (y entonces
//     la pantalla se va) o en otra (y entonces la pantalla se queda viva).
//
// Vive en diseno/ (y no en nucleo/) porque lo lee useAvisoSalir, que es de
// aquí, y diseno/ solo importa lo suyo.

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { CambioCampo, ResultadoGuardar } from './cambios'

export interface CambiosDePestana {
  cambios: readonly CambioCampo[]
  /** Dónde se ha cambiado («Distribuciones Ejemplo F-2026/0412»). */
  donde?: string
  onGuardar: () => Promise<ResultadoGuardar> | ResultadoGuardar
  onDescartar?: () => void
}

export interface PestanaDeTrabajo {
  id: string
  activa: boolean
  ponerNombre: (nombre: string | null) => void
  ponerCambios: (c: CambiosDePestana | null) => void
  esDeEstaPestana: (destino: string) => boolean
  /** K04 · Cerrar esta pestaña; si tiene cambios, con la pregunta del K03 (Esc en una ficha). */
  cerrar?: () => void
}

export const PestanaContexto = createContext<PestanaDeTrabajo | null>(null)

/** La pestaña de trabajo de la pantalla, o null fuera del marco del núcleo. */
export const usePestana = (): PestanaDeTrabajo | null => useContext(PestanaContexto)

/** ¿Se ve esta pantalla? Fuera del núcleo, siempre. Lo que escucha el teclado en `window` se calla si no. */
export function usePestanaActiva(): boolean {
  const p = useContext(PestanaContexto)
  return p ? p.activa : true
}

/** La pantalla dice cómo se llama su pestaña mientras está montada; null deja el de la pantalla. */
export function useNombreDePestana(nombre: string | null): void {
  const p = useContext(PestanaContexto)
  const poner = p?.ponerNombre
  useEffect(() => {
    if (!poner) return
    poner(nombre)
    return () => poner(null)
  }, [poner, nombre])
}

/**
 * K03 · Para lo que escucha el teclado en `window`: una función estable que
 * dice si la pestaña de la pantalla se ve AHORA (fuera del núcleo, siempre).
 * El manejador la pregunta al pulsar; no hace falta volver a suscribirse.
 */
export function useSeVe(): () => boolean {
  const p = useContext(PestanaContexto)
  const activa = p ? p.activa : true
  const ref = useRef(activa)
  useEffect(() => { ref.current = activa }, [activa])
  return useCallback(() => ref.current, [])
}
