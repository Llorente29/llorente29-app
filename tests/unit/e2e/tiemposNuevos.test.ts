// tests/unit/e2e/tiemposNuevos.test.ts
//
// 27/10 (Respuesta 2 al V04) · La entera mide lo que no tenía tiempo y lo
// propone para tests/e2e/tiempos.json (inflacion.mjs --nuevos). Un PR con una
// e2e nueva no apunta nada en ningún fichero compartido.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nuevos, porFichero } from '../../../scripts/e2e/inflacion.mjs'
import { tiemposDelRepo } from '../../../scripts/e2e/trozos.mjs'

// Un informe JSON de Playwright, con la forma que deja merge-reports.
const informe = (pruebas: Record<string, number[]>) => ({
  suites: Object.entries(pruebas).map(([file, ms]) => ({
    file, specs: [{ file: `tests/e2e/${file}`, tests: ms.map((d) => ({ results: [{ duration: d }] })) }],
  })),
})

describe('la entera propone los tiempos de lo que no estaba medido', () => {
  const repo = tiemposDelRepo()
  const medido = Object.keys(repo).find((k) => typeof repo[k] === 'number' && !k.startsWith('_'))!

  it('solo lo que no tenía tiempo, con la misma vara (los dos tamaños sumados)', () => {
    const ahora = porFichero(informe({ 'conta/zz/nueva.spec.ts': [12_000, 13_500], [medido]: [999_000] }))
    const r = nuevos(ahora, repo)
    expect(r.nuevos).toEqual({ 'conta/zz/nueva.spec.ts': 25.5 })
    // Lo ya medido no se pisa, y el techo y la nota se quedan.
    expect(r.propuesto[medido]).toBe(repo[medido])
    expect(r.propuesto._techo_4_trozos_min).toBe(repo._techo_4_trozos_min)
    expect(r.propuesto._).toBe(repo._)
    expect(Object.keys(r.propuesto).slice(0, 3)).toEqual(['_', '_techo_4_trozos_min', '_techo_porque'])
  })

  it('la orden escribe el tiempos.json propuesto y dice qué ha medido', () => {
    const d = mkdtempSync(join(tmpdir(), 'tiempos-'))
    writeFileSync(join(d, 'informe.json'), JSON.stringify(informe({ 'conta/zz/nueva.spec.ts': [4_000] })))
    const sale = execFileSync('node', ['scripts/e2e/inflacion.mjs', join(d, 'informe.json'), '--nuevos', join(d, 'p.json')], { encoding: 'utf8' })
    expect(sale).toContain('| conta/zz/nueva.spec.ts | 4.0 |')
    const p = JSON.parse(readFileSync(join(d, 'p.json'), 'utf8'))
    expect(p['conta/zz/nueva.spec.ts']).toBe(4)
    expect(Object.keys(p).length).toBe(Object.keys(repo).length + 1)
  })

  it('--tiempos (rehacerlo entero) no pierde el techo ni la nota', () => {
    const d = mkdtempSync(join(tmpdir(), 'tiempos-'))
    writeFileSync(join(d, 'informe.json'), JSON.stringify(informe({ 'conta/zz/nueva.spec.ts': [4_000] })))
    const p = JSON.parse(execFileSync('node', ['scripts/e2e/inflacion.mjs', join(d, 'informe.json'), '--tiempos'], { encoding: 'utf8' }))
    expect(p._techo_4_trozos_min).toBe(repo._techo_4_trozos_min)
    expect(p._).toBe(repo._)
  })
})
