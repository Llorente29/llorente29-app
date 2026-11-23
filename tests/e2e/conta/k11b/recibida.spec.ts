/// <reference lib="dom" />
// tests/e2e/conta/k11b/recibida.spec.ts
//
// K11b · La factura recibida entera, como ERP10 (maquetas nucleo_17a, 17b, 17c y 18b), contra staging, en la empresa de
// hostelería de la cuenta del núcleo (semilla K11b), a 1366 × 768 y a 1920 × 1080:
//   1. una recibida a mano de principio a fin SOLO CON EL TECLADO (el proveedor por su código, el número, dos bases, la
//      cuenta, el local; Intro casilla a casilla y, en la última, guarda y valida), pendiente de pagar;
//   2. tres contrapartidas en tres locales, con su marca y su plataforma (empresa de hostelería): la suma de control
//      cuadra con la base, y el asiento validado lleva las tres líneas, cada una con su local, su marca y su plataforma;
//   3. «Otros datos» (⊕): el IVA deducible al 50 % lleva la mitad de la cuota al gasto en el asiento; y una fecha
//      fiscal en el 3T, que está presentado, no se guarda (lo dice la base y la ficha lo enseña);
//   4. dos pagos de la recibida del punto 1 (uno por caja, otro por banco), cambiar uno y borrar otro: lo pendiente, en
//      ámbar, y el asiento de cada pago debajo del de la factura;
//   5. la ficha cabe a 1366 sin desplazar la página, no se corta nada (lo cortado, con su `title` entero), y a 1920 no
//      se estira (cada bloque, 760 px como mucho).
// Lo de la base (los pagos con sus candados, también por el Excel de ERP10) lo prueba staging en ROLLBACK.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k11b'
const RESTAURANTE = 'Restaurante de Ejemplo Núcleo, S.L.'
const factura = (t: number, n: number) => enCarril(`c0f60000-0000-4000-8000-000000000f${t}${n}`)
const LOCAL = (n: number) => enCarril(`c0f60000-0000-4000-8000-0000000000c${n}`)
const MARCA = (n: number) => enCarril(`c0f60000-0000-4000-8000-0000000000b${n}`)
const PLATAFORMA = (n: number) => enCarril(`c0f60000-0000-4000-8000-0000000000d${n}`)
const NOMBRE_LOCAL = ['', 'Local de Prueba K11b Uno', 'Local de Prueba K11b Dos', 'Local de Prueba K11b Tres']
const NOMBRE_MARCA = ['', 'Marca de Prueba K11b Uno', 'Marca de Prueba K11b Dos']
const NOMBRE_PLATAFORMA = ['', 'Plataforma de Prueba K11b Uno', 'Plataforma de Prueba K11b Dos']
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const aviso = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA} [data-prueba="aviso-ficha"]`)

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

async function entrarEnElRestaurante(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${RESTAURANTE}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${RESTAURANTE}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

async function abrir(page: Page, id: string) {
  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`, { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(ficha(page).locator('[data-prueba="cuadra"]')).toBeVisible({ timeout: 30_000 })
}

async function introFuera(page: Page) {
  // Como una persona: si la ficha aún lee o guarda algo, lo dice y no valida; se espera y se vuelve a pulsar.
  for (let i = 0; i < 10; i++) {
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    const dice = (await aviso(page).textContent().catch(() => null)) ?? ''
    if (!/Aún estoy (leyendo|guardando)/.test(dice)) return
    await page.waitForTimeout(1500)
  }
}

async function sinDudaDeGasto(page: Page) {
  const dejar = ficha(page).locator('.kf-duda').getByRole('button', { name: /^Dejar / })
  if (await dejar.count()) await dejar.first().click()
}

async function sinDocumento(page: Page, porque: string) {
  await ficha(page).getByRole('checkbox', { name: 'Guardarla sin documento' }).check()
  await ficha(page).getByRole('textbox', { name: 'Por qué no tiene documento' }).fill(porque)
}

