/// <reference lib="dom" />
// tests/e2e/conta/k12/asiento.spec.ts
//
// K12 · Las piezas comunes de ERP10 y el asiento general (maqueta nucleo_19), CONTRA STAGING DE VERDAD, con la cuenta
// del núcleo (semilla K02, `conta_nucleo` encendido). Cada prueba crea su empresa (pymes, 8 cifras, el ejercicio 2026 y
// el plan activado con company_chart_activate): no depende del orden ni de lo que dejó otra. A 1456 × 816 (las
// capturas) y a 1366 × 768:
//   1. Un asiento de pago con dos apuntes, SOLO CON EL TECLADO: fecha, concepto, la subcuenta del acreedor con su
//      atajo y el debe; la del banco, y el haber que propone Sumied; Intro en la línea vacía lo graba y lo valida. Y
//      validado, se cambia (el concepto) con el mismo número.
//   2. Uno con descuadre no se graba: la casilla del descuadre en ámbar, y en la base nada.
//   3. Uno con local y plataforma: llegan a la línea del asiento.
//   4. El separador movido (y plegado con «‹») se mantiene al volver a entrar: está en la base, no en el navegador.
//   5. A 1366 × 768 la pantalla cabe entera, y cada pieza cabe (también con siete apuntes: la lista se desplaza).
//   6. Regla 31: el mismo asiento con la pantalla nueva y con la de hoy (el interruptor apagado en esa página) deja
//      las mismas filas.
// Nombres e importes inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, noRueda, zonaActiva } from '../k02/comun'

test.skip(CARRIL === null, 'Escribe y valida asientos en una empresa de la cuenta del núcleo: necesita su carril.')
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k12'
const NUEVO = '/conta/libros/diario/nuevo'

interface Empresa { id: string; acreedor: string; banco: string; gasto: string }

/** Una empresa de la cuenta del núcleo para esta prueba, con su plan activado; y tres subcuentas de él. */
async function crearEmpresa(s: Sesion, que: string): Promise<Empresa> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Asiento K12 e2e ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e K12' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  const c = await rest<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${id}&order=code`)
  const codigos = (c.datos ?? []).map((x) => x.code)
  const deApunte = (pre: string) => codigos.find((k) => k.startsWith(pre) && !codigos.some((o) => o !== k && o.startsWith(k)))
  const acreedor = ['410', '400', '523'].map(deApunte).find(Boolean)
  const [banco, gasto] = ['572', '621'].map(deApunte)
  expect([acreedor, banco, gasto], `el plan activado tiene una 410 (o 400), una 572 y una 621 de apunte: ${codigos.join(' ')}`).not.toContain(undefined)
  return { id, acreedor: acreedor!, banco: banco!, gasto: gasto! }
}

/** El atajo de ERP10 de una subcuenta: «410.0» para la 41000000, «572.1» para la 57200001. */
const atajo = (codigo: string) => `${codigo.slice(0, 3)}.${codigo.slice(3).replace(/^0+/, '') || '0'}`

/** Lo que guarda un asiento, sin lo que cambia de uno a otro (ids, número, quién y cuándo). */
async function filas(s: Sesion, entryId: string) {
  const r = await rest<Record<string, unknown>[]>(s, 'GET',
    `journal_entry?select=series,entry_date,concept,source_type,status,journal_line(position,debit,credit,concept,location_id,is_common,brand_id,company_account(code))&id=eq.${entryId}`)
  const e = r.datos[0]
  const lineas = ((e.journal_line ?? []) as Record<string, unknown>[]).sort((a, b) => Number(a.position) - Number(b.position))
    .map((l) => ({ ...l, cuenta: (l.company_account as { code: string }).code, company_account: undefined }))
  return { ...e, journal_line: lineas }
}

