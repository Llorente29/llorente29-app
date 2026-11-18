// tests/unit/e2e/nocheQ02.test.ts — Q02 (17/11): que la noche vuelva a avisar de verdad.
// Contra las dos noches reales de main del 16 y el 17/11 (regla 31):
//   · fixtures/noche/noche-2026-11-17.json: los 40 fallos de la entera del 17/11
//     (run 44064019251), sacados de los registros de sus dos trozos;
//   · fixtures/noche/resumen-2026-11-16.json: los 13 ficheros en rojo del 16/11
//     (run 43837135307), copiados de la línea «ficheros=» de su aviso.
// A mano, el 17/11, salió: 18 en rojo, 6 nuevos, 12 que ya fallaban y uno
// (v03/corregir-y-cuadrar) que dejó de fallar.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comparar, cuerpo, decidir, esDeStaging, fallos, primeraLinea, resumen, TOPE } from '../../../scripts/e2e/noche.mjs'
import { compararConLaNoche, esNocheReal, lineasPr, resumenDeLaNoche, ultimaNoche } from '../../../scripts/e2e/ultima-noche.mjs'

const F = join(__dirname, 'fixtures/noche')
const N17 = JSON.parse(readFileSync(join(F, 'noche-2026-11-17.json'), 'utf8'))
const R16 = JSON.parse(readFileSync(join(F, 'resumen-2026-11-16.json'), 'utf8'))
const F17 = fallos(N17)
const rojos17 = [...new Set(F17.map((x) => x.fichero))]

const NUEVOS = [
  'tests/e2e/conta/pc01/cobros-y-pagos.spec.ts',
  'tests/e2e/conta/s01e/capturas.spec.ts',
  'tests/e2e/conta/s01e/ficha.spec.ts',
  'tests/e2e/conta/v03/verifactu.spec.ts',
  'tests/e2e/conta/v04/reabrir-iva.spec.ts',
  'tests/e2e/laboral/ls1-sumied.spec.ts',
]

describe('las dos noches reales: el 17/11 frente al 16/11', () => {
  it('el informe del 17/11 da los 40 fallos en 18 ficheros del aviso de esa noche', () => {
    expect(F17).toHaveLength(40)
    expect(rojos17).toHaveLength(18)
  })
  it('6 nuevos, 12 que ya fallaban y 1 que ha dejado de fallar, con sus nombres', () => {
    const c = comparar(rojos17, R16.ficheros)
    expect(c.nuevos).toEqual(NUEVOS)
    expect(c.yaFallaban).toHaveLength(12)
    expect(c.yaFallaban).toContain('tests/e2e/conta/c01b/flujos.spec.ts')
    expect(c.arreglados).toEqual(['tests/e2e/conta/v03/corregir-y-cuadrar.spec.ts'])
  })
  it('la primera línea se entiende sin abrir nada, y dice lo de staging', () => {
    const l = primeraLinea({ ficheros: rojos17, comparacion: comparar(rojos17, R16.ficheros), deStaging: ['a', 'b'] })
    expect(l).toBe('**18 en rojo: 6 nuevos, 12 que ya fallaban, 1 arreglado.** En 2 ficheros algo parece de staging (no se ha podido entrar, o no ha contestado a tiempo).')
  })
})

