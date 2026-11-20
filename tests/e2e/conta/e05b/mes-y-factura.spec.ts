/// <reference lib="dom" />
// tests/e2e/conta/e05b/mes-y-factura.spec.ts
//
// E05b · Bancos del núcleo: el mes y «Es otra factura», contra staging, con la
// cuenta del núcleo en su empresa general y un banco propio de cada tamaño
// (semilla E05b: e2e_e05b_preparar), a 1456 × 816 y a 1366 × 768:
//   1. el periodo, junto al banco: se abre en octubre (el del último extracto);
//      Re Pág pasa a septiembre (sus 2 movimientos, «2 por revisar», el saldo del
//      banco de septiembre y el saldo a la fecha) y Av Pág vuelve a octubre;
//   2. «Es otra factura» con el teclado: F4 en el pago, la factura del proveedor
//      la primera, Intro la elige (sale el asiento que sale), Intro confirma;
//   3. «el mismo casado» (regla 31): el otro pago del mismo proveedor se casa
//      desde la pantalla de hoy («Buscar factura»), y se comparan los dos casados,
//      su asiento y su factura por la API, con la misma vara.

import { test, expect, type Page } from '@playwright/test'
import { entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, cargada, NUCLEO } from '../k02/comun'
import { MOTOR_BANCOS } from '../../../../supabase/functions/_shared/bancos/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/e05-bancos'
interface Factura { id: string; numero: string; total: number }
interface Preparado {
  cuenta: string; empresa: string; banco: string; cuenta572: string; cuentaProveedor: string
  movs: Record<'seguro1' | 'seguro2' | 'probable' | 'aclarar' | 'casado', string>
  facturas: Record<'nueva' | 'hoy', Factura>; pagos: Record<'nueva' | 'hoy', string>; septiembre: Record<'cargo' | 'abono', string>
}

const pantalla = (page: Page) => page.locator('[data-prueba="bancos-nucleo"]')
const aviso = (page: Page) => page.locator('[data-prueba="aviso-bancos"]')
const fila = (page: Page, id: string) => pantalla(page).locator(`[data-movimiento="${id}"]`)
const filas = (page: Page) => pantalla(page).locator('[data-movimiento]')

async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function captura(page: Page, nombre: string, ancho: number) {
  await cargada(page, nombre)
  await page.screenshot({ path: `${DIR}/${nombre}-${ancho}.png` })
}

