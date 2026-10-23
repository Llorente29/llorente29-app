/// <reference lib="dom" />
// tests/e2e/conta/s01d/flujos.spec.ts
//
// S01d · Los cuatro caminos nuevos de la tanda (PR 2), contra staging-conta,
// en ordenador (1440) y móvil (390):
//
//   1. «+ Nuevo banco o tarjeta» (cuenta B): el diálogo se abre con
//      ?nuevo=banco, comprueba el IBAN en el navegador y da de alta el banco
//      con su subcuenta 572 nueva (bank_cuenta_nueva), diciéndolo (regla 8).
//   2. «Nueva recibida a mano» (cuenta A): sin base no guarda y dice qué falta;
//      con base 100,00 al 21 % calcula 21,00 y 121,00, guarda y abre la
//      factura «para revisar», sin papel.
//   3. El PDF de la expedida (cuenta A): se adjunta antes de guardar, se ve al
//      lado (ordenador) o debajo (móvil) y, al «Guardar y validar», queda en la
//      tarjeta «Factura» del asiento. S02 · PR 2: la hoja es «Nueva factura
//      emitida», en Facturación › Facturas emitidas.
//   4. «Nuevo proveedor» en las acciones de Contactos, también en el móvil (el alta
//      entera en el ordenador ya la prueba c03/terceros.spec.ts).
//
// Lo que escribe y no se puede deshacer se escribe en UN tamaño:
//   · el banco nuevo, en el móvil: treasury_account solo deja leer (no hay
//     baja), y el móvil corre después del ordenador, así las capturas de
//     s01d/capturas.spec.ts de la cuenta B (los dos tamaños) salen sin él;
//   · la expedida validada, en el ordenador, y se anula al acabar (como el
//     «Lo que he hecho yo» de c04/libro.spec.ts).
// La recibida a mano se escribe en los dos y se borra al acabar. Todo vive en
// el carril de la ejecución, que se borra después. Datos inventados.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const PDF_PRUEBA = 'tests/e2e/conta/s01d/factura-prueba-s01d.pdf'
const NOMBRE_PDF = 'factura-prueba-s01d.pdf'
// Un IBAN de ejemplo con su control bien (mod 97 = 1); no es de nadie.
const IBAN_PRUEBA = 'ES91 2100 0418 4502 0005 1332'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

// ── 1 · Banco nuevo ─────────────────────────────────────────────────────────

/** Abre «Nuevo banco o tarjeta» llegando con ?nuevo=banco y mira que el callejón de antes ya no está. */
async function abrirBancoNuevo(page: Page) {
  await page.goto('/conta/bancos/cuentas?nuevo=banco')
  const dialogo = page.getByRole('dialog', { name: 'Nuevo banco o tarjeta' })
  await expect(dialogo).toBeVisible({ timeout: 30_000 })
  // El callejón sin salida de antes del S01d: con el plan sin cuentas 572 libres, no había por dónde dar de alta.
  await expect(page.getByText('Ninguna: cada cuenta de bancos del plan tiene su banco aquí')).toHaveCount(0)
  // Sin ningún banco, lo dice y señala la salida, «+ Nuevo banco o tarjeta», que está siempre.
  if (await page.locator('article.cxb-banco-tarjeta').count() === 0) {
    await expect(page.getByText(/^Aún no hay ningún banco\. Dalo de alta con «\+ Nuevo banco o tarjeta»/)).toBeVisible()
  }
  return dialogo
}

/**
 * «+ Nuevo banco o tarjeta» está siempre. S02 · PR 2: es un botón blanco del
 * encabezado de Cuentas y extractos; en el móvil, dentro de «Más acciones».
 * Se mira con el diálogo ya cerrado (en el móvil hay que abrir el menú).
 */
