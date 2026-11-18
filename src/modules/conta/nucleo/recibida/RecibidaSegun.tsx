// src/modules/conta/nucleo/recibida/RecibidaSegun.tsx
//
// K04 · Qué ficha de la factura recibida sale: dentro de una pestaña del núcleo
// (el interruptor conta_nucleo encendido y en ordenador: lo decide el marco,
// MarcoSegun), la nueva; fuera, la de hoy, sin un cambio. Así, con el
// interruptor apagado, todo sigue como hoy.

import type { ReactNode } from 'react'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import FichaRecibida from './FichaRecibida'

export default function RecibidaSegun({ aMano = false, hoy }: { aMano?: boolean; hoy: ReactNode }) {
  return usePestana() ? <FichaRecibida aMano={aMano} /> : <>{hoy}</>
}
