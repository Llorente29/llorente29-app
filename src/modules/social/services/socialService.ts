// src/modules/social/services/socialService.ts
//
// Service del módulo Folvy Social.
// Pieza 1: lectura.  Pieza 2: acciones.  Pieza 3: publicación (asistida + estado real IG).

import { supabase } from '@/lib/supabase'

export interface SocialPayload {
  copy?: string
  hashtags?: string[]
  image_url?: string | null
  image_level?: string
  template?: string
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
  status: string
  payload: SocialPayload
  reason: string | null
  last_error: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
}

const QUEUE_STATUSES = ['draft', 'approved', 'scheduled', 'publishing', 'error']

export async function listQueue(accountId: string): Promise<SocialPostRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('social_post')
    .select('id, network, status, payload, reason, last_error, scheduled_at, published_at, created_at')
    .eq('account_id', accountId)
    .in('status', QUEUE_STATUSES)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SocialPostRow[]
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está disponible')
}

export async function setStatus(postId: string, status: 'draft' | 'approved' | 'discarded'): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_social_post_status', { p_post_id: postId, p_status: status })
  if (error) throw error
}
export const approvePost   = (id: string) => setStatus(id, 'approved')
export const unapprovePost = (id: string) => setStatus(id, 'draft')
export const discardPost   = (id: string) => setStatus(id, 'discarded')
export const retryPost     = (id: string) => setStatus(id, 'approved')  // error → approved (el cron reintenta)

export async function updateContent(postId: string, copy: string, hashtags: string[]): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('update_social_post_content', { p_post_id: postId, p_copy: copy, p_hashtags: hashtags })
  if (error) throw error
}

export async function requeueImage(postId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('requeue_social_image', { p_post_id: postId })
  if (error) throw error
}

export async function regenerateCopy(postId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('regenerate_social_copy', { p_post_id: postId })
  if (error) throw error
  return (data as string) ?? ''
}

export async function markPublished(postId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('mark_social_post_published', { p_post_id: postId })
  if (error) throw error
}

// ── Helpers de publicación asistida (cliente) ───────────────────────────────

export function captionText(p: SocialPayload): string {
  return [p.copy, (p.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n')
}

export async function copyCaption(p: SocialPayload): Promise<void> {
  await navigator.clipboard.writeText(captionText(p))
}

export async function downloadImage(url: string, filename = 'foodint.jpg'): Promise<void> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('No se pudo descargar la imagen')
  const blob = await resp.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
