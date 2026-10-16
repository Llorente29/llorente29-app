// tests/unit/e2e/trozos.test.ts
//
// W02 (paso 1c): la entera en 4 trozos que corren a la vez. Lo que no puede
// pasar nunca: que entre los trozos falte un fichero (la «entera» no lo sería)
// o que uno corra dos veces (dos carriles haciendo lo mismo). Contra la suite
// REAL de tests/e2e y los tiempos medidos (tests/e2e/tiempos.json, la entera
// de B del 16/10), no contra ficheros inventados.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ficheros, filtrar, repartir, tiemposDelRepo } from '../../../scripts/e2e/trozos.mjs'

const TODOS = ficheros()
const TIEMPOS = tiemposDelRepo()

describe('la entera en trozos', () => {
  it('la suite real tiene ficheros, y casi todos tienen su tiempo medido', () => {
    expect(TODOS.length).toBeGreaterThanOrEqual(38)
    const sin = TODOS.filter((f) => typeof TIEMPOS[f] !== 'number')
    expect(sin.length).toBeLessThan(5) // los nuevos cuentan como la mediana
  })

  it('en 4 trozos están TODOS los ficheros, una vez cada uno', () => {
    const tr = repartir(TODOS, 4, TIEMPOS)
    const juntos = tr.flatMap((t) => t.ficheros).sort()
    expect(juntos).toEqual([...TODOS].sort())
    expect(new Set(juntos).size).toBe(juntos.length)
  })

  it('los 4 trozos quedan parejos con los tiempos medidos (el más largo, como mucho un 10 % sobre la media)', () => {
    const tr = repartir(TODOS, 4, TIEMPOS)
    const seg = tr.map((t) => t.segundos)
    const media = seg.reduce((a, b) => a + b, 0) / 4
    expect(Math.max(...seg)).toBeLessThanOrEqual(media * 1.1)
    // Medido el 16/10: 33,3 min con 1 worker; en 4 trozos, unos 8,4 cada uno.
    expect(Math.max(...seg) / 60).toBeLessThan(9.5)
  })

  it('es determinista: cada trozo lo calcula por su cuenta y sale el mismo reparto', () => {
    expect(repartir(TODOS, 4, TIEMPOS)).toEqual(repartir([...TODOS].reverse(), 4, TIEMPOS))
  })

  it('más trozos que ficheros: los que sobran, vacíos (y el workflow no corre nada en ellos)', () => {
    const tr = repartir(['a.spec.ts', 'b.spec.ts'], 4, {})
    expect(tr.filter((t) => t.ficheros.length === 0)).toHaveLength(2)
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    expect(wf).toContain('A este trozo no le toca ningún fichero.')
  })

  it('«pruebas» filtra igual que antes: carpetas o ficheros de tests/e2e', () => {
    const b = filtrar(TODOS, ['tests/e2e/conta/b01', 'tests/e2e/conta/c00/marco.spec.ts'])
    expect(b.every((f) => f.startsWith('conta/b01/') || f === 'conta/c00/marco.spec.ts')).toBe(true)
    expect(b).toContain('conta/c00/marco.spec.ts')
    expect(filtrar(TODOS, [])).toEqual(TODOS)
    // Una carpeta no casa con otra que empieza igual (conta/c0 no es conta/c00).
    expect(filtrar(TODOS, ['tests/e2e/conta/c0'])).toEqual([])
  })
})

describe('el workflow de la e2e (W02)', () => {
  const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
  const ap = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')

  it('la entera del mismo commit no espera a la e2e del push: el tipo de evento va en la cola', () => {
    expect(wf).toMatch(/group: e2e-staging-conta-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ inputs\.frente \}\}/)
    expect(wf).toMatch(/cancel-in-progress: false/)
  })

  it('cada trozo coge su carril, lo clona y lo suelta pase lo que pase', () => {
    expect(wf).toContain('scripts/e2e/carril.sh coger')
    expect(wf).toContain('scripts/e2e/carril.sh clonar')
    const soltar = wf.slice(wf.indexOf('- name: Carril · borrar y soltar'))
    expect(soltar.slice(0, 600)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/carril\.sh soltar/)
    // La espera se sigue midiendo (medir_esperas.py busca este nombre).
    expect(wf).toContain('- name: Carril · esperar a que no se esté migrando y coger uno')
  })

  it('la entera: 4 trozos con la suite entera, 1 con una parte', () => {
    expect(wf).toMatch(/if \[ -z "\$\{PRUEBAS:-\}" \]; then N=4; TROZOS='\[1,2,3,4\]'; else N=1; TROZOS='\[1\]'; fi/)
    expect(wf).toMatch(/trozo: \$\{\{ fromJSON\(needs\.plan\.outputs\.trozos\) \}\}/)
  })

  it('el job «entera» falla si un trozo no está en verde o si entre todos falta o sobra un fichero', () => {
    const entera = wf.slice(wf.indexOf('  entera:'))
    expect(entera).toMatch(/needs: \[plan, trozo\]/)
    expect(entera).toMatch(/if \[ "\$RESULTADO" != success \]; then[\s\S]*exit 1/)
    expect(entera).toMatch(/diff -u "\$RUNNER_TEMP\/todos\.txt" "\$RUNNER_TEMP\/pasados\.txt"/)
  })

  it('aplicar-staging-conta coge el cerrojo de migrar ANTES de aplicar y lo suelta pase lo que pase', () => {
    const coger = ap.indexOf('scripts/e2e/carril.sh migrar-coger')
    expect(coger).toBeGreaterThan(0)
    for (const paso of ['- name: Aplicar, fichero a fichero', '- name: Ensayo de vuelta atrás', '- name: La tanda de producción en staging']) {
      expect(coger).toBeLessThan(ap.indexOf(paso))
    }
    const soltar = ap.slice(ap.indexOf('- name: Cerrojo de migrar · soltarlo'))
    expect(soltar.slice(0, 300)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/carril\.sh migrar-soltar/)
  })
})
