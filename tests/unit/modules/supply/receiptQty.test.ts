// Cantidad recibida por línea de albarán.
//
// Estos casos salen del albarán REAL que rompió el 20/08: AV260644360 de
// BIDFOOD, sesión c7494b99-205a-43f9-914b-6f556fa1fce6, 19 líneas.

import { describe, it, expect } from 'vitest'
import { deriveFormatQty } from '@/modules/supply/lib/receiptQty'

describe('deriveFormatQty · el albarán cuenta en SU formato', () => {
  it('1 garrafa de 25 L se recibe como 1 garrafa, no como 1/25', () => {
    // ACEITE GIRASOL 25 LT · quantity 1, unit "ud", base litros
    expect(deriveFormatQty(1, null, 25, 'ud', 'l')).toEqual({ qty: 1, source: 'albaran' })
  })

  it('3 cajas de 6 ud se reciben como 3 cajas — ESTE es el fallo del 20/08', () => {
    // Antes: 3/6 = 0,5 -> Math.max(1, round(0,5)) = 1. "Siempre sale 1".
    expect(deriveFormatQty(3, null, 6, 'caja', 'ud')).toEqual({ qty: 3, source: 'albaran' })
  })

  it('2 garrafas de 25 L se reciben como 2, no como 1', () => {
    expect(deriveFormatQty(2, null, 25, 'ud', 'l')).toEqual({ qty: 2, source: 'albaran' })
  })

  it('1 caja de 4,8 kg se recibe como 1 caja', () => {
    // BACON CRISPY · quantity 1, unit "caja", base kg
    expect(deriveFormatQty(1, null, 4.8, 'caja', 'kg')).toEqual({ qty: 1, source: 'albaran' })
  })
})

describe('deriveFormatQty · el albarán cuenta en unidad BASE', () => {
  it('3 kg con formato de 1 kg son 3', () => {
    // CEBOLLA ROJA · quantity 3, unit "kg", formato Kilogramo
    expect(deriveFormatQty(3, null, 1, 'kg', 'kg')).toEqual({ qty: 3, source: 'albaran' })
  })

  it('12 ud con cajas de 6 ud son 2 cajas, y la cuenta es exacta', () => {
    expect(deriveFormatQty(12, null, 6, 'ud', 'ud')).toEqual({ qty: 2, source: 'division' })
  })

  it('13 ud con cajas de 6 ud sugiere 2 pero avisa de que no es exacto', () => {
    expect(deriveFormatQty(13, null, 6, 'ud', 'ud')).toEqual({ qty: 2, source: 'inexact' })
  })

  it('menos de un pack entero sugiere 1 pero NUNCA en silencio', () => {
    const r = deriveFormatQty(2, null, 6, 'ud', 'ud')
    expect(r).toEqual({ qty: 1, source: 'inexact' })
  })

  it('la unidad se compara sin distinguir mayúsculas ni espacios', () => {
    expect(deriveFormatQty(12, null, 6, ' KG ', 'kg')).toEqual({ qty: 2, source: 'division' })
  })
})

describe('deriveFormatQty · precedencias y bordes', () => {
  it('la columna de bultos manda sobre todo lo demás', () => {
    expect(deriveFormatQty(48, 4, 12, 'ud', 'ud')).toEqual({ qty: 4, source: 'packages' })
  })

  it('sin formato con el que contar, no inventa nada', () => {
    expect(deriveFormatQty(3, null, null, 'caja', 'ud')).toBeNull()
    expect(deriveFormatQty(3, null, 0, 'caja', 'ud')).toBeNull()
  })

  it('sin cantidad, no inventa nada', () => {
    expect(deriveFormatQty(null, null, 6, 'caja', 'ud')).toBeNull()
    expect(deriveFormatQty(0, null, 6, 'caja', 'ud')).toBeNull()
  })

  it('unidad del albarán vacía: se toma tal cual, no se divide a ciegas', () => {
    expect(deriveFormatQty(3, null, 6, null, 'ud')).toEqual({ qty: 3, source: 'albaran' })
  })
})
