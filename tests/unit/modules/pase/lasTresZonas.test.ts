// El Pase · las tres zonas.
//
// LAS FILAS SON REALES (regla 31). Salen de una consulta sobre `sale` de los
// últimos 90 días de Foodint, agrupando por
// (order_status, delivery_state, delivered_at is not null). No hay ni un caso
// inventado: los cuatro que rompieron mi primer diseño están abajo con su
// número de ocurrencias.

import { describe, it, expect } from 'vitest'
import {
  laSituacion, laZona, tieneBotonDeListo, loQuePasa, loQueNoSabemos,
  elSubtitulo, elTono, losMinutos, loRepartimosConFlota, loRepartelaPlataforma,
  quienLoLleva, esRecogida,
  type PedidoDelPase,
} from '@/modules/pase/lib/lasTresZonas'

const P = (o: Partial<PedidoDelPase> = {}): PedidoDelPase => ({
  sale_id: 's1',
  order_status: 'in_preparation',
  service_type: 'own_delivery',
  has_courier: true,
  carrier_code: 'catcher',
  delivery_state: null,
  ready_at: null,
  handed_to_courier_at: null,
  delivered_at: null,
  channel: 'Glovo',
  ...o,
})

describe('las tres zonas · el camino bueno', () => {
  it('sin sello de cocina: sigue aquí, por marcar, y ES el único con botón', () => {
    const p = P()
    expect(laSituacion(p)).toBe('por_marcar')
    expect(laZona(p)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(p)).toBe(true)
  })

  it('marcado y con flota, pero sin salir: sigue aquí y YA no se pulsa nada', () => {
    const p = P({ ready_at: '2026-09-14T19:29:00Z', order_status: 'awaiting_collection' })
    expect(laSituacion(p)).toBe('listo_sin_salir')
    expect(laZona(p)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(p)).toBe(false)
  })

  it('la flota dice que salió: En ruta (629 entregados de 90 días vienen por aquí)', () => {
    const p = P({ ready_at: '2026-09-14T19:29:00Z', delivery_state: 'in_delivery' })
    expect(laSituacion(p)).toBe('en_ruta')
    expect(laZona(p)).toBe('en_ruta')
    expect(loQuePasa(p, 12)).toBe('Salió hace 12 min')
    expect(elTono(p, 12)).toBe('bien')
    expect(elTono(p, 34)).toBe('aviso')   // ámbar, sin rojos ni sonidos
  })

  it('la flota dice que llegó: Entregados', () => {
    const p = P({ ready_at: 'x', delivery_state: 'delivered', delivered_at: 'y',
                  order_status: 'completed' })
    expect(laZona(p)).toBe('entregados')
  })
})

describe('🔴 las cuatro filas reales que rompieron el primer diseño', () => {
  it('(3 casos) CANCELADO con el reparto «delivered» y sellado NO es «Entregados»', () => {
    // order_status=cancelled · delivery_state=delivered · delivered_at sellado.
    // Mi primera versión lo mandaba a «Entregados». Un pedido cancelado no está
    // entregado: no se pinta en ninguna zona.
    const p = P({ order_status: 'cancelled', delivery_state: 'delivered', delivered_at: 'y' })
    expect(laZona(p)).toBeNull()
  })

  it('(41 casos) «delivered» SIN `delivered_at`: se cuenta igual como llegado', () => {
    // El sello sólo escribe cuando el estado CAMBIA, así que una fila que nace
    // ya entregada no lo lleva. Preguntando sólo por el sello se pierden 41.
    const p = P({ order_status: 'completed', delivery_state: 'delivered', delivered_at: null })
    expect(laSituacion(p)).toBe('entregado')
    expect(laZona(p)).toBe('entregados')
  })

  it('(1 caso) CERRADO pero la flota dice «in_delivery»: En ruta, no desaparece', () => {
    // Ésta es la avería del encargo en una sola fila: se cerró antes de
    // entregarse. La tarjeta tiene que seguir viéndose donde está la comida.
    const p = P({ order_status: 'completed', ready_at: 'x', delivery_state: 'in_delivery' })
    expect(laZona(p)).toBe('en_ruta')
  })

  it('(4 casos) reparto FALLIDO no se queda en «Sigue aquí» como si faltara marcarlo', () => {
    const p = P({ order_status: 'delivery_failed', delivery_state: 'failed' })
    expect(laZona(p)).toBeNull()
    expect(tieneBotonDeListo(p)).toBe(false)
  })

  it('(23 casos) `order_status` en null no revienta ni esconde la tarjeta', () => {
    const p = P({ order_status: null })
    expect(laZona(p)).toBe('sigue_aqui')
  })
})

