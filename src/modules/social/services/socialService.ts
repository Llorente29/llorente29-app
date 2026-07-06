// src/modules/social/services/socialService.ts
//
// Service del módulo Folvy Social. Pieza 1: lectura de la cola.
// El módulo lee social_post (borradores que propone el agente). La escritura
// (aprobar/descartar/editar/regenerar) llega en la Pieza 2.

import { supabase } from '@/lib/supabase'

// Forma conocida del payload jsonb que escribe el agente (social-agent v2.4).
export interface SocialPayload {
  copy?: string
  hashtags?: string[]
  image_url?: string | null
  image_level?: string            // 'N1-pendiente' | 'N1-procesando' | 'N1' | 'N1-error'
  template?: string               // 'apetito' | 'curiosidad' | 'oferta'
  brand_anonymous?: boolean
  star_item?: string
  brand_name?: string | null
  link?: string
  format?: string
  coupon_id?: string | null
  directive?: { kind: string; theme?: string | null } | null
  phase?: string
}

export interface SocialPostRow {
  id: string
  network: string
  status: string                  // draft | approved | scheduled | publishing | published | discarded | error
  payload: SocialPayload
  reason: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
}

// Estados que viven en la COLA (pendientes de decidir / en curso). Los publicados
// y descartados no entran aquí (los publicados irán a la Parrilla en la Pieza 4).
const QUEUE_STATUSES = ['draft', 'approved', 'scheduled', 'publishing', 'error']

export async function listQueue(accountId: string): Promise<SocialPostRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('social_post')
    .select('id, network, status, payload, reason, scheduled_at, published_at, created_at')
    .eq('account_id', accountId)
    .in('status', QUEUE_STATUSES)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SocialPostRow[]
}
