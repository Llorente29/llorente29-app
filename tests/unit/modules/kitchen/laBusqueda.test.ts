// tests/unit/modules/kitchen/laBusqueda.test.ts
//
// LOS DATOS SON REALES: lo que devolvió `kitchen_buscar('…','harissa',12)`
// sobre Foodint el 13/09 a las 20:2x, después de la corrección que agrupa por
// nombre. Es el ejemplo exacto que puso Julio, y trae dentro la razón de ser
// de la pantalla (regla 31).

import { describe, it, expect } from 'vitest'
import {
  elAntesDeBuscar, laReglaDeLaBusqueda, porQueHaSalido,
  tituloDePreguntas, tituloDeRespuestas, tituloDePlatos,
  lasCopiasDeUnaRespuesta, loApagadoDeUnaRespuesta, loQueNoCabe,
} from '@/modules/kitchen/lib/laBusqueda'
import type { LoEncontrado, UnaRespuestaEncontrada } from '@/modules/kitchen/lib/laBusqueda'

/** Medido, no escrito de memoria. */
const HARISSA: LoEncontrado = {
  texto: 'harissa',
  corto: false,
  tope: 12,
  cuantas: { fichas: 2, preguntas: 18, respuestas: 18, respuestasDistintas: 2, platos: 34 },
  fichas: [
    { id: '9d5cc2d5-7f28-47c1-8b92-821e14817493', nombre: 'Pasta Harissa' },
    { id: '8dc46a08-69a6-4593-ba19-39fc22a5381d', nombre: 'Salsa Mayo Harissa' },
  ],
  respuestas: [
    {
      id: 'r1', nombre: 'Salsa Harissa (Picante)', copias: 13, preguntas: 13, marcas: 2,
      marca: 'Meraki Pita', algunaActiva: true, todasActivas: true,
      ficha: 'Salsa Mayo Harissa', porque: 'las_dos',
    },
    {
      id: 'r2', nombre: 'Sin Salsa Harisa', copias: 5, preguntas: 5, marcas: 2,
      marca: 'Meraki Pita', algunaActiva: true, todasActivas: true,
      ficha: 'Salsa Mayo Harissa', porque: 'lleva_eso',
    },
  ],
  preguntas: [],
  platos: [],
}

describe('🔴 la razón de ser de la pantalla, con su caso real', () => {
  it('«Sin Salsa Harisa» sale, y sale porque LLEVA la harissa — no por su nombre', () => {
    // Está así en producción, con la errata: una sola ese. Buscando por nombre
    // no aparece jamás. El nombre lo escribió una persona con prisa; la ficha
    // dice la verdad.
    const x = HARISSA.respuestas.find((r) => r.nombre === 'Sin Salsa Harisa')!
    expect(x.porque).toBe('lleva_eso')
    expect(x.nombre.toLowerCase()).not.toContain('harissa')
    expect(porQueHaSalido(x.porque, 'harissa')).toBe('Lleva harissa')
  })

  it('y la que casa por las dos cosas lo dice, sin fingir que sólo es una', () => {
    const x = HARISSA.respuestas[0]
    expect(porQueHaSalido(x.porque, 'harissa')).toBe('Se llama así y además lo lleva')
  })

  it('cada motivo tiene su frase, y ninguna se queda sin ella', () => {
    for (const p of ['se_llama_asi', 'lleva_eso', 'las_dos', 'su_pregunta_lleva_eso'] as const) {
      expect(porQueHaSalido(p, 'harissa').length).toBeGreaterThan(3)
    }
    expect(porQueHaSalido('su_pregunta_lleva_eso', 'harissa')).toBe('Una de sus preguntas lleva harissa')
  })
})

describe('🔴 las dos cifras de las respuestas, que no son la misma', () => {
  it('el título cuenta NOMBRES (2), no filas (18)', () => {
    expect(tituloDeRespuestas(HARISSA)).toBe('2 respuestas')
    expect(HARISSA.cuantas.respuestas).toBe(18)
  })

  it('y las copias se dicen en la fila, porque son el trabajo que hay detrás', () => {
    expect(lasCopiasDeUnaRespuesta(HARISSA.respuestas[0]))
      .toBe('13 copias, en 13 preguntas de 2 marcas')
    expect(lasCopiasDeUnaRespuesta({ ...HARISSA.respuestas[0], copias: 1, preguntas: 1, marcas: 1 }))
      .toBe('En «Meraki Pita»')
  })

  it('13 + 5 = las 18 filas: las dos cifras cuadran entre sí', () => {
    const suma = HARISSA.respuestas.reduce((a, r) => a + r.copias, 0)
    expect(suma).toBe(HARISSA.cuantas.respuestas)
    expect(HARISSA.respuestas).toHaveLength(HARISSA.cuantas.respuestasDistintas)
  })
})

