// tests/conta/e04/pasadaSola.test.ts
//
// E04 · Cuándo se pasa sola a la otra sociedad y cuándo no
// (src/modules/conta/lib/deQuienEs.ts, sePasaSola y eligeSociedad): la misma regla
// que la base (_conta_pasar_sola, 20261118T1950). NIF inventados (T11). La base la
// prueba supabase/staging/sql/20261118_e04_pasar_sola_prueba.sql (también las
// trabas: pagos, banco…, que la pantalla no ve).

import { describe, expect, it } from 'vitest'
import { botonesDeQuien, eligeSociedad, sePasaSola } from '@/modules/conta/lib/deQuienEs'

const DOS = [{ id: 'dos', nif: 'A00000000' }]
const caso = (o: { nifLeido: string | null; validado?: boolean; respuesta?: 'es_de_esta' | 'deduce' | 'no_deduce' | null; otras?: { id: string; nif: string | null }[] }) =>
  sePasaSola({ nifEmpresa: 'B00000000', nifLeido: o.nifLeido, otrasSociedades: o.otras ?? DOS, conIva: true, validado: o.validado ?? false, respuesta: o.respuesta ?? null })

describe('sePasaSola', () => {
  it('a nombre de otra sociedad de la cuenta, sin asiento y sin respuesta: se pasa, a esa', () => {
    expect(caso({ nifLeido: 'A00000000' })).toEqual({ pasa: true, sociedadId: 'dos' })
    expect(caso({ nifLeido: 'es-a0000 0000' })).toEqual({ pasa: true, sociedadId: 'dos' })
  })
  it('con su asiento validado, no (sigue la pregunta)', () => { expect(caso({ nifLeido: 'A00000000', validado: true }).pasa).toBe(false) })
  it('con respuesta de una persona (también «Es de esta sociedad» o «Deshacer»), no', () => {
    for (const r of ['es_de_esta', 'deduce', 'no_deduce'] as const) expect(caso({ nifLeido: 'A00000000', respuesta: r }).pasa).toBe(false)
  })
  it('a nombre de la misma sociedad, no', () => { expect(caso({ nifLeido: 'b-00000000' })).toEqual({ pasa: false, sociedadId: null }) })
  it('a nombre de alguien de fuera, no', () => { expect(caso({ nifLeido: '12345678Z' }).pasa).toBe(false) })
  it('sin leer a nombre de quién va, no', () => {
    expect(caso({ nifLeido: null }).pasa).toBe(false)
    expect(caso({ nifLeido: ' ' }).pasa).toBe(false)
  })
  it('en una cuenta con una sola sociedad, nunca', () => { expect(caso({ nifLeido: 'A00000000', otras: [] }).pasa).toBe(false) })
})

describe('eligeSociedad: «Es de: [sociedad ▾]»', () => {
  it('en fuera y sin leer, con más de una sociedad', () => {
    expect(eligeSociedad('fuera', 2)).toBe(true)
    expect(eligeSociedad('sin_leer', 3)).toBe(true)
  })
  it('con una sola sociedad, no sale', () => {
    expect(eligeSociedad('fuera', 1)).toBe(false)
    expect(eligeSociedad('sin_leer', 1)).toBe(false)
  })
  it('en la otra sociedad (ya lleva su «Pasarla a …») ni en la empresa, no', () => {
    expect(eligeSociedad('otra_sociedad', 2)).toBe(false)
    expect(eligeSociedad('empresa', 2)).toBe(false)
    expect(eligeSociedad(null, 2)).toBe(false)
  })
  it('el de «Pasarla» sigue relleno; los del IVA, no', () => {
    expect(botonesDeQuien({ caso: 'otra_sociedad', sociedad: 'X, S.L.', sociedadCorta: 'X' }).find((b) => b.que === 'pasar')?.principal).toBe(true)
    expect(botonesDeQuien({ caso: 'fuera', sociedad: null, sociedadCorta: null }).some((b) => b.principal)).toBe(false)
  })
})
