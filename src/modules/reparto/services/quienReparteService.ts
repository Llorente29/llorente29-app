// src/modules/reparto/services/quienReparteService.ts
//
// R02 · Lo que necesita la pantalla «Quién reparte» y la etiqueta de reparto
// del pedido. Lee las tablas (con RLS: solo la cuenta activa) y escribe SOLO
// por las funciones de la base (reparto_guardar_celda, reparto_guardar_herencia,
// reparto_cambiar_desde_pedido, reparto_responder_sugerencia): quién decide y
// cuándo lo pone el servidor, y el ON CONFLICT correcto también (el R01).
//
// Regla 40: los nombres entre comillas de este fichero se comprobaron contra el
// esquema de staging-conta después de aplicar 20261005T0100…T0140.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  TODOS_LOS_LOCALES, type Celda, type Herencia, type OrigenGuardado, type QuienReparte, type TipoDeMarca,
} from '../lib/resolucion'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.')
  }
}

// Tablas y funciones nuevas: aún no están en el database.ts generado.
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase!.rpc as unknown as (
    f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string; code?: string } | null }>)(fn, args)
  if (error) throw new ErrorDeReparto(error.message, error.code)
  return data as T
}
type Row = Record<string, unknown>

/** Un error con un texto para personas, no el técnico (regla 8). */
export class ErrorDeReparto extends Error {
  readonly tecnico: string
  readonly codigo?: string
  constructor(tecnico: string, codigo?: string) {
    super(paraPersonas(tecnico, codigo))
    this.tecnico = tecnico
    this.codigo = codigo
  }
}
function paraPersonas(msg: string, code?: string): string {
  if (code === '42501') return 'No tienes permiso para cambiar quién reparte. Lo puede hacer un administrador o encargado.'
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No hay conexión. No se ha guardado: vuelve a tocarlo cuando vuelva la red.'
  if (code === 'P0002') return msg
  return 'No se ha podido guardar. Vuelve a intentarlo; si sigue, avísanos.'
}

export interface Marca { id: string; nombre: string; ownershipType: TipoDeMarca }
export interface Local { id: string; nombre: string }
export interface Plataforma { slug: string; nombre: string }

export interface Sugerencia {
  brandId: string
  marca: string
  channelSlug: string
  pedidos: number
  codigos: string[]
  lastSaleId: string
  ultimoAt: string
}

export interface RespuestaAnterior {
  id: string
  brandId: string
  channelSlug: string
  status: 'accepted' | 'rejected'
  reason: string
  answeredAt: string
  answeredByName: string | null
}

export interface DatosQuienReparte {
  marcas: Marca[]
  locales: Local[]
  plataformas: Plataforma[]
  celdas: Celda[]
  herencias: Herencia[]
  /** marca|plataforma → pedidos «propios» sin dirección en los últimos 7 días. */
  sinDireccion: Record<string, number>
  sugerencias: Sugerencia[]
  respondidas: RespuestaAnterior[]
}

/** El nombre de siempre de cada plataforma; el de la cuenta si no la conocemos. */
export function nombrePlataforma(slug: string, nombreCuenta?: string | null): string {
  switch (slug) {
    case 'glovo': return 'Glovo'
    case 'uber': return 'Uber Eats'
    case 'justeat': return 'Just Eat'
    case 'deliveroo': return 'Deliveroo'
    default: return nombreCuenta?.trim() || slug
  }
}
/** El nombre corto para frases: «la reparte Uber». */
export function nombreCorto(slug: string, nombreCuenta?: string | null): string {
  return slug === 'uber' ? 'Uber' : nombrePlataforma(slug, nombreCuenta)
}

export const claveCelda = (brandId: string, slug: string) => `${brandId}|${slug}`

