// src/modules/conta/nucleo/asiento/AsientoSegun.tsx
//
// N08 · Qué ficha del asiento se pinta: con `conta_nucleo` encendido y en el ordenador, la del
// núcleo (FichaAsiento); si no, la de hoy, tal cual (reglas comunes: «Apagado, la pantalla de hoy
// byte a byte. Encendido en el móvil, también la de hoy»). La misma regla que el marco (cualMarco).

import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { cualMarco, useNucleoEncendido } from '@/modules/conta/nucleo/interruptor'
import { FichaAsiento } from './FichaAsiento'

export function AsientoSegun({ hoy, nuevo = false }: { hoy: ReactNode; nuevo?: boolean }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  const { entryId } = useParams()
  if (cualMarco({ encendido, movil }) !== 'nucleo') return <>{hoy}</>
  return <FichaAsiento key={nuevo ? 'nuevo' : entryId} entryId={nuevo ? undefined : entryId} />
}
