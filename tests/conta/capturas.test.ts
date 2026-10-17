// C06b (Julio, 15/10) · Las capturas no chocan entre PRs: artefacto en cada
// run, y a la rama solo las del frente de la rama, a mano, antes del informe.
// Contra la población real: el `case` del workflow ejecutado en bash con las 45
// ramas de conta/ y reparto- que había el 15/10, las carpetas de capturas que
// hay en el repositorio y los 12 PNG con los que chocó el #194.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carpetasDe, despuesDe, duenoDeLaRama, frenteDeLaRama, repartir } from '../../scripts/conta/capturas.mjs'

const WF = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
const RAMAS = readFileSync('tests/conta/fixtures/ramas-20261015.txt', 'utf8').split('\n').filter(Boolean)

/** El `case` del paso «Frente», tal cual, ejecutado en bash para una rama. */
function frenteDelWorkflow(rama: string) {
  const i = WF.indexOf('case "$GITHUB_REF_NAME" in')
  const bloque = WF.slice(i, WF.indexOf('esac', i) + 4)
  return execFileSync('bash', ['-c', `GITHUB_REF_NAME="$1"; ${bloque}; printf %s "$FRENTE"`, 'x', rama], { encoding: 'utf8' })
}

describe('el frente de la rama', () => {
  it('es el mismo que el del paso «Frente» del workflow, en las 45 ramas reales', () => {
    expect(RAMAS.length).toBe(45)
    const distintas = RAMAS.filter((r) => frenteDeLaRama(r) !== frenteDelWorkflow(r))
    expect(distintas).toEqual([])
  })
  it('las tres de A, B y C salen, y las que no son de ningún frente, no', () => {
    const cuenta = (f: string) => RAMAS.filter((r) => frenteDeLaRama(r) === f).length
    expect([cuenta('a'), cuenta('b'), cuenta('c')].every((n) => n > 0)).toBe(true)
    expect(frenteDeLaRama('conta/fuentes-x')).toBe('')   // empieza por f, pero no es F01…
    expect(frenteDeLaRama('conta/c04-libro')).toBe('')   // C de antes del C06: suite entera, como siempre
    expect(duenoDeLaRama('reparto-r02-quien-reparte')).toBe('reparto')
    expect(duenoDeLaRama('conta/w01-banda')).toBeNull()
  })
  // F01 (15/10): el frente D, el del marco nuevo. Ninguna de las 45 ramas
  // reales empieza por conta/m: el frente nuevo no le quita ninguna a otro.
  it('el frente D: conta/m01-… en el workflow y aquí, y ninguna rama de antes cambia de frente', () => {
    for (const r of ['conta/m01-marco', 'conta/m01-piezas', 'conta/m02-diario']) {
      expect(frenteDeLaRama(r)).toBe('d')
      expect(frenteDelWorkflow(r)).toBe('d')
    }
    expect(RAMAS.filter((r) => frenteDeLaRama(r) === 'd')).toEqual([])
    expect(frenteDeLaRama('conta/marco')).toBe('')   // empieza por m, pero no es M01…
    expect(duenoDeLaRama('conta/m01-marco')).toBe('d')
  })
  it('el frente D fija solo m01/…, y m01/ no es de ningún otro', () => {
    const rutas = ['docs/conta/capturas/m01/marco-plegado-ordenador.png', 'docs/conta/capturas/c00/marco-ordenador.png', 'docs/conta/capturas/b01/x.png']
    expect(repartir(rutas, 'd').suyas).toEqual(['docs/conta/capturas/m01/marco-plegado-ordenador.png'])
    for (const otro of ['a', 'b', 'c', 'reparto'] as const) expect(repartir(['docs/conta/capturas/m01/x.png'], otro).suyas).toEqual([])
  })
})

describe('de quién es cada carpeta de capturas (las que hay en el repositorio)', () => {
  const carpetas = [
    ...readdirSync('docs/conta/capturas', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `docs/conta/capturas/${e.name}`),
    ...readdirSync('docs/reparto/capturas', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `docs/reparto/capturas/${e.name}`),
  ]
  const de = (dueno: 'a' | 'b' | 'c' | 'd' | 'reparto') => carpetas.filter((c) => repartir([`${c}/x.png`], dueno).suyas.length).map((c) => c.split('/').pop())

  it('cada frente, las suyas y solo las suyas', () => {
    expect(de('a')).toEqual(['d01', 'd01-e05'])
    expect(de('b')).toEqual(['b01', 'b02'])
    expect(de('c')).toEqual(['c00', 'c01b', 'c02', 'c02c', 'c03', 'c04', 'c04b', 'c05', 'c06', 'c06b'])
    expect(de('d')).toEqual(carpetas.some((c) => c.endsWith('/m01')) ? ['m01'] : [])
    expect(de('reparto')).toEqual(['r02', 'r03'])
  })
  it('cierre, compras y diez (y los PNG sueltos de la raíz) no son de nadie: nadie las fija', () => {
    const nadie = carpetas.filter((c) => (['a', 'b', 'c', 'd', 'reparto'] as const).every((d) => !repartir([`${c}/x.png`], d).suyas.length))
    expect(nadie.map((c) => c.split('/').pop()).sort()).toEqual(['cierre', 'compras', 'diez'])
    expect(repartir(['docs/conta/capturas/ficha-movil.png'], 'c').suyas).toEqual([])
  })
})

