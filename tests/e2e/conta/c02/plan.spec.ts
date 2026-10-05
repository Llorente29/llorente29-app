/// <reference lib="dom" />
// tests/e2e/conta/c02/plan.spec.ts
//
// C02, tarea 4: Ajustes como índice (N6Ajustes) y la pantalla «Plan contable»
// (N5Plan dentro del marco de N6), en ordenador y móvil, cuentas A y B. Con
// las capturas junto a las maquetas (docs/conta/capturas/c02/, COMPARACION.md).
//
// El plan se activa la primera vez y se queda activado (las pruebas de la
// ficha de proveedor de la tarea 6 lo usan). Lo que se añade en la prueba se
// deshace en la misma prueba («Deshacer», ocultar y volver a enseñar).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c02'

/** Abre el plan y, si aún no está activado, lo activa (una subcuenta por proveedor) y comprueba que lo dice. */
async function planActivado(page: Page) {
  await page.goto('/conta/ajustes/plan')
  const activar = page.getByRole('button', { name: 'Activar el plan' })
  const tabla = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await expect(activar.or(tabla)).toBeVisible()
  if (await activar.count()) {
    await activar.click()
    await expect(page.getByRole('status').getByText(/^Plan activado: \d+ cuentas de serie, \d+ subcuentas y \d+ enlaces\./)).toBeVisible()
  }
  await expect(tabla).toBeVisible()
}

