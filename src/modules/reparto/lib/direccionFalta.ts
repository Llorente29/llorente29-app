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

/** La primera frase de la tarjeta y de la lista: siempre la misma. */
export const SIN_DIRECCION_COMPLETA = 'Sin dirección completa'

/** Lo mínimo del pedido para decir cómo va. Vale para la tarjeta (feed) y la lista. */
export interface EstadoDeLaEntrega {
  /** Ya está en Catcher (tiene carrier o pedido de Catcher). */
  enCatcher: boolean
  dispatchError: string | null
  dispatchMode: string | null
}

function motivo(error: string): string {
  return error.replace(/^No se (despachó|pudo enviar a Catcher):\s*/i, '').trim()
}

/**
 * La frase de la tarjeta, después de «Sin dirección completa · ». Informativa:
 * la cocina no tiene nada que hacer, salvo despachar en un local que despacha
 * a mano (como hoy).
 */
export function comoVaLaEntrega(e: EstadoDeLaEntrega): string {
  if (e.enCatcher) return 'salió a Catcher con el punto del mapa; el repartidor llamará al cliente'
  if (e.dispatchError) return `no ha salido a Catcher: ${motivo(e.dispatchError)}`
  if (e.dispatchMode === 'manual') return 'este local despacha a mano: despáchalo y el repartidor llamará al cliente'
  if (e.dispatchMode === 'off') return 'lo despacha otro sistema; el repartidor tendrá que llamar al cliente'
  return 'sale a Catcher con el punto del mapa; el repartidor llamará al cliente'
}

/** La línea entera de la tarjeta. */
export function avisoDeLaTarjeta(e: EstadoDeLaEntrega): string {
  return `${SIN_DIRECCION_COMPLETA} · ${comoVaLaEntrega(e)}`
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
  const quien = [p.code, p.brand, nombreDelPortal(p.channel)].filter(Boolean).join(' · ')
  return `${quien} — ${estadoEnLaLista(p)}`
}

function estadoEnLaLista(p: PedidoSinDireccion): string {
  const completada = (p.direccion_completada ?? '').trim()
  if (completada) {
    const por = (p.completada_por ?? '').trim()
    return `completada${por ? ` por ${por}` : ''}: ${completada}`
  }
  if (p.decidir) return `falta decidir quién reparte este pedido de ${nombreDelPortal(p.channel)} (en el aviso rojo)`
  if (CERRADO.has((p.status ?? 'open').toLowerCase())) return 'cerrado sin completar la dirección'
  if (p.en_catcher && (p.rider_name ?? '').trim()) {
    return `en Catcher con ${p.rider_name!.trim()}; el repartidor llamará al cliente`
  }
  return comoVaLaEntrega({ enCatcher: p.en_catcher, dispatchError: p.dispatch_error, dispatchMode: p.dispatch_mode ?? null })
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

/**
 * Lo que sigue a guardar: mandarlo a Catcher (aún no lo tiene), o decir qué
 * ha pasado; si Catcher ya lo tiene y hay repartidor, su teléfono para el
 * botón «Llamar» (la API de Catcher no deja cambiar un pedido creado).
 */
export type SiguientePaso =
  | { tipo: 'mandar' }
  | { tipo: 'mensaje'; texto: string; llamar?: { nombre: string; telefono: string } }

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

const REIMPRIMIR = 'Reimprime el ticket de la bolsa para que la lleve.'

/**
 * Después de guardar la dirección: ¿se manda a Catcher? Solo si el resolutor
 * dice Catcher, el local despacha solo y Catcher aún no lo tiene. Si ya lo
 * tiene, la dirección se le dicta al repartidor.
 */
export function siguientePaso(r: ResultadoFijar): SiguientePaso {
  if (r.ya_en_catcher) {
    const nombre = (r.rider_name ?? '').trim()
    const telefono = (r.rider_phone ?? '').trim()
    if (nombre && telefono) {
      return {
        tipo: 'mensaje',
        texto: `Guardada: «${r.direccion}». Catcher no deja cambiar un pedido ya creado: llama a ${nombre} y díctasela. ${REIMPRIMIR}`,
        llamar: { nombre, telefono },
      }
    }
    return {
      tipo: 'mensaje',
      texto: `Guardada: «${r.direccion}». Catcher no deja cambiar un pedido ya creado y aún no ha asignado repartidor: cuando lo asigne, sale aquí su teléfono para dictársela. ${REIMPRIMIR}`,
    }
  }
  if (!r.carrier) {
    return { tipo: 'mensaje', texto: `Guardada: «${r.direccion}», pero no se manda: ${r.reason ?? 'sin motivo'}.` }
  }
  if (r.dispatch_mode && r.dispatch_mode !== 'auto') {
    return {
      tipo: 'mensaje',
      texto: `Guardada: «${r.direccion}». Este local despacha a mano: pulsa «Despachar» en el pedido y sale con ella. ${REIMPRIMIR}`,
    }
  }
  if (r.carrier !== 'catcher') {
    return { tipo: 'mensaje', texto: `Guardada: «${r.direccion}». Lo reparte la flota propia: ya la tiene. ${REIMPRIMIR}` }
  }
  return { tipo: 'mandar' }
}

/** El texto cuando Catcher ya lo ha aceptado. */
export function mandadoACatcher(direccion: string): string {
  return `Guardada y mandada a Catcher con la dirección «${direccion}». ${REIMPRIMIR}`
}
