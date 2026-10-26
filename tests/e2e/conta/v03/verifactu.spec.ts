// tests/e2e/conta/v03/verifactu.spec.ts
//
// V03 · Entrega 2 · Verifactu en pantalla, en el ordenador y en el móvil, con
// la cuenta D («Asesoría de Prueba Oeste», que NO es de hostelería):
//   1. El alta (tablero 25), en Ajustes › Facturación › Verifactu: los tres
//      pasos con sus datos, el candado dicho antes de pulsar (staging no tiene
//      ninguna conexión probada con la AEAT: «Empezar las pruebas» no se puede),
//      la vía de colaborador social dicha como cerrada, «¿Facturas también con
//      otro programa?» con su aviso (y guardado, en su carril) y la
//      declaración responsable.
//   2. Una venta sin IVA a Suiza, EMITIENDO DE VERDAD (carril, ordenador): sin
//      decir qué le has vendido no se puede emitir; con «Un servicio a una
//      empresa», sí, con su asiento sin 477 y su PDF. Pide la 0146, que cambia
//      en caliente: staging la ensaya en ROLLBACK hasta que se aplica en
//      producción y se fusiona; hasta entonces esta parte lo dice y se salta
//      (la prueba entera está en la prueba de staging de la 0146).
//   3. La rechazada (tableros 26 y 27). Staging no habla con la AEAT (no hay
//      certificado de pruebas): lo que contesta Hacienda está SIMULADO en el
//      navegador (page.route) para una emitida de verdad de D: el modo
//      «pruebas», su estado «Rechazada» y su registro; y «Corregir y
//      reenviar» contesta lo que contestaría la base. Lo que escribe la base al
//      reenviar lo prueba la prueba de staging de la 0218, en su transacción.
// Las capturas, en docs/conta/capturas/v03 (van al artefacto del run).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_D, entrarComo, pedirSesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/v03'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

test('el alta (tablero 25): tres pasos, el candado dicho antes, otros programas y la declaración', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_D.email)
  await page.goto('/conta/ajustes/verifactu')
  const alta = page.locator('[data-prueba="verifactu-alta"]')
  await expect(alta.getByRole('heading', { level: 1, name: 'Verifactu: tus facturas, directas a Hacienda' })).toBeVisible({ timeout: 30_000 })
  // Paso 1: la empresa de D, sociedad, y desde cuándo le obliga.
  await expect(alta.getByRole('region', { name: 'Paso 1: Tus datos' })).toContainText('B12345682 · sociedad: te obliga desde el 1 de enero de 2027')
  // Paso 2: la vía de colaborador, recomendada y dicha como cerrada; la del certificado, sin certificado en D.
  await expect(alta.getByText('Recomendado')).toBeVisible()
  await expect(alta.locator('[data-prueba="colaborador-cerrado"]')).toBeVisible()
  await expect(alta.getByRole('button', { name: 'Firmar ahora' })).toBeDisabled()
  // Paso 3: el candado, antes de pulsar.
  await expect(alta.locator('[data-prueba="candado-pruebas"]')).toContainText('Todavía no se ha probado la conexión con el entorno de pruebas de Hacienda')
  await expect(alta.getByRole('button', { name: 'Empezar las pruebas' })).toBeDisabled()
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'tablero-25')
  await alta.getByRole('radio', { name: /Con tu certificado de empresa/ }).check()
  await expect(alta.getByText(/No hay ningún certificado de la empresa en vigor|El certificado/).first()).toBeVisible({ timeout: 30_000 })
  // ¿Facturas también con otro programa? Excel no cumple, y se dice.
  const otros = alta.locator('[data-prueba="otros-programas"]')
  await otros.getByRole('radio', { name: /Sí, también con/ }).check()
  await otros.getByRole('checkbox', { name: 'Excel, Word o a mano' }).check()
  await expect(otros.locator('[data-prueba="aviso-otros-programas"]')).toContainText('no cumple desde 2027')
  if (CARRIL !== null && lado(page) === 'ordenador') {
    await otros.getByRole('button', { name: 'Guardar' }).click()
    const dicho = otros.getByRole('status').filter({ hasText: /Guardado:|verifactu_otros_programas|function/ })
    await expect(dicho).toBeVisible({ timeout: 30_000 })
    const texto = (await dicho.textContent()) ?? ''
    // La 0226 solo añade: llega a staging de verdad con su tanda (o al fusionar). Hasta entonces, se dice.
    if (/verifactu_otros_programas|function/.test(texto)) console.log(`[V03] staging aún no tiene la 0226: «${texto}»`)
    else expect(texto).toContain('Guardado: también facturas con excel, word o a mano.')
  }
  await foto(page, 'tablero-25-otros-programas')
  // La declaración responsable: su sitio, con el texto que pone Julio.
  await alta.getByRole('button', { name: 'Ver la declaración responsable' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Declaración responsable' })
  await expect(dialogo.locator('[data-prueba="declaracion-pendiente"]')).toBeVisible()
  // El diálogo tiene la X (Cerrar) y el botón principal: el de abajo.
  await dialogo.getByRole('button', { name: 'Cerrar' }).last().click()
  expect(errores).toEqual([])
})

