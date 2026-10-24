// src/modules/conta/diseno/plantillas/useAncho.ts
//
// N5 · El tramo de ancho de la ventana (anchos.ts), vivo: cambia al
// redimensionar. Sin ventana (pruebas sin navegador), el ancho.

import { useSyncExternalStore } from 'react'
import { tramoDeAncho, type TramoAncho } from './anchos'

function suscribir(avisar: () => void): () => void {
  window.addEventListener('resize', avisar)
  return () => window.removeEventListener('resize', avisar)
}

export function useTramoAncho(): TramoAncho {
  return useSyncExternalStore(suscribir, () => tramoDeAncho(window.innerWidth), () => 'ancho')
}
