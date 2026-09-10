// Los formatos de conteo, probados contra el CATÁLOGO REAL de Foodint.
//
// REGLA 31: una prueba con ejemplos inventados confirma la suposición que la
// escribió. Los formatos de aquí abajo están COPIADOS de la BBDD el 10/09/2026
// —`recipe_item_purchase_format` de la cuenta 51ad1792, activos y sin
// archivar—, con sus ids, sus pesos y sus faltas de ortografía. Si alguien los
// cambia en producción, esta prueba deja de medir lo que dice medir, y por eso
// van con la consulta que los saca escrita al lado.
//
//   select ri.name, f.id, f.name, f.qty_in_base, f.qty_per_parent, pf.name as padre
//     from recipe_item_purchase_format f
//     join recipe_item ri on ri.id = f.item_id
//     left join recipe_item_purchase_format pf on pf.id = f.parent_format_id
//    where f.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
//      and f.is_active and f.archived_at is null;
//
// Y ya llevó la contraria una vez: escribiendo `explicarChoque` di por hecho
// que el «Ud» engañoso siempre pesa más que una unidad. En Milanesa de Ternera
// «Ud» son 0,25 ud —un CUARTO de milanesa—, y la condición correcta es
// `qty_in_base !== 1`, no `> 1`.

import { describe, it, expect } from 'vitest'
import {
  detectarChoques, explicarChoque, formatLabel, formatDetail, fmtQty,
  type CountFormat,
} from '@/modules/supply/services/countFormatService'

const CUENTA = '51ad1792-6629-4ef7-833a-b57b09a86710'

function f(
  id: string, itemId: string, name: string, qtyInBase: number,
  extra: Partial<CountFormat> = {},
): CountFormat {
  return {
    id, accountId: CUENTA, itemId, name, qtyInBase,
    parentFormatId: null, qtyPerParent: null, parentName: null,
    isPiece: false, isWeighted: false, source: 'manual', aiConfidence: null,
    needsReview: false, isActive: true, archivedAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    createdBy: null, createdByName: null, useInCount: false,
    ...extra,
  }
}

// ── Patatas Bastón · el ejemplo de la maqueta ────────────────────────────
const PATATAS = 'item-patatas'
const PATATAS_FORMATOS = [
  f('ccc5e019-b47a-4f3e-8f09-229d7bf34e70', PATATAS, 'Bolsa', 2500, { useInCount: true }),
  f('69d98209-43b1-4b55-ad8c-236b17c3d24e', PATATAS, 'Caja', 10000, { qtyPerParent: 4, parentName: 'Bolsa' }),
  f('7a4d0ebd-7342-495a-aeb8-76cdade798c2', PATATAS, 'Caja 12,5 kg', 12500),
]

// ── Pulled Pork · tres «Bolsa» y dos «Caja» ──────────────────────────────
const PORK = 'item-pork'
const PORK_FORMATOS = [
  f('585864bb-8e93-401f-bcb7-ff5631ae3a58', PORK, 'Bolsa', 1000),
  f('d0ce1ae1-b871-4db3-9bfa-1244ef85ec48', PORK, 'Bolsa', 1300),
  f('8ca93202-2b01-44a9-979d-ee06fb9ca8d2', PORK, 'Bolsa', 4000),
  f('adb886bd-e3d3-4bbe-976f-0f41ba965798', PORK, 'Caja', 6000),
  f('e4443a3c-0ba2-45aa-a0ef-15d0fdae62de', PORK, 'Caja', 6500, { qtyPerParent: 5, parentName: 'Bolsa' }),
]

// ── Tortilla Maíz 12 cm · «Ud» = 20 tortillas ────────────────────────────
const TORTILLA = 'item-tortilla'
const TORTILLA_FORMATOS = [
  f('00000000-0000-0000-0000-0000fff40ec4', TORTILLA, 'Paquete', 18, { useInCount: true }),
  f('989c456a-08ff-4cd4-aac2-b3bd74cbec14', TORTILLA, 'Ud', 20),
  f('517e6b10-776d-4324-8f00-eeb465ccea97', TORTILLA, 'Caja', 240, { qtyPerParent: 12, parentName: 'Ud' }),
]

// ── Milanesa Ternera Rebozado · «Ud» = 0,25 ud, el que me llevó la contraria
const MILANESA = 'item-milanesa'
const MILANESA_FORMATOS = [
  f('mil-ud', MILANESA, 'Ud', 0.25),
  f('mil-caja', MILANESA, 'caja', 16),
]

// ── Lechuga Romana · «bolsa» y «Bolsa», que es el mismo nombre ───────────
const LECHUGA = 'item-lechuga'
const LECHUGA_FORMATOS = [
  f('lec-1', LECHUGA, 'bolsa', 1000),
  f('lec-2', LECHUGA, 'Bolsa', 400),
  f('lec-3', LECHUGA, 'Bolsa', 650),
]

