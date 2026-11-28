import { describe, expect, it } from 'vitest'
import { buscarPorCodigoYNombre, cuadreDeTramos, elegidoPorCodigo, filasDeIva } from '@/modules/conta/nucleo/recibida/k13'

describe('K13 · las filas del IVA crecen', () => {
  it('empieza con dos filas (cuatro huecos)', () => {
    expect(filasDeIva(0)).toBe(2)
    expect(filasDeIva(1)).toBe(2)
    expect(filasDeIva(2)).toBe(2)
    expect(filasDeIva(3)).toBe(2)
  })
  it('al usar el último hueco libre sale otra fila vacía, sin límite', () => {
    expect(filasDeIva(4)).toBe(3)
    expect(filasDeIva(5)).toBe(3)
    expect(filasDeIva(6)).toBe(4)
    expect(filasDeIva(11)).toBe(6)
    // Siempre queda al menos un hueco libre.
    for (let n = 0; n < 30; n++) expect(filasDeIva(n) * 2).toBeGreaterThan(n)
  })
})

describe('K13 · los tramos del reparto suman la línea', () => {
  it('sin reparto (0 o 1 tramo) cuadra siempre', () => {
    expect(cuadreDeTramos(1, 100, []).cuadra).toBe(true)
    expect(cuadreDeTramos(1, 100, [{ importe: 30 }]).cuadra).toBe(true)
  })
  it('al céntimo, sin errores de coma flotante', () => {
    expect(cuadreDeTramos(1, 0.3, [{ importe: 0.1 }, { importe: 0.2 }]).cuadra).toBe(true)
    expect(cuadreDeTramos(1, 121.35, [{ importe: 60.68 }, { importe: 60.67 }]).cuadra).toBe(true)
  })
  it('si no suman, dice cuánto falta o sobra', () => {
    const f = cuadreDeTramos(2, 100, [{ importe: 60 }, { importe: 30 }])
    expect(f.cuadra).toBe(false)
    expect(f.texto).toBe('El reparto de la línea 2 suma 90,00 € y la línea es 100,00 €: faltan 10,00 €.')
    const s = cuadreDeTramos(1, 100, [{ importe: 60 }, { importe: 50.5 }])
    expect(s.texto).toContain('sobran 10,50 €')
  })
})

describe('K13 · el código corto', () => {
  const locales = [
    { id: 'a', nombre: 'Alcalá', codigo: '001' },
    { id: 'b', nombre: 'Carabanchel', codigo: '002' },
    { id: 'c', nombre: 'Sin código', codigo: null },
  ]
  const marcas = [
    { id: 'm', nombre: 'Milanesa de Prueba', codigo: 'MIL' },
    { id: 'n', nombre: 'Ñandú', codigo: 'NAN' },
    { id: 'p', nombre: 'Pollos Mil', codigo: 'POL' },
  ]
  it('con Intro, el código exacto elige, sin mirar mayúsculas ni espacios', () => {
    expect(elegidoPorCodigo(locales, '002')?.id).toBe('b')
    expect(elegidoPorCodigo(marcas, ' mil ')?.id).toBe('m')
    expect(elegidoPorCodigo(marcas, 'MI')).toBeNull()
    expect(elegidoPorCodigo(locales, '')).toBeNull()
  })
  it('la lupa busca por código y por nombre, primero los del código y sin acentos', () => {
    expect(buscarPorCodigoYNombre(marcas, 'mil').map((x) => x.id)).toEqual(['m', 'p'])
    expect(buscarPorCodigoYNombre(marcas, 'nandu').map((x) => x.id)).toEqual(['n'])
    expect(buscarPorCodigoYNombre(locales, 'alca').map((x) => x.id)).toEqual(['a'])
    expect(buscarPorCodigoYNombre(locales, '').map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})