async function preparar(s: Sesion, lado: string): Promise<Preparado> {
  const r = await rest<Preparado>(s, 'POST', 'rpc/e2e_e05b_preparar', { p_lado: lado, p_motor: MOTOR_BANCOS })
  expect(r.status, `e2e_e05b_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  return r.datos
}

/** El casado de un pago con su factura, con la vara de la regla 31: el importe, como «total»; la 572, «banco»; la del proveedor, «proveedor». */
async function casadoDe(s: Sesion, p: Preparado, mov: string, f: Factura) {
  const m = await rest<{ status: string; bank_match: { kind: string; confidence: string; by_who: string; status: string; entry_created: boolean; journal_entry: { series: number; status: string; source_type: string; journal_line: { debit: number; credit: number; company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
    `bank_movement?select=status,bank_match(kind,confidence,by_who,status,entry_created,journal_entry(series,status,source_type,journal_line(debit,credit,company_account(code))))&account_id=eq.${p.cuenta}&id=eq.${mov}`)
  const fac = await rest<{ status: string }[]>(s, 'GET', `supplier_invoice?select=status&account_id=eq.${p.cuenta}&id=eq.${f.id}`)
  const vivo = m.datos[0]?.bank_match.find((b) => b.status === 'vivo') ?? null
  const e = vivo?.journal_entry ?? null
  const importe = (x: number) => (Number(x) === f.total ? 'total' : Number(x))
  const cuenta = (c: string) => (c === p.cuenta572 ? 'banco' : c === p.cuentaProveedor ? 'proveedor' : c)
  return {
    movimiento: m.datos[0]?.status, kind: vivo?.kind, confianza: vivo?.confidence, quien: vivo?.by_who, creado: vivo?.entry_created, factura: fac.datos[0]?.status,
    asiento: e ? { serie: e.series, estado: e.status, origen: e.source_type,
      lineas: e.journal_line.map((l) => [cuenta(l.company_account.code), importe(l.debit), importe(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) } : null,
  }
}

for (const [lado, ancho, alto] of [['ancho', 1456, 816], ['estrecho', 1366, 768]] as const) {
  test(`Bancos a ${ancho} × ${alto}: pasar de mes y volver, y «Es otra factura» con el teclado, el mismo casado que hoy`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const grande = ancho === 1456
    const s = await entrarComo(page, NUCLEO.email)
    const p = await preparar(s, lado)
    try {
      await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
      await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
      await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
      await page.goto(`/conta/bancos?banco=${p.banco}`, { timeout: 30_000 })
      await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
      await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
      await abierta(page, 'Bancos')
      const periodo = pantalla(page).locator('[data-prueba="periodo"]')
      const revisar = pantalla(page).locator('[data-prueba="por-conciliar"]')

      // ── 1 · El mes: octubre, Re Pág a septiembre, Av Pág de vuelta ──
      await expect(periodo).toHaveValue('2026-10')
      // La cabecera cabe con el periodo: lo que va detrás de él se ve (las capturas de la 44476280972 lo tenían fuera).
      await expect(revisar).toBeInViewport()
      await expect(pantalla(page).getByRole('button', { name: 'Traer el extracto' })).toBeInViewport()
      await expect(pantalla(page).getByRole('combobox', { name: 'Banco' })).toContainText(`57200`)
      // Octubre: 3 por confirmar, 3 por aclarar (el ingreso y los dos pagos) y 1 por validar (el agua casada sola).
      await expect(filas(page)).toHaveCount(7)
      await expect(revisar).toHaveText('6 por conciliar · 1 conciliado · 0 apartados')
      await expect(pantalla(page).locator('.kf-estado')).toContainText('Banco 1.214,10')
      await fila(page, p.movs.aclarar).click()
      await page.keyboard.press('PageUp')
      await expect(periodo).toHaveValue('2026-09', { timeout: 30_000 })
      await expect(filas(page)).toHaveCount(2, { timeout: 30_000 })
      await expect(fila(page, p.septiembre.abono)).toContainText('130,00')
      await expect(fila(page, p.septiembre.cargo)).toContainText('30,00')
      await expect(revisar).toHaveText('2 por conciliar · 0 conciliados · 0 apartados')
      await expect(pantalla(page).locator('.kf-estado')).toContainText('Banco 1.000,00')
      await expect(page.locator('[data-prueba="saldo-a-la-fecha"]')).toContainText('25/09/2026')
      await expect(page).toHaveURL(/mes=2026-09/)
      if (grande) await captura(page, 'septiembre', ancho)
      await page.keyboard.press('PageDown')
      await expect(periodo).toHaveValue('2026-10', { timeout: 30_000 })
      await expect(filas(page)).toHaveCount(7, { timeout: 30_000 })
      await expect(revisar).toHaveText('6 por conciliar · 1 conciliado · 0 apartados')
      await expect(pantalla(page).locator('.kf-estado')).toContainText('Banco 1.214,10')

      // ── 2 · «Es otra factura», con el teclado ──
      const f = p.facturas.nueva
      await fila(page, p.pagos.nueva).click()
      await page.keyboard.press('F4')
      const buscar = page.locator('[data-prueba="buscar-factura"]')
      await expect(buscar).toBeVisible()
      await expect(buscar.locator(`#kb-factura-${p.pagos.nueva}`)).toBeFocused()
      await expect(buscar.getByRole('option').first()).toContainText(f.numero, { timeout: 30_000 })
      await expect(buscar.getByRole('option')).toHaveCount(2)
      if (grande) await captura(page, 'otra-factura', ancho)
      await page.keyboard.press('Enter')
      const queEs = page.locator('[data-prueba="que-es"]')
      await expect(queEs).toContainText(`Paga la factura ${f.numero} de Proveedor de Prueba Bancos ${lado}.`)
      await expect(queEs.locator('.kf-asiento')).toContainText(p.cuentaProveedor)
      await expect(queEs.locator('.kf-asiento')).toContainText('Cuadra · 121,00')
      await expect(page.locator('[data-prueba="confirmar-factura"]')).toBeFocused()
      if (grande) await captura(page, 'factura-elegida', ancho)
      await page.keyboard.press('Enter')
      await expect(aviso(page)).toHaveText(`Conciliado: Pago de la factura ${f.numero} de Proveedor de Prueba Bancos ${lado} (Proveedor de Prueba Bancos ${lado}) · en el diario. La factura queda pagada.`, { timeout: 30_000 })
      await expect(fila(page, p.pagos.nueva).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      const nueva = await casadoDe(s, p, p.pagos.nueva, f)

      // ── 3 · El otro pago, desde la pantalla de hoy («Buscar factura») ──
      const g = p.facturas.hoy
      await page.goto(`/conta/bancos/movimientos?banco=${p.banco}&mes=2026-10&mov=${p.pagos.hoy}`, { timeout: 30_000 })
      await expect(page.getByRole('tab', { name: 'Conciliados', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      const zona = page.locator('.k-zona[data-activa="si"]')
      const boton = zona.getByRole('button', { name: /^Buscar (otra )?factura$/ }).first()
      await expect(boton).toBeVisible({ timeout: 30_000 })
      await boton.click()
      const dialogo = page.getByRole('dialog', { name: '¿Qué factura paga?' })
      await expect(dialogo).toBeVisible()
      await dialogo.getByRole('textbox', { name: 'Buscar factura' }).fill(g.numero)
      await dialogo.getByRole('link', { name: new RegExp(g.numero) }).click()
      await expect.poll(async () => (await casadoDe(s, p, p.pagos.hoy, g)).movimiento, { timeout: 30_000 }).toBe('casado')
      const hoy = await casadoDe(s, p, p.pagos.hoy, g)
      console.log(`[E05b ${ancho} · el mismo casado] nueva: ${JSON.stringify(nueva)} · hoy: ${JSON.stringify(hoy)}`)
      expect(nueva).toEqual(hoy)
      expect(nueva).toMatchObject({ movimiento: 'casado', kind: 'factura_recibida', confianza: 'probable', quien: 'persona', creado: true, factura: 'pagada',
        asiento: { serie: 3, estado: 'propuesto', origen: 'bank', lineas: [['banco', 0, 'total'], ['proveedor', 'total', 0]] } })
      expect(errores, 'errores de la página').toEqual([])
    } catch (e) { await contarPantalla(page, `bancos ${ancho}`); throw e }
  })
}