export async function cargarQuienReparte(accountId: string): Promise<DatosQuienReparte> {
  requireSupabase()
  const hace7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const [marcasR, localesR, canalesR, celdasR, herenciasR, ventasR, respR] = await Promise.all([
    from('brand').select('id, name, ownership_type, is_active').eq('account_id', accountId).order('name'),
    from('locations').select('id, name, active').eq('account_id', accountId).order('name'),
    from('sales_channel').select('id, slug, name, channel_type, is_active').eq('account_id', accountId)
      .eq('channel_type', 'delivery'),
    from('brand_delivery_policy')
      .select('brand_id, channel_slug, location_id, delivery_by, source, decided_at, decided_by_name')
      .eq('account_id', accountId),
    from('channel_delivery_policy').select('channel_slug, ownership_type, location_id, service_type')
      .eq('account_id', accountId),
    from('sale').select('brand_id, channel_id, delivery_address')
      .eq('account_id', accountId).eq('service_type', 'own_delivery').gte('sold_at', hace7).limit(5000),
    from('delivery_policy_suggestion')
      .select('id, brand_id, channel_slug, status, reason, answered_at, answered_by_name')
      .eq('account_id', accountId).order('answered_at', { ascending: false }).limit(20),
  ])
  for (const r of [marcasR, localesR, canalesR, celdasR, herenciasR, ventasR, respR]) {
    if (r.error) throw new ErrorDeReparto(r.error.message, r.error.code)
  }

  const canales = ((canalesR.data as Row[] | null) ?? [])
    .filter(c => c.is_active !== false && typeof c.slug === 'string' && (c.slug as string).trim() !== '')
  const slugPorCanal = new Map(canales.map(c => [c.id as string, c.slug as string]))
  const orden = ['glovo', 'uber', 'justeat', 'deliveroo']
  const plataformas: Plataforma[] = [...new Map(canales.map(c => [c.slug as string, c])).values()]
    .map(c => ({ slug: c.slug as string, nombre: nombrePlataforma(c.slug as string, c.name as string) }))
    .sort((a, b) => (orden.indexOf(a.slug) + 1 || 99) - (orden.indexOf(b.slug) + 1 || 99))

  const sinDireccion: Record<string, number> = {}
  for (const v of (ventasR.data as Row[] | null) ?? []) {
    const slug = slugPorCanal.get(v.channel_id as string)
    if (!slug || !v.brand_id) continue
    if (((v.delivery_address as string | null) ?? '').trim() !== '') continue
    const k = claveCelda(v.brand_id as string, slug)
    sinDireccion[k] = (sinDireccion[k] ?? 0) + 1
  }

  let sugerencias: Sugerencia[]
  try {
    const s = await rpc<Row[]>('reparto_sugerencias', { p_account_id: accountId })
    sugerencias = (s ?? []).map(r => ({
      brandId: r.brand_id as string, marca: r.brand_name as string, channelSlug: r.channel_slug as string,
      pedidos: Number(r.pedidos), codigos: (r.codigos as string[] | null) ?? [], lastSaleId: r.last_sale_id as string,
      ultimoAt: r.ultimo_at as string,
    }))
  } catch {
    // Sin permiso de lectura de la cuenta no hay sugerencias: la pantalla sigue.
    sugerencias = []
  }

  return {
    marcas: ((marcasR.data as Row[] | null) ?? [])
      .filter(m => m.is_active !== false)
      .map(m => ({ id: m.id as string, nombre: m.name as string, ownershipType: ((m.ownership_type as string) === 'licensed' ? 'licensed' : 'own') as TipoDeMarca })),
    locales: ((localesR.data as Row[] | null) ?? [])
      .filter(l => l.active !== false)
      .map(l => ({ id: l.id as string, nombre: l.name as string })),
    plataformas,
    celdas: ((celdasR.data as Row[] | null) ?? []).map(c => ({
      brandId: c.brand_id as string, channelSlug: c.channel_slug as string, locationId: c.location_id as string,
      deliveryBy: c.delivery_by as QuienReparte, source: c.source as OrigenGuardado,
      decidedAt: (c.decided_at as string | null) ?? null, decidedByName: (c.decided_by_name as string | null) ?? null,
    })),
    herencias: ((herenciasR.data as Row[] | null) ?? []).map(h => ({
      channelSlug: h.channel_slug as string,
      ownershipType: ((h.ownership_type as string) === 'licensed' ? 'licensed' : 'own') as TipoDeMarca,
      locationId: (h.location_id as string | null) ?? null,
      deliveryBy: (h.service_type as string) === 'own_delivery' ? 'own' : 'platform',
    })),
    sinDireccion,
    sugerencias,
    respondidas: ((respR.data as Row[] | null) ?? []).map(r => ({
      id: r.id as string, brandId: r.brand_id as string, channelSlug: r.channel_slug as string,
      status: r.status as 'accepted' | 'rejected', reason: r.reason as string,
      answeredAt: r.answered_at as string, answeredByName: (r.answered_by_name as string | null) ?? null,
    })),
  }
}

/**
 * Guarda una celda marca × plataforma (× local). `deliveryBy = null` quita la
 * decisión: vuelve a heredar. Devuelve cómo queda resuelta.
 */
export async function guardarCelda(p: {
  accountId: string; brandId: string; channelSlug: string; locationId: string | null
  deliveryBy: QuienReparte | null; source?: 'manual' | 'ai_accepted'
}): Promise<{ deliveryBy: QuienReparte; source: string }> {
  requireSupabase()
  const r = await rpc<Row[]>('reparto_guardar_celda', {
    p_account_id: p.accountId, p_brand_id: p.brandId, p_channel_slug: p.channelSlug,
    p_location_id: p.locationId && p.locationId !== TODOS_LOS_LOCALES ? p.locationId : null,
    p_delivery_by: p.deliveryBy, p_source: p.source ?? 'manual',
  })
  const fila = (r ?? [])[0]
  return { deliveryBy: (fila?.delivery_by as QuienReparte) ?? 'platform', source: (fila?.source as string) ?? 'default' }
}

/** «Si no dices nada» de un tipo de marca en una plataforma (cuenta o local). */
export async function guardarHerencia(p: {
  accountId: string; channelSlug: string; tipo: TipoDeMarca; locationId: string | null; deliveryBy: QuienReparte
}): Promise<void> {
  requireSupabase()
  await rpc<string>('reparto_guardar_herencia', {
    p_account_id: p.accountId, p_channel_slug: p.channelSlug, p_ownership_type: p.tipo,
    p_location_id: p.locationId, p_delivery_by: p.deliveryBy,
  })
}

/** Desde la etiqueta ámbar de un pedido: «Cambiar a “la reparte X”». */
export async function cambiarDesdePedido(saleId: string, deliveryBy: QuienReparte): Promise<{ serviceType: string; channelSlug: string }> {
  requireSupabase()
  const r = await rpc<Row[]>('reparto_cambiar_desde_pedido', { p_sale_id: saleId, p_delivery_by: deliveryBy })
  const fila = (r ?? [])[0]
  return { serviceType: (fila?.service_type as string) ?? '', channelSlug: (fila?.channel_slug as string) ?? '' }
}

/** Responder a la sugerencia de Folvy. Devuelve la frase que hay que enseñar. */
export async function responderSugerencia(p: {
  accountId: string; brandId: string; channelSlug: string; lastSaleId: string; aceptar: boolean
}): Promise<string> {
  requireSupabase()
  return await rpc<string>('reparto_responder_sugerencia', {
    p_account_id: p.accountId, p_brand_id: p.brandId, p_channel_slug: p.channelSlug,
    p_last_sale_id: p.lastSaleId, p_aceptar: p.aceptar,
  })
}
