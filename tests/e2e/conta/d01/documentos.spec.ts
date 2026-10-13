/// <reference lib="dom" />
// tests/e2e/conta/d01/documentos.spec.ts
//
// D01 · Documentos › Facturas recibidas (N22) y Revisar factura (N23) contra
// staging-conta, en ordenador (1440) y móvil (390). Las capturas van junto a
// las maquetas (docs/conta/capturas/d01/), para compararlas.
//
// Datos: supabase/seeds/conta/seed_d01_staging.sql (todo inventado), en la
// cuenta A (con Cocina). El frente C es la misma cuenta con
// ?marca=contabilidad (R2): ni Cocina ni la palabra «Folvy» en lo de
// Documentos (el marco y el menú son de la C06, que aún no está en esta rama).
//
// No apunta nada (no pulsa «Está bien · apuntar»: el libro de A es compartido).
// Sí sube una factura inventada con la lectura cortada a propósito, para ver
// que la pantalla DICE que no ha entrado (regla 8); el mismo fichero no se
// registra dos veces.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/d01'
const MES = '2026-10'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

/** Lo que enseña Documentos (sin el marco): ni «Folvy» ni «Cocina», tampoco en etiquetas. */
async function sinFolvyNiCocina(page: Page, donde: string) {
  const visto = await page.locator('.cx-principal').evaluate((el) => ({
    texto: (el as HTMLElement).innerText,
    etiquetas: [...el.querySelectorAll('[aria-label],[alt],[title],[placeholder]')]
      .map((e) => [e.getAttribute('aria-label'), e.getAttribute('alt'), e.getAttribute('title'), e.getAttribute('placeholder')].filter(Boolean).join(' ')).join(' | '),
  }))
  const lineas = (t: string, re: RegExp) => t.split('\n').filter((l) => re.test(l)).slice(0, 5)
  expect(lineas(visto.texto, /folvy/i), `«Folvy» en ${donde}`).toEqual([])
  expect(lineas(visto.texto, /cocina/i), `«Cocina» en ${donde}`).toEqual([])
  expect(visto.etiquetas, `«Folvy» o «Cocina» en una etiqueta de ${donde}`).not.toMatch(/folvy|cocina/i)
}

