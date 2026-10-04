// src/modules/reparto/lib/etiqueta.ts
//
// R02 · La etiqueta de reparto de un pedido (encargo §5). Tres estados, y
// NUNCA rojo: la cocina cocina; lo del reparto va en su propia etiqueta.
//   · gris  «La reparte Glovo / Uber / Just Eat» — sin despacho, sin aviso.
//   · verde «Nosotros · rider asignado» (o en camino, o entregado).
//   · ámbar «Nosotros · falta la dirección», con «Pedirla al cliente» y
//     «Cambiar a “la reparte Uber”»; y «Nosotros · aún sin rider» cuando hay
//     dirección pero no ha salido (con «Despachar»).
// Pura: la prueba tests/unit/modules/reparto/etiqueta.test.ts.

export type TonoEtiqueta = 'gris' | 'verde' | 'ambar' | 'azul'
export type AccionEtiqueta = 'pedir_direccion' | 'cambiar_a_plataforma' | 'despachar'

export interface Etiqueta {
  tono: TonoEtiqueta
  texto: string
  detalle: string | null
  acciones: AccionEtiqueta[]
}

export interface PedidoParaEtiqueta {
  service_type: string | null
  delivery_address: string | null
  channel: string | null
  carrier_code: string | null
  has_courier: boolean | null
  rider_name: string | null
  delivery_state: string | null
  dispatch_mode: string | null
  dispatch_error: string | null
}

/** «Glovo», «Uber», «Just Eat»: el nombre corto con el que se habla en cocina. */
export function plataformaCorta(channel: string | null): string {
  const t = (channel ?? '').toLowerCase()
  if (t.includes('uber')) return 'Uber'
  if (t.includes('glovo')) return 'Glovo'
  if (t.includes('just')) return 'Just Eat'
  if (t.includes('deliveroo')) return 'Deliveroo'
  return channel?.trim() || 'la plataforma'
}

const ENTREGADO = new Set(['delivered', 'completed'])
const EN_CAMINO = new Set(['picked_up', 'in_delivery', 'on_the_way', 'in_transit'])

/** null = no es un pedido de reparto (recogida, en local): no lleva etiqueta. */
export function etiquetaDeReparto(p: PedidoParaEtiqueta): Etiqueta | null {
  const plataforma = plataformaCorta(p.channel)
  if (p.service_type === 'platform_delivery') {
    return { tono: 'gris', texto: `La reparte ${plataforma}`, detalle: 'nada que hacer', acciones: [] }
  }
  if (p.service_type !== 'own_delivery') return null

  const sinDireccion = !(p.delivery_address ?? '').trim()
  if (sinDireccion) {
    return {
      tono: 'ambar',
      texto: 'Nosotros · falta la dirección',
      detalle: `${plataforma} no la ha mandado`,
      acciones: ['pedir_direccion', 'cambiar_a_plataforma'],
    }
  }

  const estado = (p.delivery_state ?? '').toLowerCase()
  const transportista = p.carrier_code ? (p.carrier_code === 'catcher' ? 'Catcher' : p.carrier_code) : null
  if (ENTREGADO.has(estado)) {
    return { tono: 'verde', texto: 'Nosotros · entregado', detalle: transportista, acciones: [] }
  }
  if (EN_CAMINO.has(estado)) {
    return { tono: 'verde', texto: 'Nosotros · en camino', detalle: [transportista, p.rider_name].filter(Boolean).join(' · ') || null, acciones: [] }
  }
  if (p.has_courier || p.rider_name) {
    return { tono: 'verde', texto: 'Nosotros · rider asignado', detalle: [transportista, p.rider_name].filter(Boolean).join(' · ') || null, acciones: [] }
  }
  if (p.carrier_code) {
    return { tono: 'azul', texto: 'Nosotros · buscando rider', detalle: transportista, acciones: [] }
  }
  // Con dirección y sin salir: en modo «off» lo despacha otro sistema y aquí no
  // hay nada que hacer (regla 35: si no hay acción, no hay botón).
  const acciones: AccionEtiqueta[] = p.dispatch_mode === 'off' ? [] : ['despachar']
  return {
    tono: 'ambar',
    texto: 'Nosotros · aún sin rider',
    detalle: p.dispatch_error ? 'no ha salido: ' + p.dispatch_error.replace(/^No se (despachó|pudo enviar a Catcher):\s*/i, '') : null,
    acciones,
  }
}