describe('el choque del #194, con sus 12 PNG', () => {
  const choque = [
    ...['banda-agente-movil', 'banda-agente-ordenador', 'cierre-ordenador', 'cuentas-ordenador', 'hecho-por-folvy-ordenador', 'movimientos-movil',
      'movimientos-ordenador', 'para-confirmar-movil', 'por-aclarar-movil', 'por-aclarar-ordenador', 'tarjeta-desconocida-ordenador']
      .map((n) => `docs/conta/capturas/b01/pantallas/${n}.png`),
    'docs/conta/capturas/c00/marco-ordenador.png',
  ]
  it('desde una rama de C se habría fijado solo la de c00; las 11 de b01 se quedan en el artefacto', () => {
    const { suyas, ajenas } = repartir(choque, duenoDeLaRama('conta/c06b-patrones-numeracion'))
    expect(suyas).toEqual(['docs/conta/capturas/c00/marco-ordenador.png'])
    expect(ajenas).toHaveLength(11)
    expect(carpetasDe(ajenas)).toEqual(['docs/conta/capturas/b01'])
  })
  it('una rama sin frente no fija ninguna', () => {
    expect(repartir(choque, duenoDeLaRama('conta/w01-banda')).suyas).toEqual([])
  })
  it('lo que no es una captura no entra en el reparto', () => {
    expect(repartir(['src/main.tsx', 'docs/conta/C06_informe.md'], 'c')).toEqual({ suyas: [], ajenas: [] })
  })
})

describe('las capturas de ESTE run (las escritas después de la marca)', () => {
  it('coge las nuevas y las reescritas, y deja las de antes', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'capturas-'))
    const poner = (r: string, s: number) => { mkdirSync(join(raiz, r, '..'), { recursive: true }); writeFileSync(join(raiz, r), 'png'); utimesSync(join(raiz, r), s, s) }
    poner('docs/conta/capturas/c06/vieja.png', 1000)
    poner('docs/conta/capturas/b01/pantallas/reescrita.png', 3000)
    poner('docs/reparto/capturas/r02/nueva.png', 3000)
    poner('src/no-es-captura.png', 3000)
    expect(despuesDe(raiz, 2000 * 1000)).toEqual(['docs/conta/capturas/b01/pantallas/reescrita.png', 'docs/reparto/capturas/r02/nueva.png'])
  })
})

describe('el workflow', () => {
  it('ya no commitea las capturas en cada run: solo a mano, en verde, con fijar_capturas, y con el script', () => {
    expect(WF).not.toMatch(/git add docs\/conta\/capturas/)
    const fijar = WF.slice(WF.indexOf('- name: Capturas · fijar las del frente en la rama'))
    expect(fijar).toMatch(/if: success\(\) && github\.event_name == 'workflow_dispatch' && inputs\.fijar_capturas/)
    expect(fijar).toMatch(/node scripts\/conta\/capturas\.mjs fijar "\$GITHUB_REF_NAME"/)
    expect(WF.match(/git commit/g)).toHaveLength(1)
  })
  it('en cada run, pase lo que pase: la marca antes de las pruebas, el artefacto y el enlace en el PR', () => {
    expect(WF.indexOf('name: Capturas · la marca')).toBeLessThan(WF.indexOf('name: Pruebas (ordenador y móvil)'))
    for (const paso of ['Capturas · las de este run', 'Capturas · artefacto', 'Capturas · el enlace en el PR']) {
      const desde = WF.indexOf(`name: ${paso}`)
      expect(desde).toBeGreaterThan(0)
      expect(WF.slice(desde, WF.indexOf('\n      - ', desde + 1))).toMatch(/if: always\(\)/)
    }
    expect(WF).toMatch(/pull-requests: write/)
  })
  it('un e2e en marcha sigue sin cancelarse', () => {
    expect(WF).toMatch(/cancel-in-progress: false/)
  })
})
