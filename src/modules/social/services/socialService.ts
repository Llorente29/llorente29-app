// src/modules/social/services/socialService.ts
//
// Service del módulo Folvy Social.
// Cola · acciones · publicación · parrilla · fase · directivas · generar ahora · N2 (escenas).

import { supabase } from '@/lib/supabase'

export interface SocialPayload {
  copy?: string; hashtags?: string[]; image_url?: string | null; image_level?: string
  template?: string; brand_anonymous?: boolean; star_item?: string; brand_name?: string | null
  link?: string; format?: string; coupon_id?: string | null
  directive?: { kind: string; theme?: string | null } | null; phase?: string
}
export interface SocialPostRow {
  id: string; network: string; status: string; payload: SocialPayload
  reason: string | null; last_error: string | null
  scheduled_at: string | null; published_at: string | null; external_ref: string | null; created_at: string
}
export type LaunchPhase = 'apetito' | 'comunidad' | 'conversion'

const QUEUE_STATUSES = ['draft', 'approved', 'scheduled', 'publishing', 'error']
const GRID_STATUSES = ['published', 'scheduled']
const SELECT = 'id, network, status, payload, reason, last_error, scheduled_at, published_at, external_ref, created_at'

function requireSupabase() { if (!supabase) throw new Error('Supabase no está disponible') }

export async function listQueue(accountId: string): Promise<SocialPostRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('social_post').select(SELECT)
    .eq('account_id', accountId).in('status', QUEUE_STATUSES).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SocialPostRow[]
}
export async function listGrid(accountId: string): Promise<SocialPostRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('social_post').select(SELECT)
    .eq('account_id', accountId).in('status', GRID_STATUSES)
    .order('published_at', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SocialPostRow[]
}

export async function setStatus(postId: string, status: 'draft' | 'approved' | 'discarded'): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_social_post_status', { p_post_id: postId, p_status: status })
  if (error) throw error
}
export const approvePost = (id: string) => setStatus(id, 'approved')
export const unapprovePost = (id: string) => setStatus(id, 'draft')
export const discardPost = (id: string) => setStatus(id, 'discarded')
export const retryPost = (id: string) => setStatus(id, 'approved')

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

export async function requestGeneration(accountId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('request_social_generation', { p_account_id: accountId })
  if (error) throw error
}

export async function getPhase(accountId: string): Promise<LaunchPhase> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('get_launch_phase', { p_account_id: accountId })
  if (error) throw error
  return ((data as string) ?? 'apetito') as LaunchPhase
}
export async function setPhase(accountId: string, phase: LaunchPhase): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_launch_phase', { p_account_id: accountId, p_phase: phase })
  if (error) throw error
}

// ── Directivas ──────────────────────────────────────────────────────────────
export type DirectiveKind = 'push' | 'context' | 'custom'
export interface NewDirective {
  kind: DirectiveKind; brand_id?: string | null; menu_item_id?: string | null
  template?: string | null; theme?: string | null; caption?: string | null
  hashtags?: string[] | null; photo_url?: string | null
}
export interface DirectiveRow {
  id: string; kind: DirectiveKind; status: string
  brand_id: string | null; menu_item_id: string | null; template: string | null
  theme: string | null; caption: string | null; photo_url: string | null; created_at: string
}
export async function createDirective(accountId: string, d: NewDirective): Promise<void> {
  requireSupabase()
  const { data: u } = await supabase!.auth.getUser()
  const { error } = await supabase!.from('social_directive').insert({
    account_id: accountId, kind: d.kind,
    brand_id: d.brand_id ?? null, menu_item_id: d.menu_item_id ?? null,
    template: d.template ?? null, theme: d.theme ?? null,
    caption: d.caption ?? null, hashtags: d.hashtags ?? null, photo_url: d.photo_url ?? null,
    created_by: u?.user?.id ?? null,
  } as never)
  if (error) throw error
}
export async function listDirectives(accountId: string): Promise<DirectiveRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('social_directive')
    .select('id, kind, status, brand_id, menu_item_id, template, theme, caption, photo_url, created_at')
    .eq('account_id', accountId).eq('status', 'pending').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as DirectiveRow[]
}
export async function cancelDirective(id: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('social_directive').update({ status: 'cancelled' } as never).eq('id', id)
  if (error) throw error
}

