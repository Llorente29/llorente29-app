// tests/unit/modules/reparto/entregaTicket.test.ts
//
// R03 · El bloque «ENTREGA» del ticket de la bolsa. Las formas de dirección son
// las que llegan de verdad (Glovo con «Floor/Door», Uber con «Unit», Glovo sin
// calle con solo el piso), con valores inventados.
import { describe, expect, it } from 'vitest'
import { bloqueEntrega, lineaTelefono, partirDireccion, SIN_DIRECCION } from '@/modules/reparto/lib/entregaTicket'

const propio = { service_type: 'own_delivery', delivery_address: null, customer_phone: null }

describe('partirDireccion', () => {
  it('Glovo: la calle y el número arriba; el piso y la puerta, aparte y en castellano', () => {
    expect(partirDireccion('Calle Inventada, 12, Floor: 4, Door: A, 28000'))
      .toEqual({ calle: 'Calle Inventada, 12, 28000', detalles: 'Piso: 4, Puerta: A' })
  })
  it('Glovo con edificio («Bldg.»): va a los detalles', () => {
    expect(partirDireccion('Calle Inventada, 3, Bldg.: Torre Prueba, Floor: 2, 28000').detalles)
      .toBe('Bldg.: Torre Prueba, Piso: 2')
  })
  it('Uber: «Unit» es «Piso/Puerta», y fuera el «Spain» (Julio, 17/10)', () => {
    expect(partirDireccion('Calle Inventada 46, 28000 Madrid, Spain, Unit: 1C, 28000'))
      .toEqual({ calle: 'Calle Inventada 46, 28000 Madrid, 28000', detalles: 'Piso/Puerta: 1C' })
  })
  it('Glovo sin calle: solo detalles', () => {
    expect(partirDireccion('Floor: 4, Door: A, 28000')).toEqual({ calle: '28000', detalles: 'Piso: 4, Puerta: A' })
  })
  it('vacía: nada', () => {
    expect(partirDireccion(null)).toEqual({ calle: null, detalles: null })
  })
})

describe('lineaTelefono', () => {
  it('con el código de Uber, en la misma línea', () => {
    expect(lineaTelefono('900 000 000', '12345678')).toBe('Tel. 900 000 000 · código 12345678')
  })
  it('sin código, solo el teléfono; sin teléfono, nada', () => {
    expect(lineaTelefono('600000000', null)).toBe('Tel. 600000000')
    expect(lineaTelefono(null, '12345678')).toBeNull()
  })
})

describe('bloqueEntrega', () => {
  it('lo que reparte la plataforma: sin bloque (el ticket no cambia)', () => {
    expect(bloqueEntrega({ ...propio, service_type: 'platform_delivery', delivery_address: 'Calle Inventada, 1' })).toBeNull()
  })
  it('con dirección, teléfono, código, indicaciones y nota', () => {
    expect(bloqueEntrega({
      ...propio, delivery_address: 'Calle Inventada, 12, Floor: 4, Door: A, 28000',
      customer_phone: '900 000 000', customer_phone_code: '12345678',
      delivery_instructions: 'Llamar al timbre 4A', order_customer_note: 'Sin cebolla',
    })).toEqual({
      sinDireccion: false, calle: 'Calle Inventada, 12, 28000', detalles: 'Piso: 4, Puerta: A',
      telefono: 'Tel. 900 000 000 · código 12345678',
      notas: ['Indicaciones: Llamar al timbre 4A', 'Nota del cliente: Sin cebolla'],
    })
  })
  it('la dirección pegada manda sobre la de la plataforma', () => {
    const b = bloqueEntrega({ ...propio, delivery_address: 'Floor: 4, 28000', delivery_address_fixed: 'Calle Pegada de Prueba, 7, Piso 2' })
    expect(b?.calle).toBe('Calle Pegada de Prueba, 7')
    expect(b?.detalles).toBe('Piso 2')
  })
  it('sin dirección: lo dice, y lleva el teléfono', () => {
    const b = bloqueEntrega({ ...propio, customer_phone: '600000000' })
    expect(b).toMatchObject({ sinDireccion: true, telefono: 'Tel. 600000000' })
    expect(SIN_DIRECCION).toBe('SIN DIRECCIÓN · LLAMAR AL CLIENTE')
  })
  it('sin la nota leída aparte, usa customer_note; y no repite la misma nota', () => {
    expect(bloqueEntrega({ ...propio, delivery_address: 'Calle Inventada, 1', customer_note: 'Portal azul' })?.notas)
      .toEqual(['Nota del cliente: Portal azul'])
    expect(bloqueEntrega({ ...propio, delivery_address: 'Calle Inventada, 1', delivery_instructions: 'Portal azul', customer_note: 'Portal azul' })?.notas)
      .toEqual(['Indicaciones: Portal azul'])
  })
})
