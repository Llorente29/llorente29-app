/// <reference lib="dom" />
// tests/e2e/conta/x33/qbo-a-erp10.spec.ts
//
// X33 · La contabilidad de QBO a ERP10, contra staging, en la empresa de pruebas de la cuenta A (la del X10 y el X31),
// con la sesión del administrador, a 1366 × 768 y a 1920 × 1080. Con el ERP10 simulado de staging: no se manda nada.
// Los datos de GoCardless de noviembre de 2026, de la semilla del X33 (seed_x33_gocardless_staging.sql, inventados, T11).
//   1. En «Salida a ERP10», noviembre de 2026: «Asientos de GoCardless de noviembre de 2026 · 4», todos por preparar.
//   2. «Preparar los de noviembre de 2026»: 2 preparados (el cobro con su 430, 57200002 / 43000101 con
//      «2026/1/0001-nombre», y el ingreso, 57200000 / 57200002) y 2 en «Pendiente de revisar» con su motivo, arriba.
//      Quedan por revisar: no sale ninguno.
//   3. Otra vez: ninguno nuevo (nada dos veces).
//   4. «Las facturas las emite Cegid: no se suben las de Sumied», en Ajustes › Ejercicio: al encenderlo lo confirma con
//      la frase de la base y dice quién y cuándo; y «Salida a ERP10» lo dice en «Qué mirar».

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x33'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const QUIEN = 'Prueba e2e X33'
const MES = '2026-11-01'
const TAMANOS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

/** Un importe con dos decimales y punto («60.50»), como lo escribe la base. Un null da «0.00». */
const dos = (x: unknown) => { const c = Math.round(Number(x ?? 0) * 100); return `${Math.trunc(c / 100)}.${String(Math.abs(c % 100)).padStart(2, '0')}` }

async function aLaSalida(page: Page) {
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  await page.getByRole('combobox', { name: 'Mes' }).selectOption(MES)
}

async function enLasDos(page: Page, nombre: string, antes?: () => Promise<void>) {
  for (const tam of TAMANOS) {
    await page.setViewportSize(tam)
    if (antes) await antes()
    await page.screenshot({ path: `${DIR}/${nombre}-${tam.width}.png` })
  }
}

