// tests/unit/e2e/pantalla.test.ts — Q03 (18/11): cuando una e2e falla, lo que
// había en pantalla, al registro. Contra un error-context.md y una traza
// DE VERDAD de Playwright 1.63 (fixtures/pantalla/playwright-1.63.*, de un
// fallo provocado en local, con una cabecera Authorization y un apikey falsos
// para ver que no salen) y el de la K03 del 18/11 (fabricado a partir de su
// registro, run 44198365426: ver su «# Origen»).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOPES, bloque, deLaTraza, erroresDeLaSalida, leerContexto, limpiar, resumenError, resumenMd } from '../../../scripts/e2e/pantalla.mjs'

const F = join(__dirname, 'fixtures/pantalla')
const leer = (n: string) => readFileSync(join(F, n), 'utf8')
const PW = leerContexto(leer('playwright-1.63.error-context.md'))
const K03 = leerContexto(leer('k03-plan-vacio.error-context.md'))
const TRAZA = deLaTraza({
  red: leer('playwright-1.63.trace.network').split('\n'),
  eventos: leer('playwright-1.63.trace.eventos').split('\n'),
  cuerpo: (f: string) => (f.endsWith('3f28bdc8c271fae31f51e98e382126f9dd7798e2.json') ? leer('playwright-1.63.respuesta.json') : null),
})

describe('el error-context.md de Playwright 1.63', () => {
  it('saca el error y el árbol de la pantalla, con el estado de cada botón y la frase de vacío', () => {
    expect(PW.error).toMatch(/^Error: expect\(locator\)\.toBeVisible\(\) failed/)
    expect(PW.pantalla).toEqual([
      '- heading "Plan contable" [level=1]',
      '- group "Grupos":',
      '  - button "Grupo 6" [pressed]',
      '  - button "Grupo 7"',
      '- checkbox "Solo con saldo"',
      '- text: Solo con saldo',
      '- paragraph: Ninguna cuenta encaja con lo que buscas.',
    ])
  })
  it('no copia el código de la prueba («# Test source»)', () => {
    expect(PW.pantalla!.join('\n')).not.toContain('page.route')
    expect(PW.error).not.toContain('page.route')
  })
  it('sin árbol (la prueba falló antes de abrir la página): lo dice', () => {
    const sin = leerContexto('# Error details\n\n```\nError: No se pudo entrar como b.admin@prueba.folvy.test: HTTP 520\n```\n')
    expect(sin.pantalla).toBeNull()
    expect(bloque({ donde: 'a.spec.ts:1', titulo: 't', error: sin.error }).join('\n')).toContain('Playwright no la guardó')
  })
})

describe('qué esperaba: en pocas líneas, sin la lista de llamadas', () => {
  it('la K03: el error, el localizador, lo esperado y «element(s) not found»', () => {
    const r = resumenError(K03.error)
    expect(r[0]).toBe('Error: expect(locator).toBeVisible() failed')
    expect(r).toContain('Expected: visible')
    expect(r).toContain('Error: element(s) not found')
    expect(r.join('\n')).not.toContain('Call log')
    expect(r.join('\n')).not.toContain('waiting for')
  })
})

