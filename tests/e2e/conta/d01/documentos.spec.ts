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
import { readFileSync } from 'node:fs'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, type Sesion, enCarril } from '../sesion'
import { rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/d01'
const MES = '2026-10'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/**
 * El papel de la factura de la semilla (Mayorista Prueba Alfa, F-2026-1022),
 * inventado con sus mismas cifras (scripts/conta/d01/generar-papel-semilla.mjs):
 * se sube a su ruta fija y se enlaza a la factura. Si ya estaba, sigue.
 */
async function ponerPapelDeLaSemilla(s: Sesion) {
  // «-nif»: el papel con el NIF inventado que pasa el carácter de control (R12/R6, 14/10). Una ruta nueva para que no se quede el viejo.
  const ruta = `${CUENTA_A.id}/d01-semilla/semilla-f-2026-1022-nif.pdf`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
    body: readFileSync('tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'),
  })
  const t = await r.text()
  expect(r.ok || /exists|duplicate/i.test(t), `subir el papel de la semilla: ${r.status} ${t.slice(0, 200)}`).toBe(true)
  const p = await rest(s, 'PATCH', `supplier_invoice?id=eq.${enCarril('d0100000-0000-4000-8000-0000000000f1')}`, { raw_document_url: ruta })
  expect(p.status, JSON.stringify(p.datos)).toBe(200)
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  // R5 · 10: sin la barra de la IA, en el ordenador no queda nada flotante que mida
  // (como en B01). En el móvil sigue la barra de abajo, y se mide.
  if (await page.locator(FLOTANTES_CONTA.join(', ')).count() === 0) expect(lado(page)).toBe('ordenador')
  else expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
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
/**
 * Cuenta C: ni «Volver a Folvy» en el menú del ordenador ni «‹ Folvy» en la
 * barra del móvil (vienen del marco común; lo arregla la C06 de main con
 * useProductoSolo). Se mira la página ENTERA, no solo la zona principal.
 */
