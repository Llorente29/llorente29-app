/// <reference lib="dom" />
// tests/e2e/conta/c00/tablas.spec.ts
//
// Tarea 4 del C00: Ajustes › Tablas generales (maquetas N3Tablas y M3Tablas).
// Las empresas son las de supabase/seeds/conta/seed_c00_empresas_prueba.sql:
// A en península (presenta 303, 390, 111, 115 y 202) y B en Canarias. B es la
// cuenta SIN interruptor `conta` y sin Cocina: si algo falla ahí, está mal.
//
// Lo que se escribe (ocultar, añadir) se hace solo en el proyecto de
// ordenador y se deja como estaba, para que los dos tamaños no se pisen.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'

async function abrirTablas(page: Page, email: string, tabla = '') {
  await entrarComo(page, email)
  await page.goto(`/conta/ajustes/tablas${tabla ? `/${tabla}` : ''}`)
}

test('cuenta B (Canarias, sin interruptor ni Cocina): impuestos con el IGIC arriba y sin quitar ninguna fila', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El reparto es el mismo; el móvil se mira con A')
  await abrirTablas(page, CUENTA_B.email, 'impuestos')
  await expect(page.getByRole('heading', { name: 'Tablas generales', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Impuestos/ })).toHaveAttribute('aria-current', 'page')

  // Abre con TODAS (D5): «Todos» pulsado, y las dos separaciones a la vista.
  await expect(page.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
  const usas = page.getByRole('rowgroup', { name: 'Los que usas' })
  await expect(usas).toBeVisible()
  await expect(page.getByRole('rowgroup', { name: 'Los demás' })).toBeVisible()
  await expect(page.getByText('Los que usas · 7')).toBeVisible()
  // 8 desde la respuesta 2: el 7,5 % de pasta y aceites de semillas (4T2024) es un impuesto de serie más.
  await expect(page.getByText('Los demás · 8')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir IGIC general' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir IVA general' })).toBeVisible()

  // «Los que usas» acota cuando se toca; «Todos» vuelve a enseñarlo todo.
  await page.getByRole('button', { name: 'Los que usas' }).click()
  await expect(page.getByRole('button', { name: 'Abrir IVA general' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Todos' }).click()
  await expect(page.getByRole('button', { name: 'Abrir IVA general' })).toBeVisible()

  // El detalle se abre en la misma fila.
  await page.getByRole('button', { name: 'Abrir IGIC general' }).click()
  await expect(page.getByText('Dónde vale')).toBeVisible()
  await expect(page.locator('.cx-tablas-detalle').getByText('Canarias', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cerrar IGIC general' })).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: `${DIR}/tablas-b-canarias.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta B: añadir una caja y borrarla, con su confirmación', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await abrirTablas(page, CUENTA_B.email, 'bancos-y-cajas')
  await expect(page.getByText('Aún no has puesto tus bancos ni tus cajas.')).toBeVisible()
  await page.getByRole('button', { name: '+ Añadir banco o caja' }).click()
  // Sin nombre no guarda y dice qué falta.
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Falta «nombre».')).toBeVisible()
  await page.getByLabel('Qué es').selectOption('cash')
  await page.getByLabel('Nombre', { exact: true }).fill('Caja del local (prueba)')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('status').getByText('Añadido «Caja del local (prueba)». Ya sale en tus desplegables.')).toBeVisible()
  await page.getByRole('button', { name: 'Abrir Caja del local (prueba)' }).click()
  await page.getByRole('button', { name: 'Borrar' }).click()
  await page.getByRole('button', { name: 'Sí, borrar' }).click()
  await expect(page.getByRole('status').getByText('Borrado «Caja del local (prueba)».')).toBeVisible()
  await expect(page.getByText('Aún no has puesto tus bancos ni tus cajas.')).toBeVisible()
})

test('cuenta A: impuestos como en la maqueta, con el IVA reducido abierto', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  if (movil) {
    // Móvil: la lista de tablas y, al tocar una, esa tabla con «atrás» (dos pasos).
    await abrirTablas(page, CUENTA_A.email)
    await page.getByRole('link', { name: /^Impuestos/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Impuestos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Volver a las tablas generales' })).toBeVisible()
    await page.getByRole('button', { name: /^IVA reducido/ }).click()
  } else {
    await abrirTablas(page, CUENTA_A.email)
    await expect(page.getByRole('link', { name: /^Impuestos/ })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Abrir IVA reducido' }).click()
  }
  // Cuentas de apunte con la longitud de la empresa: A lleva 8 dígitos (respuesta 3, punto 3).
  const ivaSoportado = /^(47200000 · Hacienda Pública, IVA soportado|47200010 · IVA soportado 10 %)$/
  // Desde el C02 (tarea 6), con el plan activado sale la cuenta REAL del tipo
  // (la 47200010 del 10 %); sin plan, la pista. La e2e del C02 deja el plan de
  // A activado, pero en un staging limpio esta prueba corre antes: valen las dos.
  await expect(page.getByText(ivaSoportado)).toBeVisible()
  await expect(page.getByText(/^(47700000 · Hacienda Pública, IVA repercutido|47700010 · IVA repercutido 10 %)$/)).toBeVisible()
  await expect(page.getByText('Modelo 303')).toBeVisible()
  await expect(page.getByText(/Comprobado en la fuente oficial el/)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/tablas-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
  // Y sigue abierta después de la captura: si la página se desmonta (por
  // ejemplo, al llegar la sesión y recargar la cuenta), la fila se cierra.
  await expect(page.getByText(ivaSoportado)).toBeVisible()
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta A: ocultar una forma de pago de serie la baja a «Los demás», sin quitarla', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await abrirTablas(page, CUENTA_A.email, 'formas-de-pago')
  await page.getByRole('button', { name: 'Abrir Efectivo' }).click()
  await page.getByRole('button', { name: 'Ocultar' }).click()
  await expect(page.getByRole('status').getByText(/Ocultado «Efectivo»: ya no sale en tus desplegables/)).toBeVisible()
  const demas = page.getByRole('rowgroup', { name: 'Los demás' })
  await expect(demas).toBeVisible()
  await expect(page.getByText('Oculto', { exact: true })).toBeVisible()
  // La fila sigue abierta, ahora en «Los demás». Se deja como estaba.
  await page.getByRole('button', { name: 'Volver a mostrar' }).click()
  await expect(page.getByRole('status').getByText('«Efectivo» vuelve a salir en tus desplegables.')).toBeVisible()
})

test('una tabla que no existe vuelve a las tablas generales', async ({ page }) => {
  await abrirTablas(page, CUENTA_A.email, 'no-existe')
  await expect(page).toHaveURL(/\/conta\/ajustes\/tablas$/)
})