test('X33 · 1366 × 768 y 1920 × 1080: los asientos de GoCardless del mes, «Pendiente de revisar», nada dos veces y «Las facturas las emite Cegid»', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X33).')
  test.setTimeout(180_000)
  await page.setViewportSize(TAMANOS[0])
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: MES, p_quien_nombre: QUIEN })
  await api(s, 'POST', 'rpc/conta_erp10_facturas_fuera_poner', { p_company: EMPRESA_A, p_encendido: false, p_quien_nombre: QUIEN })

  // 1 · Por preparar.
  await aLaSalida(page)
  const bloque = page.locator('[data-prueba="asientos-gocardless"]')
  await expect(bloque).toContainText('Asientos de GoCardless de noviembre de 2026 · 4', { timeout: 40_000 })
  await expect(bloque).toContainText('0 preparados · 0 en «Pendiente de revisar» · 4 por preparar.')
  await enLasDos(page, 'x33-por-preparar', () => bloque.scrollIntoViewIfNeeded())

  // 2 · Preparar: lo que se puede, por revisar; lo que no, a «Pendiente de revisar» con su motivo.
  await bloque.getByRole('button', { name: 'Preparar los de noviembre de 2026' }).click()
  await expect(bloque.locator('[data-prueba="gc-preparados"]')).toHaveText('2 preparados · 0 ya estaban · 2 en «Pendiente de revisar».', { timeout: 30_000 })
  await expect(bloque).toContainText('2 preparados · 2 en «Pendiente de revisar».')
  await bloque.getByRole('button', { name: /^Ver la lista/ }).click()
  const filas = bloque.getByRole('table', { name: 'Asientos de GoCardless' }).locator('tbody tr')
  await expect(filas).toHaveCount(4)
  // Lo pendiente, arriba (regla 7: está todo).
  await expect(filas.nth(0)).toContainText('Pendiente de revisar:')
  await expect(filas.nth(1)).toContainText('Pendiente de revisar:')
  await expect(bloque).toContainText('Pendiente de revisar: El cliente no tiene su 430 · Falta el número de factura')
  await expect(bloque).toContainText('Pendiente de revisar: El cobro no está atado a ningún cliente de Sumied · Falta el número de factura')
  await expect(bloque.getByRole('link', { name: 'Por revisar' })).toHaveCount(2)
  await enLasDos(page, 'x33-preparados', () => bloque.scrollIntoViewIfNeeded())

  // En la base: el cobro y el ingreso, propuestos (por revisar, sin salir), con las cuentas del libro mayor de QBO.
  const mes = await api<{ filas: { clase: string; gc_id: string; entry_id: string | null; estado: string | null; pendiente: string[] }[] }>(
    s, 'POST', 'rpc/conta_gc_asientos_del_mes', { p_company: EMPRESA_A, p_mes: MES })
  const cobro = mes.filas.find((f) => f.clase === 'cobro' && f.gc_id === 'PM00X33SEM1')
  const ingreso = mes.filas.find((f) => f.clase === 'ingreso')
  expect(cobro?.estado, 'el cobro con su 430, por revisar').toBe('propuesto')
  expect(ingreso?.estado, 'el ingreso, por revisar').toBe('propuesto')
  const lineas = async (entry: string) => (await api<{ debit: number; credit: number; concept: string; company_account: { code: string } }[]>(s, 'GET',
    `journal_line?entry_id=eq.${entry}&select=debit,credit,concept,company_account(code)&order=position`))
    .map((l) => `${l.company_account.code} ${dos(l.debit)}/${dos(l.credit)}`)
  expect(await lineas(cobro!.entry_id!)).toEqual(['57200002 60.50/0.00', '43000101 0.00/60.50'])
  expect(await lineas(ingreso!.entry_id!)).toEqual(['57200000 158.95/0.00', '57200002 0.00/158.95'])
  const concepto = await api<{ concept: string }[]>(s, 'GET', `journal_entry?id=eq.${cobro!.entry_id}&select=concept`)
  expect(concepto[0]?.concept).toBe('2026/1/0001-Cliente Inventado X33 Uno, S.L.')

  // 3 · Nada dos veces.
  await bloque.getByRole('button', { name: 'Preparar los de noviembre de 2026' }).click()
  await expect(bloque.locator('[data-prueba="gc-preparados"]')).toHaveText('0 preparados · 2 ya estaban · 2 en «Pendiente de revisar».', { timeout: 30_000 })
  const otra = await api<{ filas: unknown[] }>(s, 'POST', 'rpc/conta_gc_asientos_del_mes', { p_company: EMPRESA_A, p_mes: MES })
  expect(otra.filas).toHaveLength(4)

  // 4 · «Las facturas las emite Cegid: no se suben las de Sumied», en Ajustes › Ejercicio.
  await page.goto('/conta/ajustes/ejercicio', { waitUntil: 'load' })
  const ajuste = page.locator('[data-prueba="facturas-cegid"]')
  const interruptor = ajuste.getByRole('switch')
  await expect(interruptor).toBeEnabled({ timeout: 40_000 })
  await expect(interruptor).not.toBeChecked()
  await interruptor.click()
  await expect(ajuste).toContainText('Encendido: las facturas de Sumied de esta empresa no salen a ERP10 (las emite Cegid). Los demás asientos, sí.', { timeout: 30_000 })
  await expect(ajuste).toContainText(/Lo cambió .+ el \d{2}\/\d{2}\/\d{4}\./)
  await expect(interruptor).toBeChecked()
  await enLasDos(page, 'x33-ajuste-cegid', () => ajuste.scrollIntoViewIfNeeded())

  await aLaSalida(page)
  const nota = page.locator('[data-prueba="facturas-fuera"]')
  await expect(nota).toContainText('Las facturas las emite Cegid: no se suben las de Sumied.', { timeout: 40_000 })
  await expect(nota).toContainText('Los demás asientos salen como siempre.')
  await enLasDos(page, 'x33-salida-cegid', () => nota.scrollIntoViewIfNeeded())

  await api(s, 'POST', 'rpc/conta_erp10_facturas_fuera_poner', { p_company: EMPRESA_A, p_encendido: false, p_quien_nombre: QUIEN })
  expect(errores, 'sin errores de la página').toEqual([])
})
