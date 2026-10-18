// tests/conta/impuestos/festivos.test.ts
//
// I01a · Los festivos de los plazos de Hacienda (scripts/conta/i01/festivos.mjs).
// La referencia es la que se sacó del BOE (regla 31: las resoluciones reales de
// 2026 y 2027, no una lista de memoria). Aquí se comprueba que la migración
// lleva exactamente esa referencia y que dice lo que tiene que decir. Las
// fechas de los plazos las prueba supabase/staging/sql/20261122_i01_plazos_prueba.sql
// contra el calendario oficial de la AEAT de 2026.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MIGRACION, REFERENCIA, bloqueSql } from '../../../scripts/conta/i01/festivos.mjs'

type Festivo = { fecha: string; ambito: 'ES' | 'ES-MD'; nombre: string }
const ref = JSON.parse(readFileSync(REFERENCIA, 'utf8')) as { resoluciones: { anio: number; id: string; sha256: string; provisional: string | null }[]; festivos: Festivo[] }
const de = (anio: number, ambito: string) => ref.festivos.filter((f) => f.fecha.startsWith(`${anio}-`) && f.ambito === ambito).map((f) => f.fecha)

describe('festivos de los plazos (I01a)', () => {
  it('la migración lleva la referencia sacada del BOE, sin tocar a mano', () => {
    expect(readFileSync(MIGRACION, 'utf8')).toContain(bloqueSql(ref))
  })

  it('las dos resoluciones, con su huella; 2027 provisional hasta el BOCM', () => {
    expect(ref.resoluciones.map((r) => [r.anio, r.id])).toEqual([[2026, 'BOE-A-2025-21667'], [2027, 'BOE-A-2026-21254']])
    for (const r of ref.resoluciones) expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(ref.resoluciones[0].provisional).toBeNull()
    expect(ref.resoluciones[1].provisional).toMatch(/BOCM/)
  })

  it('2026 en la Comunidad de Madrid: los 12 días del BOE', () => {
    expect(de(2026, 'ES-MD')).toEqual(['2026-01-01', '2026-01-06', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-02',
      '2026-08-15', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25'])
  })

  it('San José de 2026 es fiesta nacional aunque Madrid no la celebre: es lo que da el 16/03 de la AEAT', () => {
    expect(de(2026, 'ES')).toContain('2026-03-19')
    expect(de(2026, 'ES-MD')).not.toContain('2026-03-19')
  })

  it('2027 en la Comunidad de Madrid: los del BOE, no los que se supusieron en el paso 1', () => {
    const md = de(2027, 'ES-MD')
    expect(md).toHaveLength(12)
    expect(md).toContain('2027-03-19')
    expect(md).not.toContain('2027-05-03')
  })
})
