// tests/unit/e2e/tiemposNuevos.test.ts
//
// 27/10 (Respuesta 2 al V04) · La entera mide lo que no tenía tiempo y lo
// propone (inflacion.mjs --nuevos). Un PR con una e2e nueva no apunta nada en
// ningún fichero compartido.
// W12 (29/10) · Un fichero por prueba en tests/e2e/tiempos/: dos PR que añaden
// un tiempo cada uno ya no tocan el mismo fichero, así que no pueden chocar.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nuevos, porFichero } from '../../../scripts/e2e/inflacion.mjs'
import { escribirTiempo, ficheros, tiemposDelRepo } from '../../../scripts/e2e/trozos.mjs'

// Un informe JSON de Playwright, con la forma que deja merge-reports.
const informe = (pruebas: Record<string, number[]>) => ({
  suites: Object.entries(pruebas).map(([file, ms]) => ({
    file, specs: [{ file: `tests/e2e/${file}`, tests: ms.map((d) => ({ results: [{ duration: d }] })) }],
  })),
})

describe('los tiempos, un fichero por prueba (W12)', () => {
  const repo = tiemposDelRepo()

  it('ya no existe el tiempos.json único, y cada tiempo es de una prueba que existe', () => {
    expect(existsSync('tests/e2e/tiempos.json'), 'tests/e2e/tiempos.json ha vuelto: los tiempos van uno por prueba en tests/e2e/tiempos/<ruta>.json (LEEME.md de esa carpeta).').toBe(false)
    const pruebas = new Set(ficheros())
    const sueltos = Object.keys(repo).filter((k) => !k.startsWith('_') && !pruebas.has(k))
    expect(sueltos, `tiempos de pruebas que ya no existen: ${sueltos.join(', ')}. Borra sus ficheros de tests/e2e/tiempos/.`).toEqual([])
    expect(typeof repo._techo_4_trozos_min).toBe('number')
  })

  it('dos PR que añaden un tiempo cada uno escriben ficheros distintos: no chocan', () => {
    const d = mkdtempSync(join(tmpdir(), 'tiempos-'))
    const a = escribirTiempo('conta/zz/una.spec.ts', 10, 'e2e 1 en verde', d)
    const b = escribirTiempo('conta/zz/otra.spec.ts', 20, null, d)
    expect(a).not.toBe(b)
    writeFileSync(join(d, '_techo.json'), JSON.stringify({ _techo_4_trozos_min: 19.5 }))
    expect(tiemposDelRepo(d)).toEqual({ 'conta/zz/una.spec.ts': 10, 'conta/zz/otra.spec.ts': 20, _techo_4_trozos_min: 19.5 })
    expect(JSON.parse(readFileSync(a, 'utf8'))).toEqual({ segundos: 10, medido: 'e2e 1 en verde' })
  })
})

describe('la entera propone los tiempos de lo que no estaba medido', () => {
  const repo = tiemposDelRepo()
  const medido = Object.keys(repo).find((k) => typeof repo[k] === 'number' && !k.startsWith('_'))!

  it('solo lo que no tenía tiempo, con la misma vara (los dos tamaños sumados)', () => {
    const ahora = porFichero(informe({ 'conta/zz/nueva.spec.ts': [12_000, 13_500], [medido]: [999_000] }))
    expect(nuevos(ahora, repo).nuevos).toEqual({ 'conta/zz/nueva.spec.ts': 25.5 })
  })

  it('la orden deja un fichero por prueba nueva, con su ruta, y dice qué ha medido', () => {
    const d = mkdtempSync(join(tmpdir(), 'tiempos-'))
    writeFileSync(join(d, 'informe.json'), JSON.stringify(informe({ 'conta/zz/nueva.spec.ts': [4_000] })))
    const sale = execFileSync('node', ['scripts/e2e/inflacion.mjs', join(d, 'informe.json'), '--nuevos', join(d, 'p')], { encoding: 'utf8' })
    expect(sale).toContain('| conta/zz/nueva.spec.ts | 4.0 |')
    expect(readdirSync(join(d, 'p', 'conta', 'zz'))).toEqual(['nueva.spec.ts.json'])
    expect(JSON.parse(readFileSync(join(d, 'p', 'conta', 'zz', 'nueva.spec.ts.json'), 'utf8')).segundos).toBe(4)
  })

  it('--tiempos <carpeta> (rehacerlo entero) escribe un fichero por prueba y no toca el techo', () => {
    const d = mkdtempSync(join(tmpdir(), 'tiempos-'))
    writeFileSync(join(d, 'informe.json'), JSON.stringify(informe({ 'conta/zz/nueva.spec.ts': [4_000] })))
    execFileSync('node', ['scripts/e2e/inflacion.mjs', join(d, 'informe.json'), '--tiempos', join(d, 't')], { encoding: 'utf8' })
    expect(tiemposDelRepo(join(d, 't'))).toEqual({ 'conta/zz/nueva.spec.ts': 4 })
    expect(tiemposDelRepo()._techo_4_trozos_min).toBe(repo._techo_4_trozos_min)
  })
})
