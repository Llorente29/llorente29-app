// src/modules/reparto/lib/direccionFalta.ts
//
// R03 · Los pedidos de reparto propio que llegan sin dirección completa
// (Julio, 16/10, tras ver las capturas). Salen a Catcher al momento, como
// cualquier otro, con el punto del mapa, la calle más cercana y la nota de
// llamar al cliente. Aquí, sin React, lo que dicen las pantallas:
//   · la tarjeta del pedido: una frase informativa, sin acciones para la cocina;
//   · la lista «Sin dirección completa» de Despacho: una frase por pedido;
//   · «Completar dirección» (oficina o encargado): qué ha pasado al guardar.
// Prueba: tests/unit/modules/reparto/direccionFalta.test.ts.
//
// Regla 8: el botón confirma o falla en pantalla, y la confirmación lleva
// contenido. Regla 7: la lista no esconde filas; la tarjeta solo informa.

import { lineaTelefono } from './entregaTicket'

/** Una fila de public.pedidos_sin_direccion (los de hoy sin dirección completa). */
export interface PedidoSinDireccion {
  sale_id: string
  sold_at: string
  code: string | null
  platform_order_ref: string | null
  channel: string | null
  brand: string | null
  status?: string | null
  order_status?: string | null
  delivery_state?: string | null
  lat: number | string | null
  lng: number | string | null
  carrier_code: string | null
  en_catcher: boolean
  rider_name: string | null
  rider_phone: string | null
  /** El teléfono del cliente, para «Llamar» (Uber: con su código). */
  customer_phone?: string | null
  customer_phone_code?: string | null
  dispatch_error: string | null
  /** El modo de despacho del local ('auto' | 'manual' | 'off'). */
  dispatch_mode?: string | null
  /** La que escribió una persona («Completar dirección»), y quién. */
  direccion_completada?: string | null
  completada_at?: string | null
  completada_por?: string | null
  /** Uber con señales mezcladas (calle, punto, cargo): lo decide una persona. */
  decidir?: boolean
  /** El aviso rojo: abierto, sin salir a Catcher y con el motivo. */
  no_ha_salido?: boolean
}

/** Después de «Lo reparte Uber». */
export const DECIDIDO_UBER = 'Hecho: lo reparte Uber. No sale a Catcher.'

/** Lo mínimo del pedido para decir cómo va. Vale para la tarjeta (feed) y la lista. */
export interface EstadoDeLaEntrega {
  /** Ya está en Catcher (tiene carrier o pedido de Catcher). */
  enCatcher: boolean
  dispatchError: string | null
  dispatchMode: string | null
  /** false si la plataforma tampoco ha mandado el punto del mapa; null si no se sabe. */
  hayPunto?: boolean | null
}

/** Ha salido (o está saliendo) con el punto del mapa: la cocina no tiene que hacer nada. */
export const HA_SALIDO = 'Ha salido a Catcher con el punto del mapa · el repartidor llamará al cliente'
/** No ha salido: alguien tiene que llamar al cliente. */
export const NO_HA_SALIDO = 'No ha salido a Catcher · llama al cliente y completa la dirección'

/** El motivo de dispatch_error, sin el prefijo de siempre y con mayúscula. */
export function motivoDelFallo(error: string | null | undefined): string {
  const m = (error ?? '').replace(/^No se (despachó|pudo enviar a Catcher):\s*/i, '').trim()
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : ''
}

/** ¿Ha salido, o va a salir solo? false = alguien tiene que hacer algo. */
export function haSalido(e: EstadoDeLaEntrega): boolean {
  if (e.enCatcher) return true
  if (e.dispatchError) return false
  if (e.hayPunto === false) return false
  return true
}

/**
 * La línea de la tarjeta y de la lista (Julio, 17/10: los locales van en
 * automático, que es el caso real). Informativa si ha salido; si no, qué hay
 * que hacer. En un local a mano (ninguno en producción) dice que se despache.
 */
export function avisoDeLaTarjeta(e: EstadoDeLaEntrega): string {
  if (e.enCatcher) return HA_SALIDO
  if (!haSalido(e)) return NO_HA_SALIDO
  if (e.dispatchMode === 'manual') return 'Este local despacha a mano · despáchalo y el repartidor llamará al cliente'
  if (e.dispatchMode === 'off') return 'Lo despacha otro sistema · el repartidor llamará al cliente'
  return HA_SALIDO
}

const CERRADO = new Set(['closed', 'cancelled', 'canceled'])

/** ¿Se puede completar desde la pantalla? Abierto, sin completar y sin decidir quién reparte. */
export function puedeCompletar(p: Pick<PedidoSinDireccion, 'status' | 'direccion_completada' | 'decidir'>): boolean {
  if (p.decidir) return false
  if ((p.direccion_completada ?? '').trim()) return false
  return !CERRADO.has((p.status ?? 'open').toLowerCase())
}

/** Una frase por pedido para la lista de Despacho: «G034 · Burger Norte · Glovo — …». */
export function fraseDeLaLista(p: PedidoSinDireccion): string {
  return `${quienEsElPedido(p)} — ${estadoEnLaLista(p)}`
}

/** «G034 · Burger Norte · Glovo». */
export function quienEsElPedido(p: Pick<PedidoSinDireccion, 'code' | 'brand' | 'channel'>): string {
  return [p.code, p.brand, nombreDelPortal(p.channel)].filter(Boolean).join(' · ')
}

