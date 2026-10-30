// tests/e2e/laboral/l1ah-firma-interruptor.spec.ts
//
// L1a-H (29/10/2026) · La firma del registro, solo cuando la empresa la
// encienda. En la cuenta A de staging (inventada):
//   1. Laboral › Registro de jornada enseña el interruptor «Pedir a cada
//      persona que firme su registro del mes», con su frase; el administrador
//      lo enciende y lo apaga, y cada vez la pantalla dice qué ha hecho
//      (regla 8). Recargando, sigue como se dejó.
//   2. El portal del trabajador, con el interruptor apagado, no pide la firma
//      (ni la tarjeta, ni la lectura de sus firmas); encendido, sí la busca.
//      Que la TARJETA salga depende de que tenga marcas del mes pasado sin
//      firmar en staging; si sale, se comprueba su texto.
// Al acabar, la cuenta A se queda apagada, como estaba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')

async function poner(pedir: boolean) {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest(s, 'POST', 'rpc/firma_registro_mes_pedir', { p_account_id: CUENTA_A.id, p_pedir: pedir })
  if (r.status !== 200) throw new Error(`No se ha podido ${pedir ? 'encender' : 'apagar'} la firma de la cuenta A: ${r.status} ${JSON.stringify(r.datos)}`)
}

/** Abre el portal y espera a que lea si la empresa pide la firma. Devuelve si leyó las firmas. */
async function portal(page: Page): Promise<boolean> {
  let leeFirmas = false
  page.on('request', (r) => { if (r.url().includes('/rest/v1/registro_jornada_firma')) leeFirmas = true })
  const leida = page.waitForResponse((r) => r.url().includes('/rest/v1/accounts') && r.url().includes('firma_registro_mes'), { timeout: 30_000 })
  await page.goto('/')
  await leida
  await expect(page.getByRole('button', { name: /^Fichar (entrada|salida)/ })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2_000)
  return leeFirmas
}

test('la firma del registro solo sale cuando la empresa la enciende', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await poner(false)
  try {
    // 1 · El interruptor, en Registro de jornada.
    await entrarComo(page, CUENTA_A.email)
    await page.goto('/personal/registro-jornada', { timeout: 30_000 })
    const tarjeta = page.locator('[data-prueba="firma-interruptor"]')
    await expect(tarjeta).toContainText('Pedir a cada persona que firme su registro del mes', { timeout: 30_000 })
    await expect(tarjeta).toContainText('Cada mes, cada persona revisa y firma sus horas en su portal. Enciéndelo cuando las horas estén al día.')
    const boton = page.locator('[data-prueba="firma-interruptor-boton"]')
    await expect(boton).toHaveAttribute('aria-checked', 'false')
    await expect(boton).toBeEnabled({ timeout: 15_000 })

    await boton.click()
    await expect(page.locator('[data-prueba="firma-interruptor-hecho"]')).toContainText(/^Encendido(: desde ahora|, pero)/, { timeout: 15_000 })
    await expect(boton).toHaveAttribute('aria-checked', 'true')
    await page.reload()
    await expect(page.locator('[data-prueba="firma-interruptor-boton"]')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 })

    await page.locator('[data-prueba="firma-interruptor-boton"]').click()
    await expect(page.locator('[data-prueba="firma-interruptor-hecho"]'))
      .toHaveText('Apagado: nadie ve ya en su portal la firma del registro. Las firmas que ya se hicieron se conservan.', { timeout: 15_000 })

    // 2 · El portal del trabajador: apagado, nada de la firma.
    const ctx = await browser.newContext()
    const trabajador = await ctx.newPage()
    await entrarComo(trabajador, TRABAJADOR)
    expect(await portal(trabajador), 'Con la firma apagada, el portal no tiene que leer las firmas').toBe(false)
    await expect(trabajador.locator('[data-prueba="firma-del-mes"]')).toHaveCount(0)

    // Encendida: el portal la busca, y si hay mes que firmar, la pide.
    await poner(true)
    expect(await portal(trabajador), 'Con la firma encendida, el portal tiene que buscarla').toBe(true)
    const firma = trabajador.locator('[data-prueba="firma-del-mes"]')
    if (await firma.count()) await expect(firma).toContainText(/Firma tu registro de|vuelve a firmarlo|Tu registro de/)
    await ctx.close()
  } finally {
    await poner(false)
  }
})
