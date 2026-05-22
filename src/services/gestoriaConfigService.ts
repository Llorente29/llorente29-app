// src/services/gestoriaConfigService.ts
// Configuración de envío a gestoría por cuenta. Persiste en account_gestoria_config.
// Sprint Personal T8 Punto 3 (mayo 2026).

import { supabase } from '../lib/supabase'

export interface GestoriaConfig {
  accountId: string
  gestoriaNombre: string
  gestoriaEmail: string
  enabled: boolean
  dayOfMonth: number
  lastSentAt?: string
  createdAt: string
  updatedAt: string
}

export interface GestoriaConfigPatch {
  gestoriaNombre?: string
  gestoriaEmail?: string
  enabled?: boolean
  dayOfMonth?: number
  lastSentAt?: string | null
}

interface GestoriaConfigRow {
  account_id: string
  gestoria_nombre: string
  gestoria_email: string
  enabled: boolean
  day_of_month: number
  last_sent_at: string | null
  created_at: string
  updated_at: string
}

function rowToConfig(r: GestoriaConfigRow): GestoriaConfig {
  return {
    accountId: r.account_id,
    gestoriaNombre: r.gestoria_nombre,
    gestoriaEmail: r.gestoria_email,
    enabled: r.enabled,
    dayOfMonth: Number(r.day_of_month),
    lastSentAt: r.last_sent_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchGestoriaConfig(accountId: string): Promise<GestoriaConfig | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('account_gestoria_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) { console.error('fetchGestoriaConfig:', error); return null }
  if (!data) return null
  return rowToConfig(data as GestoriaConfigRow)
}

interface GestoriaConfigRowPatch {
  gestoria_nombre?: string
  gestoria_email?: string
  enabled?: boolean
  day_of_month?: number
  last_sent_at?: string | null
}

export async function updateGestoriaConfig(
  accountId: string,
  patch: GestoriaConfigPatch
): Promise<boolean> {
  if (!supabase) return false
  const row: GestoriaConfigRowPatch = {}
  if (patch.gestoriaNombre !== undefined) row.gestoria_nombre = patch.gestoriaNombre
  if (patch.gestoriaEmail  !== undefined) row.gestoria_email  = patch.gestoriaEmail
  if (patch.enabled        !== undefined) row.enabled         = patch.enabled
  if (patch.dayOfMonth     !== undefined) row.day_of_month    = patch.dayOfMonth
  if (patch.lastSentAt     !== undefined) row.last_sent_at    = patch.lastSentAt
  if (Object.keys(row).length === 0) return true
  const { error } = await supabase
    .from('account_gestoria_config')
    .update(row)
    .eq('account_id', accountId)
  if (error) { console.error('updateGestoriaConfig:', error); return false }
  return true
}
