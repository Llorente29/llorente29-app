// src/modules/conta/marco/nuevo/contexto.ts
//
// M01 · Lo que el marco nuevo deja a las pantallas que lleva dentro:
//   · la densidad y si el documento está oculto (las piezas comunes la leen);
//   · los dos huecos donde una pantalla pone lo suyo: su barra de acciones y,
//     si lo lee, el ejercicio y el periodo (en la cabecera);
//   · S01: lo que sabe de cada orden de su cinta (useDatosEnCinta).
// Fuera del marco no hay contexto: las piezas usan lo de serie.

import { createContext, useContext, useEffect, useRef } from 'react'
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
  /**
   * S01 · Lo que solo sabe la pantalla y va en un grupo de la cinta que el
   * catálogo deja en blanco (`dePantalla`): los bancos de la empresa en
   * «Tus bancos». Null lo quita.
   */
  ponerEntradasCinta: (entradas: EntradasCinta | null) => void
}

/** Una entrada de la cinta puesta por la pantalla: un enlace (`a`) o un botón (`alPulsar`). */
export interface EntradaPantalla {
  id: string
  etiqueta: string
  /** A dónde lleva, absoluta (con su consulta). */
  a?: string
  alPulsar?: () => void
  actual?: boolean
  /** El punto ámbar: pide algo. */
  aviso?: boolean
  /** Lo que se lee al pasar («···1234 · 3 dudas»). */
  dato?: string
  /** Su número escrito (las dudas del banco). */
  numero?: number
  /** El nombre entero, cuando la etiqueta es corta. */
  titulo?: string
}
/** Por grupo de la cinta (`dePantalla` en ordenes.ts). */
export type EntradasCinta = Record<string, EntradaPantalla[]>

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

/**
 * Una pantalla pone sus entradas en la cinta mientras está a la vista. La
 * clave es lo que se ve (sin las funciones); al pulsar se llama a la función
 * del último render, que nunca se queda vieja.
 */
export function useEntradasEnCinta(entradas: EntradasCinta | null): void {
  const marco = useContext(MarcoContexto)
  const poner = marco?.ponerEntradasCinta
  const ultimas = useRef(entradas)
  useEffect(() => { ultimas.current = entradas })
  const clave = entradas ? JSON.stringify(entradas) : ''
  useEffect(() => {
    if (!poner) return
    if (!clave) { poner(null); return }
    const vistas = JSON.parse(clave) as EntradasCinta
    const conFunciones: EntradasCinta = {}
    for (const [grupo, lista] of Object.entries(vistas)) {
      conFunciones[grupo] = lista.map((e, i) => (ultimas.current?.[grupo]?.[i]?.alPulsar
        ? { ...e, alPulsar: () => ultimas.current?.[grupo]?.[i]?.alPulsar?.() }
        : e))
    }
    poner(conFunciones)
    return () => poner(null)
  }, [poner, clave])
}
