/// <reference lib="dom" />
// tests/e2e/conta/e04/pasada-sola.spec.ts
//
// E04 · La factura de otra sociedad del grupo se pasa sola. Contra staging-conta
// de verdad, cuenta A con su segunda sociedad (semilla E03), a 1456 × 816 y en móvil:
//
//   1. Una a nombre de la segunda sociedad aparece sola en ella: arriba en su
//      ficha, la línea verde «Pasada sola desde …: va a nombre de … (NIF).» con
//      «Deshacer»; «Deshacer» la devuelve a la primera, con su llegada, y apunta
//      «Es de esta sociedad»: «Devuelta a …. Ya no se moverá sola.»
//   2. Una a nombre de alguien de fuera: «Es de: [sociedad ▾]» con la de ahora
//      elegida, y los dos botones del IVA en hueco; se elige la otra, sale
//      «Pasarla a …», y la confirmación sale ARRIBA (en el móvil, sin bajar).
//   3. En Inicio, «Lo que he hecho yo desde ayer» dice cuántas ha pasado solas, y
//      su enlace abre la lista con solo esas.
//
// Los datos los prepara en su carril e2e_e04_preparar (semilla E04, solo staging):
// lo de e2e_e03_preparar y la primera, pasada sola con _conta_pasar_sola (1950).
// Hasta el real del E04, el disparador que la pasa al leerla (1951, cambia en
// caliente) solo va en ROLLBACK a staging: la semilla hace lo que hará él (lo
// prueba su prueba de staging). Escribe (pasa y devuelve): solo en un carril, que
// se borra al acabar; sin carril se salta y lo dice. Capturas: docs/conta/capturas/e04/.

import { mkdirSync, readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/e04'
const PDF = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'
const OTRA = 'Prueba Segunda Takeaway, S.L.'
const EMPRESA = 'Taberna de Prueba Norte, S.L.'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1456) < 768 ? 'movil' : 'ordenador')

interface Preparadas {
  cuenta: string; empresa: string; otra_empresa: string
  otra: { id: string; numero: string; ruta: string }
  fuera: { id: string; numero: string; ruta: string }
}

async function ponerElTamano(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) await page.setViewportSize({ width: 1456, height: 816 })
}

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function preparar(s: Sesion, page: Page): Promise<Preparadas> {
  const r = await rest<Preparadas>(s, 'POST', 'rpc/e2e_e04_preparar', { p_lado: lado(page) })
  expect(r.status, `e2e_e04_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  for (const f of [r.datos.otra, r.datos.fuera]) {
    const sub = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${f.ruta}`, {
      method: 'POST',
      headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
      body: readFileSync(PDF),
    })
    const t = await sub.text()
    expect(sub.ok || /exists|duplicate/i.test(t), `subir el PDF de ${f.numero}: ${sub.status} ${t.slice(0, 200)}`).toBe(true)
  }
  return r.datos
}

