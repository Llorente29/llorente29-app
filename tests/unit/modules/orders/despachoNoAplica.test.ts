// El KDS dejaba de distinguir «ha fallado» de «no aplica» (08/09/2026).
//
// POR QUE ESTA PRUEBA EXISTE. Un pedido de Just Eat de «Dos Coyotes» —marca
// cedida, que reparte la plataforma— salia en la tarjeta de cocina con el mayor
// golpe visual que tiene la pantalla: bloque rojo «⚠️ NO SE PUDO DESPACHAR» y
// un boton «Reintentar despacho» que no podia funcionar nunca. El despacho
// hacia lo correcto al no mandarla a la flota propia; mentia la pantalla. En
// cocina, en hora punta, ese rojo se lee como «para el pedido».
//
// LOS CASOS NO SON INVENTADOS. Son las formas REALES medidas en Foodint el
// 08/09 sobre los 69 pedidos afectados: sus marcas, sus canales tal y como los
// escribe cada pasarela ('JustEat', 'Glovo'), y sus motivos de `dispatch_error`
// copiados de la base. Con ejemplos de mi cabeza, el caso que mas importa —una
// marca PROPIA con el interruptor apagado y un fallo real antiguo encima— no se
// me habria ocurrido, y son 52 de los 69.

import { describe, it, expect } from 'vitest'
import {
  brandDoesOwnDelivery,
  isOwnDeliveryUndispatched,
  deliveryView,
} from '../../../../src/modules/orders/services/ordersFeedService'
import type { OrderFeedItem } from '../../../../src/modules/orders/services/ordersFeedService'

// Molde minimo: solo lo que estas tres funciones miran. El resto del pedido no
// interviene, y rellenarlo entero solo escondería de que depende cada decision.
function pedido(p: Partial<OrderFeedItem>): OrderFeedItem {
  return {
    service_type: 'own_delivery',
    carrier_code: null,
    dispatch_error: null,
    dispatch_mode: 'auto',
    channel: null,
    delivery_state: null,
    ...p,
  } as unknown as OrderFeedItem
}

// ── Las cuatro filas reales de la medicion ──────────────────────────────────

/** Cedida. 17 pedidos, 12/06 → 08/09. El de la captura de Julio. */
const dosCoyotes = pedido({
  brand: 'Dos Coyotes', brand_ownership_type: 'licensed', brand_own_delivery: false,
  channel: 'JustEat',
  dispatch_error: 'No se despachó: marca sin reparto propio (interruptor apagado)',
})

/** Cedida SIN motivo: solo el boton azul. 23 de los 69 estaban asi. */
const dosCoyotesSinMotivo = pedido({
  brand: 'Dos Coyotes', brand_ownership_type: 'licensed', brand_own_delivery: false,
  channel: 'JustEat',
})

/** Marca PROPIA con el interruptor apagado a mano, y un fallo REAL antiguo
 *  encima. Son 52 de los 69: el caso mayoritario, y el que no es «una cedida». */
const smashApagada = pedido({
  brand: 'Smash Brothers Burgers', brand_ownership_type: 'own', brand_own_delivery: false,
  channel: 'Glovo',
  dispatch_error: 'Catcher no está conectado en este local',
})

/** Marca propia que SI reparte y de verdad ha fallado. ESTA no se toca. */
const propiaQueFalla = pedido({
  brand: 'Bendito Burrito', brand_ownership_type: 'own', brand_own_delivery: true,
  channel: 'Glovo',
  dispatch_error: 'Catcher no está conectado en este local',
})

