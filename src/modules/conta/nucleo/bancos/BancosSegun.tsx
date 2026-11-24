// src/modules/conta/nucleo/bancos/BancosSegun.tsx
//
// E05 · Qué pantalla de Bancos sale: dentro de una pestaña del núcleo (el
// interruptor conta_nucleo encendido y en ordenador: lo decide el marco,
// MarcoSegun), la nueva; fuera, la de hoy, sin un cambio. Como RecibidaSegun (K04).
// X28 · La nueva es Tesorería como ERP10 («Introducción de asientos por tesorería»):
// sustituye a la de E05 y R08 (marcar varios y «Conciliar los N» se quitan).

import type { ReactNode } from 'react'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import PantallaTesoreria from '../tesoreria/PantallaTesoreria'

export default function BancosSegun({ hoy }: { hoy: ReactNode }) {
  return usePestana() ? <PantallaTesoreria /> : <>{hoy}</>
}
