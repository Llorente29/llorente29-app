/// <reference lib="dom" />
// tests/e2e/conta/d01/catcher.spec.ts
//
// E05 · Las facturas de riders de Catcher contra staging-conta, en ordenador
// (1440) y móvil (390), con la quincena INVENTADA de tests/conta/e05/ejemplo.ts
// (la forma de los ficheros reales; ni un rider de verdad). Capturas en
// docs/conta/capturas/d01-e05/.
//
// Datos: supabase/seeds/conta/seed_e05_staging.sql (Riders en la 41000100,
// Catcher con su 410, la 40700001, las tiendas → local y la tarifa), en la
// cuenta A. La limpieza del job (e2e_limpieza.sql) quita las quincenas de más
// de 30 minutos: la primera pasada la sube; la segunda (el otro tamaño de
// pantalla) la encuentra subida y lo dice.
//
// Los pedidos que «la app mandó a Catcher» los pone la prueba: staging no tiene
// ventas de Catcher y crearlas dispararía el despacho y la impresión (sale
// tiene esos disparadores, y staging es compartido). Se intercepta la lectura
// (conta_lote_pedidos_app) con los pedidos del ejemplo: todos entregados, al
// precio que Catcher cobra, y el G236 del 23/09 a las 16:29 cancelado. Así sale,
// solo, el caso real en «Por aclarar».

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'
import { EMPRESA, PEDIDOS, quincenaInventada } from '../../../conta/e05/ejemplo'
import { madridAUtc } from '../../../../src/modules/conta/lib/catcherQuincena'

const DIR = 'docs/conta/capturas/d01-e05'
/** La empresa de la cuenta A en staging (su NIF, inventado): las facturas del ejemplo van a su nombre. */
const EMPRESA_A = { ...EMPRESA, nif: 'B28000016' }
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
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

/** Ningún texto de lo nuevo nombra la marca. Solo lo nuevo: el resto de Documentos la enseña fuera de ?marca=contabilidad, a propósito. */
async function sinMarca(page: Page, donde: string, dentro = '.cx-principal') {
  const texto = await page.locator(dentro).innerText()
  expect(texto.split('\n').filter((l) => /folvy|sumied/i.test(l)).slice(0, 5), `la marca en ${donde}`).toEqual([])
}

/** Los pedidos que la app «mandó» a Catcher: uno por código y hora del ejemplo; el G236, cancelado. */
function pedidosDeLaApp() {
  const vistos = new Map<string, Record<string, unknown>>()
  let i = 0
  for (const [, tipo, codigo, estado, f, base] of PEDIDOS) {
    const [dia, hora] = f.split(' ')
    const [a, m, d] = dia.split('-').map(Number)
    const [h, mi] = hora.split(':').map(Number)
    const momento = madridAUtc(a, m, d, h, mi)
    const k = `${codigo}|${momento}`
    if (vistos.has(k) && /commission/.test(tipo)) continue
    vistos.set(k, {
      id: enCarril(`e05e0000-0000-4000-8000-${String(++i).padStart(12, '0')}`), codigo, momento, localId: null, marcaId: null, canalId: null,
      estado: estado === 'canceled' ? 'canceled' : 'delivered', precio: /commission/.test(tipo) ? 0 : base,
    })
  }
  return [...vistos.values()]
}

