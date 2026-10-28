// W08b (Julio, 28/10) · Las capturas, FUERA del PR. El bot ya no hace commits
// en la rama del PR (dejaban sus comprobaciones en «Action required» y los PNG
// chocaban con main): las del frente van a capturas/<rama>, el PR las enseña en
// un comentario por tablero, y al fusionar pasan a main sin desplegar.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capturasEn, comentarioCapturas, esCaptura, ramaDeCapturas, tableroDe } from '../../scripts/conta/capturas.mjs'
import { MARCA, saltarBuild } from '../../scripts/vercel/saltar-build.mjs'

const CERRAR = readFileSync('.github/workflows/capturas-al-cerrar.yml', 'utf8')

describe('el comentario del PR: miniaturas por tablero', () => {
  const sha = '5ba5be6e12d1af333a6a4e758cb01a4d1b16dc88'
  const rutas = ['docs/conta/capturas/c00/marco-ordenador.png', 'docs/conta/capturas/b01/bancos-movil.png',
    'docs/conta/capturas/c00/marco-movil.png', 'docs/conta/capturas/c00/notas.md']
  const md = comentarioCapturas({ repo: 'Llorente29/llorente29-app', sha, rama: 'conta/c06-x', rutas })

  it('agrupa por tablero, en orden, y dentro de cada uno por nombre; solo imágenes', () => {
    expect(md.indexOf('**b01** · 1')).toBeLessThan(md.indexOf('**c00** · 2'))
    expect(md.indexOf('marco-movil.png')).toBeLessThan(md.indexOf('marco-ordenador.png'))
    expect(md).not.toContain('notas.md')
    expect(md).toContain('**3 capturas del frente**')
  })
  it('enlaza el commit publicado (no la rama, que se reescribe) y la rama aparte', () => {
    expect(md).toContain(`https://github.com/Llorente29/llorente29-app/blob/${sha}/docs/conta/capturas/c00/marco-movil.png?raw=true`)
    expect(md).toContain('[`capturas/conta/c06-x`](https://github.com/Llorente29/llorente29-app/tree/capturas/conta/c06-x)')
  })
  it('sin imágenes, nada; y el tablero de cada carpeta', () => {
    expect(comentarioCapturas({ repo: 'r/r', sha, rama: 'x', rutas: ['docs/conta/capturas/c00/a.md'] })).toBe('')
    expect(tableroDe('docs/conta/capturas/c06c/x.png')).toBe('c06c')
    expect(tableroDe('docs/reparto/capturas/r02/x.png')).toBe('r02')
    expect(tableroDe('docs/inventario/capturas/e2e-aviso.png')).toBe('inventario')
    expect(ramaDeCapturas('claude/w08b')).toBe('capturas/claude/w08b')
  })
})

describe('suyas: las de este run que son del frente', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'capturas-'))
  for (const r of ['docs/conta/capturas/c00/a.png', 'docs/conta/capturas/b01/x.png', 'docs/inventario/capturas/i.png']) {
    mkdirSync(join(raiz, r, '..'), { recursive: true }); writeFileSync(join(raiz, r), 'x')
  }
  const suyas = (rama: string, dueno = '') => spawnSync('node', ['scripts/conta/capturas.mjs', 'suyas', rama, raiz],
    { encoding: 'utf8', env: { ...process.env, CAPTURAS_CAMBIADOS: '', CAPTURAS_DUENO: dueno } })

  it('una rama del frente C publica solo las de c00; las de otros, al artefacto', () => {
    expect(capturasEn(raiz)).toHaveLength(3)
    const r = suyas('conta/c06-x')
    expect(r.stdout.trim().split('\n')).toEqual(['docs/conta/capturas/c00/a.png'])
    expect(r.stderr).toContain('No se publican 2 de otras carpetas')
  })
  it('a mano, con «frente», se fuerza el dueño (c) en una rama que no es de ninguno', () => {
    expect(suyas('claude/w08b-x').stdout).toBe('')
    expect(suyas('claude/w08b-x', 'c').stdout.trim()).toBe('docs/conta/capturas/c00/a.png')
    expect(suyas('claude/w08b-x', 'no-existe').stdout).toBe('')
  })
})

