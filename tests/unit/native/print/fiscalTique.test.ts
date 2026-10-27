// tests/unit/native/print/fiscalTique.test.ts
//
// V04 · PR 1 · Lo fiscal del tique de la bolsa (maqueta, tableros 1 y 2), con
// los datos de verdad de la semana del 26/10: la propia de Meraki Pita
// (HubRise, «m6y3req») y la cedida de Birria Burrito (Last, Cloudtown, LS53-9214).

import { describe, expect, it } from 'vitest'
import { lineasFiscales } from '@/native/print/fiscalTique'

const pedido = { external_tab_ref: 'm6y3req' }

describe('V04 · lo fiscal del tique de la bolsa', () => {
  it('propia con la serie: una línea con quién factura y el número de la serie', () => {
    expect(lineasFiscales({ legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', address: null, ticketNumber: 'CA26-000123', issuerKind: 'propia', serie: true }, pedido))
      .toEqual({ emisor: 'Llorente29 Food, S.L. · NIF B56496938', direccion: null, numero: 'CA26-000123' })
  })

  it('propia de un local sin código: quién factura, y el número de antes (el del pedido)', () => {
    expect(lineasFiscales({ legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', ticketNumber: null, issuerKind: 'propia', serie: false }, pedido))
      .toEqual({ emisor: 'Llorente29 Food, S.L. · NIF B56496938', direccion: null, numero: 'm6y3req' })
  })

  it('cedida: los datos de Cloudtown de la factura de Last, con su dirección y su número', () => {
    expect(lineasFiscales({ legalName: 'CLOUDTOWN BRANDS SL', taxId: 'B67621425', address: 'Calle de Prueba, 1, 28001 Madrid', ticketNumber: 'LS53-9214', issuerKind: 'cedida' }, pedido))
      .toEqual({ emisor: 'CLOUDTOWN BRANDS SL · NIF B67621425', direccion: 'Calle de Prueba, 1, 28001 Madrid', numero: 'LS53-9214' })
  })

  it('cedida sin la factura de Last: sin la línea de «Factura Simplificada» (nunca se inventa un número)', () => {
    expect(lineasFiscales({ issuerKind: 'cedida', sinFactura: true, ticketNumber: null }, pedido))
      .toEqual({ emisor: null, direccion: null, numero: null })
  })

  it('una base de antes (sin issuerKind) y sin datos: como siempre, el número del pedido', () => {
    expect(lineasFiscales({ legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', address: 'Calle Llorente 29, 28000 Madrid', ticketNumber: null }, pedido))
      .toEqual({ emisor: 'Llorente29 Food, S.L. · NIF B56496938', direccion: null, numero: 'm6y3req' })
    expect(lineasFiscales(undefined, {})).toEqual({ emisor: null, direccion: null, numero: '—' })
  })

  it('la vista previa de uno sin imprimir: el número llega al imprimir', () => {
    expect(lineasFiscales({ legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', issuerKind: 'propia', pendiente: true }, pedido).numero).toBe('al imprimir')
  })
})
