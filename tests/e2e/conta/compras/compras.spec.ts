/// <reference lib="dom" />
// tests/e2e/conta/compras/compras.spec.ts
//
// Compras (encargo «Contabilidad: las compras») contra staging-conta, en
// ordenador (1440) y móvil (390): la página (N18), la liquidación (N19),
// «Cómo te factura» en la ficha (N20) y el diálogo de subir una factura. Las
// capturas van junto a las maquetas (docs/conta/capturas/compras/).
//
// Datos: supabase/seeds/conta/seed_compras_staging.sql y
// seed_compras_repaso_staging.sql (todo inventado). No escribe nada: abre,
// mira y cierra.
//
// Repaso del 10/10: una fila por decisión, «Ver el papel», el contador del
// menú, los cinco documentos y los tres veredictos de la liquidación, y
// «Abrir su ficha» cayendo en «Cómo te factura».

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/compras'
const VERDURAS = 'c0c00000-0000-4000-8000-000000000001'
const BODEGA = 'c0c00000-0000-4000-8000-000000000002'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// La captura de página entera con `fullPage` pinta las piezas fijas (la
// cabecera pegada, el menú, la barra «Pregunta o pide algo») donde estaban en
// la ventana, a media página y encima del contenido: eso es de la captura, no
// de la app. Se agranda la ventana al alto del documento, se captura la
// ventana y se devuelve a su tamaño (repaso del 10/10, punto 5).
async function capturar(page: Page, nombre: string, contenedor = '.cx-principal') {
  await page.evaluate(() => document.fonts.ready)
  if (contenedor === '.cx-principal') expect(await loQueTapan(page, contenedor, FLOTANTES_CONTA)).toEqual([])
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

test('Compras: lo que hay que mirar, lo que espera factura y las liquidaciones', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/compras')
  await expect(page.getByRole('heading', { level: 1, name: 'Compras' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Qué tienes que mirar' })).toBeVisible()
  // Una fila por decisión. Lo que le falta a la ficha, todo junto:
  const ficha = page.locator('.cxc-cosa', { hasText: /^A Verduras del Huerto Prueba, S\.L\. le faltan/ })
  await expect(ficha.getByText(/^A Verduras del Huerto Prueba, S\.L\. le faltan .*cómo te factura\.$/)).toBeVisible()
  await expect(ficha.getByRole('button', { name: 'Usar ese NIF' })).toBeVisible()
  await expect(ficha.getByRole('button', { name: 'Ver el papel' })).toBeVisible()
  // «Contado» no pregunta de quién es: avisa del IVA, con sus dos salidas.
  const contado = page.locator('.cxc-cosa', { hasText: 'a nombre de «Contado», no de tu empresa' })
  await expect(contado.getByText('Una factura de Bodega Prueba Ribera, S.L. viene a nombre de «Contado», no de tu empresa. Así no puedes descontar su IVA.')).toBeVisible()
  await expect(contado.getByRole('button', { name: 'Pedir que la rehagan' })).toBeVisible()
  await expect(contado.getByRole('button', { name: 'Apuntarla sin descontar el IVA' })).toBeVisible()
  // Tres papeles a nombre del mismo local: UNA pregunta, con una propuesta y su porqué.
  const nombre = page.locator('.cxc-cosa', { hasText: '3 papeles van a nombre de «Aurora Cocina Centro». ¿De quién son?' })
  await expect(nombre).toHaveCount(1)
  await expect(nombre.getByRole('button', { name: 'Es Distribuciones Prueba Aurora, S.L.' })).toBeVisible()
  await expect(nombre.getByText('Comparte «aurora» y es quien trae el género')).toBeVisible()
  await expect(nombre.getByRole('button', { name: 'Es de otro…' })).toBeVisible()
  await expect(nombre.getByRole('button', { name: 'No es nuestro' })).toBeVisible()
  // Regla 7: agrupar no esconde. La fila abre sus tres papeles, y cada uno se ve.
  await nombre.getByText('Ver los 3 papeles').click()
  await expect(nombre.getByRole('button', { name: 'Ver el papel' })).toHaveCount(3)
  await nombre.getByText('Ver los 3 papeles').click()
  // «Es de otro…» abre una búsqueda, no otra ristra de botones.
  await nombre.getByRole('button', { name: 'Es de otro…' }).click()
  const buscar = page.getByRole('dialog', { name: '¿De quién es «Aurora Cocina Centro»?' })
  await buscar.getByLabel('Busca tu empresa o un proveedor').fill('carnes')
  await expect(buscar.getByRole('option', { name: /Carnes Prueba del Valle/ })).toBeVisible()
  await buscar.getByRole('button', { name: 'Cancelar' }).click()
  await expect(buscar).toBeHidden()
  // El número del menú cuenta filas, como la cabecera (en ordenador; en el móvil el menú va plegado).
  if (lado(page) === 'ordenador') {
    const filas = await page.locator('.cxc-mirar > .cxc-cosa').count()
    await expect(page.locator('.cx-menu-item', { hasText: 'Compras' }).locator('.cx-menu-cuenta')).toHaveText(String(filas))
  }
  await expect(page.getByRole('table', { name: 'Qué está esperando factura' }).getByText('Carnes Prueba del Valle, S.L.').first()).toBeVisible()
  await expect(page.getByText('Ha llegado: falta mirarla y confirmarla.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Subir sus documentos' })).toBeVisible()
  await capturar(page, 'compras')

  // Subir una factura: el diálogo, sin subir nada.
  await page.getByRole('button', { name: 'Subir una factura' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Subir una factura' })
  await expect(dialogo.getByLabel('La factura (foto o PDF)')).toBeVisible()
  await capturar(page, 'subir-factura', 'dialogo')
  await dialogo.getByLabel('La factura (foto o PDF)').press('Escape')
  await expect(dialogo).toBeHidden()
})

test('La liquidación de septiembre y su contraste (N19)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/compras')
  await page.getByText('Ha llegado: falta mirarla y confirmarla.').locator('xpath=ancestor::div[contains(@class,"cxc-liq")]').getByRole('link', { name: 'Abrir' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Distribuciones Prueba Aurora, S\.L\. · septiembre de 2026/ })).toBeVisible()
  // Los cinco documentos, leídos, arriba.
  await expect(page.getByText('Los cinco documentos, leídos')).toBeVisible()
  // Tres veredictos con su umbral: compras coincide; las ventas de Folvy no están en staging.
  await expect(page.getByText('Lo que dice que te mandó coincide con lo que recibiste.')).toBeVisible()
  await expect(page.getByText('Sus ventas no las puedo comprobar.')).toBeVisible()
  const ventas = page.getByRole('table', { name: 'Ventas por plataforma' })
  await expect(ventas).toBeVisible()
  // Ninguna celda se sale de su tabla (e2e 171: en el móvil «Diferencia» se cortaba por la derecha).
  const salen = await ventas.evaluate((t) => {
    const r = t.getBoundingClientRect()
    return Array.from(t.children).filter((c) => c.getBoundingClientRect().right > r.right + 1 || c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent)
  })
  expect(salen).toEqual([])
  // Los albaranes que cuenta el contraste, con su papel.
  await page.getByRole('button', { name: 'Ver los 2 albaranes' }).click()
  await expect(page.locator('.cxc-albaranes').getByRole('button', { name: 'Ver el papel' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Decirle cuál es cuál' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Contabilizar' })).toBeEnabled()
  await capturar(page, 'liquidacion')
})

test('Cómo te factura, en la ficha (N20)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/kitchen/proveedores/${VERDURAS}/pago`)
  const grupo = page.getByRole('group', { name: 'Cómo te factura', exact: true })
  await expect(grupo).toBeVisible()
  await expect(grupo.getByRole('radio')).toHaveCount(3)
  await expect(grupo.getByText('Su última entrega vino con albarán.')).toBeVisible()
  await capturar(page, 'como-te-factura', 'ficha')
})

