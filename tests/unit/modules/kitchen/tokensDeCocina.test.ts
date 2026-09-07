// §9.1 del encargo de Extras (07/09/2026): los tokens de la maqueta «se copian,
// no se adaptan». Esta prueba lo hace cumplir leyendo LOS DOS FICHEROS y
// comparándolos, en vez de fiarse de que alguien los copió bien.
//
// EXISTE PORQUE FALLÉ. Primero derivé los valores mirando las capturas: los
// SEIS que el encargo escribía a mano acertaban y los OCHO que deduje fallaban
// todos, dos de ellos de largo — `--ink-2` en #5A6A75 cuando es #3D4C57, y
// `--muted` en #8B979F cuando es #65767F. Un texto secundario dos tonos más
// claro no da un error: da una pantalla que se lee peor y nadie sabe por qué.
//
// `tokens_maqueta_referencia.css` es el CSS de `build.py::CSS` tal cual, sin
// tocar una coma. Si la maqueta cambia, se sustituye ese fichero y esta prueba
// dice exactamente qué token hay que mover.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const raiz = resolve(__dirname, '../../../../src/modules/kitchen/estilo')
const maqueta = readFileSync(resolve(raiz, 'tokens_maqueta_referencia.css'), 'utf8')
const nuestro = readFileSync(resolve(raiz, 'cocinaTokens.css'), 'utf8')

function variables(css: string): Record<string, string> {
  const fuera: Record<string, string> = {}
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    fuera[m[1]] = m[2].trim().toLowerCase().replace(/\s+/g, ' ')
  }
  return fuera
}

const DE_LA_MAQUETA = variables(maqueta)
const NUESTROS = variables(nuestro)

/** Cada token nuestro y el de la maqueta del que sale. */
const EQUIVALENCIAS: Array<[string, string]> = [
  ['--ground',      '--cocina-fondo'],
  ['--surface',     '--cocina-superficie'],
  ['--surface-2',   '--cocina-superficie-2'],
  ['--line',        '--cocina-linea'],
  ['--line-soft',   '--cocina-linea-suave'],
  ['--ink',         '--cocina-tinta'],
  ['--ink-2',       '--cocina-tinta-2'],
  ['--muted',       '--cocina-tinta-3'],
  ['--accent',      '--cocina-acento'],
  ['--accent-soft', '--cocina-acento-bg'],
  ['--accent-ink',  '--cocina-acento-ink'],
  ['--up',          '--cocina-verde'],
  ['--up-soft',     '--cocina-verde-bg'],
  ['--down',        '--cocina-rojo'],
  ['--down-soft',   '--cocina-rojo-bg'],
  ['--flag',        '--cocina-ambar'],
  ['--flag-soft',   '--cocina-ambar-bg'],
  ['--shadow',      '--cocina-sombra'],
]

describe('los tokens de cocina son los de la maqueta, copiados', () => {
  it('el fichero de referencia trae los tokens de la maqueta', () => {
    expect(Object.keys(DE_LA_MAQUETA).length).toBeGreaterThan(15)
  })

  for (const [suyo, nuestroNombre] of EQUIVALENCIAS) {
    it(`${nuestroNombre} = ${suyo} de la maqueta`, () => {
      const esperado = DE_LA_MAQUETA[suyo]
      expect(esperado, `la maqueta ya no define ${suyo}`).toBeDefined()
      expect(NUESTROS[nuestroNombre]).toBe(esperado)
    })
  }

  // Que la barrida sirva de algo: si un día se compara mal, esto salta.
  it('la comparación distingue de verdad dos valores distintos', () => {
    expect(DE_LA_MAQUETA['--ink']).not.toBe(DE_LA_MAQUETA['--ink-2'])
    expect(NUESTROS['--cocina-tinta']).not.toBe(NUESTROS['--cocina-tinta-2'])
  })

  // Los radios y la altura del botón salen del §9.1, no del CSS de la maqueta.
  it('radios de 2 y 3 px, y el botón de 34 px', () => {
    expect(NUESTROS['--cocina-radio']).toBe('2px')
    expect(NUESTROS['--cocina-radio-md']).toBe('3px')
  })

  it('la tipografía es la de la maqueta, no la de la app', () => {
    expect(NUESTROS['--cocina-fuente']).toContain('archivo')
    expect(NUESTROS['--cocina-mono']).toContain('ibm plex mono')
    // Y están cargadas: si no, el navegador cae a system-ui sin decir nada.
    const html = readFileSync(resolve(__dirname, '../../../../index.html'), 'utf8')
    expect(html).toContain('Archivo:wght')
    expect(html).toContain('IBM+Plex+Mono')
  })
})
