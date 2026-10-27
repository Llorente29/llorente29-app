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
  // I01b (18/10): Impuestos fija sus capturas sin ser un frente (como el reparto).
  it('Impuestos: conta/i01b-… fija solo i01b/…, sin ser un frente', () => {
    expect(frenteDeLaRama('conta/i01b-pantallas-impuestos')).toBe('')
    expect(frenteDelWorkflow('conta/i01b-pantallas-impuestos')).toBe('')
    expect(duenoDeLaRama('conta/i01b-pantallas-impuestos')).toBe('impuestos')
    expect(duenoDeLaRama('conta/importar-x')).toBeNull()   // empieza por i, pero no es I01…
    const rutas = ['docs/conta/capturas/i01b/calendario-ordenador.jpg', 'docs/conta/capturas/s01/x.png', 'docs/conta/capturas/c00/x.png']
    expect(repartir(rutas, 'impuestos').suyas).toEqual(['docs/conta/capturas/i01b/calendario-ordenador.jpg'])
    for (const otro of ['a', 'b', 'c', 'd', 'reparto'] as const) expect(repartir(['docs/conta/capturas/i01b/x.png'], otro).suyas).toEqual([])
  })
  // F01 (15/10): el frente D, el del marco nuevo. Desde el S01 (17/10) también
  // el esqueleto (conta/s01-…), que sigue al marco. Ninguna de las 45 ramas
  // reales es conta/m<n> ni conta/s<n>: no le quita ninguna a otro.
  it('el frente D: conta/m01-… y conta/s01-… en el workflow y aquí, y ninguna rama de antes cambia de frente', () => {
    for (const r of ['conta/m01-marco', 'conta/m01-piezas', 'conta/m02-diario', 'conta/s01-esqueleto']) {
      expect(frenteDeLaRama(r)).toBe('d')
      expect(frenteDelWorkflow(r)).toBe('d')
    }
    expect(RAMAS.filter((r) => frenteDeLaRama(r) === 'd')).toEqual([])
    expect(frenteDeLaRama('conta/marco')).toBe('')   // empieza por m, pero no es M01…
    expect(frenteDeLaRama('conta/sumied-x')).toBe('')   // empieza por s, pero no es S01…
    expect(frenteDelWorkflow('conta/sumied-x')).toBe('')
    expect(duenoDeLaRama('conta/m01-marco')).toBe('d')
  })
  it('el frente D fija solo m01/… y s01/…, y no son de ningún otro', () => {
    const rutas = ['docs/conta/capturas/m01/marco-plegado-ordenador.png', 'docs/conta/capturas/s01/sistema-sumied-ordenador.png', 'docs/conta/capturas/c00/marco-ordenador.png', 'docs/conta/capturas/b01/x.png']
    expect(repartir(rutas, 'd').suyas).toEqual(['docs/conta/capturas/m01/marco-plegado-ordenador.png', 'docs/conta/capturas/s01/sistema-sumied-ordenador.png'])
    for (const otro of ['a', 'b', 'c', 'reparto'] as const) {
      expect(repartir(['docs/conta/capturas/m01/x.png', 'docs/conta/capturas/s01/x.png'], otro).suyas).toEqual([])
    }
  })
})