async function nuevoBancoEnSuSitio(page: Page) {
  const encabezado = page.locator('header.s-encabezado')
  if (lado(page) === 'ordenador') {
    await expect(encabezado.getByRole('button', { name: '+ Nuevo banco o tarjeta' })).toBeVisible()
    return
  }
  await encabezado.getByRole('button', { name: 'Más acciones', exact: true }).click()
  const menu = encabezado.getByRole('group', { name: 'Más acciones', exact: true })
  await expect(menu.getByRole('button', { name: '+ Nuevo banco o tarjeta' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
}

/** Con el eje «local» encendido, el diálogo pregunta de qué local es: común a todos. */
async function comunSiPregunta(dialogo: ReturnType<Page['getByRole']>) {
  const local = dialogo.getByRole('combobox')
  if (await local.count() > 0) await local.selectOption({ label: 'Común a todos' })
}

test('S01d · banco nuevo (cuenta B): se abre con ?nuevo=banco, comprueba el IBAN y da de alta con su subcuenta 572', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_B.email)
  vigilar(page)
  const nombre = `Banco Prueba S01d ${lado(page)} ${Date.now()}`
  const dialogo = await abrirBancoNuevo(page)
  await expect(dialogo.getByRole('button', { name: 'Banco', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialogo.getByLabel('Cómo lo llamas').fill(nombre)

  if (lado(page) === 'ordenador') {
    // En el ordenador no se escribe (ver la cabecera): un IBAN con el control mal no llega a la base, y Cancelar no deja nada.
    await dialogo.getByLabel('IBAN', { exact: true }).fill('ES00 0000 0000 0000 0000 0000')
    await comunSiPregunta(dialogo)
    await dialogo.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(dialogo.getByRole('alert')).toHaveText('Este IBAN no es correcto: revisa los dígitos.')
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog', { name: 'Nuevo banco o tarjeta' })).toHaveCount(0)
    await expect(page).not.toHaveURL(/nuevo=banco/)
    await nuevoBancoEnSuSitio(page)
    const nada = await rest<unknown[]>(s, 'GET', `treasury_account?select=id&account_id=eq.${CUENTA_B.id}&name=eq.${encodeURIComponent(nombre)}`)
    expect(nada.datos).toEqual([])
    return
  }

  await dialogo.getByLabel('IBAN', { exact: true }).fill(IBAN_PRUEBA)
  await comunSiPregunta(dialogo)
  await dialogo.getByRole('button', { name: 'Dar de alta' }).click()
  // Regla 8: lo dice con lo que ha hecho la base (su subcuenta nueva), o por qué aún no la tiene.
  const hecho = page.getByRole('status').filter({ hasText: nombre })
  await expect(hecho).toHaveText(new RegExp(
    `^${nombre} dado de alta(, [^.]+)?\\. (Nueva subcuenta 572\\d+ · Bancos · ${nombre}, enlazada al banco\\.|El plan contable de la empresa aún no está activado: .+) Ya puedes subir su extracto\\.$`))
  await expect(page.getByRole('dialog', { name: 'Nuevo banco o tarjeta' })).toHaveCount(0)
  await expect(page).not.toHaveURL(/nuevo=banco/)
  await nuevoBancoEnSuSitio(page)
  // Y ya está en la lista, con su IBAN.
  const tarjeta = page.getByRole('article', { name: nombre })
  await expect(tarjeta).toBeVisible()
  await expect(tarjeta.getByText(IBAN_PRUEBA)).toBeVisible()
  // En la base: un banco, de B, con el IBAN sin espacios.
  const enBase = await rest<{ kind: string; iban: string | null }[]>(s, 'GET',
    `treasury_account?select=kind,iban&account_id=eq.${CUENTA_B.id}&name=eq.${encodeURIComponent(nombre)}`)
  expect(enBase.datos).toEqual([{ kind: 'bank', iban: IBAN_PRUEBA.replace(/ /g, '') }])
})

// ── 2 · Recibida a mano ─────────────────────────────────────────────────────

async function borrarRecibida(s: Sesion, numero: string) {
  const r = await rest<{ id: string }[]>(s, 'GET', `supplier_invoice?select=id&account_id=eq.${CUENTA_A.id}&invoice_number=eq.${encodeURIComponent(numero)}`)
  for (const f of r.datos ?? []) {
    await rest(s, 'DELETE', `supplier_invoice_line?supplier_invoice_id=eq.${f.id}`)
    await rest(s, 'DELETE', `supplier_invoice?id=eq.${f.id}`)
  }
}

test('S01d · recibida a mano (cuenta A): sin base ni local no guarda; con base calcula cuota y total, con su local, guarda y la abre para revisar, sin papel', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const numero = `PS01D-${lado(page)}-${Date.now()}`
  try {
    // S02 · PR 2: es una página de Compras y gastos (documentos/nueva); la dirección
    // de antes, desde Asientos, lleva allí.
    await page.goto('/conta/libros/diario/recibidas?nueva=a-mano')
    await expect(page).toHaveURL(/\/conta\/documentos\/nueva$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Nueva recibida a mano' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Compras y gastos', 'Facturas recibidas', 'Nueva recibida a mano'])
    // El proveedor: Hermanos Ruiz, de la semilla; si no saliera, el primero de la lista.
    const proveedor = page.getByLabel('Proveedor', { exact: true })
    const valores = await proveedor.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    const elegido = valores.includes(HERMANOS_RUIZ) ? HERMANOS_RUIZ : valores.find((v) => v !== '')
    expect(elegido, 'la cuenta A tiene algún proveedor').toBeTruthy()
    await proveedor.selectOption(elegido!)
    // Ficha completa (tablero 3b): la a mano es la misma ficha que la que entra sola
    // (FichaRecibidaBloques): «Nº de factura» y una línea de IVA con base, tipo y cuota.
    await page.getByLabel('Nº de factura').fill(numero)
    // La fecha de expedición viene puesta (hoy); el tipo, el 21 %.
    await page.getByLabel('Tipo de IVA de la línea 1').selectOption('21')

    // Sin base ni local: no guarda y dice qué falta, debajo del campo.
    // S01e: A lleva el eje de local, así que se pide, con «Común» como una opción más.
    await page.getByRole('button', { name: 'Guardar y revisarla' }).click()
    await expect(page.getByText('Escribe la base imponible.')).toBeVisible()
    await expect(page.getByText('Elige el local de la factura, o «Común» si es de todos.')).toBeVisible()
    const local = page.getByLabel('Local', { exact: true })
    const locales = await local.locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })))
    expect(locales.at(-1)).toEqual({ v: 'comun', t: 'Común (se reparte)' })
    const unLocal = locales.find((o) => o.v !== '' && o.v !== 'comun')
    expect(unLocal, 'la cuenta A tiene algún local').toBeTruthy()
    await local.selectOption(unLocal!.v)
    await expect(page.getByText('Falta algo: lo tienes debajo de cada campo en rojo.')).toBeVisible()
    await expect(page).toHaveURL(/\/conta\/documentos\/nueva$/)

    // Con base: cuota (base × tipo) y total (base + cuota), al céntimo.
    await page.getByLabel('Base al 21 %').fill('100,00')
    await expect(page.getByLabel('Cuota al 21 %')).toHaveValue('21,00')
    await expect(page.locator('[data-prueba="totales-iva"]')).toContainText(/Total\s*121,00\s€/)
    await expect(page.getByText('Escribe la base imponible.')).toHaveCount(0)

    await page.getByRole('button', { name: 'Guardar y revisarla' }).click()
    // S02 · PR 2: se abre su ficha en Compras y gastos › Facturas recibidas, en «Por revisar».
    await expect(page).toHaveURL(new RegExp(`/conta/documentos/recibidas/${UUID}\\?ver=por-revisar$`), { timeout: 30_000 })
    // Regla 8: dice qué ha guardado y qué toca ahora.
    await expect(page.getByText(new RegExp(`^Factura ${numero} de .+ guardada\\. Revísala y apúntala\\.$`))).toBeVisible()
    // Sin papel: se escribió a mano. Ficha completa: el panel «Documento» dice «Sin PDF»
    // y, en su hueco, por qué y «Arrastra aquí el PDF o la foto · Subir»; debajo del
    // título, «Escrita a mano» (solo porque lo es).
    const papel = page.getByRole('complementary', { name: 'Documento' })
    await expect(papel.getByText('Sin PDF', { exact: true })).toBeVisible()
    await expect(papel.getByText('Escrita a mano, sin PDF todavía.')).toBeVisible()
    await expect(papel.getByText(/Arrastra aquí el PDF o la foto/)).toBeVisible()
    await expect(page.locator('[data-prueba="de-donde-vino"]')).toHaveText(/^Escrita a mano el \d{2}\/\d{2}/)

    // En la base: para revisar, a mano, con sus importes y UNA línea (de ella sale el asiento).
    const id = new RegExp(`/recibidas/(${UUID})\\?`).exec(page.url())![1]
    const fac = await rest<{ status: string; source: string; tax_base_total: number; tax_total: number; grand_total: number; location_id: string | null }[]>(s, 'GET',
      `supplier_invoice?select=status,source,tax_base_total,tax_total,grand_total,location_id&id=eq.${id}`)
    expect(fac.datos.map((f) => [f.status, f.source, Number(f.tax_base_total), Number(f.tax_total), Number(f.grand_total), f.location_id]))
      .toEqual([['en_revision', 'manual', 100, 21, 121, unLocal!.v]])
    const lineas = await rest<{ line_amount: number; vat_pct: number }[]>(s, 'GET', `supplier_invoice_line?select=line_amount,vat_pct&supplier_invoice_id=eq.${id}`)
    expect(lineas.datos.map((l) => [Number(l.line_amount), Number(l.vat_pct)])).toEqual([[100, 21]])
  } finally {
    await borrarRecibida(s, numero)
  }
})

