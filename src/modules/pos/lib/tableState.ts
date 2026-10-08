// src/modules/pos/lib/tableState.ts
//
// TPV · Sala (S1). Cómo se lee el estado de una mesa. El estado lo CALCULA el
// servidor (pos_floor / _pos_table_state); aquí solo se decide su palabra, su
// color y su icono — los tres juntos, nunca el color solo.
//
// Solo dice lo que el sistema sabe (regla 5 del sistema de diseño): nunca
// «en la mesa» ni «servido». Hasta S3 (pases) un envío se lee «Pedido en cocina».

import type { LucideIcon } from 'lucide-react'
import { Circle, PencilLine, ChefHat, Receipt, CheckCheck } from 'lucide-react'

export type TableState = 'libre' | 'sin_pedir' | 'en_cocina' | 'pide_cuenta' | 'cobrada'

export interface TableStateLook {
  label: string
  icon: LucideIcon
  // Clases de los tokens del TPV (tpvTokens.css → tailwind.config.js).
  border: string
  chip: string
}

export const TABLE_STATE_LOOK: Record<TableState, TableStateLook> = {
  libre:       { label: 'Libre',             icon: Circle,     border: 'border-tpv-line',   chip: 'bg-tpv-surface-2 text-tpv-txt-2' },
  sin_pedir:   { label: 'Sin pedir',         icon: PencilLine, border: 'border-tpv-accent', chip: 'bg-tpv-accent text-white' },
  en_cocina:   { label: 'Pedido en cocina',  icon: ChefHat,    border: 'border-tpv-note',   chip: 'bg-tpv-note text-black' },
  pide_cuenta: { label: 'Pide la cuenta',    icon: Receipt,    border: 'border-tpv-warn',   chip: 'bg-tpv-warn text-black' },
  cobrada:     { label: 'Cobrada · recoger', icon: CheckCheck, border: 'border-tpv-ok',     chip: 'bg-tpv-ok text-white' },
}

export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
