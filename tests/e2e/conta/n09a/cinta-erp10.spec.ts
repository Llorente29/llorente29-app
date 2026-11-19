// tests/e2e/conta/n09a/cinta-erp10.spec.ts
//
// N09a · ERP10 en Importaciones (respuesta N09 · 0, 19/11). «Traer de ERP10» (N07) y «Salida a ERP10»
// (X04) existían y no tenían botón en la cinta del núcleo (regla 7). En staging, con la cuenta del
// núcleo (semilla del K02) y su empresa general, a 1456 × 816:
//   · con la salida apagada, Importaciones › ERP10 tiene «Traer de ERP10», que abre su pantalla en su
//     pestaña de trabajo, y no tiene «Salida a ERP10»;
//   · con la salida encendida (por su función, conta_erp10_salida_poner, como el administrador),
//     «Salida a ERP10» sale y abre la suya. Al acabar se apaga.

import { test, expect, type Page } from '@playwright/test'
import { entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, EMPRESA, NUCLEO } from '../k02/comun'

async function empresaGeneral(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${NUCLEO.id}&legal_name=eq.${encodeURIComponent(EMPRESA)}`)
  expect(r.status, `leer la empresa general del núcleo: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(200)
  expect(r.datos, `la empresa «${EMPRESA}» está en la cuenta del núcleo`).toHaveLength(1)
  return r.datos[0].id
}

async function salida(s: Sesion, empresa: string, encender: boolean) {
  const r = await rest<{ texto: string }>(s, 'POST', 'rpc/conta_erp10_salida_poner', {
    p_company: empresa, p_encender: encender, p_codigo: encender ? '0091' : null, p_largo: encender ? 8 : null, p_desde: null, p_quien_nombre: 'Prueba e2e N09a',
  })
  expect(r.status, `${encender ? 'encender' : 'apagar'} la salida a ERP10: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
}

async function importaciones(page: Page) {
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  const ver = page.getByRole('button', { name: 'Ver los botones' })
  if (await ver.isVisible()) await ver.click()
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Importaciones' }).click()
  await expect(page.locator('[data-boton="documentos"]')).toBeVisible()
}

/** Pulsa el botón y comprueba que abre su pantalla, en su pestaña de trabajo, con el botón marcado. */
async function abre(page: Page, id: string, nombre: string) {
  await page.locator(`[data-boton="${id}"]`).click()
  await expect(page.getByRole('tab', { name: nombre, exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  await expect(page.locator('.k-zona[data-activa="si"]').getByRole('heading', { name: nombre, level: 1 })).toBeVisible({ timeout: 40_000 })
  await expect(page.locator(`[data-boton="${id}"]`)).toHaveAttribute('aria-current', 'page')
}

test('N09a · Importaciones › ERP10: «Traer de ERP10» siempre; «Salida a ERP10», con la salida encendida', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
  test.setTimeout(240_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await empresaGeneral(s)
  try {
    await salida(s, empresa, false)
    await importaciones(page)
    await expect(page.locator('[data-boton="salidaErp10"]')).toHaveCount(0)
    await abre(page, 'traerErp10', 'Traer de ERP10')

    await salida(s, empresa, true)
    await importaciones(page)
    await abre(page, 'salidaErp10', 'Salida a ERP10')
  } finally {
    await salida(s, empresa, false)
  }
  expect(errores).toEqual([])
})
