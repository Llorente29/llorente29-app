// tests/e2e/conta/dm1/alta-no-encierra.spec.ts
//
// DM1 (31/10/2026) · El alta no encierra. Una persona inventada con dos
// empresas: «Obrador de Prueba Vacío», sin sociedad, la que tiene abierta la
// base, y A (Taberna de Prueba Norte), con las suyas
// (seed_dm1_alta_no_encierra_staging.sql).
//   1. Entra en contabilidad: sin sociedad, Inicio la manda al alta a pantalla
//      completa. Arriba, «Cambiar de empresa».
//   2. El selector es el de la cabecera: sus empresas, agrupadas por cuenta.
//      Elige una de A: se abre A en la base y sale del alta a su Inicio.
//   3. Al acabar, la deja abierta en la vacía, como estaba.

import { test, expect } from '@playwright/test'
import { ALTA_DOS, CUENTA_A, CUENTA_VACIA, STAGING_URL, anonKey, entrarComo, pedirSesion } from '../sesion'

async function rpc(nombre: string, cuerpo: Record<string, unknown> = {}): Promise<unknown> {
  const s = await pedirSesion(ALTA_DOS.email)
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  expect(r.ok, `${nombre}: HTTP ${r.status}`).toBe(true)
  return r.json()
}

test('con una empresa sin sociedad, el alta deja salir a la otra con «Cambiar de empresa»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Basta un tamaño: el botón es el mismo en el móvil')
  test.setTimeout(120_000)
  await rpc('cambiar_empresa', { p_account_id: CUENTA_VACIA })
  try {
    await entrarComo(page, ALTA_DOS.email)
    await page.goto('/conta/inicio', { timeout: 30_000 })
    await expect(page).toHaveURL(/\/conta\/alta/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Cuéntame tu negocio y lo dejo montado.' })).toBeVisible({ timeout: 30_000 })

    const cambiar = page.locator('[data-prueba="alta-cambiar-empresa"]')
    await expect(cambiar).toHaveText('Cambiar de empresa')
    await cambiar.click()
    const varias = page.locator('[data-prueba="varias-empresas"]')
    await expect(varias).toBeVisible()
    // La vacía, abierta; A, con sus sociedades debajo de su nombre.
    await expect(varias.getByRole('button', { name: /Obrador de Prueba Vacío/ })).toHaveAttribute('aria-current', 'true')
    await varias.getByRole('group', { name: 'Taberna de Prueba Norte' }).locator('[data-prueba="empresa-fila"]').first().click()

    await expect(page).not.toHaveURL(/\/conta\/alta/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Cuéntame tu negocio y lo dejo montado.' })).toHaveCount(0)
    expect(await rpc('_cuenta_activa')).toBe(CUENTA_A.id)
  } finally {
    await rpc('cambiar_empresa', { p_account_id: CUENTA_VACIA })
  }
})
