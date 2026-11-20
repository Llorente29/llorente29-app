/// <reference lib="dom" />
// tests/e2e/conta/n05c/sin-historico.spec.ts
//
// N05c · Empezar a trabajar sin el histórico (Julio, 17/11). Ajustes › Ejercicio, en el
// apartado del corte, con el ejercicio traído a medias de ERP10 hasta el 31/10/2026 y sin lo
// anterior. En el ordenador y en el móvil:
//   1. Sin decidir: «Lo anterior al 01/11/2026 es de ERP10 y todavía no se ha traído. Hasta
//      entonces no se puede contabilizar.» y «Empezar a trabajar ya». El texto del corte dice
//      «ERP10», no «erp10».
//   2. La confirmación, con sus dos botones del mismo tamaño; «Todavía no» no decide nada.
//   3. «Empezar ya»: lo dice (regla 8) y el apartado pasa a «Se trabaja sin lo anterior…».
// El ejercicio traído a medias se SIMULA sobre la respuesta real (solo la lectura del apartado,
// la que pide works_without_history_at), y la decisión, con la forma que devuelve
// conta_trabajar_sin_historico (1655): staging tendrá la decisión de verdad cuando se aplique.
// Que la base deja o no validar lo prueba la prueba de staging de la tanda
// (supabase/staging/sql/20261117_n05c_sin_historico_prueba.sql).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/n05c'
const QUIEN = 'Prueba e2e N05c'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('N05c · sin decidir, la confirmación y «Empezar ya»', async ({ page }) => {
  test.setTimeout(120_000)
  await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let decidido: string | null = null
  const llamadas: unknown[] = []
  // El ejercicio más reciente, traído a medias de ERP10 hasta el 31/10/2026 y sin lo anterior.
  await page.route(/\/rest\/v1\/fiscal_year\?.*works_without_history_at/, async (r) => {
    const res = await r.fetch()
    const filas = (await res.json()) as Record<string, unknown>[]
    expect(filas.length, 'la cuenta A tiene algún ejercicio').toBeGreaterThan(0)
    filas[0] = { ...filas[0], origin: 'mixed', origin_program: 'erp10', imported_until: '2026-10-31', history_imported_at: null,
      works_without_history_at: decidido, works_without_history_by_name: decidido ? QUIEN : null }
    return r.fulfill({ response: res, json: filas })
  })
  // N06a (#713): el día de inicio lo dice la base (conta_empresa_dia_de_inicio), no se calcula del
  // ejercicio: se simula igual, el siguiente al traído (31/10/2026).
  await page.route(/\/rest\/v1\/rpc\/conta_empresa_dia_de_inicio(\?|$)/, (r) => json(r, '2026-11-01'))
  await page.route(/\/rest\/v1\/rpc\/conta_trabajar_sin_historico(\?|$)/, (r) => {
    llamadas.push(r.request().postDataJSON())
    decidido = new Date().toISOString()
    return json(r, { desde: '2026-11-01', yaEstaba: false, texto: 'Hecho. Ya puedes contabilizar desde el 01/11/2026. Lo anterior lo traes cuando lo tengas.' })
  })
  await page.goto('/conta/ajustes/ejercicio')

  // 1 · Sin decidir.
  const sin = page.getByTestId('sin-historico')
  await expect(sin).toContainText('Lo anterior al 01/11/2026 es de ERP10 y todavía no se ha traído. Hasta entonces no se puede contabilizar.', { timeout: 30_000 })
  await expect(page.getByTestId('corte-actual')).toContainText('lo trae ERP10')
  await expect(page.getByTestId('corte-actual')).not.toContainText('erp10')
  await sin.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/sin-decidir-${lado(page)}.png`, fullPage: true })

  // 2 · La confirmación: dos botones iguales; «Todavía no» no decide nada.
  await sin.getByRole('button', { name: 'Empezar a trabajar ya' }).click()
  const ventana = page.getByRole('dialog', { name: 'Empezar a trabajar ya' })
  await expect(ventana.getByTestId('confirmar-sin-historico')).toHaveText('Vas a poder contabilizar desde el 01/11/2026. Los saldos y los listados no llevarán lo de antes hasta que lo traigas.')
  const ya = ventana.getByRole('button', { name: 'Empezar ya', exact: true })
  const todavia = ventana.getByRole('button', { name: 'Todavía no', exact: true })
  const [a, b] = [await ya.boundingBox(), await todavia.boundingBox()]
  expect(Math.abs((a?.width ?? 0) - (b?.width ?? 1)), 'los dos botones, del mismo ancho').toBeLessThan(2)
  expect(await ya.getAttribute('class')).toBe(await todavia.getAttribute('class'))
  await page.screenshot({ path: `${DIR}/confirmar-${lado(page)}.png` })
  await todavia.click()
  await expect(ventana).toHaveCount(0)
  expect(llamadas).toEqual([])

  // 3 · «Empezar ya»: lo dice y el apartado cambia.
  await sin.getByRole('button', { name: 'Empezar a trabajar ya' }).click()
  await ventana.getByRole('button', { name: 'Empezar ya', exact: true }).click()
  await expect(page.getByText('Hecho. Ya puedes contabilizar desde el 01/11/2026. Lo anterior lo traes cuando lo tengas.')).toBeVisible({ timeout: 20_000 })
  expect(llamadas).toHaveLength(1)
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  const hoyDma = `${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${hoy.slice(0, 4)}`
  const decididoAhora = page.getByTestId('sin-historico-decidido')
  await expect(decididoAhora).toHaveText(`Se trabaja sin lo anterior al 01/11/2026 desde el ${hoyDma} (lo decidió ${QUIEN}). Cuando lo tengas, tráelo.`, { timeout: 20_000 })
  await expect(sin).toHaveCount(0)
  await decididoAhora.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/decidido-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
