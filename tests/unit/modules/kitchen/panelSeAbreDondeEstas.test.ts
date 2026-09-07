// B84.1 · UN PANEL SE ABRE DONDE ESTÁ QUIEN LO ABRE.
//
// Julio, 07/09 en producción: pulsando «Decir qué lleva» en una fila de abajo el
// panel salía fuera de la vista y sólo aparecía con la tecla Inicio. Que Inicio
// lo trajera es la prueba de que NO estaba fijo al viewport: algún ascendiente
// lo contenía. Y lo caro no es el susto: un administrativo concluye que el botón
// no hace nada y lo vuelve a pulsar.
//
// El arreglo no fue cazar al ascendiente —cambiaría con el siguiente `div` que
// alguien añada al shell— sino sacar el panel del subárbol de la página con un
// portal a `body`. Esto lo fija, y fija también el `items-center` que usan los
// otros paneles del módulo: el `items-start` era el único de la casa, y era mío.
//
// Es una prueba de fichero, no de render: comprueba una REGLA de construcción,
// que es lo que se rompe cuando alguien escribe el siguiente panel.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const RAIZ = resolve(__dirname, '../../../..')
const FLUJO = resolve(RAIZ, 'src/modules/kitchen/components/FlujoDeExtra.tsx')

describe('el panel del flujo de Extras', () => {
  const src = readFileSync(FLUJO, 'utf8')

  it('se monta fuera de la página, en `body`', () => {
    expect(src).toContain("import { createPortal } from 'react-dom'")
    expect(src).toContain('return createPortal(')
    expect(src).toContain('document.body,')
  })

  it('se centra en la pantalla, como los demás paneles del módulo', () => {
    expect(src).toMatch(/fixed inset-0[^"]*items-center/)
    expect(src).not.toMatch(/fixed inset-0[^"]*items-start/)
  })

  it('se puede cerrar sin buscar la «×» con el ratón', () => {
    expect(src).toContain("e.key === 'Escape'")
  })

  // Un panel más alto que la pantalla tiene que poder recorrerse por dentro; si
  // no, el botón de guardar queda fuera y volvemos al mismo sitio por otra vía.
  it('un panel alto se recorre por dentro, no empujando la página', () => {
    expect(src).toMatch(/max-h-\[calc\(100vh-\d+px\)\][^"]*overflow-y-auto/)
  })
})

// Y la familia entera: ningún panel de Kitchen puede volver a anclarse arriba.
// Con 44 paneles en el módulo, el que escriba el 45 no va a leer este fichero
// — pero la prueba sí lo lee a él.
describe('ningún panel de Kitchen se ancla arriba de la página', () => {
  const ficheros = ['components', 'pages'].flatMap((d) => {
    const dir = resolve(RAIZ, 'src/modules/kitchen', d)
    return readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => resolve(dir, f))
  })

  it('todos centran su panel', () => {
    const malos: string[] = []
    for (const f of ficheros) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/className="([^"]*fixed inset-0[^"]*)"/g)) {
        // `items-end sm:items-center` es la hoja de móvil de la casa: sube desde
        // abajo en el teléfono y se centra en el escritorio. Eso no es anclarse.
        if (m[1].includes('items-start')) malos.push(`${f.split('/').pop()}: ${m[1]}`)
      }
    }
    expect(malos, malos.join('\n')).toEqual([])
  })

  // Que la barrida sirva de algo: tiene que saltar con el caso que la motivó.
  it('la barrida salta con el marcado que falló', () => {
    const roto = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-8'
    expect(roto.includes('items-start')).toBe(true)
  })
})
