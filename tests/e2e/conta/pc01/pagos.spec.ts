// tests/e2e/conta/pc01/pagos.spec.ts
//
// PC01 · Entrega 2 · Compras › Pagos (tablero 15, «pagos_1») y la ficha de una
// remesa (tablero 16, «pagos_2»), en el ordenador y en el móvil.
//
// La base de la tanda (20261026T0915_pc01e2_remesas_de_pagos) es «cambia» (un
// disparador nuevo en supplier): staging la ensaya en ROLLBACK desde la rama y
// no la tiene hasta que esté en producción y se fusione (W04). Por eso lo que
// la pantalla LEE (conta_pagos_lista, conta_remesa_ficha, conta_remesas_lista)
// y lo que ESCRIBE (preparar la remesa, confirmar el IBAN, ponerles
// vencimiento, «Ya la he pagado») se simula aquí con la forma de la 0915 y los
// casos del tablero y de Foodint del 26/10 (6 sin vencimiento, 2 vencidas; casi
// ningún proveedor con IBAN), con fechas de hoy para que no caduquen. Lo demás
// (la sesión, el marco, el menú de Compras, los bancos de la empresa, «Más
// acciones») es staging y el código de verdad. Las funciones las prueba su
// prueba de staging (supabase/staging/sql/20261026_pc01e2_remesas_prueba.sql);
// el fichero para el banco, la unitaria contra el XSD (pc01/sepa.test.ts).
//
//   1. Pagos: las cifras, el aviso de las que no tienen vencimiento, las
//      pestañas, el buscador; marcar una transferencia y una domiciliada: la
//      barra dice cuál no entra y por qué; «Pagar 1 factura» (Intro en el
//      ordenador) prepara la remesa y abre su ficha, que lo dice (regla 8).
//   2. La ficha: los pasos, el IBAN que cambió, «Confirmar el IBAN» (lo dice),
//      el asiento y el historial.
//   3. «Ponerles vencimiento» y «Ya la he pagado…»: cada uno dice lo que ha hecho.
//   4. «Liquidaciones» en Compras se llama «Repartidores», y la dirección vieja
//      lleva allí.
//   5. (Respuesta 7) Bancos: un cargo que es justo lo que espera UNA remesa la
//      propone sola en «Esperando este cargo»; «Sí, es esta» la casa y lo dice;
//      la ficha, pagada, dice en el paso «Pagada» que el asiento se validó solo.
//      El cargo es de verdad (un movimiento inventado importado en «Cuenta
//      principal», que no usa ninguna otra prueba, con huella fija: repetir no
//      crea otro); la remesa que lo espera y el casado se simulan.
// Las capturas, al lado de su tablero (docs/conta/pc01/tableros), en el artefacto.

