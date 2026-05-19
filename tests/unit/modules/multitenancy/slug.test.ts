// tests/unit/modules/multitenancy/slug.test.ts
//
// Smoke tests de slugifyBrandName.
//
// Casos elegidos con intención:
//   - Marca real del proyecto con apóstrofe (Big Mike's)  → caso crítico
//   - Marcas reales sin caracteres especiales              → baseline
//   - Acentos / diéresis / ñ                               → es-ES
//   - Espacios múltiples y trim                            → input sucio
//   - Solo símbolos                                        → caso degenerado
//   - Mayúsculas mezcladas                                 → idempotencia case
//
// Nota: estos tests son funciones puras, no necesitan mock de Supabase.
// El environment 'node' del vitest.config basta.

import { describe, it, expect } from 'vitest'
import { slugifyBrandName } from '@/modules/multitenancy/services/brandsService'

describe('slugifyBrandName', () => {
  it('marca real del proyecto con apóstrofe: "Big Mike\'s"', () => {
    expect(slugifyBrandName("Big Mike's")).toBe('big-mike-s')
  })

  it('marca real sin caracteres especiales: "Lobbers"', () => {
    expect(slugifyBrandName('Lobbers')).toBe('lobbers')
  })

  it('marca real con dos palabras: "Smash Brothers"', () => {
    expect(slugifyBrandName('Smash Brothers')).toBe('smash-brothers')
  })

  it('marca real con dos palabras y plural: "Dos Coyotes"', () => {
    expect(slugifyBrandName('Dos Coyotes')).toBe('dos-coyotes')
  })

  it('elimina acentos castellanos: "Café Olé"', () => {
    expect(slugifyBrandName('Café Olé')).toBe('cafe-ole')
  })

  it('maneja ñ: "Año Nuevo"', () => {
    expect(slugifyBrandName('Año Nuevo')).toBe('ano-nuevo')
  })

  it('colapsa espacios y símbolos múltiples', () => {
    expect(slugifyBrandName('  Hola   ---   Mundo  ')).toBe('hola-mundo')
  })

  it('normaliza mayúsculas a minúsculas', () => {
    expect(slugifyBrandName('CHIVUOS')).toBe('chivuos')
  })

  it('input solo con símbolos → string vacío', () => {
    expect(slugifyBrandName('!!!---???')).toBe('')
  })

  it('idempotencia: slugificar un slug devuelve el mismo slug', () => {
    const once = slugifyBrandName('Big Mike\'s Burgers')
    const twice = slugifyBrandName(once)
    expect(twice).toBe(once)
  })

  it('no deja guiones sueltos al principio ni al final', () => {
    const result = slugifyBrandName('---Lobbers---')
    expect(result).toBe('lobbers')
    expect(result.startsWith('-')).toBe(false)
    expect(result.endsWith('-')).toBe(false)
  })
})