describe('la plataforma: se enseña, no se gestiona', () => {
  const glovo = P({ service_type: 'platform_delivery', has_courier: false,
                    carrier_code: null, ready_at: '2026-09-14T19:29:00Z',
                    order_status: 'awaiting_collection', channel: 'Glovo' })

  it('marcada, se queda en «Sigue aquí»: la comida sigue en el local', () => {
    expect(loRepartelaPlataforma(glovo)).toBe(true)
    expect(loRepartimosConFlota(glovo)).toBe(false)
    expect(laSituacion(glovo)).toBe('esperando_rider_plataforma')
    expect(laZona(glovo)).toBe('sigue_aqui')
  })

  it('🔴 y NUNCA pasa por «En ruta» ni por «Entregados»', () => {
    // Al cerrarse la comanda desaparece, sin pintar que llegó: ese `completed`
    // lo escribe `lastapp-webhook` al cerrar caja, mediana 6,4 min desde el
    // «Listo» en Glovo. No es Glovo diciendo que el cliente lo tiene.
    expect(laZona({ ...glovo, order_status: 'completed' })).toBeNull()
  })

  it('dice con esas palabras lo que no sabemos', () => {
    expect(loQuePasa(glovo, null)).toBe('Esperando al rider de Glovo')
    expect(loQueNoSabemos(glovo)).toContain('no nos dice cuándo sale ni cuándo llega')
    expect(loQueNoSabemos(glovo)).toContain('se cierre la comanda en caja')
    expect(loQueNoSabemos(glovo)).not.toContain('entregado')
    expect(elSubtitulo(glovo)).toBe('Glovo · lo reparte Glovo')
  })

  it('y con Uber lo dice con el nombre de Uber, no con uno genérico', () => {
    const uber = { ...glovo, channel: 'Uber' }
    expect(loQuePasa(uber, null)).toBe('Esperando al rider de Uber')
    expect(loQueNoSabemos(uber)).toContain('Uber no nos dice')
  })
})

describe('el propio SIN flota: envejece a la vista y no se toca', () => {
  const sinFlota = P({ has_courier: false, carrier_code: null,
                       ready_at: '2026-09-14T19:16:00Z', order_status: 'awaiting_collection',
                       channel: 'Tienda' })

  it('se queda en «Sigue aquí» con su crono', () => {
    expect(laSituacion(sinFlota)).toBe('esperando_que_lo_cojan')
    expect(laZona(sinFlota)).toBe('sigue_aqui')
    expect(loQuePasa(sinFlota, 18)).toBe('Esperando a que alguien lo coja · 18 min')
    expect(elTono(sinFlota, 18)).toBe('aviso')
    expect(elTono(sinFlota, 5)).toBe('neutro')
  })

  it('y dice que aquí no se toca: lo marca quien se lo lleve', () => {
    expect(loQueNoSabemos(sinFlota)).toContain('desde su móvil')
    expect(tieneBotonDeListo(sinFlota)).toBe(false)
    expect(elSubtitulo(sinFlota)).toBe('Tienda · lo lleva alguien de casa')
  })
})

