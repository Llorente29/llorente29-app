/// <reference lib="dom" />
// tests/e2e/conta/q05/pantallas-nuevas.spec.ts
//
// Q05 (Julio, 18/11) · «Pantallas nuevas (en pruebas)» en la ficha de la cuenta (administración de
// la plataforma): el cuarto interruptor, conta_nucleo, al lado de Contabilidad, Impuestos y Laboral.
//
// Las dos llamadas de la ficha van con datos inventados (page.route), como en la S01f: desde la rama,
// la 20261118T2029 (las dos funciones con conta_nucleo) solo pasa por staging en ROLLBACK. El camino
// de verdad de la base lo prueban supabase/staging/sql/20261118_q05_interruptor_nucleo_prueba.sql y
// el ensayo de producción. Lo que SÍ es de verdad: al encender y al apagar, la fila conta_nucleo de la
// cuenta A del carril (una copia que se borra al acabar), escrita por la plataforma como hace la V04;
// y con ella, lo que ve quien entra en esa cuenta: el marco del núcleo encendido, el de hoy apagado.
// Solo en el ordenador: el marco del núcleo no sale en el móvil. A 1456 × 816, con sus capturas.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion } from '../sesion'

const DIR = 'docs/conta/capturas/q05'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}.png`, fullPage: true })
}

/** La fila de verdad del carril: la plataforma enciende o apaga conta_nucleo en la cuenta A. */
async function nucleoDeVerdad(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_nucleo', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e Q05 Pantallas nuevas (carril)' : 'e2e Q05 Pantallas nuevas (carril): se apaga' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}

type Estado = { encendida: boolean; cambiada: string | null; quien: string | null; motivo: string | null }
const CLAVES = ['conta', 'conta_impuestos', 'conta_laboral', 'conta_nucleo'] as const

/** Los cuatro interruptores, en memoria: lo que la base devolverá con la 2029. Encender o apagar el núcleo escribe además la fila de verdad. */
function conBaseInventada(page: Page, contaEncendida: boolean) {
  const estado: Record<(typeof CLAVES)[number], Estado> = {
    conta: { encendida: contaEncendida, cambiada: '2026-10-06T09:00:00Z', quien: null, motivo: null },
    conta_impuestos: { encendida: false, cambiada: null, quien: null, motivo: null },
    conta_laboral: { encendida: false, cambiada: null, quien: null, motivo: null },
    conta_nucleo: { encendida: false, cambiada: null, quien: null, motivo: null },
  }
  const llamadas: Record<string, unknown>[] = []
  void page.route(/\/rest\/v1\/rpc\/conta_interruptores_de_cuenta/, (r) => json(r, {
    interruptores: CLAVES.map((clave) => ({ clave, existe: !!estado[clave].cambiada, ...estado[clave] })),
    datos: { asientos: 12, facturas_recibidas: 3, impuestos: 0 },
  }))
  void page.route(/\/rest\/v1\/rpc\/conta_interruptor_cambiar/, async (r) => {
    const a = r.request().postDataJSON() as { p_clave: (typeof CLAVES)[number]; p_encender: boolean; p_motivo: string }
    llamadas.push(a)
    const de = estado[a.p_clave].encendida
    estado[a.p_clave] = { encendida: a.p_encender, cambiada: '2026-11-18T19:30:00Z', quien: 'Plataforma de prueba', motivo: a.p_motivo }
    if (a.p_clave === 'conta_nucleo') await nucleoDeVerdad(a.p_encender)
    await json(r, { cuenta: 'Taberna de Prueba Norte', cambiados: de === a.p_encender ? [] : [{ clave: a.p_clave, de, a: a.p_encender }] })
  })
  return llamadas
}

/** Lo que ve quien entra en la cuenta A: el marco del núcleo, o el de hoy. */
async function marcoDeLaCuenta(page: Page, nucleo: boolean) {
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 1456, height: 816 }, locale: 'es-ES', timezoneId: 'Europe/Madrid', baseURL: 'http://127.0.0.1:4173' })
  const otra = await ctx.newPage()
  await entrarComo(otra, CUENTA_A.email)
  await otra.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  if (nucleo) {
    await expect(otra.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await expect(otra.locator('.s-barra')).toHaveCount(0)
  } else {
    await expect(otra.locator('.s-barra')).toBeVisible({ timeout: 30_000 })
    await expect(otra.locator('.k-nucleo')).toHaveCount(0)
  }
  await ctx.close()
}

test.describe('Q05 · «Pantallas nuevas (en pruebas)» en la ficha de la cuenta', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ viewport: { width: 1456, height: 816 }, actionTimeout: 20_000 })
  test.afterAll(() => nucleoDeVerdad(false))

  test('se enciende con su motivo, la cuenta ve el marco nuevo; se apaga y vuelve el de hoy', async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador; en el móvil sigue el de hoy')
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
    await entrarComo(page, PLATAFORMA)
    const llamadas = conBaseInventada(page, true)
    await page.goto(`/_admin/cuentas/${CUENTA_A.id}`)
    const seccion = page.locator('[data-prueba="seccion-sumied"]')
    await expect(seccion.getByRole('switch')).toHaveCount(4, { timeout: 30_000 })
    const fila = seccion.locator('[data-prueba="interruptor-conta_nucleo"]')
    await expect(fila.locator('strong')).toHaveText('Pantallas nuevas (en pruebas)')
    await expect(fila.locator('[data-prueba="explicacion-conta_nucleo"]')).toHaveText('El marco nuevo y las pantallas que ya estén hechas. Solo en el ordenador; en el móvil sigue lo de hoy.')
    await expect(fila).toContainText('Apagada')
    // Los otros tres, como estaban: sin explicación.
    await expect(seccion.locator('[data-prueba^="explicacion-"]')).toHaveCount(1)
    await capturar(page, 'ficha-cuatro-interruptores')

    // Encender, con su motivo (sin motivo no se guarda).
    await fila.getByRole('switch', { name: 'Pantallas nuevas (en pruebas)' }).click()
    await expect(fila.getByLabel('Vas a encender «Pantallas nuevas (en pruebas)». ¿Por qué?')).toBeVisible()
    await expect(fila.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await fila.getByLabel(/¿Por qué\?/).fill('Probar el marco nuevo en la cuenta de prueba')
    await fila.getByRole('button', { name: 'Guardar' }).click()
    await expect(seccion.getByRole('status')).toHaveText('Encendidas las pantallas nuevas de Taberna de Prueba Norte. En el ordenador ya sale el marco nuevo; en el móvil sigue lo de hoy.')
    await expect(fila).toContainText('Encendida desde el 18/11/2026 por Plataforma de prueba · «Probar el marco nuevo en la cuenta de prueba»')
    await capturar(page, 'ficha-pantallas-nuevas-encendida')
    expect(llamadas.at(-1)).toMatchObject({ p_clave: 'conta_nucleo', p_encender: true })
    await marcoDeLaCuenta(page, true)

    // Apagar: vuelve lo de hoy, sin borrar nada.
    await fila.getByRole('switch', { name: 'Pantallas nuevas (en pruebas)' }).click()
    await fila.getByLabel(/¿Por qué\?/).fill('Volver a lo de hoy')
    await fila.getByRole('button', { name: 'Guardar' }).click()
    await expect(seccion.getByRole('status')).toHaveText('Apagadas las pantallas nuevas de Taberna de Prueba Norte: vuelve a salir lo de hoy. No se ha borrado nada.')
    expect(llamadas.at(-1)).toMatchObject({ p_clave: 'conta_nucleo', p_encender: false })
    await marcoDeLaCuenta(page, false)
    expect(errores).toEqual([])
  })

  test('con Contabilidad apagada no se enciende, y lo dice', async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Con un tamaño basta: la ficha es la misma')
    await entrarComo(page, PLATAFORMA)
    const llamadas = conBaseInventada(page, false)
    await page.goto(`/_admin/cuentas/${CUENTA_A.id}`)
    const seccion = page.locator('[data-prueba="seccion-sumied"]')
    await expect(seccion.getByRole('switch')).toHaveCount(4, { timeout: 30_000 })
    const fila = seccion.locator('[data-prueba="interruptor-conta_nucleo"]')
    await expect(fila).toContainText('Enciende antes la contabilidad.')
    const boton = fila.getByRole('switch', { name: 'Pantallas nuevas (en pruebas)' })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await boton.click({ force: true })
    await expect(fila.getByLabel(/¿Por qué\?/)).toHaveCount(0)
    expect(llamadas).toHaveLength(0)
    await capturar(page, 'ficha-sin-contabilidad')
  })
})
