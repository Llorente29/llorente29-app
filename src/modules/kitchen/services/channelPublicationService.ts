// src/modules/kitchen/services/channelPublicationService.ts
//
// F6 del rediseño del gestor de menús: saber, SIN abrir la ficha, en qué
// canales está cada producto y cómo.
//
// QUÉ MIRA, Y QUÉ NO
// Lee `menu_item_override` cruzado con `sales_channel`. Eso es el precio y la
// disponibilidad que TÚ has fijado por canal, que es lo que se puede cambiar
// desde Folvy. NO es "lo que HubRise tiene publicado ahora mismo": la verdad de
// la plataforma vive en external_catalog_product y solo se sabe tras publicar.
// El chip dice, con precisión, «este producto tiene precio propio en Glovo y no
// está pausado ahí», no «Glovo lo está vendiendo». La diferencia importa el día
// que una publicación falle, y por eso queda dicha aquí y no escondida.
//
// LOS TRES ESTADOS
//   verde  — hay override con precio y ningún override lo marca no disponible
//   rojo   — algún override de ese canal lo marca no disponible (pausado ahí)
//   gris   — no hay override con precio: se vende al precio base, o no se vende
//
// Los overrides pueden ser por local (location_id). Se agrega a nivel canal
// tomando el peor caso: si en UN local está pausado, el chip lo dice. Esconder
// eso detrás de un verde sería mentir en la dirección peligrosa.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado')
  }
}

export type ChannelState = 'published' | 'paused' | 'none'

export interface ChannelBadge {
  channelId: string
  slug: string
  name: string
  /** Letra del chip: G, U, J, S. Sale del slug, no de la posición. */
  letter: string
  state: ChannelState
}

/** Los canales que se pintan en la fila, en este orden. El resto de canales
 *  (mostrador, etc.) no son "publicación": no salen en la carta de delivery. */
const CHANNEL_LETTER: Record<string, string> = {
  glovo: 'G',
  uber: 'U',
  justeat: 'J',
  shop: 'S',
}
const CHANNEL_ORDER = ['glovo', 'uber', 'justeat', 'shop']

export interface BrandChannelPublication {
  /** Los canales de la cuenta que se pintan, ya ordenados. */
  channels: { id: string; slug: string; name: string; letter: string }[]
  /** menuItemId -> estado por canal (mismo orden que `channels`). */
  byItem: Map<string, ChannelBadge[]>
}

/**
 * Estado de publicación por canal de todos los productos de una marca.
 *
 * Dos consultas, no una por fila: la lista puede tener 500 productos y una
 * consulta por producto convertiría la pantalla en un goteo de peticiones.
 */
export async function listBrandChannelPublication(
  accountId: string,
  menuItemIds: string[],
): Promise<BrandChannelPublication> {
  requireSupabase()

  const { data: chs, error: chErr } = await supabase!
    .from('sales_channel')
    .select('id, slug, name, is_active, archived_at')
    .eq('account_id', accountId)
  if (chErr) throw new Error(`Error listando canales: ${chErr.message}`)

  const channels = (chs ?? [])
    .filter((c) => c.is_active !== false && !c.archived_at)
    .filter((c) => CHANNEL_LETTER[c.slug as string] !== undefined)
    .map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      name: c.name as string,
      letter: CHANNEL_LETTER[c.slug as string],
    }))
    .sort((a, b) => CHANNEL_ORDER.indexOf(a.slug) - CHANNEL_ORDER.indexOf(b.slug))

  const byItem = new Map<string, ChannelBadge[]>()
  if (channels.length === 0 || menuItemIds.length === 0) return { channels, byItem }

  const { data: ovs, error: ovErr } = await supabase!
    .from('menu_item_override')
    .select('menu_item_id, channel_id, price, is_available')
    .eq('account_id', accountId)
    .in('menu_item_id', menuItemIds)
  if (ovErr) throw new Error(`Error listando overrides de canal: ${ovErr.message}`)

  // (item, canal) -> { tienePrecio, algunoPausado }
  const agg = new Map<string, { priced: boolean; paused: boolean }>()
  for (const o of ovs ?? []) {
    const channelId = o.channel_id as string | null
    if (!channelId) continue
    const key = `${o.menu_item_id as string}|${channelId}`
    const prev = agg.get(key) ?? { priced: false, paused: false }
    agg.set(key, {
      priced: prev.priced || o.price !== null,
      paused: prev.paused || o.is_available === false,
    })
  }

  for (const itemId of menuItemIds) {
    byItem.set(
      itemId,
      channels.map((c) => {
        const a = agg.get(`${itemId}|${c.id}`)
        const state: ChannelState = a?.paused ? 'paused' : a?.priced ? 'published' : 'none'
        return { channelId: c.id, slug: c.slug, name: c.name, letter: c.letter, state }
      }),
    )
  }

  return { channels, byItem }
}
