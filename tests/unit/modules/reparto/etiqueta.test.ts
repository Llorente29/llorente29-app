// R02 · La etiqueta de reparto: tres estados y nunca rojo. Los casos son los
// del informe de comprobaciones previas (docs/reparto/R02_comprobaciones_previas.md
// §4–§6), con la forma real del feed: el 431 de Scandal en Glovo (propio, sin
// dirección), un Uber que reparte Uber, un Glovo propio despachado a Catcher.
import { describe, expect, it } from 'vitest'
import { etiquetaDeReparto, plataformaCorta, type PedidoParaEtiqueta } from '@/modules/reparto/lib/etiqueta'

const base: PedidoParaEtiqueta = {
  service_type: 'own_delivery', delivery_address: 'Calle 1', channel: 'Glovo', carrier_code: null,
  has_courier: null, rider_name: null, delivery_state: null, dispatch_mode: 'auto', dispatch_error: null,
}

describe('la etiqueta de reparto', () => {
  it('la reparte la plataforma: gris, sin acciones', () => {
    expect(etiquetaDeReparto({ ...base, service_type: 'platform_delivery', channel: 'Uber', delivery_address: null }))
      .toEqual({ tono: 'gris', texto: 'La reparte Uber', detalle: 'nada que hacer', acciones: [] })
  })
  it('el 431 (Scandal · Glovo, propio sin dirección): ámbar con sus dos acciones, aunque traiga el error del vigía', () => {
    const e = etiquetaDeReparto({ ...base, delivery_address: null,
      dispatch_error: 'No se despachó: sin dirección de entrega: la plataforma no la ha enviado' })
    expect(e).toEqual({ tono: 'ambar', texto: 'Nosotros · falta la dirección', detalle: 'La dirección no ha llegado',
      acciones: ['pedir_direccion', 'cambiar_a_plataforma'] })
  })
  it('propio con rider asignado: verde', () => {
    expect(etiquetaDeReparto({ ...base, carrier_code: 'catcher', has_courier: true, rider_name: 'Ana' }))
      .toMatchObject({ tono: 'verde', texto: 'Nosotros · rider asignado', detalle: 'Catcher · Ana' })
  })
  it('propio con dirección que no ha salido: ámbar con «Despachar» (y sin él en modo off)', () => {
    expect(etiquetaDeReparto({ ...base, dispatch_error: 'No se pudo enviar a Catcher: 500' }))
      .toMatchObject({ tono: 'ambar', texto: 'Nosotros · aún sin rider', detalle: 'no ha salido: 500', acciones: ['despachar'] })
    expect(etiquetaDeReparto({ ...base, dispatch_mode: 'off' })?.acciones).toEqual([])
  })
  it('nunca rojo, en ningún estado', () => {
    const casos: PedidoParaEtiqueta[] = [
      { ...base }, { ...base, delivery_address: null }, { ...base, service_type: 'platform_delivery' },
      { ...base, carrier_code: 'catcher' }, { ...base, delivery_state: 'failed', carrier_code: 'catcher' },
      { ...base, delivery_state: 'delivered', carrier_code: 'catcher' }, { ...base, dispatch_error: 'x' },
    ]
    for (const c of casos) expect(['gris', 'verde', 'ambar', 'azul']).toContain(etiquetaDeReparto(c)?.tono)
  })
  it('recogida o en local: sin etiqueta', () => {
    expect(etiquetaDeReparto({ ...base, service_type: 'pickup' })).toBeNull()
    expect(etiquetaDeReparto({ ...base, service_type: null })).toBeNull()
  })
  it('el nombre corto de la plataforma', () => {
    expect(['Uber Eats', 'Glovo', 'JustEat', 'Just Eat', null].map(plataformaCorta))
      .toEqual(['Uber', 'Glovo', 'Just Eat', 'Just Eat', 'la plataforma'])
  })
  it('R03: Uber sin calle, fuera de zona: la reparte Uber, gris y sin acciones', () => {
    expect(etiquetaDeReparto({ ...base, channel: 'Uber Eats', service_type: 'platform_delivery', delivery_address: null, delivery_by_reason: 'fuera_de_zona' }))
      .toEqual({ tono: 'gris', texto: 'La reparte Uber · fuera de zona', detalle: 'nada que hacer', acciones: [] })
  })
  it('R03: Uber decidido «lo reparte Uber»: igual que fuera de zona', () => {
    expect(etiquetaDeReparto({ ...base, channel: 'Uber Eats', service_type: 'platform_delivery', delivery_by_reason: 'decidido_uber' })?.texto)
      .toBe('La reparte Uber · fuera de zona')
  })
  it('R03: Uber con señales mezcladas: ámbar, sin botones (se decide en el aviso)', () => {
    expect(etiquetaDeReparto({ ...base, channel: 'Uber Eats', service_type: 'own_delivery', delivery_address: 'Calle Inventada 1', delivery_by_reason: 'uber_decidir' }))
      .toEqual({ tono: 'ambar', texto: 'Nosotros · falta decidir quién reparte', detalle: 'decídelo en el aviso rojo', acciones: [] })
  })
})
