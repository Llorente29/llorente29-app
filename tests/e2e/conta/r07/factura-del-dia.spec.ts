// tests/e2e/conta/r07/factura-del-dia.spec.ts
//
// R07 · «A qué cuenta va cada forma de pago», con la factura del día (maqueta 4), contra
// staging-conta, en el carril de la cuenta A (la empresa del cierre de Glovo del 24/09, la misma
// del R05 y el R06). Sin un dato real: el día es el ejemplo INVENTADO de Revo (09/11).
//
//   1. A 1456 × 816: arriba a la izquierda, «La factura del día» con su fila «La factura del día va
//      a», la línea de Hacienda y «Cómo se ha cobrado» debajo. Se elige la cuenta con el buscador de
//      siempre (la 430 «contado» de la empresa) y se guarda: lo dice con contenido (regla 8) y, desde
//      entonces, «Desde el …, cada día va en dos asientos».
//      A la derecha, «Cómo quedan los asientos de un día»: con la 0900 aplicada, «1 · La factura del
//      día» con su rango de tickets y «2 · El cobro del día», con «Clientes de contado queda a 0,00».
//      Desde una rama, la 0900 va a staging solo en ROLLBACK (W04): la base aún da un asiento, y la
//      prueba comprueba que la ventana lo enseña como uno («Cómo queda el asiento de un día»).
//   2. A 1366 × 768, la ventana cabe sin que ruede la página, y la cuenta y las cifras se leen enteras.
// Validar un día lo prueba el R05 (el mismo botón); con la 0900, su frase dice los dos asientos.
// Las capturas, en docs/conta/capturas/r07 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

const DIR = 'docs/conta/capturas/r07'
const CIERRE_GLOVO = enCarril('acebcda4-f03a-4f84-bfe4-062a941e60a2')
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function rpc<T>(s: Sesion, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${t}`)
  return (t ? JSON.parse(t) : null) as T
}

/** Las formas de pago con su cuenta y el 09/11 guardado (como el R05 y el R06); y la 430 «Clientes de contado» que se va a elegir. */
async function preparar(s: Sesion): Promise<{ empresa: string; contado: string }> {
  const cierre = await rest<{ company_id: string }[]>(s, 'GET', `sales_day_summary?select=company_id&id=eq.${CIERRE_GLOVO}`)
  const empresa = cierre.datos[0]?.company_id
  if (!empresa) throw new Error('No encuentro la empresa del cierre de Glovo del 24/09 en el carril.')
  const ctas = await rest<{ id: string; code: string; name: string }[]>(s, 'GET', `company_account?select=id,code,name&company_id=eq.${empresa}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.datos.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.datos.length} cuentas).`)
  const ya = await rest<{ forma: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=forma&company_id=eq.${empresa}`)
  if (!ya.datos.length) {
    const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
    const r = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: empresa, forma, canal, company_account_id: cta, created_by_name: 'e2e R07' })))
    if (r.status >= 300) throw new Error(`No se han podido guardar las cuentas de las formas de pago: ${r.status} ${JSON.stringify(r.datos)}`)
  }
  const dias = await rpc<{ dia: string }[]>(s, 'conta_tpv_dias', { p_company: empresa, p_desde: '2026-11-09', p_hasta: '2026-11-09' })
  if (!dias.length) {
    const lectura = leerRevo(['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`))) })))
    if (!lectura.ok) throw new Error(lectura.problemas.join(' | '))
    await rpc(s, 'conta_tpv_dia_guardar', { p_company: empresa, p_dia: '2026-11-09', p_programa: 'revo', p_lectura: lectura.lectura.dias[0].lectura, p_quien_nombre: 'Prueba e2e' })
  }
  // «Clientes de contado»: la que ya tiene la empresa, o una nueva (como haría «da de alta» en la ventana).
  const contado = ctas.datos.find((c) => c.code.startsWith('430') && c.code.length >= 8 && /contado/i.test(c.name))?.code
    ?? (await rpc<{ code: string }>(s, 'company_account_add', {
      p_company: empresa, p_hoja: '4300', p_nombre: 'Clientes de contado', p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: 'Prueba e2e', p_source: 'manual',
    })).code
  return { empresa, contado }
}

/** La ventana cabe entera: no se sale de la pantalla, no rueda de lado y su pie se ve. */
const sinRodar = async (page: Page) => {
  const m = await page.evaluate(() => {
    const v = document.querySelector('.tpv-ventana') as HTMLElement | null
    const pie = document.querySelector('.tpv-pie') as HTMLElement | null
    if (!v || !pie) return 'sin ventana'
    const r = v.getBoundingClientRect(), p = pie.getBoundingClientRect()
    return [r.top >= 0, r.bottom <= innerHeight + 1, r.right <= innerWidth + 1, v.scrollWidth <= v.clientWidth + 1, p.bottom <= innerHeight + 1].join(',')
  })
  expect(m, 'arriba, abajo, derecha, sin rodar de lado, pie a la vista').toBe('true,true,true,true,true')
}

/** Nada se corta: ningún texto de la ventana se sale de su caja (cuentas largas, rango y cifras). */
const nadaCortado = async (page: Page) => {
  const cortados = await page.evaluate(() => [...document.querySelectorAll('.tpv-ventana td, .tpv-ventana th, .tpv-ventana .tpv-elegir-boton > span:first-child, .tpv-ventana h4')]
    .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map((e) => (e as HTMLElement).innerText.slice(0, 60)))
  expect(cortados, 'textos cortados').toEqual([])
}

async function abrirVentana(page: Page) {
  await page.goto('/conta/ajustes/ventas-por-dia')
  await page.getByRole('button', { name: 'A qué cuenta va cada forma de pago' }).click({ timeout: 30_000 })
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.getByRole('table', { name: 'A qué cuenta va cada forma de pago' })).toBeVisible({ timeout: 30_000 })
  return f
}

