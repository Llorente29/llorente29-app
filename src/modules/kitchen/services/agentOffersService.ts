// src/modules/kitchen/services/agentOffersService.ts
//
// Board UNIFICADO de "Ofertas del agente" (los 4 canales juntos). Lectura única
// server-side vía RPC `agent_offers_unified` (migración 20260708T1200): una fila
// por oferta con forma idéntica para shop/glovo/uber/justeat. Sustituye el doble
// origen anterior (platformOffersService.listCampaigns glovo/uber + campaignService
// list_campaigns shop).
//
// El "porqué" del agente vive como texto libre en coupon.omnibus_ref_note; aquí se
// PARSEA (motivo corto, ajuste de %, evento, nota de "a mano") — es presentación.
//
// El MARGEN real no está persistido: para plataforma (glovo/uber/justeat) se calcula
// BAJO DEMANDA al abrir la tarjeta, reutilizando preview_platform_promo_impact
// (platformOffersService.previewImpact) con el scope leído de ese único cupón. Para
// Shop no se estima: se muestra el ROI/canjes REAL que la RPC ya trae.
//
// `coupon` no está en database.ts → cast `supabase as any` (db()).

import { supabase } from '@/lib/supabase'
import { previewImpact } from '@/modules/kitchen/services/platformOffersService'

function db(): any {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase as any
}

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

export type OfferChannel = 'shop' | 'glovo' | 'uber' | 'justeat'
export type OfferStatus =
  | 'propuesta' | 'borrador' | 'programada' | 'publicada'
  | 'pendiente' | 'pausada' | 'finalizada' | 'agotada'
export type PublishMode = 'auto' | 'robot' | 'manual'
export type DiscountType = 'percent' | 'fixed'

export const OFFER_CHANNELS: OfferChannel[] = ['shop', 'glovo', 'uber', 'justeat']

export const CHANNEL_LABEL: Record<OfferChannel, string> = {
  shop: 'Shop', glovo: 'Glovo', uber: 'Uber', justeat: 'JustEat',
}

/** El porqué del agente, parseado del texto libre de omnibus_ref_note. */
export interface ParsedReason {
  /** Motivo corto y limpio para el chip ("Mantenimiento · sin objetivo"). */
  headline: string | null
  /** Texto COMPLETO del agente (sin la fecha), para el bloque "por qué" al expandir. */
  fullText: string | null
  /** "30%→10%" si el agente ajustó el % en la cascada. */
  adjusted: string | null
  /** true si el motivo menciona un evento de demanda al alza (meteo, fútbol…). */
  eventUp: boolean
  /** Cola "[PUBLICAR A MANO en …]" si la hay. */
  manualNote: string | null
}

export interface AgentOffer {
  id: string
  name: string
  channel: OfferChannel
  origin: string | null
  kind: string
  discountType: DiscountType
  value: number
  active: boolean
  status: OfferStatus
  publishMode: PublishMode
  brandNames: string[]
  locationNames: string[]
  weekdays: number[] | null
  timeFrom: string | null
  timeTo: string | null
  startsAt: string | null
  endsAt: string | null
  budgetMax: number | null
  reasonRaw: string | null
  reason: ParsedReason
  jobsTotal: number
  jobsDone: number
  jobsPending: number
  jobsError: number
  lastError: string | null
  redemptions: number
  discounted: number
  roi: number | null
}

/** Margen real de UNA oferta de plataforma, calculado bajo demanda. */
export interface OfferMargin {
  marginPctBefore: number | null
  marginPctAfter: number | null
  itemsBelowFloor: number
  itemsNoCost: number
  totalItems: number
}

// ─────────────────────────────────────────────────────────────────────
// Parseo del porqué
// ─────────────────────────────────────────────────────────────────────

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x))

