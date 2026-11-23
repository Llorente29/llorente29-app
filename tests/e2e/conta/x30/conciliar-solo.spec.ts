/// <reference lib="dom" />
// tests/e2e/conta/x30/conciliar-solo.spec.ts — X30 · Conciliar: lo seguro se concilia solo, y reglas de verdad (pieza 2
// del conciliador, maqueta 23b), contra staging, a 1366 × 768 y a 1920 × 1080, en la gestoría de ejemplo del núcleo
// (semillas K02, K04 y K05), con su «Banco principal» (57200001):
//   · «Traer el extracto» lee un Norma 43 de prueba: tres pagos con una palabra nueva de esta pasada y un cuarto con otra;
//   · «＋ Crear regla con este» desde el primero: la frase se lee, el texto se cambia a la palabra de la pasada, la
//     subcuenta 62800000; dice que se aplicaría a 3 pendientes; se aplica hacia atrás y concilia esos 3 y ninguno más
//     (en la base: con la regla, por la persona, en el diario de la serie 3);
//   · el cuarto lo concilia Sumied solo (bank_casar de Sumied, como la pasada del agente): la franja verde lo cuenta, su
//     fila dice «Sumied · …», y con «Deshacer alguno» se deshace (en la base: deshecho, y el movimiento sin conciliar);
//   · «Reglas (N)» la enseña con sus 3 veces;
//   · la pantalla usa todo el ancho: a 1920 la ventana pasa del ancho de las fichas, el concepto bancario se lee más
//     largo que a 1366, los bancos y el panel miden lo mismo, y la página no rueda.
// Cada ancho, su propio fichero (x30-<ancho>-…); lo de una pasada anterior se deshace antes, y sus reglas se apagan y se
// borran (las de la prueba llevan «Prueba X30» como concepto del asiento).

import { test, expect, type Page } from '@playwright/test'
import { enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x30'
const BANCO = () => enCarril('c0e20000-0000-4000-8000-0000000000b0')
const GASTO = '62800000'
/** El ancho máximo de una ficha (piezas.css, --kp-ventana-max): una lista lo pasa. */
const FICHA_MAX = 1351
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')
const pantalla = (page: Page) => zona(page).locator('[data-prueba="conciliar-nucleo"]')
const hoyMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())

