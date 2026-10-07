/// <reference lib="dom" />
// tests/e2e/conta/c04/libro.spec.ts
//
// C04 · Libro diario (N11), asiento (N12), asiento a mano, mes cerrado y el
// extracto en las fichas, contra staging-conta, en ordenador (1440) y móvil
// (390). Las capturas van junto a las maquetas (docs/conta/capturas/c04/,
// COMPARACION.md frente a N11Diario y N12Asiento) y se toman ANTES de
// escribir nada, para que salgan siempre iguales.
//
// Datos: supabase/seeds/conta/seed_c04_staging.sql (todo inventado). Lo que
// escribe (cambiar una cuenta, un asiento a mano) se hace en UN tamaño y se
// deshace al acabar: la cuenta vuelve a la suya y el borrador se descarta.
// Validar y anular dejan huella para siempre (es su gracia): los prueba la
// tanda SQL de staging (20261010_c04_prueba_libro.sql) dentro de un ROLLBACK.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c04'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

async function abrirAsiento(page: Page, concepto: string) {
  await page.getByRole('button', { name: new RegExp(concepto) }).first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page.getByRole('heading', { level: 1, name: concepto })).toBeVisible()
}

test('A · libro diario (N11): filtros que existen, cuatro cifras, estados y lo que he hecho yo', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { level: 1, name: 'Libro diario' })).toBeVisible()
  // Desde el menú: «Libros» ya tiene su pantalla.
  if (lado(page) === 'ordenador') await expect(page.getByRole('link', { name: 'Libros' })).toBeVisible()
  // Filtros: solo los orígenes que hay, con cuántos.
  for (const f of [/^Para revisar · \d+$/, /^Ventas · \d+$/, /^Compras · \d+$/, /^Plataformas · \d+$/, /^Nóminas · \d+$/, /^Manuales · \d+$/, /^Anulados · \d+$/]) {
    await expect(page.getByRole('button', { name: f })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: /^Banco · / })).toHaveCount(0)
  // Las cuatro cifras.
  await expect(page.getByText(/^Asientos en (octubre|noviembre|diciembre)$/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Para revisar: \d+\. Ver$/ })).toBeVisible()
  await expect(page.getByText(/^Resultado de /)).toBeVisible()
  // Estados: lo propuesto, lo hecho por Folvy, lo anulado.
  await expect(page.getByRole('button', { name: /Ventas del día · Norte Centro/ }).getByText('Para revisar')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ventas del día · Norte Mercado/ }).getByText('Hecho por Folvy')).toBeVisible()
  await expect(page.getByRole('button', { name: /Publicidad en la plataforma · octubre/ }).getByText('Anulado')).toBeVisible()
  // La marca cedida, dicha.
  await expect(page.getByRole('button', { name: /Liquidación Plataforma Norte/ }).getByText('Milanesa Cedida · cedida')).toBeVisible()
  // Lo que he hecho yo, con Deshacer en lo que validó Folvy.
  const ia = page.getByRole('region', { name: 'Lo que he hecho yo' })
  await expect(ia.getByText(/Asenté «Ventas del día · Norte Mercado»/)).toBeVisible()
  await expect(ia.getByRole('button', { name: 'Deshacer' }).first()).toBeVisible()
  // El cierre del mes anterior, con sus números.
  await expect(page.getByRole('region', { name: /^Cierre de / })).toBeVisible()
  await capturar(page, 'diario')

  if (lado(page) === 'ordenador') {
    // La fila se despliega en sus apuntes.
    await page.getByRole('button', { name: /Ventas del día · Norte Mercado/ }).click()
    await expect(page.getByRole('link', { name: '47700010' }).first()).toBeVisible()
    await expect(page.getByText('al Haber').first()).toBeVisible()
    await capturar(page, 'diario-abierto')
  }
  // Para revisar: solo lo que espera, sin esconder el resto (Todos sigue con todo).
  await page.getByRole('button', { name: /^Para revisar · \d+$/ }).click()
  await expect(page.getByRole('button', { name: /Ventas del día · Norte Mercado/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Alquiler Norte Mercado · octubre/ })).toBeVisible()
})

