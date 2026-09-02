// src/shell/home/cards/useDatoDeTarjeta.ts
//
// LECTURA SELLADA: cada tarjeta se busca su dato y se queda con la hora a la
// que lo leyó. Es la mitad de la garantía (a) que no cabe en `sello.ts`, que es
// puro y no sabe de React.
//
// Dos cosas que este hook hace y que no son obvias:
//
//   · EL RELOJ CORRE SOLO. Un dato caduca sin que nadie toque nada — es
//     justamente el caso que la garantía persigue: la pantalla lleva horas
//     abierta y el número sigue ahí con cara de actual. Sin un tick, el sello
//     se quedaría congelado en «datos de las 08:18» y nunca diría que ya no
//     vale. Se comprueba cada 30 s, que es barato y suficiente.
//
//   · UN FALLO NO SE CONVIERTE EN UN CERO. Si la consulta revienta, `datos`
//     se queda como estaba y `error` se rellena. La tarjeta enseña lo último
//     bueno DICIENDO que no ha podido refrescar, en vez de pintar «0» o «—»
//     como si fuera el dato de ahora. Un 0 inventado en un panel de mando es
//     de las pocas cosas peores que no tener panel.

import { useCallback, useEffect, useRef, useState } from 'react'
import { selloDe, UMBRAL_POR_DEFECTO_MIN, type Sello } from '../sello'

const TICK_MS = 30_000

export interface DatoDeTarjeta<T> {
  datos: T | null
  cargando: boolean
  /** Mensaje del último fallo, o null. No borra `datos`. */
  error: string | null
  sello: Sello
  recargar: () => void
}

export function useDatoDeTarjeta<T>(
  cargar: () => Promise<T>,
  deps: unknown[],
  umbralMin: number = UMBRAL_POR_DEFECTO_MIN,
): DatoDeTarjeta<T> {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leidoA, setLeidoA] = useState<Date | null>(null)
  const [ahora, setAhora] = useState<Date>(() => new Date())
  const [tick, setTick] = useState(0)

  // `cargar` suele llegar como función nueva en cada render; se guarda en una
  // ref para que el efecto dependa de `deps` y no de la identidad de la función.
  const cargarRef = useRef(cargar)
  cargarRef.current = cargar

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    cargarRef.current()
      .then(d => {
        if (cancelado) return
        setDatos(d)
        setError(null)
        setLeidoA(new Date())
      })
      .catch(e => {
        // No se toca `datos`: lo último bueno sigue en pantalla, y el sello
        // sigue diciendo de cuándo es. Mentir sería sustituirlo por un cero.
        if (!cancelado) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelado) setCargando(false) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  // El reloj que hace que un dato pueda caducar sin que nadie toque nada.
  useEffect(() => {
    if (umbralMin <= 0) return          // sin caducidad, no hace falta reloj
    const id = setInterval(() => setAhora(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [umbralMin])

  const recargar = useCallback(() => setTick(t => t + 1), [])

  return { datos, cargando, error, sello: selloDe(leidoA, ahora, umbralMin), recargar }
}
