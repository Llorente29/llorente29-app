// D01 · Tarea 5 · La foto de una factura, como PDF de una página. Con la foto
// torcida inventada de la prueba de lectura (tests/conta/d01/facturas-inventadas).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encaje, fotoAPdf } from '../../../src/modules/conta/lib/fotoAPdf'

describe('foto → PDF', () => {
  it('una foto vertical llena el ancho con su margen, centrada, sin deformarse', () => {
    const e = encaje(1800, 2400)
    expect(e.orientacion).toBe('vertical')
    expect(e.w / e.h).toBeCloseTo(1800 / 2400, 6)
    expect(e.w).toBeCloseTo(190, 6)
    expect(e.x).toBeCloseTo(10, 6)
    expect(e.y + e.h + e.y).toBeCloseTo(297, 6)
  })
  it('una apaisada va en página apaisada; una alargada la limita el alto', () => {
    expect(encaje(3000, 1000).orientacion).toBe('apaisada')
    const larga = encaje(800, 4000)
    expect(larga.h).toBeCloseTo(277, 6)
    expect(larga.w / larga.h).toBeCloseTo(0.2, 6)
  })
  it('sin tamaño no hay PDF', () => {
    expect(() => encaje(0, 100)).toThrow(/tamaño/)
  })
  it('la foto torcida de la prueba sale como un PDF de una página, de verdad PDF', () => {
    const foto = new Uint8Array(readFileSync('tests/conta/d01/facturas-inventadas/f09-torcida.jpg'))
    const r = fotoAPdf(foto, 'image/jpeg', 1800, 2400)
    expect(new TextDecoder().decode(r.pdf.slice(0, 5))).toBe('%PDF-')
    expect(r.paginas).toBe(1)
    expect(r.pdf.length).toBeGreaterThan(foto.length)
  })
})
