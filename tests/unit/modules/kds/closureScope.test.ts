// tests/unit/modules/kds/closureScope.test.ts
//
// LA REGRESIÓN DEL 31/08/2026, ESCRITA.
//
// Con Foodint Alcalá seleccionado, el banner de Pedidos listaba como propios
// los dos cierres reales de Foodint Carabanchel —Meraki Pita y Milanesa
// House— con un botón Reabrir al lado. Los ids y los nombres de aquí son los
// de producción, verificados contra brand_closure el 31/08:
//   Meraki Pita     cc89c6eb-… @ Carabanchel 92d7656e-…  resume_at null
//   Milanesa House  501ffd59-… @ Carabanchel 92d7656e-…  resume_at null
//   Alcalá          38158159-…  (sin ningún cierre)
//
// Si algún día una fila de Carabanchel vuelve a caer en el lado de Alcalá,
// este fichero se pone rojo antes de que lo haga una tablet en servicio.

import { describe, it, expect } from 'vitest'
import {
  partirPorLocal, filaId, textoReapertura, textoReaperturaChip,
  textoReabrir, textoMarcasCerradas, textoOtrosLocales,
} from '@/modules/kds/lib/closureScope'

const CARABANCHEL = '92d7656e-082e-452a-8ebc-236b2d6ebf5f'
const ALCALA = '38158159-cd71-4056-950b-53425afac1ce'

const MERAKI = {
  brand_id: 'cc89c6eb-afb8-4308-884e-9aac83986b22',
  brand_name: 'Meraki Pita',
  location_id: CARABANCHEL,
  location_name: 'Foodint Carabanchel',
  resume_at: null as string | null,
}
const MILANESA = {
  brand_id: '501ffd59-19e1-4d75-81dd-70c5a1a2b1de',
  brand_name: 'Milanesa House',
  location_id: CARABANCHEL,
  location_name: 'Foodint Carabanchel',
  resume_at: null as string | null,
}
const CIERRES_REALES = [MERAKI, MILANESA]

describe('partirPorLocal — el incidente del 31/08', () => {
  it('con Alcalá seleccionado, los cierres de Carabanchel NO son de Alcalá', () => {
    const { aqui, otrosLocales } = partirPorLocal(CIERRES_REALES, ALCALA)
    expect(aqui).toEqual([])
    expect(otrosLocales).toHaveLength(2)
    expect(otrosLocales.map((c) => c.brand_name)).toEqual(['Meraki Pita', 'Milanesa House'])
  })

  it('con Carabanchel seleccionado, sí los enseña como propios', () => {
    const { aqui, otrosLocales } = partirPorLocal(CIERRES_REALES, CARABANCHEL)
    expect(aqui).toHaveLength(2)
    expect(otrosLocales).toEqual([])
  })

  it('ninguna fila se pierde ni se duplica al partir', () => {
    const { aqui, otrosLocales } = partirPorLocal(CIERRES_REALES, ALCALA)
    expect([...aqui, ...otrosLocales]).toHaveLength(CIERRES_REALES.length)
  })

  it('cada fila de otro local llega con su nombre de local (ver no es adivinar)', () => {
    const { otrosLocales } = partirPorLocal(CIERRES_REALES, ALCALA)
    otrosLocales.forEach((c) => expect(c.location_name).toBe('Foodint Carabanchel'))
  })

  it('mezcla: solo cae en `aqui` lo del local seleccionado', () => {
    const enAlcala = { ...MERAKI, location_id: ALCALA, location_name: 'Foodint Alcala' }
    const { aqui, otrosLocales } = partirPorLocal([...CIERRES_REALES, enAlcala], ALCALA)
    expect(aqui).toEqual([enAlcala])
    expect(otrosLocales).toEqual(CIERRES_REALES)
  })

  it('sin local con el que contrastar (consolidado / token) todo es `aqui`, y nada queda escondido', () => {
    const { aqui, otrosLocales } = partirPorLocal(CIERRES_REALES, null)
    expect(aqui).toEqual(CIERRES_REALES)
    expect(otrosLocales).toEqual([])
  })

  it('lista vacía no inventa filas', () => {
    expect(partirPorLocal([], ALCALA)).toEqual({ aqui: [], otrosLocales: [] })
  })
})

describe('filaId — una marca puede estar cerrada en dos locales', () => {
  it('la misma marca en dos locales son dos filas distintas', () => {
    const enAlcala = { ...MERAKI, location_id: ALCALA }
    expect(filaId(MERAKI)).not.toBe(filaId(enAlcala))
  })

  it('lleva marca y local, en ese orden', () => {
    expect(filaId(MERAKI)).toBe(`${MERAKI.brand_id}:${CARABANCHEL}`)
  })
})

describe('textos honestos', () => {
  it('resume_at null es «sin fecha de reapertura», no «indefinido»', () => {
    expect(textoReapertura(null)).toBe('sin fecha de reapertura')
    expect(textoReaperturaChip(null)).toBe('sin fecha de reapertura')
    expect(textoReapertura(null)).not.toContain('indefinido')
  })

  it('con hora, la dice', () => {
    const t = textoReapertura('2026-08-31T20:30:00.000Z')
    expect(t).toMatch(/^hasta las \d{2}:\d{2}$/)
    expect(textoReaperturaChip('2026-08-31T20:30:00.000Z')).toMatch(/^reabre \d{2}:\d{2}$/)
  })

  it('reabrir nunca es mudo respecto al local', () => {
    expect(textoReabrir('Meraki Pita', 'Foodint Carabanchel'))
      .toBe('Reabrir Meraki Pita en Foodint Carabanchel')
  })

  it('recuentos en singular y plural', () => {
    expect(textoMarcasCerradas(1)).toBe('1 marca cerrada')
    expect(textoMarcasCerradas(2)).toBe('2 marcas cerradas')
    expect(textoOtrosLocales(1)).toBe('1 marca cerrada en otro local')
    expect(textoOtrosLocales(2)).toBe('2 marcas cerradas en otros locales')
  })
})
