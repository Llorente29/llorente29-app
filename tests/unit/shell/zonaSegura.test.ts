// La cabecera de Folvy se solapaba con el reloj del iPhone (08/09/2026).
//
// POR QUE ESTA PRUEBA EXISTE, Y POR QUE MIRA EL CODIGO FUENTE. Esto es CSS que
// solo se manifiesta en un iPhone con muesca: en jsdom, en Android y en
// escritorio `env(safe-area-inset-*)` vale 0 y TODO pasa, roto o arreglado.
// Una prueba que renderizara el componente daria verde con el bug dentro. Asi
// que se comprueba lo unico comprobable desde aqui: que la regla sigue escrita.
//
// El fallo estaba a MEDIAS y por eso duro: el hueco de ABAJO estaba puesto en
// tres sitios y el de ARRIBA no estaba en ninguno. `index.html` pide
// `viewport-fit=cover` y `black-translucent`, o sea que la pagina empieza
// debajo del reloj; sin reservar el hueco, el wordmark «folvy» se pinta encima
// de la hora del sistema.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const raiz = new URL('../../../', import.meta.url).pathname
const lee = (p: string) => readFileSync(join(raiz, p), 'utf8')

describe('index.html · sin esto, todos los env() valen 0 y ningun padding hace nada', () => {
  const html = lee('index.html')

  it('el viewport lleva viewport-fit=cover', () => {
    expect(html).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/)
  })

  // Es la razon de que el solape sea PEOR en la PWA instalada que en Safari:
  // black-translucent mete el contenido debajo de la barra de estado a proposito.
  it('sigue en black-translucent, que es lo que obliga a reservar el hueco', () => {
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/)
  })
})

describe('las barras fijas reservan la zona segura', () => {
  it('la cabecera del Shell reserva el hueco de ARRIBA', () => {
    const src = lee('src/shell/ShellTopBar.tsx')
    expect(src).toContain('env(safe-area-inset-top')
  })

  // La trampa: con box-sizing:border-box, dejar `height: 64` y anadir padding
  // no baja la barra — la APLASTA a 20 px en un iPhone con Dynamic Island. La
  // altura tiene que crecer con el hueco.
  it('y la altura CRECE con el hueco, no se lo come', () => {
    const src = lee('src/shell/ShellTopBar.tsx')
    expect(src).toMatch(/height:\s*'calc\(64px \+ env\(safe-area-inset-top[^)]*\)\)'/)
    expect(src).not.toMatch(/height:\s*64\s*,/)
  })

  // Apaisado: ahi la muesca se pone al lado, no arriba.
  it('la cabecera respeta tambien los laterales (apaisado)', () => {
    const src = lee('src/shell/ShellTopBar.tsx')
    expect(src).toContain('env(safe-area-inset-left')
    expect(src).toContain('env(safe-area-inset-right')
  })

  it('la franja de «NO ES PRODUCCION» tampoco se pinta bajo el reloj', () => {
    expect(lee('src/shell/version/FranjaEntorno.tsx')).toContain('env(safe-area-inset-top')
  })

  it.each([
    'src/shell/ShellBottomNav.tsx',
    'src/components/trabajador/BottomTabBar.tsx',
    'src/shell/Shell.tsx',
  ])('%s sigue reservando el hueco de ABAJO', f => {
    expect(lee(f)).toContain('env(safe-area-inset-bottom')
  })
})

// Barrido: `env(x)` SIN respaldo dentro de un calc() invalida el calc entero en
// un navegador que no lo entienda, y entonces la barra de abajo tapa el
// contenido en vez de dejarle sitio. El respaldo es gratis; olvidarlo, no.
describe('barrido · ningun env(safe-area-*) se queda sin respaldo', () => {
  function ficherosDe(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(join(raiz, dir))) {
      const rel = `${dir}/${e}`
      if (statSync(join(raiz, rel)).isDirectory()) out.push(...ficherosDe(rel))
      else if (/\.(ts|tsx|css)$/.test(e)) out.push(rel)
    }
    return out
  }

  it('todos los env(safe-area-*) de src/ traen su , 0px', () => {
    const sinRespaldo: string[] = []
    for (const f of ficherosDe('src')) {
      const src = lee(f)
      for (const m of src.matchAll(/env\(safe-area-inset-[a-z]+([^)]*)\)/g)) {
        if (!m[1].includes(',')) sinRespaldo.push(`${f}: ${m[0]}`)
      }
    }
    expect(sinRespaldo).toEqual([])
  })
})
