// C06b (Julio, 15/10) · Las capturas no chocan entre PRs: artefacto en cada
// run, y a la rama solo las del frente de la rama, a mano, antes del informe.
// Contra la población real: el `case` del workflow ejecutado en bash con las 45
// ramas de conta/ y reparto- que había el 15/10, las carpetas de capturas que
// hay en el repositorio y los 12 PNG con los que chocó el #194.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capturasAjenas, carpetasDe, despuesDe, duenoDeLaRama, frenteDeLaRama, repartir } from '../../scripts/conta/capturas.mjs'
import { zonasDuenas, zonasTocadas } from '../../scripts/e2e/area.mjs'

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

// W09d (28/10): las del repositorio según git, no según el disco. Las unitarias
// de la CI se bajan el árbol sin las imágenes de docs/**/capturas, y una carpeta
// con solo imágenes no existe en el disco. Con el árbol entero dan lo mismo
// (medido el 28/10: 33, 2 y 14 a los dos lados).
const enGit = (dir: string) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', dir], { encoding: 'utf8' }).split('\n').filter(Boolean)
/** Las subcarpetas de `dir` (como readdirSync con isDirectory). */
const subcarpetas = (dir: string) =>
  [...new Set(enGit(dir).map((f) => f.slice(dir.length + 1).split('/')).filter((p) => p.length > 1).map((p) => p[0]))].sort()
/** Lo que hay directamente en `dir` (como readdirSync). */
const entradas = (dir: string) => [...new Set(enGit(dir).map((f) => f.slice(dir.length + 1).split('/')[0]))].sort()

