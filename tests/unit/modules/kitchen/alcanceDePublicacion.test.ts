// El alcance de una publicación, con nombres. Es la función que decide qué lee
// alguien justo antes de reemplazar el escaparate vivo de un local, así que lo
// que se prueba aquí no es el formato: es que NUNCA diga un número donde tiene
// que decir nombres, y que pida consentimiento cuando toca a más de uno.

import { describe, it, expect } from 'vitest'
import { alcanceDePublicacion, enumeraNombres } from '@/modules/kitchen/services/catalogPublishService'

const ALCALA = { id: 'a1', name: 'Foodint Alcalá' }
const CARABANCHEL = { id: 'c1', name: 'Foodint Carabanchel' }

describe('enumeraNombres', () => {
  it('sin nombres devuelve cadena vacía, no «0 locales»', () => {
    expect(enumeraNombres([])).toBe('')
  })
  it('uno solo va tal cual', () => {
    expect(enumeraNombres(['Foodint Alcalá'])).toBe('Foodint Alcalá')
  })
  it('dos se unen con «y», sin coma', () => {
    expect(enumeraNombres(['A', 'B'])).toBe('A y B')
  })
  it('tres o más: comas y una «y» final, y salen TODOS', () => {
    expect(enumeraNombres(['A', 'B', 'C', 'D'])).toBe('A, B, C y D')
  })
})

describe('alcanceDePublicacion', () => {
  it('un local elegido: su nombre, y no pide consentimiento aparte', () => {
    const a = alcanceDePublicacion('a1', [ALCALA, CARABANCHEL])
    expect(a.ids).toEqual(['a1'])
    expect(a.frase).toBe('Foodint Alcalá')
    expect(a.esMultiple).toBe(false)
    expect(a.desconocido).toBe(false)
  })

  it('toda la cuenta con dos locales: los NOMBRES, nunca «los 2 locales»', () => {
    const a = alcanceDePublicacion(null, [ALCALA, CARABANCHEL])
    expect(a.ids).toEqual(['a1', 'c1'])
    expect(a.frase).toBe('Foodint Alcalá y Foodint Carabanchel')
    expect(a.frase).not.toMatch(/\d/)
    expect(a.esMultiple).toBe(true)
  })

  it('toda la cuenta con un solo local: es ese local, y no es múltiple', () => {
    const a = alcanceDePublicacion(null, [ALCALA])
    expect(a.frase).toBe('Foodint Alcalá')
    expect(a.esMultiple).toBe(false)
  })

  // El caso que importa: si no se sabe a dónde va, se dice y se pide el sí.
  // Callarlo sería publicar a ciegas con cara de saber lo que se hace.
  it('toda la cuenta sin haber podido leer los locales: lo dice y pide consentimiento', () => {
    const a = alcanceDePublicacion(null, [])
    expect(a.desconocido).toBe(true)
    expect(a.esMultiple).toBe(true)
    expect(a.frase).toContain('no se han podido leer')
  })

  it('un id que no está en la lista: no se inventa un nombre', () => {
    const a = alcanceDePublicacion('zzz', [ALCALA])
    expect(a.desconocido).toBe(true)
    expect(a.nombres).toEqual([])
    expect(a.frase).not.toContain('zzz')
  })
})
