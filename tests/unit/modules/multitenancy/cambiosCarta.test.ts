// tests/unit/modules/multitenancy/cambiosCarta.test.ts
//
// F01 · PR 2 · Las frases del tablero 5 con lo que devuelve f01_cambios_carta
// para El Delicioso en la unitaria de la base (f01bCambiosCarta.test.ts).

import { describe, expect, it } from 'vitest'
import { fraseRetirados, frasePrecios, hayCambios, leerCambios, lotePropuestos, pideDecidir, queHaceEnCocina, resumenCambios } from '@/modules/multitenancy/lib/cambiosCarta'

const deLaBase = [{
  brand_id: 'b3', nombre: 'El Delicioso Latin Food',
  platos_nuevos: [{ matricula: 'm77', nombre: 'AREPA DEL DÍA', precio: 8.5 }],
  extras_nuevos: [
    { modifier_id: 'm1', nombre: 'Doble de queso', pregunta: 'Extras', precio: 1.5, en_folvy: false, estado: 'propuesto',
      propuesta: { ficha: 'f1', ficha_nombre: 'Queso cheddar loncha', tipo: 'add_item', cantidad: 2, unidad: 'u1', unidad_nombre: 'ud' } },
    { modifier_id: 'm3', nombre: 'Sin cebolla', pregunta: 'Extras', precio: 0, en_folvy: false, estado: 'falta',
      propuesta: { ficha: 'f3', ficha_nombre: 'Cebolla morada', tipo: 'remove_item', cantidad: null, unidad: 'u2', unidad_nombre: 'kg' } },
    { modifier_id: 'm4', nombre: 'Salsa picante', pregunta: 'Extras', precio: 0.8, en_folvy: false, estado: 'falta', propuesta: null },
  ],
  retirados: [{ menu_item_id: 'i18', nombre: 'TEQUEÑO ED', visto: '2026-10-11T20:00:00Z' }],
  precios: [{ menu_item_id: 'i5', nombre: 'CHORIPAPA', canal: 'glovo', antes: 6.9, despues: 7.5 },
            { menu_item_id: 'i6', nombre: 'CHORIPOLLO', canal: 'glovo', antes: 11.9, despues: 12.5 }],
  precios_puestos_30d: 0,
}]

describe('los cambios de carta de una marca de Last (tablero 5)', () => {
  const [c] = leerCambios(deLaBase)
  it('el resumen del aviso de Inicio', () => {
    expect(resumenCambios(c)).toBe('1 plato nuevo · 3 extras sin decidir · 2 precios distintos · 1 plato que ya no está')
    expect(pideDecidir(c)).toBe(true)
  })
  it('lo que hace cada extra en cocina, y lo que falta', () => {
    expect(queHaceEnCocina(c.extrasNuevos[0])).toEqual({ frase: 'Añade', fuerte: 'Queso cheddar loncha · 2 ud' })
    expect(queHaceEnCocina(c.extrasNuevos[1])).toEqual({ frase: 'Quita de la receta (falta cuánto)', fuerte: 'Cebolla morada' })
    expect(queHaceEnCocina(c.extrasNuevos[2])).toEqual({ frase: 'No sé qué es. Elígelo del almacén.', fuerte: null })
  })
  it('solo se guardan los propuestos completos', () => {
    expect(lotePropuestos(c)).toEqual([{ modifier_id: 'm1', ficha: 'f1', tipo: 'add_item', cantidad: 2, unidad: 'u1' }])
  })
  it('los que se han ido y los precios, en una línea', () => {
    expect(fraseRetirados(c)).toBe('TEQUEÑO ED. Vistos por última vez el 11/10. Se quedan en la carta y en el histórico de ventas.')
    expect(frasePrecios(c)).toBe('2 precios distintos en Glovo')
  })
  it('una marca solo con platos que se han ido se enseña, pero no avisa', () => {
    const [r] = leerCambios([{ ...deLaBase[0], platos_nuevos: [], extras_nuevos: [], precios: [] }])
    expect([hayCambios(r), pideDecidir(r)]).toEqual([true, false])
  })
})