/** Lo que se ve de la ficha, en el registro (Q03), por si falla. */
async function contar(page: Page, donde: string) {
  const x = await ficha(page).evaluate((el) => ({
    franja: el.querySelector('.kf-estado')?.textContent, aviso: el.querySelector('[data-prueba="aviso-ficha"]')?.textContent ?? null,
    ambar: [...el.querySelectorAll('[data-comprobacion]')].map((c) => c.getAttribute('title')),
  })).catch((e) => String(e))
  console.log(`[K11b ${donde}] ${JSON.stringify(x)}`)
}

interface Linea { debit: number; credit: number; location_id: string | null; brand_id: string | null; channel_id: string | null; company_account: { code: string } }
const lineasDe = async (s: Sesion, facturaId: string) => {
  const e = await rest<{ id: string; status: string }[]>(s, `journal_entry?select=id,status&account_id=eq.${NUCLEO.id}&source_type=eq.supplier_invoice&source_id=eq.${facturaId}&status=neq.anulado`)
  expect(e, `el asiento de ${facturaId}`).toHaveLength(1)
  return { estado: e[0].status, lineas: await rest<Linea[]>(s, `journal_line?select=debit,credit,location_id,brand_id,channel_id,company_account:company_account_id(code)&entry_id=eq.${e[0].id}&order=position`) }
}

