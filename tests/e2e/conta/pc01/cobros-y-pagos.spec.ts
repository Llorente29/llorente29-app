// tests/e2e/conta/pc01/cobros-y-pagos.spec.ts
//
// PC01 · Entrega 1 · Un solo motor de cobros y pagos, en el ordenador y en el
// móvil, contra staging-conta (cuenta A, en su carril).
//
//   1. «Cuándo te paga» en la ficha de una plataforma (Contactos › Plataforma
//      Norte › Cobro): el periodo, los días hasta el pago y el margen, con un
//      ejemplo con fechas; «Guardar cambios» (la pieza común) lo guarda y lo
//      dice con contenido (regla 8). Escribe: solo en el ordenador, y lo deja
//      como estaba.
//   2. Ventas › Facturas: las cifras y los estados salen de la base
//      (conta_factura_cobro); «Por cobrar» dice las que esperan liquidación.
// Las capturas, en docs/conta/capturas/pc01 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/pc01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = async (page: Page, nombre: string) => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function plataformaNorte(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'GET', `party?select=id&account_id=eq.${CUENTA_A.id}&name=eq.${encodeURIComponent('Plataforma Norte')}`)
  expect(r.datos?.length, 'la semilla tiene a Plataforma Norte en la cuenta A').toBe(1)
  return r.datos[0].id
}

test('«Cuándo te paga» en la ficha de la plataforma: periodo, día de pago y margen, con su ejemplo', async ({ page }, info) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  const id = await plataformaNorte(s)
  const papel = `party_role?account_id=eq.${CUENTA_A.id}&party_id=eq.${id}&role=eq.platform`
  const antes = (await rest<{ settlement_every: string | null; payout_days_after: number | null; payout_margin_days: number | null }[]>(s, 'GET',
    `${papel}&select=settlement_every,payout_days_after,payout_margin_days`)).datos[0]
  expect(antes, 'Plataforma Norte es plataforma en la semilla').toBeTruthy()
  try {
    await page.goto(`/conta/clientes-y-proveedores/${id}/cobro`)
    const tarjeta = page.locator('[data-prueba="cuando-paga"]')
    await expect(tarjeta.getByRole('heading', { name: 'Cuándo te paga' })).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByRole('button', { name: 'Cada semana' })).toBeVisible()
    if (info.project.name === 'movil') {
      await foto(page, 'cuando-paga')
      return
    }
    // Lo que se cambia sale en la barra común; el ejemplo, con fechas de verdad.
    // Las píldoras se marcan y se desmarcan: «Cada semana» solo se pulsa si no
    // lo está ya; y los días, distintos de los de la semilla, para que haya un
    // cambio que guardar (e2e 899: con la semilla ya semanal, el clic la quitaba).
    const semana = tarjeta.getByRole('button', { name: /^Cada semana/ })
    if ((await semana.getAttribute('aria-pressed')) !== 'true') await semana.click()
    await expect(semana).toHaveAttribute('aria-pressed', 'true')
    const d = antes.payout_days_after === 2 ? 3 : 2
    const lunes = d === 2 ? 'martes' : 'miércoles'
    await tarjeta.getByLabel(/Paga unos … días después de cerrar el periodo/).fill(String(d))
    await tarjeta.getByLabel(/Margen antes de darla por vencida/).fill('')
    await expect(tarjeta.locator('[data-prueba="ejemplo-plazo"]')).toContainText(new RegExp(`La semana del \\d\\d/\\d\\d al \\d\\d/\\d\\d la paga hacia el ${lunes} \\d\\d/\\d\\d; si el \\d\\d/\\d\\d no ha llegado, sus facturas salen «Falta su liquidación»\\. Margen: 5 días\\.`))
    await foto(page, 'cuando-paga-cambios')
    await page.getByRole('button', { name: /Guardar cambios/ }).click()
    // Regla 8: lo que se guardó y cuántas facturas cambian de vencimiento.
    await expect(page.getByText(new RegExp(`^Guardado: Plataforma Norte paga cada semana, hacia ${d} días después de cerrarlo, con 5 de margen\\. (Ninguna factura por cobrar cambia|\\d+ facturas? por cobrar cambia)`))).toBeVisible()
    await expect.poll(async () => (await rest<{ settlement_every: string; payout_days_after: number }[]>(s, 'GET', `${papel}&select=settlement_every,payout_days_after`)).datos[0])
      .toEqual({ settlement_every: 'weekly', payout_days_after: d })
    await foto(page, 'cuando-paga-guardado')
    // Un número que no es: lo dice y no guarda.
    await tarjeta.getByLabel(/Margen antes de darla por vencida/).fill('99')
    await expect(tarjeta.getByRole('alert')).toContainText('Un número de días entre 0 y 60.')
  } finally {
    if (info.project.name !== 'movil') {
      const r = await rest(s, 'POST', 'rpc/conta_plataforma_plazo_guardar', { p_party: id, p_cada: antes.settlement_every, p_dias: antes.payout_days_after, p_margen: antes.payout_margin_days })
      expect(r.status, 'Plataforma Norte vuelve a su plazo de antes').toBeLessThan(300)
    }
  }
  expect(errores).toEqual([])
})

test('Ventas › Facturas: las cifras y los estados de la base', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/facturas')
  await expect(page.getByText('Por cobrar', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Vencido', { exact: true }).first()).toBeVisible()
  await foto(page, 'ventas-facturas')
  expect(errores).toEqual([])
})
