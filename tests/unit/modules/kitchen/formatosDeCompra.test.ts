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

  it('sella exactamente los dos que no se explican de ninguna manera', () => {
    expect(sellados.map((e) => `${e.articulo} · ${e.proveedor}`)).toEqual([
      'Aceite de Oliva Suave 0,4º · MAKRO DISTRIBUCION MAYORISTA SA',
      'DELICIAS DE POLLO SOUTHERN · COHELDI, S.L.',
    ])
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
