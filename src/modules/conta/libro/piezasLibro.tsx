// src/modules/conta/libro/piezasLibro.tsx
//
// C04 · Piezas del libro diario que comparten N11 y N12.

import type { ReactNode } from 'react'
import { Chip } from '@/modules/conta/ui/piezas'
import type { TonoEstado } from '@/modules/conta/lib/diario'

/** El estado del asiento con el tono de la maqueta: ámbar para revisar, verde lo hecho por Folvy, gris lo anulado. */
export function TonoChip({ tono, children }: { tono: TonoEstado; children: ReactNode }) {
  const t = tono === 'verde' ? 'ia' : tono === 'azul' ? 'blanco' : tono === 'ambar' ? 'ambar' : 'neutro'
  return <span className={tono === 'gris' ? 'cxd-chip-gris' : undefined}><Chip tono={t}>{children}</Chip></span>
}
