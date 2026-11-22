// tests/unit/modules/conta/x27/suplidos.test.ts — X27c · La «Subcuenta suplidos» de la ficha del proveedor: la base no
// sujeta (al 0 %) de su factura va a esa subcuenta; lo demás, a su gasto. Sin subcuenta de suplidos, nada cambia.
// Cuentas inventadas.

import { describe, expect, it } from 'vitest'
import { conSuplidos } from '@/modules/conta/lib/recibidaGuardada'

const LINEAS = [
  { base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62800000' },
  { base: 35, tipo: { id: 't0', porcentaje: 0 }, cuentaGasto: '62800000' },
  { base: 12, tipo: null, cuentaGasto: '62800000' },
]

describe('X27c · los suplidos al proponer', () => {
  it('con subcuenta de suplidos, la base al 0 % va a ella; la del 21 % y la sin tipo (que puede ser una mala lectura), a su gasto', () => {
    expect(conSuplidos(LINEAS, '62900099').map((l) => l.cuentaGasto)).toEqual(['62800000', '62900099', '62800000'])
  })
  it('sin subcuenta de suplidos, todo como estaba (regla 31)', () => {
    expect(conSuplidos(LINEAS, null)).toEqual(LINEAS)
  })
})
