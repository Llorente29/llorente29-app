// tests/unit/modules/conta/r07/facturaDelDia.test.ts
//
// R07 · La ventana «A qué cuenta va cada forma de pago», con la factura del día: el rango de
// tickets, «Clientes de contado» a cero con los dos asientos, desde cuándo y lo que falta
// para guardar. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { desdeDosAsientos, faltaParaGuardar, rangoTickets, saldoContado } from '@/modules/conta/lib/subirTpv'

const L = (debe: number, haber: number, contado = false) => ({ debe, haber, contado })

describe('R07 · El rango de tickets de la factura del día', () => {
  it('de varios, «tickets 5001 a 5048»; de uno, «ticket 5001»; sin rango, nada', () => {
    expect(rangoTickets('5001', '5048')).toBe('tickets 5001 a 5048')
    expect(rangoTickets(5001, 5001)).toBe('ticket 5001')
    expect(rangoTickets(null, null)).toBeNull()
  })
})

describe('R07 · Clientes de contado queda a cero', () => {
  // El día inventado del R05: la factura carga 1.100,00 y el cobro la descarga con caja, tarjeta y dos plataformas.
  const factura = { lineas: [L(1100, 0, true), L(0, 100.01), L(0, 999.99)] }
  const cobro = { lineas: [L(300, 0), L(200, 0), L(180, 0), L(420, 0), L(0, 1100, true)] }
  it('con los dos asientos, a 0,00; con la factura sola, a 1.100,00', () => {
    expect(saldoContado(factura, cobro)).toBe(0)
    expect(saldoContado(factura, null)).toBe(1100)
  })
  it('con céntimos que no suman bien en coma flotante, también a 0,00', () => {
    expect(saldoContado({ lineas: [L(0.1, 0, true), L(0.2, 0, true)] }, { lineas: [L(0, 0.3, true)] })).toBe(0)
  })
  it('cuenta también la línea «sin cuenta» de Clientes de contado', () => {
    expect(saldoContado({ lineas: [{ debe: 50, haber: 0, sin_cuenta: true, forma: 'Clientes de contado' }] })).toBe(50)
  })
})

describe('R07 · Desde cuándo, y lo que falta para guardar', () => {
  it('«Desde el 20/11/2026, cada día va en dos asientos: …»', () => {
    expect(desdeDosAsientos('2026-11-20')).toBe('Desde el 20/11/2026, cada día va en dos asientos: la factura del día y su cobro.')
  })
  it('sin la cuenta de la factura del día, con la misma frase que no deja validar', () => {
    expect(faltaParaGuardar(0, true)).toBe('Falta la cuenta de la factura del día.')
    expect(faltaParaGuardar(1, true)).toBe('Faltan 2 cuentas por elegir, una de ellas la de la factura del día.')
    expect(faltaParaGuardar(2, false)).toBe('Faltan 2 cuentas por elegir.')
    expect(faltaParaGuardar(0, false)).toBeNull()
  })
})

describe('R07 · La lista de cierres enseña los dos asientos', () => {
  it('en dos: «Factura del día nº 5 · cobro nº 6»; en uno, como antes; sin validar, lo dice', async () => {
    const { textoAsientos } = await import('@/modules/conta/lib/cierres')
    expect(textoAsientos({ numeroAsiento: 5, cobro: { id: 'c', numero: 6, estado: 'validado' } })).toBe('Factura del día nº 5 · cobro nº 6')
    expect(textoAsientos({ numeroAsiento: 12345, cobro: null })).toBe('Asiento nº 12.345')
    expect(textoAsientos({ numeroAsiento: null, cobro: { id: 'c', numero: null, estado: 'propuesto' } })).toBe('Factura del día y su cobro, sin validar')
    expect(textoAsientos({ numeroAsiento: null, cobro: null })).toBeNull()
  })
})
