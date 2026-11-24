// src/modules/conta/nucleo/conciliar/ConciliarSegun.tsx
//
// X29 · Qué pantalla sale en «Conciliar»: dentro de una pestaña del núcleo, la Gestión de extractos bancarios; fuera
// (el interruptor del núcleo apagado, o en el móvil), la de Bancos de siempre. Como BancosSegun (E05).

import type { ReactNode } from 'react'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import PantallaConciliar from './PantallaConciliar'

export default function ConciliarSegun({ hoy }: { hoy: ReactNode }) {
  return usePestana() ? <PantallaConciliar /> : <>{hoy}</>
}
