// tests/e2e/conta/dm1/superadministrador.spec.ts
//
// DM1 · PR 1c (31/10/2026) · El superadministrador, gestionando una cuenta con
// la contabilidad encendida, la ve (el gate de la #406: lee los interruptores
// de la cuenta que gestiona, no los de su perfil). En staging, con el gancho
// del token activado (Julio, 31/10) y su perfil en «Plataforma de Prueba», una
// cuenta interna inventada sin interruptores
// (seed_dm1_plataforma_staging.sql).
//   1. Entra en su cuenta: «Folvy Conta» no sale (su cuenta no la tiene).
//   2. «Cambiar de cliente» → la A de su carril (Taberna de Prueba Norte, con
//      contabilidad): el gate lee los interruptores de A y «Folvy Conta» sale.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, enCarril, entrarComo } from '../sesion'

const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const SU_CUENTA = enCarril('c0600000-0000-4000-8000-0000000000f1')

function interruptoresDe(page: Page, cuenta: string) {
  return page.waitForResponse((r) => r.url().includes('/rest/v1/feature_flags') && r.url().includes(`account_id=eq.${cuenta}`) && r.ok(), { timeout: 30_000 })
}

test('el superadministrador, gestionando una cuenta con la contabilidad encendida, la ve', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El selector de cliente de la barra es de ordenador')
  test.setTimeout(120_000)
  await entrarComo(page, PLATAFORMA)
  const deLaSuya = interruptoresDe(page, SU_CUENTA)
  await page.goto('/', { timeout: 30_000 })
  await deLaSuya

  const conta = page.locator('nav').getByRole('button', { name: 'Folvy Conta' })
  await expect(page.getByRole('button', { name: /Plataforma de Prueba/ }).first()).toBeVisible({ timeout: 30_000 })
  await expect(conta).toHaveCount(0)

  await page.getByRole('button', { name: /Plataforma de Prueba/ }).first().click()
  await expect(page.getByText('Cambiar de cliente')).toBeVisible()
  const deA = interruptoresDe(page, CUENTA_A.id)
  await page.locator(`[data-cuenta="${CUENTA_A.id}"]`).click()
  await deA
  await expect(page.getByRole('button', { name: /Taberna de Prueba Norte/ }).first()).toBeVisible({ timeout: 30_000 })
  await expect(conta).toBeVisible({ timeout: 30_000 })
})