export function parseReason(raw: string | null): ParsedReason {
  if (!raw || !raw.trim()) {
    return { headline: null, fullText: null, adjusted: null, eventUp: false, manualNote: null }
  }
  const text = raw.trim()

  // Texto COMPLETO (sin el prefijo "Agente YYYY-MM-DD:" ni la cola "[PUBLICAR A MANO…]",
  // que se muestra aparte con su icono) — se muestra entero al expandir.
  const fullText = text
    .replace(/^Agente\s+\d{4}-\d{2}-\d{2}\s*:?\s*/i, '')
    .replace(/\s*\[[^\]]*(?:a mano|PUBLICAR)[^\]]*\]\s*$/i, '')
    .trim() || null

  // Cola "[PUBLICAR A MANO en …]"
  const manualMatch = text.match(/\[([^\]]*a mano[^\]]*|[^\]]*PUBLICAR[^\]]*)\]/i)
  const manualNote = manualMatch ? manualMatch[1].trim() : null

  // "ajustado 30%→10%" / "ajustado 30→10%"
  const adjMatch = text.match(/ajustad[oa]\s*([0-9]+\s*%?\s*(?:→|->|-|a)\s*[0-9]+\s*%?)/i)
  const adjusted = adjMatch ? adjMatch[1].replace(/\s+/g, '').replace('->', '→').replace(/(\d)a(\d)/, '$1→$2') : null

  // Evento de demanda al alza (meteo hoy; fútbol/festivos cuando exista el recolector).
  const eventUp = /demanda-?up|meteo|calor|lluvia|f[uú]tbol|derbi|festivo|payday|evento/i.test(text)

  // Motivo corto y LIMPIO para el chip: estrategia + métrica clave (sin cortes feos).
  const strategy =
    /mantenimiento/i.test(text) ? 'Mantenimiento'
    : /crecimiento/i.test(text) ? 'Crecimiento'
    : /reactivaci[oó]n/i.test(text) ? 'Reactivación'
    : /urgente/i.test(text) ? 'Urgente'
    : null

  let metric: string | null = null
  const objPct = text.match(/=\s*([0-9]+\s*%\s*del\s*objetivo)/i)
  if (objPct) metric = objPct[1].replace(/\s+/g, ' ').trim()
  else if (/sin objetivo/i.test(text)) metric = 'sin objetivo'

  let headline: string | null = null
  if (strategy) {
    headline = metric ? `${strategy} · ${metric}` : strategy
  } else if (fullText) {
    // Sin palabra de estrategia: recortar en punto limpio (antes de "+ evento" o "[").
    let h = fullText
    const cut = h.search(/\s*\+\s*evento|\s*\[/i)
    if (cut > 0) h = h.slice(0, cut)
    h = h.trim().replace(/[.\s—-]+$/, '')
    if (h.length > 70) h = h.slice(0, 68).trim() + '…'
    headline = h || null
  }

  return { headline, fullText, adjusted, eventUp, manualNote }
}

// ─────────────────────────────────────────────────────────────────────
// Mapeo de la fila de la RPC
// ─────────────────────────────────────────────────────────────────────

