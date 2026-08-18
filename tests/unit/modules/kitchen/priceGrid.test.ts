// tests/unit/modules/kitchen/priceGrid.test.ts
//
// Pruebas de las funciones PURAS de la rejilla de precios.
//
// Los datos de los fixtures NO son inventados: salen de la cuenta Foodint el
// 18/08/2026, y son justamente los casos que el encargo señala como límite.
// Aquí se comprueba el ORDEN DE CARTA (punto 1-bis) y las reglas de redondeo,
// bandas y lectura de precio. Lo que necesita red o sesión se verifica abriendo
// la pantalla, no aquí.

import { describe, it, expect, vi } from 'vitest'

// El módulo importa el cliente Supabase; estas funciones no lo usan, pero el
// import se evalúa igual. Se stubea para que no explote en entorno node.
vi.mock('../../../../src/lib/supabase', () => ({
  supabase: null,
  isSupabaseEnabled: false,
}))

import {
  agruparPorCarta, bandaDe, redondear, leerPrecio, expectedPriceBefore,
  precioObjetivo, pctReal, BANDA_APRIETA_HASTA,
  type GridProduct, type MenuOrder,
} from '@/modules/kitchen/services/priceGridService'

function prod(id: string, name: string, categoryId: string | null, categoryName: string | null): GridProduct {
  return { menuItemId: id, name, categoryId, categoryName, productType: null, basePrice: 10, vatRate: 10 }
}

function orden(
  cats: Array<[string, number, string]>,
  items: Array<[string, number]>,
): MenuOrder {
  return {
    categorias: new Map(cats.map(([id, position, name]) => [id, { position, name }])),
    productos: new Map(items),
  }
}

