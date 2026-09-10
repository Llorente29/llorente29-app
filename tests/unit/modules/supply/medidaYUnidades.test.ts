// tests/unit/modules/supply/medidaYUnidades.test.ts
//
// «Pésalo y escribe los unidades» — lo que enseñó la captura del packaging.
//
// REGLA 31: las unidades base NO son inventadas. Son las que existen de verdad
// en el catálogo de Foodint, medidas el 10/09: g, ml y ud. Se añaden kg y l
// porque `unidadLarga` ya las contempla y un artículo nuevo puede traerlas.

import { describe, it, expect } from 'vitest'
import { medida, pieDeLaCasilla } from '@/modules/supply/lib/conteoMovilTexto'

describe('medida · por unidad base real del catálogo', () => {
  it('lo que se pesa se pesa, y es masculino', () => {
    for (const u of ['g', 'kg', 'ml', 'l']) {
      const m = medida(u)
      expect(m.pesable).toBe(true)
      expect(m.articulo).toBe('los')
      expect(m.verbo).toBe('Pésalo')
    }
  })

  it('lo que se cuenta se cuenta, y «unidades» es femenino', () => {
    // «unidad» lleva el sufijo -dad: femenino, aunque no acabe en -a.
    for (const u of ['ud', 'uni', 'unidad', '', null, undefined]) {
      const m = medida(u)
      expect(m.pesable).toBe(false)
      expect(m.articulo).toBe('las')
      expect(m.verbo).toBe('Cuéntalas')
      expect(m.largo).toBe('unidades')
    }
  })
})

describe('pieDeLaCasilla · la frase entera, que es donde se veía el fallo', () => {
  it('el packaging ya no manda a nadie a por una báscula', () => {
    expect(pieDeLaCasilla('ud', false)).toBe('Cuéntalas y escribe las unidades')
    expect(pieDeLaCasilla('ud', true)).toBe('Escribe las unidades')
  })

  it('y los gramos siguen diciendo lo de siempre', () => {
    expect(pieDeLaCasilla('g', false)).toBe('Pésalo y escribe los gramos')
    expect(pieDeLaCasilla('g', true)).toBe('Escribe los gramos')
  })

  it('en ningún caso sale la concordancia rota que vio la captura', () => {
    for (const u of ['g', 'kg', 'ml', 'l', 'ud', null]) {
      for (const solo of [true, false]) {
        expect(pieDeLaCasilla(u, solo)).not.toContain('los unidades')
        expect(pieDeLaCasilla(u, solo)).not.toContain('las gramos')
      }
    }
  })
})
