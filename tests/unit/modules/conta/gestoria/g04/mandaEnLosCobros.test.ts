// G04 · Tarea 2 · Quién manda en los cobros, en un solo sitio
// (supabase/functions/_shared/tarifa/mandaEnLosCobros.ts). Hasta el G05,
// GoCardless; con el G05, Sumied. Importes inventados.
import { describe, expect, it } from 'vitest'
import { MANDA_EN_LOS_COBROS, cifraDeCobro } from '../../../../../../supabase/functions/_shared/tarifa/mandaEnLosCobros'

describe('G04 · quién manda en los cobros', () => {
  it('hasta el G05 manda GoCardless', () => {
    expect(MANDA_EN_LOS_COBROS).toBe('gocardless')
  })
  it('la cifra principal es la de GoCardless; la de Sumied, al lado', () => {
    expect(cifraDeCobro({ gocardlessCent: 49610, sumiedCent: 47190 })).toEqual({
      principalCent: 49610, de: 'gocardless', comparacionCent: 47190, deComparacion: 'sumied', diferenciaCent: 2420, alLado: 'Sumied calcula 471,90 €',
    })
  })
  it('si coinciden, no se dice nada al lado; si falta la de Sumied, tampoco', () => {
    expect(cifraDeCobro({ gocardlessCent: 6050, sumiedCent: 6050 }).alLado).toBeNull()
    expect(cifraDeCobro({ gocardlessCent: 6050, sumiedCent: null })).toMatchObject({ principalCent: 6050, alLado: null, diferenciaCent: null })
  })
  it('sin dato de GoCardless, la principal es null: se dice, no se inventa', () => {
    expect(cifraDeCobro({ gocardlessCent: null, sumiedCent: 6050 })).toMatchObject({ principalCent: null, alLado: 'Sumied calcula 60,50 €' })
  })
  it('con el G05 se invierte, sin tocar nada más', () => {
    expect(cifraDeCobro({ gocardlessCent: 49610, sumiedCent: 47190 }, 'sumied')).toMatchObject({ principalCent: 47190, alLado: 'GoCardless cobra 496,10 €', diferenciaCent: -2420 })
  })
})
