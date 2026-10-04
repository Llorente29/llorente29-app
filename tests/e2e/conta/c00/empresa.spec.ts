/// <reference lib="dom" />
// tests/e2e/conta/c00/empresa.spec.ts
//
// Tarea 5 del C00: Ajustes › Tu empresa (maquetas N2Empresa y M2Empresa), con
// las empresas de prueba de supabase/seeds/conta/seed_c00_empresas_prueba.sql.
// Desde el C02 (§5a, N6Ajustes) «Tu empresa» se reparte en cuatro entradas del
// índice de Ajustes: Tu empresa, Tus impuestos, Socios y cargos y Ejercicio.
// Las pruebas entran por la suya; lo de dentro no ha cambiado.
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
  await expect(page.getByRole('heading', { level: 2, name: 'Tu empresa' })).toBeVisible()

  const quien = await tarjeta(page, 'Quién eres')
  await expect(quien.getByText('Taberna de Prueba Norte, S.L.')).toBeVisible()
  await expect(quien.getByText('B28000016')).toBeVisible()
  await expect(quien.getByRole('img', { name: 'La letra de control cuadra' })).toBeVisible()
  await page.goto('/conta/ajustes/impuestos')
  const impuestos = await tarjeta(page, 'Tus impuestos')
  await expect(impuestos.getByText('General · cada tres meses')).toBeVisible()
  for (const m of ['303 IVA', '111 Retenciones', '115 Alquiler', '202 Sociedades']) await expect(impuestos.getByText(m)).toBeVisible()
  await page.goto('/conta/ajustes/empresa')

  // A qué te dedicas: Restaurante, con su epígrafe y su CNAE buscados en las listas oficiales.
  const actividad = await tarjeta(page, 'A qué te dedicas')
  // count() no espera: primero, que la tarjeta haya cargado (con el índice del
  // C02 se llega por navegación y el 05/10 contó 0 con el esqueleto delante, y
  // añadió «Restaurante» dos veces).
  await expect(actividad.getByRole('button', { name: '+ Añadir' })).toBeVisible()
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
  await page.goto('/conta/ajustes/ejercicio')
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
  await page.goto('/conta/ajustes/socios')
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
  await page.goto('/conta/ajustes')
  await expect(page.getByRole('heading', { level: 2, name: 'Tu empresa' })).toBeVisible()
  await expect(page.getByText('Todo listo para llevar tu contabilidad')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/empresa-ordenador.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta A en el móvil: el índice de Ajustes y una entrada, en dos pasos', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes')
  const lista = page.getByRole('navigation', { name: 'Ajustes' })
  await expect(lista.getByRole('link', { name: /Tu empresa.*Taberna de Prueba Norte, S\.L\. · B28000016/ })).toBeVisible()
  await expect(lista.getByRole('link', { name: /Tus impuestos.*IVA general · cada tres meses/ })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/empresa-movil.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

  await lista.getByRole('link', { name: /^Tus impuestos/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/impuestos$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Tus impuestos' })).toBeVisible()
  await expect(page.getByText('Recargo de equivalencia')).toBeVisible()
  await page.screenshot({ path: `${DIR}/empresa-movil-impuestos.png`, fullPage: true })
  await page.getByRole('link', { name: 'Volver a ajustes' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})

test('cuenta B (Canarias, sin interruptor ni Cocina): su empresa, su IGIC y abrir su ejercicio', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta/ajustes')
  const quien = await tarjeta(page, 'Quién eres')
  await expect(quien.getByText('Cocina de Prueba Sur, S.L.')).toBeVisible()
  await expect(quien.getByText('Taberna de Prueba Norte')).toHaveCount(0)
  await page.goto('/conta/ajustes/impuestos')
  await expect((await tarjeta(page, 'Tus impuestos')).getByText('IGIC (Canarias)')).toBeVisible()
  // Lo que falta se dice: nunca «Todo listo» con huecos.
  await page.goto('/conta/ajustes/ejercicio')
  await expect(page.getByText(/^Falta .*a qué te dedicas/)).toBeVisible()
  await expect(page.getByText('Todo listo para llevar tu contabilidad')).toHaveCount(0)
  const ano = new Date().getFullYear()
  const abrir = page.getByRole('button', { name: `Abrir el ejercicio ${ano}` })
  if (await abrir.count()) {
    await abrir.click()
    await expect(page.getByText(`Abierto el ejercicio ${ano}.`)).toBeVisible()
  }
  await expect(page.getByRole('heading', { level: 2, name: `Ejercicio ${ano}` })).toBeVisible()
  await page.goto('/conta/ajustes/socios')
  await expect((await tarjeta(page, 'Socios y cargos')).getByText('Aún no has puesto socios ni cargos.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/empresa-b-canarias.png`, fullPage: true })
})

test('una dirección vieja o que no existe va a su sitio del índice', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/empresa/no-existe')
  await expect(page).toHaveURL(/\/conta\/ajustes\/empresa$/)
  await page.goto('/conta/ajustes/empresa/socios')
  await expect(page).toHaveURL(/\/conta\/ajustes\/socios$/)
  await page.goto('/conta/ajustes/no-existe')
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})

// Respuesta 3, punto 5: lo que piden el 200 y el depósito de cuentas, ya en la ficha.
test('cuenta A: la ficha basta para presentar el 200 y depositar las cuentas', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/impuestos')
  const presentar = await tarjeta(page, 'Para presentar el 200 y depositar las cuentas')
  await expect(presentar.getByText('Fecha de constitución', { exact: true })).toBeVisible()

  // Quién eres: constitución, Registro Mercantil completo, contacto y DEHú. El certificado, aún no.
  await page.goto('/conta/ajustes/empresa')
  const quien = await tarjeta(page, 'Quién eres')
  await expect(quien.getByText('Aún no · irá en «Certificados y accesos»')).toBeVisible()
  await page.getByRole('button', { name: 'Cambiar quién eres' }).click()
  await page.getByLabel('Fecha de constitución').fill('2020-01-15')
  await page.getByLabel('Registro mercantil de').fill('Madrid')
  await page.getByLabel('Tomo', { exact: true }).fill('40000')
  await page.getByLabel('Folio', { exact: true }).fill('1')
  await page.getByLabel('Hoja', { exact: true }).fill('M-700000')
  await page.getByLabel('Inscripción', { exact: true }).fill('1.ª')
  await page.getByLabel('Teléfono de la empresa').fill('910000000')
  await page.getByLabel('Correo de avisos de notificaciones (DEHú)').fill('no-es-un-correo')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Ese correo no tiene buena pinta: falta la @ o el dominio.')).toBeVisible()
  await page.getByLabel('Correo de avisos de notificaciones (DEHú)').fill('avisos@prueba.folvy.test')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(quien.getByText('15/01/2020')).toBeVisible()
  await expect(quien.getByText('Madrid · tomo 40000, folio 1, hoja M-700000, inscripción 1.ª')).toBeVisible()

  // El ejercicio: plantilla media y auditoría.
  await page.goto('/conta/ajustes/ejercicio')
  await page.getByRole('button', { name: /^Cambiar la plantilla y la auditoría de / }).click()
  await page.getByLabel('Plantilla media fija').fill('3')
  await page.getByLabel('Plantilla media no fija').fill('1,5')
  await page.getByLabel('¿Cuentas auditadas?').selectOption('no')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('3 fija · 1,5 no fija')).toBeVisible()

  // Socios: la administradora firma las cuentas y tiene su NIF.
  await page.goto('/conta/ajustes/socios')
  const socios = await tarjeta(page, 'Socios y cargos')
  await socios.getByRole('button', { name: 'Cambiar Marta Ruiz Sanz' }).click()
  await page.getByLabel('NIF (si quieres)').fill('00000000T')
  await page.getByLabel('Firma las cuentas anuales').selectOption('si')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(socios.getByText(/firma las cuentas/)).toBeVisible()

  // Lo puesto sale como hecho en «Para presentar».
  await page.goto('/conta/ajustes/impuestos')
  for (const t of ['Fecha de constitución', 'Datos del Registro Mercantil: registro, tomo, folio, hoja e inscripción', 'Quién firma las cuentas anuales']) {
    await expect(presentar.locator('.cx-presentar-fila').filter({ hasText: t })).toContainText('Hecho')
  }
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'docs/conta/capturas/c00/empresa-presentar.png', fullPage: true })
})
