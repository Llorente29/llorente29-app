// tests/unit/modules/supply/lineasLeidas.test.ts
//
// E10 / E10b · Lo que dice la fila de las líneas de una factura larga en FOLVY (src/modules/supply/lineas/lineasLeidas.ts).
// Sin frases técnicas: ni «IA», ni «tokens», ni «cortada».

import { describe, expect, it } from 'vitest'
import { filaDeLineas, textoAlLeerFaltan } from '@/modules/supply/lineas/lineasLeidas'
import type { EstadoLineas } from '../../../../supabase/functions/_shared/lecturaPorPartes'

const desde = '2026-11-23T08:00:00.000Z'
const ahora = Date.parse(desde) + 60_000
const e = (x: Partial<EstadoLineas>): EstadoLineas => ({ estado: 'completas', leidas: 34, esperadas: 34, paginas: 5, sin_leer: [], por_pagina: [], cuadre: { suman: 1246.81, base: 1246.81, cuadra: true }, desde, ...x })
const TECNICO = /\b(IA|tokens?|cortad[ao]|modelo|max_tokens)\b/i

describe('E10 · la fila de las líneas', () => {
  it('una factura leída de una vez (sin estado): sus líneas, como siempre', () => {
    expect(filaDeLineas(12, null, ahora)).toEqual({ tono: 'bien', texto: '12 líneas', ver: true })
    expect(filaDeLineas(1, null, ahora)).toMatchObject({ texto: '1 línea' })
    expect(filaDeLineas(0, null, ahora)).toEqual({ tono: 'nada' })
  })
  it('mientras se leen: «Leyendo…», en su sitio', () => {
    expect(filaDeLineas(0, e({ estado: 'leyendo', leidas: 0 }), ahora)).toEqual({ tono: 'leyendo', texto: 'Leyendo las líneas de la factura…' })
  })
  it('la larga, leída entera: 34 líneas', () => {
    expect(filaDeLineas(34, e({}), ahora)).toEqual({ tono: 'bien', texto: '34 líneas', ver: true })
  })
  it('si faltan: ámbar, cuántas de cuántas, qué página y «Leer las que faltan»', () => {
    const f = filaDeLineas(27, e({ estado: 'faltan', leidas: 27, sin_leer: [3], cuadre: { suman: 1000, base: 1246.81, cuadra: false } }), ahora)
    expect(f).toEqual({ tono: 'ambar', texto: 'Leídas 27 de 34 líneas. Falta la página 3.', ver: true, leerFaltan: true })
    expect(filaDeLineas(20, e({ estado: 'faltan', leidas: 20, sin_leer: [3, 4] }), ahora)).toMatchObject({ texto: 'Leídas 20 de 34 líneas. Faltan las páginas 3, 4.' })
  })
  it('se quedó «leyendo» más de diez minutos: faltan, con «Leer las que faltan»', () => {
    expect(filaDeLineas(0, e({ estado: 'leyendo', leidas: 0 }), Date.parse(desde) + 11 * 60_000)).toMatchObject({ tono: 'ambar', leerFaltan: true })
  })
  it('todas leídas pero no suman las bases: ámbar con las dos cifras', () => {
    expect(filaDeLineas(34, e({ cuadre: { suman: 1246.8, base: 1246.81, cuadra: false } }), ahora))
      .toEqual({ tono: 'ambar', texto: '34 líneas: suman 1.246,80 € y las bases 1.246,81 €.', ver: true, leerFaltan: false })
  })
  it('ninguna frase técnica', () => {
    const textos = [
      filaDeLineas(0, e({ estado: 'leyendo' }), ahora), filaDeLineas(27, e({ estado: 'faltan', leidas: 27, sin_leer: [3] }), ahora),
      filaDeLineas(34, e({ cuadre: { suman: 1, base: 2, cuadra: false } }), ahora),
    ].map((f) => ('texto' in f ? f.texto : ''))
    textos.push(textoAlLeerFaltan(e({})), textoAlLeerFaltan(e({ estado: 'faltan', leidas: 30 })), textoAlLeerFaltan(null))
    for (const t of textos) expect(t).not.toMatch(TECNICO)
  })
  it('«Leer las que faltan» dice cómo ha quedado', () => {
    expect(textoAlLeerFaltan(e({}))).toBe('Leídas todas: 34 líneas.')
    expect(textoAlLeerFaltan(e({ estado: 'faltan', leidas: 30 }))).toBe('Siguen faltando: leídas 30 de 34. Escríbelas mirando el PDF, o vuelve a probar.')
  })
})

describe('E10b · la de una empresa que aún no usaba Folvy', () => {
  it('sus líneas no se leyeron: ámbar, cuántas trae, y «Leer las que faltan»', () => {
    expect(filaDeLineas(0, e({ estado: 'faltan', leidas: 0, sin_folvy: true, cuadre: null }), ahora))
      .toEqual({ tono: 'ambar', texto: 'Sus 34 líneas aún no se han leído.', ver: false, leerFaltan: true })
    expect(filaDeLineas(0, e({ estado: 'faltan', leidas: 0, esperadas: null, sin_folvy: true, cuadre: null }), ahora))
      .toMatchObject({ texto: 'Sus líneas aún no se han leído.' })
  })
})
