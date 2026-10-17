// src/modules/conta/diseno/Chip.tsx
//
// S01 · La píldora de estado. Funde las dos de antes (`Chip` de ui/piezas y
// `TonoChip` del libro) en una, con los tonos de las maquetas:
//   · seguro  — verde: «Seguro», «Cobrada · casada con el banco».
//   · duda    — ámbar: «Duda: ¿retención 19 %?», «Vencida · recordatorio enviado».
//   · falta   — rojo: «Falta el documento».
//   · neutro  — gris azulado: «Vence 16/11», «Llegó por correo el 16/10».
//   · accion  — azul suave: el nivel «Medio», lo seleccionado.
//   · oscuro  — tinta: el nivel «Experto».
// El color nunca va solo: el texto dice lo mismo (WCAG 1.4.1).

import type { ReactNode } from 'react'
import type { TonoChip } from './valores'

export function Chip({ tono = 'neutro', children, titulo }: { tono?: TonoChip; children: ReactNode; titulo?: string }) {
  return <span className="s-chip" data-tono={tono} title={titulo}>{children}</span>
}
