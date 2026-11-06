// G01 · Tarea 2. La puerta de las demos en las dos lecturas: una cuenta que
// puede salir lee el real y el de pruebas; una demo, solo el de pruebas.
import { describe, expect, it } from 'vitest'
import { decidirLectura as gocardless, puedeLeer, SOLO_PRUEBAS_EN_DEMO } from '../../../../../supabase/functions/conta-gocardless-leer/salida'
import { decidirLectura as bitrix } from '../../../../../supabase/functions/conta-bitrix-leer/salida'

const base = (puede: boolean) => ({ rpc: async () => ({ data: puede, error: null }) })

describe('G01 · la puerta de las demos al leer', () => {
  it('una cuenta de verdad lee los dos entornos', () => {
    for (const d of [gocardless, bitrix]) {
      expect(d(true, 'real')).toEqual({ lee: true })
      expect(d(true, 'pruebas')).toEqual({ lee: true })
    }
  })

  it('una demo lee el de pruebas y nunca el real', async () => {
    expect(gocardless(false, 'pruebas')).toEqual({ lee: true })
    expect(gocardless(false, 'real')).toEqual({ lee: false, porque: SOLO_PRUEBAS_EN_DEMO })
    expect(bitrix(false, 'real')).toMatchObject({ lee: false })
    expect(await puedeLeer(base(false), '00000000-0000-4000-8000-000000000001', 'real')).toMatchObject({ lee: false })
    expect(await puedeLeer(base(true), '00000000-0000-4000-8000-000000000001', 'real')).toEqual({ lee: true })
  })
})