describe('agruparPorCarta · orden de la carta', () => {
  // Scandal Burgers, tal cual está en la base el 18/08: 7 bloques con producto.
  // Ojo: la marca tiene DOS categorías llamadas "Combo Scandal." (posiciones 0
  // y 2); la de la posición 2 no tiene productos y por eso no se pinta.
  const SCANDAL_CATS: Array<[string, number, string]> = [
    ['c-combo', 0, 'Combo Scandal.'],
    ['c-entrantes', 1, 'Entrantes'],
    ['c-scandal', 2, 'Scandal Burgers'],
    ['c-doble', 3, 'Doble Scandal Burgers'],
    ['c-pollo', 4, 'Burgers de Pollo'],
    ['c-postres', 5, 'Postres'],
    ['c-bebidas', 6, 'Bebidas'],
  ]

  it('lee Scandal Burgers en el orden de la carta, no por alfabeto', () => {
    // A propósito en orden alfabético de entrada: es lo que hacía la pantalla.
    const products = [
      prod('i-agua', 'Agua Mineral', 'c-bebidas', 'Bebidas'),
      prod('i-cheese', 'Cheesecake', 'c-postres', 'Postres'),
      prod('i-cola', 'Coca-Cola', 'c-bebidas', 'Bebidas'),
      prod('i-combo1', 'Combo Doble', 'c-combo', 'Combo Scandal.'),
      prod('i-nuggets', 'Nuggets', 'c-entrantes', 'Entrantes'),
      prod('i-pollo', 'Crispy Chicken', 'c-pollo', 'Burgers de Pollo'),
      prod('i-doble', 'Doble Bacon', 'c-doble', 'Doble Scandal Burgers'),
      prod('i-scandal', 'Scandal Classic', 'c-scandal', 'Scandal Burgers'),
    ]
    const o = orden(SCANDAL_CATS, [
      ['i-combo1', 0], ['i-nuggets', 0], ['i-scandal', 0], ['i-doble', 0],
      ['i-pollo', 0], ['i-cheese', 0], ['i-agua', 0], ['i-cola', 1],
    ])
    const secs = agruparPorCarta(products, o)
    expect(secs.map((s) => s.categoryName)).toEqual([
      'Combo Scandal.', 'Entrantes', 'Scandal Burgers', 'Doble Scandal Burgers',
      'Burgers de Pollo', 'Postres', 'Bebidas',
    ])
    // Y NO empieza por Agua Mineral, que es el síntoma que reportó Julio.
    expect(secs[0].products[0].name).not.toBe('Agua Mineral')
    expect(secs[0].products[0].name).toBe('Combo Doble')
  })

  it('ordena los productos DENTRO del bloque por menu_item.position', () => {
    const products = [
      prod('i-agua', 'Agua Mineral', 'c-bebidas', 'Bebidas'),
      prod('i-cola', 'Coca-Cola', 'c-bebidas', 'Bebidas'),
      prod('i-fanta', 'Fanta', 'c-bebidas', 'Bebidas'),
    ]
    // La carta pone la Coca-Cola primero aunque el alfabeto diga Agua.
    const o = orden([['c-bebidas', 6, 'Bebidas']], [['i-cola', 0], ['i-agua', 1], ['i-fanta', 2]])
    const secs = agruparPorCarta(products, o)
    expect(secs[0].products.map((p) => p.name)).toEqual(['Coca-Cola', 'Agua Mineral', 'Fanta'])
  })

  it('pone «Sin categoría» AL FINAL y no la esconde', () => {
    // Caso real: Lovers Burgers 1 de 23, Meraki Pita 1 de 32.
    const products = [
      prod('i-huerfano', 'Producto suelto', null, null),
      prod('i-bebida', 'Coca-Cola', 'c-bebidas', 'Bebidas'),
      prod('i-combo', 'Combo', 'c-combo', 'Combos.'),
    ]
    const o = orden([['c-combo', 0, 'Combos.'], ['c-bebidas', 4, 'Bebidas']], [])
    const secs = agruparPorCarta(products, o)
    expect(secs.map((s) => s.categoryName)).toEqual(['Combos.', 'Bebidas', 'Sin categoría'])
    expect(secs[secs.length - 1].categoryId).toBeNull()
    expect(secs[secs.length - 1].products).toHaveLength(1)
  })

  it('es estable con categorías que comparten position (The Urban Kebab)', () => {
    // Real: The Urban Kebab tiene SIETE categorías en la posición 0. Sin
    // desempate, el orden cambiaría entre cargas.
    const cats: Array<[string, number, string]> = [
      ['c-bowls', 0, 'Bowls y Platos'],
      ['c-combos', 0, 'Combos'],
      ['c-entrantes0', 0, 'Entrantes'],
      ['c-enrollados', 0, 'Kebabs Enrollados'],
      ['c-keburger0', 0, 'Keburger'],
      ['c-entrantes1', 1, 'Entrantes'],
      ['c-kebab', 2, 'Kebab'],
    ]
    const products = cats.map(([id, , name], i) => prod(`i-${i}`, `Producto ${i}`, id, name))
    const o = orden(cats, [])

    const a = agruparPorCarta(products, o).map((s) => `${s.categoryName}#${s.categoryId}`)
    // Segunda carga con los productos en otro orden de llegada: el resultado
    // tiene que ser EXACTAMENTE el mismo.
    const b = agruparPorCarta([...products].reverse(), o).map((s) => `${s.categoryName}#${s.categoryId}`)
    expect(b).toEqual(a)
    // Las cinco de position 0 van primero y alfabéticas entre ellas.
    expect(a.slice(0, 5)).toEqual([
      'Bowls y Platos#c-bowls', 'Combos#c-combos', 'Entrantes#c-entrantes0',
      'Kebabs Enrollados#c-enrollados', 'Keburger#c-keburger0',
    ])
    // Y las dos con nombre repetido NO se funden: son categorías distintas.
    expect(a.filter((x) => x.startsWith('Entrantes#'))).toHaveLength(2)
  })

  it('no rompe la pantalla si no hay orden: cae a alfabético', () => {
    const products = [
      prod('i-b', 'Zumo', 'c-bebidas', 'Bebidas'),
      prod('i-a', 'Agua', 'c-bebidas', 'Bebidas'),
      prod('i-c', 'Tarta', 'c-postres', 'Postres'),
    ]
    const secs = agruparPorCarta(products, null)
    expect(secs.map((s) => s.categoryName)).toEqual(['Bebidas', 'Postres'])
    expect(secs[0].products.map((p) => p.name)).toEqual(['Agua', 'Zumo'])
  })
})

