// src/modules/conta/nucleo/MarcoSegun.tsx
//
// K02 · El que elige el marco de cada pantalla (module.tsx, `enMarco`): con el
// interruptor `conta_nucleo` de la cuenta encendido y en el ordenador, el del
// núcleo; si no, el de hoy, tal cual (decisión 2 de Julio, 17/11). Es el mismo
// componente en todas las rutas, así que React lo conserva al cambiar de
// pantalla (como conserva hoy el Marco): el marco no se monta de nuevo.

import type { ReactNode } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { Marco } from '@/modules/conta/marco/Marco'
import { cualMarco, useNucleoEncendido } from './interruptor'
import { MarcoNucleo } from './MarcoNucleo'

export function MarcoSegun({ children, sinPregunta = false }: { children: ReactNode; sinPregunta?: boolean }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  return cualMarco({ encendido, movil }) === 'nucleo'
    ? <MarcoNucleo sinPregunta={sinPregunta}>{children}</MarcoNucleo>
    : <Marco sinPregunta={sinPregunta}>{children}</Marco>
}