async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('body').innerText().catch(() => '(sin pantalla)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Lo de una pasada anterior de este ancho, fuera: sus casados y su extracto deshechos; sus reglas, apagadas y borradas. */
async function limpiar(s: Sesion, ancho: number) {
  const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=like.x30-${ancho}-*`)
  for (const e of ext.datos ?? []) {
    const movs = await rest<{ id: string; bank_match: { id: string; status: string }[] }[]>(s, 'GET', `bank_movement?select=id,bank_match(id,status)&statement_id=eq.${e.id}`)
    for (const m of movs.datos ?? []) for (const b of m.bank_match.filter((x) => x.status === 'vivo')) {
      const r = await rest(s, 'POST', 'rpc/bank_deshacer', { p_match: b.id, p_motivo: 'Limpieza de la e2e del X30' })
      expect(r.status, `deshacer lo de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
    }
    const r = await rest(s, 'POST', 'rpc/bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de la e2e del X30' })
    expect(r.status, `deshacer el extracto de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  }
  const reglas = await rest<{ id: string; status: string }[]>(s, 'GET', `bank_rule?select=id,status&target->>concepto=eq.Prueba X30 ${ancho}`)
  for (const r of reglas.datos ?? []) {
    if (r.status === 'activa') expect((await rest(s, 'POST', 'rpc/bank_regla_estado', { p_id: r.id, p_estado: 'apagada' })).status).toBeLessThan(300)
    expect((await rest(s, 'POST', 'rpc/bank_regla_borrar', { p_id: r.id })).status, 'borrar la regla de la pasada anterior').toBeLessThan(300)
  }
}

/** Una palabra inventada de esta pasada (ninguna regla, factura ni historial la casa). */
const palabraNueva = (salto: number) => Array.from({ length: 8 }, (_, i) => 'BCDFGHJKLMNPRSTVZ'[Math.floor((Date.now() + salto) / 17 ** i) % 17]).join('')

/** El Norma 43 de prueba: tres pagos con la palabra de la pasada y un cuarto con otra, de hoy. */
async function extracto(s: Sesion, ancho: number) {
  const b = await rest<{ iban: string | null }[]>(s, 'GET', `treasury_account?select=iban&id=eq.${BANCO()}`)
  const iban = (b.datos?.[0]?.iban ?? 'ES0099990000000000000000').replace(/\s/g, '')
  const hoy = hoyMadrid()
  const base = 3000 + (Date.now() % 50000)
  const palabra = palabraNueva(0), otra = palabraNueva(7919)
  const conceptos = ['UNO', 'DOS', 'TRES'].map((n) => `PRUEBA X30 ${palabra} RECIBO DE UN PROVEEDOR INVENTADO CON UN CONCEPTO LARGO ${n}`)
  const solo = `PRUEBA X30 ${otra} LO CONCILIA SUMIED SOLO`
  const texto = escribirNorma43([{
    entidad: iban.slice(4, 8), oficina: iban.slice(8, 12), cuenta: iban.slice(14, 24), nombre: 'GESTORIA DE EJEMPLO', desde: hoy, hasta: hoy, saldoInicialCent: 10_000_000,
    movimientos: [...conceptos, solo].map((c, i) => ({ fecha: hoy, importeCent: -(base + i * 7), comun: '02', concepto: c })),
  }])
  return { nombre: `x30-${ancho}-${Date.now()}.n43`, texto, palabra, otra }
}

async function abrir(page: Page) {
  await page.goto(`/conta/bancos/conciliar?banco=${BANCO()}`, { timeout: 30_000 })
  await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
  await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
}

const medidas: Record<number, Record<string, number | null>> = {}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`X30 · ${ancho} × ${alto}: crear una regla desde un movimiento y aplicarla hacia atrás; deshacer uno conciliado solo; la tabla usa todo el ancho`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarComo(page, NUCLEO.email)
    await limpiar(s, ancho)
    const f = await extracto(s, ancho)

    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
    await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
    await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    await abierta(page, 'Inicio')
    await abrir(page)

    // Traer el extracto.
    await pantalla(page).locator('[data-prueba="fichero-extracto"]').setInputFiles({ name: f.nombre, mimeType: 'text/plain', buffer: Buffer.from(f.texto, 'latin1') })
    const aviso = pantalla(page).locator('[data-prueba="aviso-conciliar"]')
    await expect(aviso, 'el extracto, leído y dicho').toContainText(`Leído «${f.nombre}»: 4 movimientos nuevos`, { timeout: 60_000 })
    const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=eq.${f.nombre}`)
    const movs = await rest<{ id: string; bank_concept: string; status: string }[]>(s, 'GET', `bank_movement?select=id,bank_concept,status&statement_id=eq.${ext.datos[0]?.id}&order=amount.desc`)
    const tres = (movs.datos ?? []).filter((m) => m.bank_concept.includes(f.palabra)).map((m) => m.id)
    const solo = (movs.datos ?? []).find((m) => m.bank_concept.includes(f.otra))?.id ?? ''
    expect(tres, 'los tres de la palabra').toHaveLength(3)
    expect(solo, 'el cuarto').not.toBe('')
    expect((movs.datos ?? []).filter((m) => m.status === 'casado'), 'ninguno conciliado al empezar').toEqual([])
    const fila = (id: string) => pantalla(page).locator(`tr[data-movimiento="${id}"]`)
    for (const id of [...tres, solo]) await expect(fila(id), 'cada movimiento, una fila').toBeVisible({ timeout: 30_000 })

    // La tabla usa todo el ancho; el concepto se lee más largo a 1920.
    const m = await pantalla(page).evaluate((z) => {
      const r = (q: string) => { const e = z.querySelector(q) ?? document.querySelector(q); return e ? Math.round(e.getBoundingClientRect().width) : null }
      const th = [...z.querySelectorAll('.kp-lineas thead th')] as HTMLElement[]
      const col = (t: string) => { const e = th.find((x) => x.textContent?.trim() === t); return e ? Math.round(e.getBoundingClientRect().width) : null }
      return { ventana: r('.kp-ventana'), zona: r('.k-zona[data-activa="si"]'), bancos: r('.cn-bancos'), panel: r('.cn-panel'), concepto: col('Concepto bancario'), asiento: col('Concepto del asiento'), fecha: col('Fecha'),
        sobra: document.documentElement.scrollWidth - window.innerWidth, rueda: document.documentElement.scrollHeight - window.innerHeight }
    })
    console.log(`[X30] ${ancho} · ${JSON.stringify(m)}`)
    medidas[ancho] = m
    expect(m.sobra, 'la página no rueda de lado').toBeLessThanOrEqual(1)
    expect(m.rueda, 'la página no rueda hacia abajo').toBeLessThanOrEqual(1)
    expect((m.zona ?? 0) - (m.ventana ?? 0), 'la ventana ocupa el ancho de su zona').toBeLessThanOrEqual(40)
    // Los dos conceptos se leen, también a 1366: al menos 150 px cada uno (ceden la subcuenta, el nombre, el «Por qué» y el documento).
    expect(m.concepto!, 'el concepto bancario, al menos 150 px').toBeGreaterThanOrEqual(150)
    expect(m.asiento!, 'el concepto del asiento, al menos 150 px').toBeGreaterThanOrEqual(150)
    await page.screenshot({ path: `${DIR}/conciliar-${ancho}.png` })

    // «＋ Crear regla con este», desde el primero de los tres.
    try {
      await fila(tres[0]).click()
      await pantalla(page).locator('[data-boton="crear-regla"]').click()
      const dlg = page.locator('[data-prueba="ventana-regla"]')
      await expect(dlg, 'la ventana de crear regla').toBeVisible({ timeout: 10_000 })
      await dlg.locator('#cn-rg-contiene').fill(f.palabra)
      await dlg.locator('#cn-rg-subcuenta').fill(GASTO)
      await dlg.locator('#cn-rg-subcuenta').press('Enter')
      await dlg.locator('#cn-rg-concepto').fill(`Prueba X30 ${ancho}`)
      await expect(dlg.locator('[data-prueba="frase-regla"]'), 'la frase que se lee').toContainText(`Si el concepto contiene “${f.palabra}”, es un pago y es de`)
      await expect(dlg.locator('[data-prueba="frase-regla"]')).toContainText(`→ ${GASTO}`)
      await expect(dlg.locator('[data-prueba="a-cuantos"]'), 'a cuántos pendientes se aplicaría').toContainText('Se aplicaría a 3 pendientes', { timeout: 30_000 })
      await page.screenshot({ path: `${DIR}/crear-regla-${ancho}.png` })
      await dlg.locator('[data-prueba="hacia-atras"]').check()
      await dlg.locator('[data-boton="guardar-regla"]').click()
      await expect(aviso, 'guardada y aplicada hacia atrás').toContainText('Regla guardada y aplicada hacia atrás: 3 movimientos conciliados', { timeout: 60_000 })
      await expect(dlg).toBeHidden()
    } catch (e) { await contarPantalla(page, 'crear la regla'); throw e }

    // En la base: los tres, con la regla, por la persona, en el diario (serie 3, la 62800000 contra el banco); el cuarto, no.
    const regla = await rest<{ id: string }[]>(s, 'GET', `bank_rule?select=id&target->>concepto=eq.Prueba X30 ${ancho}`)
    expect(regla.datos, 'la regla, guardada').toHaveLength(1)
    for (const id of tres) {
      const r = await rest<{ status: string; bank_match: { status: string; rule_id: string | null; by_who: string; journal_entry: { series: number; status: string; journal_line: { company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
        `bank_movement?select=status,bank_match(status,rule_id,by_who,journal_entry(series,status,journal_line(company_account(code))))&id=eq.${id}`)
      const vivo = r.datos[0]?.bank_match.find((b) => b.status === 'vivo')
      expect({ movimiento: r.datos[0]?.status, regla: vivo?.rule_id, por: vivo?.by_who, serie: vivo?.journal_entry?.series, estado: vivo?.journal_entry?.status,
        cuentas: vivo?.journal_entry?.journal_line.map((l) => l.company_account.code).sort() }, `el movimiento ${id}, conciliado por la regla`)
        .toEqual({ movimiento: 'casado', regla: regla.datos[0].id, por: 'persona', serie: 3, estado: 'validado', cuentas: ['57200001', GASTO] })
    }
    // En «Por qué», lo aplicado con la regla dice «Regla», y al pasar el ratón, cuál.
    await abrir(page)
    for (const id of tres) {
      await expect(fila(id).locator('.cn-porque'), 'lo conciliado con la regla dice «Regla»').toHaveText(/^Regla/, { timeout: 30_000 })
      await expect(fila(id).locator('.cn-porque'), 'y al pasar el ratón, cuál').toHaveAttribute('title', new RegExp(`Regla «${f.palabra}»`))
    }
    await fila(tres[0]).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/conciliar-regla-${ancho}.png` })
    const cuarto = await rest<{ status: string }[]>(s, 'GET', `bank_movement?select=status&id=eq.${solo}`)
    expect(cuarto.datos[0]?.status, 'el cuarto (otro texto), sin conciliar').not.toBe('casado')

    // El cuarto lo concilia Sumied solo, como la pasada del agente; se ve, y se deshace con «Deshacer alguno».
    const imp = await rest<{ amount: number }[]>(s, 'GET', `bank_movement?select=amount&id=eq.${solo}`)
    const r = await rest(s, 'POST', 'rpc/bank_casar', { p_movement: solo, p_destino: { tipo: 'cuenta', concepto: 'Prueba X30 solo', lineas: [{ cuenta: GASTO, importe: Math.abs(Number(imp.datos[0]?.amount)) }] },
      p_confianza: 'seguro', p_porque: 'Regla confirmada 3 veces (prueba X30).', p_razones: [], p_por: 'folvy', p_regla: null })
    expect(r.status, `Sumied concilia solo el cuarto: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
    await abrir(page)
    try {
      await expect(pantalla(page).locator('[data-prueba="hecho-hoy"]'), 'la franja verde de hoy').toContainText('Hoy Sumied ha conciliado solo', { timeout: 30_000 })
      await expect(fila(solo).locator('.cn-porque'), 'quién lo hizo y cuándo').toContainText('Sumied · ')
      await pantalla(page).locator('[data-prueba="hecho-hoy"]').getByRole('button', { name: 'Deshacer alguno' }).click()
      await expect(fila(solo), 'con «Deshacer alguno», lo de hoy a la vista').toBeVisible()
      await fila(solo).click()
      await pantalla(page).locator('[data-boton="deshacer"]').click()
      await expect(aviso, 'deshecho y dicho').toContainText(/[Dd]eshecho|sin contabilizar|quitado/, { timeout: 30_000 })
    } catch (e) { await contarPantalla(page, 'deshacer uno conciliado solo'); throw e }
    const tras = await rest<{ status: string; bank_match: { status: string; by_who: string }[] }[]>(s, 'GET', `bank_movement?select=status,bank_match(status,by_who)&id=eq.${solo}`)
    expect({ movimiento: tras.datos[0]?.status === 'casado' ? 'casado' : 'sin conciliar', vivos: tras.datos[0]?.bank_match.filter((b) => b.status === 'vivo').length,
      deshechos: tras.datos[0]?.bank_match.filter((b) => b.status === 'deshecho' && b.by_who === 'folvy').length }, 'en la base: deshecho')
      .toEqual({ movimiento: 'sin conciliar', vivos: 0, deshechos: 1 })

    // «Reglas (N)»: la nueva, con sus 3 veces.
    await pantalla(page).locator('[data-boton="reglas"]').click()
    const lista = page.locator('[data-prueba="lista-reglas"]')
    await expect(lista, 'el listado de reglas').toBeVisible({ timeout: 15_000 })
    const suya = lista.locator(`tr[data-regla="${regla.datos[0].id}"]`)
    await expect(suya, 'la regla nueva, en el listado').toContainText(f.palabra, { timeout: 15_000 })
    await expect(suya.locator('td').nth(1), 'sus 3 veces').toHaveText('3')
    await page.screenshot({ path: `${DIR}/reglas-${ancho}.png` })
    await page.keyboard.press('Escape')
    await expect(lista).toBeHidden()

    // A 1920, la ventana pasa del ancho de una ficha y el concepto se lee más largo; los bancos y el panel, igual.
    if (ancho === 1920 && medidas[1366]) {
      expect(medidas[1920].ventana!, 'a 1920, la lista pasa del ancho de las fichas').toBeGreaterThan(FICHA_MAX)
      expect(medidas[1920].concepto!, 'a 1920, el concepto bancario se lee más largo').toBeGreaterThan((medidas[1366].concepto ?? 0) + 100)
      for (const k of ['bancos', 'panel', 'fecha']) expect(Math.abs((medidas[1920][k] ?? 0) - (medidas[1366][k] ?? 0)), `${k} mide lo mismo a 1366 y a 1920`).toBeLessThanOrEqual(1)
    }
    expect(errores).toEqual([])
  })
}
