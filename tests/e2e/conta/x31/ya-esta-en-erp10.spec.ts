/// <reference lib="dom" />
// tests/e2e/conta/x31/ya-esta-en-erp10.spec.ts
//
// X31 · 2 · Antes de enviar a ERP10, mirar: «Ya está en ERP10» en Libros › Cierre › Salida a ERP10, a 1366 × 768 y a
// 1920 × 1080, contra staging, en la empresa de pruebas de la cuenta A (la del X10), con la sesión del administrador.
// La base de la tanda (20261124T0835) en staging solo se prueba en ROLLBACK desde la rama: aquí se sustituyen en el
// navegador la lectura de los envíos en duda y las dos funciones que deciden (como el K08 con la barra). Lo demás, de verdad.
//   1. Una factura que ya estaba en ERP10 con otro total y un asiento que encaja con uno de ERP10: en ámbar, «Ya está en
//      ERP10 (asiento N)»; de la factura, los dos totales uno al lado del otro y la diferencia en rojo, y «Es la misma, no la
//      mandes» apagado hasta marcar «He mirado la diferencia»; del asiento, los dos botones. «Qué mirar» las cuenta.
//   2. «Es otro, mándalo» en el asiento: lo dice, y el asiento sale de la lista.
//   3. «Es la misma» en la factura, con la diferencia mirada (la función recibe p_mirada): lo dice, y no queda nada.
// Datos inventados (T11): los números de ERP10, los totales y los ids de los asientos.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x31'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const QUIEN = 'Prueba e2e X31'
const TAMANOS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

/** Los dos envíos en duda, inventados, y lo que la pantalla ha decidido de cada uno. */
function dudasDeMentira(hoy: string) {
  const filas = [
    { id: '00000000-0000-4000-8000-0000000031f1', entry_id: '00000000-0000-4000-8000-0000000031a1', clase: 'recibida', motivo: 'Ya está en ERP10 (asiento 51).',
      duda: { que: 'factura', ejercicio: hoy.slice(0, 4), serie: '2', documento: 51, cuantos: 1, numero: 'X31-0007', totalErp10Cent: 12000, totalSumiedCent: 12100 },
      journal_entry: { series: 2, number: 9001, concept: 'Proveedor Inventado X31, S.L.', entry_date: hoy } },
    { id: '00000000-0000-4000-8000-0000000031f2', entry_id: '00000000-0000-4000-8000-0000000031a2', clase: 'asiento', motivo: 'Ya está en ERP10 (asiento 61).',
      duda: { que: 'asiento', ejercicio: hoy.slice(0, 4), serie: '1', documento: 61, cuantos: 1, fecha: hoy },
      journal_entry: { series: 3, number: 9002, concept: 'Pago inventado X31', entry_date: hoy } },
  ]
  return { filas, decisiones: [] as { envio: string; que: 'la_misma' | 'otro'; mirada?: boolean }[] }
}

async function sustituir(page: Page, d: ReturnType<typeof dudasDeMentira>) {
  await page.route((u) => u.pathname.endsWith('/rest/v1/conta_erp10_envio'), async (route: Route) => {
    const u = new URL(route.request().url())
    if (route.request().method() === 'GET' && u.searchParams.get('estado') === 'eq.duda') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d.filas) })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/rpc/conta_erp10_envio_es_otro', async (route: Route) => {
    const b = route.request().postDataJSON() as { p_envio: string; p_quien_nombre: string | null }
    d.decisiones.push({ envio: b.p_envio, que: 'otro' })
    d.filas = d.filas.filter((x) => x.id !== b.p_envio)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texto: 'Es otro: sale a ERP10 en la siguiente salida, sin volver a mirar.' }) })
  })
  await page.route('**/rest/v1/rpc/conta_erp10_envio_es_la_misma', async (route: Route) => {
    const b = route.request().postDataJSON() as { p_envio: string; p_mirada: boolean }
    const f = d.filas.find((x) => x.id === b.p_envio)
    const distintos = f && 'totalErp10Cent' in f.duda && f.duda.totalErp10Cent !== f.duda.totalSumiedCent
    if (distintos && !b.p_mirada) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '23514', message: 'Los totales no son iguales: mira antes la diferencia.' }) })
    d.decisiones.push({ envio: b.p_envio, que: 'la_misma', mirada: b.p_mirada })
    d.filas = d.filas.filter((x) => x.id !== b.p_envio)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documento: f?.duda.documento, texto: `Es la misma: no se manda; queda unida al asiento ${f?.duda.documento} de ERP10.` }) })
  })
}