describe('de quién es cada carpeta de capturas (las que hay en el repositorio)', () => {
  const carpetas = [
    ...readdirSync('docs/conta/capturas', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `docs/conta/capturas/${e.name}`),
    ...readdirSync('docs/reparto/capturas', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `docs/reparto/capturas/${e.name}`),
  ]
  const de = (dueno: 'a' | 'b' | 'c' | 'd' | 'reparto' | 'impuestos' | 'despacho' | 'compras') => carpetas.filter((c) => repartir([`${c}/x.png`], dueno).suyas.length).map((c) => c.split('/').pop())

  it('cada frente, las suyas y solo las suyas', () => {
    // 24/10: d03 (la ficha de la recibida, D03) la fija el frente A desde que una e2e suya sale en verde.
    expect(de('a')).toEqual(['d01', 'd01-e05', 'd03'].filter((x) => carpetas.some((c) => c.endsWith(`/${x}`))))
    expect(de('b')).toEqual(['b01', 'b02'])
    expect(de('c')).toEqual(['c00', 'c01b', 'c02', 'c02c', 'c03', 'c04', 'c04b', 'c05', 'c06', 'c06b', 'c06c'])
    expect(de('d')).toEqual(['m01', 's01', 's01c', 's01d', 's01e', 's01f', 's01g'].filter((x) => carpetas.some((c) => c.endsWith(`/${x}`))))
    expect(de('reparto')).toEqual(['r02', 'r03'])
    expect(de('despacho')).toEqual(['p01'])
    // 21/10: «Compras pasa a ser tuya»; sus ramas, conta/compras-….
    expect(de('compras')).toEqual(['compras'])
    expect(duenoDeLaRama('conta/compras-revisar')).toBe('compras')
  })
  it('cierre y diez (y los PNG sueltos de la raíz) no son de nadie: nadie las fija', () => {
    const nadie = carpetas.filter((c) => (['a', 'b', 'c', 'd', 'reparto', 'impuestos', 'despacho', 'compras'] as const).every((d) => !repartir([`${c}/x.png`], d).suyas.length))
    expect(nadie.map((c) => c.split('/').pop()).sort()).toEqual(['cierre', 'diez'])
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
  // W04 (Julio, 22/10): las fija la e2e del push en verde, sin un run aparte; a mano, igual.
  it('las fija la e2e del push en verde (o a mano con fijar_capturas), solo las del frente y con el script', () => {
    expect(WF).not.toMatch(/git add docs\/conta\/capturas/)
    const fijar = WF.slice(WF.indexOf('- name: Capturas · fijar las del frente en la rama'))
    expect(fijar).toMatch(/if: success\(\) && \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.fijar_capturas\)\)/)
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
  it('un e2e en marcha solo lo cancela un push más nuevo de su rama (W02, 17/10)', () => {
    expect(WF).toContain("cancel-in-progress: ${{ github.event_name == 'push' }}")
  })
})

// Autoconteo (Julio, 21/10): las de inventario son de la zona, no de un frente.
describe('las capturas de inventario: de la rama sin frente que toca inventario', () => {
  const nuestras = readdirSync('docs/inventario/capturas').map((f) => `docs/inventario/capturas/${f}`)
  it('una rama sin frente que toca inventario es su dueña, y fija las de docs/inventario/capturas', () => {
    const dueno = duenoDeLaRama('claude/exciting-cray-eik036', ['src/modules/supply/lib/autoconteoTexto.ts', 'tests/e2e/inventario/autoconteo.spec.ts'])
    expect(dueno).toBe('inventario')
    const { suyas, ajenas } = repartir([...nuestras, 'docs/conta/capturas/c00/marco-ordenador.png'], dueno)
    expect(suyas).toEqual(nuestras)
    expect(ajenas).toEqual(['docs/conta/capturas/c00/marco-ordenador.png'])
  })
  it('sin tocar inventario no es de nadie; y una rama de frente sigue siendo de su frente aunque toque inventario', () => {
    expect(duenoDeLaRama('claude/otra', ['README.md'])).toBeNull()
    expect(duenoDeLaRama('conta/d01-x', ['src/modules/supply/a.ts'])).toBe('a')
    expect(repartir(nuestras, 'a').suyas).toEqual([])
  })
})

describe('fijar en una rama sin frente (C10, 23/10)', () => {
  it('se salta con 0 y lo dice: no pone el run en rojo', async () => {
    const { execFileSync } = await import('node:child_process')
    // Sin nada cambiado, a mano: si no, lee el diff de la rama donde corre la prueba,
    // y en una que toca inventario esa rama es dueña de inventario (unitarias #103).
    const out = execFileSync('node', ['scripts/conta/capturas.mjs', 'fijar', 'conta/c08b-catalogo-perdido'],
      { encoding: 'utf8', env: { ...process.env, CAPTURAS_CAMBIADOS: '' } })
    expect(out).toContain('no hay capturas que fijar (se salta)')
  })
})
