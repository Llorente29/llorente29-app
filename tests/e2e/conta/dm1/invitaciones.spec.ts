// tests/e2e/conta/dm1/invitaciones.spec.ts
//
// DM1 · Accesos 1 (03/11/2026) · Invitar, aceptar y quitar, en staging, con
// las pantallas de los tableros 5 a 8 (aprobados por Julio el 03/11). Correos
// inventados (T11): la persona nueva lleva un sello de tiempo para no chocar
// con otra pasada; la que ya tiene usuario es el administrador de B.
// Fuera de producción, invitar-persona devuelve el enlace en la respuesta y
// la pantalla lo enseña («solo fuera de producción»): así se sigue sin correo.
//   1. El administrador de A invita a una persona nueva a A como Encargado.
//      Sale la confirmación con contenido y la invitación en «Pendientes».
//      Con el enlace, sin sesión, la persona ve A y su permiso, pone su
//      contraseña, acepta los términos y entra. Ya no está pendiente: sale en
//      «Con acceso». El administrador le quita el acceso, con su diálogo.
//   2. Invita al administrador de B (ya tiene usuario) a A como Encargado. Él
//      entra con lo suyo: el botón de empresa dice «1 invitación»; acepta y A
//      entra en su lista. Después el administrador de A le quita el acceso.
//   3. Anular: una invitación anulada desaparece de «Pendientes» y su enlace
//      ya no vale.
// Las capturas, en ordenador y en móvil, al lado de los tableros:
// docs/conta/capturas/dm1/accesos-*.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/dm1'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = async (page: Page, nombre: string) => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/accesos-${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
}

const USUARIOS = '/conta/ajustes/personas?marca=sumied'
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

/** Como el administrador de A: invita a `correo` a A como Encargado y devuelve el enlace. */
async function invitarDesdeA(page: Page, correo: string): Promise<string> {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(USUARIOS, { timeout: 30_000 })
  const invitar = page.locator('[data-prueba="invitar-persona"]')
  await expect(invitar.locator('[data-prueba="invitar-empresa"]').first()).toBeChecked({ timeout: 30_000 })
  await invitar.locator('[data-prueba="invitar-correo"]').fill(correo)
  await invitar.getByRole('combobox').first().selectOption('manager')
  await invitar.locator('[data-prueba="invitar-enviar"]').click()
  const hecho = page.locator('[data-prueba="accesos-hecho"]')
  await expect(hecho).toContainText(correo, { timeout: 30_000 })
  await expect(hecho).toContainText('(Encargado)')
  await expect(page.locator('[data-prueba="accesos-pendientes"]')).toContainText(correo, { timeout: 30_000 })
  const enlace = await invitar.getByRole('link', { name: 'entrar' }).getAttribute('href')
  expect(enlace, 'fuera de producción, el enlace va en la respuesta').toBeTruthy()
  return enlace as string
}

/** Como el administrador de A: quita el acceso a quien diga, con su diálogo. */
async function quitarDesdeA(page: Page, correo: string) {
  await page.goto(USUARIOS, { timeout: 30_000 })
  const fila = page.locator('[data-prueba="accesos-con-acceso"] li', { hasText: correo })
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await fila.locator('[data-prueba="accesos-quitar"]').click()
  await expect(page.getByRole('dialog')).toContainText('¿Quitar el acceso a')
  await foto(page, '6-quitar')
  await page.locator('[data-prueba="quitar-confirmar"]').click()
  await expect(page.locator('[data-prueba="accesos-hecho"]')).toContainText('Acceso quitado', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="accesos-con-acceso"]')).not.toContainText(correo)
}

test('invitar a una persona nueva: pone su contraseña, entra, sale en «Con acceso» y se le quita', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const correo = `invitada.${sello()}@example.invalid`
  const enlace = await invitarDesdeA(page, correo)
  await foto(page, '5-usuarios')

  // La persona, sin sesión, en otro navegador.
  const otro = await browser.newContext({ viewport: page.viewportSize() ?? undefined })
  const ella = await otro.newPage()
  await ella.goto(enlace, { timeout: 30_000 })
  const aceptar = ella.locator('[data-prueba="aceptar-invitacion"]')
  await expect(aceptar.locator('[data-prueba="invitacion-empresas"]')).toContainText('Encargado', { timeout: 30_000 })
  await expect(aceptar).toContainText(correo)
  await foto(ella, '8-enlace')
  await ella.locator('[data-prueba="invitacion-clave"]').fill('Prueba1234')
  await ella.locator('[data-prueba="invitacion-repetida"]').fill('Prueba1234')
  await ella.locator('[data-prueba="invitacion-acepto"]').check()
  await ella.locator('[data-prueba="invitacion-crear"]').click()
  await ella.waitForURL((u) => !u.searchParams.has('invitacion'), { timeout: 30_000 })
  await otro.close()

  // Ya no está pendiente, y entra.
  await page.goto(USUARIOS, { timeout: 30_000 })
  await expect(page.locator('[data-prueba="accesos-con-acceso"]')).toContainText(correo, { timeout: 30_000 })
  await expect(page.locator('[data-prueba="accesos-pendientes"]')).not.toContainText(correo)
  await quitarDesdeA(page, correo)
})

test('invitar a quien ya tiene usuario: lo ve en el selector de empresa, acepta y entra', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await invitarDesdeA(page, CUENTA_B.email)

  const otro = await browser.newContext({ viewport: page.viewportSize() ?? undefined })
  const el = await otro.newPage()
  await entrarComo(el, CUENTA_B.email)
  await el.goto('/conta?marca=sumied', { timeout: 30_000 })
  await expect(el.locator('[data-prueba="empresa-invitaciones"]')).toHaveText('1 invitación', { timeout: 30_000 })
  await el.locator('.s-empresa').first().click()
  const mias = el.locator('[data-prueba="mis-invitaciones"]')
  await expect(mias).toContainText('Te invitan a')
  await expect(mias).toContainText('Encargado')
  await foto(el, '7-selector')
  await mias.locator('[data-prueba="invitacion-aceptar"]').click()
  await expect(el.locator('[data-prueba="invitacion-aceptada"]')).toContainText('Ya entras en', { timeout: 30_000 })
  await el.waitForLoadState('load')
  await el.locator('.s-empresa').first().click()
  await expect(el.locator('[data-prueba="varias-empresas"]')).toBeVisible({ timeout: 30_000 })
  await otro.close()

  await quitarDesdeA(page, CUENTA_B.email)
})

test('anular: la invitación sale de «Pendientes» y su enlace ya no vale', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const correo = `anulada.${sello()}@example.invalid`
  const enlace = await invitarDesdeA(page, correo)
  const fila = page.locator('[data-prueba="accesos-pendientes"] li', { hasText: correo })
  await fila.locator('[data-prueba="pendiente-anular"]').click()
  await expect(page.locator('[data-prueba="accesos-hecho"]')).toContainText('Invitación anulada', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="accesos-pendientes"]')).not.toContainText(correo)

  const otro = await browser.newContext()
  const ella = await otro.newPage()
  await ella.goto(enlace, { timeout: 30_000 })
  await expect(ella.locator('[data-prueba="invitacion-no-vale"]')).toContainText('ya no vale', { timeout: 30_000 })
  await otro.close()
})
