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

import { useCallback, useEffect, useState } from 'react'
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

interface Estado<T> {
  /** Identidad de la petición: cambia cuando cambian las dependencias. */
  clave: string
  datos: T | null
  cargando: boolean
  error: string | null
  leidoA: Date | null
}

/**
 * `cargar` DEBE venir memorizada (`useCallback`). No se guarda en una ref para
 * esquivarlo: una ref escrita durante el render es de las cosas que funcionan
 * hasta que React decide renderizar dos veces, y entonces el fallo aparece en
 * producción y no en las pruebas. Si el linter se queja de las dependencias,
 * la respuesta es memorizar la función, no callar al linter.
 */
export function useDatoDeTarjeta<T>(
  cargar: () => Promise<T>,
  deps: unknown[],
  umbralMin: number = UMBRAL_POR_DEFECTO_MIN,
): DatoDeTarjeta<T> {
  const clave = JSON.stringify(deps)
  const [recarga, setRecarga] = useState(0)
  const [estado, setEstado] = useState<Estado<T>>(
    () => ({ clave, datos: null, cargando: true, error: null, leidoA: null }),
  )
  const [ahora, setAhora] = useState<Date>(() => new Date())

  // CAMBIO DE DEPENDENCIAS: se ajusta EN RENDER, que es el patrón que React
  // recomienda para resetear estado cuando cambia la entrada. Ponerlo en el
  // efecto pintaría un frame con el dato de la petición anterior — el dato de
  // OTRO local, en esta pantalla — y acto seguido lo borraría.
  if (estado.clave !== clave) {
    setEstado({ clave, datos: null, cargando: true, error: null, leidoA: null })
  }

  useEffect(() => {
    let cancelado = false
    cargar()
      .then(d => {
        if (cancelado) return
        setEstado(e => (e.clave !== clave ? e
          : { ...e, datos: d, error: null, cargando: false, leidoA: new Date() }))
      })
      .catch(err => {
        // No se toca `datos`: lo último bueno sigue en pantalla y el sello sigue
        // diciendo de cuándo es. Mentir sería sustituirlo por un cero.
        if (cancelado) return
        setEstado(e => (e.clave !== clave ? e
          : { ...e, cargando: false, error: err instanceof Error ? err.message : String(err) }))
      })
    return () => { cancelado = true }
  }, [cargar, clave, recarga])

  // El reloj que hace que un dato pueda caducar sin que nadie toque nada.
  useEffect(() => {
    if (umbralMin <= 0) return          // sin caducidad, no hace falta reloj
    const id = setInterval(() => setAhora(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [umbralMin])

  const recargar = useCallback(() => setRecarga(n => n + 1), [])

  return {
    datos: estado.datos,
    cargando: estado.cargando,
    error: estado.error,
    sello: selloDe(estado.leidoA, ahora, umbralMin),
    recargar,
  }
}
