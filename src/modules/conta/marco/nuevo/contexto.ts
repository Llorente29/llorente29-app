// src/modules/conta/marco/nuevo/contexto.ts
//
// M01 · Lo que el marco nuevo deja a las pantallas que lleva dentro:
//   · la densidad y si el documento está oculto (las piezas comunes la leen);
//   · los dos huecos donde una pantalla pone lo suyo: su barra de acciones y,
//     si lo lee, el ejercicio y el periodo (en la cabecera);
//   · S01: lo que sabe de cada orden de su cinta (useDatosEnCinta).
// Fuera del marco no hay contexto: las piezas usan lo de serie.

import { createContext, useContext, useEffect } from 'react'
import type { Densidad } from '@/modules/conta/esqueleto/preferencias'

export interface Marco {
  densidad: Densidad
  documentoOculto: boolean
  ocultarDocumento: (oculto: boolean) => void
  /** Donde va la barra de acciones de la pantalla (debajo de la barra de arriba). */
  huecoAcciones: HTMLElement | null
  /** Donde va el ejercicio y el periodo, a la izquierda de la barra de arriba. */
  huecoPeriodo: HTMLElement | null
  /**
   * S01 · Lo que una pantalla sabe de cada orden de su cinta (el número, si
   * pide algo, su dato): Libros lo ponía en su segunda fila; ahora va en la
   * cinta del esqueleto. Null lo quita.
   */
  ponerDatosCinta: (datos: DatosCinta | null) => void
}

/** Por id de orden (ordenes.ts): «Pendientes de adjuntar en Diez · 3», con su punto ámbar. */
export type DatosCinta = Record<string, { numero?: number; aviso?: boolean; dato?: string; gris?: boolean }>

export const MarcoContexto = createContext<Marco | null>(null)

/** El marco nuevo, o null si la pantalla está fuera de él. */
export const useMarco = (): Marco | null => useContext(MarcoContexto)

/**
 * Una pantalla pone en la cinta lo que sabe de sus órdenes mientras está a la
 * vista; al irse, lo quita. La clave dice cuándo ha cambiado (los datos son
 * objetos nuevos en cada render).
 */
export function useDatosEnCinta(datos: DatosCinta | null): void {
  const marco = useContext(MarcoContexto)
  const poner = marco?.ponerDatosCinta
  const clave = datos ? JSON.stringify(datos) : ''
  useEffect(() => {
    if (!poner) return
    poner(clave ? (JSON.parse(clave) as DatosCinta) : null)
    return () => poner(null)
  }, [poner, clave])
}
