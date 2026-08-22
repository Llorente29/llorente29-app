// El texto de la reclamación — ENCARGO CODE 21/08 §3.3.
// Lo compone el sistema, no el usuario: el operario revisa y envía, no redacta.
// Los datos son los REALES de PED-00042.
import { describe, it, expect } from 'vitest'
import {
  buildOrderClaimMessage, shortCloseTargetStatus,
  type OrderShortfallLine,
} from '@/modules/supply/services/purchaseOrderService'

const linea = (o: Partial<OrderShortfallLine>): OrderShortfallLine => ({
  lineId: 'l1', productName: 'X', recipeItemId: null, formatName: null,
  qtyOrdered: 1, qtyReceived: 0, qtyMissing: 1, position: 0, ...o,
})

const FALTAN: OrderShortfallLine[] = [
  linea({ lineId: 'a', productName: 'Queso Mozarela', formatName: 'Paquete', qtyOrdered: 10, qtyReceived: 3, qtyMissing: 7 }),
  linea({ lineId: 'b', productName: 'Bolsa Marrón Grande 25x15x43,5', formatName: 'Caja', qtyOrdered: 2, qtyReceived: 0, qtyMissing: 2 }),
  linea({ lineId: 'c', productName: 'Bolsas Personalizadas Big Mikes', formatName: 'Caja', qtyOrdered: 1, qtyReceived: 0, qtyMissing: 1 }),
  linea({ lineId: 'd', productName: 'Salsero Pp 120 Cc con Tapa', formatName: 'Paquete', qtyOrdered: 1, qtyReceived: 0, qtyMissing: 1 }),
]

const BASE = {
  orderCode: 'PED-00042',
  supplierName: 'CLOUDTOWN, S.L.',
  locationName: 'Foodint Alcalá',
  expectedDate: '2026-08-18',
}

describe('buildOrderClaimMessage', () => {
  it('dice artículo, pedido, recibido y falta — el caso real de PED-00042', () => {
    const msg = buildOrderClaimMessage({ ...BASE, faltan: FALTAN })
    expect(msg).toContain('PED-00042')
    expect(msg).toContain('CLOUDTOWN, S.L.')
    expect(msg).toContain('Foodint Alcalá')
    expect(msg).toContain('Faltan 4 artículos:')
    expect(msg).toContain('Queso Mozarela: pedidas 10 Paquete, recibidas 3 → faltan 7')
    expect(msg).toContain('Bolsa Marrón Grande 25x15x43,5: pedidas 2 Caja, recibidas 0 → faltan 2')
  })

  it('la fecha sale en formato español, no ISO', () => {
    expect(buildOrderClaimMessage({ ...BASE, faltan: FALTAN })).toContain('18/08/2026')
  })

  it('NO se inventa una fecha cuando no la hay', () => {
    const msg = buildOrderClaimMessage({ ...BASE, expectedDate: null, faltan: FALTAN })
    expect(msg).toContain('entrega prevista —')
    expect(msg).not.toContain('Invalid')
    expect(msg).not.toContain('NaN')
  })

  it('con un solo artículo habla en singular', () => {
    const msg = buildOrderClaimMessage({ ...BASE, faltan: [FALTAN[3]] })
    expect(msg).toContain('Falta 1 artículo:')
  })

  it('aguanta un pedido sin proveedor ni local sin dejar líneas vacías', () => {
    const msg = buildOrderClaimMessage({ ...BASE, supplierName: null, locationName: null, faltan: FALTAN })
    expect(msg).not.toContain('Proveedor:')
    expect(msg).not.toContain('Local:')
    expect(msg.split('\n').filter(l => l === ' ')).toHaveLength(0)
  })

  it('las cantidades fraccionadas no salen con 14 decimales', () => {
    const msg = buildOrderClaimMessage({
      ...BASE,
      faltan: [linea({ productName: 'Aceite', qtyOrdered: 1, qtyReceived: 0.1 + 0.2, qtyMissing: 1 - (0.1 + 0.2) })],
    })
    expect(msg).not.toMatch(/\d\.\d{6,}/)
    expect(msg).toContain('recibidas 0,3')
  })
})

describe('shortCloseTargetStatus — cerrado vs cancelado (§4)', () => {
  it('recibido_parcial siempre va a cerrado: algo llegó', () => {
    expect(shortCloseTargetStatus('recibido_parcial')).toBe('cerrado')
    expect(shortCloseTargetStatus('recibido_parcial', false)).toBe('cerrado')
  })

  it('enviado SIN nada recibido va a cancelado: el pedido no ocurrió', () => {
    expect(shortCloseTargetStatus('enviado', false)).toBe('cancelado')
  })

  it('enviado CON algo recibido va a cerrado, no a cancelado', () => {
    // Es el caso que fabricó 8 de los 41 «cancelado» con el motivo «Otro»:
    // la mercancía había llegado y el pedido seguía en 'enviado'.
    expect(shortCloseTargetStatus('enviado', true)).toBe('cerrado')
  })

  it('los estados terminales no admiten cierre corto', () => {
    for (const st of ['borrador', 'recibido', 'cerrado', 'cancelado'] as const) {
      expect(shortCloseTargetStatus(st, true)).toBeNull()
      expect(shortCloseTargetStatus(st, false)).toBeNull()
    }
  })
})
