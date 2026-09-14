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
  elSubtitulo, elTono, loRepartimosConFlota, loRepartelaPlataforma,
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