/** Los que necesitan a alguien: arriba y en rojo (no han salido, o falta decidir quién reparte). */
export function necesitaAAlguien(p: PedidoSinDireccion): boolean {
  if ((p.direccion_completada ?? '').trim()) return false
  if (CERRADO.has((p.status ?? 'open').toLowerCase())) return false
  if (p.decidir) return true
  return !haSalido(estadoDeLaFila(p))
}

/** Lo que dice la fila de la lista: el mismo cálculo que la tarjeta, con el punto del mapa que trae la lista. */
function estadoDeLaFila(p: PedidoSinDireccion): EstadoDeLaEntrega {
  return {
    enCatcher: p.en_catcher, dispatchError: p.dispatch_error, dispatchMode: p.dispatch_mode ?? null,
    hayPunto: enlaceAlMapa(p.lat, p.lng) !== null,
  }
}

/** El orden de la lista: primero los que necesitan a alguien; dentro, el más reciente arriba. */
export function ordenarLaLista(pedidos: PedidoSinDireccion[]): PedidoSinDireccion[] {
  return [...pedidos].sort((a, b) =>
    Number(necesitaAAlguien(b)) - Number(necesitaAAlguien(a)) || (b.sold_at ?? '').localeCompare(a.sold_at ?? ''))
}

function estadoEnLaLista(p: PedidoSinDireccion): string {
  const completada = (p.direccion_completada ?? '').trim()
  if (completada) return `${completadaPor(p.completada_por)}: ${completada}`
  if (p.decidir) return `Falta decidir quién reparte este pedido de ${nombreDelPortal(p.channel)} (en el aviso rojo)`
  if (CERRADO.has((p.status ?? 'open').toLowerCase())) return 'Cerrado sin completar la dirección'
  return avisoDeLaTarjeta(estadoDeLaFila(p))
}

/** «Dirección completada por Persona de Prueba». */
export function completadaPor(por: string | null | undefined): string {
  const quien = (por ?? '').trim()
  return `Dirección completada${quien ? ` por ${quien}` : ''}`
}

/** «Tel. +34 600 000 000 · código 12345678» (Uber: la centralita no conecta sin él). */
export function telefonoDelCliente(telefono: string | null | undefined, codigo?: string | null): string | null {
  return lineaTelefono(telefono, codigo ?? null)
}

/** El enlace tel: de un teléfono. */
export function enlaceTel(telefono: string): string {
  return `tel:${telefono.replace(/\s+/g, '')}`
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
  /** Quién la ha escrito (la marca que queda en el pedido). */
  por?: string | null
}

/**
 * Lo que sigue a guardar: mandarlo a Catcher (aún no lo tiene), o decir qué
 * ha pasado; si Catcher ya lo tiene y hay repartidor, su teléfono para el
 * botón «Llamar» (la API de Catcher no deja cambiar un pedido creado).
 */
export type SiguientePaso =
  | { tipo: 'mandar' }
  | { tipo: 'mensaje'; texto: string }

/** El número con el que se busca el pedido en el portal de la plataforma. */
export function numeroParaElPortal(p: Pick<PedidoSinDireccion, 'platform_order_ref' | 'code'>): string | null {
  return (p.platform_order_ref ?? '').trim() || (p.code ?? '').trim() || null
}

/** «Glovo», «Uber», «Just Eat»: el nombre de la plataforma. */
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

/**
 * Después de guardar la dirección: ¿se manda a Catcher? Solo si el resolutor
 * dice Catcher, el local despacha solo y Catcher aún no lo tiene. Si ya lo
 * tiene, la dirección se le dicta al repartidor (su API no deja cambiar un
 * pedido creado), desde su fila de reparto de siempre. La línea de confirmación la
 * pone lineaDeCompletada; aquí solo lo que hay que añadir, si algo.
 */
export function siguientePaso(r: ResultadoFijar): SiguientePaso {
  if (r.ya_en_catcher) return { tipo: 'mensaje', texto: '' }
  if (!r.carrier) return { tipo: 'mensaje', texto: `No se manda a Catcher: ${r.reason ?? 'sin motivo'}.` }
  if (r.dispatch_mode && r.dispatch_mode !== 'auto') {
    return { tipo: 'mensaje', texto: 'Este local despacha a mano: pulsa «Despachar» en el pedido y sale con ella.' }
  }
  if (r.carrier !== 'catcher') return { tipo: 'mensaje', texto: 'Lo reparte la flota propia: ya la tiene.' }
  return { tipo: 'mandar' }
}

/** Lo que pasó con el ticket al reimprimirlo: cuántos trabajos, o el fallo. */
export type Reimpresion = { trabajos: number } | { error: string } | null

/**
 * La línea de confirmación (regla 8, con contenido): «Dirección completada por
 * Persona de Prueba · ticket reimpreso». Si no se ha podido reimprimir, lo dice.
 */
export function lineaDeCompletada(por: string | null | undefined, ticket: Reimpresion): string {
  const base = completadaPor(por)
  if (!ticket) return base
  if ('error' in ticket) return `${base} · no se ha podido reimprimir el ticket`
  return ticket.trabajos > 0 ? `${base} · ticket reimpreso` : `${base} · el local no tiene impresora para el ticket de la bolsa`
}
