// tests/unit/modules/conta/s01g/ancho.test.ts
//
// S01g · El ancho de las pantallas (Julio, 20/10): las de contenido, hasta 1800
// px y con columnas cuando cabe; los formularios, en 960. El Trimestre lleva el
// suyo (maqueta v4 de C, #259): todo el ancho.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync('src/modules/conta/diseno/tokens.css', 'utf8')
const diseno = readFileSync('src/modules/conta/diseno/diseno.css', 'utf8')
const impuestos = readFileSync('src/modules/conta/estilo/impuestos.css', 'utf8')
const despacho = readFileSync('src/modules/conta/estilo/despacho.css', 'utf8')

describe('S01g · el ancho de las pantallas', () => {
  it('una pantalla de contenido llega hasta 1800; un formulario, a 960; el Trimestre, el suyo', () => {
    expect(tokens).toMatch(/--s-ancho-pantalla: 1800px;/)
    expect(tokens).toMatch(/--s-ancho-lectura: 960px;/)
    expect(diseno).toMatch(/\.s-pantalla \{[^}]*width: 100%; max-width: var\(--s-ancho-pantalla\);/)
    expect(diseno).toMatch(/\.s-pantalla\.s-pantalla-estrecha \{ max-width: var\(--s-ancho-lectura\); \}/)
    // El Trimestre no lo estrecha nadie desde aquí: es de C (#259, todo el ancho).
    expect(diseno).not.toMatch(/s-trimestre/)
    expect(impuestos).toMatch(/\.s-impuestos\.s-trimestre \{ max-width: none; width: 100%; \}/)
  })
  it('Impuestos no lleva tope propio, y su columna de al lado crece con sitio', () => {
    expect(impuestos).not.toMatch(/\.s-impuestos \{ max-width/)
    expect(impuestos).toMatch(/@media \(min-width: 1600px\) \{\s*\.s-impuestos-columnas \{ grid-template-columns: minmax\(0, 2fr\) minmax\(340px, 1fr\);/)
    expect(despacho).toMatch(/max-width: var\(--s-ancho-pantalla\)/)
  })
  it('los formularios llevan su clase estrecha', () => {
    for (const f of ['src/modules/conta/analitica/AnaliticaPage.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('s-pantalla s-pantalla-estrecha')
    }
    // Ficha completa de la recibida (tablero 3b): «Nueva recibida a mano» ya no es un
    // formulario estrecho, es LA MISMA ficha que la que entra sola, con el PDF a la derecha.
    expect(readFileSync('src/modules/conta/documentos/RecibidaAMano.tsx', 'utf8')).toMatch(/<Ficha datos=\{datos\} documento=\{documento\} usuario=\{userId\} \/>/)
  })
})
