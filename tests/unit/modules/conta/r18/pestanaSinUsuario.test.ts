// R18d · La pestaña de Sumied en Bitrix24 para todas las personas del portal, sin usuario de Sumied: quién es
// (user.current), lo que dice en cada caso que no enseña nada, y que la función y la pantalla dicen lo mismo.
import { describe, expect, it } from 'vitest'
import { FRASES, personaDeBitrix } from '../../../../../supabase/functions/conta-bitrix-pestana/puro'
import { FRASE_DE, tituloDeEstado, type Estado } from '@/publicas/bitrixPestanaModelo'

describe('R18d · quién mira, según Bitrix24 (user.current)', () => {
  it('con su id, su nombre y su correo (en minúsculas)', () => {
    expect(personaDeBitrix({ result: { ID: '2736', ACTIVE: true, NAME: 'Persona', LAST_NAME: 'De Prueba', EMAIL: ' Persona@Example.com ' } }))
      .toEqual({ id: '2736', nombre: 'Persona De Prueba', correo: 'persona@example.com' })
  })
  it('sin correo también entra (la pestaña ya no lo necesita para leer)', () => {
    expect(personaDeBitrix({ result: { ID: 7, NAME: 'Persona' } })).toEqual({ id: '7', nombre: 'Persona', correo: null })
  })
  it('sin nombre, uno que no es un código', () => {
    expect(personaDeBitrix({ result: { ID: '7', ACTIVE: 'Y' } })?.nombre).toBe('Persona 7 de Bitrix24')
  })
  it('una persona dada de baja, un id raro o una respuesta sin result no entran', () => {
    expect(personaDeBitrix({ result: { ID: '7', ACTIVE: false } })).toBeNull()
    expect(personaDeBitrix({ result: { ID: '7', ACTIVE: 'N' } })).toBeNull()
    expect(personaDeBitrix({ result: { ID: '7 or 1=1' } })).toBeNull()
    expect(personaDeBitrix({ error: 'expired_token' })).toBeNull()
    expect(personaDeBitrix(null)).toBeNull()
  })
})

describe('R18d · lo que dice la pestaña cuando no enseña nada', () => {
  const estados = Object.keys(FRASE_DE) as Exclude<Estado, 'ok'>[]
  it('la función y la pantalla dicen la misma frase', () => {
    for (const [k, f] of Object.entries(FRASES)) expect(FRASE_DE[k as Exclude<Estado, 'ok'>], k).toBe(f)
  })
  it('nunca «Sin acceso a Sumied» a secas, ni palabras de dentro', () => {
    for (const f of [...Object.values(FRASES), ...Object.values(FRASE_DE)]) {
      expect(f).not.toMatch(/^sin acceso/i)
      expect(f).not.toMatch(/_|rpc|jwt|token|uuid|placement|webhook/i)
    }
  })
  it('lo que no se arregla abriendo otra ficha dice a quién avisar', () => {
    for (const k of ['sin_acceso', 'portal_desconocido', 'portal_no_permitido', 'portal_sin_unir', 'cuenta_sin_administradora', 'no_es_sumied', 'varias_cuentas'] as const) {
      expect(FRASE_DE[k], k).toMatch(/avisa a quien administra|quien administra Bitrix24 tiene que/i)
    }
  })
  it('cada estado tiene un título claro; ninguno es «Sin acceso a Sumied»', () => {
    for (const e of estados) expect(tituloDeEstado(e)).not.toMatch(/^sin acceso/i)
    expect(tituloDeEstado('portal_sin_unir')).toBe('No puedes ver Sumied desde aquí')
    expect(tituloDeEstado('sin_enlazar')).toBe('Ficha sin enlazar')
  })
  it('solo leyendo, dice dónde se cambia', () => {
    expect(FRASE_DE.solo_lectura).toBe('Desde aquí solo se puede mirar. Para cambiar algo, entra en Sumied.')
  })
})
