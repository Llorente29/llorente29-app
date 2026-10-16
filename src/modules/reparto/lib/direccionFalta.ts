// src/modules/reparto/lib/direccionFalta.ts
//
// R03 · El aviso «Falta la dirección de este pedido» (Julio, 16/10). Lo que
// dice la pantalla después de pegar una dirección, sin React: la prueba
// tests/unit/modules/reparto/direccionFalta.test.ts.
//
// Regla 8: el botón confirma o falla en pantalla, y la confirmación lleva
// contenido. «Hecho» no vale: dice a quién se ha mandado y con qué dirección,
// o por qué no.

/** Una fila del aviso (public.pedidos_sin_direccion). */
export interface PedidoSinDireccion {
  sale_id: string
  sold_at: string
  code: string | null
  platform_order_ref: string | null
  channel: string | null
  brand: string | null
  lat: number | string | null
  lng: number | string | null
  carrier_code: string | null
  en_catcher: boolean
  rider_name: string | null
  rider_phone: string | null
  dispatch_error: string | null
  /** R03 · 2: a qué hora sale solo a Catcher por el punto del mapa (5 min desde que se aceptó). */
  sale_solo_at?: string | null
  /** El modo de despacho del local ('auto' | 'manual' | 'off'). */
  dispatch_mode?: string | null
  /** R03 · Uber con señales mezcladas (calle, punto, cargo): lo decide una persona. */
  decidir?: boolean
}

/** Después de «Lo reparte Uber». */
export const DECIDIDO_UBER = 'Hecho: lo reparte Uber. No sale a Catcher.'

/**
 * Lo que dice el aviso sobre cuándo sale (Julio, 16/10, opción B): cuánto
 * falta para que salga solo con el punto del mapa, o que ya ha salido.
 */
export function estadoDeSalida(p: PedidoSinDireccion, ahoraMs: number): string {
  if (p.en_catcher) {
    return `Ya ha salido a Catcher por el punto del mapa${p.rider_name ? `, con ${p.rider_name}` : ''}.`
  }
  if (p.dispatch_mode && p.dispatch_mode !== 'auto') {
    return 'Este local despacha a mano: no sale solo.'
  }
  const solo = p.sale_solo_at ? Date.parse(p.sale_solo_at) : NaN
  if (!Number.isFinite(solo)) return 'Sale solo a Catcher con el punto del mapa si no pegas la dirección.'
  const s = Math.ceil((solo - ahoraMs) / 1000)
  if (s <= 0) return 'Saliendo solo a Catcher con el punto del mapa…'
  const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0')
  return `Sale solo a Catcher en ${mm}:${ss} con el punto del mapa, si no pegas la dirección antes.`
}

/** Lo que devuelve public.fijar_direccion_entrega. */
export interface ResultadoFijar {
  ok: boolean
  sale_id: string
  direccion: string
  carrier: string | null
  reason: string | null
  dispatch_mode: string | null
  ya_en_catcher: boolean
  rider_name: string | null
  rider_phone: string | null
}

/** Lo que sigue a guardar: mandar a Catcher, o no y por qué. */
export type SiguientePaso =
  | { tipo: 'mandar' }
  | { tipo: 'mensaje'; texto: string }

/** El número con el que se busca el pedido en el portal de la plataforma. */
export function numeroParaElPortal(p: Pick<PedidoSinDireccion, 'platform_order_ref' | 'code'>): string | null {
  return (p.platform_order_ref ?? '').trim() || (p.code ?? '').trim() || null
}

/** «Glovo», «Uber», «Just Eat»: el nombre del portal donde buscarlo. */
export function nombreDelPortal(channel: string | null): string {
  const t = (channel ?? '').toLowerCase()
  if (t.includes('glovo')) return 'Glovo'
  if (t.includes('uber')) return 'Uber'
  if (t.includes('just')) return 'Just Eat'
  return channel?.trim() || 'la plataforma'
}

/** El enlace al punto del mapa, o null si no hay coordenadas. */
export function enlaceAlMapa(lat: number | string | null, lng: number | string | null): string | null {
  const a = Number(lat), b = Number(lng)
  if (lat == null || lng == null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`
}

function conRepartidor(r: Pick<ResultadoFijar, 'rider_name' | 'rider_phone'>): string {
  const quien = (r.rider_name ?? '').trim()
  const tel = (r.rider_phone ?? '').trim()
  if (quien && tel) return `llama al repartidor (${quien}, ${tel}) y díctasela`
  if (quien) return `díctasela al repartidor (${quien})`
  return 'en cuanto tenga repartidor, llámale y díctasela'
}

/**
 * Después de guardar la dirección: ¿se manda a Catcher? Solo si el resolutor
 * dice Catcher, el local despacha solo y Catcher aún no lo tiene. Catcher no
 * deja cambiar ni anular un pedido que ya tiene: si salió por el punto del
 * mapa, la dirección buena se le da al repartidor.
 */
export function siguientePaso(r: ResultadoFijar): SiguientePaso {
  if (r.ya_en_catcher) {
    return {
      tipo: 'mensaje',
      texto: `Guardada: «${r.direccion}». Catcher ya llevaba este pedido al punto del mapa y no deja cambiarle la dirección: ${conRepartidor(r)}.`,
    }
  }
  if (!r.carrier) {
    return { tipo: 'mensaje', texto: `Guardada: «${r.direccion}», pero no se manda: ${r.reason ?? 'sin motivo'}.` }
  }
  if (r.dispatch_mode && r.dispatch_mode !== 'auto') {
    return {
      tipo: 'mensaje',
      texto: `Guardada: «${r.direccion}». Este local despacha a mano: pulsa «Despachar» en el pedido.`,
    }
  }
  if (r.carrier !== 'catcher') {
    return { tipo: 'mensaje', texto: `Guardada: «${r.direccion}». Lo reparte la flota propia: ya la tiene.` }
  }
  return { tipo: 'mandar' }
}

/** El texto cuando Catcher ya lo ha aceptado. */
export function mandadoACatcher(direccion: string): string {
  return `Mandado a Catcher con la dirección «${direccion}».`
}
