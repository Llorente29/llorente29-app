/// <reference lib="dom" />
// tests/e2e/conta/r15/dia-tpv.spec.ts
//
// R15 · Los días del TPV se contabilizan al subirlos y se pueden abrir. Contra staging, en la cuenta
// del núcleo (semilla del K02): cada prueba crea una empresa de HOSTELERÍA nueva («Bar de prueba R15
// …», con su plan, su ejercicio, la cuenta de cada forma de pago y la de la factura del día). Los tres
// días son INVENTADOS (T11): el ejemplo de Revo del R04 (tests/conta/r04/revo_ejemplo) pasado al 13,
// 14 y 15/10 con la numeración seguida, y en el 15/10 un pago con «Bizum», que no tiene cuenta.
//   1. A 1456 × 816: se sueltan los cuatro ficheros, «Contabilizar 3 días»; primero se abre «A qué
//      cuenta va» (el 15/10 lleva Bizum) y se cierra sin elegir; sigue solo: 2 contabilizados (4
//      asientos) y 1 en espera, con su motivo. La lista dice «Último día subido · 15 oct». Se abre el
//      13/10: sus dos asientos enlazados y su PDF. Se abre el 15/10: en espera, «Elegir la cuenta»,
//      se elige y se contabiliza desde la ficha. En «Facturas emitidas», los tres días con su PDF y sus
//      facturas con NIF una a una; un día se abre en su ficha.
//   2. A 1366 × 768: el mismo subir hasta el paso 3, y la ficha del día cabe sin rodar de lado.
// Escribe (empresas, días, asientos): solo en un carril; sin carril se salta y lo dice.

import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, cargada, zonaActiva } from '../k02/comun'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
test.skip(CARRIL === null, 'Crea una empresa en la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/r15'
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const DIAS = ['2026-10-13', '2026-10-14', '2026-10-15'] as const

/**
 * Los cuatro ficheros de Revo con los tres días: el ejemplo inventado del 09/11 tres veces, cada una con su fecha
 * y con la numeración corrida (órdenes, documentos y pagos, +48 por día). En el último, el primer pago con tarjeta
 * pasa a «Bizum». Los bytes del ejemplo se conservan (latin1 ida y vuelta).
 */
function ficheros(info: TestInfo): string[] {
  // En una carpeta con nombre llano: la de salida de la prueba lleva «×» y «»» del título, y con esa ruta Chromium
  // no recibe el fichero (setInputFiles no falla, pero el input llega vacío: los runs 44928228542 y 44930044830).
  const dir = mkdtempSync(join(tmpdir(), `r15-revo-${info.workerIndex}-`))
  const columnas: Record<string, number[]> = { Ordenes: [0], Documentos: [0, 1], Impuestos: [0], Pagos: [0, 1, 4] }
  return Object.entries(columnas).map(([nombre, cols]) => {
    const texto = readFileSync(resolve(EJEMPLO, `${nombre}_2026-11-09.csv`)).toString('latin1')
    const fin = texto.includes('\r\n') ? '\r\n' : '\n'
    const [cabecera, ...filas] = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
    const salida = [cabecera]
    DIAS.forEach((dia, k) => {
      let bizum = nombre === 'Pagos' && k === 2
      for (const fila of filas) {
        const c = fila.split(';')
        for (const i of cols) {
          const m = /^(\s*)(\d+)$/.exec(c[i])
          if (m) c[i] = `${m[1]}${Number(m[2]) + 48 * k}`
        }
        if (bizum && c[7] === 'Tarjeta') { c[7] = 'Bizum'; bizum = false }
        salida.push(c.join(';').split('2026-11-09').join(dia))
      }
    })
    const ruta = join(dir, `${nombre}_2026-10-13_15.csv`)
    writeFileSync(ruta, Buffer.from(salida.join(fin) + fin, 'latin1'))
    return ruta
  })
}

/** Una empresa de hostelería recién creada, con su plan, su ejercicio, la cuenta de cada forma (menos Bizum) y la de la factura del día. */
async function crearHosteleria(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Bar de prueba R15 ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    sector: 'hosteleria', setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e R15' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  const ctas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&company_id=eq.${id}&status=neq.cerrada&order=code`)
  const hojas = ctas.datos.filter((c) => c.code.length === 8)
  const de = (pref: string) => hojas.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  expect(caja && banco && plataforma, `caja, banco y una 430 en el plan (${hojas.length} cuentas)`).toBeTruthy()
  const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
  const f = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: NUCLEO.id, company_id: id, forma, canal, company_account_id: cta, created_by_name: 'e2e R15' })))
  expect(f.status, `las cuentas de las formas de pago: ${JSON.stringify(f.datos).slice(0, 200)}`).toBeLessThan(300)
  expect(await asegurarFacturaDelDia(s, id), 'la cuenta de la factura del día').toBeTruthy()
  return id
}

