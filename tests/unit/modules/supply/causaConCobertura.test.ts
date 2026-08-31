import { describe, it, expect } from 'vitest'
import {
  classifyCauseConCobertura,
  type CauseContext, type InventoryCountLine,
} from '@/modules/supply/services/inventoryCountService'
import { PERIODO_VACIO, type Cobertura } from '@/modules/supply/lib/coberturaConsumo'

// ENCARGO 31/08 punto 5, verificaciones 6 y 7: con cobertura incompleta ninguna
// línea propone causa; con cobertura completa propone como siempre.

const linea = (over: Partial<InventoryCountLine> = {}): InventoryCountLine => ({
  id: 'l1', recipeItemId: 'art-ternera', itemName: 'Milanesa Ternera Rebozado',
  unitAbbr: 'ud', storageAreaId: null, storageAreaName: null, position: 1,
  systemQty: 30, countedQty: 18, varianceQty: -12, variancePct: -40, varianceValue: -39.1,
  abcClass: 'A', withinTolerance: false, reasonCode: null,
  unitCost: 3.2, familyId: null, familyName: null, needsReview: false, lineValue: 57.6,
  ...over,
})

const ctx = (over: Partial<CauseContext> = {}): CauseContext => ({
  wasteQtyBase: 0, receiptsQtyBase: 0, transfersOutQtyBase: 0,
  usedInRecipes: true, consumoIncompleto: false, ...over,
})

const completa: Cobertura = {
  periodo: { ...PERIODO_VACIO, lineasVendidas: 20, lineasConConsumo: 20 },
  porArticulo: new Map([['art-ternera', { tocan: 11, descuentan: 11 }]]),
}
const conHueco: Cobertura = {
  periodo: {
    lineasVendidas: 115, lineasConConsumo: 106, lineasSinMapear: 7,
    modificadores: 54, modificadoresSinVinculo: 37, modificadoresMudos: 9,
  },
  porArticulo: new Map([['art-ternera', { tocan: 11, descuentan: 5 }]]),
}

describe('classifyCauseConCobertura', () => {
  it('con cobertura completa acusa como siempre: sobre-porción en elaboración', () => {
    const c = classifyCauseConCobertura(linea(), false, ctx(), completa)
    expect(c.label).toBe('Sobre-porción en elaboración')
  })

  it('con el hueco de la Milanesa Ternera deja de acusar y declara el hueco', () => {
    const c = classifyCauseConCobertura(linea(), false, ctx(), conHueco)
    expect(c.label).toBe('No atribuible')
    expect(c.evidence).toContain('6 de 11 ventas')
    expect(c.evidence).not.toContain('se sirvió de más')
  })

  it('un artículo cubierto en un periodo con huecos tampoco acusa, pero cita el periodo', () => {
    const cob: Cobertura = { ...conHueco, porArticulo: new Map([['art-ternera', { tocan: 4, descuentan: 4 }]]) }
    const c = classifyCauseConCobertura(linea(), false, ctx(), cob)
    expect(c.label).toBe('No atribuible')
    expect(c.evidence).toContain('% de lo vendido en este periodo')
  })

  it('FALLA CERRADO: sin poder medir la cobertura, tampoco acusa', () => {
    const c = classifyCauseConCobertura(linea(), false, ctx(), null)
    expect(c.label).toBe('No atribuible')
    expect(c.evidence).toContain('no he podido medir')
  })

  it('una causa con EVIDENCIA POSITIVA se mantiene aunque falte cobertura', () => {
    // Merma registrada: no es una hipótesis por ausencia, es un hecho del ledger.
    const c = classifyCauseConCobertura(linea(), false, ctx({ wasteQtyBase: 12 }), conHueco)
    expect(c.label).toBe('Merma')
  })

  it('el teórico negativo sigue mandando: es dato, no cocina', () => {
    const c = classifyCauseConCobertura(linea({ systemQty: -5 }), false, ctx(), conHueco)
    expect(c.label).toBe('Recepción sin registrar')
    expect(c.confidence).toBe('high')
  })

  it('un conteo de apertura no cambia de comportamiento', () => {
    const c = classifyCauseConCobertura(linea(), true, ctx(), conHueco)
    expect(c.label).toBe('Apertura')
  })

  it('sin desviación no se inventa un hueco', () => {
    const c = classifyCauseConCobertura(linea({ systemQty: 20, countedQty: 20 }), false, ctx(), conHueco)
    expect(c.label).toBe('Sin desviación')
  })
})
