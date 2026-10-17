// src/modules/conta/marco/nuevo/contexto.ts
//
// M01 · Lo que el marco nuevo deja a las pantallas que lleva dentro:
//   · la densidad y si el documento está oculto (las piezas comunes la leen);
//   · si el marco ya pinta arriba las pestañas del módulo (Libros no las
//     repite: el mínimo que se toca de una pantalla vieja);
//   · los dos huecos de la barra donde una pantalla pone lo suyo: su barra de
//     acciones y, si lo lee, el ejercicio y el periodo.
// Fuera del marco no hay contexto: las piezas usan lo de serie.

import { createContext, useContext } from 'react'
import type { Densidad } from '@/modules/conta/esqueleto/preferencias'

export interface Marco {
  densidad: Densidad
  documentoOculto: boolean
  ocultarDocumento: (oculto: boolean) => void
  pestanasArriba: boolean
  /** Donde va la barra de acciones de la pantalla (debajo de la barra de arriba). */
  huecoAcciones: HTMLElement | null
  /** Donde va el ejercicio y el periodo, a la izquierda de la barra de arriba. */
  huecoPeriodo: HTMLElement | null
  /** La segunda fila de la barra de arriba: las acciones de la pestaña (SubpestanasEnBarra). */
  huecoSubpestanas: HTMLElement | null
}

export const MarcoContexto = createContext<Marco | null>(null)

/** El marco nuevo, o null si la pantalla está fuera de él. */
export const useMarco = (): Marco | null => useContext(MarcoContexto)

/** ¿Pinta el marco ya las pestañas de este módulo arriba? Fuera del marco, no. */
export const usePestanasArriba = (): boolean => useContext(MarcoContexto)?.pestanasArriba ?? false
