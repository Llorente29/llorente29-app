// tests/unit/modules/conta/k06/reparto.test.ts
//
// K06 · El reparto entre el formulario y el documento (src/modules/conta/nucleo/ficha/reparto.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anchoDelDocumento, guardarReparto, leerReparto, repartoDeSalida } from '@/modules/conta/nucleo/ficha/reparto'

// Sin navegador: un almacén en memoria con la forma de localStorage.
const almacen = new Map<string, string>()
beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = { localStorage: {
    getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => { almacen.set(k, v) }, clear: () => almacen.clear(),
  } }
})

describe('el reparto del panel', () => {
  afterEach(() => { almacen.clear(); delete (globalThis as { window?: unknown }).window })
  it('al abrir: el recordado; si no, la mitad desde 1600 px; por debajo, el de la maqueta (null)', () => {
    expect(repartoDeSalida(0.42, 1366)).toBe(0.42)
    expect(repartoDeSalida(null, 1600)).toBe(0.5)
    expect(repartoDeSalida(null, 1920)).toBe(0.5)
    expect(repartoDeSalida(null, 1599)).toBeNull()
    expect(repartoDeSalida(null, 1456)).toBeNull()
  })
  it('se recuerda por usuario', () => {
    guardarReparto('u1', 0.3)
    expect(leerReparto('u1')).toBe(0.3)
    expect(leerReparto('u2')).toBeNull()
    expect(leerReparto(null)).toBeNull()
  })
  it('sin almacén (navegación privada), no recuerda y no falla', () => {
    ;(globalThis as { window?: unknown }).window = { localStorage: { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } } }
    expect(() => guardarReparto('u1', 0.3)).not.toThrow()
    expect(leerReparto('u1')).toBeNull()
  })
  it('no recuerda lo que no es una parte', () => {
    guardarReparto('u1', 1.5)
    guardarReparto(null, 0.4)
    expect(leerReparto('u1')).toBeNull()
  })
  it('el documento, entre su mínimo y lo que deja el mínimo del formulario', () => {
    expect(anchoDelDocumento(500, 1294, 680)).toBe(500)
    expect(anchoDelDocumento(900, 1294, 680)).toBe(614)
    expect(anchoDelDocumento(100, 1294, 680)).toBe(240)
  })
})
