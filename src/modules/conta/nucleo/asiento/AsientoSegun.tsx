// src/modules/conta/nucleo/asiento/AsientoSegun.tsx
//
// N08 · Qué pantalla del asiento se pinta: con `conta_nucleo` encendido y en el ordenador, la del núcleo; si no, la de
// hoy, tal cual (reglas comunes: «Apagado, la pantalla de hoy byte a byte. Encendido en el móvil, también la de hoy»).
// La misma regla que el marco (cualMarco).
// K12 · La del núcleo es el asiento general como ERP10 (AsientoGeneral, maqueta nucleo_19): sustituye a la ficha del
// N08, que se quita (no conviven dos). La del móvil y la del interruptor apagado se quedan (Julio, 22/11).

import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { cualMarco, useNucleoEncendido } from '@/modules/conta/nucleo/interruptor'
import { AsientoGeneral } from './AsientoGeneral'

export function AsientoSegun({ hoy, nuevo = false }: { hoy: ReactNode; nuevo?: boolean }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  const { entryId } = useParams()
  if (cualMarco({ encendido, movil }) !== 'nucleo') return <>{hoy}</>
  return <AsientoGeneral key={nuevo ? 'nuevo' : entryId} entryId={nuevo ? undefined : entryId} />
}
