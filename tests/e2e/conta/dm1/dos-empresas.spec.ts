// tests/e2e/conta/dm1/dos-empresas.spec.ts
//
// DM1 · PR 1b (30/10/2026) · El gate de la empresa abierta, en staging. Una
// persona inventada administradora de A (Taberna de Prueba Norte, con la
// contabilidad encendida) y de B (Cocina de Prueba Sur, sin ella): semilla
// supabase/seeds/conta/seed_dm1_dos_empresas_staging.sql.
//   1. Entra con A abierta (la más antigua: _cuenta_activa de la 1950) y la
//      barra de Folvy enseña «Folvy Conta». Antes del arreglo, el gate leía «su
//      perfil» con maybeSingle: con dos, fallaba y no salía ningún módulo con
//      interruptor.
//   2. Cambia a B en el selector de empresa: la aplicación se recarga, la
//      barra dice B y «Folvy Conta» ya no sale.
//   3. Vuelve a A, y vuelve a salir (la deja como estaba para la siguiente).
// El superadministrador no tiene e2e todavía: en staging-conta el hook de los
// claims no está activado y no puede abrir la aplicación. Lo prueba
// tests/unit/platform/featureGateCuentaAbierta.test.ts con la base simulada.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, DOS_EMPRESAS, entrarComo } from '../sesion'

const NOMBRE_A = 'Taberna de Prueba Norte'
const NOMBRE_B = 'Cocina de Prueba Sur'

/** Espera a que el gate lea los interruptores de esa cuenta (y de ninguna otra a la vez). */
function interruptoresDe(page: Page, cuenta: string) {
  return page.waitForResponse((r) => r.url().includes('/rest/v1/feature_flags') && r.url().includes(`account_id=eq.${cuenta}`) && r.ok(), { timeout: 30_000 })
}

async function cambiarA(page: Page, nombre: string, cuenta: string) {
  await page.getByRole('button', { name: new RegExp(nombre === NOMBRE_A ? NOMBRE_B : NOMBRE_A) }).first().click()
  await expect(page.getByText('Cambiar de empresa')).toBeVisible()
  const leidos = interruptoresDe(page, cuenta)
  await page.getByRole('button', { name: new RegExp(`^${nombre}`) }).click()
  await leidos
}

test('una persona en dos empresas ve los módulos de la abierta, y al cambiar de empresa cambian', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El selector de empresa de la barra es de ordenador')
  test.setTimeout(120_000)
  await entrarComo(page, DOS_EMPRESAS.email)
  // Como quien ya entró antes: el navegador recuerda la abierta. Solo la
  // primera vez; después, la que deje cambiar_empresa.
  await page.addInitScript(([k, v]) => { if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v) },
    ['andy-app-active-account', CUENTA_A.id] as const)
  const deA = interruptoresDe(page, CUENTA_A.id)
  await page.goto('/', { timeout: 30_000 })
  await deA

  const conta = page.locator('nav').getByRole('button', { name: 'Folvy Conta' })
  await expect(page.getByRole('button', { name: new RegExp(NOMBRE_A) }).first()).toBeVisible({ timeout: 30_000 })
  await expect(conta).toBeVisible({ timeout: 30_000 })

  // Después de recargar, el gate ha leído los de B (interruptoresDe): sin contabilidad.
  await cambiarA(page, NOMBRE_B, CUENTA_B.id)
  await expect(page.getByRole('button', { name: new RegExp(NOMBRE_B) }).first()).toBeVisible({ timeout: 30_000 })
  await expect(conta).toHaveCount(0)

  await cambiarA(page, NOMBRE_A, CUENTA_A.id)
  await expect(page.getByRole('button', { name: new RegExp(NOMBRE_A) }).first()).toBeVisible({ timeout: 30_000 })
  await expect(conta).toBeVisible({ timeout: 30_000 })
})
