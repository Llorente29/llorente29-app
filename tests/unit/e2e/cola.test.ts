// tests/unit/e2e/cola.test.ts
//
// V03, respuesta 6 (26/10): la cola de staging. El 26/10 C y D estuvieron casi
// 3 horas parados: la e2e cogía la barrera de migrar (4202,0) para TODO el job,
// y una aplicación que esperaba detrás dejaba en cola a todas las e2e nuevas.
// Lo que se fija aquí:
//   1. la barrera es por FICHERO (por-fichero.sh): cada uno entra y sale, y la
//      aplicación entra entre dos;
//   2. el carril ya no coge la barrera; nadie espera para siempre (15/20/15 min);
//   3. la e2e de un push corre también cada .spec.ts que cambia el PR;
//   4. las ramas claude/** lanzan su e2e solas.
// Contra un carril.sh y un Playwright FALSOS que apuntan lo que se les pide:
// lo que importa es el ORDEN.

import { describe, it, expect, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queCorre, specsTocadas } from '../../../scripts/e2e/area.mjs'

const POR_FICHERO = join(process.cwd(), 'scripts/e2e/por-fichero.sh')
let dir = ''
const log = () => (existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8').trim().split('\n') : [])

// Un carril.sh falso: apunta «entrar <fichero>» y «salir»; la barrera espera
// ESPERA segundos (la apunta como hace el de verdad) o falla si FALLA_BARRERA.
function carrilFalso() {
  const f = join(dir, 'carril.sh')
  writeFileSync(f, `#!/usr/bin/env bash
case "$1" in
  barrera-entrar) echo "entrar $BARRERA_QUE" >> "${dir}/log"
    echo "\${ESPERA:-0}" > "$CARRIL_DIR/barrera.espera"
    if [ -n "\${FALLA_BARRERA:-}" ] && [ "$BARRERA_QUE" = "$FALLA_BARRERA" ]; then exit 1; fi ;;
  barrera-salir) echo "salir" >> "${dir}/log" ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}
// Un Playwright falso: apunta el fichero, su salida y su informe; «rojo» en el nombre falla.
function playwrightFalso() {
  const f = join(dir, 'playwright')
  writeFileSync(f, `#!/usr/bin/env bash
if [ "$1" = merge-reports ]; then echo "merge $*" >> "${dir}/log"; exit 0; fi
echo "test $2 salida=$E2E_SALIDA blob=$PLAYWRIGHT_BLOB_OUTPUT_FILE fuera=$E2E_SERVIDOR_FUERA guarda=$PWTEST_BLOB_DO_NOT_REMOVE" >> "${dir}/log"
mkdir -p blob-report && touch "$PLAYWRIGHT_BLOB_OUTPUT_FILE"
case "$2" in *tiempo*) echo "Test timeout of 60000ms exceeded." ;; esac
case "$2" in *texto*) printf 'Timed out 15000ms waiting for expect(locator).toHaveText(expected)\nExpected string: "Pagada"\nReceived string: "Pendiente"\n' ;; esac
case "$2" in *rojo*) exit 1 ;; esac
`)
  chmodSync(f, 0o755)
  return f
}
function correr(ficheros: string[], extra: Record<string, string> = {}) {
  writeFileSync(join(dir, 'lista.txt'), ficheros.join('\n') + '\n')
  return spawnSync('bash', [POR_FICHERO, join(dir, 'lista.txt'), '2'], {
    cwd: dir,
    env: { ...process.env, CARRIL: carrilFalso(), PLAYWRIGHT: playwrightFalso(), E2E_SIN_SERVIDOR: '1', CARRIL_DIR: dir, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, 'resumen.md'), ...extra },
    encoding: 'utf8',
  })
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cola-')) })

describe('la barrera es por fichero (por-fichero.sh)', () => {
  it('cada fichero entra, corre y sale, en ese orden: la aplicación cabe entre dos', () => {
    const r = correr(['tests/e2e/conta/b01/motor.spec.ts', 'tests/e2e/conta/c04/libro.spec.ts'])
    expect(r.status).toBe(0)
    const l = log().filter((x) => !x.startsWith('merge'))
    expect(l.map((x) => x.split(' ')[0])).toEqual(['entrar', 'test', 'salir', 'entrar', 'test', 'salir'])
    expect(l[0]).toBe('entrar tests/e2e/conta/b01/motor.spec.ts')
    expect(l[3]).toBe('entrar tests/e2e/conta/c04/libro.spec.ts')
  })

  it('cada fichero, su informe y su carpeta de trazas; el servidor de fuera; y al final, el HTML con todos', () => {
    correr(['tests/e2e/conta/b01/motor.spec.ts', 'tests/e2e/conta/c04/libro.spec.ts'])
    const t = log().filter((x) => x.startsWith('test'))
    expect(t[0]).toBe('test tests/e2e/conta/b01/motor.spec.ts salida=test-results/001 blob=blob-report/trozo-2-001.zip fuera=1 guarda=1')
    expect(t[1]).toBe('test tests/e2e/conta/c04/libro.spec.ts salida=test-results/002 blob=blob-report/trozo-2-002.zip fuera=1 guarda=1')
    expect(log().at(-1)).toBe('merge merge-reports --reporter html blob-report')
  })

  it('un fichero en rojo: suelta la barrera, sigue con los demás y el trozo sale en rojo', () => {
    const r = correr(['tests/e2e/a-rojo.spec.ts', 'tests/e2e/b.spec.ts'])
    expect(r.status).toBe(1)
    expect(log().filter((x) => !x.startsWith('merge')).map((x) => x.split(' ')[0])).toEqual(['entrar', 'test', 'salir', 'entrar', 'test', 'salir'])
    expect(r.stdout).toContain('1 de 2 ficheros en rojo')
  })

  it('sin la barrera (se acaba la espera): ese fichero no corre, cuenta como rojo, y los demás sí', () => {
    const r = correr(['tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts'], { FALLA_BARRERA: 'tests/e2e/a.spec.ts', ESPERA: '7' })
    expect(r.status).toBe(1)
    expect(log().filter((x) => x.startsWith('test'))).toHaveLength(1)
    // Lo que esperó de verdad (Respuesta 4 al V04): antes ponía siempre «20m».
    expect(readFileSync(join(dir, 'por-fichero.tsv'), 'utf8')).toContain('tests/e2e/a.spec.ts\t7\t0\tsin barrera')
  })

  it('apunta la espera de cada fichero en el resumen del run (los tiempos que pide Julio)', () => {
    correr(['tests/e2e/a.spec.ts'], { ESPERA: '42' })
    const resumen = readFileSync(join(dir, 'resumen.md'), 'utf8')
    expect(resumen).toContain('total 42 s, la mayor 42 s')
    expect(resumen).toMatch(/\| tests\/e2e\/a\.spec\.ts \| 42 \| \d+ \| verde \|/)
  })

  it('una lista vacía: no corre nada y sale en verde', () => {
    const r = correr([])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('A este trozo no le toca ningún fichero.')
    expect(log()).toEqual([])
  })
})

// Julio, 26/10: «un fallo por tiempo en una prueba que no es de la zona del PR no bloquea fusionar».
describe('fuera de la zona, el tiempo no bloquea (solo en el push)', () => {
  const zona = { E2E_ZONA: '1', E2E_PROPIAS: 'tests/e2e/conta/b01 tests/e2e/conta/pc01/cobros-y-pagos.spec.ts' }
  it('el juego común o la rápida, por tiempo: se apunta y el trozo sale en verde', () => {
    const r = correr(['tests/e2e/conta/b01/motor.spec.ts', 'tests/e2e/conta/humo/pantallas-tiempo-rojo.spec.ts'], zona)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('::warning title=Fuera de la zona, por tiempo::tests/e2e/conta/humo/pantallas-tiempo-rojo.spec.ts')
    expect(readFileSync(join(dir, 'resumen.md'), 'utf8')).toContain('**Por tiempo y fuera de la zona del PR (no bloquean; los mira la entera de la noche):** tests/e2e/conta/humo/pantallas-tiempo-rojo.spec.ts')
  })
  it('en la zona del PR, el tiempo bloquea: una carpeta suya o una prueba que cambia', () => {
    expect(correr(['tests/e2e/conta/b01/conciliar-tiempo-rojo.spec.ts'], zona).status).toBe(1)
    expect(correr(['tests/e2e/conta/pc01/cobros-y-pagos.spec.ts-tiempo-rojo'], { ...zona, E2E_PROPIAS: 'tests/e2e/conta/pc01/cobros-y-pagos.spec.ts-tiempo-rojo' }).status).toBe(1)
  })
  it('fuera de la zona, un fallo que ve otra cosa (un texto distinto) bloquea, aunque también diga «Timed out»', () => {
    expect(correr(['tests/e2e/conta/c00/marco-texto-rojo.spec.ts'], zona).status).toBe(1)
  })
  it('fuera de la zona, un fallo que no es de tiempo bloquea', () => {
    expect(correr(['tests/e2e/conta/c00/marco-rojo.spec.ts'], zona).status).toBe(1)
  })
  it('a mano o de noche (sin E2E_ZONA), todo bloquea', () => {
    expect(correr(['tests/e2e/conta/humo/pantallas-tiempo-rojo.spec.ts']).status).toBe(1)
  })
  it('el workflow lo activa solo en la zona de un push, con las propias que da area.mjs', () => {
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    expect(wf).toContain('E2E_ZONA: ${{ needs.plan.outputs.zona }}')
    expect(wf).toContain('E2E_PROPIAS: ${{ needs.plan.outputs.propias }}')
    expect(wf).toContain(`PROPIAS=$(sed -n 's/^propias=//p' "$RUNNER_TEMP/decision.txt"); ZONA=1`)
  })
})

describe('los cerrojos: quién coge qué, y cuánto espera cada uno', () => {
  const sql = (f: string) => readFileSync(`scripts/e2e/carril/${f}`, 'utf8').replace(/--[^\n]*/g, '')
  it('el carril ya no coge la barrera; el fichero la coge compartida; la aplicación, exclusiva', () => {
    expect(sql('guardian_e2e.sql')).not.toMatch(/4202/)
    expect(sql('guardian_e2e.sql')).toMatch(/pg_try_advisory_lock\(4203, c\)/)
    // Respuesta 4 al V04 (27/10): la barrera es una reserva con latido, no un
    // cerrojo sujeto por una conexión (lo prueba barrera.test.ts contra un Postgres).
    expect(existsSync('scripts/e2e/carril/guardian_barrera.sql')).toBe(false)
    expect(existsSync('scripts/e2e/carril/guardian_migrar.sql')).toBe(false)
    expect(sql('barrera.sql')).toMatch(/when 'lee' then not exists \(select 1 from e2e_carril\.barrera m where m\.modo = 'migra'\)/)
    expect(sql('barrera.sql')).toMatch(/delete from e2e_carril\.barrera where latido_at < now\(\) - make_interval\(secs => :'caduca'::int\)/)
  })

  it('nadie espera para siempre: el carril 15 min, el fichero 20, la aplicación 15', () => {
    const sh = readFileSync('scripts/e2e/carril.sh', 'utf8')
    expect(sh).toContain('ESPERA_MIN=${CARRIL_ESPERA_MIN:-15}')
    expect(sh).toContain('BARRERA_MIN=${CARRIL_BARRERA_MIN:-20}')
    expect(sh).toContain('MIGRAR_MIN=${CARRIL_MIGRAR_MIN:-15}')
    expect(sh).toContain('reservar barrera lee "$(barrera_yo)" "$BARRERA_MIN"')
    expect(sh).toContain('reservar migrar migra "e2e-migrar ${CARRIL_YO:-?}" "$MIGRAR_MIN"')
    // Ni el workflow ni aplicar los suben por su cuenta.
    for (const wf of ['e2e-staging-conta.yml', 'aplicar-staging-conta.yml']) {
      expect(readFileSync(`.github/workflows/${wf}`, 'utf8')).not.toMatch(/CARRIL_(ESPERA|BARRERA|MIGRAR)_MIN/)
    }
  })

  it('coger no espera a que nadie migre: solo a un carril', () => {
    const sh = readFileSync('scripts/e2e/carril.sh', 'utf8')
    const coger = sh.slice(sh.indexOf('\ncoger() {'), sh.indexOf('\nbarrera_yo()'))
    expect(coger).not.toContain('migrar-libre')
    expect(coger).toContain("esperar_linea 'carril '")
  })

  it('el clon, con la barrera; las pruebas, por por-fichero.sh; soltar suelta también la barrera', () => {
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    const clon = wf.slice(wf.indexOf('- name: Carril · clonar'), wf.indexOf('- name: Capturas · la marca'))
    expect(clon).toMatch(/barrera-entrar[\s\S]*plantilla-coger[\s\S]*carril\.sh borrar[\s\S]*carril\.sh clonar[\s\S]*barrera-salir/)
    expect(wf).not.toContain('npx playwright test $E2E_FICHEROS')
    const sh = readFileSync('scripts/e2e/carril.sh', 'utf8')
    expect(sh.slice(sh.indexOf('\nsoltar() {'), sh.indexOf('\nmigrar_coger() {'))).toContain('soltar_reserva barrera')
    // El borrar del final también, dentro de la barrera (26/10: uno cayó en mitad del ensayo de vuelta atrás).
    expect(sh.slice(sh.indexOf('\nsoltar() {'), sh.indexOf('\nmigrar_coger() {'))).toMatch(/barrera_entrar; then\n\s+borrar/)
  })

  it('cada guardián con sus ficheros: el de la barrera no pisa al del carril', () => {
    const sh = readFileSync('scripts/e2e/carril.sh', 'utf8')
    expect(sh).toContain('echo $! > "$CARRIL_DIR/$nombre.pid"')
    expect(sh).toContain('> "$CARRIL_DIR/$nombre.log"')
    expect(sh).not.toContain('GUARDIAN_APP')
  })
})

describe('la e2e de un push corre también las pruebas que cambia el PR', () => {
  // El caso real (26/10): la rama del #338 arreglaba b01/motor y
  // pc01/cobros-y-pagos, y su push (la #933) solo corrió el juego común.
  const PR_338 = ['tests/e2e/conta/b01/motor.spec.ts', 'tests/e2e/conta/pc01/cobros-y-pagos.spec.ts']
  const existe = (f: string) => !f.includes('borrada')

  it('el #338: el juego común y las dos que arreglaba', () => {
    const r = queCorre('conta/e2e-b01-pc01-pasos', { cambiados: PR_338, existe })
    expect(r.entera).toBe(false)
    expect(r.pruebas).toEqual([...PR_338, 'tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts'])
    // Las dos que arreglaba son suyas: un fallo en ellas bloquea, sea por lo que sea.
    expect(r.propias).toEqual(PR_338)
    expect(r.porque).toContain('las que cambia el PR: tests/e2e/conta/b01/motor.spec.ts, tests/e2e/conta/pc01/cobros-y-pagos.spec.ts')
  })

  it('lo que ya está en la zona no se repite; una prueba borrada no se corre', () => {
    const r = queCorre('conta/b02-recargas', { cambiados: [...PR_338, 'tests/e2e/conta/c09/borrada.spec.ts'], existe })
    expect(r.pruebas).toEqual(['tests/e2e/conta/b01', 'tests/e2e/conta/pc01/cobros-y-pagos.spec.ts', 'tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts'])
  })

  it('con lo común: la zona, las que cambia el PR y la rápida; nunca la entera', () => {
    const r = queCorre('conta/x', { cambiados: ['src/App.tsx', ...PR_338], existe })
    expect(r.entera).toBe(false)
    expect(r.pruebas).toEqual([...PR_338, 'tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts', 'tests/e2e/conta/humo/pantallas.spec.ts'])
  })

  it('solo .spec.ts de tests/e2e: los ayudantes y las unitarias no', () => {
    expect(specsTocadas(['tests/e2e/conta/sesion.ts', 'tests/unit/e2e/area.test.ts', 'tests/e2e/conta/b01/datos.ts', ...PR_338, PR_338[0]], existe)).toEqual(PR_338)
  })
})

describe('las ramas claude/** lanzan su e2e solas', () => {
  it('en el push, junto a conta/** y reparto-**', () => {
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    expect(wf).toContain("branches: ['conta/**', 'claude/**', 'reparto-**']")
    expect(wf).toContain("- 'scripts/e2e/por-fichero.sh'")
  })
})
