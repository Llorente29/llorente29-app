import { describe, it, expect } from 'vitest'
import {
  classifyCauseV2,
  type CauseContext, type InventoryCountLine,
} from '@/modules/supply/services/inventoryCountService'

// ENCARGO CODE 23/09 punto 4 — «Que los términos de la resta sean medibles».
//
// La población es REAL (regla 31): el conteo 771648e1-2a1a-4cfd-8c64-2299a4f7e426,
// en revisión el 23/09, y su única línea con correcciones de albarán. Medido con
// el motor, como usuario de la cuenta y no como postgres:
//
//   RAW-00174  Milanesa de Pollo Rebozado   ALB-00146   2 movs «Ajuste de oficina»
//     entradas que veía el AVT ...........       0      (ni un 'recepcion' en el periodo)
//     entradas por albarán, con su signo ..  -22,440 kg
//
// El caso de signo positivo NO es inventado: es el mismo albarán antes de que la
// oficina lo corrigiera, +60,000 kg de apertura aparte.

const LA_MILANESA: InventoryCountLine = {
  id: 'l-milanesa', recipeItemId: 'raw-00174', itemName: 'Milanesa de Pollo Rebozado',
  unitAbbr: 'kg', storageAreaId: null, storageAreaName: null, position: 1,
  systemQty: 12, countedQty: 18, varianceQty: 6, variancePct: 50, varianceValue: 33.81,
  abcClass: 'A', withinTolerance: false, reasonCode: null,
  unitCost: 5.6335, familyId: null, familyName: null, needsReview: false, lineValue: 101.4,
}

const ctx = (over: Partial<CauseContext> = {}): CauseContext => ({
  wasteQtyBase: 0, receiptsQtyBase: 0, transfersOutQtyBase: 0,
  usedInRecipes: true, consumoIncompleto: false, ...over,
})

describe('el término de entradas llega a la pantalla', () => {
  it('sobra producto y el albarán neteó en negativo: lo dice, con el número de la Milanesa', () => {
    const c = classifyCauseV2(LA_MILANESA, false, ctx({ receiptsQtyBase: -22.44 }))
    expect(c.label).toBe('Recepción sin registrar')
    expect(c.evidence).toContain('-22,4 kg')
    expect(c.evidence).toContain('correcciones o anulaciones de oficina')
  })

  it('sobra producto y entró mercancía: lo dice en positivo', () => {
    const c = classifyCauseV2(LA_MILANESA, false, ctx({ receiptsQtyBase: 37.56 }))
    expect(c.evidence).toContain('Por albarán entraron 37,6 kg')
  })

  it('sobra producto y no entró nada: lo dice también, en vez de callarlo', () => {
    const c = classifyCauseV2(LA_MILANESA, false, ctx())
    expect(c.evidence).toContain('Por albarán no entró nada')
  })

  it('«Sin causa clara» tampoco se calla las entradas', () => {
    const falta: InventoryCountLine = { ...LA_MILANESA, countedQty: 6, varianceQty: -6, variancePct: -50 }
    const c = classifyCauseV2(falta, false, ctx({ usedInRecipes: false, receiptsQtyBase: -22.44 }))
    expect(c.label).toBe('Sin causa clara')
    expect(c.evidence).toContain('-22,4 kg')
  })

  it('el término no decide: la causa y la confianza siguen siendo las de antes', () => {
    const a = classifyCauseV2(LA_MILANESA, false, ctx({ receiptsQtyBase: 0 }))
    const b = classifyCauseV2(LA_MILANESA, false, ctx({ receiptsQtyBase: -22.44 }))
    expect(b.reasonCode).toBe(a.reasonCode)
    expect(b.confidence).toBe(a.confidence)
  })

  it('con merma registrada manda la merma: la entrada no se cuela donde no toca', () => {
    const falta: InventoryCountLine = { ...LA_MILANESA, countedQty: 6, varianceQty: -6, variancePct: -50 }
    const c = classifyCauseV2(falta, false, ctx({ wasteQtyBase: 6, receiptsQtyBase: -22.44 }))
    expect(c.label).toBe('Merma')
    expect(c.evidence).not.toContain('Por albarán')
  })
})
