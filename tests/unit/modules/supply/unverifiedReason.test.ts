// ENCARGO CODE (20/08) «Verificar un albarán a ciegas» §6 — el aviso tiene que
// decir POR QUÉ está marcada esta línea, no una frase fija.
//
// Motivo de estas pruebas: el aviso de la pantalla de oficina decía SIEMPRE
// "lo emparejó el sistema por parecido de nombre, no por código". Medido
// contra producción (20/08, cuenta Foodint): de las 408 líneas marcadas, 400
// son map_source='unmapped' — el sistema no las casó en absoluto — y en TODA
// la base solo hay 11 líneas fuzzy. El aviso mandaba a mirar donde no era.

import { describe, it, expect } from 'vitest'
import { unverifiedReason } from '@/modules/supply/services/goodsReceiptService'

describe('unverifiedReason', () => {
  it('sin artículo: no ha entrado al almacén', () => {
    expect(unverifiedReason({ recipeItemId: null, mapSource: 'unmapped', qtyInBase: null, unitCost: 1 }))
      .toBe('No se casó con ningún artículo — no ha entrado al almacén')
  })

  it('con artículo pero sin cantidad en base: tampoco ha entrado', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'code', qtyInBase: null, unitCost: 1 }))
      .toBe('Sin cantidad en unidad base — no ha entrado al almacén')
  })

  it('qtyInBase = 0 cuenta como sin cantidad (no como "entró 0")', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'code', qtyInBase: 0, unitCost: 1 }))
      .toBe('Sin cantidad en unidad base — no ha entrado al almacén')
  })

  it('unmapped con artículo y cantidad: entró sin que el sistema la casara', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'unmapped', qtyInBase: 228, unitCost: 1 }))
      .toBe('Entró al almacén sin que el sistema la casara')
  })

  it('fuzzy: SÍ dice lo del parecido de nombre — pero solo cuando lo es', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'fuzzy', qtyInBase: 10, unitCost: 1 }))
      .toBe('La casó el sistema por parecido de nombre, no por código')
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'learned_fuzzy', qtyInBase: 10, unitCost: 1 }))
      .toBe('La casó el sistema por parecido de nombre, no por código')
  })

  it('casada bien pero sin coste: lo dice (caso ALB-00119)', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'manual', qtyInBase: 228, unitCost: null }))
      .toBe('Entró al almacén sin coste')
  })

  it('casada por código y con coste: queda el motivo genérico', () => {
    expect(unverifiedReason({ recipeItemId: 'i1', mapSource: 'code', qtyInBase: 228, unitCost: 1.87 }))
      .toBe('Marcada para revisar y nadie la ha confirmado')
  })

  it('el orden importa: sin artículo gana sobre sin coste', () => {
    expect(unverifiedReason({ recipeItemId: null, mapSource: 'fuzzy', qtyInBase: 5, unitCost: null }))
      .toBe('No se casó con ningún artículo — no ha entrado al almacén')
  })
})