test('Cuenta A: la quincena de Catcher se sube, se cruza y deja «Por aclarar» el G236; el pago y el saldo prepago', async ({ page }) => {
  test.setTimeout(180_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.route('**/rest/v1/rpc/conta_lote_pedidos_app', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pedidosDeLaApp()) }))

  // 0 · S02 · PR 3: Facturas recibidas ya no la enseña al final (cada cosa en un sitio).
  await page.goto('/conta/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/Sube la quincena de Catcher/)).toHaveCount(0)

  // 1 · Compras y gastos › Liquidaciones: el saldo prepago a la vista, y «Subir
  // quincena de Catcher» abre la zona de arrastre; lo leído, antes de subir nada.
  await page.goto('/conta/compras/liquidaciones')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  const saldoArriba = page.locator('[data-prueba="saldo-prepago"]')
  await expect(saldoArriba).toContainText('Saldo prepago Catcher · 40700001.', { timeout: 30_000 })
  await expect(saldoArriba).toContainText(/Te quedan −?[\d.]+,\d\d\s€: has recargado [\d.]+,\d\d\s€ y se han pagado [\d.]+,\d\d\s€\./)
  await page.getByRole('button', { name: 'Subir quincena de Catcher' }).first().click()
  const bloque = page.locator('section.cxk-quincena')
  await expect(bloque.getByText('Sube la quincena de Catcher')).toBeVisible({ timeout: 30_000 })
  await page.locator('input[data-prueba="subir-catcher"]').setInputFiles(quincenaInventada(EMPRESA_A).map((f) => ({
    name: f.nombre, buffer: Buffer.from(f.bytes),
    mimeType: f.nombre.endsWith('.zip') ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })))
  await expect(bloque.getByText(/^2\.ª quincena de septiembre de 2026 · 5 facturas · 54,69 €$/)).toBeVisible({ timeout: 30_000 })
  await expect(bloque.getByText('3 riders · 1 flota · 1 de Catcher · 19 pedidos en el Excel')).toBeVisible()
  await sinMarca(page, 'Documentos con la quincena leída', 'section.cxk-quincena')
  await capturar(page, 'catcher-leida')

  // 2 · Subir y cruzar: dice lo que ha hecho (o que ya estaba).
  await bloque.getByRole('button', { name: 'Subir y cruzar con los pedidos' }).click()
  const estado = bloque.getByRole('status')
  await expect(estado).toContainText(/Subida la 2\.ª quincena de septiembre de 2026: 5 facturas \(54,69 €\)|La 2\.ª quincena de septiembre de 2026 ya estaba subida/, { timeout: 90_000 })
  if (/Subida la/.test(await estado.innerText())) await expect(estado).toContainText('Cruzada la 2.ª quincena de septiembre de 2026: 5 facturas, 4 cuadran y 1 por aclarar (1 cosa que mirar).', { timeout: 60_000 })
  // S02 · PR 3: la quincena sale en la lista de Liquidaciones, con su importe y su estado.
  const fila = page.locator('[data-fila^="catcher:"]', { hasText: '2.ª quincena de septiembre de 2026' })
  await expect(fila).toHaveCount(1, { timeout: 30_000 })
  await expect(fila).toContainText('54,69')
  await expect(fila).toContainText(/por aclarar|reclamad|Falta el pago|pago propuesto/)
  await capturar(page, 'catcher-subida')

  // 3 · La quincena (al pulsar su fila): resumen, «Por aclarar» con el G236 y las facturas por grupos.
  await fila.click()
  await expect(page.locator('nav.cxp-migas').getByRole('link', { name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: '2.ª quincena de septiembre de 2026' })).toBeVisible({ timeout: 30_000 })
  // Lo que dice la quincena (no el aviso de staging, que también es un role=status).
  const dice = page.locator('[data-prueba="hecho-quincena"]')
  if (!(await page.locator('[data-prueba="cosa-por-aclarar"]').count())) {
    await page.getByRole('button', { name: 'Volver a comprobar' }).click()
    await expect(dice).toContainText('Cruzada la 2.ª quincena de septiembre de 2026', { timeout: 60_000 })
  }
  const g236 = page.locator('[data-prueba="cosa-por-aclarar"]', { hasText: 'G236' })
  await expect(g236).toContainText('G236 del 23/09 a las 16:29: cancelado, con comisión cobrada (0,79 €) y ningún rider que lo facture.')
  // Si otra pasada la dejó decidida (staging es compartido), se vuelve a abrir antes.
  if (await g236.getByRole('button', { name: 'Volver a abrir' }).count()) {
    await g236.getByRole('button', { name: 'Volver a abrir' }).click()
    await expect(dice).toContainText('Vuelto a abrir (G236).', { timeout: 30_000 })
  }
  await expect(page.locator('[data-prueba="cosa-por-aclarar"]')).toHaveCount(1)
  for (const g of ['Riders', 'Flotas', 'Catcher']) await expect(page.getByRole('region', { name: g, exact: true })).toBeVisible()
  // Retoque 6: bajo el título, solo si cuadra; y en el G236, la frase sin un título que diga lo mismo.
  await expect(page.locator('[data-prueba="cuadra"]')).toHaveText('Cuadra con los pedidos salvo 1')
  await expect(g236.locator('.cxk-pedido')).toHaveCount(0)
  // Retoque 3: la comisión que no cuadra, dicha.
  await expect(page.locator('.cxk-diferencia')).toHaveText('0,79 € de más')
  // Retoque 1: abierta, las cuatro dicen «por aclarar».
  // Singular y plural (15/10): «1 flota · 1 de Catcher».
  await expect(page.locator('.cxk-cifras')).toContainText('3 riders · 1 flota · 1 de Catcher')
  const tarjeta = page.locator('[data-prueba="tarjeta-por-aclarar"]')
  const bloqueCatcher = page.getByRole('region', { name: 'Catcher', exact: true })
  await expect(tarjeta).toContainText('Por aclarar1')
  await expect(bloqueCatcher.locator('h3')).toContainText('1 por aclarar')
  await expect(bloqueCatcher).toContainText('Por aclarar (1)')
  await sinMarca(page, 'la quincena')
  await capturar(page, 'catcher-quincena')

  // 4 · Reclamar (diciendo qué) y volver a abrir: cada botón dice lo que ha hecho.
  await g236.getByRole('button', { name: 'Reclamar' }).click()
  await g236.getByLabel('Qué se reclama a Catcher').fill('La comisión de un pedido cancelado')
  await g236.getByRole('button', { name: 'Apuntar la reclamación' }).click()
  await expect(dice).toContainText('Apuntado para reclamar a Catcher (G236). A su factura le queda 1 cosa.', { timeout: 30_000 })
  await expect(g236).toContainText('Reclamada a Catcher')
  // Retoque 1: reclamada, las cuatro dicen «Reclamada» y ninguna «por aclarar».
  await expect(tarjeta).toContainText('Por aclarar0')
  await expect(tarjeta).toContainText('1 reclamada · 0 dadas por buenas')
  await expect(bloqueCatcher.locator('h3')).toContainText('1 reclamada')
  await expect(bloqueCatcher).not.toContainText(/por aclarar/i)
  await expect(bloqueCatcher).toContainText('Reclamada')
  await expect(page.locator('[data-prueba="cuadra"]')).toHaveText('Cuadra con los pedidos salvo 1 (1 reclamada)')
  await capturar(page, 'catcher-reclamada')
  await g236.getByRole('button', { name: 'Volver a abrir' }).click()
  await expect(dice).toContainText('Vuelto a abrir (G236).', { timeout: 30_000 })

  // 5 · El pago contra la 40700001 (una vez) y el saldo del portal.
  const pagar = page.getByRole('button', { name: 'Proponer el pago desde la 40700001' })
  // La otra pasada ya lo pudo proponer: entonces el botón ya dice «Pago propuesto».
  if (await pagar.count() && await pagar.isEnabled()) {
    await pagar.click()
    await expect(dice).toContainText('Propuesto el pago de la 2.ª quincena de septiembre de 2026: 5 facturas, 54,69 € desde la 40700001 «Saldo prepago Catcher» (serie 3).', { timeout: 30_000 })
  }
  // Retoque 5: el pago propuesto se ve hecho, y lleva a su asiento.
  const asiento = page.getByRole('link', { name: '✓ Pago propuesto · Ver asiento' })
  await expect(asiento).toBeVisible({ timeout: 30_000 })
  await expect(asiento).toHaveAttribute('href', /\/conta\/.+/)
  const saldo = page.locator('section.cxk-saldo')
  await expect(saldo).toContainText('Saldo prepago Catcher')
  // Retoque 2: en palabras, y lo sin validar aparte.
  await expect(saldo.locator('[data-prueba="saldo-frase"]')).toHaveText(/^Has recargado [\d.]+,\d\d € · se han pagado [\d.]+,\d\d € · te quedan −?[\d.]+,\d\d €$/)
  await expect(saldo.locator('[data-prueba="saldo-sin-validar"]')).toHaveText(/^De esos pagos, [\d.]+,\d\d € aún sin validar\.$/)
  await saldo.locator('input[data-prueba="saldo-portal"]').fill('100,00')
  await saldo.getByRole('button', { name: 'Comprobar' }).click()
  await expect(saldo.getByRole('status')).toContainText(/^No coincide: el portal dice 100,00 € y la 40700001 /, { timeout: 30_000 })
  await capturar(page, 'catcher-pago-y-saldo')

  expect(errores).toEqual([])
})