describe('Vercel no despliega el commit de capturas a main', () => {
  const ficherosDe = (c: string) => execFileSync('git', ['show', '--name-only', '--format=', c], { encoding: 'utf8' }).split('\n').filter(Boolean)

  it('se salta SOLO con la marca del bot y solo capturas', () => {
    expect(saltarBuild({ mensaje: `${MARCA} #376 (conta/c06-x)`, ficheros: ['docs/conta/capturas/c00/a.png'] })).toBe(true)
    expect(saltarBuild({ mensaje: 'Capturas fijadas en staging-conta (x)', ficheros: ['docs/conta/capturas/c00/a.png'] })).toBe(false)
    expect(saltarBuild({ mensaje: `${MARCA} #1`, ficheros: ['docs/conta/capturas/c00/a.png', 'src/main.tsx'] })).toBe(false)
    expect(saltarBuild({ mensaje: `${MARCA} #1`, ficheros: [] })).toBe(false)
    expect(saltarBuild({ mensaje: undefined, ficheros: ['docs/conta/capturas/c00/a.png'] })).toBe(false)
  })
  it('contra fusiones reales de main, con la marca puesta a propósito: todas se construyen', () => {
    // El #370 (código y 4 PNG), el #375 (código) y el #372 (código y 5 PNG).
    for (const c of ['f32eb834', '7eb12f5b', 'ab09f0f8']) expect(saltarBuild({ mensaje: `${MARCA} #x`, ficheros: ficherosDe(c) }), c).toBe(false)
    // Y lo que dejaría el bot de esas mismas fusiones (solo sus PNG), sí se salta.
    expect(saltarBuild({ mensaje: `${MARCA} #370`, ficheros: ficherosDe('f32eb834').filter(esCaptura) })).toBe(true)
  })
  it('vercel.json lo usa como ignoreCommand', () => {
    expect(JSON.parse(readFileSync('vercel.json', 'utf8')).ignoreCommand).toBe('node scripts/vercel/saltar-build.mjs')
  })
})

describe('al cerrar el PR (capturas-al-cerrar.yml)', () => {
  it('al cerrar un PR a main; con permiso solo de contenido; una detrás de otra', () => {
    expect(CERRAR).toContain('on:\n  pull_request:\n    types: [closed]\n    branches: [main]')
    expect(CERRAR).toContain('permissions:\n  contents: write\n\n')
    expect(CERRAR).toContain('cancel-in-progress: false')
  })
  it('a main solo si se fusionó, con la marca de Vercel, comprobando que son capturas y volviendo a empezar si main se mueve', () => {
    const paso = CERRAR.slice(CERRAR.indexOf('- name: A main, en su carpeta'), CERRAR.indexOf('- name: Borrar'))
    expect(paso).toContain("if: steps.hay.outputs.si == '1' && env.FUSIONADO == 'true'")
    expect(paso).toContain(`git commit -q -m "${MARCA} #$PR ($RAMA)"`)
    expect(paso).toContain('esCaptura')
    expect(paso).toMatch(/for vuelta in 1 2 3; do[\s\S]*git push -q origin HEAD:main[\s\S]*git reset -q --hard origin\/main/)
  })
  it('borra capturas/<rama> al cerrar o fusionar, pero no si falló el paso a main', () => {
    const paso = CERRAR.slice(CERRAR.indexOf('- name: Borrar'))
    expect(paso).toContain("if: always() && steps.hay.outputs.si == '1' && (env.FUSIONADO != 'true' || steps.main.outcome == 'success')")
    expect(paso).toContain('git push -q origin --delete "capturas/$RAMA"')
  })
})
