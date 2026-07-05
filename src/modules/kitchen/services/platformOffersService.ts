// src/modules/kitchen/services/platformOffersService.ts
//
// Motor de OFERTAS DE PLATAFORMA v1 (campañas de promo para Glovo/Uber).
//
// Una campaña = fila en `coupon` con `channels` = ['glovo'] o ['uber'] (ese es el
// DISCRIMINADOR frente a los cupones del Shop, cuyo channels es {shop}). NO se
// toca `origin` (queda en su default 'manual') ni `applies_to` (bloqueado a
// 'subtotal' por CHECK en BBDD) ni `kind` (default 'standard'). Verificado vía
// information_schema el 04/07/2026: el modelo del encargo (applies_to jsonb,
// origin='platform') NO es aplicable; el esquema real manda.
//
// El CEREBRO del margen es 100% server-side: RPC `preview_platform_promo_impact`
// (SECURITY INVOKER, se llama con la sesión normal). Aquí NO se recalcula margen.
//
// `promo_push_job` NO está en database.ts (deuda declarada: regeneración de types
// bloqueada por incompatibilidad CLI). Igual que `coupon`, se opera con el patrón
// de cast `supabase as any` (db()). Tipos locales para lo que devolvemos.
//
// Alcance del BORRADOR (marcas + platos): idealmente vive en `coupon.scope` jsonb.
// Esa columna puede no existir todavía (migración propuesta a Julio, pendiente de
// ejecutar). El servicio es RESILIENTE: escribe `scope` best-effort y, si la
// columna no existe (error 42703), reintenta sin ella; las lecturas usan '*' (no
// fallan). En sesión, el alcance vive en el estado del editor, así que crear →
// previsualizar → aprobar funciona sin migración; al aprobar, el alcance queda
// inmutable en `promo_push_job.payload`.

import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────
// Cliente con cast (coupon / promo_push_job no están en database.ts)
// ─────────────────────────────────────────────────────────────────────

function db(): any {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase as any
}

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio
// ─────────────────────────────────────────────────────────────────────

export type DiscountType = 'percent' | 'fixed'
/** Canal de plataforma en cliente (minúsculas, como en coupon.channels). */
export type PlatformChannel = 'glovo' | 'uber'
/** Valor de promo_push_job.platform (ojo: uber → 'ubereats'). */
export type PushPlatform = 'glovo' | 'ubereats'

/** Estado DERIVADO de una campaña (no es columna). */
export type CampaignStatus =
  | 'borrador'
  | 'pendiente'   // Pendiente de publicar (en cola)
  | 'publicada'
  | 'pausada'
  | 'finalizada'

/** Alcance de la campaña (persistido best-effort en coupon.scope jsonb). */
export interface CampaignScope {
  brandIds: string[]
  /** null = toda la carta de esas marcas. */
  menuItemIds: string[] | null
}

/** Semáforo por plato que devuelve la RPC. */
export type ImpactStatus = 'ok' | 'bajo_suelo' | 'sin_escandallo'

export interface ImpactRow {
  menuItemId: string
  itemName: string
  brandName: string
  pvpCliente: number | null
  pvpPromoCliente: number | null
  descuento: number | null
  comisionAntes: number | null
  comisionDespues: number | null
  foodCost: number | null
  margenAntes: number | null
  margenDespues: number | null
  margenPctAntes: number | null
  margenPctDespues: number | null
  units30d: number
  status: ImpactStatus
}

/** Agregados calculados en cliente a partir de las filas del preview. */
export interface ImpactAggregates {
  /** Margen % medio ponderado por units_30d, solo filas con escandallo. */
  margenPctAntes: number | null
  margenPctDespues: number | null
  itemsBajoSuelo: number
  itemsSinEscandallo: number
  /** Unidades 30d de las filas con escandallo (las que cuentan). */
  units30dAfectadas: number
  /** Total de filas (incluye sin escandallo). */
  totalItems: number
}

