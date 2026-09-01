import { describe, it, expect } from 'vitest'
import { lineaDeDiferencia, type CtbDifference } from '../../../src/modules/supply/services/ctbNotifyService'

// Filas REALES de _ctb_receipt_differences_core sobre ALB-00136 (01/09), no un
// caso inventado. Si el texto cambia, estas pruebas dicen exactamente en qué.
// Intl mete un ESPACIO DURO (U+00A0) entre el número y el €. En WhatsApp se ve
// igual, pero no es el mismo byte: sin normalizar, estas pruebas fallan por un
// carácter invisible y se pierde media hora buscando qué cambió en el texto.
const norm = (s: string) => s.replace(/\u00a0/g, ' ')

const d = (p: Partial<CtbDifference>): CtbDifference => ({
  linea: 1, productName: 'X', docQty: 1, qtyReceived: 1, diferencia: 0,
  dimension: 'unit', valorEur: null, motivo: null, clase: 'diferencia', ...p,
})

describe('lineaDeDiferencia — las palabras del almacén', () => {
  it('falta mercancía: dice cuánto y cuánto dinero', () => {
    expect(norm(lineaDeDiferencia(d({
      productName: "SOBRE AMERICANO BIG MIKE'S CAJA 250 UD",
      docQty: 1, qtyReceived: 0, diferencia: -1, valorEur: 46.6,
    })))).toBe("Sobre americano big mike's caja 250 ud — el albarán factura 1 y no ha llegado ninguna (falta 1 · 46,60 €).")
  })

  it('sobra mercancía: lo dice sin inventarse un importe', () => {
    expect(norm(lineaDeDiferencia(d({
      productName: 'SOBRE AMERICANO KDB CAJA 250 UD',
      docQty: 1, qtyReceived: 2, diferencia: 1, valorEur: 40.59,
    })))).toBe('Sobre americano KDB caja 250 ud — el albarán factura 1 y han llegado 2 (1 de más).')
  })

  // Regla 2 del encargo: el motivo escrito a mano SE SUMA, no sustituye. Los
  // números son la verdad; la nota es lo que vio quien recibió.
  it('el motivo escrito a mano va detrás del número, no en su lugar', () => {
    const t = norm(lineaDeDiferencia(d({
      productName: 'X', docQty: 1, qtyReceived: 0, diferencia: -1, valorEur: 46.6,
      motivo: 'cambio oficina: lo dice el albarán',
    })))
    expect(t).toContain('(falta 1 · 46,60 €)')
    expect(t.endsWith('Nota: cambio oficina: lo dice el albarán')).toBe(true)
  })

  it('una nota sin diferencia de cantidad no finge que la haya', () => {
    expect(norm(lineaDeDiferencia(d({
      productName: 'SALSA VINAGRETA', diferencia: 0, clase: 'solo_nota',
      motivo: 'Ni el documento ni la ficha del proveedor dicen el formato.',
    })))).toBe('Salsa vinagreta — cantidad correcta. Nota: Ni el documento ni la ficha del proveedor dicen el formato.')
  })

  it('sin cantidad en el papel lo dice, no se la inventa', () => {
    expect(norm(lineaDeDiferencia(d({
      productName: 'X', docQty: null, diferencia: null, clase: 'no_comparable',
    })))).toBe('X — el albarán no dice cantidad, no se ha podido comparar.')
  })

  // Una sigla no se puede pronunciar: no tiene vocales. KDB se queda; BIG, que
  // por longitud también parecia sigla, baja a minúsculas como la palabra que es.
  it('preserva las siglas y no las palabras cortas', () => {
    expect(norm(lineaDeDiferencia(d({ productName: 'SOBRE KDB BIG CAJA', diferencia: 1, docQty: 1, qtyReceived: 2 }))))
      .toContain('Sobre KDB big caja')
  })

  it('la parcial dice cuántas llegaron, no "ninguna"', () => {
    expect(norm(lineaDeDiferencia(d({ productName: 'X', docQty: 5, qtyReceived: 2, diferencia: -3, valorEur: 12 }))))
      .toBe('X — el albarán factura 5 y han llegado 2 (falta 3 · 12,00 €).')
  })

  it('decimales con coma, como se dicen en voz alta', () => {
    expect(norm(lineaDeDiferencia(d({ productName: 'CEBOLLA', docQty: 3.2, qtyReceived: 3, diferencia: -0.2, valorEur: 0.42 }))))
      .toBe('Cebolla — el albarán factura 3,2 y han llegado 3 (falta 0,2 · 0,42 €).')
  })
})
