// tests/e2e/conta/v04/tique.spec.ts
//
// V04 · PR 1 · El tique de la bolsa: el número y quién factura, en pantalla,
// en el ordenador y en el móvil.
//   1. «Ver tiques» de un pedido (la vista previa de Pedidos, que pinta la
//      MISMA imagen que imprime la tablet): una propia con quién factura en una
//      línea y el número de la serie del local; una cedida con los datos y el
//      número de la factura de Last; y una cedida sin la factura de Last, SIN la
//      línea de «Factura Simplificada». Cada foto, al lado de su tablero de la
//      maqueta aprobada (docs/folvy/v04/maqueta-tablero-1.png y -2.png).
//   2. Ajustes › «Facturas de los pedidos» (tablero 4): el estado de Verifactu
//      con el enlace a Sumied, la serie de cada local y su código (propuesto,
//      guardado con su frase), y las marcas propias y cedidas.
// Los pedidos son los de la semilla de reparto (Norte Centro, cuenta A). Lo
// fiscal de la base (fiscal_for_preview, ticket_invoice_ajustes y
// ticket_invoice_code_set) está SIMULADO en el navegador con la forma que
// devuelve la 2309: staging solo la ensaya en ROLLBACK hasta que se aplique en
// producción y se fusione. Lo que hace la base (el número, sin huecos, al
// imprimir; reimprimir, cerrar y cancelar) lo prueban la prueba de staging de
// la tanda y la unitaria de la serie contra un Postgres de verdad.

import { readFileSync, existsSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo } from '../sesion'

const DIR = 'docs/folvy/capturas/v04'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NORTE_CENTRO = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const PEDIDO = { propia: enCarril('e0300000-0000-4000-8000-0000000000a1'), cedida: enCarril('e0300000-0000-4000-8000-0000000000a4'), sinFactura: enCarril('e0300000-0000-4000-8000-0000000000a5') }

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const cuerpo = (r: Route) => (r.request().postDataJSON() ?? {}) as Record<string, unknown>

// Lo que devolvería fiscal_for_preview (2309) para cada pedido.
const FISCAL: Record<string, unknown> = {
  [PEDIDO.propia]: { legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', address: null, ticketNumber: 'CA26-000123', issuerKind: 'propia', sinFactura: false, serie: true, pendiente: false },
  [PEDIDO.cedida]: { legalName: 'CLOUDTOWN BRANDS SL', taxId: 'B67621425', address: 'Calle de Prueba, 1, 28001 Madrid', ticketNumber: 'LS53-9214', issuerKind: 'cedida', sinFactura: false, serie: false, pendiente: false },
  [PEDIDO.sinFactura]: { legalName: null, taxId: null, address: null, ticketNumber: null, issuerKind: 'cedida', sinFactura: true, serie: false, pendiente: false },
}

async function abrirPedidos(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/fiscal_for_preview\b/, (r) => json(r, FISCAL[String(cuerpo(r).p_sale_id)] ?? null))
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders')
  await expect(page.locator(`[data-testid="tarjeta-pedido"][data-sale-id="${PEDIDO.propia}"]`)).toBeVisible({ timeout: 30_000 })
}

/** Abre «Ver tiques» del pedido y devuelve la vista y la foto de la bolsa como sale en la impresora. */
async function tiqueDe(page: Page, saleId: string) {
  await page.locator(`[data-testid="tarjeta-pedido"][data-sale-id="${saleId}"]`).getByTitle('Tickets · reimprimir').click()
  const vista = page.getByTestId('ticket-preview')
  const img = vista.getByTestId('ticket-bolsa-impreso')
  await expect(img).toBeVisible({ timeout: 20_000 })
  return { vista, img }
}