test('la factura del día: se elige su cuenta, se guarda y se ven los asientos de un día', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  const { empresa, contado } = await preparar(s)
  const antes = await rpc<{ factura: { cuenta: string } | null }>(s, 'conta_tpv_factura_de', { p_company: empresa, p_mes: null })

  const f = await abrirVentana(page)
  // La factura del día, arriba a la izquierda, y debajo «Cómo se ha cobrado».
  const seccion = f.locator('[data-prueba="factura-del-dia"]')
  await expect(seccion.getByRole('heading', { name: 'La factura del día' })).toBeVisible()
  await expect(seccion.locator('[data-prueba="fila-factura-del-dia"]')).toContainText('La factura del día va a')
  await expect(seccion.getByText('Cada día, todos los tickets de un local se apuntan en una sola factura, con su primer y su último número. Así lo pide Hacienda y así lo hace ERP10.')).toBeVisible()
  await expect(f.getByRole('heading', { name: 'Cómo se ha cobrado' })).toBeVisible()
  await expect(f.getByText(/asiento resumen|art\. 63|contrapartida/i)).toHaveCount(0)

  // Elegir la cuenta con el buscador de siempre.
  await f.getByRole('button', { name: 'Cuenta de la factura del día' }).click()
  await f.getByRole('combobox', { name: 'Número o nombre de la cuenta' }).fill(contado)
  await page.keyboard.press('Enter')
  await expect(f.getByRole('button', { name: 'Cuenta de la factura del día' })).toContainText(new RegExp(`^${contado} · `))

  // La derecha: con la 0900, los dos asientos; desde la rama, uno (la base aún no parte el día).
  await expect(f.locator('[data-prueba="asiento-factura"], [data-prueba="asiento-ejemplo"]').first()).toBeVisible({ timeout: 30_000 })
  const enDos = await f.locator('[data-prueba="asiento-cobro"]').count() > 0
  console.log(`[R07] la base ${enDos ? 'parte el día en dos asientos (0900 aplicada)' : 'aún da un asiento (0900 solo en ROLLBACK desde la rama)'}`)
  if (enDos) {
    await expect(f.getByRole('heading', { name: /^1 · La factura del día · tickets \d+ a \d+$/ })).toBeVisible()
    await expect(f.getByRole('heading', { name: '2 · El cobro del día' })).toBeVisible()
    await expect(f.getByRole('table', { name: 'La factura del día' }).getByRole('row').filter({ hasText: contado }).first()).toContainText('1.100,00')
    await expect(f.locator('[data-prueba="contado-a-cero"]')).toHaveText('Clientes de contado queda a 0,00')
    await expect(f.getByText(/^Así sale también a ERP10/)).toBeVisible()
  } else {
    await expect(f.getByRole('heading', { name: 'Cómo queda el asiento de un día' })).toBeVisible()
  }
  await sinRodar(page)
  await nadaCortado(page)
  await page.screenshot({ path: `${DIR}/factura-del-dia-elegida-1456.png` })

  // Guardar, con contenido.
  await expect(f.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  await f.getByRole('button', { name: 'Guardar' }).click()
  const hecho = f.locator('[data-prueba="resultado-formas"]')
  if (antes.factura?.cuenta === contado) await expect(hecho).toHaveText(/^Guardado/, { timeout: 30_000 })
  else await expect(hecho).toContainText(new RegExp(`La factura del día va a la ${contado} · .+\\. Desde el \\d\\d/\\d\\d/\\d{4}, cada día va en dos asientos: la factura del día y su cobro\\.$`), { timeout: 30_000 })
  await expect(f.locator('[data-prueba="desde-dos-asientos"]')).toHaveText(/^Desde el \d\d\/\d\d\/\d{4}, cada día va en dos asientos: la factura del día y su cobro\. Los días ya validados se quedan como están\.$/)
  const despues = await rpc<{ factura: { cuenta: string } | null }>(s, 'conta_tpv_factura_de', { p_company: empresa, p_mes: null })
  expect(despues.factura?.cuenta).toBe(contado)
  await page.screenshot({ path: `${DIR}/factura-del-dia-guardada-1456.png` })
  expect(errores).toEqual([])
})

test('a 1366 × 768, la ventana con la factura del día cabe y nada se corta', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  await preparar(s)
  const f = await abrirVentana(page)
  await expect(f.locator('[data-prueba="fila-factura-del-dia"]')).toBeVisible()
  await expect(f.locator('[data-prueba="asiento-factura"], [data-prueba="asiento-ejemplo"]').first()).toBeVisible({ timeout: 30_000 })
  await sinRodar(page)
  await nadaCortado(page)
  await page.screenshot({ path: `${DIR}/factura-del-dia-1366.png` })
  expect(errores).toEqual([])
})
