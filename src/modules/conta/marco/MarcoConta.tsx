// src/modules/conta/marco/MarcoConta.tsx
//
// El marco de las pantallas del módulo: fondo con su degradado, menú flotante
// (ordenador) o barra inferior (móvil), y la barra «Pregunta o pide algo».
// Todo cuelga de `.cx`: fuera de aquí el estilo nuevo no existe.

import type { ReactNode } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { MenuConta, BarraInferiorConta } from '@/modules/conta/marco/MenuConta'
import { BarraPregunta } from '@/modules/conta/marco/BarraPregunta'

export function MarcoConta({ children, ejemplo }: { children: ReactNode; ejemplo: string }) {
  const movil = useIsMobile()
  return (
    <div className="cx">
      <div className="cx-marco">
        {!movil && <MenuConta />}
        <main className="cx-principal">{children}</main>
      </div>
      {movil ? <BarraInferiorConta /> : <BarraPregunta ejemplo={ejemplo} />}
    </div>
  )
}
