// El Pase · cerrar a mano.
//
// Los cuatro motivos son los de Julio (17/09). Lo que se prueba aquí es lo que
// decide si el botón se puede pulsar y lo que se le dice a quien lo pulsa: el
// cierre en sí lo hace la base, por el camino de siempre.

import { describe, it, expect } from 'vitest'
import { MOTIVOS, laConfirmacion, loQueFalta } from '@/modules/pase/lib/elCierreAMano'
import type { TarjetaDelPase } from '@/modules/pase/services/paseService'

const T = (o: Partial<TarjetaDelPase> = {}): TarjetaDelPase => ({
  sale_id: 's1', codigo: 'G740', marca: 'Koreans do it better', marca_logo_url: null,
  cliente: 'Carlos', channel: 'Glovo', source: 'lastapp',
  order_status: 'awaiting_collection', service_type: 'platform_delivery',
  has_courier: null, carrier_code: null, delivery_state: null,
  ready_at: '2026-09-16T20:25:00Z', handed_to_courier_at: null, delivered_at: null,
  lineas: [], bolsa: { estado: 'hecha', cuando: '22:25', intentos: 0 },
  avanzo_por: 'persona', avanzo_quien: null,
  ...o,
})

describe('qué falta para poder cerrar', () => {
  it('sin pedido, lo dice: el botón no se queda gris y callado', () => {
    expect(loQueFalta(null, null, '')).toBe('Elige primero el pedido.')
  })
  it('con pedido y sin motivo, lo dice', () => {
    expect(loQueFalta('s1', null, '')).toBe('Elige por qué se cierra.')
  })
  it('🔴 «Otro» sin texto NO pasa: cuarenta «Otro» al mes no explican nada', () => {
    expect(loQueFalta('s1', 'otro', '  ')).toBe('Escribe el motivo.')
    expect(loQueFalta('s1', 'otro', 'el portal estaba cerrado')).toBeNull()
  })
  it('los otros tres motivos no piden texto', () => {
    for (const m of ['cliente_no_abre', 'rider_no_puede', 'entregado_sin_marcar'] as const) {
      expect(loQueFalta('s1', m, '')).toBeNull()
    }
  })
  it('los motivos son exactamente los cuatro de Julio', () => {
    expect(MOTIVOS.map(m => m.clave)).toEqual(
      ['cliente_no_abre', 'rider_no_puede', 'entregado_sin_marcar', 'otro'])
  })
})

describe('la confirmación, con contenido (regla 8)', () => {
  it('dice QUÉ se cerró y POR QUÉ, no un visto', () => {
    expect(laConfirmacion(T(), 'cliente_no_abre'))
      .toBe('G740 · Koreans do it better cerrado a mano. Motivo: el cliente no abre.')
  })
  it('🔴 si estaba en «En ruta» lo dice: cerrar algo que iba de camino no es lo mismo', () => {
    const enRuta = T({ handed_to_courier_at: '2026-09-16T20:41:00Z',
                       source: 'hubrise', channel: 'Uber' })
    expect(laConfirmacion(enRuta, 'rider_no_puede')).toContain('Estaba en «En ruta».')
  })
  it('sin la tarjeta delante sigue diciendo algo, no revienta', () => {
    expect(laConfirmacion(undefined, 'otro')).toBe('El pedido cerrado a mano. Motivo: otro.')
  })
})