describe('🔴 el corte se dice, nunca se esconde (regla 7)', () => {
  it('con 34 platos y 12 en pantalla, dice cuántos faltan', () => {
    expect(loQueNoCabe(12, 34)).toBe('Hay 22 más que no caben en la lista. Afina la búsqueda para verlos.')
    expect(loQueNoCabe(12, 13)).toBe('Hay 1 más que no cabe en la lista. Afina la búsqueda para verlo.')
  })

  it('y cuando cabe todo, no se inventa una nota al pie', () => {
    expect(loQueNoCabe(2, 2)).toBeNull()
    expect(loQueNoCabe(12, 5)).toBeNull()
  })

  it('los títulos llevan el total DE VERDAD, no el de la lista cortada', () => {
    expect(tituloDePlatos(HARISSA)).toBe('34 platos')
    expect(tituloDePreguntas(HARISSA)).toBe('18 preguntas')
    expect(tituloDePlatos({ ...HARISSA, cuantas: { ...HARISSA.cuantas, platos: 1 } })).toBe('1 plato')
  })
})

describe('lo apagado y los vacíos', () => {
  it('si alguna copia está retirada se dice: una retirada no se vende', () => {
    const viva = HARISSA.respuestas[0]
    expect(loApagadoDeUnaRespuesta(viva)).toBeNull()
    const media: UnaRespuestaEncontrada = { ...viva, todasActivas: false, algunaActiva: true }
    expect(loApagadoDeUnaRespuesta(media)).toBe('Alguna de las copias está retirada')
    expect(loApagadoDeUnaRespuesta({ ...viva, todasActivas: false, algunaActiva: false }))
      .toBe('Todas retiradas')
  })

  it('una letra no es una búsqueda, y se dice por qué', () => {
    const corto: LoEncontrado = {
      ...HARISSA, texto: 'h', corto: true,
      cuantas: { fichas: 0, preguntas: 0, respuestas: 0, respuestasDistintas: 0, platos: 0 },
      fichas: [], respuestas: [],
    }
    expect(laReglaDeLaBusqueda(corto)).toBe('Con una letra sale media carta. Escribe al menos dos.')
  })

  it('no encontrar nada se dice entero, con la palabra buscada dentro', () => {
    const nada: LoEncontrado = {
      ...HARISSA, texto: 'zanahoria', corto: false,
      cuantas: { fichas: 0, preguntas: 0, respuestas: 0, respuestasDistintas: 0, platos: 0 },
      fichas: [], respuestas: [],
    }
    expect(laReglaDeLaBusqueda(nada)).toBe('Nada lleva «zanahoria», y nada se llama así.')
  })

  it('con dos fichas detrás, la regla dice que las hay antes de la lista', () => {
    expect(laReglaDeLaBusqueda(HARISSA)).toBe(
      '2 fichas de almacén se llaman así. Y esto es lo que la usa o se llama parecido.')
  })

  it('y el antes de escribir explica para qué sirve, no es un hueco', () => {
    expect(elAntesDeBuscar()).toContain('por lo que LLEVA')
    expect(elAntesDeBuscar()).toContain('harissa')
  })
})

describe('ningún identificador en pantalla', () => {
  it('ninguna frase enseña un uuid ni una clave de la base', () => {
    const todas = [
      elAntesDeBuscar(),
      laReglaDeLaBusqueda(HARISSA),
      tituloDeRespuestas(HARISSA), tituloDePreguntas(HARISSA), tituloDePlatos(HARISSA),
      lasCopiasDeUnaRespuesta(HARISSA.respuestas[0]),
      loQueNoCabe(12, 34) ?? '',
      ...(['se_llama_asi', 'lleva_eso', 'las_dos', 'su_pregunta_lleva_eso'] as const)
        .map((p) => porQueHaSalido(p, 'harissa')),
    ].join(' · ')
    expect(todas).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(todas).not.toMatch(/_id\b|account_id|modifier_|recipe_item|snake_case/)
  })
})
