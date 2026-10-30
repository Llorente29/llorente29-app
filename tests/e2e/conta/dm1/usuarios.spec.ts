// tests/e2e/conta/dm1/usuarios.spec.ts
//
// DM1 · PR 1 (30/10/2026) · Ajustes › Usuarios y el selector de empresa, en
// staging (cuentas inventadas). Lo de dos cuentas a la vez (ve solo la
// abierta, al leer y al escribir) lo prueba la de staging en SQL
// (supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql) y el caso real.
//   1. El administrador de A abre Ajustes › Usuarios: «Quién entra» con sus
//      usuarios y «Invitar a una persona» con su empresa marcada y el permiso.
//      Sin correo, el botón lo dice en palabras y no manda nada (regla 8).
//   2. Con una sola cuenta, el botón de empresa enseña su lista de siempre: la
//      de varias cuentas no sale.
// No invita a nadie de verdad: en staging la marca de pruebas no tiene remitente.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

test('Ajustes › Usuarios: quién entra e «Invitar a una persona»; con una cuenta, el selector de siempre', async ({ page }) => {
  test.setTimeout(90_000)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/personas?marca=sumied', { timeout: 30_000 })

  const usuarios = page.locator('[data-prueba="ajustes-usuarios"]')
  await expect(usuarios).toContainText('Quién entra', { timeout: 30_000 })
  await expect(usuarios).toContainText(/\d+ con acceso/)

  const invitar = page.locator('[data-prueba="invitar-persona"]')
  await expect(invitar).toContainText('Invitar a una persona')
  await expect(invitar).toContainText('Solo salen las empresas en las que tú eres administrador.')
  // Su empresa, marcada de entrada (mis_empresas, de la 1950).
  await expect(invitar.locator('[data-prueba="invitar-empresa"]').first()).toBeChecked({ timeout: 30_000 })

  // Sin correo: lo dice y no manda nada.
  await invitar.locator('[data-prueba="invitar-enviar"]').click()
  await expect(invitar.getByRole('alert')).toHaveText('Escribe el correo de la persona.')

  // Con una sola cuenta, la lista de varias empresas no sale.
  await page.locator('.s-empresa').first().click()
  await expect(page.locator('.s-menu-empresas')).toBeVisible()
  await expect(page.locator('[data-prueba="varias-empresas"]')).toHaveCount(0)
})
