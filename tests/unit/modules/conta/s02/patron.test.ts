// tests/unit/modules/conta/s02/patron.test.ts
//
// S02 · Los colores con nombre del patrón (diseno/tokens.css), medidos: el
// contraste de 4,5:1 en el texto y de 3:1 en los bordes de los campos (WCAG;
// regla 9 del patrón, «Accesible»). Se leen del fichero, no de la cabeza.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const T = readFileSync('src/modules/conta/diseno/tokens.css', 'utf8')
const v = (n: string) => { const m = T.match(new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(n); return m[1] }
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

describe('el patrón: contraste', () => {
  it('títulos, apoyo y acción sobre blanco y sobre el fondo: ≥ 4,5:1', () => {
    for (const f of ['#FFFFFF', v('--s-fondo')]) for (const t of ['--s-tinta', '--s-apoyo', '--s-accion']) expect(contraste(v(t), f), `${t} sobre ${f}`).toBeGreaterThanOrEqual(4.5)
  })
  it('los tres estados: Propuesto, Por revisar y Hecho, su texto sobre su fondo ≥ 4,5:1', () => {
    expect(contraste(v('--s-propuesto-texto'), v('--s-propuesto'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(v('--s-duda'), v('--s-duda-fondo'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(v('--s-ok'), v('--s-ok-fondo'))).toBeGreaterThanOrEqual(4.5)
  })
  it('el borde de los campos (#7F8FA6, decisión 1 de Julio): ≥ 3:1 sobre blanco y sobre el fondo', () => {
    expect(v('--s-borde-control')).toBe('#7F8FA6')
    expect(contraste('#7F8FA6', '#FFFFFF')).toBeGreaterThanOrEqual(3)
    expect(contraste('#7F8FA6', v('--s-fondo'))).toBeGreaterThanOrEqual(3)
    // La prueba puede fallar: el #B9C6D8 de la maqueta no llegaba.
    expect(contraste('#B9C6D8', '#FFFFFF')).toBeLessThan(3)
  })
  it('la barra: su texto, el apartado abierto y la página activa (blanco sobre azul) ≥ 4,5:1; el chip turquesa con su número oscuro', () => {
    expect(contraste(v('--s-barra-texto'), v('--s-barra'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(v('--s-barra-activo-texto'), v('--s-barra-activo'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(v('--s-sobre-accion'), v('--s-accion'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(v('--s-barra-destacado-texto'), v('--s-barra-destacado'))).toBeGreaterThanOrEqual(4.5)
  })
  it('los ocho colores de empresa llevan su inicial en blanco a ≥ 4,5:1', () => {
    for (let n = 1; n <= 8; n++) expect(contraste('#FFFFFF', v(`--s-empresa-${n}`)), `--s-empresa-${n}`).toBeGreaterThanOrEqual(4.5)
  })
})