describe('🔴 en toda la pantalla sólo se pulsa UNA cosa', () => {
  it('el botón sale exactamente en una situación, y en ninguna otra', () => {
    const casos: PedidoDelPase[] = [
      P(),                                                                   // por marcar
      P({ ready_at: 'x', order_status: 'awaiting_collection' }),              // listo sin salir
      P({ ready_at: 'x', delivery_state: 'in_delivery' }),                    // en ruta
      P({ ready_at: 'x', delivery_state: 'delivered', order_status: 'completed' }),
      P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null, ready_at: 'x' }),
      P({ has_courier: false, carrier_code: null, ready_at: 'x' }),
      P({ order_status: 'cancelled' }),
      P({ order_status: 'delivery_failed', delivery_state: 'failed' }),
    ]
    expect(casos.filter(tieneBotonDeListo)).toHaveLength(1)
  })
})

describe('🔴 desde cuándo se cuenta: cada zona mira un reloj distinto', () => {
  const AHORA = new Date('2026-09-14T20:00:00Z')
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString()

  it('por marcar: desde que ENTRÓ el pedido', () => {
    expect(losMinutos(P({ entro_at: hace(7) }), AHORA)).toBe(7)
  })

  it('esperando a que lo cojan: desde el SELLO, no desde que entró', () => {
    const p = P({ has_courier: false, carrier_code: null,
                  entro_at: hace(40), ready_at: hace(18) })
    expect(losMinutos(p, AHORA)).toBe(18)
  })

  it('en ruta: desde el HANDOFF cuando lo hay', () => {
    const p = P({ ready_at: hace(30), handed_to_courier_at: hace(12),
                  delivery_state: 'in_delivery' })
    expect(losMinutos(p, AHORA)).toBe(12)
  })

  it('🔴 y en ruta SIN handoff cae al sello: Catcher casi nunca lo manda', () => {
    // Medido: de 250 repartos propios de 14 días, 226 tienen handoff y 229
    // entrega. Sin este respaldo, 24 tarjetas se quedarían sin crono.
    const p = P({ ready_at: hace(30), handed_to_courier_at: null,
                  delivery_state: 'in_delivery' })
    expect(losMinutos(p, AHORA)).toBe(30)
  })

  it('entregado: desde la ENTREGA', () => {
    const p = P({ ready_at: hace(60), delivery_state: 'delivered',
                  delivered_at: hace(4), order_status: 'completed' })
    expect(losMinutos(p, AHORA)).toBe(4)
  })

  it('y sin instante que mirar devuelve null, no un cero que parece medido', () => {
    // Regla 32: un «no lo sé» no se disfraza de valor.
    expect(losMinutos(P({ entro_at: null }), AHORA)).toBeNull()
  })
})

// ── QUIÉN LO LLEVA ────────────────────────────────────────────────────────
//
// Los cinco casos son los MEDIDOS hoy sobre 14 días de Foodint (1.681 ventas).
// El reparto exacto está en el comentario de `quienLoLleva`.

