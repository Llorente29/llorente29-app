// IBAN — C01 §5.2. ISO 13616-1 (módulo 97, ISO 7064 MOD 97-10).
//
// Casos con origen publicado:
//   · GB82WEST12345698765432 — ejemplo de la propia norma ISO 13616 y del
//     registro SWIFT de IBAN.
//   · DE89370400440532013000 — ejemplo del registro SWIFT (Alemania).
//   · ES9121000418450200051332 — ejemplo de IBAN español usado en la
//     documentación de bancos españoles; cuadra el módulo 97.
import { describe, it, expect } from 'vitest'
import { validarIban, formatearIban, enmascararIban, normalizarIban } from '@/modules/conta/lib/iban'

describe('IBAN válidos (origen: ISO 13616 / registro SWIFT)', () => {
  it.each([
    'GB82WEST12345698765432',
    'DE89370400440532013000',
    'ES9121000418450200051332',
  ])('%s', (iban) => expect(validarIban(iban).ok).toBe(true))

  it('acepta espacios y minúsculas, y guarda sin espacios en mayúsculas', () => {
    const r = validarIban('es91 2100 0418 4502 0005 1332')
    expect(r).toEqual({ ok: true, normalizado: 'ES9121000418450200051332', pais: 'ES' })
  })
})

describe('IBAN inválidos, con el mensaje que ve la persona', () => {
  it('un dígito cambiado falla el módulo 97', () => {
    expect(validarIban('ES9121000418450200051333')).toEqual({ ok: false, motivo: 'Este IBAN no es correcto: revisa los dígitos.' })
  })
  it('dos dígitos traspuestos también', () => {
    expect(validarIban('ES9121000418450200051323').ok).toBe(false)
  })
  it('un IBAN español que no tiene 24 caracteres se dice con la cuenta', () => {
    const r = validarIban('ES912100041845020005133')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/24 caracteres y este tiene 23/)
  })
  it('sin país delante', () => {
    expect(validarIban('9121000418450200051332').ok).toBe(false)
  })
  it('vacío', () => expect(validarIban('')).toEqual({ ok: false, motivo: 'Escribe el IBAN.' }))
})

describe('cómo se enseña', () => {
  it('en grupos de cuatro', () => {
    expect(formatearIban('ES9121000418450200051332')).toBe('ES91 2100 0418 4502 0005 1332')
  })
  it('enmascarado como en la maqueta: país y control, y los cuatro últimos', () => {
    expect(enmascararIban('ES9121000418450200051332')).toBe('ES91 •••• •••• 1332')
  })
  it('normalizar quita guiones y puntos', () => {
    expect(normalizarIban('es91-2100.0418')).toBe('ES9121000418')
  })
})
