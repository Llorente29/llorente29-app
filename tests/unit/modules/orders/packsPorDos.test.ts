// Los packs pedidos 2x salian 1x en cocina, en el ticket y en las pegatinas.
//
// POR QUE ESTA PRUEBA EXISTE, y lo que costo. G587 · Alcala · Dos Coyotes ·
// Glovo 101780066538 · 21/09/2026 16:06. El cliente pidio DOS «PACK PA 2 DC».
// Folvy saco pegatinas para uno solo, cocina hizo uno, el pase lo dio por
// completo y salio por la puerta. Glovo reclamo por producto no entregado y le
// paso al partner -31,43 EUR. No fue un caso suelto: en 30 dias hay ~30 pedidos
// con un pack o menu en cantidad 2 o 3, en las dos cocinas.
//
// LA CAUSA. `sale_line.quantity` de un `combo_item` es la cantidad POR PACK.
// El almacen ya lo sabia (`_sale_line_raw_consumption` multiplica el hijo por
// la cantidad del padre, y por eso el stock de G587 SI descontó dos packs);
// no lo sabia nada de lo que ve una persona.
//
// LOS CASOS NO SON INVENTADOS. Son las tres ventas reales, copiadas de la base
// el 22/09 con sus nombres, sus cantidades y sus familias tal y como estan:
//   G587 (21/09) 2x PACK PA 2 DC  -> 3 componentes de comida a 1 + Coca Cola a 2
//   G089 (19/09) 3x Pack Chicken Single Hero CH -> 2 componentes a 1
//   U053 (20/09) 3x Korean Loaded Pack (Para 1) KDB -> 2 componentes a 1
// Con ejemplos de mi cabeza no se me habria ocurrido el que mas duele: el
// componente con cantidad PROPIA mayor que uno (las 2 Coca-Colas del G587),
// donde hay que multiplicar 2x2=4 y no quedarse en ninguno de los dos doses.

import { describe, it, expect } from 'vitest'
import { unidadesDeComponente } from '../../../../src/modules/orders/services/ordersFeedService'
import type { OrderFeedItem, OrderFeedLine, OrderFeedChild } from '../../../../src/modules/orders/services/ordersFeedService'
import { renderLabels, renderKitchenTicket, renderBagTicket } from '../../../../src/modules/orders/lib/ticketRenderer'

function hijo(name: string, qty: number, family: string | null = null): OrderFeedChild {
  return {
    line_id: 'h-' + name, name, qty, line_type: 'combo_item', group_type: null,
    menu_item_id: null, family, family_color: null, menu_category: null, customer_note: null,
  }
}

function linea(name: string, qty: number, children: OrderFeedChild[]): OrderFeedLine {
  return {
    line_id: 'l-' + name, name, qty, menu_item_id: null, unit_price: null, line_total: null,
    marked: false, allergens: [], family: null, family_color: null, family_icon: null,
    menu_category: null, has_recipe: false, customer_note: null, children,
  }
}

function pedido(pos: string, lineas: OrderFeedLine[]): OrderFeedItem {
  return {
    sale_id: 's-' + pos, external_ref: null, external_tab_ref: null,
    platform_order_code: '101780066538', pos_short_code: pos, platform_order_ref: null,
    order_status: 'accepted', status: 'open', service_type: 'delivery', source: 'glovo',
    brand: 'Dos Coyotes', brand_logo_url: null, brand_color: null, brand_shop_url: null,
    brand_qr_caption: null, brand_ownership_type: 'own', channel: 'Glovo', channel_id: null,
    customer_name: 'Ana', customer_phone: null, delivery_address: null, expected_time: null,
    customer_note: null, total: 62.86, paid: null, payment_method: null, discount_amount: null,
    delivery_cost: null, entro_at: '2026-09-21T14:06:41Z', minutos: 0,
    dispatch_mode: null, carrier_code: null, delivery_state: null, rider_name: null,
    rider_phone: null, eta_pickup: null, eta_delivery: null, transport_price: null,
    dispatch_error: null, rider_transport_type: null, rider_seen_at: null, has_courier: null,
    rider_lat: null, rider_lng: null, accepted_at: null, lineas,
  } as unknown as OrderFeedItem
}

// Las tres ventas reales.
const G587 = pedido('G587', [linea('PACK PA 2  DC', 2, [
  hijo('QUESATACOS DE BIRRIA DE POLLO (DC)', 1),
  hijo('QUESATACOS DE TERNERA (DC)', 1),
  hijo('QUESADILLA DOS COYOTES (DC)', 1),
  hijo('Coca Cola', 2, 'Bebidas sin alcohol'),
])])

const G089 = pedido('G089', [linea('Pack Chicken Single Hero CH', 3, [
  hijo('CHICKEN BURGER MELT CH', 1),
  hijo('PULLED PORK FRIES (CH)', 1),
])])

const U053 = pedido('U053', [linea('Korean Loaded Pack (Para 1) KDB', 3, [
  hijo('Korean Fried Chicken and Fries 2.0 (KDB)', 1),
  hijo('Loaded Korean porky fries (KDB)', 1),
])])

