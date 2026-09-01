import { describe, it, expect } from 'vitest'
import { lineaSinDecidir } from '../../../src/modules/supply/services/goodsReceiptService'

// ⚠️ ESTE CRITERIO VIVE TAMBIÉN EN LA BBDD (guard de confirm_goods_receipt y su
// needs_review). El 01/09 se arregló allí y NO en el front: la pantalla siguió
// contando como «sin decidir» una línea que el servidor ya exoneraba, el botón
// de cerrar se quedó apagado y ALB-00136 no se pudo cerrar con la reclamación
// esperando. Estas pruebas fijan las dos mitades de la exención para que, si
// alguien toca una, salte aquí y no en producción con Julio delante.

const l = (p: Partial<Parameters<typeof lineaSinDecidir>[0]> = {}) => ({
  notGoods: false, recipeItemId: 'art-1', qtyInBase: 1000,
  discrepancyReason: null, ...p,
})

describe('lineaSinDecidir — el mismo criterio que el guard de la BBDD', () => {
  it('línea normal: decidida', () => {
    expect(lineaSinDecidir(l())).toBe(false)
  })

  it('sin artículo: SIEMPRE sin decidir, aunque tenga motivo escrito', () => {
    expect(lineaSinDecidir(l({ recipeItemId: null }))).toBe(true)
    expect(lineaSinDecidir(l({ recipeItemId: null, discrepancyReason: 'lo que sea' }))).toBe(true)
  })

  // LA LÍNEA REAL DE ALB-00136, la que dejó a Julio sin poder cerrar:
  // recipe_item_id puesto, qty_received 0, qty_in_base NULL, con motivo.
  it('cantidad NULL con motivo escrito: DECIDIDA (ALB-00136 línea 13)', () => {
    expect(lineaSinDecidir(l({
      qtyInBase: null, discrepancyReason: 'cambio oficina: llamé a cocina',
    }))).toBe(false)
  })

  it('cantidad 0 con motivo escrito: DECIDIDA', () => {
    expect(lineaSinDecidir(l({ qtyInBase: 0, discrepancyReason: 'no llegó' }))).toBe(false)
  })

  // La otra mitad, que es la que da sentido a la exención: cero CON motivo es
  // una decisión; cero A SECAS es un olvido, y para eso está el guard.
  it('cantidad NULL SIN motivo: sin decidir', () => {
    expect(lineaSinDecidir(l({ qtyInBase: null }))).toBe(true)
  })

  it('cantidad 0 SIN motivo: sin decidir', () => {
    expect(lineaSinDecidir(l({ qtyInBase: 0 }))).toBe(true)
  })

  it('un motivo en blanco no es un motivo', () => {
    expect(lineaSinDecidir(l({ qtyInBase: 0, discrepancyReason: '   ' }))).toBe(true)
    expect(lineaSinDecidir(l({ qtyInBase: 0, discrepancyReason: '' }))).toBe(true)
  })

  it('«no es mercancía» nunca cuenta, ni sin artículo', () => {
    expect(lineaSinDecidir(l({ notGoods: true, recipeItemId: null, qtyInBase: null }))).toBe(false)
  })
})
