import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fraseDeErrorTecnico, textoParaPantalla } from '@/modules/conta/lib/errorBase'

// Contra la población real (regla 31): los textos con los que paran las
// funciones del módulo, sacados de sus migraciones (C00 a C05), y el texto
// técnico que enseñó producción el 09/10.
const DIR = 'supabase/migrations'
const delModulo = readdirSync(DIR).filter((f) => /_c0[0-5][a-z]?r?_/.test(f) && f.endsWith('.sql'))
const escritosParaLaPantalla = [...new Set(delModulo.flatMap((f) =>
  [...readFileSync(`${DIR}/${f}`, 'utf8').matchAll(/raise exception '((?:[^']|'')+)'/gi)].map((m) => m[1].replace(/''/g, "'"))))]

describe('lo que se enseña cuando la base falla', () => {
  it('la población es la de verdad', () => {
    expect(delModulo.length).toBeGreaterThan(50)
    expect(escritosParaLaPantalla.length).toBeGreaterThan(200)
  })

  it('las frases de las funciones del módulo pasan tal cual', () => {
    const tocadas = escritosParaLaPantalla.filter((m) => fraseDeErrorTecnico({ message: m }) !== null)
    expect(tocadas).toEqual([])
  })

  it('el límite de tiempo (lo de producción del 09/10) se dice en palabras normales', () => {
    const deProduccion = { message: 'canceling statement due to statement timeout', code: '57014' }
    expect(fraseDeErrorTecnico(deProduccion)).toBe('Está tardando más de lo normal. Vuelve a intentarlo en un momento.')
    // Sin el código también: hay caminos que solo traen el texto.
    expect(fraseDeErrorTecnico({ message: 'conta_dias_por_asentar: canceling statement due to statement timeout' })).not.toBeNull()
  })

  it('la red caída y la sesión caducada, también', () => {
    expect(fraseDeErrorTecnico({ message: 'TypeError: Failed to fetch' })).toMatch(/conexión/)
    expect(fraseDeErrorTecnico({ message: 'JWT expired' })).toMatch(/sesión/)
  })

  it('el texto técnico va a la consola y no a la pantalla', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    const texto = textoParaPantalla('conta_dias_por_asentar', { message: 'canceling statement due to statement timeout', code: '57014' }, 'de siempre')
    expect(texto).not.toMatch(/canceling|statement|conta_dias/)
    expect(consola).toHaveBeenCalledWith('[conta] conta_dias_por_asentar: 57014 canceling statement due to statement timeout')
    consola.mockClear()
    // Una frase de la función: la de siempre, y nada a la consola.
    expect(textoParaPantalla('party_save_customer', { message: 'MISMO_NIF 0b5c…', code: 'P0001' }, 'party_save_customer: MISMO_NIF 0b5c…')).toBe('party_save_customer: MISMO_NIF 0b5c…')
    expect(consola).not.toHaveBeenCalled()
    consola.mockRestore()
  })
})
