// tests/unit/modules/kitchen/formatosDeCompra.test.ts
//
// Las reglas de los formatos de compra, probadas contra la POBLACIÓN REAL
// (regla 31): los 165 enlaces vivos con denominación de proveedor de Foodint,
// leídos de la base el 19/09/2026. Con ejemplos inventados esta prueba sería
// un espejo de quien escribió la regla; con los nombres de verdad, lleva la
// contraria — y de hecho la llevó: la primera versión de «No cuadra» sellaba
// OCHO enlaces, y seis eran cajas aplanadas cuyo total era correcto.

import { describe, it, expect } from 'vitest'
import {
  elTextoNoCuadra,
  magnitudesDelTexto,
  enterosDelTexto,
  cuentaDelFormato,
  frasePack,
  articulosConProveedorRepetido,
  plural,
  comoSeCuenta,
  loQueVaACambiar,
  type FormatoParaRegla,
} from '@/modules/kitchen/lib/formatosDeCompra'
import { ENLACES_REALES } from './formatosDeCompra.poblacionReal'

function formatoDe(e: (typeof ENLACES_REALES)[number]): FormatoParaRegla {
  return {
    nombre: e.formato,
    qtyInBase: e.qtyInBase,
    qtyPerParent: e.qtyPerParent,
    innerQtyInBase: e.innerQtyInBase,
    innerNombre: null,
  }
}

describe('la población real es la que se midió', () => {
  it('son los 165 enlaces vivos con denominación', () => {
    expect(ENLACES_REALES).toHaveLength(165)
  })
})

describe('«No cuadra» sobre la población real', () => {
  const sellados = ENLACES_REALES.filter((e) =>
    elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) }),
  )

  it('sella exactamente UNO: el único que no se explica de ninguna manera', () => {
    expect(sellados.map((e) => `${e.articulo} · ${e.proveedor}`)).toEqual([
      'Aceite de Oliva Suave 0,4º · MAKRO DISTRIBUCION MAYORISTA SA',
    ])
  })

  it('un número pegado al nombre del producto es el peso de una PIEZA, no del envase', () => {
    // Corrección de Julio (19/09): «POLLO DELICIAS SUREÑAS METEORITOS 35G» —
    // 35 g es un meteorito de pollo. Que 2.200 no sea múltiplo de 35 no dice
    // nada malo del formato: se vende al peso.
    //
    // Y la medida que llevó la contraria a la pregunta: se preguntó cuántos de
    // los 115 textos comparables nombraban el peso de la pieza esperando que
    // fueran varios, y es UNO. La regla no se cambió por esa fila, se cambió
    // por su significado — «una magnitud solo habla del envase si lleva
    // delante una palabra de envase o de tamaño» — y el coste va medido en la
    // prueba de abajo.
    const e = ENLACES_REALES.find((x) => x.articulo === 'DELICIAS DE POLLO SOUTHERN')!
    expect(magnitudesDelTexto(e.texto, e.baseDim)).toEqual([35])
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(false)
  })

  it('el coste de esa corrección, con el número delante', () => {
    // Cuántos enlaces siguen siendo comprobables. Si alguien toca la lista de
    // palabras o la ventana, este número se mueve y se ve. 115 antes, 93 ahora:
    // 22 dejan de poder comprobarse porque su tamaño va pegado al nombre del
    // producto y desde fuera no hay forma de saber de qué habla.
    const comprobables = ENLACES_REALES.filter((e) => {
      const f = formatoDe(e)
      // un enlace es comprobable si, quitándole el formato, la regla tendría
      // algo que comparar: se detecta poniéndole un total imposible.
      return elTextoNoCuadra({
        texto: e.texto,
        baseDim: e.baseDim,
        formato: { ...f, qtyInBase: 123456789, qtyPerParent: null, innerQtyInBase: null },
      })
    })
    expect(comprobables).toHaveLength(93)
  })

  it('el caso que puso Julio: su texto dice 250 ml y el formato 1.000 ml', () => {
    const e = ENLACES_REALES.find((x) => x.articulo === 'Aceite de Oliva Suave 0,4º')!
    expect(magnitudesDelTexto(e.texto, e.baseDim)).toEqual([250])
    expect(e.qtyInBase).toBe(1000)
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(true)
  })

  it('una CAJA APLANADA no se sella: el total es correcto, lo perdido es la forma', () => {
    // «GUACAMOLE CONGELADO CAJA 8 BOLSAS DE 500 GR» guardado como un único
    // nodo de 4.000 g. 8 × 500 = 4.000: el número no miente.
    const e = ENLACES_REALES.find(
      (x) => x.articulo === 'Guacamole' && x.proveedor === 'CLOUDTOWN, S.L.',
    )!
    expect(magnitudesDelTexto(e.texto, e.baseDim)).toEqual([500])
    expect(enterosDelTexto(e.texto)).toContain(8)
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(false)
  })

  it('el árbol bueno se explica por sus tres lecturas (total, piezas, contenido)', () => {
    // «ALUBIA ROJA COCIDA EXTRA CAJA 6 UD DE 3 KG» → Caja 18.000 g, 6 × 3.000.
    // Ninguna magnitud vale 18.000; casa por el contenido de la pieza.
    const e = ENLACES_REALES.find(
      (x) => x.articulo === 'Alubias rojas' && x.proveedor === 'CLOUDTOWN, S.L.',
    )!
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(false)
  })

  it('«1600gne» es gramos netos de Makro, y por eso no se sella', () => {
    const e = ENLACES_REALES.find(
      (x) => x.articulo === 'Alubias rojas' && x.proveedor.startsWith('MAKRO'),
    )!
    expect(magnitudesDelTexto(e.texto, e.baseDim)).toContain(1600)
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(false)
  })

  it('una magnitud de otra dimensión no dice nada del formato', () => {
    // «AGUA MINERAL FUENTEVERA 50CL» sobre un artículo que se cuenta en ud.
    const e = ENLACES_REALES.find((x) => x.texto === 'AGUA MINERAL FUENTEVERA 50CL')!
    expect(magnitudesDelTexto(e.texto, e.baseDim)).toEqual([])
    expect(elTextoNoCuadra({ texto: e.texto, baseDim: e.baseDim, formato: formatoDe(e) })).toBe(false)
  })

  it('«2 Latas» no se lee como 2 litros (por eso la lista es blanca)', () => {
    expect(magnitudesDelTexto('CAJA DE 2 LATAS', 'volume')).toEqual([])
  })

  it('sin texto o sin formato no hay sello: no se grita sobre lo que no se sabe', () => {
    expect(elTextoNoCuadra({ texto: null, baseDim: 'weight', formato: null })).toBe(false)
    expect(
      elTextoNoCuadra({
        texto: 'BOTE 900 GR',
        baseDim: 'weight',
        formato: null,
      }),
    ).toBe(false)
  })
})

