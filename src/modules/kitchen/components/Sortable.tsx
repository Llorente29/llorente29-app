// src/modules/kitchen/components/Sortable.tsx
//
// F5: envoltorio de una fila arrastrable. Existe porque `useSortable` es un
// hook y no se puede llamar dentro del `.map` de la lista — hay que bajar un
// componente por fila. Usa render-prop para no imponer NADA sobre cómo se
// pinta la fila: la lista sigue siendo la lista, esto solo le presta el gesto.
//
// El asa (`listeners`) se entrega aparte del nodo: así el arrastre se activa
// solo desde el agarre y no desde toda la fila, que es lo que permite que
// seguir pulsando el producto siga abriendo su ficha.

import type { ReactNode, CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface SortableRender {
  setNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
  /** Se ponen SOLO en el asa, no en la fila entera. */
  handleProps: Record<string, unknown>
  isDragging: boolean
}

interface Props {
  id: string
  disabled?: boolean
  children: (r: SortableRender) => ReactNode
}

export default function Sortable({ id, disabled = false, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // La fila arrastrada se atenúa en su hueco: el que se ve "de verdad" es el
    // DragOverlay que sigue al dedo.
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 30 : undefined,
  }

  return <>{children({ setNodeRef, style, handleProps: { ...attributes, ...listeners }, isDragging })}</>
}