for (const [t, ancho, alto] of [[1, 1366, 768], [2, 1920, 1080]] as const) {
  test(`la recibida entera como ERP10 a ${ancho} × ${alto}: con el teclado, tres contrapartidas, el IVA al 50 %, el trimestre presentado y los pagos`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(420_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnElRestaurante(page)
    const sello = `${Date.now() % 100000}`
    const plegar = page.getByRole('button', { name: /Plegar los botones/ })
    if (await plegar.isVisible().catch(() => false)) await plegar.click()

    // ── 1 · A mano, solo con el teclado: el proveedor por su código, Intro de casilla en casilla, y en la última guarda. ──
    const numero = `K11B-${t}-TECLADO-${sello}`
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page).getByRole('heading', { name: 'Introducción de facturas recibidas · nueva' })).toBeVisible()
    const proveedor = ficha(page).locator('#kf-proveedor')
    // Entra por la primera casilla de la pantalla, como ERP10: la fecha de la factura (la de hoy, que se deja).
    await expect(ficha(page).locator('#kf-fecha')).toBeFocused({ timeout: 30_000 })
    // Sin documento (con el teclado: el foco, la barra espaciadora y su porqué), y de vuelta al proveedor.
    await ficha(page).getByRole('checkbox', { name: 'Guardarla sin documento' }).focus()
    await page.keyboard.press('Space')
    await ficha(page).getByRole('textbox', { name: 'Por qué no tiene documento' }).focus()
    await page.keyboard.type('Prueba e2e K11b: escrita a mano con el teclado, sin documento')
    // De vuelta a la primera casilla (la fecha) e Intro: el proveedor.
    await ficha(page).locator('#kf-fecha').focus()
    await page.keyboard.press('Enter')
    await expect(proveedor).toBeFocused()
    await page.keyboard.type('40000101')
    await expect(page.getByRole('option', { name: /^Proveedor de Prueba K11b, S\.L\./ })).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue('Proveedor de Prueba K11b, S.L.', { timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('#kf-numero')).toBeFocused()
    await page.keyboard.type(numero)
    await page.keyboard.press('Enter')
    // Intro sigue el orden de la pantalla: la fecha de la factura está arriba (la de hoy, que se deja); del número, a la base.
    await expect(ficha(page).getByRole('textbox', { name: 'Base 1' })).toBeFocused()
    await page.keyboard.type('100')
    await page.keyboard.press('Enter')
    await expect(ficha(page).getByRole('combobox', { name: 'Tipo de IVA 1', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(ficha(page).getByRole('textbox', { name: 'Base 2' })).toBeFocused()
    await page.keyboard.type('50')
    for (let i = 0; i < 12; i++) {
      // Intro hasta la cuenta de gasto: el tipo (10), la retención y el total.
      await page.keyboard.press('Enter')
      if (await ficha(page).locator('#kf-cuenta-0').evaluate((x) => x === document.activeElement)) break
    }
    await expect(ficha(page).locator('#kf-cuenta-0')).toBeFocused()
    await expect(ficha(page).locator('#kr-total')).toHaveValue('176,00')
    await page.keyboard.type('62800001')
    await expect(page.getByRole('option', { name: /^62800001 · / })).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    // El local, con su lupa (Respuesta K11b · 4): se escribe su nombre e Intro lo elige y pasa a la casilla siguiente.
    await expect(ficha(page).getByRole('textbox', { name: 'Local', exact: true })).toBeFocused()
    await page.keyboard.type(NOMBRE_LOCAL[1])
    await expect(ficha(page).getByRole('textbox', { name: 'Local', exact: true })).toHaveValue(NOMBRE_LOCAL[1])
    // El pago, en blanco: pendiente de pagar. Intro por la subcuenta y la fecha del pago; en la última, guarda y valida.
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('#kf-pago')).toBeFocused()
    // En blanco aunque la ficha proponga la del último pago de este proveedor (a 1920, la del punto 4 a 1366: e2e
    // 45261036533, «pagada»): se borra con el teclado.
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('')
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('#kf-pago-fecha')).toBeFocused()
    // El último Intro guarda; si la ficha aún lee cómo se paga, lo dice y no guarda: se espera y se vuelve a pulsar (como
    // introFuera; e2e 45177524259: «Aún estoy leyendo cómo se paga… vuelve a pulsar en un momento»).
    for (let i = 0; i < 10; i++) {
      await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      if (!/Aún estoy (leyendo|guardando)/.test((await aviso(page).textContent().catch(() => '')) ?? '')) break
      await page.waitForTimeout(1500)
      await ficha(page).locator('#kf-pago-fecha').focus()
    }
    await expect(aviso(page)).toContainText(`Guardada la ${numero}`, { timeout: 60_000 })
    await expect(aviso(page)).toContainText(/Apuntada y (validada|en Diez)/, { timeout: 60_000 })
    await contar(page, `${ancho} · 1`)
    const [nueva] = await rest<{ id: string; status: string; grand_total: number }[]>(s, `supplier_invoice?select=id,status,grand_total&account_id=eq.${NUCLEO.id}&invoice_number=eq.${numero}`)
    expect(nueva, 'la factura escrita con el teclado').toBeTruthy()
    expect(Number(nueva.grand_total)).toBe(176)
    expect(nueva.status, 'validada y pendiente de pagar').toBe('aprobada')
    const a1 = await lineasDe(s, nueva.id)
    expect(a1.estado).toBe('validado')
    expect(a1.lineas.find((l) => l.company_account.code === '62800001')?.location_id, 'el gasto, en su local').toBe(LOCAL(1))

    // ── 2 · Tres contrapartidas en tres locales, con marca y plataforma (hostelería), y el asiento con las tres. ──
    await abrir(page, factura(t, 1))
    await sinDudaDeGasto(page)
    await expect(ficha(page).locator('#kf-cuenta-0')).toHaveValue('62800001', { timeout: 30_000 })
    await ficha(page).getByRole('button', { name: 'Otra línea' }).click()
    await ficha(page).getByRole('button', { name: 'Otra línea' }).click()
    await expect(ficha(page).getByRole('button', { name: 'Otra línea' })).toContainText('3 líneas')
    for (const [i, cuenta] of [[1, '60000001'], [2, '62900001']] as const) {
      await ficha(page).locator(`#kf-cuenta-${i}`).fill(cuenta)
      await page.getByRole('option', { name: new RegExp(`^${cuenta} · `) }).click()
      await expect(ficha(page).locator(`#kf-cuenta-${i}`)).toHaveValue(cuenta)
    }
    for (const [i, importe] of [[0, '100'], [1, '120'], [2, '80']] as const) {
      await ficha(page).locator(`#kr-importe-${i}`).fill(importe)
      await ficha(page).locator(`#kr-importe-${i}`).press('Tab')
    }
    await expect(ficha(page).locator('[data-prueba="suma-contrapartidas"]')).toHaveText('Suma 300,00 · cuadra con la base')
    // Local, marca y plataforma con su lupa (Respuesta K11b · 4): el nombre e Intro. La marca y la plataforma se guardan al
    // momento; mientras se guardan, sus casillas se apagan (solo lectura).
    const poner = async (nombre: string, valor: string) => {
      const c = ficha(page).getByRole('textbox', { name: nombre, exact: true })
      await expect(c).toBeEditable({ timeout: 30_000 })
      await c.fill(valor)
      await c.press('Enter')
      await expect(c).toHaveValue(valor, { timeout: 30_000 })
    }
    for (const i of [0, 1, 2]) {
      const n = i + 1
      const sufijo = i === 0 ? '' : ` ${n}`
      await poner(`Local${sufijo}`, NOMBRE_LOCAL[n])
      await poner(`Marca${sufijo}`, NOMBRE_MARCA[i === 1 ? 2 : 1])
      await expect(aviso(page)).toContainText(/marca|Marca|Guardado/, { timeout: 30_000 })
      await poner(`Plataforma${sufijo}`, NOMBRE_PLATAFORMA[i === 2 ? 2 : 1])
      await expect(ficha(page).getByRole('textbox', { name: `Plataforma${sufijo}`, exact: true })).toBeEditable({ timeout: 30_000 })
    }
    const datos = await rest<{ position: number; brand_id: string | null; channel_id: string | null }[]>(s,
      `supplier_invoice_expense_dato?select=position,brand_id,channel_id&account_id=eq.${NUCLEO.id}&supplier_invoice_id=eq.${factura(t, 1)}&order=position`)
    expect(datos.map((d) => [d.position, d.brand_id, d.channel_id]), 'la marca y la plataforma de cada línea, guardadas').toEqual([
      [0, MARCA(1), PLATAFORMA(1)], [1, MARCA(2), PLATAFORMA(1)], [2, MARCA(1), PLATAFORMA(2)]])
    await expect(ficha(page).locator('.kf-asiento')).toContainText('(60000001)', { timeout: 30_000 })
    await expect(ficha(page).locator('.kf-asiento')).toContainText('(62900001)')
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, tres líneas, a ${ancho}`).toEqual([])
    // Respuestas K11b · 4 y 6 · Con tres contrapartidas y un pago, a 1366 × 768 la página no se desplaza: la lista de
    // contrapartidas enseña la primera línea y se desplaza dentro de su bloque, y el recuadro del asiento termina dentro de
    // la pantalla (si tiene más líneas de las que caben, se desplazan dentro, con «Factura · Cuadra» fija). El pago se
    // quita después: esta factura se valida pendiente de pagar.
    await ficha(page).locator('#kf-pago').fill('57000000')
    await page.getByRole('option', { name: /^57000000 · / }).click()
    await expect(ficha(page).locator('[data-asiento-pago="por-hacer"]')).toBeAttached({ timeout: 30_000 })
    const vista = await ficha(page).evaluate((el) => {
      const p = el.querySelector('.kr-pantalla') as HTMLElement
      const marco = el.querySelector('.kr-visual-marco') as HTMLElement
      return {
        desplazada: p.scrollTop, sobra: p.scrollHeight - p.clientHeight, marco: Math.round(marco.getBoundingClientRect().bottom),
        pantalla: Math.round(p.getBoundingClientRect().bottom), alto: window.innerHeight, asientoDentro: marco.scrollHeight - marco.clientHeight,
      }
    })
    console.log(`[K11b ${ancho} · asiento] ${JSON.stringify(vista)}`)
    expect(vista.desplazada, `a ${ancho}, la pantalla sin desplazar`).toBe(0)
    expect(vista.sobra, `a ${ancho}, nada de la ficha queda por debajo`).toBeLessThanOrEqual(1)
    expect(vista.marco, `a ${ancho}, el recuadro del asiento termina dentro de la pantalla`).toBeLessThanOrEqual(Math.min(vista.pantalla, vista.alto))
    await cargada(page, 'tres contrapartidas y el pago')
    await page.screenshot({ path: `${DIR}/tres-contrapartidas-${ancho}.png` })
    await ficha(page).locator('#kf-pago').fill('')
    await ficha(page).locator('#kf-pago').press('Tab')
    await expect(ficha(page).locator('[data-asiento-pago="por-hacer"]')).toHaveCount(0, { timeout: 30_000 })
    await sinDocumento(page, 'Prueba e2e K11b: tres contrapartidas, sin documento')
    await introFuera(page)
    await expect(aviso(page)).toContainText(/Apuntada y (validada|en Diez)/, { timeout: 60_000 })
    await contar(page, `${ancho} · 2`)
    const a2 = await lineasDe(s, factura(t, 1))
    const gastos = a2.lineas.filter((l) => /^6/.test(l.company_account.code))
    expect(gastos.map((l) => [l.company_account.code, Number(l.debit), l.location_id, l.brand_id, l.channel_id]), 'las tres líneas del asiento, cada una con lo suyo').toEqual([
      ['62800001', 100, LOCAL(1), MARCA(1), PLATAFORMA(1)],
      ['60000001', 120, LOCAL(2), MARCA(2), PLATAFORMA(1)],
      ['62900001', 80, LOCAL(3), MARCA(1), PLATAFORMA(2)],
    ])

    // ── 3 · «Otros datos»: el IVA deducible al 50 % lleva la mitad de la cuota al gasto; y el 3T, presentado, no se guarda. ──
    await abrir(page, factura(t, 2))
    await sinDudaDeGasto(page)
    // La repetida (una duda que se decide con un botón, en una línea): con el número de la del punto 2, ya validada, del
    // mismo proveedor. Se ve, y al volver a su número se va (no se guarda nada).
    await ficha(page).locator('#kf-numero').fill(`K11B-${t}-TRES`)
    await expect(ficha(page).locator('[data-prueba="repetida"]')).toBeVisible({ timeout: 30_000 })
    if (ancho === 1366) { await cargada(page, 'la repetida'); await page.screenshot({ path: `${DIR}/duda-repetida-1366.png` }) }
    await ficha(page).locator('#kf-numero').fill(`K11B-${t}-MITAD`)
    await expect(ficha(page).locator('[data-prueba="repetida"]')).toHaveCount(0, { timeout: 30_000 })
    await ficha(page).getByRole('button', { name: 'Otros datos' }).click()
    const otros = ficha(page).getByRole('dialog', { name: 'Otros datos' })
    await expect(otros).toBeVisible()
    await otros.locator('#kr-deducible').fill('50')
    await otros.locator('#kr-deducible').press('Enter')
    await expect(aviso(page)).toContainText(/deducible/i, { timeout: 30_000 })
    await expect(otros.locator('#kr-deducible')).toHaveValue('50', { timeout: 30_000 })
    await otros.locator('#kr-fecha-fiscal').fill('15/09/2026')
    await otros.locator('#kr-fecha-fiscal').press('Tab')
    await expect(aviso(page)).toContainText('ya está presentado', { timeout: 30_000 })
    const [f2] = await rest<{ deduct_from: string | null; vat_deductible_pct: number | null }[]>(s, `supplier_invoice?select=deduct_from,vat_deductible_pct&account_id=eq.${NUCLEO.id}&id=eq.${factura(t, 2)}`)
    expect(f2.deduct_from, 'la fecha fiscal en el 3T presentado no se ha guardado').toBeNull()
    expect(Number(f2.vat_deductible_pct)).toBe(50)
    await page.keyboard.press('Escape')
    await expect(otros).toHaveCount(0)
    // El 3T, presentado, no se ofrece en la lupa del periodo (K11b · 6).
    await ficha(page).getByRole('button', { name: 'Buscar ejercicio' }).click()
    await expect(page.locator('[data-pieza="lupa"]')).toBeVisible()
    await expect(page.locator('[data-pieza="lupa"]')).not.toContainText('3T de 2026')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-pieza="lupa"]')).toHaveCount(0)
    // 100,00 de base y 21,00 de IVA: 10,50 deducible (al 472) y 10,50 al gasto (110,50).
    await expect(ficha(page).locator('.kf-asiento')).toContainText('110,50 (62800001)', { timeout: 30_000 })
    await expect(ficha(page).locator('.kf-asiento')).toContainText('10,50 (472')
    await cargada(page, 'el IVA al 50 %')
    await page.screenshot({ path: `${DIR}/iva-al-50-${ancho}.png` })

    // ── 4 · Dos pagos de la del punto 1 (caja y banco), cambiar uno y borrar otro: lo pendiente y el asiento cambian. ──
    await abrir(page, nueva.id)
    const pendiente = ficha(page).locator('[data-prueba="pendiente"]')
    await expect(pendiente).toHaveText('Pendiente 176,00', { timeout: 30_000 })
    const otroPago = ficha(page).getByRole('button', { name: 'Otro pago' })
    for (const [cuenta, importe, queda] of [['57000000', '50', 'Pendiente 126,00'], ['57200001', '126', 'Pagada']] as const) {
      await otroPago.click()
      await ficha(page).locator('#kr-pago-cuenta-nuevo').fill(cuenta)
      await ficha(page).locator('#kr-pago-cuenta-nuevo').press('Enter')
      await ficha(page).locator('#kr-pago-importe-nuevo').fill(importe)
      await ficha(page).locator('#kr-pago-importe-nuevo').press('Enter')
      await expect(aviso(page)).toContainText(`Pago apuntado con la ${cuenta}`, { timeout: 30_000 })
      await expect(pendiente).toHaveText(queda, { timeout: 30_000 })
    }
    await expect(otroPago).toContainText('2 pagos')
    await expect(ficha(page).locator('[data-asiento-pago]')).toHaveCount(2)
    await expect(pendiente).not.toHaveAttribute('data-ambar', 'si')
    // Cambiar el de la caja a 40,00: el mismo número, y faltan 10,00 (en ámbar).
    const filas = ficha(page).locator('[data-pago]')
    await expect(filas).toHaveCount(2)
    await expect(filas.first().getByRole('textbox', { name: 'Subcuenta pago' })).toHaveValue('57000000')
    const docCaja = await filas.first().getByRole('textbox', { name: 'Documento del pago' }).inputValue()
    await filas.first().getByRole('button', { name: /^Cambiar el pago/ }).click()
    await ficha(page).locator('#kr-pago-importe-0').fill('40')
    await ficha(page).locator('#kr-pago-importe-0').press('Enter')
    await expect(aviso(page)).toContainText(`sigue siendo el ${docCaja}`, { timeout: 30_000 })
    await expect(pendiente).toHaveText('Pendiente 10,00', { timeout: 30_000 })
    await expect(pendiente).toHaveAttribute('data-ambar', 'si')
    await expect(pendiente).toHaveAttribute('title', /faltan 10,00/)
    // Borrar el del banco (dos pulsaciones: la primera lo arma): faltan 136,00, y su asiento ya no sale.
    const banco = ficha(page).locator('[data-pago]').nth(1)
    await expect(banco.getByRole('textbox', { name: 'Subcuenta pago' })).toHaveValue('57200001')
    await banco.getByRole('button', { name: /^Borrar el pago/ }).click()
    await banco.getByRole('button', { name: /^Borrar el pago/ }).click()
    await expect(aviso(page)).toContainText('borrado', { timeout: 30_000 })
    await expect(pendiente).toHaveText('Pendiente 136,00', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-asiento-pago]')).toHaveCount(1)
    const pagos = await rest<{ amount: number }[]>(s, `supplier_invoice_payment?select=amount&account_id=eq.${NUCLEO.id}&invoice_id=eq.${nueva.id}`)
    expect(pagos.map((p) => Number(p.amount)), 'queda el de la caja, cambiado').toEqual([40])
    await contar(page, `${ancho} · 4`)

    // ── 5 · Cabe sin desplazar la página, no se corta nada, y a 1920 no se estira. ──
    const medida = await page.evaluate(() => ({ alto: document.documentElement.scrollHeight, ancho: document.documentElement.scrollWidth }))
    expect(medida.ancho, 'sin desplazar la página a lo ancho').toBeLessThanOrEqual(ancho)
    expect(medida.alto, 'sin desplazar la página a lo alto').toBeLessThanOrEqual(alto)
    const bloques = await ficha(page).locator('.kr-pantalla [data-pieza="bloque"]').evaluateAll((x) => x.map((b) => Math.round(b.getBoundingClientRect().width)))
    expect(bloques.length).toBeGreaterThanOrEqual(5)
    expect(Math.max(...bloques), `a ${ancho}, ningún bloque pasa de 760 px`).toBeLessThanOrEqual(760)
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, con los pagos, a ${ancho}`).toEqual([])
    await cargada(page, 'los pagos')
    await page.screenshot({ path: `${DIR}/pagos-${ancho}.png` })

    expect(errores, 'errores de la página').toEqual([])
  })
}
