// src/modules/pos/lib/tableState.ts
//
// TPV · Sala (S1). Cómo se lee el estado de una mesa. El estado lo CALCULA el
// servidor (pos_floor / _pos_table_state); aquí solo se decide su palabra, su
// color y su icono — los tres juntos, nunca el color solo.
//
// Fiel a la maqueta «Folvy TPV · Sala» (pantalla 1): libre · ocupada (borde
// blanco, cubiertos) · pide la cuenta (ámbar) · cobrada · recoger (verde).
// Solo dice lo que el sistema sabe (regla 5 del sistema de diseño): nunca
// «en la mesa» ni «servido». Hasta S3 (pases) un envío se lee «Pedido en cocina».

import type { LucideIcon } from 'lucide-react'
import { Circle, PencilLine, Utensils, ReceiptText, Check } from 'lucide-react'

export type TableState = 'libre' | 'sin_pedir' | 'en_cocina' | 'pide_cuenta' | 'cobrada'

export interface TableStateLook {
  label: string
  icon: LucideIcon
  // Clases de los tokens del TPV (tpvTokens.css → tailwind.config.js).
  tile: string      // borde + fondo de la tarjeta de mesa
  ink: string       // color de la palabra y el icono del estado
}

const OCUPADA = 'border-tpv-txt bg-tpv-surface-2'

export const TABLE_STATE_LOOK: Record<TableState, TableStateLook> = {
  libre:       { label: 'Libre',             icon: Circle,     tile: 'border-tpv-line bg-tpv-surface',     ink: 'text-tpv-txt-2' },
  sin_pedir:   { label: 'Sin pedir',         icon: PencilLine, tile: OCUPADA,                              ink: 'text-tpv-txt' },
  en_cocina:   { label: 'Pedido en cocina',  icon: Utensils,   tile: OCUPADA,                              ink: 'text-tpv-txt' },
  pide_cuenta: { label: 'Pide la cuenta',    icon: ReceiptText,    tile: 'border-tpv-warn bg-tpv-warn-tint',   ink: 'text-tpv-warn-text' },
  cobrada:     { label: 'Cobrada · recoger', icon: Check,      tile: 'border-tpv-ok bg-tpv-ok-tint',       ink: 'text-tpv-ok-text' },
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

// «Sala · 6 de 13 ocupadas» / «Barra · 3 cuentas»: la barra no se mide por
// mesas libres, sino por cuentas abiertas.
export function zoneOccupancyLabel(kind: string, busy: number, total: number, short = false): string {
  if (kind === 'barra') return `${busy} cuenta${busy === 1 ? '' : 's'}`
  return short ? `${busy} de ${total}` : `${busy} de ${total} ocupadas`
}