describe('la regla, en un solo sitio', () => {
  it('multiplica el componente por el pack', () => {
    expect(unidadesDeComponente(1, 2)).toBe(2)   // quesatacos en 2 packs
    expect(unidadesDeComponente(2, 2)).toBe(4)   // las 2 Coca-Colas en 2 packs
    expect(unidadesDeComponente(1, 3)).toBe(3)   // G089 y U053
  })

  it('un pack de uno no cambia nada', () => {
    expect(unidadesDeComponente(1, 1)).toBe(1)
    expect(unidadesDeComponente(2, 1)).toBe(2)
  })

  it('un dato ausente o roto nunca da cero piezas', () => {
    // Un cero se lee como "no lleva nada" y vuelve a salir una bolsa incompleta.
    expect(unidadesDeComponente(null, 2)).toBe(2)
    expect(unidadesDeComponente(1, null)).toBe(1)
    expect(unidadesDeComponente(0, 0)).toBe(1)
    expect(unidadesDeComponente(NaN, 2)).toBe(2)
  })
})

describe('G587 · las pegatinas que no se imprimieron', () => {
  const labels = renderLabels(G587)

  it('saca 6 pegatinas de comida y 1 de bebidas', () => {
    // Antes del arreglo eran 3 de comida + 1 de bebidas = 4 en total.
    expect(labels).toHaveLength(7)
  })

  it('dos de cada plato, con su nombre', () => {
    const texto = labels.map(l => JSON.stringify(l.blocks)).join('\n')
    for (const plato of ['QUESATACOS DE BIRRIA DE POLLO (DC)', 'QUESATACOS DE TERNERA (DC)', 'QUESADILLA DOS COYOTES (DC)']) {
      const veces = labels.filter(l => JSON.stringify(l.blocks).includes(plato)).length
      expect(veces, plato).toBe(2)
    }
    expect(texto).toContain('BOLSA BEBIDAS')
  })

  it('el N de M cuenta las piezas reales', () => {
    expect(labels[0].title).toBe('Pegatina 1/7')
    const bebidas = JSON.stringify(labels[6].blocks)
    expect(bebidas).toContain('7 de 7')
    expect(bebidas).toContain('4x Coca Cola')   // 2 latas x 2 packs
  })
})

describe('G587 · el ticket de cocina y el de bolsa', () => {
  it('cocina ve el 2x en cada componente', () => {
    const t = JSON.stringify(renderKitchenTicket(G587).blocks)
    expect(t).toContain('2x  PACK PA 2  DC')
    expect(t).toContain('2x QUESATACOS DE BIRRIA DE POLLO (DC)')
    expect(t).toContain('2x QUESATACOS DE TERNERA (DC)')
    expect(t).toContain('2x QUESADILLA DOS COYOTES (DC)')
    expect(t).toContain('4x Coca Cola')
  })

  it('la bolsa lleva las mismas cantidades', () => {
    const t = JSON.stringify(renderBagTicket(G587).blocks)
    expect(t).toContain('2x QUESATACOS DE TERNERA (DC)')
    expect(t).toContain('4x Coca Cola')
  })
})

describe('los otros dos pedidos de 3x', () => {
  it('G089 saca 3 de cada componente', () => {
    const labels = renderLabels(G089)
    expect(labels).toHaveLength(6)   // 3 + 3, ninguna bebida
    expect(labels.filter(l => JSON.stringify(l.blocks).includes('CHICKEN BURGER MELT CH'))).toHaveLength(3)
    expect(JSON.stringify(renderKitchenTicket(G089).blocks)).toContain('3x PULLED PORK FRIES (CH)')
  })

  it('U053 saca 3 de cada componente', () => {
    const labels = renderLabels(U053)
    expect(labels).toHaveLength(6)
    expect(labels.filter(l => JSON.stringify(l.blocks).includes('Loaded Korean porky fries (KDB)'))).toHaveLength(3)
  })
})

describe('lo que NO puede cambiar', () => {
  it('un combo 1x sale exactamente igual que antes', () => {
    const uno = pedido('G001', [linea('PACK PA 2  DC', 1, [
      hijo('QUESADILLA DOS COYOTES (DC)', 1),
      hijo('Coca Cola', 2, 'Bebidas sin alcohol'),
    ])])
    const labels = renderLabels(uno)
    expect(labels).toHaveLength(2)   // 1 de comida + 1 de bebidas
    const cocina = JSON.stringify(renderKitchenTicket(uno).blocks)
    // sin numero delante, tal cual salia el 21/09
    expect(cocina).toContain('QUESADILLA DOS COYOTES (DC)')
    expect(cocina).not.toContain('1x QUESADILLA')
    expect(cocina).toContain('2x Coca Cola')   // esa si llevaba 2 por pack
  })

  it('un plato suelto 2x sigue dando 2 pegatinas', () => {
    const suelto = pedido('G002', [linea('QUESADILLA DOS COYOTES (DC)', 2, [])])
    expect(renderLabels(suelto)).toHaveLength(2)
  })
})
