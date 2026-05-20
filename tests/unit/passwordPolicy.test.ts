// tests/unit/passwordPolicy.test.ts
//
// Sprint 2 F2 (20/05/2026): tests sobre la política de password client-side.
//
// Cubre:
//   - PASSWORD_MIN_LENGTH constante.
//   - PASSWORD_REGEX edge cases.
//   - validatePassword() — devolución correcta de discriminated union.
//
// IMPORTANTE: estos tests verifican política CLIENT-SIDE. La política real
// (incluyendo leaked passwords con HaveIBeenPwned) vive en Supabase y NO
// se testea desde aquí.

import { describe, it, expect } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
  validatePassword,
} from '../../src/lib/passwordPolicy'

describe('PASSWORD_MIN_LENGTH', () => {
  it('es exactamente 8 (sincronizado con Supabase D-S2.14)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
  })
})

describe('PASSWORD_REGEX', () => {
  it('acepta password mínima válida (8 chars, las 3 categorías)', () => {
    expect(PASSWORD_REGEX.test('Abcdef12')).toBe(true)
  })

  it('acepta password larga con todas las categorías', () => {
    expect(PASSWORD_REGEX.test('MySecureP@ssw0rd2024')).toBe(true)
  })

  it('acepta caracteres especiales (no son requisito, pero no bloquean)', () => {
    expect(PASSWORD_REGEX.test('A1b!@#$%')).toBe(true)
    expect(PASSWORD_REGEX.test('Abc12345!')).toBe(true)
  })

  it('rechaza si tiene menos de 8 chars (aunque cumpla complejidad)', () => {
    expect(PASSWORD_REGEX.test('Abc123')).toBe(false)
    expect(PASSWORD_REGEX.test('Abc1234')).toBe(false)
  })

  it('rechaza si no tiene mayúsculas', () => {
    expect(PASSWORD_REGEX.test('abcdef12')).toBe(false)
    expect(PASSWORD_REGEX.test('password123')).toBe(false)
  })

  it('rechaza si no tiene minúsculas', () => {
    expect(PASSWORD_REGEX.test('ABCDEF12')).toBe(false)
    expect(PASSWORD_REGEX.test('PASSWORD123')).toBe(false)
  })

  it('rechaza si no tiene dígitos', () => {
    expect(PASSWORD_REGEX.test('Abcdefgh')).toBe(false)
    expect(PASSWORD_REGEX.test('MySecurePass')).toBe(false)
  })

  it('rechaza string vacío', () => {
    expect(PASSWORD_REGEX.test('')).toBe(false)
  })

  it('rechaza solo espacios (no son mayúscula/minúscula/dígito)', () => {
    expect(PASSWORD_REGEX.test('        ')).toBe(false)
  })

  it('acepta espacios INTERMEDIOS si el resto cumple', () => {
    // Espacios no rompen mientras haya minús+mayús+dígito y >=8 chars.
    expect(PASSWORD_REGEX.test('A1b 2 ef')).toBe(true)
  })

  it('rechaza unicode sin letras latinas básicas', () => {
    // Los lookaheads [a-z][A-Z] son ASCII. Una password en cirílico
    // o griego no pasaría aunque tuviera "mayúscula" en su alfabeto.
    expect(PASSWORD_REGEX.test('Пароль12')).toBe(false)
    expect(PASSWORD_REGEX.test('Παρόλα12')).toBe(false)
  })

  it('acepta unicode COMBINADO con ASCII si las 3 categorías ASCII están', () => {
    // Si añade letras unicode encima de una password ya válida, sigue OK.
    expect(PASSWORD_REGEX.test('Abc123ñü')).toBe(true)
  })

  it('rechaza passwords típicas filtradas (regex no las detecta)', () => {
    // Importante: el regex client-side NO detecta passwords débiles
    // semánticamente. Estas pasan el regex, pero Supabase las rechazaría
    // server-side por HaveIBeenPwned (D-S2.14: leaked passwords ON).
    // Este test documenta que el regex NO es la defensa contra passwords
    // comunes: solo la complejidad mínima de caracteres.
    expect(PASSWORD_REGEX.test('Password1')).toBe(true)
    expect(PASSWORD_REGEX.test('Welcome1')).toBe(true)
  })
})

describe('validatePassword', () => {
  it('password vacía → reason "empty"', () => {
    const result = validatePassword('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('empty')
    }
  })

  it('password corta → reason "too_short"', () => {
    const result = validatePassword('Ab1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too_short')
    }
  })

  it('password de 7 chars (justo bajo el mínimo) → too_short', () => {
    const result = validatePassword('Abcdef1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too_short')
    }
  })

  it('password 8+ chars sin mayúscula → missing_complexity', () => {
    const result = validatePassword('abcdef12')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('missing_complexity')
    }
  })

  it('password 8+ chars sin minúscula → missing_complexity', () => {
    const result = validatePassword('ABCDEF12')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('missing_complexity')
    }
  })

  it('password 8+ chars sin dígito → missing_complexity', () => {
    const result = validatePassword('Abcdefgh')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('missing_complexity')
    }
  })

  it('password válida → ok: true sin reason', () => {
    const result = validatePassword('Abcdef12')
    expect(result.ok).toBe(true)
    // No hay reason en el caso ok.
    if (result.ok) {
      // Type guard: TypeScript no expone reason cuando ok=true.
      expect((result as { reason?: string }).reason).toBeUndefined()
    }
  })

  it('discriminated union: TypeScript narrowing funciona', () => {
    const result = validatePassword('Abcdef12')
    // Si result.ok === true, NO existe result.reason.
    // Si TypeScript narrowing es correcto, este test pasa solo por compilar.
    if (result.ok) {
      const ok: true = result.ok
      expect(ok).toBe(true)
    } else {
      const reason: 'empty' | 'too_short' | 'missing_complexity' = result.reason
      expect(['empty', 'too_short', 'missing_complexity']).toContain(reason)
    }
  })
})