describe('brandDoesOwnDelivery · LEE la respuesta de la base, no la recalcula', () => {
  it('false cuando la base dice que la marca no reparte', () => {
    expect(brandDoesOwnDelivery(dosCoyotes)).toBe(false)
    expect(brandDoesOwnDelivery(smashApagada)).toBe(false)
  })

  it('true cuando la base dice que si', () => {
    expect(brandDoesOwnDelivery(propiaQueFalla)).toBe(true)
  })

  // El feed no manda el campo hasta que la migracion esta aplicada. Publicar el
  // bundle antes NO puede cambiar la pantalla: se comporta como siempre.
  it('sin el campo (base sin migrar) se comporta como siempre: si reparte', () => {
    const viejo = pedido({ brand: 'Dos Coyotes', brand_ownership_type: 'licensed' })
    expect(brandDoesOwnDelivery(viejo)).toBe(true)
    expect(isOwnDeliveryUndispatched(viejo)).toBe(true)
  })

  // Un pedido sin marca deja el campo a null. Tampoco se apaga nada por eso.
  it('con la marca a null tampoco calla', () => {
    expect(brandDoesOwnDelivery(pedido({ brand_own_delivery: null }))).toBe(true)
  })
})

describe('isOwnDeliveryUndispatched · la marca decide, no el service_type', () => {
  // Es el corazon del fallo: la rama de despacho se activaba por service_type,
  // y una cedida de Just Eat llega como 'own_delivery' porque para Last ES un
  // reparto. Preguntarle al pedido no servia; hay que preguntarle a la marca.
  it('NO hay despacho pendiente si la marca no reparte, aunque venga own_delivery', () => {
    expect(dosCoyotes.service_type).toBe('own_delivery')
    expect(dosCoyotes.carrier_code).toBeNull()
    expect(isOwnDeliveryUndispatched(dosCoyotes)).toBe(false)
    expect(isOwnDeliveryUndispatched(dosCoyotesSinMotivo)).toBe(false)
    expect(isOwnDeliveryUndispatched(smashApagada)).toBe(false)
  })

  // La cautela del encargo (§2.3) y de B70: no apagar la alarma de quien SI
  // reparte y de verdad ha fallado. Si esta se pone verde por accidente, el
  // arreglo se ha comido lo que tenia que conservar.
  it('SIGUE habiendo despacho pendiente en marca que si reparte', () => {
    expect(isOwnDeliveryUndispatched(propiaQueFalla)).toBe(true)
  })

  it('ya despachado (con transportista) no esta pendiente, reparta quien reparta', () => {
    expect(isOwnDeliveryUndispatched(pedido({
      brand_own_delivery: true, carrier_code: 'own_fleet',
    }))).toBe(false)
  })
})

describe('deliveryView · quitar el rojo no puede dejar al cocinero sin saber quien lleva el pedido', () => {
  it('la marca que no reparte cae en la fila tranquila, con el canal de verdad', () => {
    const v = deliveryView(dosCoyotes)
    expect(v.kind).toBe('platform')
    expect(v.carrierLabel).toBe('JustEat')   // tal cual lo escribe Last.app
  })

  it('tambien la propia con el interruptor apagado', () => {
    expect(deliveryView(smashApagada).kind).toBe('platform')
    expect(deliveryView(smashApagada).carrierLabel).toBe('Glovo')
  })

  it('sin canal, la fila no se inventa un nombre', () => {
    const v = deliveryView(pedido({ brand_own_delivery: false, channel: null }))
    expect(v.carrierLabel).toBe('la plataforma')
  })

  // Un pedido de recogida de una cedida no lleva reparto NINGUNO: ni rojo ni
  // fila tranquila. Sin esta condicion, la correccion habria puesto «lo lleva
  // JustEat» en pedidos que el cliente pasa a recoger.
  it('una cedida de RECOGIDA no gana ninguna fila de entrega', () => {
    const recogida = pedido({
      brand_own_delivery: false, service_type: 'takeaway', channel: 'JustEat',
    })
    expect(deliveryView(recogida).kind).toBe('none')
  })

  it('la marca que si reparte y ya tiene transportista sigue en su fila de siempre', () => {
    const v = deliveryView(pedido({ brand_own_delivery: true, carrier_code: 'own_fleet' }))
    expect(v.kind).toBe('own')
  })
})
