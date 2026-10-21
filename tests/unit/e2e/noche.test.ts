// tests/unit/e2e/noche.test.ts — la entera de la noche: ¿verde, repetir o avisar?
// Julio, 21/10. Contra los fallos REALES de las e2e del 19 al 21/10
// (fixtures/noche/fallos-reales.json, regla 31) y un informe JSON de Playwright
// de verdad para la forma (fixtures/noche/informe-forma.json).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cuerpo, decidir, esDeStaging, fallos } from '../../../scripts/e2e/noche.mjs'

const F = join(__dirname, 'fixtures/noche')
const REALES = JSON.parse(readFileSync(join(F, 'fallos-reales.json'), 'utf8')).fallos as { fichero: string; error: string; staging: boolean }[]
const INFORME = JSON.parse(readFileSync(join(F, 'informe-forma.json'), 'utf8'))

describe('qué es de staging: los fallos reales del 19 al 21/10', () => {
  it('cada uno, como se clasificó a mano', () => {
    for (const r of REALES) expect(esDeStaging(r.error), `${r.fichero}: ${r.error.split('\n')[0]}`).toBe(r.staging)
  })
  it('hay de los dos lados (si no, la prueba no podría fallar)', () => {
    expect(REALES.filter((r) => r.staging).length).toBeGreaterThanOrEqual(3)
    expect(REALES.filter((r) => !r.staging).length).toBeGreaterThanOrEqual(5)
  })
  it('un 520 suelto en una aserción (un importe) no es de staging', () => {
    expect(esDeStaging('expect(received).toContain(expected)\nExpected substring: "520,00 €"')).toBe(false)
    expect(esDeStaging('Expected: "Presentar los 503 modelos"')).toBe(false)
  })
})

describe('el informe de la noche', () => {
  it('saca cada prueba que falló: fichero con su ruta, línea, tamaño y la primera línea del error', () => {
    const f = fallos(INFORME)
    expect(f).toHaveLength(6)
    const comp = f.filter((x) => x.fichero === 'tests/e2e/conta/compras/compras.spec.ts')
    expect(comp.map((x) => x.tamano).sort()).toEqual(['movil', 'ordenador'])
    expect(comp[0]).toMatchObject({ linea: 2, prueba: 'La liquidación de septiembre y su contraste (N19)', deStaging: true })
    expect(comp[0].primera).toBe('Error: No se pudo entrar como a.admin.carril-1@prueba.folvy.test: HTTP 520')
    const banco = f.find((x) => x.fichero.endsWith('b01/conciliar.spec.ts'))!
    expect(banco).toMatchObject({ tamano: 'movil', prueba: 'B02 · Bancos, conciliar › móvil: tarjetas, «Confirmar los 3 seguros» arriba y el panel en hoja', deStaging: true })
    expect(f.filter((x) => !x.deStaging).map((x) => x.fichero)).toEqual(expect.arrayContaining(['tests/e2e/conta/p01/despacho.spec.ts']))
    // Lo que pasó no sale.
    expect(f.some((x) => x.fichero.endsWith('s01g/ancho.spec.ts'))).toBe(false)
  })

  it('con un fallo de verdad: avisar a la primera, aunque haya otros de staging', () => {
    const d = decidir({ informe: INFORME, trozos: 'failure', repeticion: '' })
    expect(d.accion).toBe('avisar')
  })

  it('si todo lo que falló es de staging: repetir esos ficheros, una vez', () => {
    const soloStaging = { ...INFORME, suites: INFORME.suites.filter((s: { file: string }) => /compras|conciliar/.test(s.file)) }
    const d = decidir({ informe: soloStaging, trozos: 'failure', repeticion: '' })
    expect(d.accion).toBe('repetir')
    expect(d.ficheros).toEqual(['tests/e2e/conta/b01/conciliar.spec.ts', 'tests/e2e/conta/compras/compras.spec.ts'])
    // Y en la repetición, si vuelve a fallar, se avisa.
    expect(decidir({ informe: soloStaging, trozos: 'failure', repeticion: '39500000000' }).accion).toBe('avisar')
  })

  it('si no llegó a fallar ninguna prueba pero los trozos no están en verde: repetir (la entera), y luego avisar', () => {
    expect(decidir({ informe: null, trozos: 'failure', repeticion: '' })).toMatchObject({ accion: 'repetir', ficheros: [] })
    expect(decidir({ informe: null, trozos: 'failure', repeticion: '1' }).accion).toBe('avisar')
  })

  it('verde solo si los trozos están en verde y no hay ningún fallo', () => {
    const verde = { ...INFORME, suites: INFORME.suites.filter((s: { file: string }) => /ancho/.test(s.file)) }
    expect(decidir({ informe: verde, trozos: 'success', repeticion: '' }).accion).toBe('verde')
  })
})

describe('el aviso dice qué prueba, en qué fichero y el commit', () => {
  it('con su tabla', () => {
    const t = cuerpo({ fallos: fallos(INFORME), sha: '7b26bbd1332aa66a', asunto: 'I01b · El recuadro del plazo (#265)', enlace: 'https://github.com/x/y/actions/runs/1', trozos: 'failure', repeticion: '' })
    expect(t).toContain('`7b26bbd` — I01b · El recuadro del plazo (#265)')
    expect(t).toContain('6 pruebas en 3 ficheros')
    expect(t).toContain('| `tests/e2e/conta/p01/despacho.spec.ts:2` | 1 · Todos los filtros apagados: las cifras, los 8 clientes y lo que vence primero | movil | `Error: Todos: la página se sale 435 px por la derecha` |')
    // El error, en código: un «<html>» de la base no se lo come GitHub.
    expect(t).toContain('`Error: bank_proponer: <html>` *(parece de staging)*')
    expect(t).toContain('*(parece de staging)*')
  })
  it('la repetición lo dice y enlaza la noche', () => {
    const t = cuerpo({ fallos: [], sha: 'abc1234', enlace: 'R2', enlaceNoche: 'R1', trozos: 'failure', repeticion: '1' })
    expect(t).toContain('ha vuelto a fallar')
    expect(t).toContain('(la de la noche: R1)')
    expect(t).toContain('ninguna prueba llegó a fallar')
  })
})
