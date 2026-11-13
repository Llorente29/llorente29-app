// tests/conta/s01p/liquidacionRepetida.test.ts
//
// S01p·21 · Lo que dice Impuestos › Trimestre de una liquidación de IVA apuntada dos veces:
// por decidir (las dos, «Dejar solo esta») y resuelta (cuál se dejó y el contraasiento de la otra,
// con su fecha). Con números inventados con la forma de los de Foodint (4/… y 9/…).
import { describe, expect, it } from 'vitest'
import { estadoLiquidacion, fraseRepetida, lineaLiquidacion, quedaPorDecidir, type LiquidacionRepetida } from '@/modules/conta/impuestos/liquidacionRepetida'

const liq = (o: Partial<LiquidacionRepetida>): LiquidacionRepetida => ({
  asiento: 'a', serie: 4, numero: 1, fecha: '2026-06-30', concepto: 'Liquidación I.V.A. Trimestre 2', importe: 21, traida: true,
  enlazada: false, repetida: false, contraasiento: null, contra_serie: null, contra_numero: null, contra_fecha: null, ...o,
})

describe('S01p·21 · la liquidación apuntada dos veces', () => {
  it('por decidir: las dos, con su línea, y la frase dice qué hará «Dejar solo esta»', () => {
    const xs = [liq({ asiento: 'a' }), liq({ asiento: 'b', serie: 9, numero: 3 })]
    expect(quedaPorDecidir(xs)).toBe(true)
    expect(lineaLiquidacion(xs[0])).toBe('4/1 · 30/06/2026 · traída de Diez · Liquidación I.V.A. Trimestre 2 · 477 21,00 €')
    expect(estadoLiquidacion(xs[0])).toBeNull()
    expect(fraseRepetida(xs)).toBe('Este trimestre tiene la liquidación de IVA apuntada dos veces, con los mismos apuntes. Deja solo una: el 303 queda con ella y la otra queda sin efecto con un contraasiento en el primer día abierto. Ningún libro de IVA cambia.')
  })
  it('resuelta: cuál se dejó, y la otra sin efecto con su contraasiento y su fecha', () => {
    const xs = [liq({ asiento: 'a', enlazada: true }), liq({ asiento: 'b', serie: 9, numero: 3, repetida: true, contraasiento: 'c', contra_serie: 9, contra_numero: 7, contra_fecha: '2026-10-01' })]
    expect(quedaPorDecidir(xs)).toBe(false)
    expect(estadoLiquidacion(xs[0])).toBe('La del 303')
    expect(estadoLiquidacion(xs[1])).toBe('Sin efecto: contraasiento 9/7 del 01/10/2026')
    expect(fraseRepetida(xs)).toBe('Resuelta: se deja la 4/1; la 9/3 con el contraasiento 9/7 del 01/10/2026 queda sin efecto. Ningún libro de IVA cambió.')
  })
  it('una sola, o una enlazada con la otra aún sin contraasiento: lo que toca', () => {
    expect(quedaPorDecidir([liq({})])).toBe(false)
    expect(quedaPorDecidir([liq({ enlazada: true }), liq({ asiento: 'b' })])).toBe(true)
  })
})