describe('quién lo lleva · los cinco casos de la población real', () => {
  it('(231) propio con flota: dice el nombre y trae el teléfono del repartidor', () => {
    const q = quienLoLleva(P({ repartidor_nombre: 'Marta', repartidor_telefono: '+34600111222' }))
    expect(q.texto).toBe('Nuestro · Marta')
    expect(q.telefono).toBe('+34600111222')
    expect(q.esAviso).toBe(false)
  })

  it('(1.424) plataforma: dice quién reparte y NO se inventa repartidor', () => {
    const q = quienLoLleva(P({ service_type: 'platform_delivery', has_courier: false,
                               carrier_code: null, channel: 'Uber' }))
    expect(q.texto).toBe('Lo reparte Uber')
    expect(q.nombre).toBeNull()
    expect(q.telefono).toBeNull()
  })

  it('🔴 (14) propio y sin coger: es un AVISO, no un hueco', () => {
    // Comida nuestra, reparto nuestro y nadie asignado. El pase tiene que
    // saberlo antes de que llame el cliente.
    const q = quienLoLleva(P({ has_courier: false, carrier_code: null,
                               repartidor_nombre: null, repartidor_telefono: null }))
    expect(q.texto).toBe('Nuestro, y todavía no lo ha cogido nadie')
    expect(q.esAviso).toBe(true)
  })

  it('(12) recogida: lo recoge el cliente, y no hay repartidor a quien llamar', () => {
    const q = quienLoLleva(P({ service_type: 'pickup', has_courier: false, carrier_code: null }))
    expect(q.texto).toBe('Lo recoge el cliente')
    expect(q.telefono).toBeNull()
    expect(q.esAviso).toBe(false)
  })

  it('(0 hoy) con flota y sin nombre: dice lo que sabe, no se queda en blanco', () => {
    const q = quienLoLleva(P({ repartidor_nombre: null }))
    expect(q.texto).toBe('Nuestro, ya asignado')
  })

  it('🔴 REGLA 32 · nunca en blanco, en ninguna combinación', () => {
    const casos: PedidoDelPase[] = [
      P(),
      P({ service_type: 'platform_delivery', has_courier: false, carrier_code: null }),
      P({ service_type: 'platform_delivery', channel: null, has_courier: false, carrier_code: null }),
      P({ service_type: 'pickup', has_courier: false, carrier_code: null }),
      P({ has_courier: false, carrier_code: null }),
      P({ service_type: null, has_courier: false, carrier_code: null }),
      P({ service_type: 'algo_que_no_existe', has_courier: false, carrier_code: null }),
      P({ repartidor_nombre: '   ' }),
    ]
    for (const c of casos) expect(quienLoLleva(c).texto.trim()).not.toBe('')
  })

  it('y el cuarto valor que no existe hoy dice que no lo sabemos', () => {
    // En 90 días `service_type` sólo vale platform_delivery, own_delivery o
    // pickup, y nunca null. El día que entre un cuarto, esto no inventa nada.
    const q = quienLoLleva(P({ service_type: 'catering', has_courier: false, carrier_code: null }))
    expect(q.texto).toBe('No sabemos quién lo lleva')
    expect(q.esAviso).toBe(true)
  })
})

describe('🔴 la recogida: 12 tarjetas que decían algo que no pasa', () => {
  const recogida = P({ service_type: 'pickup', has_courier: false, carrier_code: null,
                       ready_at: '2026-09-14T19:16:00Z', order_status: 'awaiting_collection',
                       channel: 'Uber' })

  it('marcada, se queda en «Sigue aquí» con su propia situación', () => {
    expect(esRecogida(recogida)).toBe(true)
    expect(laSituacion(recogida)).toBe('lo_recoge_el_cliente')
    expect(laZona(recogida)).toBe('sigue_aqui')
    expect(tieneBotonDeListo(recogida)).toBe(false)
  })

  it('y NO dice «lo marca quien se lo lleve desde su móvil»: el cliente no tiene app', () => {
    expect(loQuePasa(recogida, 8)).toBe('Listo, esperando a que lo recojan · 8 min')
    expect(loQueNoSabemos(recogida)).toContain('Viene el cliente a por ello')
    expect(loQueNoSabemos(recogida)).not.toContain('su móvil')
    expect(elSubtitulo(recogida)).toBe('Uber · lo recoge el cliente')
  })

  it('se va al cerrarse la comanda, sin pintar que llegó (0 de 63 tienen entrega)', () => {
    // Medido en 90 días: las 63 recogidas sin `delivery_state` y sin
    // `delivered_at`. Nadie las marca nunca.
    expect(laZona({ ...recogida, order_status: 'completed' })).toBeNull()
  })

  it('sin marcar sigue siendo «por marcar», y ése sí tiene botón', () => {
    expect(tieneBotonDeListo({ ...recogida, ready_at: null })).toBe(true)
  })
})
