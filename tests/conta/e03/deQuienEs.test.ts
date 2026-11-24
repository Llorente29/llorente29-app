// tests/conta/e03/deQuienEs.test.ts
//
// E03 · «¿De quién es esta factura?» (src/modules/conta/lib/deQuienEs.ts): la
// misma regla que la base (_conta_de_quien, 20261118T1833), con el NIF leído en
// las formas en que llega de una factura (con guion, con «ES» delante, en
// minúscula, con espacios y puntos). NIF inventados (T11): todo ceros o
// 12345678Z. La base la prueba supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql.

import { describe, expect, it } from 'vitest'
import { botonesDeQuien, casoDeQuien, claveNif, deLaBase, ETIQUETA_DE_QUIEN, SOLO_SUMIED } from '@/modules/conta/lib/deQuienEs'

const EMPRESA = 'B00000000'
const OTRAS = [{ id: 'otra', nif: 'A00000000' }]
const caso = (nifLeido: string | null, conIva = true) => casoDeQuien({ nifEmpresa: EMPRESA, nifLeido, otrasSociedades: OTRAS, conIva })

describe('claveNif: el NIF en sus formas, la misma clave que la base', () => {
  it.each([
    ['B00000000', 'B00000000'],
    ['b00000000', 'B00000000'],
    ['B-00000000', 'B00000000'],
    [' b 0000 0000 ', 'B00000000'],
    ['ES-B00000000', 'B00000000'],
    ['es b00000000', 'B00000000'],
    ['ESB00000000', 'B00000000'],
    ['VAT ES B00000000', 'B00000000'],
    ['NIF: B00000000', 'B00000000'],
    ['12.345.678-z', '12345678Z'],
    ['ES12345678Z', '12345678Z'],
  ])('«%s» → %s', (leido, clave) => { expect(claveNif(leido)).toBe(clave) })
  it('un NIF-IVA de otro país conserva su prefijo', () => { expect(claveNif('FR00000000000')).toBe('FR00000000000') })
  it('vacío, sin clave', () => {
    expect(claveNif(null)).toBeNull()
    expect(claveNif('  ')).toBeNull()
    expect(claveNif('-')).toBeNull()
  })
})

describe('casoDeQuien: los cuatro casos', () => {
  it('va a nombre de la empresa, en cualquiera de sus formas: nada que preguntar', () => {
    for (const f of ['B00000000', 'b-00000000', 'ES B00000000', ' B 0000 0000 ']) expect(caso(f)).toEqual({ caso: 'empresa', sociedadId: null })
  })
  it('a nombre de otra sociedad de la cuenta: la otra sociedad, con su id', () => {
    for (const f of ['A00000000', 'es-a00000000', 'ESA00000000', ' a 0000 0000']) expect(caso(f)).toEqual({ caso: 'otra_sociedad', sociedadId: 'otra' })
  })
  it('la otra sociedad se pregunta aunque no lleve IVA (está en la sociedad equivocada)', () => {
    expect(caso('A00000000', false).caso).toBe('otra_sociedad')
  })
  it('a nombre de alguien de fuera: fuera', () => {
    expect(caso('12345678Z').caso).toBe('fuera')
    expect(caso('ES 12.345.678-z').caso).toBe('fuera')
  })
  it('sin leer a nombre de quién va: sin_leer', () => {
    expect(caso(null).caso).toBe('sin_leer')
    expect(caso('  ').caso).toBe('sin_leer')
  })
  it('a otro y sin IVA: no hay nada que deducir', () => {
    expect(caso('12345678Z', false).caso).toBe('sin_iva')
    expect(caso(null, false).caso).toBe('sin_iva')
  })
  it('una empresa sin NIF no tiene caso', () => {
    expect(casoDeQuien({ nifEmpresa: null, nifLeido: 'A00000000', otrasSociedades: OTRAS, conIva: true })).toEqual({ caso: null, sociedadId: null })
  })
})

describe('botonesDeQuien: dos botones; solo «Pasarla a …» relleno; palabras de la calle', () => {
  it('otra sociedad: «Pasarla a …» (relleno) y «Es de esta sociedad»', () => {
    const b = botonesDeQuien({ caso: 'otra_sociedad', sociedadCorta: 'Frango Takeaway', sociedad: 'Frango Takeaway, S.L.' })
    expect(b.map((x) => [x.texto, x.principal, x.que])).toEqual([['Pasarla a Frango Takeaway', true, 'pasar'], ['Es de esta sociedad', false, 'es_de_esta']])
  })
  it('fuera y sin leer (E04): los dos botones del IVA en hueco, ninguno relleno', () => {
    expect(botonesDeQuien({ caso: 'fuera', sociedadCorta: null, sociedad: null }).map((x) => [x.que, x.principal])).toEqual([['no_deduce', false], ['deduce', false]])
    expect(botonesDeQuien({ caso: 'sin_leer', sociedadCorta: null, sociedad: null }).map((x) => [x.que, x.principal])).toEqual([['no_deduce', false], ['deduce', false]])
  })
  it('la empresa y sin IVA, ningún botón', () => {
    expect(botonesDeQuien({ caso: 'empresa', sociedadCorta: null, sociedad: null })).toEqual([])
    expect(botonesDeQuien({ caso: 'sin_iva', sociedadCorta: null, sociedad: null })).toEqual([])
  })
  it('ninguna frase dice «destinatario», «sujeto pasivo» ni el nombre técnico', () => {
    const textos = [ETIQUETA_DE_QUIEN, SOLO_SUMIED, ...(['otra_sociedad', 'fuera', 'sin_leer'] as const).flatMap((c) => botonesDeQuien({ caso: c, sociedadCorta: 'X', sociedad: 'X' }).map((b) => b.texto))]
    for (const t of textos) expect(t).not.toMatch(/destinatario|sujeto pasivo|no_a_nombre|_/i)
  })
})

describe('deLaBase: lo que devuelve conta_de_quien_es', () => {
  it('con su pregunta', () => {
    const q = deLaBase({ caso: 'otra_sociedad', pregunta: true, frase: 'Esta factura va a nombre de …', sociedad_id: 'otra', sociedad: 'Frango Takeaway, S.L.', sociedad_corta: 'Frango Takeaway',
      respuesta: null, validado: false, solo_sumied: false })
    expect(q).toMatchObject({ caso: 'otra_sociedad', pregunta: true, sociedadId: 'otra', sociedadCorta: 'Frango Takeaway', respuesta: null, soloSumied: false })
  })
  it('lo que no conoce no lo inventa', () => {
    expect(deLaBase({ caso: 'raro', respuesta: 'quizá', pregunta: 'sí' })).toMatchObject({ caso: null, respuesta: null, pregunta: false })
    expect(deLaBase(null)).toMatchObject({ caso: null, pregunta: false, frase: null })
  })
})