test('A · asiento (N12): por qué lo propongo así, cuadre y detalle contable', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await abrirAsiento(page, 'Liquidación Plataforma Norte · 16–30 sep')
  await expect(page.getByText('Propuesto por Folvy · Seguro')).toBeVisible()
  await expect(page.getByText('Serie Banco')).toBeVisible()
  const porque = page.getByRole('region', { name: 'Por qué lo propongo así' })
  await expect(porque.getByText('Milanesa Cedida va al socio, no a tus ventas')).toBeVisible()
  await expect(porque.getByText(/PGC NRV 16\.ª/)).toBeVisible()
  await expect(page.getByText('Cuadra', { exact: true })).toBeVisible()
  await expect(page.getByText('✓ 0,00 €')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeEnabled()
  await capturar(page, 'asiento')

  // Un validado: su número por serie y su huella, en Detalle contable.
  await page.goto('/conta/libros/diario')
  await abrirAsiento(page, 'Nóminas de septiembre · Norte Centro')
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cambiar' })).toHaveCount(0)
  await page.getByRole('button', { name: /Detalle contable/ }).click()
  await expect(page.getByText('Nóminas · código 9')).toBeVisible()
  await page.getByRole('button', { name: 'Comprobar la cadena' }).click()
  await expect(page.getByText(/^La cadena está intacta: \d+ asientos validados/)).toBeVisible()

  // Un anulado lleva a su contraasiento, y vuelta.
  await page.goto('/conta/libros/diario?ver=anulados')
  await abrirAsiento(page, 'Publicidad en la plataforma · octubre')
  await expect(page.getByText(/Estaba repetido/)).toBeVisible()
  await page.getByRole('link', { name: 'Ver el contraasiento' }).click()
  await expect(page.getByText('Este asiento da la vuelta a otro, apunte por apunte.')).toBeVisible()
})

test('A · cambiar una cuenta de una propuesta: lo dice y lo aprende; y se deja como estaba', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario?ver=revisar')
  await abrirAsiento(page, 'Alquiler Norte Mercado · octubre')
  const fila = page.locator('.cxd-linea-envoltura', { hasText: 'Arrendamientos y cánones' })
  await fila.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByLabel('Buscar cuenta por nombre o código').fill('otros servicios')
  await page.getByRole('button', { name: /62900000 Otros servicios/ }).click()
  await expect(page.getByRole('status').getByText(/Cambiada la 62100000 por la 62900000 \(Otros servicios\)\. La próxima del mismo origen la propondré así\./)).toBeVisible()
  // Y vuelta a la suya (también queda aprendido: la última manda).
  const otra = page.locator('.cxd-linea-envoltura', { hasText: 'Otros servicios' })
  await otra.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByLabel('Buscar cuenta por nombre o código').fill('62100000')
  await page.getByRole('button', { name: /62100000 Arrendamientos/ }).click()
  await expect(page.getByRole('status').getByText(/Cambiada la 62900000 por la 62100000/)).toBeVisible()
})

test('A · asiento a mano: cuadre en vivo, borrador y descartar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario/nuevo')
  await expect(page.getByRole('heading', { level: 1, name: 'Nuevo asiento' })).toBeVisible()
  await page.getByLabel('Concepto', { exact: true }).fill('Prueba e2e · se descarta')
  await page.getByLabel('Cuenta del apunte 1').fill('62900000')
  await page.getByLabel('Local del apunte 1').selectOption({ label: 'Norte Centro' })
  await page.getByLabel('Debe del apunte 1').fill('12,50')
  await page.getByLabel('Cuenta del apunte 2').fill('57200001')
  await page.getByLabel('Local del apunte 2').selectOption({ label: 'Común (se reparte)' })
  await page.getByLabel('Haber del apunte 2').fill('12')
  await expect(page.getByText('No cuadra: faltan 0,50 € en el Haber')).toBeVisible()
  await capturar(page, 'nuevo-asiento')
  await page.getByLabel('Haber del apunte 2').fill('12,50')
  await expect(page.getByText('✓ 0,00 €')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar borrador' }).click()
  await expect(page.getByText('Guardado como borrador: sale en «Para revisar» hasta que lo valides.')).toBeVisible()
  await expect(page.getByText('Borrador', { exact: true })).toBeVisible()
  // Se deshace: descartar, con su porqué.
  await page.getByRole('button', { name: 'Descartar' }).click()
  await page.getByLabel('Por qué').fill('Era una prueba')
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\?ver=revisar$/)
  await expect(page.getByRole('button', { name: /Prueba e2e · se descarta/ })).toHaveCount(0)
})

test('A · el extracto del proveedor lee del libro y lleva a su asiento', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/contabilidad`)
  await page.getByRole('button', { name: 'Ver extracto' }).click()
  const enlace = page.getByRole('link', { name: 'Ver el asiento F-2026-0915' }).first()
  await expect(enlace).toBeVisible()
  await capturar(page, 'extracto-proveedor')
  await enlace.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Factura Hermanos Ruiz · F-2026-0915' })).toBeVisible()
})

test('B · sin plataformas ni ventas, septiembre cerrado y un borrador que no se valida', async ({ page }) => {
  await entrarComo(page, CUENTA_B.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { level: 1, name: 'Libro diario' })).toBeVisible()
  // Regla 9: nada de A.
  await expect(page.getByText(/Norte Centro|Plataforma Norte/)).toHaveCount(0)
  // Solo los filtros de lo que B tiene.
  await expect(page.getByRole('button', { name: /^Plataformas/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Ventas/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Manuales · \d+$/ })).toBeVisible()
  await expect(page.getByText('septiembre cerrado')).toBeVisible()
  await capturar(page, 'diario-b')
  await abrirAsiento(page, 'Honorarios de la gestoría · septiembre')
  await expect(page.getByText(/septiembre está cerrado/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeDisabled()
  await capturar(page, 'mes-cerrado-b')
})
