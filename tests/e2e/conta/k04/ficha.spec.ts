/// <reference lib="dom" />
// tests/e2e/conta/k04/ficha.spec.ts
//
// K04 · La ficha de la factura recibida en el núcleo, contra staging, con la
// cuenta del núcleo (semilla K02) en su gestoría y las facturas de la semilla
// K04b (a nombre de la gestoría), a 1456 × 816 y a 1366 × 768, con el navegador en español:
//   1. una rellenada con una duda: se elige una salida, Intro, queda validada y
//      pasa a la siguiente; SOLO con el teclado. Antes se validan sus dos
//      facturas anteriores (a la 60000000 y a la 60200000), que son las que dan
//      la duda (conta_gasto_aprendido);
//   2. una a mano, sin documento: se escribe entera con el teclado, el asiento
//      se forma y cuadra, y se guarda;
//   3. una que no se puede validar (su proveedor no tiene cuenta): guarda, dice
//      por qué y no pasa;
//   4. F5 desde la casilla de la cuenta abre su mayor en otra pestaña y, al
//      volver, la ficha está como se dejó;
//   5. con el interruptor apagado (la cuenta A), la pantalla de hoy.
// Y «guarda lo mismo» (regla 31): la primera factura de 1456 se valida con la
// ficha nueva y la de 1366 con la de hoy («Más › La ficha completa»); al final
// se comparan sus asientos y sus filas por la API, con la misma vara.
// Las capturas, con la pantalla cargada; y las dos que faltaban del K03.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO, zonaActiva } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k04'
const DIR_K03 = 'docs/conta/capturas/k03'
// Las de seed_k04b (a nombre de la gestoría: su IVA se deduce). Las de seed_k04 (…0b) se leyeron sin el NIF del
// destinatario y la base las marca «no viene a nombre de la empresa»: su IVA va al gasto y no sirven para la duda.
const factura = (t: number, n: number) => enCarril(`c0e40000-0000-4000-8000-000000000c${t}${n}`)
const PROVEEDOR = (t: number) => (t === 1 ? 'Proveedor de Prueba Ficha Uno, S.L.' : 'Proveedor de Prueba Ficha Dos, S.L.')
const ficha = (page: Page) => page.locator('[data-prueba="ficha-recibida-nucleo"]')
const aviso = (page: Page) => page.locator('[data-prueba="aviso-ficha"]')
const asientos: Record<number, unknown> = {}

async function rest<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

/** Las facturas de la semilla no traen PDF: se marcan «Sin documento» con su motivo, la misma función que la ficha (sin eso, ninguna de las dos pantallas las valida). */
async function sinDocumento(s: Sesion, id: string) {
  await rest(s, 'rpc/conta_recibida_sin_papel', { p_invoice: id, p_sin: true, p_motivo: 'Prueba e2e K04: la semilla no trae PDF', p_quien_nombre: 'Prueba e2e K04' })
}

/** El asiento de una factura, con la vara de la regla 31: la serie, el estado y cada línea (la subcuenta del proveedor, como «proveedor»). */
async function asientoDe(s: Sesion, id: string): Promise<{ serie: number; estado: string; lineas: [string, number, number][]; factura: string }> {
  const e = await rest<{ series: number; status: string; journal_line: { debit: number; credit: number; company_account: { code: string } }[] }[]>(s,
    `journal_entry?select=series,status,journal_line(debit,credit,company_account(code))&account_id=eq.${NUCLEO.id}&source_type=eq.supplier_invoice&source_id=eq.${id}&status=neq.anulado`)
  expect(e, `el asiento de ${id}`).toHaveLength(1)
  const f = await rest<{ status: string }[]>(s, `supplier_invoice?select=status&account_id=eq.${NUCLEO.id}&id=eq.${id}`)
  const lineas = e[0].journal_line.map((l): [string, number, number] => [/^4000/.test(l.company_account.code) ? 'proveedor' : l.company_account.code, Number(l.debit), Number(l.credit)])
    .sort((a, b) => a[0].localeCompare(b[0]))
  return { serie: e[0].series, estado: e[0].status, lineas, factura: f[0]?.status }
}

