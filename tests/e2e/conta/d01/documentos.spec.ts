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
// No apunta nada (no pulsa «Validar y siguiente»: el libro de A es compartido).
// Sí sube una factura inventada con la lectura cortada a propósito, para ver
// que la pantalla DICE que no ha entrado (regla 8); el mismo fichero no se
// registra dos veces.
//
// S02 · PR 1: N22 es ahora la plantilla Lista («Facturas recibidas», pestañas
// de estado que suman «Todas», filtros y tabla) y N23 la plantilla Ficha (el
// veredicto, sus bloques y el documento a la derecha). Lo que estas pruebas
// comprobaban de la banda de la IA, las cinco cifras, la cinta, «Lo que he
// leído» y «Cómo se apunta» se comprueba donde vive ahora; cada cambio lleva
// su «S02:» con el porqué.

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
  // (como en B01). S01c: tampoco en el móvil (el menú es un cajón). Si alguna
  // pantalla vuelve a pintar una pieza flotante, se mide.
  if (await page.locator(FLOTANTES_CONTA.join(', ')).count() > 0) expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
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

/** La fila de una factura en la lista: en el ordenador, la fila de la tabla; en el móvil, su tarjeta. */
const filaDe = (page: Page, texto: string) =>
  page.locator('table.s-lista-tabla tbody tr, .s-lista-tarjetas [role="listitem"]').filter({ hasText: texto })

/** Una pestaña de estado por su nombre («Todas 5» → 'Todas'): el número va dentro del botón. */
const pestana = (page: Page, nombre: string) =>
  page.getByRole('tablist', { name: 'Estado de las facturas' }).getByRole('tab', { name: new RegExp(`^${nombre}\\s*[\\d.]*$`) })

/** El número de una pestaña, en cifras («1.234» → 1234). */
async function numeroDe(tab: ReturnType<Page['locator']>): Promise<number> {
  return Number(((await tab.locator('.s-pestana-estado-n').textContent()) ?? '').replace(/\D/g, ''))
}

/**
 * El documento de la ficha se pliega y se recuerda por persona
 * (conta_user_pref.documento_oculto). La cuenta A es compartida: si otra
 * prueba lo dejó plegado, se vuelve a enseñar antes de mirar el PDF.
 */
async function documentoALaVista(page: Page) {
  const documento = page.getByRole('complementary', { name: 'Documento' })
  const mostrar = documento.getByRole('button', { name: 'Documento', exact: true })
  if (await mostrar.count()) await mostrar.click()
  return documento
}

