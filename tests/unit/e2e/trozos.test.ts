// tests/unit/e2e/trozos.test.ts
//
// W02 (paso 1c): la entera en 4 trozos que corren a la vez. Lo que no puede
// pasar nunca: que entre los trozos falte un fichero (la «entera» no lo sería)
// o que uno corra dos veces (dos carriles haciendo lo mismo). Contra la suite
// REAL de tests/e2e y los tiempos medidos (tests/e2e/tiempos.json, la entera
// de B del 16/10), no contra ficheros inventados.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ficheros, filtrar, repartir, tiemposDelRepo } from '../../../scripts/e2e/trozos.mjs'

const TODOS = ficheros()
const TIEMPOS = tiemposDelRepo()

describe('la entera en trozos', () => {
  it('la suite real tiene ficheros, y casi todos tienen su tiempo medido', () => {
    expect(TODOS.length).toBeGreaterThanOrEqual(38)
    const sin = TODOS.filter((f) => typeof TIEMPOS[f] !== 'number')
    // Los nuevos cuentan como la mediana. 21/10: main trae 4 sin medir (i01b/plazo,
    // i01d/proveedor-extranjero, i01e/ficha-libro, i01h/sociedades); inventario/autoconteo
    // ya está medido (e2e 761). 23/10 (D06): entra d01/validar-en-bloque, nueva y sin medir
    // (cuenta como la mediana): son 5. La mide la entera de su PR.
    expect(sin.length).toBeLessThan(6)
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
    // 18/10 (S01d): la suite ha crecido (s01c, s01d). La entera de 4 carriles
    // del 18/10 (run 39109156060) midió sus trozos en 8,7, 9,3 y 11,3 min; el
    // reparto estimado da 10,3. El techo pasa a 11 min, con esa medida.
    // 18/10 (I01b): s01/esqueleto, s01d/flujos e i01b/impuestos, medidos ya (esqueleto
    // solo, 286 s), contaban como la mediana (39 s). La entera de 2 trozos de ese día
    // (run 39153669213) tardó 25,6 y 18,7 min en sus pruebas: 44,3 min, unos 11,1 por
    // trozo de 4; el reparto estimado da 11,7. El techo pasa a 12 min, con esa medida.
    // 19/10 (P01): entran p01/despacho, i01c/csv e i01c/justificantes, sin tiempo
    // medido aún (cuentan como la mediana). La entera de 2 trozos de la rama del P01
    // (run 39256234205, db689e8f) tardó 30,1 y 25,7 min en sus pruebas: 55,8 min, unos
    // 13,9 por trozo de 4; el reparto estimado da 12,2. El techo pasa a 13 min, con esa medida.
    // 20/10 (S01f): medidos ya p01/despacho, i01c/csv, i01c/justificantes y s01e/capturas
    // (este, 329 s: contaba como la mediana), y entra s01f/pestanas. La entera de 2 trozos
    // del P01 (run 39385193238, 5fd026cf) tardó 26,5 y 28,5 min en sus pruebas: 55,0 min,
    // unos 13,75 por trozo de 4; el reparto estimado da 14,0. El techo pasa a 14,5 min, con esa medida.
    // 20/10 (I01b): medidos ya s01f/pestanas (82 s) y s01g/ancho (51 s), que contaban
    // como la mediana, y entran i01b/plazo, i01d/proveedor-extranjero e i01e/ficha-libro.
    // La entera de 2 trozos del S01g (run 39459913673, 74e061c1) tardó 31,3 y 25,9 min
    // en sus pruebas: 57,2 min, unos 14,3 por trozo de 4; el reparto estimado da 14,9.
    // El techo pasa a 15,5 min, con esa medida.
    // 21/10 (I01g): entra i01g/retenciones (25,0 s, medido en la e2e 729 y otra vez 24,9 en la entera).
    // La entera de 2 trozos de la rama del I01g (run 39522151356, 62b2d7e9) tardó 32,1 y 29,0 min en sus
    // pruebas: 61,1 min, unos 15,3 por trozo de 4. Con los tiempos del I01b y del I01g juntos, el reparto estimado
    // da 15,1 (21/10, al traer main). Un solo techo: 15,5 min.
    // 21/10 (autoconteo): entran medidos i01h/sociedades (26,5 s) e inventario/autoconteo (55,9 s,
    // e2e 761). El reparto estimado da 15,6: el techo pasa a 16 min. Lo mide la entera de la tanda.
    // 22/10 (C07): entran medidos i01h/en-vivo (20,6 s, del #281) y c06/diezTodo (85,0 s, e2e
    // 39735848930). El reparto estimado da 16,04: el techo pasa a 16,5 min. Lo mide la entera de la tanda.
    // 23/10 (D06): entra d01/validar-en-bloque, sin medir (cuenta como la mediana). El reparto
    // estimado da 16,65: el techo pasa a 17 min. Lo mide la entera de su PR.
    expect(Math.max(...seg) / 60).toBeLessThan(17)
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
    expect(plan).toMatch(/if \[ "\$\(sed -n 's\/\^entera=\/\/p' "\$RUNNER_TEMP\/decision.txt"\)" = true \]; then\n\s+PRUEBAS=\n/)
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
    expect(wf).toContain('- name: Carril · esperar a que no se esté migrando y coger uno')
  })

  it('la entera: 2 trozos por defecto (1 a 4 a mano) con la suite entera, 1 con una parte', () => {
    const i = wf.indexOf('N=${TROZOS_PEDIDOS:-2}')
    expect(i).toBeGreaterThan(0)
    const bloque = wf.slice(i, wf.indexOf('{ echo "frente=', i))
    const correr = (pedidos: string, pruebas: string) => execFileSync('bash', ['-c', `set -e; TROZOS_PEDIDOS="$1"; PRUEBAS="$2"\n${bloque}\nprintf %s "$N $TROZOS"`, 'x', pedidos, pruebas], { encoding: 'utf8' })
    expect(correr('', '')).toBe('2 [1,2]')
    expect(correr('4', '')).toBe('4 [1,2,3,4]')
    expect(correr('3', 'tests/e2e/conta/b01')).toBe('1 [1]')
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
    expect(soltar.slice(0, 300)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/carril\.sh migrar-soltar/)
  })
})
