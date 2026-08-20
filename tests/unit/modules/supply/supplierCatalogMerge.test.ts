// Una fila por ARTÍCULO en la pantalla de pedido.
//
// Casos sacados del dato real de Foodint (20/08): CLOUDTOWN, S.L. daba 98
// filas para 89 artículos, y "Aceite de Oliva Suave 0,4º" salía dos veces —
// una con código y Garrafa, otra sin código y SIN FORMATO, que la pantalla
// pintaba como "ml".

import { describe, it, expect } from 'vitest'
import { mergeEntriesByItem, buildFormatLabel } from '@/modules/supply/services/supplierCatalogService'
import type { SupplierCatalogEntry } from '@/modules/supply/services/supplierCatalogService'

function ficha(over: Partial<SupplierCatalogEntry>): SupplierCatalogEntry {
  return {
    articleSupplierId: 'as-1',
    recipeItemId: 'item-1',
    itemName: 'Artículo',
    supplierCode: null,
    supplierItemName: null,
    lastPrice: null,
    isPreferred: false,
    purchaseFormatId: null,
    formatName: null,
    formatQtyInBase: null,
    baseUnitAbbr: 'ml',
    formatLabel: null,
    formats: [],
    otherSupplierCodes: [],
    stockOnHand: null,
    suggestedQty: null,
    suggestionSource: null,
    suggestionConfidence: null,
    ...over,
  }
}

describe('mergeEntriesByItem · una fila por artículo', () => {
  it('dos fichas del mismo artículo se funden en UNA fila', () => {
    const r = mergeEntriesByItem([
      ficha({ articleSupplierId: 'a', supplierCode: '510101007', purchaseFormatId: 'f-garrafa', formatName: 'Garrafa', formatQtyInBase: 5000 }),
      ficha({ articleSupplierId: 'b' }),
    ])
    expect(r).toHaveLength(1)
  })

  it('el caso real: la ficha SIN formato no borra el formato de la hermana', () => {
    // Antes: la fila sin purchase_format_id caía a la unidad base -> "ml".
    const r = mergeEntriesByItem([
      ficha({ articleSupplierId: 'sin', supplierCode: null }),
      ficha({ articleSupplierId: 'con', supplierCode: '510101007', purchaseFormatId: 'f-garrafa', formatName: 'Garrafa', formatQtyInBase: 5000, formatLabel: 'Garrafa (5 L)' }),
    ])
    expect(r[0].purchaseFormatId).toBe('f-garrafa')
    expect(r[0].formatLabel).toBe('Garrafa (5 L)')
    expect(r[0].supplierCode).toBe('510101007')
  })

  it('el bloque de formato se toma ENTERO de una sola ficha, sin mezclar', () => {
    const r = mergeEntriesByItem([
      ficha({ articleSupplierId: 'a', supplierCode: 'AAA' }),
      ficha({ articleSupplierId: 'b', purchaseFormatId: 'f-caja', formatName: 'Caja', formatQtyInBase: 6000, formatLabel: 'Caja (6 L)' }),
    ])
    expect(r[0].formatName).toBe('Caja')
    expect(r[0].formatQtyInBase).toBe(6000)
    expect(r[0].formatLabel).toBe('Caja (6 L)')
  })

  it('un código que existe NO se esconde: va a otherSupplierCodes', () => {
    const r = mergeEntriesByItem([
      ficha({ articleSupplierId: 'a', supplierCode: '111', isPreferred: true }),
      ficha({ articleSupplierId: 'b', supplierCode: '222' }),
    ])
    expect(r[0].supplierCode).toBe('111')
    expect(r[0].otherSupplierCodes).toEqual(['222'])
  })

  it('la preferente manda sobre la que sólo tiene código', () => {
    const r = mergeEntriesByItem([
      ficha({ articleSupplierId: 'a', supplierCode: '111' }),
      ficha({ articleSupplierId: 'b', supplierCode: '222', isPreferred: true }),
    ])
    expect(r[0].articleSupplierId).toBe('b')
    expect(r[0].isPreferred).toBe(true)
  })

  it('artículos distintos NO se funden', () => {
    const r = mergeEntriesByItem([
      ficha({ recipeItemId: 'i1', itemName: 'Aceite' }),
      ficha({ recipeItemId: 'i2', itemName: 'Vinagre' }),
    ])
    expect(r).toHaveLength(2)
  })

  it('se ordena por nombre de artículo', () => {
    const r = mergeEntriesByItem([
      ficha({ recipeItemId: 'i2', itemName: 'Vinagre' }),
      ficha({ recipeItemId: 'i1', itemName: 'Aceite' }),
    ])
    expect(r.map(e => e.itemName)).toEqual(['Aceite', 'Vinagre'])
  })
})

describe('buildFormatLabel · la etiqueta lleva la medida', () => {
  it('escala mililitros a litros', () => {
    expect(buildFormatLabel('Garrafa', 5000, 'ml')).toBe('Garrafa (5 L)')
    expect(buildFormatLabel('Bidón', 25000, 'ml')).toBe('Bidón (25 L)')
  })
  it('por debajo de mil se queda en la unidad base', () => {
    expect(buildFormatLabel('Botella', 250, 'ml')).toBe('Botella (250 ml)')
  })
  it('gramos a kilos', () => {
    expect(buildFormatLabel('Caja', 4800, 'g')).toBe('Caja (4,8 kg)')
  })
})