test('Cuenta A: N22 con sus filas y su porqué, N23 con el papel y «Validar y siguiente»', async ({ page }) => {
  await ponerPapelDeLaSemilla(await entrarComo(page, CUENTA_A.email))
  const errores = vigilar(page)
  const movil = lado(page) === 'movil'
  await page.goto(`/conta/documentos?mes=${MES}`)
  // S02: Compras y gastos › Facturas recibidas, con su h1 visible en el encabezado de la página.
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toHaveCount(1)
  // S02: la banda de la IA («Han llegado N facturas en octubre») ya no existe a
  // propósito: lo que la lista tiene lo dice el pie («N facturas por revisar ·
  // Base … · IVA … · Total …») de lo que se ve, del mes elegido en el filtro de
  // fecha y nunca de «esta semana» (R5 · 8).
  const pie = page.locator('.s-lista-pie')
  await expect(pie).toContainText(/^\d+ facturas? por revisar/)
  await expect(pie).toContainText('Total')
  await expect(pie).not.toContainText('semana')
  // R5 · 10: sin la barra «Pregunta o pide algo» (ni el botón de la IA en el móvil) mientras solo diga «Muy pronto».
  await expect(page.locator('.cx-pregunta, .cx-barra-ia')).toHaveCount(0)
  // S02: las cinco cifras («Llegadas en…», «Apuntadas solas»…) son ahora las
  // pestañas de estado con su número, y suman «Todas» (regla 7: cada factura
  // cae en una, ninguna se queda fuera). De serie, «Por revisar».
  const pestanas = page.getByRole('tablist', { name: 'Estado de las facturas' })
  await expect(pestana(page, 'Por revisar')).toHaveAttribute('aria-selected', 'true')
  for (const p of ['Todas', 'Por revisar', 'Por pagar', 'Pagadas']) await expect(pestana(page, p)).toBeVisible()
  const tabs = await pestanas.getByRole('tab').all()
  let suma = 0
  for (const t of tabs.slice(1)) suma += await numeroDe(t)
  expect(suma, 'las pestañas suman «Todas»').toBe(await numeroDe(tabs[0]))
  // «Por revisar»: las dos de la semilla, cada una con su porqué y un solo botón.
  const alfa = filaDe(page, 'Mayorista Prueba Alfa')
  await expect(alfa).toHaveCount(1)
  await expect(alfa).toContainText('F-2026-1022')
  // R5 · 9: la fecha junto al número (en el móvil, en la línea de debajo de la
  // tarjeta). S02: «llegó por correo» ya no va en la fila: lo dice la frase de
  // la ficha («Llegó por correo el …», se mira abajo) y el filtro «Cómo llegó».
  await expect(alfa).toContainText(movil ? 'F-2026-1022 · 11/10' : '11/10')
  // R5b: el total de la fila, en la letra de la app con cifras tabulares (no en la monoespaciada).
  const totalFila = alfa.locator(movil ? '.s-tarjeta-cabeza .s-cifra' : 'td.s-lista-cifra').last()
  await expect(totalFila).toHaveCSS('font-variant-numeric', 'tabular-nums')
  expect(await totalFila.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i)
  // R5 · 6: cada fila dice qué le pasa. S02: el porqué ya no va escrito en la
  // fila; va su estado en un chip («Por revisar», «Proveedor nuevo»…) y, si hay
  // cuenta propuesta, «Propuesto: <cuenta>» con su porqué al pasar por encima.
  const filasN22 = page.locator('table.s-lista-tabla tbody tr:not(:has(.s-lista-vacia)), .s-lista-tarjetas [role="listitem"]')
  const nFilas = await filasN22.count()
  expect(nFilas).toBeGreaterThan(0)
  for (let i = 0; i < nFilas; i++) {
    await expect(filasN22.nth(i).locator('.s-chip').first()).not.toHaveText('')
    const propuesto = filasN22.nth(i).locator('.s-lista-propuesto')
    if (await propuesto.count()) expect(await propuesto.getAttribute('title'), `el porqué de la fila ${i + 1}`).toBeTruthy()
  }
  if (movil) {
    // R5 · 9: las pestañas caben: «Todas» entera dentro de la pantalla.
    const todas = await pestana(page, 'Todas').boundingBox()
    expect(todas && todas.x + todas.width <= page.viewportSize()!.width).toBe(true)
  }
  // S02: debajo del proveedor, la cuenta propuesta por su nombre («Propuesto:
  // …»); su número (60000000) se ve en la ficha, en «A qué gasto va».
  await expect(alfa).toContainText('Propuesto:')
  await expect(alfa.getByRole('button')).toHaveCount(1)
  await expect(filaDe(page, 'Suministros Eléctricos Prueba Norte')).toHaveCount(1)
  // S02: la cinta (los grupos «Cómo llegan», «Las que faltan»… y «Subir varias
  // a la vez») ya no existe a propósito. La lista lleva su encabezado: un
  // principal, «Subir factura»; «Exportar» en blanco; y lo demás en «Más
  // acciones». Nada sale dos veces: el marco no pinta su fila de acciones.
  await expect(page.getByRole('toolbar', { name: 'Acciones de Facturas recibidas' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Subir factura' })).toHaveCount(1)
  if (!movil) {
    await expect(page.locator('header.s-encabezado').getByRole('button', { name: 'Subir factura' })).toBeVisible()
    await expect(page.locator('header.s-encabezado').getByRole('button', { name: 'Exportar' })).toBeVisible()
    await page.locator('header.s-encabezado').getByRole('button', { name: 'Más acciones' }).click()
    await expect(page.getByRole('group', { name: 'Más acciones' }).getByRole('link', { name: /Escribir una a mano/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Más acciones' })).toHaveCount(0)
  }
  // S02: el mes ya no está en la cabecera: es el filtro «Fecha» de la lista, escrito entero («Octubre 2026»).
  await expect(page.getByRole('combobox', { name: 'Mes' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Filtros de las facturas' }).getByRole('combobox', { name: 'Fecha' }).locator('option:checked')).toHaveText('Octubre 2026')
  // La miga acaba en lo que dice el título. S02: la pestaña de estado ya no es
  // una miga ni un h2: es la pestaña marcada (arriba).
  const migas = page.getByRole('navigation', { name: 'Estás en' })
  await expect(migas.getByRole('link', { name: 'Compras y gastos' })).toBeVisible()
  await expect(migas.locator('[aria-current="page"]')).toHaveText('Facturas recibidas')
  await capturar(page, 'n22-para-mirar-a')

  // «Por aclarar»: la que no tiene emisor reconocido. S02: «Decirlo yo» ya no
  // está en la fila; la fila dice «Proveedor nuevo» y, al abrirla, la ficha
  // pregunta «¿De quién es?» con el proveedor y «Es este».
  await pestana(page, 'Por aclarar').click()
  await expect(page).toHaveURL(/[?&]ver=por-aclarar/)
  // S02: la fila enseña el nombre tal como se leyó del papel (o «No reconozco el
  // emisor» si no se leyó ninguno); lo que dice que no está en tus proveedores es
  // su chip «Proveedor nuevo».
  const sin = filaDe(page, 'Proveedor nuevo')
  await expect(sin.first()).toBeVisible()
  await sin.first().getByRole('button').click()
  // Ficha completa (tablero 3b): el proveedor se elige en su campo, en «Proveedor y
  // factura», como todo lo demás; se confirma con «Guardar cambios» (ya no «Es este»).
  const deQuien = page.getByRole('region', { name: 'Proveedor y factura' })
  await expect(deQuien.getByRole('combobox', { name: 'Proveedor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Es este' })).toHaveCount(0)
  // Esc vuelve a la lista como se dejó: la pestaña, el filtro y la fila marcada.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/conta\/documentos\?.*ver=por-aclarar/)
  await expect(page.locator('table.s-lista-tabla tr[data-actual], .s-lista-tarjetas [data-actual]')).toHaveCount(1)
  // «Todas» trae todas (regla 7).
  await pestana(page, 'Todas').click()
  await expect(filaDe(page, 'Mayorista Prueba Alfa')).toHaveCount(1)
  await expect(filaDe(page, 'Proveedor nuevo').first()).toBeVisible()

  // N23.
  await pestana(page, 'Por revisar').click()
  await filaDe(page, 'Mayorista Prueba Alfa').getByRole('button').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Estás en' }).locator('[aria-current="page"]')).toHaveText('Mayorista Prueba Alfa F-2026-1022')
  // S02: «Llegó por correo», en la frase de debajo del título (R5 · 7: en
  // palabras normales, nunca «llegó por a mano» ni «por Subida»).
  const frase = page.locator('p.s-frase-pagina')
  await expect(frase).toHaveText(/^Llegó por correo/)
  await expect(frase).not.toContainText(/llegó por a mano|llegó por Subida|llegó por Correo/)
  // S02: «Lo que he leído» ya no existe; lo que decía va en sus bloques.
  // Ficha completa (tablero 3b): «Importes por tipo de IVA», una línea por tipo con
  // base, tipo y cuota que se editan, y debajo base, IVA y total contra el PDF.
  const importes = page.getByRole('region', { name: 'Importes por tipo de IVA' })
  await expect(importes.getByRole('combobox', { name: 'Tipo de IVA de la línea 1' })).toHaveValue('10')
  // En el campo, sin punto de miles (se escribe en él); en los totales, con él.
  await expect(importes.getByLabel('Base al 10 %')).toHaveValue('1283,15')
  await expect(importes.locator('[data-prueba="totales-iva"]')).toContainText('1.283,15')
  await expect(importes.locator('[data-prueba="totales-iva"]')).toContainText('1.411,47 €')
  const gasto = page.getByRole('region', { name: 'A qué gasto va' })
  await expect(gasto).toContainText('60000000')
  // «elegida en su ficha»: el motivo de la cuenta, en palabras.
  await expect(gasto).toContainText('Es la cuenta de su ficha')
  // R5 · 1: el vencimiento del papel («Vencimiento: 10/11/2026 · transferencia»)
  // manda. S02: va en «A qué gasto va» o, con locales, en «Pago».
  const datosFicha = page.locator('.s-ficha-datos')
  // Ficha completa: el vencimiento es un campo que se edita, en «Pago».
  await expect(page.getByRole('region', { name: 'Pago' }).getByLabel('Vence', { exact: true })).toHaveValue('10/11/2026')
  await expect(datosFicha).toContainText(/lo dice la factura/i)
  await expect(datosFicha).not.toContainText('sin vencimiento')
  // R5 · 5: mientras no esté apuntada, el veredicto no está en verde. S02: la
  // banda ámbar es ahora el veredicto, con su título y su «Por qué».
  const veredicto = page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ })
  await expect(veredicto).toBeVisible()
  await expect(veredicto.getByRole('heading', { level: 2 })).toHaveText(/^(Lista para contabilizar|Revisa esto|No encaja)$/, { timeout: 20_000 })
  await expect(veredicto).not.toHaveAttribute('data-tono', 'seguro')
  await expect(page.locator('.cx-pregunta, .cx-barra-ia')).toHaveCount(0)
  // «Cómo se apunta» → S02: «El asiento que se crea», abajo: la propuesta de
  // verdad, con el número de cada cuenta; o por qué no sale.
  const asiento = page.locator('details.s-asiento-ficha')
  await expect(asiento.locator('summary')).toHaveText('El asiento que se crea')
  await expect(asiento).toContainText(/60000000|4000\d+|periodo cerrado|no tiene|Falta/, { timeout: 20_000 })
  // R5 · 2: no promete «a Diez con su PDF».
  await expect(asiento).not.toContainText('con su PDF')
  if (await asiento.getByText('60000000').count()) {
    // R5b: las cifras tabulares en la letra de la app; y el nombre de la cuenta no se corta (ni «…» ni desborde).
    const cifra = asiento.locator('td.s-lista-cifra').filter({ hasText: /\d/ }).first()
    await expect(cifra).toHaveCSS('font-variant-numeric', 'tabular-nums')
    expect(await cifra.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i)
    for (const c of await asiento.locator('.s-asiento-cuenta').all()) {
      expect(await c.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis')).toBe(true)
    }
    for (const fila of await asiento.locator('tbody tr').all()) await expect(fila).toContainText(/\d{8}/)
    // R5 · 3: S02: las cifras en dos columnas con su título, Debe y Haber, y si cuadra.
    await expect(asiento.getByRole('columnheader', { name: 'Debe' })).toBeVisible()
    await expect(asiento.getByRole('columnheader', { name: 'Haber' })).toBeVisible()
    await expect(asiento).toContainText('Cuadra')
    // C07 (Julio, 22/10): A tiene «Enviar a Diez» apagado, así que el asiento que se crea no habla de Diez.
    await expect(asiento).not.toContainText('Diez')
  }
  // S02: «Está bien · apuntar» es ahora «Validar y siguiente», con Intro.
  const validar = page.getByRole('button', { name: /^Validar y siguiente/ })
  await expect(validar).toBeVisible()
  await expect(validar).toBeEnabled()
  await expect(validar).toHaveAttribute('aria-keyshortcuts', 'Enter')
  // El papel, pintado (no «no lo puedo enseñar» ni «no he podido pintar»).
  // S02: a la derecha, en «Documento».
  const papel = await documentoALaVista(page)
  await expect(papel.getByRole('img', { name: /La factura F-2026-1022/ })).toBeVisible()
  await expect(papel).not.toContainText(/no lo puedo enseñar|no se ha podido abrir|No he podido pintar/, { timeout: 15_000 })
  await page.waitForTimeout(500)
  if (movil) {
    // R5 · 4: en el móvil, el papel no se come la pantalla, y se ve entero al
    // pedirlo. S02: el recorte a la tinta («Ver la factura entera» / «Recoger
    // la factura») es ahora la caja del documento (60 % del alto como mucho)
    // y «Pantalla completa» / «Salir de pantalla completa».
    const alto = page.viewportSize()!.height
    const antes = (await papel.boundingBox())!.height
    expect(antes).toBeLessThanOrEqual(alto * 0.6 + 2)
    await papel.getByRole('button', { name: 'Pantalla completa' }).click()
    await expect.poll(async () => (await papel.boundingBox())!.height).toBeGreaterThan(antes + 50)
    await papel.getByRole('button', { name: 'Salir de pantalla completa' }).click()
    await expect.poll(async () => (await papel.boundingBox())!.height).toBeLessThanOrEqual(alto * 0.6 + 2)
  }
  await capturar(page, 'n23-revisar-a')
  // Ficha completa (tablero 3b): «Más acciones» trae Cambiar el PDF · Marcar como
  // duplicada · Descartar con motivo · Ver el historial. El proveedor se cambia en
  // su campo («Cambiar de proveedor»), no en un diálogo aparte.
  await page.locator('header.s-encabezado').getByRole('button', { name: 'Más acciones' }).click()
  const masAcciones = page.getByRole('group', { name: 'Más acciones' })
  for (const a of ['Cambiar el PDF', 'Marcar como duplicada', 'Descartar con motivo', 'Ver el historial']) await expect(masAcciones.getByRole('button', { name: a })).toBeVisible()
  await masAcciones.getByRole('button', { name: 'Descartar con motivo' }).click()
  await expect(page.getByRole('dialog', { name: 'Descartar con motivo' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Esc con el diálogo abierto cierra el diálogo, no la ficha.
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
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

test('Móvil: se sube con la cámara y «Validar y siguiente» queda bajo el pulgar', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'Solo en el móvil.')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/conta/documentos?mes=${MES}`)
  // S02: «Hacer foto» es ahora el principal de abajo, bajo el pulgar: «Subir
  // factura» abre la cámara (el input con capture).
  await expect(page.locator('.s-pulgar').getByRole('button', { name: 'Subir factura' })).toBeVisible()
  await expect(page.locator('input[capture="environment"]')).toHaveCount(1)
  const alfa = filaDe(page, 'Mayorista Prueba Alfa')
  await expect(alfa).toHaveCount(1)
  await alfa.getByRole('button').click()
  const boton = page.getByRole('button', { name: 'Validar y siguiente' })
  await expect(boton).toBeVisible()
  await expect(page.locator('.s-pulgar')).toContainText('Validar y siguiente')
  // Bajo el pulgar: en la mitad de abajo de la pantalla, sin desplazarse.
  const caja = await boton.boundingBox()
  expect(caja && caja.y > (page.viewportSize()!.height / 2)).toBe(true)
})

test('Frente C (?marca=contabilidad): ni Cocina ni «Folvy» en Documentos', async ({ page }) => {
  await ponerPapelDeLaSemilla(await entrarComo(page, CUENTA_A.email))
  const errores = vigilar(page)
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'contabilidad') })
  await page.goto(`/conta/documentos?mes=${MES}&marca=contabilidad`)
  // S02: Compras y gastos › Facturas recibidas, con su h1 en el encabezado de la página.
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toHaveCount(1)
  await expect(filaDe(page, 'Mayorista Prueba Alfa')).toHaveCount(1)
  await sinFolvyNiCocina(page, 'N22')
  await sinVolverAFolvy(page, 'N22')
  // S02: la columna «Lo que he entendido» ya no existe: lo entendido va bajo
  // el proveedor, «Propuesto: <cuenta>».
  if (lado(page) === 'ordenador') {
    await expect(page.getByRole('columnheader', { name: 'Proveedor' })).toBeVisible()
    await expect(filaDe(page, 'Mayorista Prueba Alfa')).toContainText('Propuesto:')
  }
  await capturar(page, 'n22-para-mirar-c')
  await filaDe(page, 'Mayorista Prueba Alfa').getByRole('button').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mayorista Prueba Alfa · F-2026-1022' })).toBeVisible()
  // S02: «Cómo se apunta» es «El asiento que se crea».
  await expect(page.locator('details.s-asiento-ficha')).toContainText(/\d{8}|cerrado|no tiene|Falta|asiento/, { timeout: 20_000 })
  await expect((await documentoALaVista(page)).getByRole('img', { name: /La factura F-2026-1022/ })).toBeVisible()
  await page.waitForTimeout(500)
  await sinFolvyNiCocina(page, 'N23')
  await sinVolverAFolvy(page, 'N23')
  await capturar(page, 'n23-revisar-c')
  expect(errores).toEqual([])
})