test('X31 · 2 · 1366 × 768 y 1920 × 1080: «Ya está en ERP10», con los dos totales y la diferencia en rojo, «Es otro» y «Es la misma» mirándola', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X31).')
  test.setTimeout(180_000)
  await page.setViewportSize(TAMANOS[0])
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  const hoy = hoyEnMadrid()
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  const d = dudasDeMentira(hoy)
  await sustituir(page, d)

  // 1 · Las dos, en ámbar.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  const bloque = page.locator('[data-prueba="ya-esta-en-erp10"]')
  await expect(bloque).toContainText('Ya está en ERP10 · 2', { timeout: 40_000 })
  await expect(page.locator('#cxe-mirar')).not.toContainText('· 0')
  const factura = bloque.locator('[data-prueba="duda-erp10"][data-que="factura"]')
  const asiento = bloque.locator('[data-prueba="duda-erp10"][data-que="asiento"]')
  await expect(factura).toContainText('La factura X31-0007 · Proveedor Inventado X31, S.L.')
  await expect(factura).toContainText('Ya está en ERP10 (asiento 51).')
  const totales = factura.locator('[data-prueba="totales-erp10"]')
  await expect(totales).toContainText('En Sumied121,00 €')
  await expect(totales).toContainText('En ERP10120,00 €')
  const dif = factura.locator('[data-prueba="diferencia-erp10"]')
  await expect(dif).toHaveText('Diferencia+1,00 €')
  // La diferencia, en rojo: el color de --cx-rojo (definida en .cx, tokens.css: se lee donde la hereda la propia cifra).
  const [rojo, colorDif] = await dif.locator('dd').evaluate((el) => [getComputedStyle(el).getPropertyValue('--cx-rojo').trim(), getComputedStyle(el).color])
  expect(rojo, 'la variable --cx-rojo existe').not.toBe('')
  const conRojo = await page.evaluate((c) => { const x = document.createElement('span'); x.style.color = c; document.body.appendChild(x); const r = getComputedStyle(x).color; x.remove(); return r }, rojo)
  expect(colorDif).toBe(conRojo)
  const laMisma = factura.getByRole('button', { name: 'Es la misma, no la mandes' })
  await expect(laMisma).toBeDisabled()
  await expect(laMisma).toHaveAttribute('title', 'Los totales no son iguales: mira antes la diferencia.')
  await expect(factura.getByRole('button', { name: /^Es otr/ })).toHaveCount(0)
  await expect(asiento).toContainText('El asiento 3/9002')
  await expect(asiento).toContainText('Ya está en ERP10 (asiento 61).')
  await expect(asiento.getByRole('button', { name: 'Es el mismo, no lo mandes' })).toBeEnabled()
  await expect(asiento.getByRole('button', { name: 'Es otro, mándalo' })).toBeEnabled()
  await expect(asiento.locator('[data-prueba="totales-erp10"]')).toHaveCount(0)
  for (const tam of TAMANOS) {
    await page.setViewportSize(tam)
    await bloque.scrollIntoViewIfNeeded()
    await expect(bloque).toBeInViewport()
    await expect(factura.getByRole('button', { name: 'Es la misma, no la mandes' })).toBeInViewport()
    await page.screenshot({ path: `${DIR}/x31-ya-esta-${tam.width}.png` })
  }

  // 2 · «Es otro, mándalo».
  await asiento.getByRole('button', { name: 'Es otro, mándalo' }).click()
  const dicho = bloque.locator('[data-prueba="duda-dicho"]')
  await expect(dicho).toHaveText(/^El asiento 3\/9002 .*: Es otro: sale a ERP10 en la siguiente salida, sin volver a mirar\.$/)
  await expect(bloque).toContainText('Ya está en ERP10 · 1')
  await expect(asiento).toHaveCount(0)

  // 3 · «Es la misma», mirando la diferencia.
  await factura.getByLabel('He mirado la diferencia').check()
  await expect(laMisma).toBeEnabled()
  for (const tam of TAMANOS) { await page.setViewportSize(tam); await laMisma.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/x31-mirada-${tam.width}.png` }) }
  await laMisma.click()
  await expect(dicho).toHaveText('La factura X31-0007 · Proveedor Inventado X31, S.L.: Es la misma: no se manda; queda unida al asiento 51 de ERP10.')
  await expect(bloque.locator('[data-prueba="duda-erp10"]')).toHaveCount(0)
  for (const tam of TAMANOS) { await page.setViewportSize(tam); await dicho.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/x31-hecho-${tam.width}.png` }) }
  expect(d.decisiones).toEqual([
    { envio: '00000000-0000-4000-8000-0000000031f2', que: 'otro' },
    { envio: '00000000-0000-4000-8000-0000000031f1', que: 'la_misma', mirada: true },
  ])
  expect(errores).toEqual([])
})
