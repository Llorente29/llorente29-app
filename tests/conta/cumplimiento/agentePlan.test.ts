// tests/conta/cumplimiento/agentePlan.test.ts
//
// Pruebas fijas del agente «Plan contable» (C02 §4, scripts/conta/lib/agentePlan.mjs),
// parte de la serie. La base correcta es la serie REAL generada del BOE
// (supabase/conta/pgc/serie.json); los fallos se fabrican haciéndole a una fila
// real lo que le puede pasar (regla 31).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import correcciones from '../../../supabase/conta/pgc/correcciones.json'
import serie from '../../../supabase/conta/pgc/serie.json'
import { informePlan, revisarSerieEnBase, revisarSerieEnTexto } from '../../../scripts/conta/lib/agentePlan.mjs'

const textos = {
  pymes: readFileSync('docs/conta/fuentes/textos/rd-1515-2007.txt', 'utf8'),
  general: readFileSync('docs/conta/fuentes/textos/rd-1514-2007.txt', 'utf8'),
}
type Fila = Record<string, unknown>
const base = (): Fila[] => serie.cuentas.map((c) => ({ ...c, valid_to: null }))
const textos_ = (h: { texto: string }[]) => h.map((x) => x.texto)

describe('agente «Plan contable» · serie', () => {
  it('la base y el BOE tal como deben estar: en verde', () => {
    expect(revisarSerieEnTexto(textos, correcciones)).toEqual([])
    expect(revisarSerieEnBase(base(), serie)).toEqual([])
  })

  it('falta una cuenta en la base', () => {
    const b = base().filter((r) => !(r.plan === 'pymes' && r.code === '621'))
    expect(textos_(revisarSerieEnBase(b, serie))).toEqual(['Base · pymes 621 (Arrendamientos y cánones): falta en pgc_account.'])
  })

  it('alguien ha vuelto a cargar el título con la errata', () => {
    const b = base().map((r) => (r.plan === 'pymes' && r.code === '232' ? { ...r, name: 'Propiedad industrial' } : r))
    expect(textos_(revisarSerieEnBase(b, serie))).toEqual(['Base · pymes 232: name es «Propiedad industrial» y la serie dice «Instalaciones técnicas en montaje».'])
  })

  it('una cuenta que no es de la serie, y dos vigentes a la vez', () => {
    const b = [...base(), { ...base()[0], code: '99999', plan: 'pymes' }, { ...base()[1] }]
    const t = textos_(revisarSerieEnBase(b, serie))
    expect(t).toContain('Base · pymes 99999: está en pgc_account y no en la serie.')
    expect(t.some((x) => /hay dos filas vigentes a la vez/.test(x))).toBe(true)
  })

  it('una versión cerrada (valid_to) no cuenta como vigente', () => {
    const vieja = { ...base().find((r) => r.plan === 'general' && r.code === '500')!, valid_from: '2008-01-01', valid_to: '2021-01-31' }
    expect(revisarSerieEnBase([...base(), vieja], serie)).toEqual([])
  })

  it('el BOE corrige una errata: el agente dice que la corrección sobra', () => {
    const corregido = { ...textos, general: textos.general.replaceAll('74.\nSUBVENCIONES, DONACIONESY LEGADOS', '74.\nSUBVENCIONES, DONACIONES Y LEGADOS') }
    expect(corregido.general).not.toBe(textos.general)
    expect(textos_(revisarSerieEnTexto(corregido, correcciones))).toEqual([
      'BOE · general 74: el cuadro ya dice «SUBVENCIONES, DONACIONES Y LEGADOS»: el BOE ha corregido la errata y esta corrección sobra.',
    ])
  })

  it('sin el texto del BOE no da verde', () => {
    expect(textos_(revisarSerieEnTexto({ pymes: textos.pymes }, correcciones))).toEqual(['No tengo el texto del BOE del plan de general: no puedo comprobar la serie.'])
  })

  it('el informe dice el caso concreto', () => {
    const t = informePlan([{ nivel: 'rojo', texto: 'Base · pymes 621 (Arrendamientos y cánones): falta en pgc_account.' }],
      { donde: 'staging-conta', hoy: '2026-10-04', filas: 1685, resumen: serie.resumen })
    expect(t).toMatch(/\*\*1 en rojo:\*\*\n\n- Base · pymes 621/)
  })
})
