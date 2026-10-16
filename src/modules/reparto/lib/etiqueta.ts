// src/modules/reparto/lib/etiqueta.ts
//
// R02 · La etiqueta de reparto de un pedido (encargo §5). Tres estados, y
// NUNCA rojo: la cocina cocina; lo del reparto va en su propia etiqueta.
//   · gris  «La reparte Glovo / Uber / Just Eat» — sin despacho, sin aviso.
//   · verde «Nosotros · rider asignado» (o en camino, o entregado).
//   · ámbar «Nosotros · aún sin rider» cuando no ha salido (con «Despachar»).
//   R03: un pedido sin dirección completa no tiene etiqueta propia: sale a
//   Catcher como cualquier otro (lo dice la línea informativa de la tarjeta,
//   src/modules/reparto/lib/direccionFalta.ts). Ni «Pedirla al cliente» ni
//   «Cambiar a “la reparte X”»: pasar la marca a «Plataforma» por pedidos sin
//   dirección no puede existir (Julio, 16/10).
// Pura: la prueba tests/unit/modules/reparto/etiqueta.test.ts.

export type TonoEtiqueta = 'gris' | 'verde' | 'ambar' | 'azul'
export type AccionEtiqueta = 'despachar'

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
  /** R03: 'fuera_de_zona' = Uber sin calle: el cliente está fuera del radio y reparte Uber. */
  delivery_by_reason?: string | null
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
    // R03: Uber sin calle, sin punto y sin cargo de envío = fuera del radio de
    // reparto propio: la reparte Uber. O lo decidió una persona.
    if (p.delivery_by_reason === 'fuera_de_zona' || p.delivery_by_reason === 'decidido_uber') {
      return { tono: 'gris', texto: `La reparte ${plataforma} · fuera de zona`, detalle: 'nada que hacer', acciones: [] }
    }
    return { tono: 'gris', texto: `La reparte ${plataforma}`, detalle: 'nada que hacer', acciones: [] }
  }
  if (p.service_type !== 'own_delivery') return null

  // R03: Uber con señales mezcladas: lo decide una persona en el aviso rojo, y no sale antes.
  if (p.delivery_by_reason === 'uber_decidir') {
    return { tono: 'ambar', texto: 'Nosotros · falta decidir quién reparte', detalle: 'decídelo en el aviso rojo', acciones: [] }
  }

  // R03 (Julio, tras las capturas): sin dirección completa ya no es un estado
  // aparte. Sale a Catcher como cualquier otro y la etiqueta dice cómo va el
  // reparto; lo de la dirección es la línea informativa de la tarjeta.

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