test('sin IVA a Suiza, emitiendo de verdad: sin decir qué le has vendido no se emite', async ({ page }) => {
  test.skip(CARRIL === null, 'Escribe facturas y clientes: solo en un carril, que se borra entero al acabar.')
  test.skip(lado(page) === 'movil', 'Escribe en la base: en un tamaño.')
  test.setTimeout(180_000)
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_D.email)
  // D trae solo su ejercicio de 2025: se abre el de este año, como en la V01.
  await page.goto('/conta/ajustes/ejercicio')
  const ano = new Date().getFullYear()
  const abrir = page.getByRole('button', { name: `Abrir el ejercicio ${ano}` })
  await abrir.waitFor({ timeout: 20_000 }).catch(() => undefined)
  if (await abrir.count()) {
    await abrir.click()
    await expect(page.getByText(`Abierto el ejercicio ${ano}.`)).toBeVisible({ timeout: 30_000 })
  }
  // El cliente de Suiza (con su país): lo da de alta Contactos; aquí, por la misma función.
  const alta = await rest<{ party_id: string }>(s, 'POST', 'rpc/party_save_customer', {
    p_account: CUENTA_D.id, p_party: null, p_nombre: `Alpen Gastro AG e2e ${Date.now().toString(36)}`, p_nif: 'CHE123456789', p_datos: { countryCode: 'CH' }, p_quien_nombre: 'e2e V03',
  })
  expect(alta.status, JSON.stringify(alta.datos)).toBe(200)
  await page.goto(`/conta/ventas/facturas/nueva?cliente=${alta.datos.party_id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Concepto de la línea 1').fill('Asesoría de cocina')
  await page.getByLabel('Precio de la línea 1').fill('2150')
  await page.getByLabel('IVA de la línea 1').selectOption({ label: 'Sin IVA' })
  // Sin decir qué le has vendido: falta, y no se emite.
  const porque = page.locator('[data-prueba="porque-sin-iva"]')
  await expect(porque).toContainText('El cliente está fuera de la UE y hay líneas sin IVA.')
  await expect(porque.getByRole('radio')).toHaveCount(3)
  await expect(page.locator('[data-prueba="falta-para-emitir"]')).toContainText('decir por qué va sin IVA')
  await expect(page.getByRole('button', { name: 'Guardar y emitir' }).first()).toBeDisabled()
  await foto(page, 'sin-iva-falta-el-porque')
  await porque.getByRole('radio', { name: /Un servicio a una empresa/ }).check()
  await expect(porque).toContainText('Operación no sujeta a IVA en España por reglas de localización')
  await page.getByRole('button', { name: /Guardar cambios/ }).click()
  // Con cambios, el fallo sale dentro de la barra («· No se ha guardado: …»); guardado, en la ficha.
  const guardado = page.getByText(/Guardado el borrador|No se ha guardado/).first()
  await expect(guardado).toBeVisible({ timeout: 30_000 })
  const t = (await guardado.textContent()) ?? ''
  test.skip(/aún no se puede facturar aquí/.test(t), 'Staging aún no tiene la 0146 (cambia en caliente): se prueba en la prueba de staging de la tanda, en ROLLBACK, hasta que se aplique y se fusione.')
  await expect(page).toHaveURL(/\/conta\/ventas\/facturas\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Emitir', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Emitir la factura' }).getByRole('button', { name: 'Emitir' }).click()
  const resultado = page.locator('[data-prueba="resultado-emitir"]')
  await expect(resultado).toContainText(/Emitida la F-\d{4}\/\d+ · 2\.150,00 €\./, { timeout: 60_000 })
  await expect(resultado).toContainText('Su PDF, hecho y guardado.')
  const asiento = page.getByRole('table', { name: 'Su asiento' })
  await expect(asiento).toContainText('2.150,00')
  await expect(asiento).not.toContainText('477')
  await expect(page.locator('[data-prueba="porque-sin-iva-leer"]')).toContainText('no sujeta a IVA en España')
  await foto(page, 'sin-iva-emitida')
  expect(errores).toEqual([])
})

test('la rechazada (tableros 26 y 27), con la respuesta de Hacienda simulada', async ({ page }) => {
  const errores = vigilar(page)
  const s = await pedirSesion(CUENTA_D.email)
  const emitidas = await rest<{ id: string; number_text: string; company_id: string; issued_at: string }[]>(s, 'GET',
    `customer_invoice?select=id,number_text,company_id,issued_at&account_id=eq.${CUENTA_D.id}&status=eq.emitida&order=issued_at.desc`)
  test.skip(!emitidas.datos.length, 'D no tiene ninguna emitida (la crean «sin IVA a Suiza» o la V01, en su carril).')
  const f = emitidas.datos[0]
  const lineas = await rest<{ tax_pct: number }[]>(s, 'GET', `customer_invoice_line?select=tax_pct&account_id=eq.${CUENTA_D.id}&invoice_id=eq.${f.id}`)
  // Con líneas sin IVA, el rechazo del tablero 27 (1195: falta el tipo de venta); si no, uno de NIF (4107).
  const sinIva = lineas.datos.some((l) => Number(l.tax_pct) === 0)
  const codigo = sinIva ? 1195 : 4107
  const enviada = new Date(Date.now() - 26 * 3600_000).toISOString()
  const respondida = new Date(Date.now() - 26 * 3600_000 + 60_000).toISOString()
  const fila = (id: string, rechazada: boolean) => ({
    invoice_id: id, account_id: CUENTA_D.id, company_id: f.company_id, estado: rechazada ? 'incorrecto' : 'correcto', entorno: 'pruebas', registro_id: `r-${id}`, huella: null,
    codigo_error: rechazada ? codigo : null, descripcion_error: rechazada ? (sinIva ? 'Al menos uno de los dos campos OperacionExenta o CalificacionOperacion deben estar informados.' : 'El NIF no está identificado en el censo de la AEAT.') : null,
    generado_at: enviada, respondido_at: respondida, intentos: 1, proximo_intento_at: enviada, url_qr: null,
  })
  await page.route(/\/rest\/v1\/verifactu_empresa\b/, (r) => json(r, [{ company_id: f.company_id, account_id: CUENTA_D.id, modo: 'pruebas', via: 'colaborador', certificate_id: null, pruebas_desde: enviada, real_desde: null, real_serie: null, real_obliga_hasta: null, otros_programas: null }]))
  await page.route(/\/rest\/v1\/verifactu_factura_estado\b/, (r) => {
    const una = /invoice_id=eq\.([0-9a-f-]{36})/.exec(r.request().url())?.[1]
    return json(r, una ? [fila(una, una === f.id)] : emitidas.datos.map((x) => fila(x.id, x.id === f.id)))
  })
  await page.route(/\/rest\/v1\/verifactu_registro\b/, (r) => json(r, [{ id: `r-${f.id}`, tipo: 'alta', subsanacion: false, estado: 'incorrecto', generado_at: enviada, respondido_at: respondida, codigo_error: codigo, descripcion_error: fila(f.id, true).descripcion_error, envio_id: null }]))
  await page.route(/\/rest\/v1\/rpc\/verifactu_reenviar\b/, (r) => json(r, { registro_id: 'nuevo', num_serie: f.number_text, estado: 'pendiente' }))
  await entrarComo(page, CUENTA_D.email)

  // Tablero 26: la banda, las cifras, el aviso y la columna.
  await page.goto('/conta/ventas/facturas')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="banda-pruebas"]')).toContainText('Estás en pruebas: Hacienda comprueba tus facturas, pero no cuentan.')
  const cifras = page.locator('[data-prueba="cifras-hacienda"]')
  for (const c of ['Hacienda las tiene', 'Necesita que la mires', 'Enviándose ahora']) await expect(cifras.getByText(c)).toBeVisible()
  const aviso = page.locator('[data-prueba="aviso-rechazada"]')
  await expect(aviso).toContainText(`Hacienda ha rechazado la factura ${f.number_text}.`)
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  if (lado(page) === 'ordenador') await expect(page.getByRole('table').first().getByRole('columnheader').filter({ hasText: /^Hacienda/ })).toBeVisible()
  await expect(page.getByText(/^Rechazada/).first()).toBeVisible()
  await expect(page.locator('[data-prueba="pie-hacienda"]')).toContainText('Verifactu empieza el 1 de enero de 2027')
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'tablero-26')

  // Tablero 27: «Arreglarla» lleva a la factura, explicada.
  await aviso.getByRole('link', { name: 'Arreglarla' }).click()
  const rechazo = page.locator('[data-prueba="factura-rechazada"]')
  await expect(rechazo).toContainText('Rechazada por Hacienda', { timeout: 30_000 })
  await expect(rechazo.getByRole('heading', { level: 2 })).toHaveText(sinIva ? 'Falta decir qué tipo de venta es' : 'Un dato del cliente o de tu empresa no cuadra')
  const dijo = rechazo.locator('[data-prueba="lo-que-dijo-hacienda"]')
  await expect(dijo.locator('p')).toBeHidden()
  await dijo.locator('summary').click()
  await expect(dijo).toContainText(`Código ${codigo}:`)
  const linea = page.locator('[data-prueba="como-va-con-hacienda"]')
  await expect(linea).toContainText('Emitida y comprobada por Sumied')
  await expect(linea).toContainText('Rechazada:')
  await expect(linea).toContainText('pendiente de ti')
  if (sinIva) await rechazo.getByRole('radio', { name: /Mercancía que sale de España/ }).check()
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'tablero-27')
  await rechazo.getByRole('button', { name: 'Corregir y reenviar' }).click()
  await expect(page.locator('[data-prueba="aviso-reenvio"]')).toContainText(`Reenviada la ${f.number_text} a Hacienda`, { timeout: 30_000 })
  expect(errores).toEqual([])
})
