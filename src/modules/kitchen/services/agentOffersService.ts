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
import {
  previewImpact, approveCampaign,
  pauseCampaign, resumeCampaign, endCampaign, deleteDraft,
  type CampaignDraft,
} from '@/modules/kitchen/services/platformOffersService'
import { toggleCampaign, deleteCampaign } from '@/modules/shop/admin/campaignService'
import { listMenuItems } from '@/modules/kitchen/services/menuItemService'

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

/** Plato de regalo por marca (solo en ofertas kind='free_item'). null en el resto.
 *  Misma forma que _shop_brand_free_gift / _shop_account_free_gift del storefront. */
export interface OfferGift {
  /** Nombre del plato regalado. */
  name: string
  /** Umbral de subtotal para desbloquear el regalo (coupon.min_subtotal). null = sin mínimo. */
  min: number | null
  /** Valor de mercado del plato (menu_item.price). null si no consta. */
  value: number | null
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
  /** Plato de regalo por marca (free_item) o null. */
  gift: OfferGift | null
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
  const giftRaw = (r.gift && typeof r.gift === 'object') ? (r.gift as Record<string, unknown>) : null
  const gift: OfferGift | null = giftRaw
    ? { name: String(giftRaw.name ?? ''), min: num(giftRaw.min), value: num(giftRaw.value) }
    : null
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
    gift,
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

// ─────────────────────────────────────────────────────────────────────
// PUBLICAR (T3) — despachador HONESTO por canal
//   - Shop     → active=true (publica de verdad; es la tienda propia)
//   - Glovo    → active=true + encola promo_push_job (approveCampaign) → robot Glovo
//   - Uber     → active=true + encola promo_push_job (platform='ubereats') → brazo Uber
//                (18/07: antes caía en "a mano" y no encolaba nada — el brazo existe y sabe
//                 publicar; el hueco era ESTE despachador, que no lo enrutaba al robot.)
//   - JustEat  → active=true, sin job (no hay robot) → lista "a mano en JustEat"
// Nunca finge que JustEat salió sola: devuelve la lista de deberes por canal.
// ─────────────────────────────────────────────────────────────────────

export interface PublishResult {
  shopPublished: number
  glovoQueued: number
  uberQueued: number
  manualUber: string[]
  manualJustEat: string[]
  errors: { id: string; name: string; error: string }[]
}

function offerLabel(o: AgentOffer): string {
  const b = o.brandNames[0] ?? o.name
  const l = o.locationNames[0]
  return l ? `${b} · ${l}` : b
}

/**
 * Publica un conjunto de ofertas del board, con verdad por canal. Devuelve el
 * desglose (publicadas de verdad + pendientes "a mano" + errores). No recalcula
 * margen: publicar = confiar en la propuesta del agente (su guardarraíl ya corrió).
 */
export async function publishOffers(accountId: string, offers: AgentOffer[]): Promise<PublishResult> {
  const res: PublishResult = { shopPublished: 0, glovoQueued: 0, uberQueued: 0, manualUber: [], manualJustEat: [], errors: [] }

  // channel_id de las plataformas con brazo robot (Glovo y Uber). Se resuelven una vez.
  const { data: chans } = await db()
    .from('sales_channel').select('id, name').eq('account_id', accountId).eq('is_active', true)
  const chanId = (want: string): string | null =>
    ((chans ?? []) as Array<{ id: string; name: string }>)
      .find((c) => (c.name ?? '').toLowerCase().replace(/\s+/g, '') === want)?.id ?? null
  const glovoId = chanId('glovo')
  const uberId = chanId('uber')

  for (const o of offers) {
    try {
      if (o.channel === 'shop') {
        const { error } = await db().from('coupon').update({ active: true, paused_at: null }).eq('id', o.id)
        if (error) throw new Error(error.message)
        res.shopPublished++
      } else if (o.channel === 'glovo' || o.channel === 'uber') {
        // Glovo Y Uber tienen brazo robot: MISMO camino. approveCampaign encola el
        // promo_push_job; toPushPlatform manda 'glovo'|'ubereats' → cada brazo reclama
        // el suyo. El cupón ya trae su scope (marcas/locales/platos); construimos el
        // draft mínimo y delegamos (activa + encola con pos_hint y nombres — path probado).
        const channelId = o.channel === 'glovo' ? glovoId : uberId
        if (!channelId) throw new Error(`Canal ${o.channel === 'glovo' ? 'Glovo' : 'Uber'} no encontrado en la cuenta.`)

        const { data: c } = await db().from('coupon').select('scope').eq('id', o.id).maybeSingle()
        const scope = ((c as { scope?: Record<string, unknown> } | null)?.scope ?? {}) as Record<string, unknown>
        const brandIds = Array.isArray(scope.brand_ids) ? (scope.brand_ids as string[]) : []
        const menuItemIdsRaw = Array.isArray(scope.menu_item_ids) ? (scope.menu_item_ids as string[]) : []
        const menuItemIds = menuItemIdsRaw.length > 0 ? menuItemIdsRaw : null
        if (brandIds.length === 0) throw new Error('La oferta no tiene marcas en su alcance.')

        const { data: brs } = await db().from('brand').select('id, name').in('id', brandIds)
        const brandNames: Record<string, string> = {}
        for (const b of ((brs ?? []) as Array<{ id: string; name: string }>)) brandNames[b.id] = b.name

        const draft: CampaignDraft = {
          id: o.id,
          accountId,
          name: o.name,
          channel: o.channel, // 'glovo' | 'uber' (narrowed) → PlatformChannel
          channelId,
          discountType: o.discountType,
          value: o.value,
          scope: { brandIds, menuItemIds },
          weekdays: o.weekdays,
          timeFrom: o.timeFrom,
          timeTo: o.timeTo,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
          budgetMax: o.budgetMax,
          marginFloorPct: null,
          omnibusRefNote: o.reasonRaw,
        }
        await approveCampaign({ couponId: o.id, draft, brandNames })
        if (o.channel === 'glovo') res.glovoQueued++
        else res.uberQueued++
      } else {
        // justeat → activar y marcar "a mano" (no hay brazo de JustEat todavía).
        const { error } = await db().from('coupon').update({ active: true, paused_at: null }).eq('id', o.id)
        if (error) throw new Error(error.message)
        res.manualJustEat.push(offerLabel(o))
      }
    } catch (e) {
      res.errors.push({ id: o.id, name: o.name, error: e instanceof Error ? e.message : 'error' })
    }
  }

  return res
}

// ─────────────────────────────────────────────────────────────────────
// ACCIONES POR OFERTA (individuales, channel-aware). Reutilizan lo probado:
// plataforma → pause/resume/end/deleteDraft (encolan job para Glovo); Shop →
// toggle_campaign / delete_campaign (RPC con guard de canjes/sistema).
// ─────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: boolean; reason?: string }
const emsg = (e: unknown): string => (e instanceof Error ? e.message : 'error')

/** Publica UNA oferta (misma verdad por canal que "Publicar todas"). */
export async function publishOne(accountId: string, o: AgentOffer): Promise<ActionResult> {
  const r = await publishOffers(accountId, [o])
  return { ok: r.errors.length === 0, reason: r.errors[0]?.error }
}

/** Pausa una oferta publicada. Plataforma encola 'pause' (Glovo) + paused_at; Shop desactiva. */
export async function pauseOffer(accountId: string, o: AgentOffer): Promise<ActionResult> {
  try {
    if (o.channel === 'shop') return await toggleCampaign(accountId, o.id, false)
    await pauseCampaign(o.id)
    return { ok: true }
  } catch (e) { return { ok: false, reason: emsg(e) } }
}

/** Reanuda una oferta pausada. */
export async function resumeOffer(accountId: string, o: AgentOffer): Promise<ActionResult> {
  try {
    if (o.channel === 'shop') return await toggleCampaign(accountId, o.id, true)
    await resumeCampaign(o.id)
    return { ok: true }
  } catch (e) { return { ok: false, reason: emsg(e) } }
}

/**
 * Finaliza una oferta. En plataforma es IRREVERSIBLE (Glovo cancela y no permite
 * reactivar). En Shop no hay "finalizar": equivale a desactivar (pausar).
 */
export async function endOffer(accountId: string, o: AgentOffer): Promise<ActionResult> {
  try {
    if (o.channel === 'shop') return await toggleCampaign(accountId, o.id, false)
    await endCampaign(o.id)
    return { ok: true }
  } catch (e) { return { ok: false, reason: emsg(e) } }
}

/**
 * Descarta una propuesta/borrador (sin publicaciones). Plataforma usa deleteDraft
 * (rechaza si ya tiene jobs). Shop usa delete_campaign (rechaza sistema/canjes).
 */
export async function discardOffer(accountId: string, o: AgentOffer): Promise<ActionResult> {
  try {
    if (o.channel === 'shop') return await deleteCampaign(accountId, o.id)
    await deleteDraft(o.id)
    return { ok: true }
  } catch (e) { return { ok: false, reason: emsg(e) } }
}

// ─────────────────────────────────────────────────────────────────────
// EDITAR una oferta (pieza 2) — canal y marca FIJOS; editable valor, platos,
// días/franja, presupuesto y fecha de fin. Guarda actualizando el cupón (columnas
// + scope). Preview de margen en vivo para plataforma (Shop no estima).
// ─────────────────────────────────────────────────────────────────────

export interface OfferDish { id: string; name: string }

export interface OfferEditData {
  brandIds: string[]
  locationIds: string[]
  menuItemIds: string[]      // platos ya elegidos (vacío = toda la carta)
  channelId: string | null   // para el preview (null en Shop)
  dishes: OfferDish[]         // carta de la(s) marca(s) de la oferta
}

export interface OfferEditInput {
  discountType: DiscountType
  value: number
  menuItemIds: string[] | null   // null = toda la carta
  weekdays: number[] | null
  timeFrom: string | null        // 'HH:MM'
  timeTo: string | null
  startsAt: string | null        // ISO
  endsAt: string | null          // ISO
  budgetMax: number | null
}

/** channel_id de la oferta (Glovo/Uber/JustEat) por nombre. null en Shop. */
async function resolveChannelId(accountId: string, channel: OfferChannel): Promise<string | null> {
  if (channel === 'shop') return null
  const { data: chans } = await db()
    .from('sales_channel').select('id, name').eq('account_id', accountId).eq('is_active', true)
  return ((chans ?? []) as Array<{ id: string; name: string }>)
    .find((c) => (c.name ?? '').toLowerCase().replace(/\s+/g, '') === channel)?.id ?? null
}

/** Carga scope actual + carta de la marca + channelId, para prefill del editor. */
export async function getOfferEditData(accountId: string, offer: AgentOffer): Promise<OfferEditData> {
  const { data: c } = await db().from('coupon').select('scope').eq('id', offer.id).maybeSingle()
  const scope = ((c as { scope?: Record<string, unknown> } | null)?.scope ?? {}) as Record<string, unknown>
  const brandIds = Array.isArray(scope.brand_ids) ? (scope.brand_ids as string[]) : []
  const locationIds = Array.isArray(scope.location_ids) ? (scope.location_ids as string[]) : []
  const menuItemIds = Array.isArray(scope.menu_item_ids) ? (scope.menu_item_ids as string[]) : []
  const channelId = await resolveChannelId(accountId, offer.channel)

  const dishes: OfferDish[] = []
  try {
    const lists = await Promise.all(
      brandIds.map((bid) => listMenuItems({ accountId, brandId: bid, includeInactive: false })),
    )
    const seen = new Set<string>()
    for (const list of lists) {
      for (const mi of (list as Array<{ id: string; name: string }>)) {
        if (!seen.has(mi.id)) { seen.add(mi.id); dishes.push({ id: mi.id, name: mi.name }) }
      }
    }
    dishes.sort((a, b) => a.name.localeCompare(b.name))
  } catch { /* carta vacía = solo "toda la carta" */ }

  return { brandIds, locationIds, menuItemIds, channelId, dishes }
}

/** Guarda la edición: columnas del cupón + scope (conserva marca/local, cambia platos). */
export async function saveOfferEdit(offer: AgentOffer, input: OfferEditInput): Promise<ActionResult> {
  try {
    const { data: c } = await db().from('coupon').select('scope').eq('id', offer.id).maybeSingle()
    const scope: Record<string, unknown> = { ...(((c as { scope?: Record<string, unknown> } | null)?.scope) ?? {}) }
    scope.menu_item_ids = input.menuItemIds && input.menuItemIds.length > 0 ? input.menuItemIds : null

    const { error } = await db().from('coupon').update({
      discount_type: input.discountType,
      value: input.value,
      weekdays: input.weekdays && input.weekdays.length > 0 ? input.weekdays : null,
      time_from: input.timeFrom || null,
      time_to: input.timeTo || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      budget_max: input.budgetMax,
      scope,
    }).eq('id', offer.id)
    if (error) return { ok: false, reason: error.message }
    return { ok: true }
  } catch (e) { return { ok: false, reason: emsg(e) } }
}

/** Preview de margen con valores EN EDICIÓN (plataforma). null en Shop o sin datos. */
export async function previewOfferMarginWith(input: {
  accountId: string
  channelId: string | null
  brandIds: string[]
  discountType: DiscountType
  value: number
  menuItemIds: string[] | null
}): Promise<OfferMargin | null> {
  if (!input.channelId || input.brandIds.length === 0 || !(input.value > 0)) return null
  try {
    const { aggregates } = await previewImpact({
      accountId: input.accountId,
      channelId: input.channelId,
      brandIds: input.brandIds,
      discountType: input.discountType,
      discountValue: input.value,
      menuItemIds: input.menuItemIds,
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
