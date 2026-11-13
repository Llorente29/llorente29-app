// tests/conta/s01p/meLoFacturaOtro.test.ts
//
// S01p·20·2 · «Me lo factura otro»: la opción de la ficha y lo que dice «Qué está esperando
// factura» de la recepción de un proveedor al que se lo factura otro (la frase es la misma que
// guarda la base en su camino: «Lo factura <otro> en su factura de género.»). Nombres inventados.
import { describe, expect, it } from 'vitest'
import { FORMAS, FORMA_OTRO, esperaEnPalabras, fraseLoFactura, tituloForma } from '@/modules/conta/lib/compras'

describe('S01p·20·2 · me lo factura otro', () => {
  it('es una opción más, aparte de las tres de la ficha (las preguntas de «Qué tienes que mirar» solo ofrecen esas)', () => {
    expect(FORMA_OTRO.titulo).toBe('Me lo factura otro')
    expect(FORMAS.map((f) => f.valor)).toEqual(['per_delivery', 'delivery_note_then_invoice', 'monthly_settlement'])
    expect(tituloForma(FORMA_OTRO.valor)).toBeNull()
  })
  it('la frase de su recepción, la de la base', () => {
    expect(fraseLoFactura('Mercados del Norte')).toBe('Lo factura Mercados del Norte en su factura de género.')
  })
  it('en «Qué está esperando factura» dice quién lo factura, no que liquide él', () => {
    const a = { supplier_name: 'Hermanos Ruiz', camino: 'liquidacion', forma: null, llegada: null, dias: 9, espera_hasta: '2026-12-10', retrasado: false }
    expect(esperaEnPalabras({ ...a, lo_factura: 'Mercados del Norte' }).porque).toBe('Lo factura Mercados del Norte en su factura de género.')
    // Sin quien se lo facture, como antes.
    expect(esperaEnPalabras(a).porque).toBe('Hermanos Ruiz liquida cada mes: su factura del mes llega a primeros del siguiente.')
  })
})