async function sinVolverAFolvy(page: Page, donde: string) {
  await expect(page.getByRole('link', { name: /Volver a Folvy/ }), `«Volver a Folvy» en ${donde}`).toHaveCount(0)
  await expect(page.locator('.cx-barra-inferior a[href="/"], .s-barra-inferior a[href="/"]'), `«‹ Folvy» en la barra de ${donde}`).toHaveCount(0)
  const texto = await page.locator('body').innerText()
  expect(texto.split('\n').filter((l) => /folvy/i.test(l)).slice(0, 5), `«Folvy» en la página de ${donde}`).toEqual([])
}

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
  await ponerPapelDeLaSemilla(await entrarComo(page, CUENTA_A.email))
  const errores = vigilar(page)
  await page.goto(`/conta/documentos?mes=${MES}`)
  // S01 · paso 3: Compras y gastos › Facturas recibidas (el título, en la cabecera del esqueleto).
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toHaveCount(1)
  // La banda de la IA dice lo que ha pasado en una frase.
  // R5 · 8: del mes elegido, no de «esta semana».
  const bandaN22 = page.getByRole('region', { name: 'Lo que ha pasado con tus facturas' })
  await expect(bandaN22).toContainText(/Han llegado \d+ facturas en octubre|Ha llegado 1 factura en octubre|En octubre no ha llegado ninguna/)
  await expect(bandaN22).not.toContainText('semana')
  // R5 · 10: sin la barra «Pregunta o pide algo» (ni el botón de la IA en el móvil) mientras solo diga «Muy pronto».
  await expect(page.locator('.cx-pregunta, .cx-barra-ia')).toHaveCount(0)
  // Las cinco cifras.
  for (const c of ['Llegadas en octubre', 'Apuntadas solas', 'Para mirar', 'Por aclarar', 'Esperadas y no llegadas']) {
    await expect(page.locator('.cxr-cifra', { hasText: c })).toBeVisible()
  }
  // «Para mirar»: las dos de la semilla, cada una con su porqué y un solo botón.
  const alfa = page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' })
  await expect(alfa).toHaveCount(1)
  await expect(alfa).toContainText('F-2026-1022')
  // R5 · 7: en minúscula y lo que pasó de verdad. R5 · 9: en el móvil, la fecha junto al número.
  await expect(alfa).toContainText(lado(page) === 'movil' ? 'F-2026-1022 · 11/10 · llegó por correo' : 'F-2026-1022 · llegó por correo')
  await expect(page.locator('.cxr-tabla, .cxr-tarjetas')).not.toContainText(/llegó por a mano|llegó por Subida|llegó por Correo/)
  // R5 · 6: cada fila de «Para mirar» con su porqué (ninguna se queda en «Sin cuenta de gasto todavía» a secas).
  // R5b: el total de la fila, en la letra de la app con cifras tabulares (no en la monoespaciada).
  const totalFila = alfa.locator(lado(page) === 'movil' ? '.cx-cifra' : '.cxr-der').first()
  await expect(totalFila).toHaveCSS('font-variant-numeric', 'tabular-nums')
  expect(await totalFila.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i)
  const filasN22 = page.locator('.cxr-tabla tbody tr:not(:has(.cxr-vacio)), .cxr-tarjetas article')
  const nFilas = await filasN22.count()
  expect(nFilas).toBeGreaterThan(0)
  for (let i = 0; i < nFilas; i++) await expect(filasN22.nth(i).locator('.cxr-entendido .cxr-apoyo')).not.toHaveText('')
  if (lado(page) === 'movil') {
    // R5 · 9: las cuatro pestañas caben: «Todas» entera dentro de la pantalla.
    const todas = await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Todas' }).boundingBox()
    expect(todas && todas.x + todas.width <= page.viewportSize()!.width).toBe(true)
  }
  await expect(alfa).toContainText(/· 60000000/)
  await expect(alfa.getByRole('button')).toHaveCount(1)
  await expect(page.locator('tr, article', { hasText: 'Suministros Eléctricos Prueba Norte' })).toHaveCount(1)
  // La barra de la N22, en la cinta de la pestaña (paso 3): TRAER · ESPERADAS · LEÍDAS.
  if (lado(page) === 'ordenador') {
    const cinta = page.getByRole('toolbar', { name: 'Acciones de Facturas recibidas' })
    for (const g of ['Traer', 'Esperadas', 'Leídas']) await expect(cinta.getByRole('group', { name: g })).toBeVisible()
    await expect(cinta.getByRole('button', { name: /^Subir/ })).toBeVisible()
  }
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
  // R5 · 1: el vencimiento del papel («Vencimiento: 10/11/2026 · transferencia») manda.
  await expect(leido).toContainText('10/11/2026')
  await expect(leido).toContainText('lo dice la factura')
  await expect(leido).not.toContainText('sin vencimiento')
  // R5 · 5: la banda en ámbar mientras no esté apuntada. R5 · 10: sin la barra de la IA.
  await expect(page.locator('.cx-ia-bloque.cxr-ia-ambar')).toHaveCount(1)
  await expect(page.locator('.cx-pregunta, .cx-barra-ia')).toHaveCount(0)
  // «Cómo se apunta»: la propuesta de verdad, con nombre · código; o por qué no sale.
  const comoN23 = page.getByRole('region', { name: 'Cómo se apunta' })
  await expect(comoN23).toContainText(/· 60000000|·\s*4000\d+|periodo cerrado|no tiene|Falta/, { timeout: 20_000 })
  // R5 · 2 y 3: no promete «a Diez con su PDF», y las cifras van en dos columnas con su título.
  await expect(comoN23).not.toContainText('con su PDF')
  if (await comoN23.getByText('· 60000000').count()) {
    // R5b: las cifras tabulares en la letra de la app; y el nombre de la cuenta no se corta (ni «…» ni desborde).
    const cifra = comoN23.locator('.cxr-der').filter({ hasText: '€' }).first()
    await expect(cifra).toHaveCSS('font-variant-numeric', 'tabular-nums')
    expect(await cifra.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i)
    for (const c of await comoN23.locator('.cxr-apunte-cuenta').all()) {
      expect(await c.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis')).toBe(true)
      await expect(c).toContainText(/· \d{8}/)
    }
    await expect(comoN23).toContainText('a Diez irá cuando Cegid active los documentos')
    await expect(comoN23).toContainText('Gasto e IVA')
    await expect(comoN23).toContainText('A pagar')
  }
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toBeEnabled()
  // El papel a la izquierda, pintado (no «no tiene papel» ni «no he podido pintar»).
  const papel = page.getByRole('region', { name: 'La factura tal como llegó' })
  await expect(papel.getByRole('img', { name: /La factura F-2026-1022/ })).toBeVisible()
  await expect(papel).not.toContainText(/no tiene papel|No he podido pintar/, { timeout: 15_000 })
  await page.waitForTimeout(500)
  if (lado(page) === 'movil') {
    // R5 · 4: en el móvil, el papel recortado a lo escrito (unos 280 px como mucho), y entero al tocarlo.
    const recorte = papel.locator('.cxr-papel-recorte')
    const antes = (await recorte.boundingBox())!.height
    expect(antes).toBeLessThanOrEqual(282)
    await papel.getByRole('button', { name: 'Ver el papel entero' }).click()
    await expect.poll(async () => (await recorte.boundingBox())!.height).toBeGreaterThan(antes + 50)
    await papel.getByRole('button', { name: 'Recoger el papel' }).click()
    await expect.poll(async () => (await recorte.boundingBox())!.height).toBeLessThanOrEqual(282)
  }
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
  await ponerPapelDeLaSemilla(await entrarComo(page, CUENTA_A.email))
  const errores = vigilar(page)
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'contabilidad') })
  await page.goto(`/conta/documentos?mes=${MES}&marca=contabilidad`)
  // S01 · paso 3: Compras y gastos › Facturas recibidas (el título, en la cabecera del esqueleto).
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toHaveCount(1)
  await expect(page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' })).toHaveCount(1)
  await sinFolvyNiCocina(page, 'N22')
  await sinVolverAFolvy(page, 'N22')
  if (lado(page) === 'ordenador') await expect(page.locator('th', { hasText: 'Lo que he entendido' })).toBeVisible()
  await capturar(page, 'n22-para-mirar-c')
  await page.locator('tr, article', { hasText: 'Mayorista Prueba Alfa' }).getByRole('button', { name: /^Mirar/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cómo se apunta' })).toContainText(/· \d{8}|cerrado|no tiene|Falta|asiento/, { timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'La factura tal como llegó' }).getByRole('img')).toBeVisible()
  await page.waitForTimeout(500)
  await sinFolvyNiCocina(page, 'N23')
  await sinVolverAFolvy(page, 'N23')
  await capturar(page, 'n23-revisar-c')
  expect(errores).toEqual([])
})
