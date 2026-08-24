// src/modules/kitchen/components/DropZone.tsx
//
// F5: destino de soltado para una categoría VACÍA. Sin esto no habría forma de
// llevar el primer producto a una categoría recién creada — no hay ninguna fila
// sobre la que soltar, y una categoría vacía es justo la que más lo necesita.

import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'

interface Props {
  id: string
  children: ReactNode
  className?: string
}

export default function DropZone({ id, children, className = '' }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors duration-150 ${
        isOver ? 'bg-background-info ring-2 ring-inset ring-text-info/50' : ''}`}
    >
      {children}
    </div>
  )
}
