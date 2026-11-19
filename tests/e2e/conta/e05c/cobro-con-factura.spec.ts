/// <reference lib="dom" />
// tests/e2e/conta/e05c/cobro-con-factura.spec.ts
//
// E05c · Bancos del núcleo: el cobro con su factura emitida, contra staging, con la
// cuenta del núcleo en su empresa general y un banco y un cliente propios de cada
// tamaño (semilla E05c: e2e_e05c_preparar), a 1456 × 816 y a 1366 × 768:
//   1. un ingreso sin saber, F4: el buscador con las dos emitidas del cliente (la de
//      242,00 primero); Intro la elige (sale el asiento: la 572 al debe y la 430 del
//      cliente al haber); Intro confirma;
//   2. la factura queda cobrada, como la leen Cobros y su ficha (conta_factura_cobro),
//      con un cobro de 242,00;
//   3. «Deshacer» en «Qué es»: la factura vuelve a estar por cobrar y sin cobro.

import { test, expect, type Page } from '@playwright/test'
import { entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, cargada, NUCLEO } from '../k02/comun'
import { MOTOR_BANCOS } from '../../../../supabase/functions/_shared/bancos/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/e05-bancos'
interface Factura { id: string; numero: string; total: number }
interface Preparado { cuenta: string; empresa: string; banco: string; cuenta572: string; cuentaCliente: string; facturas: Record<'cobro' | 'otra', Factura>; cobro: string }

const pantalla = (page: Page) => page.locator('[data-prueba="bancos-nucleo"]')
const aviso = (page: Page) => page.locator('[data-prueba="aviso-bancos"]')
const fila = (page: Page, id: string) => pantalla(page).locator(`[data-movimiento="${id}"]`)

async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function captura(page: Page, nombre: string, ancho: number) {
  await cargada(page, nombre)
  await page.screenshot({ path: `${DIR}/${nombre}-${ancho}.png` })
}

async function preparar(s: Sesion, lado: string): Promise<Preparado> {
  const r = await rest<Preparado>(s, 'POST', 'rpc/e2e_e05c_preparar', { p_lado: lado, p_motor: MOTOR_BANCOS })
  expect(r.status, `e2e_e05c_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  return r.datos
}

/** El estado de cobro de la factura, como lo leen Cobros y su ficha (conta_factura_cobro), y sus cobros. */
async function cobroDe(s: Sesion, p: Preparado, f: Factura) {
  const e = await rest<{ estado: string; pendiente: number }[]>(s, 'GET', `conta_factura_cobro?select=estado,pendiente&account_id=eq.${p.cuenta}&invoice_id=eq.${f.id}`)
  const c = await rest<{ amount: number }[]>(s, 'GET', `customer_invoice_payment?select=amount&account_id=eq.${p.cuenta}&invoice_id=eq.${f.id}`)
  return { estado: e.datos[0]?.estado, pendiente: Number(e.datos[0]?.pendiente), cobros: c.datos.map((x) => Number(x.amount)) }
}

for (const [lado, ancho, alto] of [['ancho', 1456, 816], ['estrecho', 1366, 768]] as const) {
  test(`Bancos a ${ancho} × ${alto}: un cobro con su factura emitida, con el teclado; cobrada y deshecha`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const grande = ancho === 1456
    const s = await entrarComo(page, NUCLEO.email)
    const p = await preparar(s, lado)
    const f = p.facturas.cobro
    const cliente = `Cliente de Prueba Bancos ${lado}`
    try {
      await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
      await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
      await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
      await page.goto(`/conta/bancos?banco=${p.banco}&mes=2026-10`, { timeout: 30_000 })
      await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
      await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
      await abierta(page, 'Bancos')
      expect(await cobroDe(s, p, f)).toEqual({ estado: 'por_cobrar', pendiente: 242, cobros: [] })

      // ── 1 · F4 en el ingreso, la emitida con el teclado, Intro e Intro ──
      await expect(fila(page, p.cobro)).toContainText('242,00')
      await fila(page, p.cobro).click()
      await page.keyboard.press('F4')
      const buscar = page.locator('[data-prueba="buscar-factura"]')
      await expect(buscar.locator(`#kb-factura-${p.cobro}`)).toBeFocused()
      await expect(buscar.getByRole('option').first()).toContainText(f.numero, { timeout: 30_000 })
      await expect(buscar.getByRole('option').first()).toContainText(cliente)
      await expect(buscar.getByRole('option')).toHaveCount(2)
      if (grande) await captura(page, 'cobro-otra-factura', ancho)
      await page.keyboard.press('Enter')
      const queEs = page.locator('[data-prueba="que-es"]')
      await expect(queEs).toContainText(`Cobra la factura ${f.numero} de ${cliente}.`)
      const asiento = queEs.locator('.kf-asiento')
      await expect(asiento).toContainText('Cuadra · 242,00')
      await expect(asiento.locator('tr').nth(0)).toContainText(p.cuenta572)
      await expect(asiento.locator('tr').nth(1)).toContainText(p.cuentaCliente)
      await expect(page.locator('[data-prueba="confirmar-factura"]')).toBeFocused()
      if (grande) await captura(page, 'cobro-factura-elegida', ancho)
      await page.keyboard.press('Enter')
      await expect(aviso(page)).toHaveText(`Cobrado: Cobro de la factura ${f.numero} de ${cliente} (${cliente}) · en el diario. La factura queda cobrada.`, { timeout: 30_000 })
      await expect(fila(page, p.cobro).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      await expect(fila(page, p.cobro)).toContainText(p.cuentaCliente, { timeout: 30_000 })

      // ── 2 · La factura, cobrada ──
      expect(await cobroDe(s, p, f)).toEqual({ estado: 'cobrada', pendiente: 0, cobros: [242] })
      expect(await cobroDe(s, p, p.facturas.otra)).toMatchObject({ estado: 'por_cobrar', pendiente: 121 })
      if (grande) await captura(page, 'cobro-cobrado', ancho)

      // ── 3 · Deshacerlo ──
      // R08 · El estado de su asiento, por la API: validado con la 2040; propuesto en staging sin ella.
      const vivo = await rest<{ bank_match: { status: string; journal_entry: { status: string } | null }[] }[]>(s, 'GET', `bank_movement?select=bank_match(status,journal_entry(status))&account_id=eq.${p.cuenta}&id=eq.${p.cobro}`)
      const enElDiario = vivo.datos[0]?.bank_match.find((b) => b.status === 'vivo')?.journal_entry?.status === 'validado'
      console.log(`[E05c · el asiento del cobro] ${enElDiario ? 'validado (con la 2040)' : 'propuesto (staging sin la 2040)'}`)
      await fila(page, p.cobro).click()
      const deshacer = queEs.locator('[data-prueba="deshacer"]')
      await expect(deshacer).toBeVisible()
      await deshacer.click()
      // R08 · Lo que está en el diario se anula con su contraasiento; lo propuesto (staging sin la 2040) se quita.
      await expect(aviso(page)).toHaveText(enElDiario ? new RegExp(`^Deshecho: el movimiento de ${cliente} vuelve a estar por conciliar, y su asiento \\d+/\\d+ se anula con un contraasiento\\.$`)
        : `Deshecho: el movimiento de ${cliente} vuelve a estar por conciliar, y su asiento propuesto se quita.`, { timeout: 30_000 })
      expect(await cobroDe(s, p, f)).toEqual({ estado: 'por_cobrar', pendiente: 242, cobros: [] })
      expect(errores, 'errores de la página').toEqual([])
    } catch (e) { await contarPantalla(page, `cobro ${ancho}`); throw e }
  })
}
