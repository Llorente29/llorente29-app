// tests/unit/modules/supply/lineCost.test.ts
//
// EL INCIDENTE DEL ALB-00134, ESCRITO.
//
// Datos reales verificados en producción el 31/08 (AMIRSA, Alcalá):
//   Pollo loncheado 10x1Kg   qty 1 · base 10000 g · doc_amount 92 · unit_cost 83,636363…
//   Ternera loncheada 10x1Kg qty 1 · base 10000 g · doc_amount 99 · unit_cost 90
// Los dos unit_cost son el importe del papel ÷ 1,10. La escritura funcionaba;
// lo que fallaba era que la pantalla pintaba el papel y redondeaba el coste.

import { describe, it, expect } from 'vitest'
import {
  netoDesdeBruto, importePapel, importeAlAlmacen, costePorUnidadBase,
  costePorUnidadBaseSegunPapel, importesCoinciden, avisoIvaProbable,
  decimalesSignificativos,
} from '@/modules/supply/lib/lineCost'
import { fmtMoney, fmtMoneyPrecise } from '@/lib/format'

const POLLO = { qtyReceived: 1, qtyInBase: 10000, unitCost: 83.63636363636364, docAmount: 92 }
const TERNERA = { qtyReceived: 1, qtyInBase: 10000, unitCost: 90, docAmount: 99 }
// ALB-00080 (30/07): el mismo pollo, pero con el IVA dentro del unit_cost.
const POLLO_CON_IVA_DENTRO = { qtyReceived: 1, qtyInBase: 10000, unitCost: 92, docAmount: 92 }

describe('las dos cifras de una línea', () => {
  it('el papel y el almacén son cifras distintas, y las dos se pueden pedir', () => {
    expect(importePapel(POLLO)).toBe(92)
    expect(importeAlAlmacen(POLLO)).toBeCloseTo(83.6364, 4)
  })

  it('el importe al almacén sale de unit_cost, no de doc_amount', () => {
    // Si saliera de doc_amount, corregir el coste no movería nada: el bug.
    expect(importeAlAlmacen(POLLO)).not.toBe(importePapel(POLLO))
  })

  it('escala con las unidades recibidas', () => {
    expect(importeAlAlmacen({ ...POLLO, qtyReceived: 3 })).toBeCloseTo(250.909, 3)
  })

  it('sin coste no se inventa un cero', () => {
    expect(importeAlAlmacen({ ...POLLO, unitCost: null })).toBeNull()
    expect(costePorUnidadBase({ ...POLLO, unitCost: null })).toBeNull()
  })

  it('sin cantidad en base no hay coste por unidad base', () => {
    expect(costePorUnidadBase({ ...POLLO, qtyInBase: null })).toBeNull()
    expect(costePorUnidadBase({ ...POLLO, qtyInBase: 0 })).toBeNull()
  })
})

describe('el redondeo que escondía la corrección (§2)', () => {
  it('papel y almacén dan céntimos por gramo distintos', () => {
    expect(costePorUnidadBaseSegunPapel(POLLO)).toBeCloseTo(0.0092, 6)
    expect(costePorUnidadBase(POLLO)).toBeCloseTo(0.00836364, 6)
  })

  it('fmtMoney los aplasta en el mismo «0,01 €» — el bug reportado', () => {
    expect(fmtMoney(costePorUnidadBaseSegunPapel(POLLO))).toBe('0,01 €')
    expect(fmtMoney(costePorUnidadBase(POLLO))).toBe('0,01 €')
  })

  it('fmtMoneyPrecise los distingue: 0,0084 frente a 0,0092', () => {
    expect(fmtMoneyPrecise(costePorUnidadBase(POLLO))).toBe('0,0084 €')
    expect(fmtMoneyPrecise(costePorUnidadBaseSegunPapel(POLLO))).toBe('0,0092 €')
    expect(fmtMoneyPrecise(costePorUnidadBase(POLLO)))
      .not.toBe(fmtMoneyPrecise(costePorUnidadBaseSegunPapel(POLLO)))
  })

  it('un importe normal sigue con dos decimales', () => {
    expect(fmtMoneyPrecise(83.63636363636364)).toBe('83,64 €')
    expect(fmtMoneyPrecise(92)).toBe('92,00 €')
    expect(fmtMoneyPrecise(0)).toBe('0,00 €')
  })

  it('ausente sigue siendo guion, no «0,00 €»', () => {
    expect(fmtMoneyPrecise(null)).toBe('—')
    expect(fmtMoneyPrecise(undefined)).toBe('—')
  })

  it('decimalesSignificativos: al menos dos cifras que digan algo', () => {
    expect(decimalesSignificativos(8.3636)).toBe(2)
    expect(decimalesSignificativos(0.5)).toBe(2)
    expect(decimalesSignificativos(0.045)).toBe(3)
    expect(decimalesSignificativos(0.0083636)).toBe(4)
    expect(decimalesSignificativos(0.0000001)).toBe(6) // techo
    expect(decimalesSignificativos(0)).toBe(2)
  })
})