test('Cuenta A: N22 con sus filas y su porqué, N23 con el papel y «Está bien · apuntar»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  await page.goto(`/conta/documentos?mes=${MES}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible()
  // La banda de la IA dice lo que ha pasado en una frase.
  await expect(page.getByRole('region', { name: 'Lo que ha pasado con tus facturas' })).toContainText(/Han llegado|no ha llegado ninguna/)
  // Las cinco cifras.
  for (const c of ['Llegadas esta semana', 'Apuntadas solas', 'Para mirar', 'Por aclarar', 'Esperadas y no llegadas']) {
    await expect(page.locator('.cxd-cifra', { hasText: c })).toBeVisible()
  }
  // «Para mirar»: las dos de la semilla, cada una con su porqué y un solo botón.
  const alfa = page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' })
  await expect(alfa).toHaveCount(1)
  await expect(alfa).toContainText('F-2026-1022')
  await expect(alfa).toContainText('llegó por Correo')
  await expect(alfa).toContainText(/· 60000000/)
  await expect(alfa.getByRole('button')).toHaveCount(1)
  await expect(page.locator('tr, article', { hasText: 'Suministros Eléctricos Prueba Norte' })).toHaveCount(1)
  if (lado(page) === 'ordenador') await expect(page.getByRole('navigation', { name: 'Acciones de Facturas recibidas' })).toContainText('Subir')
  await capturar(page, 'n22-para-mirar-a')

  // «Por aclarar»: la que no tiene emisor reconocido, con «Decirlo yo».
  await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Por aclarar' }).click()
  const sin = page.locator('tr, article', { hasText: 'No reconozco el emisor' })
  await expect(sin.first()).toBeVisible()
  await expect(sin.first().getByRole('button', { name: /^Decirlo yo/ })).toBeVisible()
  // «Todas» trae todas (regla 7).
  await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Todas' }).click()
  await expect(page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' })).toHaveCount(1)
  await expect(page.locator('tr, article', { hasText: 'No reconozco el emisor' }).first()).toBeVisible()

  // N23.
  await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Para mirar' }).click()
  await page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' }).getByRole('button', { name: /^Mirar/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
  const leido = page.getByRole('region', { name: 'Lo que he leído' })
  await expect(leido).toContainText('Base al 10 %')
  await expect(leido).toContainText('1.283,15 €')
  await expect(leido).toContainText('1.411,47 €')
  await expect(leido).toContainText(/· 60000000/)
  await expect(leido).toContainText('elegida en su ficha')
  // «Cómo se apunta»: la propuesta de verdad, con nombre · código; o por qué no sale.
  await expect(page.getByRole('region', { name: 'Cómo se apunta' })).toContainText(/· 60000000|·\s*4000\d+|periodo cerrado|no tiene|Falta/, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toBeEnabled()
  await capturar(page, 'n23-revisar-a')
  await page.getByRole('button', { name: 'Otra cosa' }).click()
  await expect(page.getByRole('dialog', { name: '¿Qué le pasa?' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errores).toEqual([])
})

test('Cuenta A: subir una factura con la lectura cortada dice que no ha entrado (regla 8)', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'Se sube una vez; en el móvil, la cámara solo se comprueba que está.')
  await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  // La lectura con el modelo no corre en staging: se corta a propósito para ver el aviso.
  await page.route('**/functions/v1/ocr-albaran', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"lectura cortada por la prueba"}' }))
  await page.goto(`/conta/documentos?mes=${MES}`)
  await page.locator('input[data-prueba="subir-ficheros"]').setInputFiles('tests/conta/d01/facturas-inventadas/f01-mercancia.pdf')
  await expect(page.getByRole('status').filter({ hasText: 'f01-mercancia.pdf' })).toContainText(/no ha entrado: no se ha podido leer/, { timeout: 30_000 })
  expect(errores).toEqual([])
})

test('Móvil: se sube con la cámara y «Está bien» queda bajo el pulgar', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'Solo en el móvil.')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/conta/documentos?mes=${MES}`)
  await expect(page.getByRole('button', { name: 'Hacer foto' })).toBeVisible()
  await expect(page.locator('input[capture="environment"]')).toHaveCount(1)
  await expect(page.locator('article', { hasText: 'Mayorista Prueba Alfa' })).toHaveCount(1)
  await page.locator('article', { hasText: 'Mayorista Prueba Alfa' }).getByRole('button', { name: /^Mirar/ }).click()
  const boton = page.getByRole('button', { name: 'Está bien · apuntar' })
  await expect(boton).toBeVisible()
  // Bajo el pulgar: en la mitad de abajo de la pantalla, sin desplazarse.
  const caja = await boton.boundingBox()
  expect(caja && caja.y > (page.viewportSize()!.height / 2)).toBe(true)
})

test('Frente C (?marca=contabilidad): ni Cocina ni «Folvy» en Documentos', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'contabilidad') })
  await page.goto(`/conta/documentos?mes=${MES}&marca=contabilidad`)
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible()
  await expect(page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' })).toHaveCount(1)
  await sinFolvyNiCocina(page, 'N22')
  if (lado(page) === 'ordenador') await expect(page.locator('th', { hasText: 'Lo que he entendido' })).toBeVisible()
  await capturar(page, 'n22-para-mirar-c')
  await page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' }).getByRole('button', { name: /^Mirar/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cómo se apunta' })).toContainText(/· \d{8}|cerrado|no tiene|Falta|asiento/, { timeout: 20_000 })
  await sinFolvyNiCocina(page, 'N23')
  await capturar(page, 'n23-revisar-c')
  expect(errores).toEqual([])
})