test('Cómo te factura, con la forma ya elegida en su ficha (N20)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/kitchen/proveedores/${BODEGA}/pago`)
  const grupo = page.getByRole('group', { name: 'Cómo te factura', exact: true })
  await expect(grupo).toBeVisible()
  // Se ve cuál está elegida: la suya, marcada y con su etiqueta.
  await expect(grupo.getByRole('radio', { name: /Con cada entrega/ })).toBeChecked()
  await expect(grupo.getByText('La de su ficha')).toBeVisible()
  await capturar(page, 'como-te-factura-elegida', 'ficha')
})

test('«Abrir su ficha» desde Compras cae en «Cómo te factura»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/compras')
  const ficha = page.locator('.cxc-cosa', { hasText: /^A Verduras del Huerto Prueba, S\.L\. le faltan/ })
  await ficha.getByRole('link', { name: 'Abrir su ficha' }).click()
  await expect(page).toHaveURL(new RegExp(`/kitchen/proveedores/${VERDURAS}/pago#campo-como-te-factura$`))
  const grupo = page.getByRole('group', { name: 'Cómo te factura', exact: true })
  await expect(grupo).toBeInViewport()
  // La ficha no dice cómo factura y su papel sí: lo avisa.
  await expect(grupo.locator('.cx-aviso')).toBeVisible()
})