const elegirEmpresa = (page: Page, cuenta: string, empresa: string) =>
  page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${cuenta}`, empresa] as const)

const ventana = (page: Page) => zonaActiva(page).locator('.kp-ventana')

async function abrirNuevo(page: Page) {
  await page.goto('/conta', { waitUntil: 'load' })
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Asientos' }).click()
  await page.locator('[data-boton="asientos"]').click()
  await expect(zonaActiva(page).getByRole('heading', { name: 'Asiento general', exact: true })).toBeVisible({ timeout: 40_000 })
  await expect(ventana(page).locator('#ag-ed-subcuenta')).toBeVisible({ timeout: 40_000 })
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Cada pieza (data-pieza) dentro de la ventana y sin cortar lo que lleva dentro. */
async function cadaPiezaCabe(page: Page, donde: string) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const mal: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.k-zona[data-activa="si"] [data-pieza]')) {
      if (el.closest('[hidden]')) continue
      const b = el.getBoundingClientRect()
      if (b.width === 0 && b.height === 0) continue
      if (b.right > vw + 1 || b.bottom > vh + 1 || b.left < -1) mal.push(`${el.dataset.pieza} fuera (${Math.round(b.left)},${Math.round(b.top)} – ${Math.round(b.right)},${Math.round(b.bottom)})`)
      if (!['lineas', 'documento', 'separador'].includes(el.dataset.pieza ?? '') && el.scrollWidth > el.clientWidth + 1) mal.push(`${el.dataset.pieza} se corta a lo ancho (${el.scrollWidth} > ${el.clientWidth})`)
    }
    // Cada rótulo y cada cabecera de la rejilla, entero; y lo que pone el programa (las casillas grises), entero. Lo que
    // escribe la persona se desplaza dentro de su casilla, como en ERP10.
    for (const el of document.querySelectorAll<HTMLElement>('.k-zona[data-activa="si"] .kp-rotulo, .k-zona[data-activa="si"] .kp-lineas th')) {
      if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) mal.push(`el rótulo «${el.textContent}» se corta`)
    }
    for (const i of document.querySelectorAll<HTMLInputElement>('.k-zona[data-activa="si"] .kp-casilla[data-gris="si"] input')) {
      if (i.value && i.offsetParent && i.scrollWidth > i.clientWidth + 1) mal.push(`la casilla gris «${i.getAttribute('aria-label') ?? i.id}» corta «${i.value}»`)
    }
    return { mal, n: document.querySelectorAll('.k-zona[data-activa="si"] [data-pieza]').length }
  })
  console.log(`[K12] ${donde}: ${r.n} piezas medidas`)
  expect(r.mal, `${donde}: cada pieza cabe`).toEqual([])
}

const escribe = async (page: Page, t: string) => { await page.keyboard.type(t); await page.keyboard.press('Enter') }
const intro = async (page: Page, n = 1) => { for (let k = 0; k < n; k++) await page.keyboard.press('Enter') }

/**
 * El asiento de pago, solo con el teclado: fecha, concepto; el acreedor con su atajo, Intro por concepto, local,
 * marca y plataforma, y el debe; el banco con su atajo, Intro hasta el haber que propone Sumied, e Intro.
 */
async function pagoConElTeclado(page: Page, e: Empresa, haber = '') {
  await expect(ventana(page).locator('#ag-fecha')).toBeFocused({ timeout: 10_000 })
  await page.keyboard.press('Control+A'); await escribe(page, '12/11/2026')
  await expect(ventana(page).locator('#ag-concepto')).toBeFocused()
  await escribe(page, 'Pago de la factura de prueba K12')
  await expect(ventana(page).locator('#ag-ed-subcuenta')).toBeFocused()
  await escribe(page, atajo(e.acreedor))
  await expect(ventana(page).locator('#ag-ed-concepto')).toHaveValue('Pago de la factura de prueba K12')
  await intro(page, 4) // concepto, local, marca, plataforma
  await expect(ventana(page).locator('#ag-ed-debe')).toBeFocused()
  await escribe(page, '63,60')
  await expect(ventana(page).getByRole('table', { name: 'Apuntes' }).locator('tbody tr')).toHaveCount(1)
  await expect(ventana(page).locator('#ag-ed-subcuenta')).toBeFocused()
  // La nueva trae en ámbar lo que falta para cuadrar.
  await expect(ventana(page).locator('#ag-ed-haber')).toHaveValue('63,60')
  await expect(ventana(page).locator('.kp-casilla[data-ambar="si"] #ag-ed-haber')).toHaveCount(1)
  await escribe(page, atajo(e.banco))
  await intro(page, 5) // concepto, local, marca, plataforma, debe (vacío)
  await expect(ventana(page).locator('#ag-ed-haber')).toBeFocused()
  if (haber) { await page.keyboard.press('Control+A'); await page.keyboard.type(haber) }
  await intro(page)
  await expect(ventana(page).getByRole('table', { name: 'Apuntes' }).locator('tbody tr')).toHaveCount(2)
  await expect(ventana(page).locator('#ag-ed-subcuenta')).toBeFocused()
}

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'El núcleo es de ordenador (reglas comunes).')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1456, height: 816 })
})

test('K12 · 1 · un asiento de pago con dos apuntes, solo con el teclado; y validado, se cambia con el mismo número', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '1')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirNuevo(page)
  await page.screenshot({ path: `${DIR}/asiento-nuevo-1456.png` })
  await pagoConElTeclado(page, e)
  await expect(ventana(page).locator('#ag-descuadre')).toHaveValue('0,00')
  await expect(ventana(page).locator('#ag-total-debe')).toHaveValue('63,60')
  await page.screenshot({ path: `${DIR}/asiento-escrito-1456.png` })
  await page.setViewportSize({ width: 1366, height: 768 })
  const plegar = page.getByRole('button', { name: /Plegar los botones/ })
  if (await plegar.isVisible()) await plegar.click()
  await page.waitForTimeout(300)
  await noRueda(page, 'el asiento escrito a 1366 × 768')
  await cadaPiezaCabe(page, 'el asiento escrito a 1366 × 768')
  await page.screenshot({ path: `${DIR}/asiento-escrito-1366.png` })
  await ventana(page).locator('#ag-ed-subcuenta').focus()
  // Intro en la línea vacía: graba y valida.
  await intro(page)
  const hecho = ventana(page).getByRole('status').filter({ hasText: /^Guardado y validado: 4 \/ \d{4} · Pago de la factura de prueba K12 · 63,60 al debe y al haber\./ })
  await expect(hecho).toBeVisible({ timeout: 60_000 })
  const id = (await hecho.getByRole('link', { name: 'Verlo' }).getAttribute('href'))!.split('/').pop()!
  const f = (await filas(s, id)) as unknown as { status: string; entry_date: string; journal_line: { cuenta: string; debit: number; credit: number }[] }
  expect(f.status).toBe('validado')
  expect(f.entry_date).toBe('2026-11-12')
  expect(f.journal_line.map((l) => [l.cuenta, Number(l.debit), Number(l.credit)])).toEqual([[e.acreedor, 63.6, 0], [e.banco, 0, 63.6]])
  const [{ number: numero }] = (await rest<{ number: number }[]>(s, 'GET', `journal_entry?select=number&id=eq.${id}`)).datos

  // Validado y a mano: se cambia (el concepto) y sigue siendo el mismo número.
  await page.setViewportSize({ width: 1456, height: 816 })
  await page.goto(`/conta/libros/diario/${id}`, { waitUntil: 'load' })
  await expect(ventana(page).locator('#ag-documento')).toHaveValue(String(numero), { timeout: 40_000 })
  await expect(ventana(page).locator('#ag-ed-subcuenta')).toBeVisible({ timeout: 30_000 })
  await ventana(page).locator('#ag-concepto').fill('Pago de la factura de prueba K12, cambiado')
  await ventana(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(ventana(page).getByRole('status').filter({ hasText: `Cambiado: el asiento ${numero} sigue siendo el ${numero}` })).toBeVisible({ timeout: 60_000 })
  const [x] = (await rest<{ number: number; concept: string; status: string }[]>(s, 'GET', `journal_entry?select=number,concept,status&id=eq.${id}`)).datos
  expect(x).toEqual({ number: numero, concept: 'Pago de la factura de prueba K12, cambiado', status: 'validado' })
  await page.screenshot({ path: `${DIR}/asiento-cambiado-1456.png` })
  expect(errores).toEqual([])
})

test('K12 · 2 · con descuadre no se graba: el descuadre en ámbar y nada en la base', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '2')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirNuevo(page)
  await pagoConElTeclado(page, e, '63,50')
  await expect(ventana(page).locator('#ag-descuadre')).toHaveValue('0,10')
  await expect(ventana(page).locator('#ag-descuadre')).toHaveAttribute('data-ambar', 'si')
  // Intro en la línea vacía y el botón de guardar: no graba (la nueva trae en ámbar lo que falta; se deja vacía).
  await ventana(page).locator('#ag-ed-haber').fill('')
  await ventana(page).locator('#ag-ed-subcuenta').focus()
  await intro(page)
  await ventana(page).getByRole('button', { name: 'Guardar' }).click()
  await page.waitForTimeout(1500)
  await expect(ventana(page).getByRole('status').filter({ hasText: /^Guardado/ })).toHaveCount(0)
  const r = await rest<{ id: string }[]>(s, 'GET', `journal_entry?select=id&company_id=eq.${e.id}`)
  expect(r.datos, 'con descuadre no se ha grabado nada').toEqual([])
  await page.screenshot({ path: `${DIR}/asiento-descuadre-1456.png` })
  expect(errores).toEqual([])
})

test('K12 · 3 · con local y plataforma: llegan a la línea del asiento', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '3')
  const nombreLocal = `Local K12 e2e ${Date.now()}`
  const l = await rest<{ id: string }[]>(s, 'POST', 'locations', { account_id: NUCLEO.id, name: nombreLocal })
  expect(l.status, `el local de la prueba: ${JSON.stringify(l.datos).slice(0, 200)}`).toBe(201)
  const local = l.datos[0].id
  const canales = await rest<{ id: string; name: string }[]>(s, 'GET', `sales_channel?select=id,name&account_id=eq.${NUCLEO.id}&order=name&limit=1`)
  expect(canales.datos.length, 'la cuenta del núcleo tiene una plataforma (semilla K06)').toBeGreaterThan(0)
  const plataforma = canales.datos[0]
  try {
    await elegirEmpresa(page, NUCLEO.id, e.id)
    await abrirNuevo(page)
    const v = ventana(page)
    await v.locator('#ag-concepto').fill('Gasto con local y plataforma K12')
    await v.locator('#ag-ed-subcuenta').fill(atajo(e.gasto)); await v.locator('#ag-ed-subcuenta').press('Enter')
    await v.locator('#ag-ed-local').fill(nombreLocal); await v.locator('#ag-ed-local').press('Enter')
    await v.locator('#ag-ed-plataforma').fill(plataforma.name); await v.locator('#ag-ed-plataforma').press('Enter')
    await v.locator('#ag-ed-debe').fill('50'); await v.locator('#ag-ed-debe').press('Enter')
    await v.locator('#ag-ed-subcuenta').fill(atajo(e.banco)); await v.locator('#ag-ed-subcuenta').press('Enter')
    await v.locator('#ag-ed-haber').press('Enter')
    const lista = v.getByRole('table', { name: 'Apuntes' })
    await expect(lista.locator('tbody tr')).toHaveCount(2)
    await expect(lista.locator('tbody tr').first()).toContainText(nombreLocal)
    await expect(lista.locator('tbody tr').first()).toContainText(plataforma.name)
    await page.screenshot({ path: `${DIR}/asiento-local-plataforma-1456.png` })
    await v.getByRole('button', { name: 'Guardar' }).click()
    const hecho = v.getByRole('status').filter({ hasText: /^Guardado y validado/ })
    await expect(hecho).toBeVisible({ timeout: 60_000 })
    const id = (await hecho.getByRole('link', { name: 'Verlo' }).getAttribute('href'))!.split('/').pop()!
    const lineas = await rest<{ position: number; location_id: string | null; channel_id: string | null; is_common: boolean }[]>(s, 'GET',
      `journal_line?select=position,location_id,channel_id,is_common&entry_id=eq.${id}&order=position`)
    expect(lineas.datos.map((x) => [x.location_id, x.channel_id])).toEqual([[local, plataforma.id], [local, plataforma.id]])
  } finally {
    await rest(s, 'PATCH', `locations?id=eq.${local}`, { active: false }, 'return=minimal')
  }
  expect(errores).toEqual([])
})

test('K12 · 4 · el separador movido y plegado se mantiene al volver a entrar (en la base)', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '4')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  try {
    await abrirNuevo(page)
    const sep = ventana(page).getByRole('separator', { name: 'El separador entre la pantalla y el documento' })
    const antes = Number(await sep.getAttribute('aria-valuenow'))
    const b = (await sep.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + 40)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 140, b.y + 40, { steps: 8 })
    await page.mouse.up()
    const movido = Number(await sep.getAttribute('aria-valuenow'))
    expect(movido, `el documento mengua al llevar el separador a la derecha (${antes} → ${movido})`).toBeLessThan(antes)
    await expect.poll(async () => (await rest<{ reparto_documento: number | null }[]>(s, 'GET',
      `conta_user_pref?select=reparto_documento&account_id=eq.${NUCLEO.id}&user_id=eq.${s.user.id}`)).datos[0]?.reparto_documento ?? null,
    { message: 'el ancho se guarda en la base', timeout: 15_000 }).not.toBeNull()
    // En otra página nueva (sin nada del navegador de antes): lo mismo.
    await page.evaluate(() => { for (const k of Object.keys(window.localStorage)) if (k.includes('reparto')) window.localStorage.removeItem(k) })
    await abrirNuevo(page)
    await expect.poll(async () => Number(await ventana(page).getByRole('separator', { name: 'El separador entre la pantalla y el documento' }).getAttribute('aria-valuenow')),
      { message: 'al volver a entrar, el mismo ancho', timeout: 15_000 }).toBe(movido)
    // Plegado con «‹»: al volver a entrar, plegado.
    await ventana(page).getByRole('button', { name: 'Plegar la pantalla' }).click()
    await expect(ventana(page).locator('.kp-con-documento')).toHaveAttribute('data-plegada', 'si')
    await page.waitForTimeout(800)
    await abrirNuevo(page).catch(() => undefined)
    await expect(ventana(page).locator('.kp-con-documento')).toHaveAttribute('data-plegada', 'si', { timeout: 15_000 })
    await page.screenshot({ path: `${DIR}/asiento-plegado-1456.png` })
    await ventana(page).getByRole('button', { name: 'Desplegar la pantalla' }).click()
    await expect(ventana(page).locator('.kp-con-documento')).not.toHaveAttribute('data-plegada', 'si')
  } finally {
    await rest(s, 'PATCH', `conta_user_pref?account_id=eq.${NUCLEO.id}&user_id=eq.${s.user.id}`, { reparto_documento: null }, 'return=minimal')
  }
  expect(errores).toEqual([])
})

test('K12 · 5 · a 1366 × 768 cabe entera, cada pieza cabe, y con siete apuntes la lista se desplaza dentro', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '5')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await page.setViewportSize({ width: 1366, height: 768 })
  await abrirNuevo(page)
  const plegar = page.getByRole('button', { name: /Plegar los botones/ })
  if (await plegar.isVisible()) await plegar.click()
  await page.waitForTimeout(300)
  await noRueda(page, 'el asiento nuevo a 1366 × 768')
  await cadaPiezaCabe(page, 'el asiento nuevo a 1366 × 768')
  const v = ventana(page)
  await v.locator('#ag-concepto').fill('Siete apuntes K12')
  for (let k = 0; k < 7; k++) {
    await v.locator('#ag-ed-subcuenta').fill(atajo(k % 2 ? e.banco : e.gasto)); await v.locator('#ag-ed-subcuenta').press('Enter')
    await v.locator(k % 2 ? '#ag-ed-haber' : '#ag-ed-debe').fill('10'); await v.locator(k % 2 ? '#ag-ed-haber' : '#ag-ed-debe').press('Enter')
  }
  await expect(v.getByRole('table', { name: 'Apuntes' }).locator('tbody tr')).toHaveCount(7)
  await expect(v.locator('.kp-lineas')).toHaveAttribute('data-desplaza', 'si')
  await noRueda(page, 'siete apuntes a 1366 × 768')
  await cadaPiezaCabe(page, 'siete apuntes a 1366 × 768')
  await v.getByRole('button', { name: 'Otros datos' }).click()
  await expect(v.getByRole('dialog', { name: 'Otros datos' })).toBeVisible()
  await cadaPiezaCabe(page, '«Otros datos» abierto a 1366 × 768')
  await page.screenshot({ path: `${DIR}/asiento-otros-datos-1366.png` })
  await page.keyboard.press('Escape')
  await v.locator('#ag-ed-subcuenta').focus()
  await page.keyboard.press('F4')
  await expect(page.getByRole('dialog', { name: 'Localización de registros' })).toBeVisible()
  await cadaPiezaCabe(page, 'la lupa abierta a 1366 × 768')
  await page.screenshot({ path: `${DIR}/asiento-lupa-1366.png` })
  await page.keyboard.press('Escape')
  expect(errores).toEqual([])
})

test('K12 · 6 · regla 31: el mismo asiento con la pantalla nueva y con la de hoy deja las mismas filas', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '6')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirNuevo(page)
  await pagoConElTeclado(page, e)
  await intro(page)
  const hecho = ventana(page).getByRole('status').filter({ hasText: /^Guardado y validado/ })
  await expect(hecho).toBeVisible({ timeout: 60_000 })
  const nuevoId = (await hecho.getByRole('link', { name: 'Verlo' }).getAttribute('href'))!.split('/').pop()!

  // La de hoy: el interruptor apagado SOLO en esta página (se quita conta_nucleo de lo que la app lee al arrancar).
  await page.route(/\/rest\/v1\/feature_flags/, async (r) => {
    const res = await r.fetch()
    const fs = (await res.json()) as { feature_key: string }[]
    await r.fulfill({ response: res, json: fs.filter((f) => f.feature_key !== 'conta_nucleo') })
  })
  await page.goto(NUEVO, { waitUntil: 'load' })
  await expect(page.getByPlaceholder('Ej.: Alquiler del local de octubre')).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('.kp-ventana'), 'con el interruptor apagado, la pantalla de hoy').toHaveCount(0)
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* lo que siga abierto no cuenta */ })
  await page.waitForTimeout(500)
  await page.getByPlaceholder('Ej.: Alquiler del local de octubre').fill('Pago de la factura de prueba K12')
  const fecha = page.locator('input[type="date"]').first()
  if (await fecha.count()) await fecha.fill('2026-11-12')
  const hoy: [string, string, string][] = [[e.acreedor, '63,60', ''], [e.banco, '', '63,60']]
  for (let i = 0; i < hoy.length; i++) {
    const n = i + 1
    await page.getByLabel(`Cuenta del apunte ${n}`).fill(hoy[i][0])
    await page.getByLabel(`Concepto del apunte ${n}`).fill('Pago de la factura de prueba K12')
    if (hoy[i][1]) await page.getByLabel(`Debe del apunte ${n}`).fill(hoy[i][1])
    if (hoy[i][2]) await page.getByLabel(`Haber del apunte ${n}`).fill(hoy[i][2])
  }
  await page.getByRole('button', { name: 'Guardar y validar' }).first().click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\/[0-9a-f-]{36}/, { timeout: 60_000 })
  const deHoyId = page.url().split('/').pop()!.split('?')[0]
  const [a, b] = [await filas(s, nuevoId), await filas(s, deHoyId)]
  console.log(`[K12] regla 31 · la nueva ${nuevoId}: ${JSON.stringify(a)}`)
  console.log(`[K12] regla 31 · la de hoy ${deHoyId}: ${JSON.stringify(b)}`)
  expect(a, 'el mismo asiento con las dos pantallas deja las mismas filas').toEqual(b)
  expect(errores).toEqual([])
})