export interface BrandRow { id: string; name: string; ownership_type: string }
export interface DishRow { id: string; name: string; photo_url: string | null }
export async function listBrands(accountId: string): Promise<BrandRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('brand').select('id, name, ownership_type')
    .eq('account_id', accountId).eq('is_active', true)
    .in('ownership_type', ['own', 'licensed']).order('name')
  if (error) throw error
  return (data ?? []) as unknown as BrandRow[]
}
export async function listDishes(accountId: string, brandId: string): Promise<DishRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('menu_item').select('id, name, photo_url')
    .eq('account_id', accountId).eq('brand_id', brandId)
    .is('archived_at', null).is('mirror_of_item_id', null).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DishRow[]
}

// ── N2 · config + biblioteca de escenas ─────────────────────────────────────
export interface N2Config { n2_enabled: boolean; n2_daily_cap: number; n2_mood_ratio: number }
export interface SceneRow {
  id: string; account_id: string | null; mode: 'dress' | 'mood'
  label: string; prompt: string; is_active: boolean; weight: number
}

export async function getN2Config(accountId: string): Promise<N2Config> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('get_n2_config', { p_account_id: accountId })
  if (error) throw error
  const row: any = Array.isArray(data) ? data[0] : data
  return {
    n2_enabled: row?.n2_enabled ?? false,
    n2_daily_cap: row?.n2_daily_cap ?? 30,
    n2_mood_ratio: row?.n2_mood_ratio ?? 5,
  }
}
export async function setN2Config(accountId: string, c: N2Config): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_n2_config', {
    p_account_id: accountId, p_enabled: c.n2_enabled, p_cap: c.n2_daily_cap, p_ratio: c.n2_mood_ratio,
  })
  if (error) throw error
}

const SCENE_SEL = 'id, account_id, mode, label, prompt, is_active, weight'
// Biblioteca: la propia si existe; si no, las globales (isOwn=false → solo lectura).
export async function listScenes(accountId: string): Promise<{ scenes: SceneRow[]; isOwn: boolean }> {
  if (!supabase) return { scenes: [], isOwn: false }
  const { data: own } = await supabase.from('social_scene').select(SCENE_SEL)
    .eq('account_id', accountId).order('mode').order('label')
  if (own && own.length) return { scenes: own as unknown as SceneRow[], isOwn: true }
  const { data: glob } = await supabase.from('social_scene').select(SCENE_SEL)
    .is('account_id', null).order('mode').order('label')
  return { scenes: (glob ?? []) as unknown as SceneRow[], isOwn: false }
}
export async function seedAccountScenes(accountId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('seed_account_scenes', { p_account_id: accountId })
  if (error) throw error
  return (data as number) ?? 0
}
export async function createScene(accountId: string, s: { mode: 'dress' | 'mood'; label: string; prompt: string; weight: number }): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('social_scene').insert({
    account_id: accountId, mode: s.mode, label: s.label, prompt: s.prompt, weight: s.weight, is_active: true,
  } as never)
  if (error) throw error
}
export async function updateScene(id: string, patch: Partial<Pick<SceneRow, 'label' | 'prompt' | 'weight' | 'is_active'>>): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('social_scene').update(patch as never).eq('id', id)
  if (error) throw error
}
export async function deleteScene(id: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('social_scene').delete().eq('id', id)
  if (error) throw error
}

// ── Publicación asistida ────────────────────────────────────────────────────
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
  a.href = objectUrl; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(objectUrl)
}