describe('la frase y la cuenta', () => {
  it('la caja con piezas se lee como una frase', () => {
    const f: FormatoParaRegla = {
      nombre: 'Caja',
      qtyInBase: 5790,
      qtyPerParent: 6,
      innerQtyInBase: 965,
      innerNombre: 'Bote',
    }
    expect(frasePack(f, 'g')).toEqual({
      caja: 'Caja',
      cuantas: 6,
      pieza: 'Bote',
      contenido: '965 g',
    })
    // La Salsa Smokey Baconesa, que es lo que Julio no podía escribir.
    expect(cuentaDelFormato(f, 'g')).toBe('1 Caja = 6 Botes × 965 g = 5.790 g')
  })

  it('un total suelto se lee sin inventarse piezas', () => {
    const f: FormatoParaRegla = {
      nombre: 'Bidón',
      qtyInBase: 25000,
      qtyPerParent: null,
      innerQtyInBase: null,
      innerNombre: null,
    }
    expect(frasePack(f, 'ml')).toBeNull()
    expect(cuentaDelFormato(f, 'ml')).toBe('1 Bidón = 25.000 ml')
  })
})

describe('«Repetido»', () => {
  it('marca el artículo cuando el mismo proveedor aparece dos veces', () => {
    // Aceite Alto Oleico: Cloudtown con referencia 510101002 y Cloudtown sin
    // referencia. No es descuido: learn_from_receipt guarda una fila por
    // referencia MÁS una con referencia nula.
    const repes = articulosConProveedorRepetido([
      { recipeItemId: 'alto-oleico', supplierId: 'cloudtown' },
      { recipeItemId: 'alto-oleico', supplierId: 'cloudtown' },
      { recipeItemId: 'alto-oleico', supplierId: 'makro' },
      { recipeItemId: 'alubias', supplierId: 'cloudtown' },
      { recipeItemId: 'alubias', supplierId: 'makro' },
    ])
    expect([...repes]).toEqual(['alto-oleico'])
  })

  it('dos proveedores distintos no son un repetido', () => {
    expect(
      articulosConProveedorRepetido([
        { recipeItemId: 'a', supplierId: 'x' },
        { recipeItemId: 'a', supplierId: 'y' },
      ]).size,
    ).toBe(0)
  })
})


