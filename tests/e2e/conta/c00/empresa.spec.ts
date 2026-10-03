/// <reference lib="dom" />
// tests/e2e/conta/c00/empresa.spec.ts
//
// Tarea 5 del C00: Ajustes › Tu empresa (maquetas N2Empresa y M2Empresa), con
// las empresas de prueba de supabase/seeds/conta/seed_c00_empresas_prueba.sql.
//
// Lo que deja puesto en A (la actividad, el ejercicio de este año, una socia)
// es lo que la maqueta enseña y solo se añade si no está: la prueba se puede
// repetir. Cerrar un mes se deshace en la misma prueba (reabrir con motivo).
// Lo que escribe se hace solo en el proyecto de ordenador.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'

async function tarjeta(page: Page, titulo: string | RegExp) {
  return page.locator('section.cx-apartado').filter({ has: page.getByRole('heading', { level: 2, name: titulo }) })
}

test('cuenta A: completar la empresa, cerrar y reabrir un mes, como en la maqueta', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes')
  await expect(page.getByRole('heading', { level: 1, name: 'Tu empresa' })).toBeVisible()

  const quien = await tarjeta(page, 'Quién eres')
  await expect(quien.getByText('Taberna de Prueba Norte, S.L.')).toBeVisible()
  await expect(quien.getByText('B28000016')).toBeVisible()
  await expect(quien.getByRole('img', { name: 'La letra de control cuadra' })).toBeVisible()
  const impuestos = await tarjeta(page, 'Tus impuestos')
  await expect(impuestos.getByText('General · cada tres meses')).toBeVisible()
  for (const m of ['303 IVA', '111 Retenciones', '115 Alquiler', '202 Sociedades']) await expect(impuestos.getByText(m)).toBeVisible()

  // A qué te dedicas: Restaurante, con su epígrafe y su CNAE buscados en las listas oficiales.
  const actividad = await tarjeta(page, 'A qué te dedicas')
  if (await actividad.getByRole('button', { name: /^Restaurante/ }).count() === 0) {
    await actividad.getByRole('button', { name: '+ Añadir' }).click()
    await actividad.getByLabel('A qué te dedicas').fill('Restaurante')
    await actividad.getByLabel('Epígrafe del IAE').fill('restaurantes')
    await actividad.getByRole('button', { name: /^671 Servicios en restaurantes/ }).click()
    await actividad.getByLabel('CNAE').fill('Restaurantes')
    await actividad.getByRole('button', { name: /^5611 Restaurantes/ }).click()
    await actividad.getByLabel('Desde cuándo (si lo sabes)').fill('2022-03-01')
    await actividad.getByRole('button', { name: 'Añadir', exact: true }).click()
    await expect(actividad.getByRole('status').getByText('Añadida «Restaurante» como tu actividad principal.')).toBeVisible()
  }
  await expect(actividad.getByText('Epígrafe 671 · CNAE 5611 · desde marzo de 2022')).toBeVisible()
  await expect(actividad.getByText('Principal', { exact: true })).toBeVisible()

  // El ejercicio de este año.
  const ano = new Date().getFullYear()
  const abrir = page.getByRole('button', { name: `Abrir el ejercicio ${ano}` })
  if (await abrir.count()) {
    await abrir.click()
    await expect(page.getByText(`Abierto el ejercicio ${ano}.`)).toBeVisible()
  }
  const ejercicio = await tarjeta(page, `Ejercicio ${ano}`)
  await expect(ejercicio.getByRole('list', { name: `Meses del ejercicio ${ano}` })).toBeVisible()

  // Cerrar el mes que toca y deshacerlo reabriéndolo con motivo.
  const cerrar = ejercicio.getByRole('button', { name: /^Cerrar / })
  if (await cerrar.count()) {
    const mes = (await cerrar.textContent())!.replace('Cerrar ', '').trim()
    await cerrar.click()
    await expect(ejercicio.getByRole('status').getByText(`Cerrado ${mes}: ya no se puede cambiar nada con fecha de ${mes} sin reabrirlo.`)).toBeVisible()
    await expect(ejercicio.getByRole('listitem', { name: `${mes}: cerrado` })).toBeVisible()
    await ejercicio.getByRole('button', { name: `Reabrir ${mes}` }).click()
    await ejercicio.getByRole('button', { name: 'Reabrir', exact: true }).click()
    await expect(ejercicio.getByText('Para reabrir un mes hay que decir por qué. Queda apuntado.')).toBeVisible()
    await ejercicio.getByLabel(`Por qué reabres ${mes}`).fill('Prueba e2e: se deshace el cierre')
    await ejercicio.getByRole('button', { name: 'Reabrir', exact: true }).click()
    await expect(ejercicio.getByRole('status').getByText(`Reabierto ${mes}. Queda apuntado quién y por qué: «Prueba e2e: se deshace el cierre».`)).toBeVisible()
    await expect(ejercicio.getByRole('listitem', { name: `${mes}: abierto` })).toBeVisible()
  }

  // Socios y cargos.
  const socios = await tarjeta(page, 'Socios y cargos')
  if (await socios.getByRole('button', { name: 'Cambiar Marta Ruiz Sanz' }).count() === 0) {
    await socios.getByRole('button', { name: '+ Añadir' }).click()
    await socios.getByLabel('Nombre y apellidos').fill('Marta Ruiz Sanz')
    await socios.getByRole('button', { name: 'Guardar' }).click()
    await expect(socios.getByText('Di si es socio (con su porcentaje) o qué cargo tiene.')).toBeVisible()
    await socios.getByLabel('Administrador').check()
    await socios.getByLabel('Socio', { exact: true }).check()
    await socios.getByLabel('Porcentaje de la empresa (si es socio)').fill('120')
    await socios.getByRole('button', { name: 'Guardar' }).click()
    await expect(socios.getByText('El porcentaje va de 0 a 100.')).toBeVisible()
    await socios.getByLabel('Porcentaje de la empresa (si es socio)').fill('60')
    await socios.getByRole('button', { name: 'Guardar' }).click()
    await expect(socios.getByRole('status').getByText('Guardado Marta Ruiz Sanz con el 60 %.')).toBeVisible()
  }
  await expect(socios.getByText('Administrador · socio')).toBeVisible()

  // Con todo puesto, la cabecera lo dice.
  await expect(page.getByText('Todo listo para llevar tu contabilidad')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/empresa-ordenador.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta A en el móvil: la lista de apartados y uno, en dos pasos', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes')
  const lista = page.getByRole('navigation', { name: 'Apartados de tu empresa' })
  await expect(lista.getByRole('link', { name: /Quién eres.*Taberna de Prueba Norte, S\.L\. · B28000016/ })).toBeVisible()
  await expect(lista.getByRole('link', { name: /Tus impuestos.*IVA general · cada tres meses/ })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/empresa-movil.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

  await lista.getByRole('link', { name: /^Tus impuestos/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/empresa\/impuestos$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Tus impuestos' })).toBeVisible()
  await expect(page.getByText('Recargo de equivalencia')).toBeVisible()
  await page.screenshot({ path: `${DIR}/empresa-movil-impuestos.png`, fullPage: true })
  await page.getByRole('link', { name: 'Volver a tu empresa' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})

test('cuenta B (Canarias, sin interruptor ni Cocina): su empresa, su IGIC y abrir su ejercicio', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta/ajustes')
  const quien = await tarjeta(page, 'Quién eres')
  await expect(quien.getByText('Cocina de Prueba Sur, S.L.')).toBeVisible()
  await expect(quien.getByText('Taberna de Prueba Norte')).toHaveCount(0)
  await expect((await tarjeta(page, 'Tus impuestos')).getByText('IGIC (Canarias)')).toBeVisible()
  // Lo que falta se dice: nunca «Todo listo» con huecos.
  await expect(page.getByText(/^Falta .*a qué te dedicas/)).toBeVisible()
  await expect(page.getByText('Todo listo para llevar tu contabilidad')).toHaveCount(0)
  const ano = new Date().getFullYear()
  const abrir = page.getByRole('button', { name: `Abrir el ejercicio ${ano}` })
  if (await abrir.count()) {
    await abrir.click()
    await expect(page.getByText(`Abierto el ejercicio ${ano}.`)).toBeVisible()
  }
  await expect(page.getByRole('heading', { level: 2, name: `Ejercicio ${ano}` })).toBeVisible()
  await expect((await tarjeta(page, 'Socios y cargos')).getByText('Aún no has puesto socios ni cargos.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/empresa-b-canarias.png`, fullPage: true })
})

test('un apartado que no existe vuelve a Tu empresa', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/empresa/no-existe')
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})
