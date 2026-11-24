// tests/unit/modules/conta/n10/rutasDelDiario.test.ts
//
// N10 · Parte 1. libros/diario/libro-diario y libros/diario/diario-resumido (Libros › Diario por su
// área y su acción) caían en la ruta del asiento (libros/diario/:entryId), que gana a la de Libros
// (libros/:area/:accion): se pintaban como un asiento que no existe. module.tsx les da ahora su ruta
// propia (LibroDelDiarioSegun). Las rutas, leídas de module.tsx (regla 31: del código, no de una lista
// escrita aquí), con el enrutador de verdad.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { CONTA } from '@/config/navegacion'

const R = CONTA.rutas as Record<string, string>
const MODULE = readFileSync('src/modules/conta/module.tsx', 'utf8')

/** Las rutas de module.tsx: `path: CONTA.rutas.x` y `path: \`${CONTA.rutas.x}/algo\``, con lo que pintan. */
function rutas() {
  const r: { path: string; linea: string }[] = []
  for (const linea of MODULE.split('\n')) {
    const m = /path:\s*(?:`\$\{CONTA\.rutas\.(\w+)\}([^`]*)`|CONTA\.rutas\.(\w+))/.exec(linea)
    if (m) r.push({ path: m[1] ? R[m[1]] + m[2] : R[m[3]], linea })
  }
  return r
}
const gana = (dir: string) => matchRoutes(rutas(), `/${dir}`)?.[0]?.route as { path: string; linea: string } | undefined

describe('N10 · Libros › Diario por su área y su acción', () => {
  it('lee las rutas de module.tsx (si no encuentra casi ninguna, la lectura está mal)', () => {
    expect(rutas().length).toBeGreaterThan(50)
  })
  it('libros/diario/libro-diario va al Libro diario, no al asiento', () => {
    expect(gana('libros/diario/libro-diario')?.linea).toContain(`LibroDelDiarioSegun a={CONTA.rutas.libroDiario}`)
  })
  it('libros/diario/diario-resumido va al Diario resumido, no al asiento', () => {
    expect(gana('libros/diario/diario-resumido')?.linea).toContain(`LibroDelDiarioSegun a={CONTA.rutas.diarioResumido}`)
  })
  it('sin el núcleo, las dos pintan lo de hoy: la misma ficha que la ruta del asiento', () => {
    const hoy = '<AsientoSegun hoy={<AsientoPage />} />'
    expect(gana('libros/diario/123')?.linea).toContain(hoy)
    expect(gana('libros/diario/libro-diario')?.linea).toContain(`hoy={${hoy}}`)
    expect(gana('libros/diario/diario-resumido')?.linea).toContain(`hoy={${hoy}}`)
  })
  it('un asiento sigue siendo un asiento, y el diario y el resumido, los suyos', () => {
    expect(gana('libros/diario/123')?.path).toBe(R.asiento)
    expect(gana('libros/diario')?.path).toBe(R.libroDiario)
    expect(gana('libros/diario/resumido')?.path).toBe(R.diarioResumido)
  })
})