/** Una campaña listada (coupon + agregado de jobs). */
export interface Campaign {
  id: string
  name: string
  channel: PlatformChannel
  discountType: DiscountType
  value: number
  weekdays: number[] | null
  timeFrom: string | null
  timeTo: string | null
  startsAt: string | null
  endsAt: string | null
  budgetMax: number | null
  omnibusRefNote: string | null
  /** coupon.origin: 'agent' = la propuso el motor de ofertas; si no, borrador humano. */
  origin: string | null
  active: boolean
  pausedAt: string | null
  createdAt: string | null
  scope: CampaignScope | null
  status: CampaignStatus
  /** Marcas (nombres) del alcance publicado, derivadas de los jobs 'create'. */
  brandNames: string[]
  jobsTotal: number
  jobsDone: number
  jobsPendingOrError: number
  hasError: boolean
  lastError: string | null
}

/** Datos que edita el formulario (borrador o nueva). */
export interface CampaignDraft {
  id?: string
  accountId: string
  name: string
  channel: PlatformChannel
  channelId: string          // sales_channel.id (para la RPC)
  discountType: DiscountType
  value: number
  scope: CampaignScope
  weekdays: number[] | null
  timeFrom: string | null
  timeTo: string | null
  startsAt: string | null
  endsAt: string | null
  budgetMax: number | null
  marginFloorPct: number | null
  omnibusRefNote: string | null
}

// Tipo local de promo_push_job (regla dura 2: no regenerar database.ts).
export interface PromoPushJobRow {
  id: string
  account_id: string
  coupon_id: string
  platform: PushPlatform
  brand_id: string
  location_id: string | null
  action: 'create' | 'pause' | 'resume' | 'end'
  status: 'pending' | 'sent' | 'done' | 'error'
  attempts: number
  last_error: string | null
  external_ref: string | null
  payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const PLATFORM_CHANNELS: PlatformChannel[] = ['glovo', 'uber']

/** Mapea un canal cliente al valor de promo_push_job.platform. */
export function toPushPlatform(channel: PlatformChannel): PushPlatform {
  return channel === 'uber' ? 'ubereats' : 'glovo'
}

/** Deduce el canal de plataforma a partir de un array coupon.channels. */
function channelFromArray(channels: unknown): PlatformChannel | null {
  const arr = Array.isArray(channels) ? channels.map((c) => String(c).toLowerCase()) : []
  if (arr.some((c) => c.includes('glovo'))) return 'glovo'
  if (arr.some((c) => c.includes('uber'))) return 'uber'
  return null
}

/** Deduce el canal de plataforma a partir del nombre/slug de un sales_channel. */
export function platformOfChannel(name: string | null, slug: string | null): PlatformChannel | null {
  const s = `${name ?? ''} ${slug ?? ''}`.toLowerCase()
  if (s.includes('glovo')) return 'glovo'
  if (s.includes('uber')) return 'uber'
  return null
}

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x))

function rowToScope(raw: unknown): CampaignScope | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const brandIds = Array.isArray(o.brand_ids) ? (o.brand_ids as string[]) : []
  const menuItemIds = Array.isArray(o.menu_item_ids) ? (o.menu_item_ids as string[]) : null
  return { brandIds, menuItemIds }
}

function scopeToJson(scope: CampaignScope): Record<string, unknown> {
  return {
    brand_ids: scope.brandIds,
    menu_item_ids: scope.menuItemIds && scope.menuItemIds.length > 0 ? scope.menuItemIds : null,
  }
}

/** ¿El error de Postgres es "columna scope no existe"? (42703) */
function isMissingScopeColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || /column .*scope.* does not exist/i.test(error.message ?? '')
}

// ─────────────────────────────────────────────────────────────────────
// Derivación de estado
// ─────────────────────────────────────────────────────────────────────

function deriveStatus(
  active: boolean,
  pausedAt: string | null,
  endsAt: string | null,
  jobs: { status: string }[],
): CampaignStatus {
  const now = Date.now()
  if (endsAt && new Date(endsAt).getTime() < now) return 'finalizada'
  if (pausedAt) return 'pausada'
  if (!active && jobs.length === 0) return 'borrador'
  if (active && jobs.some((j) => j.status === 'pending' || j.status === 'error')) return 'pendiente'
  if (jobs.length > 0 && jobs.every((j) => j.status === 'done')) return 'publicada'
  return active ? 'pendiente' : 'borrador'
}

// ─────────────────────────────────────────────────────────────────────
// API pública — lectura
// ─────────────────────────────────────────────────────────────────────

/**
 * Lista las campañas de plataforma de la cuenta (coupons con channels glovo/uber)
 * + agregado de sus jobs (estado derivado, marcas publicadas, último error).
 */
