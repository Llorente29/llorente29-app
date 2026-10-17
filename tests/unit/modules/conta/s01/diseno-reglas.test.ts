// tests/unit/modules/conta/s01/diseno-reglas.test.ts
//
// S01 · Las reglas del sistema de diseño que se comprueban solas (informe del
// paso 1, §8). Corren en la batería de antes-de-subir.sh (paso 3, unitarias):
//   1. Ningún color escrito a mano en diseno/ fuera de tokens.css y temas.ts.
//   2. Ningún tamaño de letra ni radio escrito a mano en el CSS de diseno/.
//   3. Sin tablas tipo pijama: nada alterna el fondo por filas.
//   4. Los componentes de diseno/ solo importan lo permitido, y las pantallas
//      del esqueleto no cogen piezas de fuera de diseno/.
// Cada regla tiene su «la prueba puede fallar» con un caso inventado.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DISENO = 'src/modules/conta/diseno'
/** Las carpetas del esqueleto: según se creen, entran aquí. */
const ESQUELETO = ['src/modules/conta/esqueleto']

function ficheros(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? ficheros(p, ext) : ext.test(n) ? [p] : []
  })
}
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Colores escritos a mano: #hex, rgb(), hsl(). */
function coloresAMano(css: string): string[] {
  return Array.from(sinComentarios(css).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)).map((m) => m[0])
}
/** font-size o border-radius que no salen de un token (0 se permite). */
function medidasAMano(css: string): string[] {
  return Array.from(sinComentarios(css).matchAll(/(font-size|border-radius)\s*:\s*([^;}]+)/g))
    .filter((m) => !/^var\(--s-/.test(m[2].trim()) && m[2].trim() !== '0' && m[2].trim() !== 'inherit')
    .map((m) => `${m[1]}: ${m[2].trim()}`)
}
/** Lo que alterna el fondo por filas. */
function pijama(css: string): string[] {
  return Array.from(sinComentarios(css).matchAll(/:nth-(?:child|of-type)\(\s*(?:even|odd|2n(?:\s*\+\s*[01])?)\s*\)/g)).map((m) => m[0])
}
const IMPORTS_PERMITIDOS = [
  /^react$/, /^react-dom/, /^react-router-dom$/, /^lucide-react$/, /^\.\//, /^\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/marcas(\.ts)?$/,
  /^@\/modules\/conta\/lib\/(formato|lectorCsvBanco)$/,
  // Las tres piezas del M01 y el campo de fecha, que se re-exportan con su nombre del sistema.
  /^@\/modules\/conta\/ui\/(tabla\/TablaDensa|formulario\/FormularioBloques|documento\/PanelDocumento|fecha\/CampoFecha)$/,
]
function importsDe(ts: string): string[] {
  return Array.from(ts.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)).map((m) => m[1])
}

describe('1 · colores solo en los tokens', () => {
  const todos = ficheros(DISENO, /\.(css|tsx?)$/).filter((f) => !/tokens\.css$|temas\.ts$/.test(f))
  it('diseno/ tiene sus ficheros', () => { expect(todos.length).toBeGreaterThanOrEqual(10) })
  for (const f of todos) it(f, () => { expect(coloresAMano(readFileSync(f, 'utf8'))).toEqual([]) })
  it('la prueba puede fallar', () => {
    expect(coloresAMano('.x { color: #0A5BF0; background: rgba(0,0,0,.1) }')).toEqual(['#0A5BF0', 'rgba('])
    expect(coloresAMano('/* #0A5BF0 en un comentario */ .x { color: var(--s-accion) }')).toEqual([])
  })
})

describe('2 · tamaños de letra y radios solo de los tokens', () => {
  for (const f of ficheros(DISENO, /\.css$/).filter((x) => !/tokens\.css$/.test(x))) {
    it(f, () => { expect(medidasAMano(readFileSync(f, 'utf8'))).toEqual([]) })
  }
  it('la prueba puede fallar', () => {
    expect(medidasAMano('.x { font-size: 15px; border-radius: var(--s-radio-boton) } .y { border-radius: 0 }')).toEqual(['font-size: 15px'])
  })
})

describe('3 · sin tablas tipo pijama', () => {
  const css = [...ficheros(DISENO, /\.css$/), ...ficheros('src/modules/conta/estilo', /\.css$/)]
  for (const f of css) it(f, () => { expect(pijama(readFileSync(f, 'utf8'))).toEqual([]) })
  it('la prueba puede fallar', () => {
    expect(pijama('tr:nth-child(even) { background: var(--s-suave) }')).toEqual([':nth-child(even)'])
    expect(pijama('.a > :nth-child(5) { display: none }')).toEqual([])
  })
})

describe('4 · lo que importa cada cual', () => {
  for (const f of ficheros(DISENO, /\.tsx?$/)) {
    it(`${f} solo importa lo permitido`, () => {
      const fuera = importsDe(readFileSync(f, 'utf8')).filter((i) => !IMPORTS_PERMITIDOS.some((r) => r.test(i)))
      expect(fuera).toEqual([])
    })
  }
  const pantallas = ESQUELETO.flatMap((d) => ficheros(d, /\.tsx?$/))
  for (const f of pantallas) {
    it(`${f} coge las piezas de diseno/, no de ui/ ni de otra pantalla`, () => {
      const fuera = importsDe(readFileSync(f, 'utf8')).filter((i) => /^@\/modules\/conta\/(ui\/|proveedor\/piezas|libro\/piezasLibro)/.test(i))
      expect(fuera).toEqual([])
    })
  }
  it('la prueba puede fallar', () => {
    expect(importsDe("import { Chip } from '@/modules/conta/ui/piezas'\nimport { Boton } from './Boton'")).toEqual(['@/modules/conta/ui/piezas', './Boton'])
    expect(['@/modules/conta/ui/piezas'].filter((i) => !IMPORTS_PERMITIDOS.some((r) => r.test(i)))).toEqual(['@/modules/conta/ui/piezas'])
  })
})