describe('el aviso dice la verdad entera', () => {
  const anterior = { ...R16, fecha: '16/11/2026', enlace: 'https://github.com/x/y/actions/runs/43837135307' }
  const t = cuerpo({ fallos: F17, sha: 'b24801da2e6cd9a3', asunto: 'X02 · La base de la salida a ERP10 (#704)', enlace: 'https://github.com/x/y/actions/runs/44064019251', trozos: 'failure', repeticion: '', anterior })

  it('arriba la línea; luego lo nuevo, prueba a prueba; luego lo que ya fallaba; al final lo arreglado', () => {
    expect(t.split('\n')[0]).toMatch(/^\*\*18 en rojo: 6 nuevos, 12 que ya fallaban, 1 arreglado\.\*\*/)
    const i = (s: string) => t.indexOf(s)
    expect(i('### Nuevo esta noche (6)')).toBeGreaterThan(0)
    expect(i('### Ya fallaba la noche anterior (12)')).toBeGreaterThan(i('### Nuevo esta noche (6)'))
    expect(i('### Ha dejado de fallar (1)')).toBeGreaterThan(i('### Ya fallaba la noche anterior (12)'))
    expect(t).toContain('- `tests/e2e/conta/v03/corregir-y-cuadrar.spec.ts`')
    expect(t).toContain('la noche real del 16/11/2026 (https://github.com/x/y/actions/runs/43837135307), con 13 ficheros en rojo')
  })
  it('lo nuevo, entero y sin cortar: cada prueba de los 6 ficheros, con su error', () => {
    const nuevo = t.slice(t.indexOf('### Nuevo esta noche'), t.indexOf('### Ya fallaba'))
    const filas = nuevo.split('\n').filter((l) => l.startsWith('| `tests/'))
    expect(filas).toHaveLength(F17.filter((x) => NUEVOS.includes(x.fichero)).length)
    expect(nuevo).toContain('«local» en Sumied (tiene que decir «centro»)')
    expect(nuevo).toContain('No se pudo entrar como b.admin.carril-1@prueba.folvy.test: HTTP 520` *(parece de staging)*')
    expect(t).not.toContain('y 15 más')
  })
  it('lo que ya fallaba, un fichero por línea con cuántas pruebas', () => {
    expect(t).toMatch(/\| `tests\/e2e\/conta\/c01b\/flujos\.spec\.ts` \| 8 \| `Error: expect\(locator\)\.toBeVisible\(\) failed` \|/)
  })
  it('si no cabe en un comentario de GitHub, lo nuevo pasa a un fichero por línea y se dice', () => {
    const muchos = Array.from({ length: 400 }, (_, k) => ({ ...F17[0], fichero: `tests/e2e/conta/z${k}/x.spec.ts` }))
    const largo = cuerpo({ fallos: muchos, sha: 'a', enlace: 'b', trozos: 'failure', repeticion: '', anterior })
    expect(largo.length).toBeLessThanOrEqual(TOPE)
    expect(largo).toContain('Prueba a prueba no cabe en un comentario')
  })
  it('sin noche anterior, lo dice en vez de llamar «nuevo» a todo en silencio', () => {
    const sin = cuerpo({ fallos: F17, sha: 'a', enlace: 'b', trozos: 'failure', repeticion: '', anterior: null })
    expect(sin.split('\n')[0]).toBe('**18 en rojo.** (No hay una noche real anterior con la que comparar.) En 2 ficheros algo parece de staging (no se ha podido entrar, o no ha contestado a tiempo).')
  })
})

describe('una 520 o un 57014 se repiten aunque haya otros fallos (el 17/11 no se repitió)', () => {
  it('el 17/11: se repiten los dos ficheros con 520, una vez', () => {
    const d = decidir({ informe: N17, trozos: 'failure', repeticion: '' })
    expect(d.accion).toBe('repetir')
    expect(d.ficheros).toEqual(['tests/e2e/conta/s01e/capturas.spec.ts', 'tests/e2e/conta/v04/reabrir-iva.spec.ts'])
  })
  it('el 57014 de staging, con su texto real del 17/11, cuenta como de staging', () => {
    expect(esDeStaging('[conta] conta_pendientes: 57014 canceling statement due to statement timeout')).toBe(true)
  })
  it('en la repetición no se repite otra vez, y lo que no se repitió sigue contando', () => {
    // La repetición de los dos sale en verde: siguen en rojo los otros 16 de la noche.
    const d = decidir({ informe: { suites: [] }, trozos: 'success', repeticion: '44064019251', noche: N17, repetidos: ['tests/e2e/conta/s01e/capturas.spec.ts', 'tests/e2e/conta/v04/reabrir-iva.spec.ts'] })
    expect(d.accion).toBe('avisar')
    expect(d.ficheros).toHaveLength(16)
    expect(d.ficheros).not.toContain('tests/e2e/conta/s01e/capturas.spec.ts')
  })
  it('una repetición en verde no cierra la incidencia si no se ha podido leer la noche', () => {
    const d = decidir({ informe: { suites: [] }, trozos: 'success', repeticion: '1', noche: null, repetidos: ['tests/e2e/conta/s01e/capturas.spec.ts'] })
    expect(d.accion).toBe('avisar')
    expect(d.faltaLaNoche).toBe(true)
  })
  it('y si todo lo de la noche era de staging y la repetición pasa: verde', () => {
    const soloStaging = { suites: N17.suites.filter((s: { file: string }) => /s01e\/capturas/.test(s.file)) }
    const d = decidir({ informe: { suites: [] }, trozos: 'success', repeticion: '1', noche: soloStaging, repetidos: ['tests/e2e/conta/s01e/capturas.spec.ts'] })
    expect(d.accion).toBe('verde')
  })
})

