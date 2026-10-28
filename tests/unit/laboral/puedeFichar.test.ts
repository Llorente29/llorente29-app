// L1a · R1. El trabajador ficha siempre; solo no, si se SABE que está fuera y
// el local está en «bloquear». Y un botón gris lleva siempre su motivo.
import { describe, it, expect } from 'vitest'
import { puedeFichar, type EstadoParaFichar } from '../../../src/pages/trabajador/puedeFichar'

const base: EstadoParaFichar = { local: { name: 'Norte · Centro' }, locales: 1, distancia: 40, radio: 200, modo: 'block', hayPosicion: true }

describe('puedeFichar', () => {
  it('dentro del radio, sí', () => {
    expect(puedeFichar(base)).toEqual({ puede: true, porQueNo: null, sinMedir: null })
  })
  // El caso del e2e #993: el local de staging no tiene coordenadas y está en «bloquear».
  it('local sin coordenadas en «bloquear»: sí, y dice que no se puede medir', () => {
    const r = puedeFichar({ ...base, distancia: null })
    expect(r.puede).toBe(true)
    expect(r.sinMedir).toBe('Tu local no tiene su ubicación puesta')
  })
  it('sin la ubicación del móvil en «bloquear»: sí, y lo dice', () => {
    const r = puedeFichar({ ...base, distancia: null, hayPosicion: false })
    expect(r.puede).toBe(true)
    expect(r.sinMedir).toBe('No tenemos tu ubicación')
  })
  it('fuera del radio en «avisar»: sí', () => {
    expect(puedeFichar({ ...base, distancia: 900, modo: 'warn' }).puede).toBe(true)
  })
  // L1a PR 3: el caso de Natacha, 670 m con la ubicación aproximada del navegador.
  it('a 670 m con una ubicación aproximada en «bloquear»: sí (no se sabe si está fuera)', () => {
    expect(puedeFichar({ ...base, distancia: 670, aproximada: true })).toEqual({ puede: true, porQueNo: null, sinMedir: null })
  })
  it('fuera del radio en «bloquear»: no, y dice a cuánto está', () => {
    expect(puedeFichar({ ...base, distancia: 900.4 })).toEqual({
      puede: false, porQueNo: 'Estás a 900 m de Norte · Centro. Acércate al local para fichar.', sinMedir: null,
    })
  })
  it('sin local elegido: no, y dice qué hacer', () => {
    expect(puedeFichar({ ...base, local: null, locales: 2 }).porQueNo).toBe('Elige arriba el local donde fichas.')
    expect(puedeFichar({ ...base, local: null, locales: 0 }).porQueNo).toMatch(/ningún local/)
  })
  it('nunca un no sin motivo', () => {
    for (const d of [null, 0, 199, 201, 5000]) for (const modo of ['block', 'warn'] as const) for (const local of [null, base.local]) {
      const r = puedeFichar({ ...base, distancia: d, modo, local })
      if (!r.puede) expect(r.porQueNo).toBeTruthy()
    }
  })
})
