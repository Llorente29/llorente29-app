// src/shell/version/useNuevaVersion.ts
//
// El vigía de versión, en forma de hook. Dos conductas, y la diferencia es si
// hay alguien delante (Julio, 01/09):
//
//   · OFICINA  → avisa y ofrece recargar. Decide la persona.
//   · TABLET   → se recarga sola, porque no hay nadie que pulse. Pero NUNCA en
//                mitad de un pedido: espera a que no haya trabajo en curso.
//
// Quién sabe si hay trabajo en curso no es este hook: es la pantalla, que lo
// declara en `trabajoEnCurso.ts`. Aquí solo se pregunta.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  INTERVALO_MS, buildEnEjecucion, hayVersionNueva, leeVersionPublicada,
  type VersionPublicada,
} from '@/services/versionApp'
import { hayTrabajoEnCurso } from '@/services/trabajoEnCurso'

export interface EstadoVersion {
  hayNueva: boolean
  publicada: VersionPublicada | null
  enEjecucion: string | null
  recargar: () => void
}

export function useNuevaVersion(opciones?: {
  intervaloMs?: number
  /**
   * Se recarga sola al detectar versión nueva, si `puedeRecargar()` lo permite.
   * Para la tablet. En oficina se deja en false: recargar por su cuenta le
   * borraría a alguien lo que está escribiendo.
   */
  autoRecarga?: boolean
  /** Última palabra antes de recargar sola. Por defecto: nada en curso. */
  puedeRecargar?: () => boolean
  /** Margen entre detectar y recargar, para que dé tiempo a verse el aviso. */
  esperaMs?: number
}): EstadoVersion {
  const intervalo = opciones?.intervaloMs ?? INTERVALO_MS
  const auto = opciones?.autoRecarga ?? false
  const espera = opciones?.esperaMs ?? 10_000
  const puede = opciones?.puedeRecargar
  const enEjecucion = buildEnEjecucion()

  const [publicada, setPublicada] = useState<VersionPublicada | null>(null)
  const yaRecargando = useRef(false)

  const recargar = useCallback(() => {
    if (yaRecargando.current) return
    yaRecargando.current = true
    window.location.reload()
  }, [])

  // Sondeo. Se salta el tick con la pestaña oculta —una pestaña de fondo no
  // necesita enterarse— y se comprueba en cuanto vuelve a mirarse, que es
  // justo cuando importa.
  useEffect(() => {
    if (!enEjecucion) return   // dev, o build sin sellar: nada que comparar
    let cancelado = false

    const mirar = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const v = await leeVersionPublicada()
      if (!cancelado && v) setPublicada(v)
    }

    void mirar()
    const id = window.setInterval(() => { void mirar() }, intervalo)
    const alVolver = () => { void mirar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      cancelado = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [enEjecucion, intervalo])

  const hayNueva = hayVersionNueva(enEjecucion, publicada)

  // Recarga automática (tablet). REINTENTA mientras haya trabajo en curso en
  // vez de rendirse: la comanda acaba, y entonces sí.
  useEffect(() => {
    if (!auto || !hayNueva) return
    const permitido = puede ?? (() => !hayTrabajoEnCurso())
    const id = window.setInterval(() => {
      if (permitido()) {
        window.clearInterval(id)
        recargar()
      }
    }, espera)
    return () => window.clearInterval(id)
  }, [auto, hayNueva, espera, puede, recargar])

  return { hayNueva, publicada, enEjecucion, recargar }
}
