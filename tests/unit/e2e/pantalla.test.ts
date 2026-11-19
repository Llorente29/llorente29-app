// tests/unit/e2e/pantalla.test.ts — Q03 (18/11): cuando una e2e falla, lo que
// había en pantalla, al registro. Contra un error-context.md y una traza
// DE VERDAD de Playwright 1.63 (fixtures/pantalla/playwright-1.63.*, de un
// fallo provocado en local, con una cabecera Authorization y un apikey falsos
// para ver que no salen) y el de la K03 del 18/11 (fabricado a partir de su
// registro, run 44198365426: ver su «# Origen»).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOPES, bloque, compactarFilas, deLaTraza, domDeLaTraza, erroresDeLaSalida, fraseFuera, leerContexto, limpiar, ordenarPantalla, repartirPantalla, resumenError, resumenMd } from '../../../scripts/e2e/pantalla.mjs'

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
  it('una pantalla larga se corta en su tope por prueba, y dice de qué parte es lo que quita', () => {
    const larga = Array.from({ length: TOPES.lineasPantalla + 100 }, (_, k) => `- text: fila ${k}`)
    const t = bloque({ ...f, pantalla: larga }).join('\n')
    expect(t).toContain(`- text: fila ${TOPES.lineasPantalla - 1}`)
    expect(t).not.toContain(`- text: fila ${TOPES.lineasPantalla}\n`)
    expect(t).toContain('… y 100 líneas de lo demás, que no caben: la pantalla entera está en el artefacto.')
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

describe('lo que importa, delante: la pantalla real del plan contable en staging (run 44247888358)', () => {
  const real = leer('staging-plan-contable.pantalla.txt').split('\n').filter((l) => l.trim() && !l.startsWith('# '))
  const o = ordenarPantalla(real)
  it('en el orden de Playwright, el menú se comía el tope: el título del plan caía en la línea 50 y pico', () => {
    expect(real.findIndex((l) => l.includes('heading "Plan contable"'))).toBeGreaterThan(50)
  })
  it('ordenada: sin «/url:», «main» delante del menú, y el título y la búsqueda escrita en las primeras 15 líneas', () => {
    expect(o.some((l) => l.includes('/url:'))).toBe(false)
    expect(o.findIndex((l) => /^- main/.test(l))).toBeLessThan(o.findIndex((l) => /^- navigation/.test(l)))
    expect(o.findIndex((l) => l.includes('heading "Plan contable" [level=1]'))).toBeLessThan(15)
    expect(o.findIndex((l) => l.includes('searchbox "Buscar una cuenta": zzz q03 no existe'))).toBeLessThan(15)
  })
  it('no pierde ni inventa nada: las mismas líneas, salvo las «/url:»', () => {
    expect([...o].sort()).toEqual(real.filter((l) => !l.includes('/url:')).sort())
  })
  it('un diálogo o un aviso va delante de todo', () => {
    expect(ordenarPantalla(['- navigation "Menú":', '  - link "Inicio"', '- main:', '  - heading "X" [level=1]', '- dialog "¿Borrar?":', '  - button "Borrar"'])[0]).toBe('- dialog "¿Borrar?":')
  })
})

// X09 (19/11) · El volcado se cortaba a las 60 líneas justo antes de lo importante (Q no vio qué
// se quedaba cargando; N, en qué casilla se paró). Contra un árbol largo DE VERDAD: la pantalla
// «Salida a ERP10» (paso 3, 219 cuentas, el grupo «quedan igual» abierto) en el marco del núcleo,
// con datos inventados, recién pulsado «Ya la he metido a mano» (la tabla, en aria-busy); y las
// instantáneas del DOM de su traza (fixtures/pantalla/x09-nucleo-paso3.*: ver su «# Origen»).
describe('X09 · un árbol largo de verdad: la pestaña activa, entera y delante', () => {
  const md = leer('x09-nucleo-paso3.error-context.md')
  const crudo = (md.match(/```yaml\s*\n([\s\S]*?)\n```/)?.[1] ?? '').split('\n').filter((l) => l.trim())
  const X = leerContexto(md)
  const DOM = domDeLaTraza(leer('x09-nucleo-paso3.trace.eventos').split('\n'))
  const zona = (ls: string[]) => {
    const i = ls.findIndex((l) => l.startsWith('- main "Ejercicios"'))
    const j = ls.findIndex((l, k) => k > i && /^- /.test(l))
    return ls.slice(i, j < 0 ? undefined : j)
  }
  const fallo = { donde: 'conta/x06/comprobar-erp10.spec.ts:87', titulo: 'paso 3', tamano: 'ordenador', error: X.error, pantalla: X.pantalla, activa: DOM.activa, ocupados: DOM.ocupados }

  it('el árbol es largo de verdad: más de mil líneas, y la pestaña sola pasa de sobra las 60 de antes', () => {
    expect(crudo.length).toBeGreaterThan(1000)
    expect(zona(X.pantalla!).length).toBeGreaterThan(60)
  })
  it('las filas, en una línea: fuera las celdas que solo repiten el texto de la fila; las que tienen algo dentro se quedan', () => {
    expect(X.pantalla!.length).toBeLessThan(crudo.length / 3)
    expect(X.pantalla).toContain('        - row "43000100 Cliente Inventado 0 100,00 100,00"')
    expect(X.pantalla!.some((l) => /^\s*- cell "Cliente Inventado 0"$/.test(l))).toBe(false)
    expect(compactarFilas(['- row "a b":', '  - cell "a"', '  - cell "b":', '    - textbox "b"'])).toEqual(['- row "a b":', '  - cell "b":', '    - textbox "b"'])
    expect(compactarFilas(['- row "a b":', '  - cell "a"', '  - cell "b"'])).toEqual(['- row "a b"'])
  })
  it('de la traza: la pestaña activa del marco y lo que estaba cargando (aria-busy), que el árbol no dice', () => {
    expect(DOM.activa).toBe('Ejercicios')
    expect(DOM.ocupados).toEqual(['en la pestaña «Ejercicios»: div.cxe-marco («Cuenta Nombre Saldo en Sumied Saldo en ERP10 Diferencia 3 cuentas no quedan igual 41000012»)'])
    expect(domDeLaTraza([])).toEqual({ activa: null, ocupados: [] })
  })
  it('en el registro: lo que cargaba lo primero, después la pestaña activa ENTERA, y el resto detrás', () => {
    const t = bloque(fallo)
    const i = t.indexOf('Lo que había en pantalla:')
    expect(t[i + 1]).toBe('  [cargando] en la pestaña «Ejercicios»: div.cxe-marco («Cuenta Nombre Saldo en Sumied Saldo en ERP10 Diferencia 3 cuentas no quedan igual 41000012»)')
    expect(t[i + 2]).toBe('  - main "Ejercicios":')
    const z = zona(X.pantalla!)
    expect(t.slice(i + 2, i + 2 + z.length)).toEqual(z.map((l) => `  ${l.length > TOPES.ancho ? `${l.slice(0, TOPES.ancho - 1)}…` : l}`))
    expect(t.join('\n')).toContain('- button "Ya la he metido a mano"')
  })
  it('si no cabe todo, el tope se cuenta sobre lo que importa: la pestaña sigue entera y se dice qué se ha quitado', () => {
    const z = zona(X.pantalla!)
    const r = repartirPantalla(X.pantalla!, { zona: 'Ejercicios', tope: z.length + 3 })
    expect(r.lineas.slice(0, z.length)).toEqual(z)
    expect([...r.fuera.keys()]).toEqual(expect.arrayContaining(['la cabecera', 'la cinta', 'el menú']))
    expect(fraseFuera(r.fuera)).toMatch(/^… y \d+ líneas de .*la cinta.* y el menú, que no caben: la pantalla entera está en el artefacto\.$/)
    const t = bloque(fallo, { topes: { ...TOPES, lineasPantalla: z.length + 3 } }).join('\n')
    expect(t).toMatch(/… y \d+ líneas de .*el menú, que no caben/)
    // Con el tope de antes (60), la pestaña se cortaba: ahora, solo si la pestaña sola no cabe, y lo dice.
    const corto = repartirPantalla(X.pantalla!, { zona: 'Ejercicios', tope: 60 })
    expect(fraseFuera(corto.fuera)).toMatch(/^… y \d+ líneas de la pestaña «Ejercicios», la franja de arriba, la cabecera/)
  })
  it('los avisos y los diálogos, delante de la pestaña', () => {
    const r = repartirPantalla(['- navigation "Menú":', '  - link "Uno"', '- main "Asientos":', '  - paragraph: Hola', '- dialog "¿Seguro?":', '  - button "Sí"'])
    expect(r.lineas).toEqual(['- dialog "¿Seguro?":', '  - button "Sí"', '- main "Asientos":', '  - paragraph: Hola', '- navigation "Menú":', '  - link "Uno"'])
  })
  it('el resumen del run: también la pestaña y lo que cargaba, primero', () => {
    const t = resumenMd(fallo).join('\n')
    expect(t).toContain('# [cargando] en la pestaña «Ejercicios»')
    expect(t.indexOf('- main "Ejercicios":')).toBeLessThan(t.indexOf('- banner:') < 0 ? Infinity : t.indexOf('- banner:'))
  })
})