describe('de quién es cada carpeta de capturas (las que hay en el repositorio)', () => {
  const carpetas = [
    ...subcarpetas('docs/conta/capturas').map((n) => `docs/conta/capturas/${n}`),
    ...subcarpetas('docs/reparto/capturas').map((n) => `docs/reparto/capturas/${n}`),
  ]
  const de = (dueno: 'a' | 'b' | 'c' | 'd' | 'reparto' | 'impuestos' | 'despacho' | 'compras') => carpetas.filter((c) => repartir([`${c}/x.png`], dueno).suyas.length).map((c) => c.split('/').pop())

  it('cada frente, las suyas y solo las suyas', () => {
    // 24/10: d03 (la ficha de la recibida, D03) la fija el frente A desde que una e2e suya sale en verde.
    expect(de('a')).toEqual(['d01', 'd01-e05', 'd03'].filter((x) => carpetas.some((c) => c.endsWith(`/${x}`))))
    expect(de('b')).toEqual(['b01', 'b02'])
    expect(de('c')).toEqual(['c00', 'c01b', 'c02', 'c02c', 'c03', 'c04', 'c04b', 'c05', 'c06', 'c06b', 'c06c'])
    expect(de('d')).toEqual(['m01', 's01', 's01c', 's01d', 's01e', 's01f', 's01g', 's01h', 's01i'].filter((x) => carpetas.some((c) => c.endsWith(`/${x}`))))
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
  // W08b (Julio, 28/10): las publica la e2e del push en verde en capturas/<rama>, FUERA del PR.
  it('las publica la e2e del push en verde (o a mano con publicar_capturas) en capturas/<rama>, y nunca hace commits en la rama del PR', () => {
    const paso = WF.slice(WF.indexOf('- name: Capturas · publicar las del frente en capturas/<rama>'))
    const cuerpo = paso.slice(0, paso.indexOf('\n      - name:', 10))
    expect(cuerpo).toMatch(/if: success\(\) && steps\.recoger\.outputs\.n != '0' && \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.publicar_capturas\)\)/)
    expect(cuerpo).toContain('node scripts/conta/capturas.mjs suyas "$GITHUB_REF_NAME" "$RUNNER_TEMP/capturas"')
    // Un índice aparte y un commit sin padre: el checkout y la rama del PR no cambian.
    expect(cuerpo).toContain('export GIT_INDEX_FILE=')
    expect(cuerpo).toMatch(/git -c user\.name=folvy-e2e -c user\.email=e2e@folvy\.invalid commit-tree "\$ARBOL"/)
    expect(cuerpo).toContain('git push -f -q origin "$COMMIT:refs/heads/capturas/$GITHUB_REF_NAME"')
    // Ni un commit ni un push a la rama del PR en todo el workflow.
    expect(WF).not.toMatch(/git commit\b/)
    expect(WF).not.toContain('HEAD:$GITHUB_REF_NAME')
    expect(WF).not.toContain('fijar')
    // Publicar va antes del comentario, que enseña las publicadas.
    expect(WF.indexOf('name: Capturas · publicar las del frente')).toBeLessThan(WF.indexOf('name: Capturas · el enlace en el PR'))
    expect(WF).toContain('PUBLICADO: ${{ steps.publicar.outputs.sha }}')
    expect(WF).toContain('node scripts/conta/capturas.mjs comentario "$GITHUB_REPOSITORY" "$PUBLICADO" "$GITHUB_REF_NAME" "$RUNNER_TEMP/suyas.txt"')
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
  const nuestras = entradas('docs/inventario/capturas').map((f) => `docs/inventario/capturas/${f}`)
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

describe('publicar en una rama sin frente (C10, 23/10)', () => {
  it('se salta con 0 y lo dice: no pone el run en rojo', async () => {
    const { spawnSync } = await import('node:child_process')
    // Sin nada cambiado, a mano: si no, lee el diff de la rama donde corre la prueba.
    const r = spawnSync('node', ['scripts/conta/capturas.mjs', 'suyas', 'conta/c08b-catalogo-perdido', 'docs'],
      { encoding: 'utf8', env: { ...process.env, CAPTURAS_CAMBIADOS: '', CAPTURAS_DUENO: '' } })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('no hay capturas que publicar (se salta)')
  })
})

// W08 (Julio, 28/10): el dueño de las capturas sale de lo que la rama ES, no de
// los vecinos de la zona. Tres PR de Laboral (#350, #354 y #370) solo tocaban el
// portal del trabajador, la zona los hizo dueños de inventario y el bot fijó sus
// PNG: «Action required» y conflictos binarios con main. Contra los cinco PR
// reales que tocaron la zona (fixture: git show --name-only de su squash).
describe('W08 · las capturas, solo de su frente', () => {
  const PRS = JSON.parse(readFileSync('tests/conta/fixtures/prs-zona-inventario-20261028.json', 'utf8')).prs as { pr: number, ficheros: string[] }[]
  const pr = (n: number) => PRS.find((p) => p.pr === n)!.ficheros
  const sinCapturas = (fs: string[]) => fs.filter((f) => !f.startsWith('docs/inventario/capturas/'))

  it('una rama que solo toca el portal (src/pages/trabajador/) no fija inventario: el #370', () => {
    const portal = sinCapturas(pr(370)).filter((f) => f.startsWith('src/pages/trabajador/'))
    expect(portal).toEqual(['src/pages/trabajador/AvisosDelRegistro.tsx', 'src/pages/trabajador/TrabajadorApp.tsx'])
    expect(duenoDeLaRama('claude/l1a-pr2-correcciones-e-informe', sinCapturas(pr(370)))).toBeNull()
    // Pero la e2e de inventario sigue corriendo: el portal es la puerta del autoconteo.
    expect(zonasTocadas(portal).map((z) => z.zona)).toEqual(['inventario'])
    expect(zonasDuenas(portal)).toEqual([])
  })

  it('una rama de inventario sí los fija: el #372 (y el #362, que cambió autoinventoryService.ts)', () => {
    expect(duenoDeLaRama('claude/autoconteo-hora', sinCapturas(pr(372)))).toBe('inventario')
    expect(duenoDeLaRama('claude/l1a-pr1', sinCapturas(pr(362)))).toBe('inventario')
    expect(duenoDeLaRama('claude/x', ['src/pages/trabajador/MiAutoinventario.tsx'])).toBe('inventario')
  })

  it('los cinco PR reales: la comprobación habría parado los tres de Laboral, nombrando cada PNG, y deja pasar los dos de inventario', () => {
    const veredicto = Object.fromEntries(PRS.map((p) => [p.pr, capturasAjenas('claude/rama', p.ficheros)]))
    expect(veredicto[370].ajenas).toEqual([
      'docs/inventario/capturas/e2e-conteo-aplicado-movil.png', 'docs/inventario/capturas/e2e-conteo-aplicado.png',
      'docs/inventario/capturas/e2e-tablet-aplicado-movil.png', 'docs/inventario/capturas/e2e-tablet-aplicado.png',
    ])
    expect(veredicto[350].ajenas).toHaveLength(4)
    expect(veredicto[354].ajenas).toHaveLength(6)
    expect(veredicto[372]).toEqual({ dueno: 'inventario', ajenas: [] })
    expect(veredicto[362]).toEqual({ dueno: 'inventario', ajenas: [] })
  })

  it('las capturas que cambia la propia rama no la hacen dueña de nada', () => {
    expect(duenoDeLaRama('claude/x', ['docs/inventario/capturas/e2e-aviso.png'])).toBeNull()
    expect(capturasAjenas('claude/x', ['docs/inventario/capturas/e2e-aviso.png']).ajenas).toEqual(['docs/inventario/capturas/e2e-aviso.png'])
  })

  it('comprobar falla con 1 y dice cuáles, y en una rama de inventario pasa', async () => {
    const { spawnSync } = await import('node:child_process')
    const correr = (ficheros: string[]) => spawnSync('node', ['scripts/conta/capturas.mjs', 'comprobar', 'claude/rama'],
      { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', CAPTURAS_CAMBIADOS: ficheros.join(',') } })
    const mal = correr(pr(370))
    expect(mal.status).toBe(1)
    expect(mal.stderr).toContain('trae 4 capturas que no son de su frente')
    expect(mal.stderr).toContain('· docs/inventario/capturas/e2e-tablet-aplicado-movil.png')
    const bien = correr(pr(372))
    expect(bien.status).toBe(0)
    expect(bien.stdout).toContain('todas de su frente (inventario)')
  })

  it('pr-a-main.yml lo comprueba en cada PR, sobre su diff', () => {
    const wf = readFileSync('.github/workflows/pr-a-main.yml', 'utf8')
    expect(wf).toContain('node scripts/conta/capturas.mjs revisar "$RAMA" "$BASE" "$HEAD"')
  })
})