describe('lo que contestó la base y los errores de la página, de la traza', () => {
  it('solo los 4xx y 5xx, con método, ruta y el principio de la respuesta', () => {
    expect(TRAZA.respuestas).toEqual([{ estado: 500, metodo: 'GET', ruta: 'base.example/rest/v1/rpc/conta_plan?select=*&apikey=‹quitado›', contesto: '{"code":"57014","message":"canceling statement due to statement timeout"}' }])
  })
  it('los errores de la consola y de la página', () => {
    expect(TRAZA.errores).toContain('[consola] conta_plan: 500')
    expect(TRAZA.errores).toContain('[error de la página] No se pudo leer el plan')
  })
  it('ninguna cabecera ni token: la traza trae «Authorization: Bearer …» y el apikey en la URL', () => {
    expect(leer('playwright-1.63.trace.network')).toContain('TOKENSECRETO')
    const todo = JSON.stringify(TRAZA) + bloque({ donde: 'x', titulo: 'y', error: PW.error, pantalla: PW.pantalla, ...TRAZA }).join('\n')
    expect(todo).not.toContain('TOKENSECRETO')
    expect(todo).not.toContain('SECRETO123')
    expect(todo).not.toMatch(/Authorization/i)
  })
  it('limpiar: un JWT, un Bearer, parámetros y campos con secretos', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoiYW5vbiJ9', 'abcdefghijklmnop'].join('.')
    expect(limpiar(`apikey ${jwt}`)).toBe('apikey ‹token quitado›')
    expect(limpiar('Bearer abcdefgh12345678')).toBe('Bearer ‹quitado›')
    expect(limpiar('/auth/v1/token?grant_type=password&refresh_token=zzz')).toBe('/auth/v1/token?grant_type=password&refresh_token=‹quitado›')
    expect(limpiar('{"email":"a@prueba.folvy.test","password":"Xy12"}')).toBe('{"email":"a@prueba.folvy.test","password":"‹quitado›"}')
    // Un filtro de la base no es un secreto: se queda.
    expect(limpiar('/rest/v1/account?code=eq.57200001')).toBe('/rest/v1/account?code=eq.57200001')
  })
  it('lo que escribe la prueba ([error de la página], [consola]), si no hay traza', () => {
    expect(erroresDeLaSalida(['[consola] Failed to fetch\n', 'otra cosa', '[error de la página] x'])).toEqual(['[consola] Failed to fetch', '[error de la página] x'])
  })
})

describe('el bloque del registro: qué prueba, qué esperaba y qué había, en ese orden', () => {
  const f = { donde: 'conta/k03/pestanas.spec.ts:38', titulo: 'pestañas vivas a 1456 × 816: volver sin perder, F5, cerrar con cambios y recargar', tamano: 'ordenador', error: K03.error, pantalla: K03.pantalla, respuestas: [], errores: [] }
  const b = bloque(f)
  it('cabecera, error, pantalla y cierre', () => {
    expect(b[0]).toBe('── Falló: conta/k03/pestanas.spec.ts:38 · pestañas vivas a 1456 × 816: volver sin perder, F5, cerrar con cambios y recargar [ordenador] ──')
    expect(b[1]).toBe('Esperaba: Error: expect(locator).toBeVisible() failed')
    const i = b.indexOf('Lo que había en pantalla:')
    expect(i).toBeGreaterThan(1)
    expect(b.slice(i)).toContain('  - paragraph: Ninguna cuenta encaja con lo que buscas.')
    expect(b.slice(i)).toContain('    - button "8 · Gastos imputados al patrimonio neto" [pressed]')
    expect(b.at(-2)).toBe('── fin de: conta/k03/pestanas.spec.ts:38 ──')
  })
  it('una pantalla larga se corta en su tope por prueba, y lo dice', () => {
    const larga = Array.from({ length: 100 }, (_, k) => `- text: fila ${k}`)
    const t = bloque({ ...f, pantalla: larga }).join('\n')
    expect(t).toContain('- text: fila 59')
    expect(t).not.toContain('- text: fila 60')
    expect(t).toContain(`… y ${100 - TOPES.lineasPantalla} líneas más; la pantalla entera está en el artefacto.`)
  })
  it('pasado el tope del run: solo la cabecera y el error, y se dice dónde está', () => {
    const t = bloque(f, { copiar: false }).join('\n')
    expect(t).toContain('── Falló: conta/k03/pestanas.spec.ts:38')
    expect(t).toContain('Esperaba: Error: expect(locator).toBeVisible() failed')
    expect(t).not.toContain('Ninguna cuenta encaja')
    expect(t).toContain('Está en el artefacto «playwright-report»')
  })
  it('el resumen del run: plegado, con el error en la línea que se ve', () => {
    const r = resumenMd(f).join('\n')
    expect(r).toMatch(/^<details><summary>❌ <code>conta\/k03\/pestanas\.spec\.ts:38<\/code> · pestañas vivas a 1456 × 816/)
    expect(r).toContain('— Error: expect(locator).toBeVisible() failed</summary>')
    expect(r).toContain('**Lo que había en pantalla**')
    expect(r).toContain('- paragraph: Ninguna cuenta encaja con lo que buscas.')
  })
})
