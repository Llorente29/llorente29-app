// src/modules/reparto/services/quienReparteService.ts
//
// R02 · Lo que necesita la pantalla «Quién reparte» y la etiqueta de reparto
// del pedido. Lee las tablas (con RLS: solo la cuenta activa) y escribe SOLO
// por las funciones de la base (reparto_guardar_celda, reparto_guardar_herencia):
// quién decide y cuándo lo pone el servidor, y el ON CONFLICT correcto también
// (el R01). R03 (Julio, 16/10): fuera la sugerencia «lleva 3 pedidos seguidos
// sin dirección, ¿la paso a Plataforma?», «Lo que ha hecho Folvy», el aviso de
// las celdas y «Cambiar a “la reparte X”» desde el pedido. No puede existir.
// Las funciones y la tabla de la base se quitan en otra tanda (dos pasos).
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

export interface DatosQuienReparte {
  marcas: Marca[]
  locales: Local[]
  plataformas: Plataforma[]
  celdas: Celda[]
  herencias: Herencia[]
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
  const [marcasR, localesR, canalesR, celdasR, herenciasR] = await Promise.all([
    from('brand').select('id, name, ownership_type, is_active').eq('account_id', accountId).order('name'),
    from('locations').select('id, name, active').eq('account_id', accountId).order('name'),
    from('sales_channel').select('id, slug, name, channel_type, is_active').eq('account_id', accountId)
      .eq('channel_type', 'delivery'),
    from('brand_delivery_policy')
      .select('brand_id, channel_slug, location_id, delivery_by, source, decided_at, decided_by_name')
      .eq('account_id', accountId),
    from('channel_delivery_policy').select('channel_slug, ownership_type, location_id, service_type')
      .eq('account_id', accountId),
  ])
  for (const r of [marcasR, localesR, canalesR, celdasR, herenciasR]) {
    if (r.error) throw new ErrorDeReparto(r.error.message, r.error.code)
  }

  const canales = ((canalesR.data as Row[] | null) ?? [])
    .filter(c => c.is_active !== false && typeof c.slug === 'string' && (c.slug as string).trim() !== '')
  const orden = ['glovo', 'uber', 'justeat', 'deliveroo']
  const plataformas: Plataforma[] = [...new Map(canales.map(c => [c.slug as string, c])).values()]
    .map(c => ({ slug: c.slug as string, nombre: nombrePlataforma(c.slug as string, c.name as string) }))
    .sort((a, b) => (orden.indexOf(a.slug) + 1 || 99) - (orden.indexOf(b.slug) + 1 || 99))

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
  }
}

/**
 * Guarda una celda marca × plataforma (× local). `deliveryBy = null` quita la
 * decisión: vuelve a heredar. Devuelve cómo queda resuelta.
 */
export async function guardarCelda(p: {
  accountId: string; brandId: string; channelSlug: string; locationId: string | null
  deliveryBy: QuienReparte | null; source?: 'manual'
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