test('cuenta A: activar, buscar «alquiler», añadir y deshacer, ocultar y volver a enseñar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await planActivado(page)

  // El índice dice la cifra real (D2), no la de la maqueta.
  const indice = page.getByRole('navigation', { name: 'Ajustes' })
  await expect(indice.getByRole('link', { name: /^Plan contable\s*Pymes · 8 dígitos · \d+ cuentas$/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Plan de pymes · subcuentas de 8 dígitos · la longitud queda fija con el primer asiento')).toBeVisible()
  // Nada de Cocina en los Ajustes de contabilidad.
  for (const cocina of ['Quién reparte', 'Locales', 'Marcas']) await expect(indice.getByText(cocina)).toHaveCount(0)

  // Grupo 4: 400 como cabecera y las subcuentas de los proveedores; el de alquiler, en 410.
  const plan = page.getByRole('table', { name: 'Plan contable' })
  await expect(plan.getByRole('row').filter({ hasText: /^400Proveedores/ })).toBeVisible()
  await expect(plan.getByRole('row').filter({ hasText: 'Acreedores · Locales del Norte (alquiler)' })).toContainText('41000001')
  await expect(plan.getByRole('row').filter({ hasText: /^47200021IVA soportado 21 %/ })).toContainText('1 tipo de IVA')
  // Respuesta 3: «qué se apunta aquí» también en las cuentas de apunte. La 40000000
  // hereda el de la 400; la 47200010, el ejemplo de su tipo en la tabla del C00.
  await expect(plan.getByRole('row').filter({ hasText: /^40000000/ })).toContainText('Lo que debes a quienes te venden género')
  await expect(plan.getByRole('row').filter({ hasText: /^47200010/ })).toContainText('Hostelería, alimentos, transporte')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-ordenador.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

  // Buscar «alquiler» encuentra la 621 por lo que se apunta en ella.
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('alquiler')
  await expect(plan.getByRole('row').filter({ hasText: /^62100000Arrendamientos y cánones/ })).toBeVisible()
  await expect(plan.getByRole('row').filter({ hasText: /^62100000/ })).toContainText('El alquiler del local')
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('')

  // Añadir una subcuenta: la siguiente libre, y «Deshacer».
  await page.getByRole('button', { name: 'Añadir subcuenta' }).click()
  const form = page.getByRole('form', { name: 'Añadir subcuenta' })
  await form.getByLabel('De qué cuenta cuelga (busca por nombre o número)').fill('629')
  await form.getByLabel('Cuenta', { exact: true }).selectOption('629')
  await expect(form.getByText(/^Será la 629\d{5}: el siguiente número libre\.$/)).toBeVisible()
  const nombre = `Prueba e2e ${Date.now()}`
  await form.getByLabel('Nombre', { exact: true }).fill(nombre)
  await form.getByRole('button', { name: 'Añadir', exact: true }).click()
  await expect(form.getByRole('status').getByText(new RegExp(`^Creada 629\\d{5} · ${nombre}, bajo la 629\\.$`))).toBeVisible()
  await form.getByRole('button', { name: 'Deshacer' }).click()
  await expect(form.getByRole('status').getByText(/^Deshecho: ya no está la 629\d{5}\.$/)).toBeVisible()
  await form.getByRole('button', { name: 'Cerrar' }).click()

  // Ocultar una sin enlaces, y volver a enseñarla (grupo 6).
  await page.getByRole('button', { name: /^6 · Compras y gastos/ }).click()
  await page.getByRole('button', { name: /^Abrir 68100000/ }).click()
  await page.getByRole('button', { name: 'Ocultar' }).click()
  await expect(page.getByRole('status').getByText('68100000 oculta: no sale en listas ni en sugerencias.')).toBeVisible()
  await page.getByRole('button', { name: 'Volver a enseñar' }).click()
  await expect(page.getByRole('status').getByText('68100000 vuelve a verse.')).toBeVisible()
  // Una enlazada no se deja ocultar: lo dice la base, y la pantalla lo enseña.
  await page.getByRole('button', { name: /^Cerrar 68100000/ }).click()
  await page.getByRole('button', { name: /^Abrir 62100000/ }).click()
  await page.getByRole('button', { name: 'Ocultar' }).click()
  await expect(page.getByText(/Tiene un enlace activo: cambia antes ese enlace a otra cuenta\./)).toBeVisible()

  // El historial lo cuenta (el de esta vez es el primero: va de lo último a lo primero).
  await expect(page.getByRole('list', { name: 'Historial de cambios' }).getByText(/^Ocultada 68100000/).first()).toBeVisible()
})

test('cuenta A: «Qué va a cada sitio» responde con sus palabras', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Solo lee: basta un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await planActivado(page)
  await page.getByRole('link', { name: 'Qué va a cada sitio' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan\/que-va-a-cada-sitio$/)
  await page.getByRole('searchbox', { name: '¿Dónde va…?' }).fill('¿Dónde va la luz?')
  const res = page.getByRole('list', { name: 'Dónde va cada cosa' })
  await expect(res.getByText('Luz, agua, gas, teléfono e internet.')).toBeVisible()
  await expect(res.getByText(/62800000 · Suministros/)).toBeVisible()
  await page.screenshot({ path: `${DIR}/que-va-a-cada-sitio.png`, fullPage: true })
})

test('cuenta A: el índice de Ajustes (N6), con «aún no» donde aún no hay pantalla', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El móvil va en su prueba')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/certificados')
  const indice = page.getByRole('navigation', { name: 'Ajustes' })
  for (const g of ['Empresa', 'Contabilidad', 'Acceso y avisos']) await expect(indice.getByRole('heading', { name: g })).toBeVisible()
  await expect(indice.getByRole('link', { name: /^Certificados y accesos\s*Aún no$/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Aún no.')).toBeVisible()
  // Con sus líneas de resumen ya cargadas (como N6), no el esqueleto.
  await expect(indice.getByRole('link', { name: /^Plan contable\s*Pymes · 8 dígitos · \d+ cuentas$/ })).toBeVisible()
  await expect(indice.getByRole('link', { name: /^Ejercicio\s*\d{4} · / })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ajustes-ordenador.png`, fullPage: true })
})

test('cuenta B (Canarias, sin interruptor ni Cocina): su plan con el IGIC, y nada de A', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_B.email)
  await planActivado(page)
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('4720')
  const plan = page.getByRole('table', { name: 'Plan contable' })
  await expect(plan.getByRole('row').filter({ hasText: /^47200007IVA soportado 7 %/ })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('Locales')
  await expect(plan.getByText('Acreedores · Locales del Sur (alquiler)')).toBeVisible()
  await expect(page.getByText(/Locales del Norte/)).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/plan-b-canarias.png`, fullPage: true })
})

test('cuenta A en el móvil: índice, plan por grupos y una cuenta en su pantalla', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes')
  await page.getByRole('navigation', { name: 'Ajustes' }).getByRole('link', { name: /^Plan contable/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Plan contable' })).toBeVisible()
  const buscar = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await expect(buscar).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-movil.png`, fullPage: true })
  await buscar.fill('alquiler')
  await page.getByRole('link', { name: /^62100000 · Arrendamientos y cánones/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan\/cuenta\/62100000$/)
  await expect(page.getByRole('heading', { level: 1, name: '62100000 · Arrendamientos y cánones' })).toBeVisible()
  await expect(page.getByText('Qué se apunta aquí: El alquiler del local, del datáfono o de máquinas; el canon de la franquicia.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/plan-movil-cuenta.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})
