// src/modules/conta/marco/MarcoConta.tsx
//
// El marco de las pantallas del módulo: fondo con su degradado, menú flotante
// (ordenador) o barra inferior (móvil), y la barra «Pregunta o pide algo»,
// con el ejemplo de la ruta o el que ponga la pantalla (ejemploPregunta.ts).
// `sinPregunta` (B01, respuesta 4): una pantalla donde la barra solo diría
// «Muy pronto» no la enseña, ni el botón central de la IA en el móvil (lo que
// no funciona no se enseña; y nada flotante tapa una fila).
// Todo cuelga de `.cx`: fuera de aquí el estilo nuevo no existe.

import { useState, type ReactNode } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { MenuConta, BarraInferiorConta } from '@/modules/conta/marco/MenuConta'
import { BarraPregunta } from '@/modules/conta/marco/BarraPregunta'
import { EjemploPreguntaContexto } from '@/modules/conta/marco/ejemploPregunta'

export function MarcoConta({ children, ejemplo, sinPregunta = false }: { children: ReactNode; ejemplo: string; sinPregunta?: boolean }) {
  const movil = useIsMobile()
  const [dePantalla, setDePantalla] = useState<string | null>(null)
  return (
    <EjemploPreguntaContexto.Provider value={setDePantalla}>
      <div className="cx">
        <div className="cx-marco">
          {!movil && <MenuConta />}
          <main className="cx-principal">{children}</main>
        </div>
        {movil ? <BarraInferiorConta sinIA={sinPregunta} /> : !sinPregunta && <BarraPregunta ejemplo={dePantalla ?? ejemplo} />}
      </div>
    </EjemploPreguntaContexto.Provider>
  )
}