// ── 3 · El PDF de la expedida ───────────────────────────────────────────────

async function anularSiQueda(s: Sesion, id: string) {
  const [x] = (await rest<{ status: string }[]>(s, 'GET', `journal_entry?select=status&id=eq.${id}`)).datos ?? []
  if (x?.status === 'validado') await rest(s, 'POST', 'rpc/journal_entry_anular', { p_entry: id, p_motivo: 'Limpieza de la prueba e2e S01d', p_fecha: null, p_quien_nombre: 'Prueba e2e' })
  else if (x?.status === 'propuesto') await rest(s, 'POST', 'rpc/journal_entry_descartar', { p_entry: id, p_motivo: 'Limpieza de la prueba e2e S01d', p_quien_nombre: 'Prueba e2e' })
}

test('S01d · PDF de la expedida (cuenta A): se adjunta, se ve al lado (o debajo) y queda en la tarjeta «Factura» al validar', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  // S02 · PR 2: la emitida es de Facturación › Facturas emitidas, con su principal «Nueva factura emitida».
  await page.goto('/conta/facturacion/emitidas')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas emitidas' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: 'Nueva factura emitida' }).first().click()
  await expect(page).toHaveURL(/\/conta\/facturacion\/emitidas\/nueva$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura emitida' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Facturación', 'Facturas emitidas', 'Nueva factura emitida'])
  await expect(page.getByLabel('Serie')).toHaveValue('1')

  // Adjuntar: el selector está escondido detrás de su etiqueta, que hace de botón.
  const factura = page.getByRole('region', { name: 'Factura', exact: true })
  await expect(factura.getByText('Adjuntar el PDF de la factura')).toBeVisible()
  await factura.getByLabel('Adjuntar el PDF de la factura').setInputFiles(PDF_PRUEBA)
  await expect(factura.getByText(NOMBRE_PDF, { exact: true })).toBeVisible()
  await expect(factura.getByRole('button', { name: 'Quitar' })).toBeVisible()
  // S02 · PR 2: la nota dice cuándo se adjunta (antes, «El PDF se adjunta al validar» suelto).
  await expect(factura.getByText(/Se adjunta al pulsar «Guardar y validar»\./)).toBeVisible()

  // El papel, pintado: al lado del formulario en el ordenador, debajo en el móvil.
  const papel = page.getByRole('region', { name: 'La factura', exact: true })
  await expect(papel).toBeVisible()
  await expect(papel.getByRole('img', { name: `${NOMBRE_PDF} · aún sin adjuntar` })).toBeVisible()
  await expect(papel.getByText(/No he podido pintar el PDF/)).toHaveCount(0)
  // S02 · PR 2: la Hoja de líneas y el papel, en .s-hoja-con-papel (antes .cxd-expedida-con-papel).
  const form = page.locator('.s-hoja-con-papel > div').first()
  const cf = (await form.boundingBox())!
  const cp = (await papel.boundingBox())!
  if (lado(page) === 'ordenador') {
    expect(cp.x, 'el papel, a la derecha del formulario').toBeGreaterThanOrEqual(cf.x + cf.width - 1)
    expect(cp.y, 'y a su altura, no debajo').toBeLessThan(cf.y + cf.height)
  } else {
    expect(cp.y, 'el papel, debajo del formulario').toBeGreaterThanOrEqual(cf.y + cf.height - 1)
    // En el móvil se recoge y se vuelve a abrir.
    await papel.getByRole('button', { name: 'Recoger la factura' }).click()
    await expect(papel.getByRole('img')).toHaveCount(0)
    await papel.getByRole('button', { name: 'Ver la factura' }).click()
    await expect(papel.getByRole('img', { name: `${NOMBRE_PDF} · aún sin adjuntar` })).toBeVisible()
  }

  // Validar deja número para siempre: en un tamaño, y se anula al acabar.
  if (lado(page) === 'movil') return
  await page.getByLabel('Concepto', { exact: true }).fill(`Factura Prueba S01d ${Date.now().toString(36)}`)
  await page.getByLabel('Cuenta del apunte 1').fill('57200001')
  await page.getByLabel('Debe del apunte 1').fill('121,00')
  await page.getByLabel('Cuenta del apunte 2').fill('70000000')
  await page.getByLabel('Haber del apunte 2').fill('121,00')
  // Con el eje «local» encendido (A lo tiene), cada apunte dice el suyo: común.
  for (const n of [1, 2]) {
    const local = page.getByLabel(`Local del apunte ${n}`)
    if (await local.count() > 0) await local.selectOption({ label: 'Común (se reparte)' })
  }
  // S02 · PR 2: el pie de la Hoja de líneas dice «Cuadra» (antes, «✓ 0,00 €»).
  await expect(page.locator('.s-asiento-cuadra')).toHaveText('Cuadra')
  await page.getByRole('button', { name: 'Guardar y validar' }).click()
  await expect(page).toHaveURL(new RegExp(`/conta/libros/diario/${UUID}$`), { timeout: 30_000 })
  const id = new RegExp(`/diario/(${UUID})$`).exec(page.url())![1]
  try {
    // Si el PDF no se pudo adjuntar, la pantalla lo dice en un alert: se enseña en el fallo.
    const fallo = page.getByRole('alert')
    if (await fallo.count() > 0) console.log(`[aviso del asiento] ${await fallo.first().textContent()}`)
    // Regla 8: validado, con su número, y la factura adjunta con su nombre.
    await expect(page.getByRole('status').filter({ hasText: 'Guardado y validado' }))
      .toHaveText(new RegExp(`^Guardado y validado: Ventas nº \\d+\\. Factura adjunta: ${NOMBRE_PDF.replace(/\./g, '\\.')}\\.$`))
    // La tarjeta «Factura» del asiento: el fichero con su nombre, cuándo y que ya no se cambia.
    const tarjeta = page.getByRole('region', { name: 'Factura', exact: true })
    await expect(tarjeta.getByText(NOMBRE_PDF, { exact: true }).first()).toBeVisible()
    await expect(tarjeta.getByText(/^Adjunta el \d{2}\/\d{2}\/\d{4}.*Una vez adjunta no se cambia\.$/)).toBeVisible()
    await expect(tarjeta.getByText('Adjuntar el PDF')).toHaveCount(0)
  } finally {
    await anularSiQueda(s, id)
  }
})

