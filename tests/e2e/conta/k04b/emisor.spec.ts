/// <reference lib="dom" />
// tests/e2e/conta/k04b/emisor.spec.ts
//
// K04b · La ficha de la recibida del núcleo, contra staging, con la cuenta del
// núcleo (semilla K02) y las facturas de seed_k04b_emisor_desconocido_staging,
// a 1456 × 816 y a 1366 × 768, con el navegador en español:
//   1. una recibida de un emisor que no está en sus proveedores: la franja dice
//      «Mira esto · No conozco al que la emite», con el NIF y el nombre leídos
//      en sus casillas («PDF»); no se valida y lo dice; «Darlo de alta» lo da
//      de alta y la factura queda lista: se valida;
//   2. otra igual, por «Es uno que ya tengo»: el foco va al proveedor, con su
//      lista; se elige uno y se valida;
//   3. (respuesta K05 · 0b) las pestañas son de su empresa: una recibida
//      abierta y escrita en la gestoría; se cambia a la otra empresa (no se ve:
//      sale su Inicio, y abajo «N pestañas abiertas en la gestoría»); se abre
//      una de la otra; se vuelve a la gestoría (está la primera, con lo
//      escrito) y se valida: su asiento queda en la gestoría.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, EMPRESA, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k04'
const GESTORIA_ID = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const factura = (t: number, n: number) => enCarril(`c0e40000-0000-4000-8000-000000000d${t}${n}`)
const deLaOtra = (t: number) => enCarril(`c0e40000-0000-4000-8000-000000000e${t}1`)
const PROVEEDOR = (t: number) => (t === 1 ? 'Proveedor de Prueba Ficha Uno, S.L.' : 'Proveedor de Prueba Ficha Dos, S.L.')
// K11b · Las del emisor que no se conoce, de la semilla K11b (emisor): las de la K04b ya llevan el proveedor que les puso
// el alta sola de la R14 (21/11). Estas llegan sin proveedor de verdad, como las deja su «Deshacer».
const sinProveedor = (t: number, n: 1 | 2) => enCarril(`c0f80000-0000-4000-8000-000000000d${t}${n}`)
const NIF_NUEVO = (t: number) => (t === 1 ? 'B00000133' : 'B00000158')
const EMISOR = (t: number) => `Emisor Desconocido de Prueba ${t}, S.L.`
// La de la pestaña que se ve: con las pestañas de su empresa, la de la otra sigue montada y escondida (K05 · 0b).
const ficha = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-recibida-nucleo"]')
const franja = (page: Page) => ficha(page).locator('.kf-estado')
const aviso = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="aviso-ficha"]')

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

/** Las facturas de la semilla no traen PDF: «Sin documento», con su motivo (la misma función que la ficha). */
async function sinDocumento(s: Sesion, id: string) {
  await rest(s, 'rpc/conta_recibida_sin_papel', { p_invoice: id, p_sin: true, p_motivo: 'Prueba e2e K04b: la semilla no trae PDF', p_quien_nombre: 'Prueba e2e K04b' })
}

/** Ir a una dirección SIN recargar la página (lo escrito en las pestañas vive en la página). */
async function irSinRecargar(page: Page, url: string) {
  await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')) }, url)
}

async function fichaLista(page: Page) {
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
}