/** La foto del tique al lado de su tablero de la maqueta, en una sola imagen. */
async function alLado(page: Page, tique: Buffer, tablero: string, nombre: string) {
  const maqueta = `docs/folvy/v04/${tablero}`
  if (!existsSync(maqueta)) { console.log(`[V04] falta ${maqueta}: la comparación no se hace`); return }
  const b64 = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`
  const p = await page.context().newPage()
  await p.setViewportSize({ width: 1200, height: 900 })
  await p.setContent(`<body style="margin:0;background:#f3f4f1;font:14px system-ui"><div style="display:flex;gap:24px;align-items:flex-start;padding:24px">
    <figure style="margin:0"><figcaption style="margin-bottom:8px;font-weight:600">Maqueta aprobada (${tablero.replace('.png', '')})</figcaption><img src="${b64(readFileSync(maqueta))}" style="max-width:520px;display:block"></figure>
    <figure style="margin:0"><figcaption style="margin-bottom:8px;font-weight:600">Lo que sale (la imagen que imprime la tablet)</figcaption><img src="${b64(tique)}" style="max-width:420px;display:block;box-shadow:0 8px 24px -12px rgb(0 0 0 / .4)"></figure>
  </div></body>`)
  await p.screenshot({ path: `${DIR}/${nombre}`, fullPage: true })
  await p.close()
}

test('el tique de una propia, una cedida y una cedida sin la factura de Last', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'La imagen del tique es la misma en los dos tamaños: se fotografía en el ordenador.')
  const errores = vigilar(page)
  await abrirPedidos(page)

  // Propia: quién factura en una línea, debajo de la fecha, y el número de la serie.
  let t = await tiqueDe(page, PEDIDO.propia)
  await expect(t.vista).toContainText('Llorente29 Food, S.L. · NIF B56496938')
  await expect(t.vista).toContainText('Factura Simplificada')
  await expect(t.vista).toContainText('CA26-000123')
  await page.evaluate(() => document.fonts.ready)
  const propia = await t.img.screenshot({ path: `${DIR}/tique-propia.png` })
  await alLado(page, propia, 'maqueta-tablero-1.png', 'tique-propia-al-lado-del-tablero-1.png')
  await page.mouse.click(5, 5)
  await expect(t.vista).toHaveCount(0)

  // Cedida: los datos y el número de la factura de Last, con su dirección.
  t = await tiqueDe(page, PEDIDO.cedida)
  await expect(t.vista).toContainText('CLOUDTOWN BRANDS SL · NIF B67621425')
  await expect(t.vista).toContainText('Calle de Prueba, 1, 28001 Madrid')
  await expect(t.vista).toContainText('LS53-9214')
  await expect(t.vista).not.toContainText('Llorente29 Food')
  const cedida = await t.img.screenshot({ path: `${DIR}/tique-cedida.png` })
  await alLado(page, cedida, 'maqueta-tablero-2.png', 'tique-cedida-al-lado-del-tablero-2.png')
  await page.mouse.click(5, 5)
  await expect(t.vista).toHaveCount(0)

  // Cedida sin la factura de Last: sin la línea (nunca se inventa un número).
  t = await tiqueDe(page, PEDIDO.sinFactura)
  await expect(t.vista).not.toContainText('Factura Simplificada')
  await t.img.screenshot({ path: `${DIR}/tique-cedida-sin-factura.png` })
  expect(errores).toEqual([])
})

const AJUSTES = {
  'año': 2026,
  empresas: [{ company_id: 'e1', nombre: 'Llorente29 Food, S.L.', nif: 'B56496938', verifactu: 'apagado', conexion_probada: false }],
  locales: [
    { location_id: 'l1', nombre: 'Foodint Carabanchel', activo: true, codigo: 'CA', propuesto: 'CA', empresa: 'Llorente29 Food, S.L.', serie: 'CA26-000001', ultimo: 123, ultimo_at: '2026-10-26T21:36:00Z', rectificativas: 'CA26-R-000001', ultimo_r: null, numeros: 123 },
    { location_id: 'l2', nombre: 'Foodint Alcalá', activo: true, codigo: null, propuesto: 'AL', empresa: 'Llorente29 Food, S.L.', serie: null, ultimo: null, ultimo_at: null, rectificativas: null, ultimo_r: null, numeros: 0 },
    { location_id: 'l3', nombre: 'Foodint Plaza Castilla', activo: false, codigo: null, propuesto: 'PL', empresa: 'Llorente29 Food, S.L.', serie: null, ultimo: null, ultimo_at: null, rectificativas: null, ultimo_r: null, numeros: 0 },
  ],
  marcas: [
    { brand_id: 'b1', nombre: 'Smash Brothers Burgers', propia: true, emisor: null },
    { brand_id: 'b2', nombre: 'Meraki Pita', propia: true, emisor: null },
    { brand_id: 'b3', nombre: 'Birria Burrito', propia: false, emisor: 'CLOUDTOWN BRANDS SL' },
  ],
  cedidas_sin_factura_7d: 2,
}

test('Ajustes › Facturas de los pedidos: Verifactu, la serie de cada local y las marcas', async ({ page }) => {
  const errores = vigilar(page)
  await page.route(/\/rest\/v1\/rpc\/ticket_invoice_ajustes\b/, (r) => json(r, AJUSTES))
  let guardado: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/ticket_invoice_code_set\b/, (r) => { guardado = cuerpo(r); return json(r, { codigo: 'AL', cambiado: true, serie: 'AL26-000001' }) })
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/configuracion/facturas-pedidos')
  const p = page.getByTestId('facturas-pedidos')
  await expect(p.getByRole('heading', { level: 1, name: 'Facturas de los pedidos' })).toBeVisible({ timeout: 30_000 })
  // Verifactu: el de Sumied, con su enlace.
  const vf = p.getByTestId('verifactu-estado')
  await expect(vf).toContainText('Verifactu: apagado')
  await expect(vf).toContainText('Se enciende en Sumied › Ajustes › Verifactu, para toda la empresa. Falta la prueba de conexión con Hacienda (el certificado).')
  await expect(vf.getByRole('link', { name: 'Ir a Sumied' })).toHaveAttribute('href', /ajustes\/verifactu$/)
  // La serie de cada local: Carabanchel con su código fijo y su último número; Alcalá, sin código, lo dice.
  await expect(p.getByTestId('local-Foodint Carabanchel')).toContainText('CA26-000123')
  await expect(p.getByTestId('local-Foodint Carabanchel').getByRole('textbox')).toHaveCount(0)
  const alcala = p.getByTestId('local-Foodint Alcalá')
  await expect(alcala).toContainText('Sin código: sus tiques salen como hoy')
  await expect(alcala.getByLabel('Código de Foodint Alcalá')).toHaveValue('AL')
  await expect(alcala).toContainText('Lo propone Folvy')
  // Las marcas: propias y cedidas, y el aviso de las cedidas sin factura de Last.
  await expect(p.getByTestId('marca-Birria Burrito')).toContainText('La emite CLOUDTOWN BRANDS SL desde Last')
  await expect(p.getByTestId('marca-Meraki Pita')).toContainText('Nuestra serie')
  await expect(p.getByTestId('cedidas-sin-factura')).toContainText('2 pedidos de marcas cedidas de los últimos 7 días llegaron sin la factura de Last')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/tablero-4-${lado(page)}.png`, fullPage: true })
  // Un código que no vale no se deja guardar; el bueno, dice qué ha guardado.
  const caja = alcala.getByLabel('Código de Foodint Alcalá')
  await caja.fill('A1')
  await expect(alcala).toContainText('Son 2 o 3 letras, sin acentos ni números')
  await caja.fill('ALC')
  await caja.fill('AL')
  await caja.fill('ALB')
  await alcala.getByRole('button', { name: 'Guardar' }).click()
  await expect(p.getByTestId('aviso-facturas')).toContainText('Guardado: Foodint Alcalá numera con AL. El próximo tique de una marca propia en este local será el AL26-000001')
  expect(guardado).toMatchObject({ p_location: 'l2', p_code: 'ALB' })
  expect(errores).toEqual([])
})