describe('quitar el IVA deja de ser aritmética mental (§4)', () => {
  it('92,00 € con IVA 10 % son 83,64 € netos — lo que Pamela calculó a mano', () => {
    expect(netoDesdeBruto(92, 10)).toBeCloseTo(83.63636363636364, 10)
    expect(fmtMoney(netoDesdeBruto(92, 10))).toBe('83,64 €')
  })

  it('99,00 € con IVA 10 % son 90,00 € — el otro caso del mismo albarán', () => {
    expect(netoDesdeBruto(99, 10)).toBeCloseTo(90, 10)
  })

  it('21 % y 4 % también', () => {
    expect(netoDesdeBruto(121, 21)).toBeCloseTo(100, 10)
    expect(netoDesdeBruto(104, 4)).toBeCloseTo(100, 10)
  })

  it('IVA 0 devuelve el mismo importe (no es un caso raro: hay líneas exentas)', () => {
    expect(netoDesdeBruto(92, 0)).toBe(92)
  })

  it('sin importe o sin tipo no se inventa nada', () => {
    expect(netoDesdeBruto(null, 10)).toBeNull()
    expect(netoDesdeBruto(92, null)).toBeNull()
  })

  it('el neto de un bruto casi nunca es redondo, y no se redondea al calcular', () => {
    // 83,636363… se guarda entero; redondear aquí perdería 0,4 céntimos por caja.
    expect(netoDesdeBruto(92, 10)).not.toBe(83.64)
  })
})

describe('aviso «este importe parece llevar el IVA dentro» (§5)', () => {
  it('salta en el caso ALB-00080: proveedor con IVA dentro y papel = almacén', () => {
    // El 10 % NO sale del proveedor: sale de la categoría fiscal del artículo
    // (Kebab Pollo Loncheado → «alimento_general» → 10 %, verificado el 31/08).
    const aviso = avisoIvaProbable(POLLO_CON_IVA_DENTRO, true, 10)
    expect(aviso).not.toBeNull()
    expect(aviso!.papel).toBe(92)
    expect(aviso!.netoPropuesto).toBeCloseTo(83.6364, 4)
  })

  it('sin tipo resuelto el aviso SALTA IGUAL, pero sin proponer cifra', () => {
    // Decisión de Julio (31/08): si el artículo no tiene categoría fiscal, la
    // línea lo dice y pide el tipo en vez de suponerlo. Pero papel = almacén en
    // un proveedor que factura con IVA dentro sigue siendo sospechoso, así que
    // callarse el aviso por no saber el tipo sería esconder el problema.
    const aviso = avisoIvaProbable(POLLO_CON_IVA_DENTRO, true, null)
    expect(aviso).not.toBeNull()
    expect(aviso!.papel).toBe(92)
    expect(aviso!.netoPropuesto).toBeNull()
  })

  it('NO salta en el ALB-00134 ya corregido: papel y almacén ya difieren', () => {
    expect(avisoIvaProbable(POLLO, true, 10)).toBeNull()
    expect(avisoIvaProbable(TERNERA, true, 10)).toBeNull()
  })

  it('NO salta si el proveedor no está marcado — sin la marca no se puede afirmar', () => {
    // Cloudtown, Makro, Europastry… tienen unit_cost = doc_amount en cientos de
    // líneas y eso es lo NORMAL cuando el albarán lista base imponible.
    expect(avisoIvaProbable(POLLO_CON_IVA_DENTRO, false, 10)).toBeNull()
  })

  it('NO salta sin coste guardado: no hay nada que contrastar', () => {
    expect(avisoIvaProbable({ ...POLLO_CON_IVA_DENTRO, unitCost: null }, true, 10)).toBeNull()
  })

  it('tolera el céntimo: 83,636363 × 1 frente a 83,64 del papel no es «coincide»', () => {
    expect(importesCoinciden(83.63636363636364, 92)).toBe(false)
    expect(importesCoinciden(92, 92)).toBe(true)
    expect(importesCoinciden(92, 92.004)).toBe(true)
    expect(importesCoinciden(92, 92.02)).toBe(false)
    expect(importesCoinciden(null, 92)).toBe(false)
  })
})

describe('el total del papel no se rompe (§verificación 5)', () => {
  it('las dos sumas del ALB-00134 son distintas y ninguna está mal', () => {
    const lineas = [POLLO, TERNERA]
    const papel = lineas.reduce((s, l) => s + (importePapel(l) ?? 0), 0)
    const almacen = lineas.reduce((s, l) => s + (importeAlAlmacen(l) ?? 0), 0)
    expect(papel).toBe(191)                    // cuadra contra el albarán
    expect(almacen).toBeCloseTo(173.6364, 4)   // valora el almacén
    expect(almacen).toBeLessThan(papel)
  })
})
