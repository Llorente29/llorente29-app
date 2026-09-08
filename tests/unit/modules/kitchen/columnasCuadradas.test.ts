// REGLA 38 · CADA TÍTULO SOBRE SU CIFRA.
//
// Julio, 08/09: «los títulos de las columnas están totalmente descentrados».
// Tenía razón, y la comparación maqueta-vs-construido no lo había visto porque
// **las dos estaban mal igual**: la maqueta también terminaba la rejilla en
// `auto`. De ahí sale la regla: *cuando maqueta y construido coinciden, sólo se
// ha probado que son iguales; lo que está mal en la maqueta hay que mirarlo con
// otra vara.* Ésta es esa otra vara.
//
// EL FALLO, MEDIDO EN EL NAVEGADOR EL 08/09 antes de arreglarlo:
//
//   Rentabilidad · carta   cabecera 0 px · filas 56 px    → 56 px de desfase
//   Resumen · por marca    cabecera 0 px · filas 85 px    → 85 px
//   Extras                 cabecera 0 px · filas 197 y 206 → 206 px
//   Ingeniería             filas 56 · 150 · 189 · 191 · 230 (sin cabecera, pero
//                          las filas bailan entre sí: la columna de la frase
//                          cambia de ancho en cada fila)
//   Resumen · las 5 cosas  filas 106 · 108 · 111 · 114 · 147
//
// La celda de la última columna está VACÍA en la cabecera (0 px) y lleva el
// botón en las filas. Con la pista en `auto`, cada píxel del botón se lo quita
// a la columna elástica del nombre — así que la cabecera y las filas tenían
// columnas de anchos distintos y todos los títulos numéricos caían a la derecha.
//
// POR QUÉ ESTA PRUEBA NO MIDE PÍXELES. Porque no hace falta y sería peor: el
// navegador no está aquí (vitest no maqueta CSS grid), y sobre todo, **con una
// pista fija y la MISMA cadena en cabecera y filas las columnas coinciden por
// construcción**, no por suerte. Lo que hay que vigilar es exactamente eso: que
// ninguna pista sea elástica salvo la del nombre, y que nadie se escriba su
// propia copia de la rejilla. La medición en el navegador se hizo, está pegada
// ahí arriba, y se repitió después del arreglo: cero de desfase en las cuatro.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TODAS_LAS_REJILLAS } from '@/modules/kitchen/lib/rejillasDeCocina'

const RAIZ = resolve(__dirname, '../../../..')

/** Las pistas de una rejilla, respetando los paréntesis de `minmax(...)`. */
function pistas(rejilla: string): string[] {
  const fuera: string[] = []
  let hondo = 0
  let actual = ''
  for (const c of rejilla) {
    if (c === '(') hondo++
    if (c === ')') hondo--
    if (c === ' ' && hondo === 0) { if (actual) fuera.push(actual); actual = '' }
    else actual += c
  }
  if (actual) fuera.push(actual)
  return fuera
}

describe('ninguna columna de Kitchen se estira con el contenido', () => {
  it('la última pista —la de los botones— es un ancho FIJO en las seis tablas', () => {
    const malas: string[] = []
    for (const [nombre, rejilla] of Object.entries(TODAS_LAS_REJILLAS)) {
      const ultima = pistas(rejilla).at(-1) as string
      if (!/^\d+px$/.test(ultima)) malas.push(`${nombre}: última pista «${ultima}»`)
    }
    expect(malas, malas.join('\n')).toEqual([])
  })

  // Una sola columna elástica, y es la del nombre. Con dos, el reparto del
  // sobrante depende del contenido de las dos y volvemos al mismo sitio.
  it('sólo una pista es elástica, y ninguna es `auto`', () => {
    const malas: string[] = []
    for (const [nombre, rejilla] of Object.entries(TODAS_LAS_REJILLAS)) {
      const p = pistas(rejilla)
      const elasticas = p.filter((t) => t.includes('fr') || t === 'auto')
      if (elasticas.length !== 1) malas.push(`${nombre}: ${elasticas.length} elásticas — ${p.join(' · ')}`)
      if (p.some((t) => t === 'auto' || t === 'min-content' || t === 'max-content')) {
        malas.push(`${nombre}: pista que se estira con el contenido`)
      }
    }
    expect(malas, malas.join('\n')).toEqual([])
  })

  // La prueba tiene que saltar con el marcado que falló, o no prueba nada.
  it('salta con las rejillas de ayer, que son las que Julio vio torcidas', () => {
    const ayer = 'minmax(0,1fr) 105px 80px 95px 110px 75px auto'
    expect(pistas(ayer).at(-1)).toBe('auto')
    expect(pistas(ayer)).toHaveLength(7)
    // Y `minmax(0,1fr)` no se parte por el espacio de dentro:
    expect(pistas('250px 90px minmax(0, 1fr) 230px'))
      .toEqual(['250px', '90px', 'minmax(0, 1fr)', '230px'])
  })
})

// Y la otra mitad de la regla 38: que no vuelva a haber DOS copias de la misma
// rejilla. El fallo vivía por duplicado —en la pantalla y en su foto— y por eso
// una comparación entre las dos no lo veía.
describe('nadie se escribe su propia rejilla', () => {
  const FICHEROS = [
    'src/modules/kitchen/pages/KitchenDashboardPage.tsx',
    'src/modules/kitchen/pages/KitchenProfitabilityPage.tsx',
    'src/modules/kitchen/pages/KitchenMenuEngineeringPage.tsx',
    'src/modules/kitchen/pages/KitchenExtrasPage.tsx',
    'src/modules/kitchen/components/TablasDeRentabilidad.tsx',
    'src/modules/kitchen/components/TablaPorMarca.tsx',
    'tests/unit/modules/kitchen/capturaResumen.test.tsx',
    'tests/unit/modules/kitchen/capturaRentabilidad.test.tsx',
    'tests/unit/modules/kitchen/capturaIngenieria.test.tsx',
    'tests/unit/modules/kitchen/capturaExtras.test.tsx',
  ]

  it('las diez usan la constante de `lib/rejillasDeCocina.ts`, ninguna la suya', () => {
    const malas: string[] = []
    for (const f of FICHEROS) {
      const src = readFileSync(resolve(RAIZ, f), 'utf8')
      if (!src.includes('gridTemplateColumns')) continue
      if (!src.includes("from '@/modules/kitchen/lib/rejillasDeCocina'")) {
        malas.push(`${f}: pinta una rejilla y no la importa de lib`)
      }
      // Una constante local con pistas dentro es una copia esperando a
      // desincronizarse. La cadena tiene que venir de un solo sitio.
      for (const m of src.matchAll(/const\s+(REJILLA\w*)\s*=\s*['"`]([^'"`]*)['"`]/g)) {
        malas.push(`${f}: se escribe su propia ${m[1]} = «${m[2]}»`)
      }
    }
    expect(malas, malas.join('\n')).toEqual([])
  })
})