async function abrirFicha(page: Page, id: string) {
  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`, { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="cuadra"]')).toContainText(/Cuadra|Falta/, { timeout: 30_000 })
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`la ficha de la recibida a ${ancho} × ${alto}: la duda con el teclado, a mano, la que no se valida y F5`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(420_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const grande = ancho === 1456
    // Las tres primeras se validan: sin PDF en la semilla, se marcan «Sin documento». La cuarta NO: es la que no se
    // puede validar en ninguna de las dos pantallas (falta su PDF, paraValidar.faltaDocumento). La de antes era la del
    // proveedor sin subcuenta, pero desde la D07b la base le crea la suya al validar: sí se podía (e2e 1503).
    for (const n of [1, 2, 3]) await sinDocumento(s, factura(t, n))
    // El envío a Diez de la gestoría, escrito en el registro (para saberlo, no suponerlo).
    const diez = await rest(s, `conta_diez_envio_empresa?select=enviar,modo,desde&account_id=eq.${NUCLEO.id}&company_id=eq.${enCarril('c0e20000-0000-4000-8000-0000000000e3')}`).catch((e) => String(e))
    console.log(`[K04 ${ancho}] el envío a Diez de la gestoría: ${JSON.stringify(diez)}`)
    // A 1366 × 768, la cinta plegada (así cabe la ficha sin rodar).
    if (!grande) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1a · Su primera factura: a 1456, con la ficha nueva (Intro); a 1366, con la de hoy (regla 31). ──
    await abrirFicha(page, factura(t, 1))
    await expect(page.getByRole('tab', { name: new RegExp(`^Factura recibida · ${PROVEEDOR(t).replace(/\./g, '\\.')}`) })).toBeVisible()
    // K11b · De dónde sale el proveedor, sin frase: al pasar el ratón por su casilla.
    await expect(ficha(page).locator('.kr-c', { has: page.locator('#kf-proveedor') })).toHaveAttribute('title', /por NIF/)
    if (grande) {
      await page.locator('body').press('Enter')
    } else {
      await ficha(page).getByRole('button', { name: 'Más' }).click()
      await page.getByRole('button', { name: /^La ficha completa/ }).click()
      const validar = zonaActiva(page).locator('[data-validar-y-siguiente]')
      await expect(validar).toBeEnabled({ timeout: 30_000 })
      await validar.click()
    }
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    asientos[t] = await asientoDe(s, factura(t, 1))

    // ── 1b · La segunda, a la 60200000 (así sus anteriores van a dos cuentas). ──
    await abrirFicha(page, factura(t, 2))
    const cuenta = ficha(page).locator('#kf-cuenta-0')
    await cuenta.fill('602')
    await page.getByRole('option', { name: /^60200000/ }).click()
    await expect(cuenta).toHaveValue('60200000')
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText('Apuntada y validada', { timeout: 60_000 })

    // Lo que da la duda, escrito en el registro (Q03): los asientos de las dos anteriores y lo que dice la base.
    const anteriores = [await asientoDe(s, factura(t, 1)).catch((e) => String(e)), await asientoDe(s, factura(t, 2)).catch((e) => String(e))]
    const aprendido = await rest(s, 'rpc/conta_gasto_aprendido', { p_company: enCarril('c0e20000-0000-4000-8000-0000000000e3'), p_supplier: enCarril(`c0e40000-0000-4000-8000-0000000000a${t}`) }).catch((e) => String(e))
    console.log(`[K04 ${ancho}] las dos anteriores: ${JSON.stringify(anteriores)} · lo aprendido: ${JSON.stringify(aprendido)}`)

    // ── 1c · La tercera: la duda, y SOLO con el teclado. ──
    await abrirFicha(page, factura(t, 3))
    const duda = ficha(page).locator('.kf-duda')
    await expect(duda).toContainText('Mira esto.', { timeout: 30_000 }).catch(async (e) => {
      console.log(`[K04 ${ancho}] en pantalla, sin la duda: ${(await ficha(page).innerText()).replace(/\s+/g, ' ').slice(0, 1500)}`)
      throw e
    })
    await expect(ficha(page).locator('.kf-estado')).toContainText('con 1 duda')
    await expect(ficha(page).getByRole('button', { name: 'Dejar 60000000' })).toBeFocused()
    await cargada(page, 'la rellenada con su duda')
    await page.screenshot({ path: `${DIR}/rellenada-duda-${ancho}.png` })
    await page.keyboard.press('Tab')
    await expect(ficha(page).getByRole('button', { name: 'Cambiar a 60200000' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(cuenta).toHaveValue('60200000')
    await expect(duda).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    await expect(page).not.toHaveURL(new RegExp(factura(t, 3)), { timeout: 30_000 })

    // ── 3 · La que no se puede validar: guarda, dice por qué y no pasa. ──
    await abrirFicha(page, factura(t, 4))
    await page.locator('body').press('Enter')
    await expect(aviso(page)).toContainText('No paso a la siguiente', { timeout: 60_000 })
    await expect(aviso(page)).toContainText('Falta su PDF')
    await expect(page).toHaveURL(new RegExp(factura(t, 4)))
    if (grande) await page.screenshot({ path: `${DIR}/no-se-valida-${ancho}.png` })

    // ── 4 · F5 desde la casilla de la cuenta, y la ficha como se dejó. ──
    const numero = ficha(page).locator('#kf-numero')
    const antes = await numero.inputValue()
    await numero.fill(`${antes}-B`)
    await cuenta.focus()
    await page.keyboard.press('F5')
    await expect(page).toHaveURL(/\/conta\/plan\/60000000/)
    await expect(page.getByRole('tab', { name: 'Mayor · 60000000', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /^Factura recibida/ }).click()
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(`${antes}-B`)
    await ficha(page).locator('#kf-numero').fill(antes)

    // ── 2 · A mano, sin documento, entera con el teclado. ──
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page).locator('.kf-estado')).toContainText('La escribes tú.')
    // K11b · La nueva entra por la primera casilla de la pantalla, como ERP10: la fecha de la factura, arriba. Intro sigue
    // el orden de la pantalla: de la fecha al proveedor, al número y a las bases.
    await expect(page.locator('#kf-fecha')).toBeFocused({ timeout: 30_000 })
    if (grande) { await cargada(page, 'a mano, vacía'); await page.screenshot({ path: `${DIR}/a-mano-vacia-${ancho}.png` }) }
    await page.keyboard.type('15/10/2026'); await page.keyboard.press('Enter')
    await expect(page.locator('#kf-proveedor')).toBeFocused()
    await page.keyboard.type(t === 1 ? 'Ficha Uno' : 'Ficha Dos')
    await page.keyboard.press('Enter')
    await expect(page.locator('#kf-nombre')).toHaveValue(PROVEEDOR(t))
    await expect(page.getByRole('tab', { name: new RegExp(`^Factura recibida · ${PROVEEDOR(t).replace(/\./g, '\\.')}`) })).toBeVisible()
    await page.keyboard.press('Enter')
    await page.keyboard.type(`K04-M-${t}`); await page.keyboard.press('Enter')
    await page.keyboard.type('100'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
    await page.keyboard.type('50'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
    await page.keyboard.press('Enter') // el total: sale de las bases
    await page.keyboard.press('Enter') // sin retención
    await page.keyboard.type('600'); await page.keyboard.press('Enter')
    await expect(page.locator('#kf-cuenta-0')).toHaveValue('60000000')
    await expect(page.locator('[data-prueba="cuadra"]')).toHaveText('Cuadra · 176,00')
    if (grande) await page.screenshot({ path: `${DIR}/a-mano-escribiendo-${ancho}.png` })
    // El local, con su lupa (K11b · 4): se escribe «Común» y el Intro siguiente lo elige y pasa.
    const local = page.getByRole('textbox', { name: 'Local', exact: true })
    if (await local.isEditable()) {
      await page.keyboard.press('Enter')
      await expect(local).toBeFocused()
      await page.keyboard.type('Común')
    }
    for (let i = 0; i < 6 && !(await aviso(page).isVisible()); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(300) }
    await expect(page.getByText(new RegExp(`Guardada la K04-M-${t}`)).first()).toBeVisible({ timeout: 60_000 })

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('guarda lo mismo: la factura validada con la ficha nueva y con la de hoy dejan el mismo asiento (regla 31)', async ({ page }, info) => {
  void page
  test.skip(info.project.name === 'movil', 'Va con las de ordenador')
  test.skip(!asientos[1] || !asientos[2], 'Falta una de las dos validaciones (la prueba de su tamaño no llegó)')
  const nueva = asientos[1] as Awaited<ReturnType<typeof asientoDe>>
  const hoy = asientos[2] as Awaited<ReturnType<typeof asientoDe>>
  console.log(`[regla 31] con la ficha nueva (1456): ${JSON.stringify(nueva)}`)
  console.log(`[regla 31] con la ficha de hoy (1366): ${JSON.stringify(hoy)}`)
  // Las dos facturas son iguales salvo la base al 4 % (+10 €, para que no sean repetidas):
  // mismas cuentas, misma serie, mismo estado; los importes, cada uno el de su factura.
  expect(nueva.lineas.map((l) => l[0])).toEqual(hoy.lineas.map((l) => l[0]))
  expect([nueva.serie, nueva.estado, nueva.factura]).toEqual([hoy.serie, hoy.estado, hoy.factura])
  const sinLaBase4 = (x: typeof nueva) => x.lineas.filter((l) => l[0] === '47200010').map((l) => [l[1], l[2]])
  expect(sinLaBase4(nueva)).toEqual(sinLaBase4(hoy))
})

test('las dos que faltaban del K03: «N más ▾» abierto y el rótulo de un módulo plegado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  await entrarEnLaGestoria(page)
  const ver = page.getByRole('button', { name: 'Ver los botones' })
  if (await ver.isVisible()) await ver.click()
  for (const [cinta, id] of [['Asientos', 'recibidas'], ['Tesorería', 'bancos'], ['Asientos', 'emitidas'], ['Asientos', 'asientos'], ['Listados', 'sumas'],
    ['Listados', 'mayor'], ['Listados', 'balance'], ['Listados', 'pyg'], ['Listados', 'iva'], ['Definiciones', 'plan'], ['Definiciones', 'tablas']] as const) {
    await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: cinta }).click()
    await page.locator(`[data-boton="${id}"]`).click()
    await expect(zonaActiva(page)).toBeVisible({ timeout: 30_000 })
  }
  const mas = page.locator('.k-trabajo-mas-pestanas')
  await expect(mas).toBeVisible()
  await mas.click()
  await expect(page.getByText('No caben en la fila')).toBeVisible()
  await cargada(page, 'N más')
  await page.screenshot({ path: `${DIR_K03}/n-mas-abierto-1456.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Plegar los módulos' }).click()
  const modulo = page.locator('.k-modulo').nth(1)
  await modulo.hover()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR_K03}/modulo-plegado-rotulo-1456.png` })
  await page.getByRole('button', { name: 'Desplegar los módulos' }).click()
})

test('con el interruptor apagado, la pantalla de hoy (la cuenta A)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
  await expect(page.locator('.s-barra')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
  await expect(page.locator('[data-prueba="ficha-recibida-nucleo"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar y revisarla' })).toBeVisible({ timeout: 30_000 })
})