describe('bandaDe · sin escandallo no hay margen', () => {
  it('null es «sin dato», nunca 0 %', () => {
    expect(bandaDe(null)).toBe('sin_dato')
    expect(bandaDe(NaN)).toBe('sin_dato')
  })
  it('separa pierde / aprieta / sano', () => {
    expect(bandaDe(-0.1)).toBe('pierde')
    expect(bandaDe(0)).toBe('aprieta')
    expect(bandaDe(BANDA_APRIETA_HASTA - 0.01)).toBe('aprieta')
    expect(bandaDe(BANDA_APRIETA_HASTA)).toBe('sano')
  })
})

describe('redondear · nunca contradice la operación', () => {
  it('sube al alza y baja a la baja en múltiplos de 10 cts', () => {
    expect(redondear(2.09, 1.90, 'decena')).toBe(2.10)
    expect(redondear(1.71, 1.90, 'decena')).toBe(1.70)
  })
  it('respeta un valor que ya cae en la escalera', () => {
    expect(redondear(2.10, 1.90, 'decena')).toBe(2.10)
  })
  it('sin escalera sólo redondea a céntimo', () => {
    expect(redondear(2.094, 1.90, 'ninguno')).toBe(2.09)
  })
  it('nunca devuelve un precio negativo', () => {
    expect(redondear(-5, 1, 'decena')).toBe(0)
  })
})

describe('leerPrecio · lo que teclea una persona', () => {
  it('acepta coma decimal y el símbolo del euro', () => {
    expect(leerPrecio('9,90')).toBe(9.9)
    expect(leerPrecio('12,50 €')).toBe(12.5)
    expect(leerPrecio('7.25')).toBe(7.25)
  })
  it('el campo vacío significa «volver a heredado»', () => {
    expect(leerPrecio('')).toBeNull()
    expect(leerPrecio('   ')).toBeNull()
  })
  it('lo que no es un precio se rechaza, no se convierte en 0', () => {
    expect(Number.isNaN(leerPrecio('hola') as number)).toBe(true)
    expect(Number.isNaN(leerPrecio('-3') as number)).toBe(true)
  })
})

describe('expectedPriceBefore · la guarda optimista', () => {
  it('sin override manda null: el servidor comprueba que sigue sin haberlo', () => {
    expect(expectedPriceBefore({ priceSource: 'base', isLocationOverride: false, price: 9.9 })).toBeNull()
  })
  it('con override manda el precio que la celda tenía delante', () => {
    expect(expectedPriceBefore({ priceSource: 'override', isLocationOverride: false, price: 9.9 })).toBe(9.9)
    expect(expectedPriceBefore({ priceSource: 'base', isLocationOverride: true, price: 8.5 })).toBe(8.5)
  })
})

describe('precioObjetivo y pctReal', () => {
  it('calcula el objetivo antes de redondear', () => {
    expect(precioObjetivo(10, { kind: 'pct', value: 10 })).toBeCloseTo(11)
    expect(precioObjetivo(10, { kind: 'eur', value: -1 })).toBeCloseTo(9)
    expect(precioObjetivo(10, { kind: 'set', value: 7.5 })).toBe(7.5)
    expect(precioObjetivo(10, { kind: 'base' })).toBeNull()
  })
  it('el porcentaje REAL es el de después de redondear', () => {
    // +10 % sobre 1,90 pide 2,09 y la escalera lo deja en 2,10: +10,53 %.
    expect(pctReal(1.90, 2.10)).toBeCloseTo(10.526, 2)
    expect(pctReal(0, 5)).toBeNull()
  })
})
