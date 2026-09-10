// tests/unit/modules/supply/dudaDeKilos.test.ts
//
// «¿1,01 kg?» — la pregunta de la casilla de gramos (10/09/2026, tarde).
//
// REGLA 31: los casos NO son inventados. Son las OCHO entradas `peso` que hay
// en `inventory_count_entry` el 10/09 a las 19:00, con la unidad base real de
// su artículo. Una sola tiene decimales, y es justo la que Julio vio fallar.
//
// Escribirla así es lo que da la respuesta a la pregunta que importa: ¿cuántas
// veces va a saltar esto en un servicio normal? Una de ocho, y en la que hacía
// falta. Con ejemplos de mi cabeza no habría sabido si el umbral de las 1.000
// unidades molesta a alguien: aquí se ve que Caldo de Birria (1.900 g), Salsa
// Mil Islas (2.613 g) y Bacon Ahumado (2.400 g) pasan sin preguntar nada.

import { describe, it, expect } from 'vitest'
import { dudaDeKilos } from '@/modules/supply/lib/conteoMovilTexto'

/** Las 8 entradas `peso` reales, tal cual salen de la BBDD. */
const REALES: { articulo: string; unidad: string; tecleado: string }[] = [
  { articulo: 'Patatas Bastón',                   unidad: 'g',  tecleado: '1,011' },
  { articulo: 'Hamburguesa Mixta 85 Grs 142 Und', unidad: 'ud', tecleado: '119'   },
  { articulo: 'Pan Hamburguesa',                  unidad: 'ud', tecleado: '12'    },
  { articulo: 'Salsa Tzatziki 200g',              unidad: 'ud', tecleado: '9'     },
  { articulo: 'Tortilla Maíz 12 cm',              unidad: 'ud', tecleado: '14'    },
  { articulo: 'Caldo de Birria',                  unidad: 'g',  tecleado: '1900'  },
  { articulo: 'Salsa Mil Islas',                  unidad: 'g',  tecleado: '2613'  },
  { articulo: 'Bacon Ahumado',                    unidad: 'g',  tecleado: '2400'  },
]

describe('dudaDeKilos · contra las 8 entradas peso reales', () => {
  it('pregunta en UNA sola de las ocho, y es Patatas Bastón', () => {
    const preguntadas = REALES
      .filter(r => dudaDeKilos(r.tecleado, r.unidad) !== null)
      .map(r => r.articulo)
    expect(preguntadas).toEqual(['Patatas Bastón'])
  })

  it('a Patatas Bastón le ofrece el kilo, que es lo que quería decir', () => {
    const d = dudaDeKilos('1,011', 'g')
    expect(d).not.toBeNull()
    expect(d!.comoEsta).toBe(1.011)
    expect(d!.enGrande).toBeCloseTo(1011, 6)
    expect(d!.unidadGrande).toBe('kg')
    // Espacio de NO SEPARACIÓN entre la cifra y la unidad.
    expect(d!.frase).toBe('1,011 kg')
  })

  it('las tres de más de 1.000 g pasan sin preguntar', () => {
    for (const t of ['1900', '2613', '2400']) {
      expect(dudaDeKilos(t, 'g')).toBeNull()
    }
  })

  it('en unidades («ud») no pregunta nunca: un decimal ahí es otra cosa', () => {
    expect(dudaDeKilos('119', 'ud')).toBeNull()
    expect(dudaDeKilos('1,5', 'ud')).toBeNull()
    expect(dudaDeKilos('1,5', null)).toBeNull()
  })
})

describe('dudaDeKilos · los bordes', () => {
  it('un entero no molesta a nadie, por pequeño que sea', () => {
    expect(dudaDeKilos('250', 'g')).toBeNull()
    expect(dudaDeKilos('1', 'g')).toBeNull()
  })

  it('el medio kilo escrito «0,5» también pregunta', () => {
    const d = dudaDeKilos('0,5', 'g')
    expect(d!.enGrande).toBe(500)
    expect(d!.frase).toBe('0,5 kg')
  })

  it('en ml la unidad grande es el litro', () => {
    const d = dudaDeKilos('1,25', 'ml')
    expect(d!.unidadGrande).toBe('l')
    expect(d!.enGrande).toBe(1250)
    expect(d!.frase).toBe('1,25 l')
  })

  it('el punto como separador decimal vale igual que la coma', () => {
    expect(dudaDeKilos('1.011', 'g')!.enGrande).toBeCloseTo(1011, 6)
  })

  it('justo en 1.000 no pregunta: leerlo como kilos daría una tonelada', () => {
    expect(dudaDeKilos('1000,5', 'g')).toBeNull()
    expect(dudaDeKilos('999,5', 'g')!.enGrande).toBe(999500)
  })

  it('vacío, cero y negativo no son preguntas', () => {
    expect(dudaDeKilos('', 'g')).toBeNull()
    expect(dudaDeKilos('0', 'g')).toBeNull()
    expect(dudaDeKilos('-1,5', 'g')).toBeNull()
    expect(dudaDeKilos('abc', 'g')).toBeNull()
  })
})