/** La empresa activa en las páginas que se abran a partir de ahora (antes de navegar, como en el E03). */
async function conEmpresa(page: Page, cuenta: string, empresa: string) {
  await page.addInitScript(([k, v]) => { try { window.localStorage.setItem(k, v) } catch { /* sin almacén */ } }, [`folvy.conta.empresa.${cuenta}`, empresa] as const)
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page) === 'movil' ? 'movil' : '1456'}.png`, fullPage: false })
}

test.describe('E04 · la factura de otra sociedad del grupo se pasa sola', () => {
  test.describe.configure({ timeout: 240_000 })
  test.use({ actionTimeout: 20_000 })
  test.skip(!CARRIL, 'Escribe (pasa y devuelve facturas): solo en un carril, que se borra al acabar.')

  test('aparece sola en la segunda sociedad, con su línea verde; «Deshacer» la devuelve', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      // En la base: en la segunda, con su llegada.
      const f = await rest<{ company_id: string }[]>(s, 'GET', `supplier_invoice?select=company_id&account_id=eq.${p.cuenta}&id=eq.${p.otra.id}`)
      expect(f.datos[0]?.company_id, 'pasada sola a la segunda').toBe(p.otra_empresa)
      await conEmpresa(page, p.cuenta, p.otra_empresa)
      await page.goto(`/conta/documentos/recibidas/${p.otra.id}`)
      const linea = page.locator('[data-prueba="pasada-sola"]')
      await expect(linea).toContainText(`Pasada sola desde ${EMPRESA}: va a nombre de ${OTRA} (B00000000).`, { timeout: 30_000 })
      await expect(linea).toHaveAttribute('data-tono', 'ok')
      await expect(page.locator('[data-prueba="de-quien"]')).toHaveCount(0)
      await capturar(page, 'pasada-sola')
      await linea.getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.getByText(`Devuelta a ${EMPRESA} Ya no se moverá sola.`).first()).toBeVisible({ timeout: 30_000 })
      await capturar(page, 'devuelta')
      const g = await rest<{ company_id: string; recipient_answer: string }[]>(s, 'GET', `supplier_invoice?select=company_id,recipient_answer&account_id=eq.${p.cuenta}&id=eq.${p.otra.id}`)
      expect(g.datos[0]).toEqual({ company_id: p.empresa, recipient_answer: 'es_de_esta' })
      const l = await rest<{ company_id: string }[]>(s, 'GET', `document_inbox?select=company_id&account_id=eq.${p.cuenta}&supplier_invoice_id=eq.${p.otra.id}`)
      expect(l.datos[0]?.company_id, 'su llegada, de vuelta con ella').toBe(p.empresa)
    } catch (e) { await contarPantalla(page, 'pasada sola'); throw e }
  })

  test('a nombre de alguien de fuera: «Es de: [sociedad ▾]», los del IVA en hueco, y la confirmación arriba', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      await conEmpresa(page, p.cuenta, p.empresa)
      await page.goto(`/conta/documentos/recibidas/${p.fuera.id}`)
      const pregunta = page.locator('[data-prueba="de-quien"]')
      await expect(pregunta).toContainText('Esta factura va a nombre de Cliente Inventado, S.L. (F00000000)', { timeout: 30_000 })
      const selector = pregunta.locator('[data-prueba="de-quien-es"] select')
      await expect(selector).toHaveValue(p.empresa)
      // Ninguno relleno: los dos del IVA, en hueco.
      for (const n of ['Su IVA no se deduce', 'Sí es nuestra, se deduce']) await expect(pregunta.getByRole('button', { name: n })).toHaveClass(/s-boton-secundario/)
      await capturar(page, 'selector')
      await selector.selectOption(p.otra_empresa)
      const pasar = pregunta.getByRole('button', { name: /^Pasarla a Prueba Segunda Takeaway/ })
      await expect(pasar).toBeVisible()
      await capturar(page, 'selector-otra')
      await pasar.click()
      const aviso = page.getByText(`Pasada a ${OTRA}, con su PDF. Ya no está en esta lista.`).first()
      await expect(aviso).toBeVisible({ timeout: 30_000 })
      // Arriba: se ve sin bajar.
      const caja = await aviso.boundingBox()
      expect(caja, 'la confirmación, en la pantalla').not.toBeNull()
      expect(caja!.y + caja!.height, 'la confirmación se ve sin bajar').toBeLessThanOrEqual(page.viewportSize()!.height)
      await capturar(page, 'confirmacion-arriba')
      const f = await rest<{ company_id: string }[]>(s, 'GET', `supplier_invoice?select=company_id&account_id=eq.${p.cuenta}&id=eq.${p.fuera.id}`)
      expect(f.datos[0]?.company_id).toBe(p.otra_empresa)
    } catch (e) { await contarPantalla(page, 'fuera'); throw e }
  })

  test('en Inicio, cuántas ha pasado solas, y su enlace abre solo esas', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      await conEmpresa(page, p.cuenta, p.otra_empresa)
      await page.goto('/conta/inicio', { timeout: 30_000 })
      const enlace = page.locator('[data-prueba="hecho-pasadas-solas"]')
      await expect(enlace).toContainText(/pasadas? solas? a su sociedad/, { timeout: 30_000 })
      await capturar(page, 'inicio-pasadas-solas')
      await enlace.click()
      await expect(page.locator('[data-prueba="solo-pasadas"]')).toContainText('pasado sola', { timeout: 30_000 })
      await expect(page.getByText(p.otra.numero).first()).toBeVisible({ timeout: 30_000 })
      await capturar(page, 'lista-pasadas-solas')
    } catch (e) { await contarPantalla(page, 'inicio'); throw e }
  })
})
