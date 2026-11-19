// src/modules/conta/nucleo/bancos/BancosSegun.tsx
//
// E05 · Qué pantalla de Bancos sale: dentro de una pestaña del núcleo (el
// interruptor conta_nucleo encendido y en ordenador: lo decide el marco,
// MarcoSegun), la nueva; fuera, la de hoy, sin un cambio. Como RecibidaSegun (K04).

import type { ReactNode } from 'react'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import PantallaBancos from './PantallaBancos'

export default function BancosSegun({ hoy }: { hoy: ReactNode }) {
  return usePestana() ? <PantallaBancos /> : <>{hoy}</>
}