/**
 * La huella de los asientos de un día (regla 31): de la factura del día y de su cobro, el concepto, la fecha y cada
 * apunte (orden, cuenta por su código, debe, haber, concepto y base), en el mismo orden. Sin ids ni números de
 * asiento, que son de cada empresa. Igual en dos empresas recién creadas = los mismos asientos.
 */
async function huella(s: Sesion, empresa: string, dia: string): Promise<string> {
  const d = await rest<{ id: string }[]>(s, 'POST', 'rpc/conta_tpv_dias', { p_company: empresa, p_desde: dia, p_hasta: dia })
  expect(d.datos?.[0]?.id, `el ${dia} está en la empresa: ${JSON.stringify(d.datos).slice(0, 200)}`).toBeTruthy()
  const f = await rest<{ factura: { id: string } | null; cobro: { id: string } | null }>(s, 'POST', 'rpc/conta_tpv_dia_ficha', { p_dia: d.datos[0].id })
  expect(f.datos.factura, `el ${dia} tiene su factura del día`).toBeTruthy()
  const partes: string[] = []
  const cts = (x: number | null) => String(Math.round(Number(x ?? 0) * 100))
  for (const a of [f.datos.factura, f.datos.cobro].filter((x): x is { id: string } => !!x)) {
    type Linea = { position: number; debit: number; credit: number; concept: string | null; tax_base: number | null; company_account: { code: string } | null }
    const e = await rest<{ concept: string; entry_date: string; status: string; journal_line: Linea[] }[]>(s, 'GET',
      `journal_entry?select=concept,entry_date,status,journal_line(position,debit,credit,concept,tax_base,company_account(code))&id=eq.${a.id}`)
    const x = e.datos[0]
    partes.push([x.entry_date, x.status, x.concept, ...[...x.journal_line].sort((p, q) => p.position - q.position)
      .map((l) => [l.position, l.company_account?.code, cts(l.debit), cts(l.credit), l.concept ?? '', l.tax_base == null ? '' : cts(l.tax_base)].join('|'))].join('\n'))
  }
  const { createHash } = await import('node:crypto')
  return createHash('md5').update(partes.join('\n--\n')).digest('hex')
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(`${page.url()}: ${e.message}`); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('[role="dialog"], .k-zona[data-activa="si"]').first().innerText().catch(() => '(nada)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Subir los tres días y contabilizarlos; la primera vez se abre «A qué cuenta va» por Bizum y se cierra sin elegir. */
async function subirYContabilizar(page: Page, info: TestInfo, captura: string | null) {
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  const zona = zonaActiva(page)
  // Antes de abrir la ventana, la lista de la empresa nueva cargada: si la empresa llega después, la ventana se monta otra vez y pierde los ficheros.
  await expect(zona.getByRole('tab', { name: /^Todos \d+/ })).toBeVisible({ timeout: 40_000 })
  await cargada(page, 'Cierres del día de la empresa nueva')
  await zona.getByRole('button', { name: 'Subir las ventas del TPV' }).click({ timeout: 40_000 })
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await expect(v.getByText('Suelta aquí los cuatro ficheros que te da Revo')).toBeVisible({ timeout: 30_000 })
  await v.locator('input[type=file]').setInputFiles(ficheros(info))
  await expect(v.getByRole('list', { name: 'Los ficheros' })).toBeVisible({ timeout: 30_000 })
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 3 días' })).toBeVisible({ timeout: 30_000 })
  const tabla = v.getByRole('table', { name: 'Lo que he leído' })
  for (const [dia, rango] of [['13/10', '5001 a 5048'], ['14/10', '5049 a 5096'], ['15/10', '5097 a 5144']])
    await expect(tabla.getByRole('row').filter({ hasText: dia })).toContainText(new RegExp(`${rango}.*Cuadra`), { timeout: 30_000 })
  await v.getByRole('button', { name: 'Contabilizar 3 días' }).click()

  // Primero las cuentas: el 15/10 lleva Bizum, que no tiene. Se cierra sin elegir y sigue solo.
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.getByRole('button', { name: 'Cuenta de Bizum' })).toBeVisible({ timeout: 60_000 })
  await f.getByRole('button', { name: 'Cancelar' }).click()

  try {
    await expect(v.locator('[data-prueba="resultado-contabilizados"]')).toHaveText(/^Contabilizados 2 días: 4 asientos, del nº \d+ al nº \d+\.$/, { timeout: 90_000 })
    await expect(v.locator('[data-prueba="resultado-en-espera"]')).toContainText(/^En espera 1: el 15\/10 \(falta .*Bizum.*\)\./)
    await expect(v.locator('[data-prueba="resultado-guardado"]')).toHaveText(/^Guardados 3 días, del 13\/10 al 15\/10: 144 facturas, /)
  } catch (e) { await contarPantalla(page, 'el paso 3'); throw e }
  if (captura) await page.screenshot({ path: `${DIR}/${captura}` })
  await v.getByRole('button', { name: 'Ver la lista' }).click()
  return zona
}

test('a 1456 × 816: se contabilizan al subir, se abren, el que espera se arregla desde su ficha y salen en «Facturas emitidas»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1456')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)

  // 1 · Subir y contabilizar: 2 contabilizados y 1 en espera.
  const zona = await subirYContabilizar(page, info, 'paso3-contabilizados-1456.png')
  await expect(zona.locator('.s-bandeja-cifra-etiqueta', { hasText: /^Último día subido · 15 oct$/ })).toBeVisible({ timeout: 30_000 })
  await expect(zona.getByRole('row').filter({ hasText: '5001 a 5048' })).toContainText('Validado', { timeout: 30_000 })
  await expect(zona.getByRole('row').filter({ hasText: '5097 a 5144' })).toContainText('En espera')

  // 2 · Abrir un día contabilizado: sus dos asientos enlazados y su PDF.
  await zona.getByRole('row').filter({ hasText: '5001 a 5048' }).click()
  const ficha = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  try {
    await expect(ficha).toHaveAttribute('data-estado', 'validado', { timeout: 30_000 })
    await expect(ficha.getByRole('heading', { level: 1 })).toHaveText('Revo · 13 oct')
    await expect(ficha.locator('[data-prueba="ver-factura-del-dia"]')).toHaveText(/^Ver el asiento nº \d+$/, { timeout: 30_000 })
    await expect(ficha.locator('[data-prueba="ver-cobro-del-dia"]')).toHaveText(/^Ver el asiento nº \d+$/)
    await expect(ficha.getByRole('table', { name: 'Facturas del día' })).toContainText('5001 a 5048')
    await expect(ficha.getByRole('table', { name: 'Cómo se cobró' })).toContainText('Efectivo')
    await expect(ficha.locator('iframe, embed, object, canvas').first()).toBeVisible({ timeout: 30_000 })
    await expect(ficha.locator('[data-prueba="erp10"]')).toContainText('No va a Verifactu')
  } catch (e) { await contarPantalla(page, 'la ficha del 13/10'); throw e }
  await cargada(page, 'la ficha del día contabilizado')
  await page.screenshot({ path: `${DIR}/ficha-dia-contabilizado-1456.png` })

  // 3 · Abrir el que espera y arreglarlo desde ahí.
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  await zonaActiva(page).getByRole('row').filter({ hasText: '5097 a 5144' }).click({ timeout: 30_000 })
  const espera = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  await expect(espera).toHaveAttribute('data-estado', 'en_espera', { timeout: 30_000 })
  await expect(espera.locator('[data-prueba="en-espera"]')).toContainText('Bizum')
  await page.screenshot({ path: `${DIR}/ficha-dia-en-espera-1456.png` })
  await espera.getByRole('button', { name: 'Elegir la cuenta' }).first().click()
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await f.getByRole('button', { name: 'Cuenta de Bizum' }).click({ timeout: 30_000 })
  await f.getByRole('combobox', { name: 'Número o nombre de la cuenta' }).fill('572')
  await page.keyboard.press('Enter')
  await expect(f.getByRole('button', { name: 'Guardar' })).toBeEnabled({ timeout: 30_000 })
  await f.getByRole('button', { name: 'Guardar' }).click()
  await expect(espera).toHaveAttribute('data-estado', 'por_validar', { timeout: 30_000 })
  await espera.getByRole('button', { name: 'Contabilizar' }).first().click()
  await expect(espera.locator('[data-prueba="aviso-dia"]')).toHaveText(/^Contabilizado: la factura del día es el asiento nº \d+ y su cobro el nº \d+, con su PDF\.$/, { timeout: 60_000 })
  await expect(espera).toHaveAttribute('data-estado', 'validado', { timeout: 30_000 })

  // 4 · En «Facturas emitidas»: los tres días, con su PDF, y sus facturas con NIF una a una.
  await page.goto('/conta/ventas/facturas?mes=2026-10', { timeout: 30_000 })
  const lista = zonaActiva(page)
  try {
    await expect(lista.locator('[data-prueba="emitida-dia-tpv"]')).toHaveCount(3, { timeout: 30_000 })
    for (const rango of ['5001 a 5048', '5049 a 5096', '5097 a 5144'])
      await expect(lista.getByRole('row').filter({ hasText: rango })).toContainText('Día del TPV · Revo')
    await expect(lista.locator('[data-prueba="emitida-dia-tpv"]').first().getByRole('button', { name: 'PDF' })).toBeVisible()
    await expect(lista.locator('[data-prueba="emitida-nif-tpv"]').first()).toContainText(/^Dentro del día del TPV del 1[345] oct$/)
  } catch (e) { await contarPantalla(page, 'Facturas emitidas'); throw e }
  await cargada(page, 'Facturas emitidas con los días del TPV')
  await page.screenshot({ path: `${DIR}/emitidas-dias-tpv-1456.png` })
  await lista.getByRole('row').filter({ hasText: '5049 a 5096' }).click()
  await expect(page.locator('[data-prueba="ficha-dia-tpv"]:visible')).toHaveAttribute('data-estado', 'validado', { timeout: 30_000 })

  // 5 · Regla 31: el mismo 13/10 en una empresa gemela, guardado sin contabilizar y validado con «Validar los N listos»,
  //     deja los mismos asientos que contabilizado al subir. Las dos huellas, al registro.
  const gemela = await crearHosteleria(s, '1456-gemela')
  const lectura = leerRevo(ficheros(info).map((r) => ({ nombre: r.split('/').pop()!, contenido: new Uint8Array(readFileSync(r)) })))
  if (!lectura.ok) throw new Error(lectura.problemas.join(' | '))
  const g = await rest(s, 'POST', 'rpc/conta_tpv_dia_guardar', { p_company: gemela, p_dia: DIAS[0], p_programa: 'revo', p_lectura: lectura.lectura.dias.find((x) => x.dia === DIAS[0])!.lectura, p_quien_nombre: 'Prueba e2e R15' })
  expect(g.status, `la gemela guarda el 13/10: ${JSON.stringify(g.datos).slice(0, 200)}`).toBe(200)
  // Entrar en la gemela como de cero: sin las pestañas guardadas de la primera. Con ellas, el marco del núcleo
  // (K05 · 0b, cambiarDeEmpresa) aparca las de la primera y abre la gemela en SU Inicio, no en la dirección pedida
  // (run 44948665516: la pantalla era Inicio de la gemela, con una sola pestaña).
  await page.evaluate(() => { try { window.sessionStorage.clear() } catch { /* sin almacén */ } })
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, gemela] as const)
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^Bar de prueba R15 1456-gemela / })).toBeVisible({ timeout: 30_000 })
  await zonaActiva(page).getByRole('row').filter({ hasText: '5001 a 5048' }).waitFor({ timeout: 40_000 })
  await zonaActiva(page).getByRole('button', { name: /^Validar los 1 listos$/ }).first().click()
  await page.getByRole('dialog', { name: 'Validar 1 cierre' }).getByRole('button', { name: 'Validar 1 cierre' }).click()
  await expect(zonaActiva(page).locator('[data-prueba="resultado-validar"]')).toContainText('1 cierre validado', { timeout: 90_000 })
  const alSubir = await huella(s, empresa, DIAS[0])
  const conListos = await huella(s, gemela, DIAS[0])
  console.log(`[R15 · regla 31] el 13/10 contabilizado al subir: ${alSubir} · con «Validar los N listos»: ${conListos}`)
  expect(conListos, 'los mismos asientos por los dos caminos').toBe(alSubir)

  expect(errores, 'sin errores de la página').toEqual([])
})

test('a 1366 × 768: el paso 3 y la ficha del día caben sin rodar de lado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1366')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  const zona = await subirYContabilizar(page, info, 'paso3-contabilizados-1366.png')
  await zona.getByRole('row').filter({ hasText: '5049 a 5096' }).click({ timeout: 30_000 })
  const ficha = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  await expect(ficha).toHaveAttribute('data-estado', 'validado', { timeout: 30_000 })
  await expect(ficha.locator('[data-prueba="ver-factura-del-dia"]')).toBeVisible({ timeout: 30_000 })
  await cargada(page, 'la ficha del día a 1366')
  const lado = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(lado, 'la página no rueda de lado').toBeLessThanOrEqual(1)
  await page.screenshot({ path: `${DIR}/ficha-dia-contabilizado-1366.png` })
  expect(errores, 'sin errores de la página').toEqual([])
})