describe('el plural, que salía en la línea más leída de la ficha', () => {
  it('no vuelve a pluralizar lo que ya está en plural', () => {
    // Lo que se veía en el preview del 19/09: «latases», «boteses».
    expect(plural('Latas', 2)).toBe('Latas')
    expect(plural('botes', 2)).toBe('botes')
    expect(plural('bolsas', 2)).toBe('bolsas')
  })

  it('sigue pluralizando lo que sí es singular', () => {
    expect(plural('Caja', 2)).toBe('Cajas')
    expect(plural('Bote', 2)).toBe('Botes')
    expect(plural('Bidón', 2)).toBe('Bidones')  // la tilde se cae
    expect(plural('Lata', 1)).toBe('Lata')
  })

  it('los 4 nombres vivos acabados en «s» de Foodint quedan intactos', () => {
    // Medido el 19/09: de 281 formatos vivos, 4 acaban en «s» y los cuatro son
    // de verdad plurales. Ninguno es una palabra singular acabada en «s».
    for (const n of ['bolsas', 'botes', 'Latas']) {
      expect(plural(n, 2)).toBe(n)
    }
  })
})

describe('«Se cuenta en …», con el caso real de Alubias rojas', () => {
  it('no funde dos envases distintos que se llaman casi igual', () => {
    // En la base: Caja = 18.000, Lata = 1.600 y Latas = 3.000, los tres
    // marcados para contar. «Lata» y «Latas» NO son un duplicado: son dos
    // envases distintos. Fundirlos escondería una fila que existe.
    expect(
      comoSeCuenta(
        [
          { nombre: 'Latas', qtyInBase: 3000 },
          { nombre: 'Caja', qtyInBase: 18000 },
          { nombre: 'Lata', qtyInBase: 1600 },
        ],
        'g',
      ),
    ).toBe('latas de 3.000 g · cajas · latas de 1.600 g')
  })

  it('cuando no chocan, el nombre va solo y se une con «·»', () => {
    expect(comoSeCuenta([{ nombre: 'Caja', qtyInBase: 5790 }, { nombre: 'Bote', qtyInBase: 965 }], 'g'))
      .toBe('cajas · botes')
  })

  it('sin ningún formato de conteo, se dice la unidad de siempre', () => {
    expect(comoSeCuenta([], 'g')).toBe('g')
  })
})

describe('C3 · lo que va a cambiar', () => {
  it('el precio de la caja no cambia; cambia cuánto trae, y por eso el gramo', () => {
    // Alubias rojas, Cloudtown, con los números de la base: 28,84 € la caja de
    // 18.000 g = 0,00160222… €/g. Si la caja pasara a 6 × 2.500 = 15.000 g,
    // la misma caja sale a 0,00192266… €/g.
    // El €/g se escribe como la división que lo produce: el literal con 20
    // decimales perdía precisión al compilarse (no-loss-of-precision) y además
    // escondía de dónde salía el número.
    const r = loQueVaACambiar({
      costeHastaHoy: 28.84 / 18000,
      totalHastaHoy: 18000,
      totalDesdeHoy: 15000,
    })
    expect(r.precioDelFormato).toBeCloseTo(28.84, 2)
    expect(r.costeDesdeHoy).toBeCloseTo(0.0019226666, 8)
  })

  it('sin precio de hoy no se inventa el de mañana', () => {
    expect(loQueVaACambiar({ costeHastaHoy: null, totalHastaHoy: 18000, totalDesdeHoy: 15000 }))
      .toEqual({ precioDelFormato: null, costeDesdeHoy: null })
  })

  it('sin total nuevo, se sabe el precio del formato pero no el coste nuevo', () => {
    const r = loQueVaACambiar({ costeHastaHoy: 0.002, totalHastaHoy: 1000, totalDesdeHoy: null })
    expect(r.precioDelFormato).toBeCloseTo(2, 6)
    expect(r.costeDesdeHoy).toBeNull()
  })
})
