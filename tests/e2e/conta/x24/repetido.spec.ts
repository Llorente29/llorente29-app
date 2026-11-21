/// <reference lib="dom" />
// tests/e2e/conta/x24/repetido.spec.ts — X24 · Un proveedor nunca se da de alta dos veces, contra staging, a 1456 × 816
// y a 1366 × 768, en la gestoría de ejemplo del núcleo (semilla K04):
//   en una recibida a mano, «+ Nuevo proveedor» con el NIF del «Proveedor de Prueba Ficha Uno» (B00000000) escrito
//   con guion («B-00000000») y otro nombre. No se da de alta: «Mira esto · Ya tienes a … con este NIF. Abrirlo», en
//   ámbar, como la repetida del K09; y «Abrirlo» abre su ficha. Nada se guarda.
// NIF todo ceros y nombres inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x24'
const PROVEEDOR = () => enCarril('c0e40000-0000-4000-8000-0000000000a1')
const NOMBRE = 'Proveedor de Prueba Ficha Uno, S.L.'
const ficha = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-recibida-nucleo"]')

async function rest<T>(s: Sesion, ruta: string): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })
  const texto = await r.text()
  expect(r.status, `GET ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return JSON.parse(texto) as T
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X24 · ${ancho} × ${alto}: dar de alta a mano un proveedor con el NIF de otro, con guion: «Ya tienes a…» y «Abrirlo»`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(150_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const [yaEsta] = await rest<{ id: string; tax_id: string; name: string }[]>(s, `supplier?select=id,tax_id,name&account_id=eq.${NUCLEO.id}&id=eq.${PROVEEDOR()}`)
    expect(yaEsta, 'el proveedor de la semilla K04').toMatchObject({ tax_id: 'B00000000', name: NOMBRE })
    const antes = (await rest<{ id: string }[]>(s, `supplier?select=id&account_id=eq.${NUCLEO.id}`)).length

    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await ficha(page).locator('[data-prueba="nuevo-proveedor"]').click()
    await ficha(page).locator('#kf-nif').fill('B-00000000')
    await ficha(page).locator('#kf-nombre').fill('Otro Proveedor Inventado X24')
    await ficha(page).locator('#kf-nombre').press('Enter')
    const frase = ficha(page).locator('[data-prueba="nif-repetido"]')
    // Si en el carril está archivado, lo dice («(archivado)»): la base cuenta también los archivados.
    await expect(frase).toHaveText(new RegExp(`^Mira esto · Ya tienes a ${NOMBRE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(archivado\\))? con este NIF\\. Abrirlo$`), { timeout: 30_000 })
    console.log(`[X24] ${await frase.textContent()}`)
    await expect(frase).toHaveAttribute('data-tono', 'falta')
    await expect(ficha(page).locator('.kf-error')).toHaveCount(0)
    const cabe = await frase.evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1)
    expect(cabe, `la frase cabe a ${ancho}`).toBe(true)
    await page.screenshot({ path: `${DIR}/ya-tienes-${ancho}.png` })
    expect((await rest<{ id: string }[]>(s, `supplier?select=id&account_id=eq.${NUCLEO.id}`)).length, 'no se ha dado de alta ninguno').toBe(antes)

    await frase.getByRole('link', { name: 'Abrirlo' }).click()
    await expect(page).toHaveURL(new RegExp(`/proveedor/${PROVEEDOR()}|/proveedores/${PROVEEDOR()}`), { timeout: 30_000 })
    await expect(page.getByText(NOMBRE).first()).toBeVisible({ timeout: 30_000 })
    expect(errores).toEqual([])
  })
}
