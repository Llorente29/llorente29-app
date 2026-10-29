// tests/unit/e2e/trozos.test.ts
//
// W02 (paso 1c): la entera en 4 trozos que corren a la vez. Lo que no puede
// pasar nunca: que entre los trozos falte un fichero (la «entera» no lo sería)
// o que uno corra dos veces (dos carriles haciendo lo mismo). Contra la suite
// REAL de tests/e2e y los tiempos medidos (tests/e2e/tiempos/, uno por prueba; la entera
// de B del 16/10), no contra ficheros inventados.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ficheros, filtrar, repartir, tiemposDelRepo } from '../../../scripts/e2e/trozos.mjs'

const TODOS = ficheros()
const TIEMPOS = tiemposDelRepo()

describe('la entera en trozos', () => {
  // 27/10 (Respuesta 2 al V04): nada de esta prueba se apunta a mano al añadir
  // una e2e. Hasta el 26/10 cada PR con una e2e subía aquí el tope de «sin
  // medir» y el techo del trozo, y el segundo en fusionarse chocaba siempre
  // (#335, #339, #342, #343). El historial de aquellos topes está en git.
  //   · «Sin medir» = lo que no tiene su fichero en tests/e2e/tiempos/. Lo mide la
  //     entera (artefacto «tiempos-propuestos») y se saca de la lista en un
  //     commit que solo toca tests/e2e/tiempos/ (W12: un fichero por prueba).
  //   · El tope sale de lo que hay: como mucho una cuarta parte de la suite. Si
  //     se pasa, no es que un PR haya añadido una e2e: es que hace días que
  //     nadie mete lo medido, y los trozos se reparten a ciegas.
  it('la suite real tiene ficheros, y casi todos tienen su tiempo medido (como mucho una cuarta parte sin medir)', () => {
    expect(TODOS.length).toBeGreaterThanOrEqual(38)
    const sin = TODOS.filter((f) => typeof TIEMPOS[f] !== 'number')
    expect(sin.length, `sin tiempo medido: ${sin.join(', ')}. Copia en tests/e2e/tiempos/ los ficheros del artefacto «tiempos-propuestos» de una e2e en verde.`).toBeLessThanOrEqual(Math.floor(TODOS.length / 4))
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
  })

  // El techo, con dos guardas que no se tocan al añadir una e2e:
  //   1. Lo MEDIDO, en 4 trozos, bajo su techo (`_techo_4_trozos_min` de
  //      tests/e2e/tiempos/_techo.json, al lado de lo medido: cambia solo cuando cambia lo medido,
  //      en el mismo commit). Es la alarma de siempre de que la suite crece.
  //   2. TODO, con lo nuevo como la mediana, en los trozos que usa de verdad la
  //      entera (`TROZOS_PEDIDOS:-N` del workflow) y en 4: el trozo más largo,
  //      como mucho la mitad del `timeout-minutes` del job del trozo. La otra
  //      mitad es la preparación y las esperas, según el propio workflow.
  it('lo medido, en 4 trozos, no pasa de su techo (el de tests/e2e/tiempos/_techo.json)', () => {
    const techo = TIEMPOS._techo_4_trozos_min
    expect(typeof techo).toBe('number')
    const medidos = TODOS.filter((f) => typeof TIEMPOS[f] === 'number')
    const seg = repartir(medidos, 4, TIEMPOS).map((t) => t.segundos)
    expect(Math.max(...seg) / 60).toBeLessThan(techo)
  })

  it('con lo nuevo dentro, ningún trozo pasa de la mitad del límite de su job', () => {
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    const job = wf.slice(wf.indexOf('\n  trozo:'), wf.indexOf('\n  entera:'))
    const limite = Number(/timeout-minutes: (\d+)/.exec(job)?.[1])
    const porDefecto = Number(/N=\$\{TROZOS_PEDIDOS:-(\d)\}/.exec(wf)?.[1])
    expect(limite).toBeGreaterThan(0)
    expect(porDefecto).toBeGreaterThan(0)
    for (const n of new Set([porDefecto, 4])) {
      const seg = repartir(TODOS, n, TIEMPOS).map((t) => t.segundos)
      expect(Math.max(...seg) / 60, `${n} trozos`).toBeLessThanOrEqual(limite / 2)
    }
  })

  it('es determinista: cada trozo lo calcula por su cuenta y sale el mismo reparto', () => {
    expect(repartir(TODOS, 4, TIEMPOS)).toEqual(repartir([...TODOS].reverse(), 4, TIEMPOS))
  })

  it('más trozos que ficheros: los que sobran, vacíos (y el workflow no corre nada en ellos)', () => {
    const tr = repartir(['a.spec.ts', 'b.spec.ts'], 4, {})
    expect(tr.filter((t) => t.ficheros.length === 0)).toHaveLength(2)
    // Fichero a fichero desde el 26/10: lo dice por-fichero.sh, y el workflow le pasa la lista.
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    expect(wf).toContain('scripts/e2e/por-fichero.sh "$RUNNER_TEMP/ficheros.txt" "$TROZO"')
    expect(readFileSync('scripts/e2e/por-fichero.sh', 'utf8')).toContain('A este trozo no le toca ningún fichero.')
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

  it('el push y la entera de la misma rama comparten cola; solo un push cancela (W02, 17/10)', () => {
    expect(wf).toMatch(/group: e2e-staging-conta-\$\{\{ github\.ref \}\}-\$\{\{ inputs\.frente \}\}\n/)
    expect(wf).not.toMatch(/group:.*event_name/)
    expect(wf).toContain("cancel-in-progress: ${{ github.event_name == 'push' }}")
    // Cancelado o no, el carril se suelta.
    expect(wf).toMatch(/- name: Carril · borrar y soltar[^\n]*\n\s+if: always\(\)/)
  })

  // Julio, 21/10: el push corre su área y la corta; la entera solo si toca lo
  // común o lleva la etiqueta (area.mjs decide; el workflow obedece).
  it('el push corre su área (area.mjs) y la entera solo si area.mjs lo dice', () => {
    const plan = wf.slice(wf.indexOf('- name: Frente'), wf.indexOf('  trozo:'))
    expect(plan).toContain('git diff --name-only "origin/main...$GITHUB_SHA"')
    expect(plan).toContain('node scripts/e2e/area.mjs "$GITHUB_REF_NAME" --cambiados "$RUNNER_TEMP/cambiados.txt" --etiquetas "$ETIQUETAS"')
    // C10 (23/10): la entera puede ir acotada a un producto (Sumied o Folvy): las pruebas las da area.mjs, y va en trozos.
    expect(plan).toMatch(/if \[ "\$\(sed -n 's\/\^entera=\/\/p' "\$RUNNER_TEMP\/decision.txt"\)" = true \]; then\n[^\n]*\n\s+PRUEBAS=\$\(sed -n 's\/\^pruebas=\/\/p' "\$RUNNER_TEMP\/decision.txt"\); ENTERA=1\n/)
    expect(plan).toContain('if [ -n "${PRUEBAS:-}" ] && [ "${ENTERA:-0}" != 1 ]; then')
    expect(plan).toMatch(/\[ -n "\$PRUEBAS" \] \|\| \{/)
  })

  it('la noche: dos disparos UTC y corre solo el de las 03:00 de Madrid', () => {
    expect(wf).toMatch(/schedule:\n\s+- cron: '0 1 \* \* \*'\n\s+- cron: '0 2 \* \* \*'/)
    expect(wf).toContain('"0 1 * * *|+0200" | "0 2 * * *|+0100") toca=true ;;')
    expect(wf).toContain("if: needs.plan.outputs.toca == 'true'")
  })

  it('el tope de trozos a la vez es un ajuste del repositorio, 2 si no está puesto', () => {
    expect(wf).toContain("CARRIL_MAX: ${{ vars.E2E_CARRILES || '2' }}")
    const sh = readFileSync('scripts/e2e/carril.sh', 'utf8')
    expect(sh).toContain('MAX=${CARRIL_MAX:-2}')
    // Con los carriles cogidos, espera su turno: no falla al momento.
    const g = readFileSync('scripts/e2e/carril/guardian_e2e.sql', 'utf8')
    expect(g).toMatch(/pg_temp\.coger_carril\(:max, :'espera'\)/)
    expect(g).toMatch(/perform pg_sleep/)
  })

  it('cada trozo coge su carril, lo clona y lo suelta pase lo que pase', () => {
    expect(wf).toContain('scripts/e2e/carril.sh coger')
    expect(wf).toContain('scripts/e2e/carril.sh clonar')
    const soltar = wf.slice(wf.indexOf('- name: Carril · borrar y soltar'))
    expect(soltar.slice(0, 600)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/carril\.sh soltar/)
    // La espera se sigue midiendo (medir_esperas.py busca este nombre).
    expect(wf).toContain('- name: Carril · esperar su turno y coger uno')
  })

  // V03, respuesta 6 (26/10): «la entera, siempre en 2 trozos, también la que
  // se lanza a mano con una carpeta («tests/e2e/conta»)». En uno: solo ficheros
  // sueltos, o la zona de un push.
  it('en trozos: la suite entera y cualquier carpeta; en uno, solo ficheros sueltos o la zona de un push', () => {
    const i = wf.indexOf('N=${TROZOS_PEDIDOS:-2}')
    expect(i).toBeGreaterThan(0)
    const bloque = wf.slice(i, wf.indexOf('{ echo "frente=', i))
    const correr = (pedidos: string, pruebas: string, evento = 'workflow_dispatch', entera = '0') => execFileSync('bash', ['-c', `set -e; TROZOS_PEDIDOS="$1"; PRUEBAS="$2"; GITHUB_EVENT_NAME="$3"; ENTERA="$4"\n${bloque}\nprintf %s "$N $TROZOS"`, 'x', pedidos, pruebas, evento, entera], { encoding: 'utf8' })
    expect(correr('', '')).toBe('2 [1,2]')
    expect(correr('4', '')).toBe('4 [1,2,3,4]')
    expect(correr('', 'tests/e2e/conta')).toBe('2 [1,2]')
    expect(correr('3', 'tests/e2e/conta/b01')).toBe('3 [1,2,3]')
    expect(correr('', 'tests/e2e/conta/b01/motor.spec.ts tests/e2e/conta/pc01/cobros-y-pagos.spec.ts')).toBe('1 [1]')
    expect(correr('', 'tests/e2e/conta/b01/motor.spec.ts tests/e2e/conta/c04')).toBe('2 [1,2]')
    // El push: su zona en uno (aunque lleve carpetas); la entera acotada, en trozos.
    expect(correr('', 'tests/e2e/conta/b01 tests/e2e/conta/rls.spec.ts', 'push')).toBe('1 [1]')
    expect(correr('', 'tests/e2e/conta', 'push', '1')).toBe('2 [1,2]')
    expect(() => correr('9', '')).toThrow()
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
    // W09: con su timeout-minutes, el paso es una línea más largo.
    expect(soltar.slice(0, 400)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/carril\.sh migrar-soltar/)
  })
})
