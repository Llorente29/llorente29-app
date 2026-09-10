// La frase de la contradicción, probada contra EL CASO REAL que motivó el
// encargo (regla 31: la prueba se escribe contra la población real).
//
// Los datos están copiados de `inventory_count_line` de Foodint el 10/09/2026,
// artículo Peperoni Loncheado en Foodint Alcalá, los tres recuentos aprobados
// del 3, el 4 y el 5 de septiembre:
//
//   INV-00199  9.000 g  03/09 21:00:01  Pamela Guzman Velásquez   aprobado
//   INV-00202      0 g  04/09 20:39:37  Natacha del Valle Rondón  aprobado  ← éste
//   INV-00203  9.000 g  05/09 20:41:53  Marlón Mafla Rivera       aprobado
//
// El `system_qty` del segundo era 8.875 g: 9.000 menos los 125 g vendidos, y
// NINGUNA recepción entre medias. Los tres se aprobaron.
//
// Las horas están en hora de Madrid, no en UTC (regla 4: `counted_at` se guarda
// en UTC y un análisis de horario de servicio convierte ANTES de concluir nada).
// Aquí se construyen con `new Date(...)` local, que es lo que hace la pantalla.

import { describe, it, expect } from 'vitest'
import { explicarContradiccion, type PrevContext } from '@/modules/supply/services/countApprovalService'
import type { InventoryCountLine } from '@/modules/supply/services/inventoryCountService'

// U+00A0 entre cifra y unidad, igual que en el móvil. Ver la nota en
// `formatosDeConteo.test.ts`.
const nb = (s: string) => s.replace(/ (kg|g|l|ml|ud|u)\b/g, '\u00A0$1')

function linea(p: Partial<InventoryCountLine>): InventoryCountLine {
  return {
    id: 'l1', recipeItemId: 'peperoni', itemName: 'Peperoni Loncheado', unitAbbr: 'g',
    storageAreaId: null, storageAreaName: null, position: 1,
    systemQty: 8875, countedQty: 0, varianceQty: -8875, variancePct: -100, varianceValue: -70.13,
    abcClass: 'A', withinTolerance: false, reasonCode: null,
    unitCost: 0.0079, familyId: null, familyName: null, needsReview: false, lineValue: 0,
    lineNeedsReview: false, reasonNote: null,
    countedByName: 'Natacha del Valle Rondón', countedAt: '2026-09-04T18:39:37Z',
    confirmedTwice: false, recountRequestedAt: null, recountOf: null,
    ...p,
  }
}

const PAMELA: PrevContext = {
  prevQty: 9000,
  prevCountedAt: new Date(2026, 8, 3, 21, 0, 1).toISOString(),  // 03/09 21:00, Madrid
  prevByName: 'Pamela Guzman Velásquez',
  movedSince: -125,
  receivedSince: 0,
  soldSince: 125,
}

describe('el peperoni · lo que la pantalla tenía que haber dicho el 04/09', () => {
  it('0 kg contra 9 kg del día anterior, sin entradas: contradice', () => {
    const txt = explicarContradiccion(linea({}), PAMELA, 40)
    expect(txt).not.toBe('')
    expect(txt).toContain(nb('Pamela Guzman Velásquez contó 9 kg'))
    expect(txt).toContain('el 03/09 a las 21:00')
    expect(txt).toContain('no ha entrado peperoni loncheado')
    expect(txt).toContain(nb('se han vendido 125 g'))
  })

  it('CON una recepción de por medio se calla: el stock cambió por algo conocido', () => {
    const conEntrega: PrevContext = { ...PAMELA, receivedSince: 5000, movedSince: 4875 }
    expect(explicarContradiccion(linea({}), conEntrega, 40)).toBe('')
  })

  it('la deriva normal no es contradicción: 8,5 kg contra 8,875 esperados', () => {
    // −4,2 %, muy por debajo del 40 %. Si esto saltara, la pantalla de
    // aprobación tendría 30 contradicciones al día y nadie miraría ninguna.
    expect(explicarContradiccion(linea({ countedQty: 8500 }), PAMELA, 40)).toBe('')
  })

  it('sin recuento anterior no se inventa nada', () => {
    expect(explicarContradiccion(linea({}), null, 40)).toBe('')
    expect(explicarContradiccion(linea({}), { ...PAMELA, prevQty: null }, 40)).toBe('')
  })

  it('sin contar, no hay nada que contradecir', () => {
    expect(explicarContradiccion(linea({ countedQty: null }), PAMELA, 40)).toBe('')
  })

  it('cuando no se ha vendido nada, lo dice con esas palabras', () => {
    const quieto: PrevContext = { ...PAMELA, movedSince: 0, soldSince: 0 }
    expect(explicarContradiccion(linea({}), quieto, 40)).toContain('no se ha vendido nada')
  })
})

describe('los tequeños · 170 → 255 → 100 en tres días', () => {
  // Del §0 del encargo: 170 el 31/08, llegan 170, 170 el 01/09, 255 el 02/09 y
  // 100 el 03/09. El salto de 170 a 255 es +50 % sin recepción de por medio.
  const tequenos: PrevContext = {
    prevQty: 170,
    prevCountedAt: new Date(2026, 8, 1, 21, 30, 0).toISOString(),
    prevByName: 'Johanny',
    movedSince: -20,
    receivedSince: 0,
    soldSince: 20,
  }
  it('255 contra 150 esperados contradice', () => {
    const txt = explicarContradiccion(
      linea({ itemName: 'Tequeños', unitAbbr: 'ud', countedQty: 255, systemQty: 150 }),
      tequenos, 40,
    )
    expect(txt).toContain(nb('Johanny contó 170 ud'))
    expect(txt).toContain(nb('se han vendido 20 ud'))
  })
})