export async function listCampaigns(accountId: string): Promise<Campaign[]> {
  const { data: coupons, error } = await db()
    .from('coupon')
    .select('*')
    .eq('account_id', accountId)
    .overlaps('channels', PLATFORM_CHANNELS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Error listando campañas: ${error.message}`)

  const rows = (coupons ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return []

  const couponIds = rows.map((r) => r.id as string)
  const { data: jobsData, error: jobsErr } = await db()
    .from('promo_push_job')
    .select('coupon_id, brand_id, status, action, last_error, payload')
    .in('coupon_id', couponIds)
  if (jobsErr) throw new Error(`Error cargando jobs de publicación: ${jobsErr.message}`)
  const jobs = (jobsData ?? []) as Array<{
    coupon_id: string
    brand_id: string
    status: string
    action: string
    last_error: string | null
    payload: Record<string, unknown> | null
  }>

  const jobsByCoupon = new Map<string, typeof jobs>()
  for (const j of jobs) {
    const arr = jobsByCoupon.get(j.coupon_id) ?? []
    arr.push(j)
    jobsByCoupon.set(j.coupon_id, arr)
  }

  return rows.map((r) => {
    const cid = r.id as string
    const cjobs = jobsByCoupon.get(cid) ?? []
    const channel = channelFromArray(r.channels) ?? 'glovo'
    const active = r.active !== false
    const pausedAt = (r.paused_at as string | null) ?? null
    const endsAt = (r.ends_at as string | null) ?? null
    const status = deriveStatus(active, pausedAt, endsAt, cjobs)

    // Marcas publicadas: de los jobs 'create' (payload.brand_name), dedup.
    const brandNames = Array.from(
      new Set(
        cjobs
          .filter((j) => j.action === 'create')
          .map((j) => (j.payload?.brand_name as string | undefined) ?? '')
          .filter((n) => n !== ''),
      ),
    )

    const jobsDone = cjobs.filter((j) => j.status === 'done').length
    const jobsPendingOrError = cjobs.filter((j) => j.status === 'pending' || j.status === 'error').length
    const errJob = cjobs.find((j) => j.status === 'error' && j.last_error)

    return {
      id: cid,
      name: (r.name as string) ?? '(sin nombre)',
      channel,
      discountType: (r.discount_type as DiscountType) ?? 'percent',
      value: Number(r.value ?? 0),
      weekdays: Array.isArray(r.weekdays) ? (r.weekdays as number[]) : null,
      timeFrom: (r.time_from as string | null) ?? null,
      timeTo: (r.time_to as string | null) ?? null,
      startsAt: (r.starts_at as string | null) ?? null,
      endsAt,
      budgetMax: num(r.budget_max),
      omnibusRefNote: (r.omnibus_ref_note as string | null) ?? null,
      origin: (r.origin as string | null) ?? null,
      active,
      pausedAt,
      createdAt: (r.created_at as string | null) ?? null,
      scope: rowToScope(r.scope),
      status,
      brandNames,
      jobsTotal: cjobs.length,
      jobsDone,
      jobsPendingOrError,
      hasError: cjobs.some((j) => j.status === 'error'),
      lastError: errJob?.last_error ?? null,
    }
  })
}

/**
 * Previsualiza el impacto de margen de una campaña (100% server-side). Devuelve
 * las filas por plato + agregados calculados en cliente (media ponderada por
 * units_30d, excluyendo sin_escandallo).
 */
export async function previewImpact(params: {
  accountId: string
  channelId: string
  brandIds: string[]
  discountType: DiscountType
  discountValue: number
  menuItemIds: string[] | null
  marginFloorPct: number | null
}): Promise<{ rows: ImpactRow[]; aggregates: ImpactAggregates }> {
  const { data, error } = await db().rpc('preview_platform_promo_impact', {
    p_account_id: params.accountId,
    p_channel_id: params.channelId,
    p_brand_ids: params.brandIds,
    p_discount_type: params.discountType,
    p_discount_value: params.discountValue,
    p_menu_item_ids: params.menuItemIds,
    p_margin_floor_pct: params.marginFloorPct,
  })
  if (error) throw new Error(`Error calculando impacto: ${error.message}`)

  const rows: ImpactRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    menuItemId: r.menu_item_id as string,
    itemName: (r.item_name as string) ?? '(sin nombre)',
    brandName: (r.brand_name as string) ?? '',
    pvpCliente: num(r.pvp_cliente),
    pvpPromoCliente: num(r.pvp_promo_cliente),
    descuento: num(r.descuento),
    comisionAntes: num(r.comision_antes),
    comisionDespues: num(r.comision_despues),
    foodCost: num(r.food_cost),
    margenAntes: num(r.margen_antes),
    margenDespues: num(r.margen_despues),
    margenPctAntes: num(r.margen_pct_antes),
    margenPctDespues: num(r.margen_pct_despues),
    units30d: Number(r.units_30d ?? 0),
    status: (r.status as ImpactStatus) ?? 'ok',
  }))

  return { rows, aggregates: computeAggregates(rows) }
}

/**
 * Agregados de cabecera. La media de margen % es PONDERADA por units_30d y solo
 * sobre filas con escandallo (sin_escandallo NO computa: sus números son ciegos).
 */
export function computeAggregates(rows: ImpactRow[]): ImpactAggregates {
  let wAntes = 0
  let wDespues = 0
  let wSum = 0
  let bajoSuelo = 0
  let sinEsc = 0
  for (const r of rows) {
    if (r.status === 'sin_escandallo') {
      sinEsc++
      continue
    }
    if (r.status === 'bajo_suelo') bajoSuelo++
    const w = r.units30d > 0 ? r.units30d : 0
    if (r.margenPctAntes !== null) {
      wAntes += r.margenPctAntes * w
    }
    if (r.margenPctDespues !== null) {
      wDespues += r.margenPctDespues * w
    }
    wSum += w
  }
  const round1 = (v: number) => Math.round(v * 10) / 10
  return {
    margenPctAntes: wSum > 0 ? round1(wAntes / wSum) : null,
    margenPctDespues: wSum > 0 ? round1(wDespues / wSum) : null,
    itemsBajoSuelo: bajoSuelo,
    itemsSinEscandallo: sinEsc,
    units30dAfectadas: Math.round(wSum),
    totalItems: rows.length,
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública — escritura de la campaña (coupon)
// ─────────────────────────────────────────────────────────────────────

/** Slug interno (no de cara al cliente): PLAT-<canal>-<timestamp>. */
function genCode(channel: PlatformChannel): string {
  return `PLAT-${channel}-${Date.now()}`
}

function draftToCouponPayload(draft: CampaignDraft): Record<string, unknown> {
  return {
    account_id: draft.accountId,
    name: draft.name.trim(),
    discount_type: draft.discountType,
    value: draft.value,
    channels: [draft.channel], // DISCRIMINADOR (glovo|uber), no {shop}
    weekdays: draft.weekdays && draft.weekdays.length > 0 ? draft.weekdays : null,
    time_from: draft.timeFrom || null,
    time_to: draft.timeTo || null,
    starts_at: draft.startsAt || null,
    ends_at: draft.endsAt || null,
    budget_max: draft.budgetMax,
    omnibus_ref_note: draft.omnibusRefNote?.trim() || null,
    // kind/origin/applies_to → se dejan en sus defaults (standard/manual/subtotal).
  }
}

/**
 * Inserta/actualiza el coupon de la campaña. Escribe `scope` (jsonb) best-effort;
 * si la columna no existe (42703), reintenta sin ella (borrador lossy en alcance,
 * pero nunca revienta). Devuelve el id del coupon.
 */
export async function saveCampaign(draft: CampaignDraft): Promise<string> {
  const base = draftToCouponPayload(draft)
  const withScope = { ...base, scope: scopeToJson(draft.scope) }

  // UPDATE (borrador existente) o INSERT (nueva).
  const runWrite = async (payload: Record<string, unknown>) => {
    if (draft.id) {
      return db().from('coupon').update(payload).eq('id', draft.id).select('id').single()
    }
    return db()
      .from('coupon')
      .insert({ ...payload, code: genCode(draft.channel), active: false })
      .select('id')
      .single()
  }

  let { data, error } = await runWrite(withScope)
  if (error && isMissingScopeColumn(error)) {
    // La migración de coupon.scope aún no está aplicada: guardamos sin alcance.
    ;({ data, error } = await runWrite(base))
  }
  if (error) throw new Error(`Error guardando campaña: ${error.message}`)
  return (data as { id: string }).id
}

// ─────────────────────────────────────────────────────────────────────
// API pública — acciones de ciclo de vida (encolan jobs)
// ─────────────────────────────────────────────────────────────────────

interface ApproveInput {
  couponId: string
  draft: CampaignDraft
  /** Nombres de marca por id (para el snapshot inmutable del payload). */
  brandNames: Record<string, string>
}

/**
 * Aprueba una campaña: active=true en el coupon + un promo_push_job (action=create,
 * status=pending) POR CADA MARCA del alcance, con snapshot COMPLETO e inmutable en
 * payload. location_id=null (v1: cuenta entera).
 */
export async function approveCampaign(input: ApproveInput): Promise<void> {
  const { couponId, draft, brandNames } = input
  const platform = toPushPlatform(draft.channel)
  const menuItemIds =
    draft.scope.menuItemIds && draft.scope.menuItemIds.length > 0 ? draft.scope.menuItemIds : null
  // El robot marca los platos EN GLOVO por NOMBRE (payload.menu_item_names). Sin los
  // nombres, marca "0 de 0" y aborta con honestidad (bug cazado 05/07 en vivo).
  let menuItemNames: string[] | null = null
  if (menuItemIds) {
    const { data: nRows } = await db().from('menu_item').select('name').in('id', menuItemIds)
    const names = ((nRows ?? []) as Array<{ name: string }>).map((r) => r.name)
    menuItemNames = names.length > 0 ? names : null
  }

  // 1) LEER ANTES DE PISAR (bug cazado 05/07 en vivo): el agente pone location_ids y
  //    kind en el cupón, pero el draft de la pantalla NO los conoce — persistir el scope
  //    del draft y leer el cupón DESPUÉS los borraba en el momento exacto de usarlos
  //    (jobs con local/hint null). Orden correcto: leer -> persistir PRESERVANDO -> jobs.
  const { data: cRow } = await db().from('coupon').select('scope, kind').eq('id', couponId).maybeSingle()
  const couponKind: string = ((cRow as { kind?: string | null } | null)?.kind) ?? 'standard'
  const scopeLocationIds: string[] = (((cRow as { scope?: { location_ids?: string[] } } | null)?.scope?.location_ids) ?? []) as string[]

  // 2) Persistir el estado final del coupon y activarlo, preservando lo que el draft no sabe.
  const base = draftToCouponPayload(draft)
  const scopePersist = {
    ...(scopeToJson(draft.scope) as Record<string, unknown>),
    ...(scopeLocationIds.length > 0 ? { location_ids: scopeLocationIds } : {}),
  }
  const activate = async (payload: Record<string, unknown>) =>
    db().from('coupon').update({ ...payload, active: true, paused_at: null }).eq('id', couponId)
  let { error: upErr } = await activate({ ...base, scope: scopePersist })
  if (upErr && isMissingScopeColumn(upErr)) {
    ;({ error: upErr } = await activate(base))
  }
  if (upErr) throw new Error(`Error activando campaña: ${upErr.message}`)

  // 3) Un job por marca × LOCAL: la promo de un local se publica SOLO en el POS de ese
  //    local (payload.pos_hint restringe al robot). Sin location_ids: un job por marca.
  let locs: Array<{ id: string; name: string; glovo_pos_hint: string | null }> = []
  if (scopeLocationIds.length > 0) {
    const { data: lRows } = await db()
      .from('locations')
      .select('id, name, glovo_pos_hint')
      .in('id', scopeLocationIds)
    locs = ((lRows ?? []) as never[]) as Array<{ id: string; name: string; glovo_pos_hint: string | null }>
  }
  const locTargets: Array<{ id: string; name: string; glovo_pos_hint: string | null } | null> =
    locs.length > 0 ? locs : [null]

  const jobs = draft.scope.brandIds.flatMap((brandId) =>
    locTargets.map((loc) => ({
      account_id: draft.accountId,
      coupon_id: couponId,
      platform,
      brand_id: brandId,
      location_id: loc?.id ?? null,
      action: 'create' as const,
      status: 'pending' as const,
      payload: {
        name: draft.name.trim(),
        platform,
        kind: couponKind,
        brand_id: brandId,
        brand_name: brandNames[brandId] ?? '',
        location_id: loc?.id ?? null,
        location_name: loc?.name ?? null,
        pos_hint: loc?.glovo_pos_hint ?? null,
        discount_type: draft.discountType,
        value: draft.value,
        menu_item_ids: menuItemIds,
        menu_item_names: menuItemNames,
        weekdays: draft.weekdays && draft.weekdays.length > 0 ? draft.weekdays : null,
        time_from: draft.timeFrom || null,
        time_to: draft.timeTo || null,
        starts_at: draft.startsAt || null,
        ends_at: draft.endsAt || null,
        budget_max: draft.budgetMax,
      },
    })),
  )
  if (jobs.length === 0) throw new Error('La campaña no tiene ninguna marca en su alcance.')

  const { error: jobErr } = await db().from('promo_push_job').insert(jobs as never)
  if (jobErr) throw new Error(`Error encolando publicación: ${jobErr.message}`)
}

/**
 * Encola un job de acción (pause|resume|end) POR CADA MARCA ya publicada (de los
 * jobs 'create' existentes) y reutiliza su snapshot como payload. Devuelve el nº
 * de jobs encolados.
 */
async function enqueueActionPerBrand(
  couponId: string,
  action: 'pause' | 'resume' | 'end',
): Promise<number> {
  const { data, error } = await db()
    .from('promo_push_job')
    .select('account_id, brand_id, location_id, platform, payload, action')
    .eq('coupon_id', couponId)
    .eq('action', 'create')
  if (error) throw new Error(`Error leyendo marcas publicadas: ${error.message}`)

  const createJobs = (data ?? []) as Array<{
    account_id: string
    brand_id: string
    location_id: string | null
    platform: PushPlatform
    payload: Record<string, unknown>
  }>
  // Dedup por marca×LOCAL (v1.3: una campaña puede publicar un create por marca y local).
  const seen = new Set<string>()
  const rows = createJobs
    .filter((j) => {
      const key = `${j.brand_id}:${j.location_id ?? '-'}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((j) => ({
      account_id: j.account_id,
      coupon_id: couponId,
      platform: j.platform,
      brand_id: j.brand_id,
      location_id: j.location_id ?? null,
      action,
      status: 'pending' as const,
      payload: { ...j.payload, action },
    }))

  if (rows.length === 0) return 0
  const { error: insErr } = await db().from('promo_push_job').insert(rows as never)
  if (insErr) throw new Error(`Error encolando acción '${action}': ${insErr.message}`)
  return rows.length
}

/** Pausa: job action='pause' por marca + paused_at=now() en el coupon. */
export async function pauseCampaign(couponId: string): Promise<void> {
  await enqueueActionPerBrand(couponId, 'pause')
  const { error } = await db()
    .from('coupon')
    .update({ paused_at: new Date().toISOString() })
    .eq('id', couponId)
  if (error) throw new Error(`Error pausando campaña: ${error.message}`)
}

/** Reanuda: job action='resume' por marca + paused_at=null en el coupon. */
export async function resumeCampaign(couponId: string): Promise<void> {
  await enqueueActionPerBrand(couponId, 'resume')
  const { error } = await db().from('coupon').update({ paused_at: null }).eq('id', couponId)
  if (error) throw new Error(`Error reanudando campaña: ${error.message}`)
}

/** Finaliza: job action='end' por marca + ends_at=now() en el coupon. */
export async function endCampaign(couponId: string): Promise<void> {
  await enqueueActionPerBrand(couponId, 'end')
  const { error } = await db()
    .from('coupon')
    .update({ ends_at: new Date().toISOString() })
    .eq('id', couponId)
  if (error) throw new Error(`Error finalizando campaña: ${error.message}`)
}

/** Borra un BORRADOR (solo si no tiene jobs). Para limpieza de la lista. */
export async function deleteDraft(couponId: string): Promise<void> {
  const { data: jobs, error: jErr } = await db()
    .from('promo_push_job')
    .select('id')
    .eq('coupon_id', couponId)
    .limit(1)
  if (jErr) throw new Error(`Error comprobando jobs: ${jErr.message}`)
  if ((jobs ?? []).length > 0) {
    throw new Error('No se puede borrar: la campaña ya tiene publicaciones encoladas.')
  }
  const { error } = await db().from('coupon').delete().eq('id', couponId)
  if (error) throw new Error(`Error borrando borrador: ${error.message}`)
}