async function elegirEmpresa(page: Page, nombre: string) {
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${nombre}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${nombre}`) })).toBeVisible({ timeout: 30_000 })
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await elegirEmpresa(page, GESTORIA)
  await abierta(page, 'Inicio')
  return s
}

/** Lo que había en la ficha, escrito en el registro (Q03): la franja, las comprobaciones y el aviso. */
async function contar(page: Page, donde: string) {
  const x = await ficha(page).evaluate((el) => ({
    franja: el.querySelector('.kf-estado')?.textContent, comprobaciones: [...el.querySelectorAll('[data-comprobacion]')].map((c) => c.getAttribute('title')),
    aviso: el.querySelector('[data-prueba="aviso-ficha"]')?.textContent ?? null,
  })).catch((e) => String(e))
  console.log(`[K04b ${donde}] ${JSON.stringify(x)}`)
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`el emisor que no se reconoce a ${ancho} × ${alto}: la franja dice la verdad, «Darlo de alta» y «Es uno que ya tengo»`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    for (const n of [1, 2] as const) await sinDocumento(s, sinProveedor(t, n))
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · El emisor que no se reconoce: la franja, el NIF y el nombre leídos. ──
    await page.goto(`/conta/documentos/recibidas/${sinProveedor(t, 1)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await contar(page, `${ancho} al abrir`)
    await expect(franja(page)).toContainText('Mira esto ·', { timeout: 30_000 })
    await expect(franja(page)).toContainText('No conozco al que la emite')
    await expect(franja(page)).not.toContainText(/Rellenada|bien/)
    await expect(ficha(page).locator('#kf-nif')).toHaveValue(NIF_NUEVO(t))
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(EMISOR(t))
    // K11b · Sin frases: de dónde sale el NIF, al pasar el ratón por su casilla; y el NIF correcto no pone la casilla en
    // ámbar (antes, «NIF correcto» escrito debajo). Si fuera el de otra ficha, la casilla saldría en ámbar con el motivo.
    await expect(ficha(page).locator('.kp-casilla', { has: page.locator('#kf-nif') })).toHaveAttribute('title', 'PDF')
    await expect(ficha(page).locator('[data-comprobacion="nif"]')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: new RegExp(`^Factura recibida · Emisor Desconocido de Prueba ${t}`) })).toBeVisible()
    const duda = ficha(page).locator('.kf-duda')
    await expect(duda).toContainText('No conozco al que la emite')
    await expect(duda.getByRole('button', { name: 'Darlo de alta' })).toBeFocused({ timeout: 15_000 })
    // K11b · La duda del emisor en la ficha como ERP10, a 1366 (para el parte: lo que se decide con un botón, en una línea).
    if (ancho === 1366) { await cargada(page, 'la duda del emisor'); await page.screenshot({ path: 'docs/conta/capturas/k11b/duda-emisor-1366.png' }) }
    if (alto >= 800) {
      await cargada(page, 'el emisor que no se reconoce')
      await page.screenshot({ path: `${DIR}/emisor-desconocido-${ancho}.png` })
    }
    // La de hoy, con la misma factura (para la hoja, al lado): «No encaja · No reconozco quién la emite». Y se vuelve.
    await ficha(page).getByRole('button', { name: 'Más' }).click()
    await page.getByRole('button', { name: /^La ficha completa/ }).click()
    await expect(page.getByText('No reconozco quién la emite', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    if (alto >= 800) {
      await cargada(page, 'la ficha de hoy, con el emisor que no se reconoce')
      await page.screenshot({ path: `${DIR}/emisor-desconocido-ficha-de-hoy-${ancho}.png` })
    }
    await page.getByRole('button', { name: '‹ Volver a la ficha nueva' }).click()
    await fichaLista(page)
    // No se valida, y lo dice.
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText('no conozco al que la emite', { timeout: 30_000 })
    await expect(aviso(page)).toContainText('No paso a la siguiente')
    // «Darlo de alta»: el alta de hoy, con lo leído.
    await duda.getByRole('button', { name: 'Darlo de alta' }).click()
    const form = page.locator('[data-prueba="formulario-alta-factura"]')
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Nombre con el que lo conocéis')).toHaveValue(EMISOR(t))
    await expect(form.getByLabel(/^NIF/)).toHaveValue(NIF_NUEVO(t))
    await form.getByRole('button', { name: 'Darlo de alta y elegirlo' }).click()
    await expect(aviso(page)).toContainText('dado de alta y elegido', { timeout: 30_000 })
    await expect(aviso(page)).toContainText('ya se puede validar')
    await expect(franja(page)).not.toContainText('No conozco', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    await contar(page, `${ancho} después del alta`)
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })

    // ── 2 · «Es uno que ya tengo»: el foco al proveedor, con su lista; se elige y se valida. ──
    await page.goto(`/conta/documentos/recibidas/${sinProveedor(t, 2)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(franja(page)).toContainText('No conozco al que la emite', { timeout: 30_000 })
    await ficha(page).locator('.kf-duda').getByRole('button', { name: 'Es uno que ya tengo' }).click()
    const proveedor = ficha(page).locator('#kf-proveedor')
    await expect(proveedor).toBeFocused()
    await proveedor.pressSequentially(t === 1 ? 'Ficha Uno' : 'Ficha Dos')
    await expect(page.getByRole('option', { name: new RegExp(`^${PROVEEDOR(t).replace(/\./g, '\\.')}`) })).toBeVisible({ timeout: 15_000 })
    await proveedor.press('Enter')
    await expect(aviso(page)).toContainText(`Elegido ${PROVEEDOR(t)}`, { timeout: 30_000 })
    await expect(franja(page)).not.toContainText('No conozco', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })

    expect(errores, 'errores de la página').toEqual([])
  })

  test(`las pestañas son de su empresa a ${ancho} × ${alto}: se cambia, se vuelve con lo escrito y se valida en la suya`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    await sinDocumento(s, factura(t, 3))

    // En la gestoría: la recibida, y se escribe en ella.
    await irSinRecargar(page, `/conta/documentos/recibidas/${factura(t, 3)}?ver=por-revisar`)
    await fichaLista(page)
    const escrito = `K04C-${t}-3-B`
    await ficha(page).locator('#kf-numero').fill(escrito)
    const pestanaFicha = page.locator('[data-pestana-trabajo="ficha:recibida"]')
    await expect(pestanaFicha).toHaveAttribute('data-cambios', 'si')
    // Esc con cambios sin guardar: pregunta (antes no hacía nada: la ventana se abría y se cerraba con la misma pulsación).
    await ficha(page).locator('#kf-numero').press('Escape')
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('Tienes cambios sin guardar', { timeout: 15_000 })
    await dialogo.getByRole('button', { name: 'Seguir aquí' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(escrito)

    // A la otra empresa: la factura no se ve; sale su Inicio, y abajo lo que queda abierto en la gestoría.
    await elegirEmpresa(page, EMPRESA)
    await expect(page.getByRole('tab', { name: /^Factura recibida/ })).toHaveCount(0, { timeout: 30_000 })
    await expect(page).toHaveURL(/\/conta\/inicio/)
    await abierta(page, 'Inicio de la otra empresa')
    // La de la gestoría sigue montada, pero escondida: no se ve ninguna ficha.
    const fichasQueSeVen = page.locator('[data-prueba="ficha-recibida-nucleo"]:visible')
    await expect(fichasQueSeVen).toHaveCount(0)
    const abajo = page.locator('[data-prueba="abiertas-en-otra"]')
    await expect(abajo).toHaveText(/^\d+ pestañas? abiertas? en Gestoría/)
    // Una recibida de la otra empresa, en su pestaña.
    await irSinRecargar(page, `/conta/documentos/recibidas/${deLaOtra(t)}?ver=por-revisar`)
    await fichaLista(page)
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(`K04E-${t}-1`)
    await expect(fichasQueSeVen).toHaveCount(1)
    if (alto >= 800) {
      await cargada(page, 'la otra empresa, con las de la gestoría abajo')
      await page.screenshot({ path: `${DIR}/pestanas-de-su-empresa-${ancho}.png` })
    }

    // Se vuelve a la gestoría desde la línea de abajo: está la primera, con lo escrito.
    await abajo.click()
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(factura(t, 3)))
    await fichaLista(page)
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(escrito)
    await expect(fichasQueSeVen).toHaveCount(1)
    await expect(pestanaFicha).toHaveAttribute('data-cambios', 'si')
    await expect(page.locator('[data-prueba="abiertas-en-otra"]')).toHaveText(/^\d+ pestañas? abiertas? en (Ejemplo Núcleo|Empresa de Ejemplo)/)
    // Se valida: su asiento queda en la gestoría.
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    const asiento = await rest<{ company_id: string; status: string }[]>(s,
      `journal_entry?select=company_id,status&account_id=eq.${NUCLEO.id}&source_type=eq.supplier_invoice&source_id=eq.${factura(t, 3)}&status=neq.anulado`)
    console.log(`[K04b ${ancho}] el asiento de la factura de la gestoría: ${JSON.stringify(asiento)}`)
    expect(asiento).toHaveLength(1)
    expect(asiento[0]).toMatchObject({ company_id: GESTORIA_ID(), status: 'validado' })
    const f = await rest<{ invoice_number: string; company_id: string }[]>(s, `supplier_invoice?select=invoice_number,company_id&account_id=eq.${NUCLEO.id}&id=eq.${factura(t, 3)}`)
    expect(f[0]).toMatchObject({ invoice_number: escrito, company_id: GESTORIA_ID() })

    expect(errores, 'errores de la página').toEqual([])
  })
}
