// src/modules/conta/marco/MarcoConta.tsx
//
// El marco de las pantallas del módulo: fondo con su degradado, menú flotante
// (ordenador) o barra inferior (móvil), y la barra «Pregunta o pide algo»,
// con el ejemplo de la ruta o el que ponga la pantalla (ejemploPregunta.ts).
// Todo cuelga de `.cx`: fuera de aquí el estilo nuevo no existe.

import { useState, type ReactNode } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { MenuConta, BarraInferiorConta } from '@/modules/conta/marco/MenuConta'
import { BarraPregunta } from '@/modules/conta/marco/BarraPregunta'
import { EjemploPreguntaContexto } from '@/modules/conta/marco/ejemploPregunta'

export function MarcoConta({ children, ejemplo }: { children: ReactNode; ejemplo: string }) {
  const movil = useIsMobile()
  const [dePantalla, setDePantalla] = useState<string | null>(null)
  return (
    <EjemploPreguntaContexto.Provider value={setDePantalla}>
      <div className="cx">
        <div className="cx-marco">
          {!movil && <MenuConta />}
          <main className="cx-principal">{children}</main>
        </div>
        {movil ? <BarraInferiorConta /> : <BarraPregunta ejemplo={dePantalla ?? ejemplo} />}
      </div>
    </EjemploPreguntaContexto.Provider>
  )
}
