// tests/unit/demo/puertaDePruebas.test.ts
//
// G05 · Tarea 3 · La puerta de las demos hacia los entornos de pruebas
// (supabase/functions/_shared/puertaDePruebas.ts): una demo sale SOLO a
// pruebas, nunca a real; desde producción, a las pruebas de Hacienda solo las
// demos; y el correo de una demo, solo al buzón de pruebas.

import { describe, expect, it } from 'vitest'
import {
  DEMO_NUNCA_A_REAL, PRUEBAS_SOLO_DEMOS, SIN_BUZON_DE_PRUEBAS, correoDeSalida, salirA,
} from '../../../supabase/functions/_shared/puertaDePruebas'

describe('G05 · la puerta de las demos hacia las pruebas', () => {
  it('una demo sale a pruebas y nunca a real', () => {
    expect(salirA(true, 'pruebas')).toEqual({ sale: true })
    expect(salirA(true, 'real')).toEqual({ sale: false, porque: DEMO_NUNCA_A_REAL })
    expect(salirA(true, 'pruebas', true)).toEqual({ sale: true })
  })
  it('una cuenta de verdad sale a los dos, salvo a pruebas donde son solo para demos (Verifactu desde producción)', () => {
    expect([salirA(false, 'real'), salirA(false, 'pruebas'), salirA(false, 'real', true)]).toEqual([{ sale: true }, { sale: true }, { sale: true }])
    expect(salirA(false, 'pruebas', true)).toEqual({ sale: false, porque: PRUEBAS_SOLO_DEMOS })
  })
  it('el correo de una demo va al buzón de pruebas; sin buzón (o mal escrito), no sale y lo dice', () => {
    expect(correoDeSalida(false, 'cliente@ejemplo.es', 'pruebas@ejemplo.es')).toEqual({ para: 'cliente@ejemplo.es' })
    expect(correoDeSalida(true, 'cliente@ejemplo.es', ' pruebas@ejemplo.es ')).toEqual({ para: 'pruebas@ejemplo.es' })
    expect(correoDeSalida(true, 'cliente@ejemplo.es', '')).toEqual({ porque: SIN_BUZON_DE_PRUEBAS })
    expect(correoDeSalida(true, 'cliente@ejemplo.es', 'no-es-un-correo')).toEqual({ porque: SIN_BUZON_DE_PRUEBAS })
  })
})