// ── 4 · «Nuevo proveedor» en las acciones de Contactos, en el móvil ─────────

test('S01d · Contactos en el móvil: las acciones llevan «Nuevo proveedor» y abre el alta', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'En el ordenador, el alta entera: c03/terceros.spec.ts.')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/clientes-y-proveedores')
  await expect(page.getByRole('heading', { level: 1, name: 'Contactos' })).toHaveCount(1, { timeout: 30_000 })
  // S02: la cinta es ahora la fila de acciones. «Nuevo cliente» es el principal y «Nuevo
  // proveedor» un botón blanco, que en el móvil va dentro de «Más acciones»: se abre y ahí está.
  const acciones = page.getByRole('toolbar', { name: 'Acciones de Todos' })
  await expect(acciones.getByRole('link', { name: /Nuevo cliente/ })).toBeVisible()
  await acciones.getByRole('button', { name: 'Más acciones' }).click()
  const enlace = page.getByRole('group', { name: 'Más acciones' }).getByRole('link', { name: /Nuevo proveedor/ })
  await expect(enlace).toBeVisible()
  await expect(enlace).toHaveAttribute('href', /\/conta\/clientes-y-proveedores\?(.*&)?nuevo=proveedor/)
  await enlace.click()
  const dialogo = page.getByRole('dialog', { name: 'Nuevo proveedor' })
  await expect(dialogo).toBeVisible()
  await expect(dialogo.getByLabel('Nombre con el que lo conocéis')).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Dar de alta' })).toBeVisible()
  // No escribe: Cancelar lo cierra y no vuelve a abrirse.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo proveedor' })).toHaveCount(0)
  await expect(page).not.toHaveURL(/nuevo=proveedor/)
})