// Los jobs de verdad de los dos runs del 17/11 (nombre y conclusión, de la API).
const JOBS_0839 = [{ name: 'plan', conclusion: 'success' }, { name: 'trozo ${{ matrix.trozo }}/${{ needs.plan.outputs.n }}', conclusion: 'skipped' }, { name: 'entera', conclusion: 'skipped' }, { name: 'aviso', conclusion: 'skipped' }]
const JOBS_1021 = [{ name: 'plan', conclusion: 'success' }, { name: 'trozo 2/2', conclusion: 'failure' }, { name: 'trozo 1/2', conclusion: 'failure' }, { name: 'entera', conclusion: 'failure' }, { name: 'aviso', conclusion: 'failure' }]

describe('la noche real: la que corrió pruebas, no el disparo que se salta', () => {
  it('el «verde» de las 08:39 del 17/11 no es una noche real; el rojo de las 10:21 sí', () => {
    expect(esNocheReal(JOBS_0839)).toBe(false)
    expect(esNocheReal(JOBS_1021)).toBe(true)
  })
  it('la última noche real se salta los disparos que no tocan, aunque sean más nuevos', async () => {
    const noches = [
      { id: 44064019251, status: 'completed', conclusion: 'failure' },
      { id: 44048542508, status: 'completed', conclusion: 'success' },
      { id: 43837135307, status: 'completed', conclusion: 'failure' },
    ]
    const jobs: Record<number, typeof JOBS_0839> = { 44064019251: JOBS_1021, 44048542508: JOBS_0839, 43837135307: JOBS_1021 }
    const jobsDe = async (id: number) => jobs[id]
    expect((await ultimaNoche({ noches, jobsDe }))?.id).toBe(44064019251)
    // La anterior a la del 17/11: no la de las 08:39 (que no corrió), sino la del 16/11.
    expect((await ultimaNoche({ noches, jobsDe, antesDe: 44064019251 }))?.id).toBe(43837135307)
    // Un disparo que no toca, ya cancelado (Q02), ni se mira.
    expect(await ultimaNoche({ noches: [{ id: 5, status: 'completed', conclusion: 'cancelled' }], jobsDe: async () => JOBS_1021 })).toBeNull()
  })
  it('una noche de antes del Q02 sin «noche-resumen» sale de su informe JSON; si se repitió, manda la repetición', async () => {
    const noche = { id: 44064019251, created_at: '2026-11-17T10:21:08Z', html_url: 'R', head_sha: 'b24801d' }
    const sinRes = await resumenDeLaNoche(noche, { descargar: async (_: number, n: string) => (n === 'informe-json' ? N17 : null) })
    expect(sinRes).toMatchObject({ fecha: '17/11/2026', fallos: 40, enlace: 'R' })
    expect(sinRes?.ficheros).toHaveLength(18)
    const rep = { id: 9, created_at: '2026-11-17T11:40:00Z', html_url: 'REP' }
    const conRep = await resumenDeLaNoche(noche, { repeticiones: [rep], descargar: async (id: number) => (id === 9 ? resumen({ fallos: F17.slice(0, 3), run: 9, sha: 'b', fecha: 'x', noche: '44064019251' }) : null) })
    expect(conRep).toMatchObject({ enlace: 'REP', repetida: true, fallos: 3 })
  })
})

describe('lo que ve cada PR, y la entera lanzada a mano en una rama', () => {
  const r = { ...resumen({ fallos: F17, run: 44064019251, sha: 'b', fecha: '17/11/2026' }), enlace: 'https://github.com/x/y/actions/runs/44064019251' }
  it('el PR: la fecha, cuántos ficheros en rojo, el enlace, y que no bloquea', () => {
    const t = lineasPr(r).join('\n')
    expect(t).toContain('**La última noche real de `main` (17/11/2026):** **18 ficheros en rojo**. https://github.com/x/y/actions/runs/44064019251')
    expect(t).toContain('No bloquea fusionar')
  })
  it('la entera de una rama separa lo que solo falla en ella de lo que también falla en main', () => {
    // Como el 17/11 por la tarde (run 44124387355): 14 de sus 17 ya fallaban en main.
    const rama = [...F17.filter((x) => !/laboral|s01e|v04|pc01/.test(x.fichero)), { ...F17[0], fichero: 'tests/e2e/conta/r05/dia.spec.ts' }]
    const t = compararConLaNoche(rama, r).join('\n')
    expect(t).toMatch(/^\*\*14 ficheros en rojo: 1 solo en esta rama, 13 que también fallan en `main`\*\*/)
    expect(t).toContain('### Solo fallan en esta rama (1)\n\n- `tests/e2e/conta/r05/dia.spec.ts` (1 prueba)')
  })
})
