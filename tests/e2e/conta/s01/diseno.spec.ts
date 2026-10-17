/// <reference lib="dom" />
// tests/e2e/conta/s01/diseno.spec.ts
//
// S01 · El sistema de diseño en su página (ajustes/sistema-diseno, datos
// inventados), en la cuenta A de staging-conta, en las dos marcas:
//   · Folvy sigue como estaba (el marco con el fondo de N30);
//   · Sumied pinta con sus colores (acción, fondo, letra) por los tokens;
//   · los campos: el importe y la subcuenta se escriben al salir, y lo
//     guardado que ya no se ofrece sale y lo dice (regla 30);
//   · la cinta se oculta y vuelve; el diálogo se cierra con Escape y devuelve
//     el foco; el botón principal dice lo que ha hecho (regla 8).
// Capturas en docs/conta/capturas/s01.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page, errores: string[]) {
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

const estilo = (page: Page, sel: string, prop: 'backgroundColor' | 'fontFamily' | 'color') =>
  page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

test('el sistema de diseño en Folvy: el marco no cambia de color', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/sistema-diseno')
  await expect(page.getByRole('heading', { level: 1, name: 'Sistema de diseño' })).toBeVisible()
  // El fondo de N30, el de antes del S01: los --cxm-* son alias con los mismos valores.
  expect(await estilo(page, '.cxm', 'backgroundColor')).toBe('rgb(238, 241, 245)')
  expect(await estilo(page, '.s-boton-principal', 'backgroundColor')).toBe('rgb(47, 91, 255)')
  await capturar(page, 'sistema-folvy')
  expect(errores).toEqual([])
})

test('el sistema de diseño en Sumied: colores por tokens, campos, cinta y diálogo', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/sistema-diseno?marca=sumied')
  await expect(page.getByRole('heading', { level: 1, name: 'Sistema de diseño' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // La marca, por los tokens: acción #1E63C9, fondo #F4F7FB, Inter.
  expect(await estilo(page, '.s-boton-principal', 'backgroundColor')).toBe('rgb(30, 99, 201)')
  expect(await estilo(page, '.cxm', 'backgroundColor')).toBe('rgb(244, 247, 251)')
  expect(await estilo(page, '.s-raiz', 'fontFamily')).toMatch(/^"?Inter Variable"?/)
  expect(await estilo(page, '.s-chip[data-tono="duda"]', 'color')).toBe('rgb(122, 74, 0)')

  // Los campos.
  const base = page.getByLabel('Base', { exact: true })
  await base.fill('1234.5')
  await base.blur()
  await expect(base).toHaveValue('1.234,50')
  const pago = page.getByLabel('Cuenta de pago', { exact: true })
  await expect(page.getByRole('alert').filter({ hasText: 'Falta la cuenta de pago' })).toHaveText('Falta la cuenta de pago: escribe «57.1» y sale 57000001.')
  await pago.fill('57.1')
  await pago.blur()
  await expect(pago).toHaveValue('57000001')
  await expect(pago).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Local', { exact: true }).locator('option:checked')).toHaveText('Local 9 (cerrado) (ya no se ofrece)')
  await expect(page.getByLabel('Fecha factura', { exact: true })).toHaveValue('16/10/2026')

  // El botón principal dice lo que ha hecho (regla 8).
  await page.getByRole('button', { name: 'Validar y siguiente' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Validada' })).toHaveText('Validada (de muestra: no se escribe nada).')

  await capturar(page, 'sistema-sumied')

  // La cinta: se oculta, queda «Mostrar la cinta», y vuelve.
  const cinta = page.getByRole('toolbar', { name: 'Acciones de Asientos' })
  await expect(cinta.getByRole('group', { name: 'Nuevo' }).getByRole('button')).toHaveText(['Expedida', 'Recibida', 'Tesorería', 'General', 'Predefinidos'])
  await cinta.getByRole('button', { name: 'Ocultar' }).click()
  await expect(cinta).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar la cinta' }).click()
  await expect(page.getByRole('toolbar', { name: 'Acciones de Asientos' })).toBeVisible()

  // El diálogo: Escape lo cierra y el foco vuelve al botón que lo abrió.
  const abrir = page.getByRole('region', { name: 'Para revisar · 12' }).getByRole('button', { name: 'Validar los 9 seguros' })
  await abrir.click()
  const dialogo = page.getByRole('dialog', { name: 'Validar los 9 seguros' })
  await expect(dialogo).toBeVisible()
  await capturar(page, 'sistema-sumied-dialogo')
  await page.keyboard.press('Escape')
  await expect(dialogo).toHaveCount(0)
  await expect(abrir).toBeFocused()
  await abrir.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Validar 9' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Validados' })).toHaveText('Validados 9 asientos; quedan 3 para revisar (de muestra: no se escribe nada).')

  expect(errores).toEqual([])
})