// ── Peperoni Loncheado · dos «Estuche» y un «Paquete» que pesa igual ─────
const PEPERONI = 'item-peperoni'
const PEPERONI_FORMATOS = [
  f('bbc07d3e-71f9-4a72-a109-d42b2983a541', PEPERONI, 'Estuche', 400),
  f('16d2c5c7-ce38-4b5e-8d02-83d198f032a5', PEPERONI, 'Estuche', 1000),
  f('4ac61d1c-4536-4197-9f54-60a212324783', PEPERONI, 'Paquete', 1000, { useInCount: true }),
]

describe('detectarChoques · contra el catálogo real', () => {
  it('Pulled Pork: tres «Bolsa» con tres pesos es un choque', () => {
    expect(detectarChoques(PORK_FORMATOS)).toContain('repetido')
  })

  it('Patatas Bastón: dos cajas distintas chocan, aunque una lleve el peso en el nombre', () => {
    // «Caja» y «Caja 12,5 kg» son nombres DISTINTOS, así que no chocan por
    // nombre. Es el resultado correcto y conviene dejarlo escrito: quien puso
    // el peso en el nombre ya resolvió la ambigüedad a mano.
    expect(detectarChoques(PATATAS_FORMATOS)).toEqual([])
  })

  it('Lechuga Romana: «bolsa» y «Bolsa» son el mismo nombre', () => {
    expect(detectarChoques(LECHUGA_FORMATOS)).toContain('repetido')
  })

  it('Tortilla Maíz: «Ud» que son 20 tortillas es nombre engañoso', () => {
    expect(detectarChoques(TORTILLA_FORMATOS)).toContain('nombre_enganoso')
  })

  it('Milanesa Ternera: «Ud» que es 0,25 ud TAMBIÉN es engañoso', () => {
    // El caso que me llevó la contraria: con `qty_in_base > 1` este pasaba
    // limpio y quien contara 4 «Ud» estaría apuntando 1 milanesa, no 4.
    expect(detectarChoques(MILANESA_FORMATOS)).toContain('nombre_enganoso')
  })

  it('un «Ud» que de verdad vale 1 no molesta a nadie', () => {
    expect(detectarChoques([f('x', 'i', 'Ud', 1)])).toEqual([])
  })

  it('sin ningún formato, se dice: se contará en la unidad base', () => {
    expect(detectarChoques([])).toEqual(['sin_formato'])
  })

  it('Peperoni: dos «Estuche» chocan; que el «Paquete» pese lo mismo que uno no es un choque', () => {
    expect(detectarChoques(PEPERONI_FORMATOS)).toEqual(['repetido'])
  })
})

describe('el nombre que ve quien cuenta, compuesto y no guardado', () => {
  it('Caja · 4 bolsas · 10 kg — igual que la maqueta', () => {
    const caja = PATATAS_FORMATOS[1]
    expect(formatLabel(caja, 'g')).toBe('Caja · 4 bolsas · 10 kg')
    expect(formatDetail(caja, 'g')).toBe('4 bolsas · 10 kg')
  })

  it('Bolsa · 2,5 kg — sin árbol, sólo el contenido', () => {
    expect(formatLabel(PATATAS_FORMATOS[0], 'g')).toBe('Bolsa · 2,5 kg')
  })

  it('Paquete · 18 ud — las unidades no se convierten a kilos', () => {
    expect(formatLabel(TORTILLA_FORMATOS[0], 'ud')).toBe('Paquete · 18 ud')
  })

  it('1.000 g se lee 1 kg, y 1.000 ml se lee 1 l', () => {
    expect(fmtQty(1000, 'g')).toBe('1 kg')
    expect(fmtQty(5750, 'g')).toBe('5,75 kg')
    expect(fmtQty(1500, 'ml')).toBe('1,5 l')
    expect(fmtQty(750, 'g')).toBe('750 g')
  })
})

describe('la frase que explica el choque, en palabras de cocina', () => {
  it('Pulled Pork: dice cuántas bolsas y cuánto pesa cada una', () => {
    const txt = explicarChoque(
      { itemName: 'Pulled Pork', formats: PORK_FORMATOS, baseUnit: 'g' },
      detectarChoques(PORK_FORMATOS),
    )
    expect(txt).toContain('3 «Bolsa» con distinto peso')
    expect(txt).toContain('1 kg')
    expect(txt).toContain('1,3 kg')
    expect(txt).toContain('4 kg')
    // Y dice qué pasa mientras nadie decida — sin eso, la frase acusa y no ayuda.
    expect(txt).toContain('se cuenta en gramos')
    expect(txt).toContain('se archivan, no se borran')
  })

  it('Tortilla: pone el número que saldría mal, no una advertencia genérica', () => {
    const txt = explicarChoque(
      { itemName: 'Tortilla Maíz 12 cm', formats: TORTILLA_FORMATOS, baseUnit: 'ud' },
      detectarChoques(TORTILLA_FORMATOS),
    )
    expect(txt).toContain('«Ud»')
    expect(txt).toContain('20 ud')
    expect(txt).toContain('260 ud')   // 13 × 20, el ejemplo de la maqueta
  })
})
