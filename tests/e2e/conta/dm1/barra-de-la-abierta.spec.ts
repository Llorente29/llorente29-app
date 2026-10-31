// tests/e2e/conta/dm1/barra-de-la-abierta.spec.ts
//
// DM1 · PR 1c (31/10/2026) · La barra enseña la empresa que tiene abierta la
// base, en staging. La persona inventada de dos empresas (A, Taberna de Prueba
// Norte, y B, Cocina de Prueba Sur: seed_dm1_dos_empresas_staging.sql).
//   1. Con un navegador limpio, la barra dice la misma empresa que la base
//      (_cuenta_activa, preguntada con su sesión). Antes, AppContext elegía
//      por la URL, el navegador o la primera por nombre (B va antes que A).
//   2. Cambia a la otra y cierra el navegador. Al volver a abrirlo (un
//      contexto nuevo, sin nada guardado) sigue viendo la que dejó, y la base
//      dice la misma.
//   3. Al acabar, la deja abierta en A, como estaba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, DOS_EMPRESAS, STAGING_URL, anonKey, entrarComo, pedirSesion } from '../sesion'

const NOMBRES: Record<string, string> = { [CUENTA_A.id]: 'Taberna de Prueba Norte', [CUENTA_B.id]: 'Cocina de Prueba Sur' }

/** La empresa abierta según la base, con la sesión de la persona. */
async function abiertaEnLaBase(): Promise<string> {
  const s = await pedirSesion(DOS_EMPRESAS.email)
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/_cuenta_activa`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: '{}',
  })
  expect(r.ok).toBe(true)
  return await r.json() as string
}

async function abrirEnLaBase(cuenta: string): Promise<void> {
  const s = await pedirSesion(DOS_EMPRESAS.email)
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/cambiar_empresa`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_account_id: cuenta }),
  })
  expect(r.ok).toBe(true)
}

/** El botón de empresa de la barra (el que abre el selector) dice este nombre. */
async function barraDice(page: Page, nombre: string) {
  await expect(page.getByRole('button', { name: new RegExp(nombre) }).first()).toBeVisible({ timeout: 30_000 })
}

test('la barra dice la empresa que tiene abierta la base, también al cambiar y volver a abrir', async ({ browser }, info) => {
  test.skip(info.project.name === 'movil', 'El selector de empresa de la barra es de ordenador')
  test.setTimeout(150_000)
  // De partida, A abierta en la base. La primera por nombre sería B (Cocina va
  // antes que Taberna): si la barra eligiera por nombre, diría B.
  await abrirEnLaBase(CUENTA_A.id)

  // 1. Navegador limpio.
  const primero = await browser.newContext()
  const page = await primero.newPage()
  await entrarComo(page, DOS_EMPRESAS.email)
  await page.goto('/', { timeout: 30_000 })
  const base1 = await abiertaEnLaBase()
  expect(base1).toBe(CUENTA_A.id)
  await barraDice(page, NOMBRES[base1])
  await expect(page.getByRole('button', { name: new RegExp(NOMBRES[CUENTA_B.id]) })).toHaveCount(0)

  // 2. Cambia a B en el selector, y cierra.
  await page.getByRole('button', { name: new RegExp(NOMBRES[CUENTA_A.id]) }).first().click()
  await expect(page.getByText('Cambiar de empresa')).toBeVisible()
  await page.locator(`[data-cuenta="${CUENTA_B.id}"]`).click()
  await barraDice(page, NOMBRES[CUENTA_B.id])
  expect(await abiertaEnLaBase()).toBe(CUENTA_B.id)
  await primero.close()

  // 3. Vuelve a abrir: otro navegador, sin nada guardado. Sigue en B.
  const segundo = await browser.newContext()
  const otra = await segundo.newPage()
  await entrarComo(otra, DOS_EMPRESAS.email)
  await otra.goto('/', { timeout: 30_000 })
  await barraDice(otra, NOMBRES[CUENTA_B.id])
  expect(await abiertaEnLaBase()).toBe(CUENTA_B.id)
  await segundo.close()

  // Como estaba.
  await abrirEnLaBase(CUENTA_A.id)
})
