// src/modules/conta/ui/marco/PeriodoEnBarra.tsx
//
// M01 · El ejercicio y el periodo en la barra de arriba («2026 · Oct ▾»,
// maqueta N30 §2). Decisión de Julio (F01, respuesta 8): solo en las pantallas
// que ya lo leen. La pantalla que lo lee lo pone aquí con lo suyo dentro; las
// demás no ponen nada y en la barra no sale (la lista con la que se elige es
// la que se lee: regla 30).

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'

export function PeriodoEnBarra({ children }: { children: ReactNode }) {
  const marco = useMarco()
  if (!marco?.huecoPeriodo) return <>{children}</>
  return createPortal(children, marco.huecoPeriodo)
}
