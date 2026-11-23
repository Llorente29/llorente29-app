/// <reference lib="dom" />
// tests/e2e/conta/r14/proveedor-solo.spec.ts
//
// R14 · El proveedor nuevo se da de alta solo, con su cuenta de gasto. Contra staging, en la
// cuenta del núcleo (semilla del K02), a 1456 × 816 y a 1366 × 768. Cada prueba crea una
// empresa nueva («Prueba R14 …», con su plan y su ejercicio):
//   1. Llega una factura leída de un proveedor que la cuenta no tiene (NIF inventado, T11;
//      semilla R14, que hace lo que hará el disparador de la 1120 al leerla). Se abre con el
//      proveedor ya dado de alta («Proveedor nuevo: lo ha dado de alta Sumied con lo que trae
//      la factura» y «Deshacer») y la cuenta propuesta en ámbar («Propuesta: vende pollo y
//      alitas → 600 Compras de mercaderías»). Intro: validada.
//   2. La siguiente del mismo proveedor ya sale sin franja y sin ámbar: su cuenta la da lo
//      aprendido de la primera.
//   3. «Deshacer» en otra de otro proveedor nuevo: la factura vuelve a no tener proveedor y lo dice.
//   4. En la de a mano, «+ Nuevo proveedor»: NIF y nombre en la misma fila, Intro, y queda elegido.
// Escribe (empresas, facturas, proveedores): solo en un carril; sin carril se salta y lo dice.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, cargada } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
test.skip(CARRIL === null, 'Crea una empresa en la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/r14'
const ficha = (page: Page) => page.locator('[data-prueba="ficha-recibida-nucleo"]')
const aviso = (page: Page) => page.locator('[data-prueba="aviso-ficha"]')
const PROPUESTA = 'Propuesta: vende pollo y alitas → 600 Compras de mercaderías'

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await ficha(page).innerText().catch(() => '(sin ficha)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Una empresa recién creada en la cuenta del núcleo, con su plan y su ejercicio 2026. */
async function crearEmpresa(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Prueba R14 ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e R14' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  return id
}

/** Llega leída (semilla R14: lo que hará el disparador de la 1120) y sin PDF, que se marca «Sin documento» como en la K04. */
async function llega(s: Sesion, empresa: string, nif: string, nombre: string, numero: string): Promise<{ id: string; que: string }> {
  const r = await rest<{ id: string; proveedor: { que: string } }>(s, 'POST', 'rpc/e2e_r14_llega', { p_company: empresa, p_nif: nif, p_nombre: nombre, p_numero: numero })
  expect(r.status, `e2e_r14_llega: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  const p = await rest(s, 'POST', 'rpc/conta_recibida_sin_papel', { p_invoice: r.datos.id, p_sin: true, p_motivo: 'Prueba e2e R14: la semilla no trae PDF', p_quien_nombre: 'Prueba e2e R14' })
  expect(p.status, `sin documento: ${JSON.stringify(p.datos).slice(0, 300)}`).toBeLessThan(300)
  return { id: r.datos.id, que: r.datos.proveedor.que }
}

async function abrirFicha(page: Page, id: string) {
  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`, { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="cuadra"]')).toContainText(/Cuadra|Falta/, { timeout: 30_000 })
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`a ${ancho} × ${alto}: el proveedor nuevo se da de alta solo, con su cuenta en ámbar; la siguiente sin ámbar; «Deshacer» y «+ Nuevo proveedor»`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(`${page.url()}: ${e.message}`); console.log(`[error de la página] ${e.message}`) })
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarComo(page, NUCLEO.email)
    const empresa = await crearEmpresa(s, String(ancho))
    await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
    const grande = ancho === 1456
    const nif = cifInventado()
    const nombre = `Suministros Inventados R14 ${ancho}, S.L.`

    // ── 1 · La primera: el proveedor dado de alta y la cuenta propuesta en ámbar; Intro. ──
    const f1 = await llega(s, empresa, nif, nombre, `R14-${ancho}-1`)
    expect(f1.que, 'la semilla lo ha dado de alta').toBe('alta')
    await abrirFicha(page, f1.id)
    try {
      await expect(ficha(page).locator('.kf-duda', { hasText: 'Proveedor nuevo:' })).toContainText('lo ha dado de alta Sumied con lo que trae la factura.', { timeout: 30_000 })
      await expect(ficha(page).getByRole('button', { name: 'Deshacer' })).toBeVisible()
      await expect(page.locator('#kf-nombre')).toHaveValue(nombre)
      await expect(page.locator('#kf-nif')).toHaveValue(nif)
      await expect(ficha(page).locator('#kf-cuenta-0')).toHaveValue('60000000', { timeout: 30_000 })
      // K11b · Sin frases (la ficha como ERP10, punto 8): la cuenta propuesta, en ámbar, con su porqué al pasar el ratón.
      const cuenta = ficha(page).locator('.kr-celda', { has: page.locator('#kf-cuenta-0') })
      await expect(cuenta).toHaveAttribute('data-ambar', 'si', { timeout: 30_000 })
      await expect(cuenta).toHaveAttribute('title', PROPUESTA)
      await expect(ficha(page).locator('.kf-estado')).toContainText('mira lo ámbar y pulsa Intro')
    } catch (e) { await contarPantalla(page, 'la primera'); throw e }
    if (grande) { await cargada(page, 'la primera, con el proveedor nuevo'); await page.screenshot({ path: `${DIR}/proveedor-nuevo-${ancho}.png` }) }
    await page.locator('body').press('Enter')
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })

    // ── 2 · La siguiente del mismo proveedor: sin franja y sin ámbar. ──
    const f2 = await llega(s, empresa, nif, nombre.toUpperCase(), `R14-${ancho}-2`)
    expect(f2.que, 'el mismo proveedor, que ya está').toBe('existente')
    await abrirFicha(page, f2.id)
    try {
      await expect(page.locator('#kf-nombre')).toHaveValue(nombre, { timeout: 30_000 })
      await expect(ficha(page).locator('#kf-cuenta-0')).toHaveValue('60000000', { timeout: 30_000 })
      await expect(ficha(page).locator('.kf-duda', { hasText: 'Proveedor nuevo:' })).toHaveCount(0)
      // K11b · Sin ámbar: la casilla de la cuenta, sin el porqué de una propuesta (antes, la frase «Propuesta: …»).
      await expect(ficha(page).locator('.kr-celda', { has: page.locator('#kf-cuenta-0') })).not.toHaveAttribute('data-ambar', 'si')
    } catch (e) { await contarPantalla(page, 'la siguiente'); throw e }
    if (grande) await page.screenshot({ path: `${DIR}/la-siguiente-sin-ambar-${ancho}.png` })

    // ── 3 · «Deshacer» en la de otro proveedor nuevo. ──
    const otro = `Otro Inventado R14 ${ancho}, S.L.`
    const f3 = await llega(s, empresa, cifInventado(), otro, `R14-${ancho}-3`)
    await abrirFicha(page, f3.id)
    await ficha(page).getByRole('button', { name: 'Deshacer' }).click()
    await expect(aviso(page)).toContainText(`Deshecho: ${otro} ya no está dado de alta y la factura vuelve a no tener proveedor.`, { timeout: 30_000 })
    await expect(ficha(page).locator('.kf-duda', { hasText: 'No conozco al que la emite' })).toBeVisible({ timeout: 30_000 })

    // ── 4 · A mano: «+ Nuevo proveedor», NIF y nombre en la misma fila, sin perder lo escrito. ──
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page).locator('.kf-estado')).toContainText('La escribes tú.')
    await page.locator('#kf-numero').fill(`R14-M-${ancho}`)
    await ficha(page).getByRole('button', { name: '+ Nuevo proveedor' }).click()
    const aMano = `A Mano Inventado R14 ${ancho}, S.L.`
    await page.locator('#kf-nif').fill(cifInventado())
    await page.locator('#kf-nombre').fill(aMano)
    if (grande) await page.screenshot({ path: `${DIR}/nuevo-proveedor-a-mano-${ancho}.png` })
    await page.locator('#kf-nombre').press('Enter')
    await expect(aviso(page)).toContainText(`Dado de alta ${aMano}`, { timeout: 30_000 })
    await expect(page.getByRole('tab', { name: new RegExp(`^Factura recibida · ${aMano.replace(/\./g, '\\.')}`) })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#kf-numero')).toHaveValue(`R14-M-${ancho}`)

    expect(errores, 'sin errores de la página').toEqual([])
  })
}