import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/pc01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** La captura AL LADO de su tablero: el aprobado a la izquierda y la pantalla de verdad a la derecha. */
async function alLado(page: Page, nombre: string, tablero: string, numero: number) {
  const l = lado(page)
  await page.evaluate(() => document.fonts.ready)
  const pantalla = await page.screenshot({ fullPage: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${l}.png`, fullPage: true })
  const fichero = `docs/conta/pc01/tableros/${tablero}-${l}.${l === 'movil' ? 'webp' : 'png'}`
  const imagen = readFileSync(fichero)
  const tipo = l === 'movil' ? 'image/webp' : 'image/png'
  const ancho = l === 'movil' ? 390 : 1440
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">Tablero ${numero} (aprobado)</figcaption><img style="width:100%" src="data:${tipo};base64,${imagen.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${nombre}-${l}.png`, fullPage: true })
  await otra.close()
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

/** Hoy en Madrid y los días alrededor (las fechas de la prueba no caducan). */
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
const dia = (d: number) => { const x = new Date(`${hoy()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

const fila = (x: Record<string, unknown>) => ({
  id: 'x', supplier_id: 's', proveedor: 'Proveedor', numero: 'N-1', fecha: dia(-30), vence: dia(10), total: 100, pagado: 0, pendiente: 100,
  estado: 'por_pagar', dias_vencida: null, forma: 'transfer', location_id: null, local: null, iban4: '0418', con_iban: true, con_cuenta: true, remesa: null, ...x,
})
const FILAS = [
  fila({ id: 'f-carnicas', supplier_id: 's-carnicas', proveedor: 'Distribuciones Cárnicas Prueba SL', numero: 'DCV-2026/1184', vence: dia(-5), total: 1105.30, pendiente: 1105.30, estado: 'vencida', dias_vencida: 5 }),
  fila({ id: 'f-alquiler', supplier_id: 's-alquiler', proveedor: 'Inmuebles Prueba SL', numero: '2026-10', vence: dia(3), total: 1815, pendiente: 1815, estado: 'vence_semana', forma: 'direct_debit' }),
  fila({ id: 'f-envases', supplier_id: 's-envases', proveedor: 'Envases Prueba SL', vence: dia(10), total: 1204.15, pagado: 600, pendiente: 604.15, estado: 'pagada_parte' }),
  fila({ id: 'f-frutas', supplier_id: 's-frutas', proveedor: 'Frutas Prueba SL', numero: 'FR-88', vence: null, total: 418.62, pendiente: 418.62, estado: 'sin_vencimiento' }),
  fila({ id: 'f-carnes2', supplier_id: 's-sinplazo', proveedor: 'Carnes Sin Plazo SL', numero: 'CS-12', vence: null, total: 212.4, pendiente: 212.4, estado: 'sin_vencimiento', iban4: null, con_iban: false }),
  fila({ id: 'f-gestoria', supplier_id: 's-gestoria', proveedor: 'Gestoría Prueba', numero: 'G-310', vence: dia(17), total: 290.40, pendiente: 290.40, remesa: { id: 'r-14', codigo: 'R-2026/014', importe: 290.40 } }),
  fila({ id: 'f-pagada', supplier_id: 's-catcher', proveedor: 'Catcher', numero: 'CT-1', vence: dia(-20), total: 23.10, pagado: 23.10, pendiente: 0, estado: 'pagada', forma: 'prepaid' }),
]

const REMESA = (estado: 'preparada' | 'fichero' | 'pagada', confirmado: boolean) => ({
  id: 'r-15', codigo: 'R-2026/015', a_mano: false, fecha_pago: dia(1), estado, total: 1105.30, por_cargar: estado === 'pagada' ? 0 : 1105.30,
  vivas: 1, pagadas: estado === 'pagada' ? 1 : 0, por_confirmar: confirmado ? 0 : 1, rechazadas: 0, validado_solo: estado === 'pagada',
  fichero_at: estado === 'pagada' ? new Date().toISOString() : null, fichero_por: estado === 'pagada' ? 'Ana Prueba' : null,
  creada: new Date().toISOString(), creada_por: 'Ana Prueba',
  banco: { id: 'b', nombre: 'Banco de Prueba', iban4: '4410', cuenta: '57200001' },
  pagos: [{
    id: 'l-1', factura_id: 'f-carnicas', numero: 'DCV-2026/1184', vence: dia(-5), importe: 1105.30, proveedor: 'Distribuciones Cárnicas Prueba SL',
    iban4: '0418', iban_pais: 'ES', iban_estado: 'cambiado', iban_nota: `cambiado el ${ddmm(dia(-4))} por Ana Prueba`,
    confirmado_por: confirmado ? 'Ana Prueba' : null, confirmado_at: confirmado ? new Date().toISOString() : null,
    estado: estado === 'pagada' ? 'pagada' : confirmado ? 'pendiente' : 'por_confirmar', motivo: null, cuenta: '40000012',
  }],
  historial: [
    { at: new Date().toISOString(), por: 'Ana Prueba', texto: 'Preparada con 1 pago: 1.105,30 €.' },
    ...(confirmado ? [{ at: new Date().toISOString(), por: 'Ana Prueba', texto: 'Confirmado el IBAN de Distribuciones Cárnicas Prueba SL.' }] : []),
  ],
})

type Llamada = { f: string; cuerpo: Record<string, unknown> }
async function simular(page: Page): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  let confirmado = false
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  const apuntar = (f: string, respuesta: () => unknown) => (r: Route) => { llamadas.push({ f, cuerpo: r.request().postDataJSON() }); return json(r, respuesta()) }
  await page.route(/\/rest\/v1\/rpc\/conta_pagos_lista(\?|$)/, (r) => json(r, {
    filas: FILAS, pagado_mes: 22107.88, pagadas_mes: 41, sin_plazo: [{ id: 's-sinplazo', nombre: 'Carnes Sin Plazo SL' }],
  }))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_pagos_crear(\?|$)/, apuntar('crear', () => ({
    remesa: 'r-15', codigo: 'R-2026/015', por_confirmar: 1,
    frase: 'Preparada la remesa R-2026/015: 1 pago, 1.105,30 €. Antes de descargar el fichero, confirma 1 IBAN que ha cambiado.',
  })))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_ficha(\?|$)/, (r) => json(r, REMESA(confirmado ? 'fichero' : 'preparada', confirmado)))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_iban_confirmar(\?|$)/, (r) => {
    confirmado = true
    llamadas.push({ f: 'confirmar', cuerpo: r.request().postDataJSON() })
    return json(r, { frase: 'Confirmado el IBAN de Distribuciones Cárnicas Prueba SL (ES ···· 0418). Queda apuntado que lo has confirmado tú. Ya puedes descargar el fichero.' })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_remesas_lista(\?|$)/, (r) => json(r, [
    { id: 'r-15', codigo: 'R-2026/015', a_mano: false, fecha_pago: dia(1), estado: 'preparada', total: 1105.30, vivas: 1, pagadas: 0, por_confirmar: 1, banco: 'Banco de Prueba' },
    { id: 'r-14', codigo: 'R-2026/014', a_mano: false, fecha_pago: dia(-2), estado: 'en_banco', total: 290.40, vivas: 1, pagadas: 0, por_confirmar: 0, banco: 'Banco de Prueba' },
  ]))
  await page.route(/\/rest\/v1\/rpc\/conta_recibidas_poner_vencimiento(\?|$)/, apuntar('vencimiento', () => ({
    facturas: 2, quedan: 0, frase: 'Puesto el vencimiento a 2 facturas, con el plazo de su proveedor. Guardado el plazo de Carnes Sin Plazo SL: 45 días.',
  })))
  await page.route(/\/rest\/v1\/rpc\/conta_pago_a_mano(\?|$)/, apuntar('a_mano', () => ({
    remesa: 'r-16', codigo: 'R-2026/016', frase: 'Apuntado el pago de 300,00 € a Envases Prueba SL. Le quedan 304,15 €. Cuando llegue el cargo, cásalo en Bancos.',
  })))
  return llamadas
}

/** Las palabras de técnico que no salen en pantalla (encargo, diseño). */
const TECNICAS = /\b(pain\.0|XML|SDD|payment|batch|remesa_id|null|undefined|NaN)\b/i

test('Pagos: cifras, sin vencimiento, pestañas; pagar una (la domiciliada no entra) y la ficha de la remesa con su IBAN', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const movil = lado(page) === 'movil'
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/compras/pagos')
  await expect(page.getByRole('heading', { level: 1, name: 'Pagos' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Compras y gastos', 'Pagos'])

  // Las cifras de arriba: por pagar (6 facturas: todas las que quedan), esta semana, vencido y pagado en el mes.
  await expect(page.getByText('1.105,30 €').first()).toBeVisible({ timeout: 30_000 })
  for (const t of ['Por pagar', 'Vence esta semana', 'Vencido']) await expect(page.locator('.pg-cifras').getByText(t, { exact: true })).toBeVisible()
  await expect(page.locator('.pg-cifras')).toContainText('22.107,88')
  await expect(page.locator('.pg-cifras')).toContainText('6 facturas')
  await expect(page.locator('.pg-cifras')).toContainText('1 factura · 5 días')

  // El aviso de las que no tienen vencimiento: a uno de los dos proveedores se le pregunta.
  const sinVence = page.locator('[data-prueba="sin-vencimiento"]')
  await expect(sinVence).toContainText('2 facturas no tienen vencimiento.')
  await expect(sinVence).toContainText('1 lo tiene en su ficha; a 1 proveedor te pregunto')

  // Las pestañas: ninguna fila se esconde (regla 7); las demás son trozos.
  const pestanas = page.getByRole('tablist', { name: 'Estado de los pagos' })
  for (const t of ['Por pagar', 'Vencidas', 'Esta semana', 'Sin vencimiento', 'En remesa', 'Pagadas']) await expect(pestanas.getByRole('tab', { name: new RegExp(t) })).toBeVisible()
  await pestanas.getByRole('tab', { name: /Vencidas/ }).click()
  await expect(page.getByRole('checkbox', { name: /^Marcar / })).toHaveCount(movil ? 1 : 2) // en el ordenador, también «Marcar todas»
  await pestanas.getByRole('tab', { name: /Por pagar/ }).click()

  // El buscador encuentra por importe, con coma.
  await page.getByRole('searchbox', { name: 'Buscar un pago' }).fill('1.105,30')
  await expect(page.getByRole('checkbox', { name: /^Marcar Distribuciones/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^Marcar Inmuebles/ })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Buscar un pago' }).fill('')
  // De vuelta en «Por pagar» y sin buscar: las seis que quedan, también la domiciliada. Si no, el
  // registro dice dónde está la pantalla y qué enseña (e2e 945 y la de la zona: no se veía la fila).
  try {
    await expect(pestanas.getByRole('tab', { name: /Por pagar/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
    await expect(page.getByRole('searchbox', { name: 'Buscar un pago' })).toHaveValue('')
    await expect(page.getByRole('checkbox', { name: /^Marcar Inmuebles/ })).toBeVisible({ timeout: 15_000 })
  } catch (e) {
    console.log(`[diagnóstico pagos] dirección: ${page.url()}`)
    console.log(`[diagnóstico pagos] lista:\n${await page.locator('.pg-caja').ariaSnapshot().catch((x: Error) => x.message)}`)
    throw e
  }

  // Marcar la transferencia vencida y la domiciliada: la barra dice cuál no entra y por qué.
  await page.getByRole('checkbox', { name: /^Marcar Distribuciones Cárnicas/ }).check()
  await page.getByRole('checkbox', { name: /^Marcar Inmuebles/ }).check()
  const barra = page.getByRole('region', { name: 'Pagar las seleccionadas' })
  await expect(barra).toContainText('1 seleccionada · 1.105,30 €')
  await expect(barra).toContainText('1 no entra: la paga el banco solo (domiciliada)')
  await expect(barra.getByRole('button', { name: /Pagar 1 factura/ })).toBeEnabled()
  await expect(barra.getByLabel('Desde qué banco se paga')).not.toHaveValue('')
  expect(await page.locator('main, .pg-pagina').first().innerText()).not.toMatch(TECNICAS)
  await alLado(page, 'pagos', 'pagos-1', 15)

  // «Pagar 1 factura»: Intro en el ordenador (como en el tablero), el botón en el móvil.
  if (movil) await barra.getByRole('button', { name: /Pagar 1 factura/ }).click()
  else { await page.getByRole('heading', { level: 1, name: 'Pagos' }).click(); await page.keyboard.press('Enter') }
  await expect(page).toHaveURL(/\/conta\/compras\/pagos\/remesas\/r-15/, { timeout: 30_000 })
  const crear = llamadas.find((l) => l.f === 'crear')!
  expect(crear.cuerpo.p_facturas).toEqual([{ id: 'f-carnicas', importe: 1105.3 }])
  expect(crear.cuerpo.p_fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // La ficha: lo dice (regla 8), los pasos, el IBAN que cambió.
  await expect(page.getByRole('heading', { level: 1, name: `Remesa de transferencias · ${ddmm(dia(1))}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="aviso-remesa"]')).toHaveText('Preparada la remesa R-2026/015: 1 pago, 1.105,30 €. Antes de descargar el fichero, confirma 1 IBAN que ha cambiado.')
  const pasos = page.getByRole('list', { name: 'En qué punto está la remesa' }).getByRole('listitem')
  await expect(pasos).toHaveText([/Preparada/, /Fichero para el banco/, /En el banco: esperando el cargo/, /Pagada/])
  await expect(pasos.nth(1)).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('El IBAN de Distribuciones Cárnicas Prueba SL ha cambiado')).toBeVisible()
  await expect(page.getByText('···· 0418 · nuevo')).toBeVisible()
  await expect(page.getByText('40000012').first()).toBeVisible() // el asiento: el proveedor a su 400…
  await expect(page.getByText('57200001').first()).toBeVisible() // …y el banco a su 572
  await expect(page.getByText(/Ana Prueba: Preparada con 1 pago/)).toBeVisible()
  expect(await page.locator('.pg-pagina').innerText()).not.toMatch(TECNICAS)
  await alLado(page, 'remesa', 'pagos-2', 16)

  // «Confirmar el IBAN» (el principal: abajo, bajo el pulgar, en el móvil): lo dice, y queda quién.
  await page.getByRole('button', { name: 'Confirmar el IBAN' }).first().click()
  await expect(page.locator('[data-prueba="aviso-remesa"]')).toContainText('Confirmado el IBAN de Distribuciones Cárnicas Prueba SL', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Descargar el fichero' })).toBeVisible()
  await expect(page.getByText(/Ana Prueba: Confirmado el IBAN/)).toBeVisible()
  expect(llamadas.find((l) => l.f === 'confirmar')!.cuerpo).toEqual({ p_linea: 'l-1' })

  // Las remesas: la lista, con su estado.
  await page.goto('/conta/compras/pagos/remesas')
  await expect(page.getByRole('heading', { level: 1, name: 'Remesas' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('R-2026/014').first()).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('«Ponerles vencimiento» y «Ya la he pagado…» dicen lo que han hecho; «Liquidaciones» de Compras es «Repartidores»', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/compras/pagos')
  await expect(page.locator('[data-prueba="sin-vencimiento"]')).toBeVisible({ timeout: 30_000 })

  // Ponerles vencimiento: pregunta solo por el proveedor que no tiene plazo.
  await page.locator('[data-prueba="sin-vencimiento"]').getByRole('button', { name: 'Ponerles vencimiento' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Ponerles vencimiento' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Carnes Sin Plazo SL · días de plazo').fill('45')
  await dialogo.getByRole('button', { name: 'Ponerles vencimiento' }).click()
  await expect(page.locator('[data-prueba="aviso-pagos"]')).toHaveText('Puesto el vencimiento a 2 facturas, con el plazo de su proveedor. Guardado el plazo de Carnes Sin Plazo SL: 45 días.', { timeout: 30_000 })
  expect(llamadas.find((l) => l.f === 'vencimiento')!.cuerpo.p_plazos).toEqual([{ proveedor: 's-sinplazo', dias: 45 }])

  // Ya la he pagado: una parte de la pagada en parte.
  await page.getByRole('button', { name: 'Más acciones' }).click()
  await page.getByRole('menuitem', { name: /Ya la he pagado/ }).or(page.getByRole('button', { name: /Ya la he pagado/ })).first().click()
  const ya = page.getByRole('dialog', { name: 'Ya la he pagado' })
  await expect(ya).toBeVisible()
  await ya.getByLabel('Factura').selectOption('f-envases')
  await ya.getByLabel('Importe').fill('300,00')
  await ya.getByRole('button', { name: 'Apuntar el pago' }).click()
  await expect(page.locator('[data-prueba="aviso-pagos"]')).toContainText('Apuntado el pago de 300,00 € a Envases Prueba SL. Le quedan 304,15 €.', { timeout: 30_000 })
  const aMano = llamadas.find((l) => l.f === 'a_mano')!.cuerpo
  expect([aMano.p_invoice, aMano.p_importe]).toEqual(['f-envases', 300])

  // «Liquidaciones» de Compras se llama «Repartidores»; la dirección vieja lleva allí.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.goto('/conta/compras/liquidaciones')
  await expect(page).toHaveURL(/\/conta\/compras\/repartidores/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Repartidores' })).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('Bancos propone sola la remesa que espera justo ese cargo; la ficha, pagada, dice que el asiento se validó solo', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const movil = lado(page) === 'movil'
  const s = await entrarComo(page, CUENTA_A.email)
  const empresa = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
  // El cargo, de verdad: un movimiento inventado en «Cuenta principal» (huella fija).
  const banco = await rest<{ id: string }[]>(s, 'GET', `treasury_account?select=id&company_id=eq.${empresa}&name=eq.${encodeURIComponent('Cuenta principal')}`)
  expect(banco.datos?.length, 'la empresa A tiene su «Cuenta principal»').toBe(1)
  const bancoId = banco.datos[0].id
  const imp = await rest(s, 'POST', 'rpc/bank_importar', {
    p_treasury: bancoId, p_fuente: 'fichero', p_formato: 'csv:bbva', p_fichero: 'prueba-pc01e2-r7.xlsx', p_sha256: 'c'.repeat(64),
    p_desde: '2026-10-20', p_hasta: '2026-10-20', p_saldo_inicial: null, p_saldo_final: null, p_sin_comprobar: 'prueba', p_iban_fichero: null,
    p_movs: [{ fecha: '2026-10-20', importe: -1105.30, concepto_banco: 'TRANSFERENCIAS REMESA R7 PRUEBA', concepto_limpio: 'Transferencias remesa r7 prueba',
      contraparte: 'REMESA PRUEBA', tipo: 'TRANSFERENCIAS', huella: 'pc01e2-r7-1', huella_suave: 'pc01e2-r7-s1' }],
  })
  expect(imp.status, JSON.stringify(imp.datos)).toBe(200)
  const mov = await rest<{ id: string; status: string }[]>(s, 'GET', `bank_movement?select=id,status&treasury_account_id=eq.${bancoId}&bank_concept=eq.${encodeURIComponent('TRANSFERENCIAS REMESA R7 PRUEBA')}&order=created_at.asc&limit=1`)
  expect(mov.datos?.length, 'el cargo inventado está en «Cuenta principal»').toBe(1)
  expect(mov.datos[0].status, 'nadie lo ha casado (el casado de la prueba se simula)').not.toBe('casado')

  // La remesa que espera justo ese cargo (y otra, de otro importe, que no cuadra).
  let casar: Record<string, unknown> | null = null
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/rpc\/conta_remesas_para_casar(\?|$)/, (r) => json(r, [
    { id: 'r-15', codigo: 'R-2026/015', fecha: '2026-10-20', a_mano: false, por_cargar: 1105.30,
      pagos: [{ id: 'l-1', importe: 1105.30, proveedor: 'Distribuciones Cárnicas Prueba SL', factura: 'DCV-2026/1184' }] },
    { id: 'r-14', codigo: 'R-2026/014', fecha: '2026-10-18', a_mano: false, por_cargar: 290.40,
      pagos: [{ id: 'l-9', importe: 290.40, proveedor: 'Gestoría Prueba', factura: 'G-310' }] },
  ]))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_casar(\?|$)/, (r) => {
    casar = r.request().postDataJSON() as Record<string, unknown>
    return json(r, { casado: 'c-1', pagos: 1, pagadas: 1, validado_solo: true,
      frase: 'Casado con la remesa R-2026/015: 1 pago, 1.105,30 €. 1 factura queda pagada y su asiento validado solo: el cargo cuadra con la remesa.' })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_ficha(\?|$)/, (r) => json(r, REMESA('pagada', true)))

  await page.goto(`/conta/bancos?banco=${bancoId}&mes=2026-10&mov=${mov.datos[0].id}`)
  const espera = page.locator('[data-prueba="remesas-esperan"]')
  await expect(espera).toBeVisible({ timeout: 30_000 })
  const propuesta = espera.locator('[data-prueba="remesa-propuesta"]')
  await expect(propuesta).toContainText('Te propongo: es el cargo de la remesa R-2026/015')
  await expect(propuesta).toContainText('Es lo único que espera justo este importe.')
  await expect(espera.getByText('R-2026/014')).toHaveCount(0) // la de otro importe no sale
  await expect(propuesta.getByRole('button', { name: 'Sí, es esta' })).toHaveClass('cx-boton')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/bancos-remesa-propuesta-${lado(page)}.png`, fullPage: true })

  await propuesta.getByRole('button', { name: 'Sí, es esta' }).click()
  await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('su asiento validado solo: el cargo cuadra con la remesa', { timeout: 30_000 })
  expect(casar).toEqual({ p_movement: mov.datos[0].id, p_remesa: 'r-15', p_lineas: null })

  // La ficha, pagada: el paso «Pagada» lo dice.
  await page.goto('/conta/compras/pagos/remesas/r-15')
  await expect(page.getByRole('heading', { level: 1, name: /^Remesa de transferencias/ })).toBeVisible({ timeout: 30_000 })
  const pasos = page.getByRole('list', { name: 'En qué punto está la remesa' }).getByRole('listitem')
  await expect(pasos.nth(3)).toHaveAttribute('data-hecho', 'si')
  await expect(page.locator('[data-prueba="validado-solo"]')).toHaveText('Asiento validado solo: el cargo cuadra con la remesa')
  // Y en los datos de la remesa, «Su asiento» (el paso de arriba dice «Asiento validado solo…»).
  await expect(page.getByText('Validado solo: el cargo cuadra con la remesa', { exact: true })).toBeVisible()
  if (!movil) await expect(page.getByRole('button', { name: 'Confirmar el IBAN' })).toHaveCount(0)
  await alLado(page, 'remesa-pagada', 'pagos-2', 16)
  expect(errores).toEqual([])
})