function mapOffer(r: Record<string, unknown>): AgentOffer {
  const channelRaw = String(r.channel ?? 'shop').toLowerCase()
  const channel: OfferChannel = (OFFER_CHANNELS as string[]).includes(channelRaw)
    ? (channelRaw as OfferChannel) : 'shop'
  const reasonRaw = (r.reason as string | null) ?? null
  return {
    id: r.id as string,
    name: (r.name as string) ?? '(sin nombre)',
    channel,
    origin: (r.origin as string | null) ?? null,
    kind: (r.kind as string) ?? 'standard',
    discountType: (r.discountType as DiscountType) ?? 'percent',
    value: Number(r.value ?? 0),
    active: r.active !== false,
    status: (r.status as OfferStatus) ?? 'borrador',
    publishMode: (r.publishMode as PublishMode) ?? 'manual',
    brandNames: Array.isArray(r.brandNames) ? (r.brandNames as string[]) : [],
    locationNames: Array.isArray(r.locationNames) ? (r.locationNames as string[]) : [],
    weekdays: Array.isArray(r.weekdays) ? (r.weekdays as number[]) : null,
    timeFrom: (r.timeFrom as string | null) ?? null,
    timeTo: (r.timeTo as string | null) ?? null,
    startsAt: (r.startsAt as string | null) ?? null,
    endsAt: (r.endsAt as string | null) ?? null,
    budgetMax: num(r.budgetMax),
    reasonRaw,
    reason: parseReason(reasonRaw),
    jobsTotal: Number(r.jobsTotal ?? 0),
    jobsDone: Number(r.jobsDone ?? 0),
    jobsPending: Number(r.jobsPending ?? 0),
    jobsError: Number(r.jobsError ?? 0),
    lastError: (r.lastError as string | null) ?? null,
    redemptions: Number(r.redemptions ?? 0),
    discounted: Number(r.discounted ?? 0),
    roi: num(r.roi),
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

/** Todas las ofertas del board (4 canales). Ordenadas por creación (desc) en SQL. */
export async function listAgentOffers(accountId: string): Promise<AgentOffer[]> {
  const { data, error } = await db().rpc('agent_offers_unified', { p_account: accountId })
  if (error) throw new Error(`Error cargando las ofertas del agente: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(mapOffer)
}

/** Marca temporal de la última corrida del agente (para la cabecera). null si nunca corrió. */
export async function getLastRunAt(accountId: string): Promise<string | null> {
  try {
    const { data } = await db()
      .from('agent_run_log')
      .select('ran_at')
      .eq('account_id', accountId)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as { ran_at?: string } | null)?.ran_at ?? null
  } catch {
    return null
  }
}

/** Agrupa las ofertas por canal, respetando el orden fijo de OFFER_CHANNELS. */
export function groupByChannel(offers: AgentOffer[]): Record<OfferChannel, AgentOffer[]> {
  const out: Record<OfferChannel, AgentOffer[]> = { shop: [], glovo: [], uber: [], justeat: [] }
  for (const o of offers) out[o.channel].push(o)
  return out
}

/**
 * Margen real de UNA oferta de plataforma, bajo demanda (glovo/uber/justeat).
 * Lee el scope de ese cupón + resuelve el channel_id y llama al preview server-side.
 * Devuelve null para Shop (allí se muestra el ROI real, no una estimación).
 */
export async function previewOfferMargin(
  accountId: string, offer: AgentOffer,
): Promise<OfferMargin | null> {
  if (offer.channel === 'shop') return null
  try {
    // channel_id por nombre (Glovo/Uber/JustEat) — normaliza espacios/mayúsculas.
    const { data: chans } = await db()
      .from('sales_channel')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('is_active', true)
    const match = ((chans ?? []) as Array<{ id: string; name: string }>).find(
      (c) => (c.name ?? '').toLowerCase().replace(/\s+/g, '') === offer.channel,
    )
    if (!match) return null

    // scope de este único cupón (RLS de miembro permite el SELECT).
    const { data: c } = await db().from('coupon').select('scope').eq('id', offer.id).maybeSingle()
    const scope = ((c as { scope?: Record<string, unknown> } | null)?.scope ?? {}) as Record<string, unknown>
    const brandIds = Array.isArray(scope.brand_ids) ? (scope.brand_ids as string[]) : []
    const menuItemIdsRaw = Array.isArray(scope.menu_item_ids) ? (scope.menu_item_ids as string[]) : []
    const menuItemIds = menuItemIdsRaw.length > 0 ? menuItemIdsRaw : null
    if (brandIds.length === 0) return null

    const { aggregates } = await previewImpact({
      accountId,
      channelId: match.id,
      brandIds,
      discountType: offer.discountType,
      discountValue: offer.value,
      menuItemIds,
      marginFloorPct: null,
    })
    return {
      marginPctBefore: aggregates.margenPctAntes,
      marginPctAfter: aggregates.margenPctDespues,
      itemsBelowFloor: aggregates.itemsBajoSuelo,
      itemsNoCost: aggregates.itemsSinEscandallo,
      totalItems: aggregates.totalItems,
    }
  } catch {
    return null
  }
}
