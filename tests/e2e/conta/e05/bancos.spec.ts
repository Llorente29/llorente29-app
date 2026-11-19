/// <reference lib="dom" />
// tests/e2e/conta/e05/bancos.spec.ts
//
// E05 · Bancos del núcleo, contra staging, con la cuenta del núcleo (semilla K02)
// en su empresa general y un banco propio de cada tamaño (semilla E05:
// e2e_e05_preparar), a 1456 × 816 y a 1366 × 768, con el navegador en español:
//   1. la rejilla: el estado en una palabra (R08), el cuadre y «Qué es» del elegido;
//   2. con el teclado: ↓ e Intro concilian lo propuesto, en el diario (1456: el
//      probable; 1366: un seguro, y el probable desde la pantalla de hoy, para medir);
//   3. marcar los seguros (Espacio) e Intro: cada uno a su cuenta, y dice cuántos y
//      cuánto; lo conciliado ya está en el diario (R08: sin «Validar»);
//   4. «Deshacer» en «Qué es» de lo conciliado dice qué ha deshecho;
//   5. «Escribir uno a mano», entero con el teclado (F4 en la cuenta): validado;
//   6. «El documento»: «Falta el justificante»;
//   7. F5 abre el mayor de la cuenta en otra pestaña; Esc cierra Bancos;
//   8. la línea de estado dice si los bancos cuadran.
// Y «confirma lo mismo» (regla 31): el probable de 1456 se confirma con la
// pantalla nueva y el de 1366 con la de hoy («Sí, es esto»); al final se comparan
// su casado y su asiento por la API, con la misma vara.
// Con el interruptor apagado (la cuenta A) o en el móvil, la pantalla de hoy.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, cargada, NUCLEO } from '../k02/comun'
import { MOTOR_BANCOS } from '../../../../supabase/functions/_shared/bancos/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/e05-bancos'
interface Preparado { cuenta: string; empresa: string; banco: string; cuenta572: string; movs: Record<'seguro1' | 'seguro2' | 'probable' | 'aclarar' | 'casado', string> }
const medidas: Record<string, unknown> = {}

const pantalla = (page: Page) => page.locator('[data-prueba="bancos-nucleo"]')
const aviso = (page: Page) => page.locator('[data-prueba="aviso-bancos"]')
const fila = (page: Page, id: string) => pantalla(page).locator(`[data-movimiento="${id}"]`)

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function preparar(s: Sesion, lado: string): Promise<Preparado> {
  const r = await rest<Preparado>(s, 'POST', 'rpc/e2e_e05_preparar', { p_lado: lado, p_motor: MOTOR_BANCOS })
  expect(r.status, `e2e_e05_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  return r.datos
}

async function abrirBancos(page: Page, p: Preparado) {
  await page.goto(`/conta/bancos?banco=${p.banco}`, { timeout: 30_000 })
  await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
  await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
}

/** El casado vivo de un movimiento y su asiento, con la vara de la regla 31 (la 572 del banco, como «banco»). */
async function casadoDe(s: Sesion, p: Preparado, mov: string) {
  const m = await rest<{ status: string; bank_match: { kind: string; confidence: string; by_who: string; status: string; entry_created: boolean; journal_entry: { series: number; status: string; source_type: string; journal_line: { debit: number; credit: number; company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
    `bank_movement?select=status,bank_match(kind,confidence,by_who,status,entry_created,journal_entry(series,status,source_type,journal_line(debit,credit,company_account(code))))&account_id=eq.${p.cuenta}&id=eq.${mov}`)
  const vivo = m.datos[0]?.bank_match.find((b) => b.status === 'vivo') ?? null
  const e = vivo?.journal_entry ?? null
  return {
    movimiento: m.datos[0]?.status, kind: vivo?.kind, confianza: vivo?.confidence, quien: vivo?.by_who, creado: vivo?.entry_created,
    asiento: e ? { serie: e.series, estado: e.status, origen: e.source_type,
      lineas: e.journal_line.map((l) => [l.company_account.code === p.cuenta572 ? 'banco' : l.company_account.code, Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) } : null,
  }
}

async function captura(page: Page, nombre: string, ancho: number) {
  await cargada(page, nombre)
  await page.screenshot({ path: `${DIR}/${nombre}-${ancho}.png` })
}

for (const [lado, ancho, alto] of [['ancho', 1456, 816], ['estrecho', 1366, 768]] as const) {
  test(`Bancos del núcleo a ${ancho} × ${alto}: la rejilla, el teclado, en bloque, deshacer, a mano y F5`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(360_000)
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
      await abrirBancos(page, p)
      await abierta(page, 'Bancos')

      // ── 1 · La rejilla ──
      await expect(page.getByRole('tab', { name: 'Bancos', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(pantalla(page).getByRole('combobox', { name: 'Banco' })).toContainText(`${p.cuenta572} · Banco E05 ${lado}`)
      // R08 · El estado, en una palabra: los cuatro sin conciliar y el que concilió Sumied solo (ya en el diario).
      await expect(pantalla(page).locator('[data-prueba="por-conciliar"]')).toHaveText('4 por conciliar · 1 conciliado · 0 apartados')
      const etiquetas: [keyof Preparado['movs'], string][] = [['seguro1', 'Por conciliar'], ['seguro2', 'Por conciliar'], ['probable', 'Por conciliar'], ['aclarar', 'Por conciliar'], ['casado', 'Conciliado']]
      for (const [k, t] of etiquetas) await expect(fila(page, p.movs[k]).locator('.kb-etiqueta')).toHaveText(t)
      await expect(fila(page, p.movs.probable)).toContainText('RECIBO ELECTRICIDAD EJEMPLO')
      await expect(fila(page, p.movs.probable)).toContainText('62800000')
      await expect(fila(page, p.movs.probable)).toContainText('45,00')
      await expect(fila(page, p.movs.aclarar)).toContainText('300,00')
      await expect(pantalla(page).getByRole('checkbox', { name: 'Marcar todos' })).toBeVisible()
      await expect(pantalla(page).locator('.kf-estado')).toContainText(/No cuadra|Cuadra\./)
      // Se abre en el primero que espera a una persona (el más reciente: el ingreso sin saber).
      await expect(fila(page, p.movs.aclarar)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('[data-prueba="que-es"]')).toContainText('No sé qué es')
      await expect(page.locator('[data-prueba="saldo-a-la-fecha"]')).toContainText('24/10/2026')
      await captura(page, 'rejilla', ancho)

      // ── 2 · El teclado: ↓ y Intro ──
      await fila(page, p.movs.aclarar).click()
      await page.keyboard.press('ArrowDown')
      await expect(fila(page, p.movs.probable)).toHaveAttribute('aria-selected', 'true')
      await expect(fila(page, p.movs.probable)).toBeFocused()
      await expect(page.locator('[data-prueba="que-es"]')).toContainText('Es la luz o el agua.')
      await expect(page.locator('[data-prueba="que-es"]').getByRole('button', { name: /Conciliar: es ese pago/ })).toBeVisible()
      if (grande) {
        await captura(page, 'que-es-propuesta', ancho)
        await page.keyboard.press('Enter')
        await expect(aviso(page)).toHaveText('Conciliado: Es la luz o el agua. (Electricidad Ejemplo) · en el diario.', { timeout: 30_000 })
        await expect(fila(page, p.movs.probable).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      } else {
        await page.keyboard.press('ArrowDown')
        await expect(fila(page, p.movs.seguro2)).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('Enter')
        await expect(aviso(page)).toHaveText('Conciliado: Es una comisión del banco. (Comisión de transferencia) · en el diario.', { timeout: 30_000 })
        await expect(fila(page, p.movs.seguro2).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      }

      // ── 3 · R08: marcar los seguros con Espacio e Intro: cada uno a su cuenta, en el diario ──
      const seguros = grande ? [p.movs.seguro1, p.movs.seguro2] : [p.movs.seguro1]
      for (const id of seguros) { await fila(page, id).click(); await page.keyboard.press(' ') }
      await expect(page.locator('[data-prueba="barra-marcados"]')).toContainText(grande ? '2 marcados · 20,90' : '1 marcado · 12,50')
      await expect(page.locator('[data-prueba="van-al-diario"]')).toContainText(grande ? 'Los 2 asientos que van al diario' : 'El asiento que va al diario')
      await page.keyboard.press('Enter')
      await expect(aviso(page)).toHaveText(grande ? '2 movimientos, cada uno a su cuenta · 20,90 € · en el diario.' : '1 movimiento a su cuenta · 12,50 € · en el diario.', { timeout: 30_000 })
      await expect(fila(page, p.movs.seguro1).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      await expect(page.locator('[data-prueba="barra-marcados"]')).toHaveCount(0)
      if (grande) await captura(page, 'confirmados', ancho)

      // ── 3b · Lo conciliado ya está en el diario: sin «Validar» (R08) ──
      await fila(page, p.movs.seguro1).click()
      await expect(page.locator('[data-prueba="que-es"] [data-prueba="conciliado"]')).toContainText('Conciliado · en el diario.')
      await expect(page.locator('[data-prueba="que-es"] [data-prueba="validar"]')).toHaveCount(0)
      expect((await casadoDe(s, p, p.movs.seguro1)).asiento?.estado).toBe('validado')

      // ── 4 · Deshacer lo casado ──
      await fila(page, p.movs.casado).click()
      const deshacer = page.locator('[data-prueba="que-es"] [data-prueba="deshacer"]')
      await expect(deshacer).toBeVisible()
      if (grande) await captura(page, 'casado-deshacer', ancho)
      await deshacer.click()
      // R08 · Lo conciliado está en el diario: deshacer lo anula con su contraasiento.
      await expect(aviso(page)).toHaveText(/^Deshecho: el movimiento de Agua Ejemplo vuelve a estar por conciliar, y su asiento \d+\/\d+ se anula con un contraasiento\.$/, { timeout: 30_000 })
      expect((await casadoDe(s, p, p.movs.casado)).movimiento).toBe('pendiente')

      // ── 5 · Escribir uno a mano, con el teclado ──
      const aMano = page.locator('[data-prueba="a-mano"]')
      await aMano.locator('#kb-fecha').click()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('28/10/2026')
      await page.keyboard.press('Enter')
      await expect(aMano.locator('#kb-cuenta')).toBeFocused()
      await page.keyboard.type('626')
      await page.keyboard.press('F4')
      await expect(aMano.getByRole('option').first()).toContainText('62600000')
      await page.keyboard.press('Enter')
      await expect(aMano.locator('#kb-cuenta')).toHaveValue(/^62600000 · /)
      await page.keyboard.press('Enter')
      await expect(aMano.locator('#kb-concepto')).toBeFocused()
      await page.keyboard.type('Comisión a mano E05')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(aMano.locator('#kb-pago')).toBeFocused()
      await page.keyboard.type('5,00')
      if (grande) await captura(page, 'a-mano', ancho)
      await page.keyboard.press('Enter')
      await expect(aviso(page)).toHaveText(/^Apuntado y validado: asiento \d+, pago de 5,00 € en 62600000 \(Comisión a mano E05\)\. Cuando llegue en el extracto, se enlaza con él: no se duplica\.$/, { timeout: 30_000 })
      const escrito = await rest<{ series: number; status: string; source_type: string; number: number | null }[]>(s, 'GET',
        `journal_entry?select=series,status,source_type,number&account_id=eq.${p.cuenta}&company_id=eq.${p.empresa}&concept=eq.${encodeURIComponent('Comisión a mano E05')}&entry_date=eq.2026-10-28`)
      expect(escrito.datos.length, 'el asiento escrito a mano').toBeGreaterThan(0)
      expect(escrito.datos.at(-1)).toMatchObject({ series: 3, status: 'validado', source_type: 'manual' })

      // ── 6 · El documento ──
      await fila(page, p.movs.aclarar).click()
      await page.getByRole('tab', { name: 'El documento' }).click()
      await expect(page.locator('.kf-soltar')).toContainText('Falta el justificante')
      if (grande) await captura(page, 'sin-justificante', ancho)
      await page.getByRole('tab', { name: 'Qué es' }).click()

      // ── 8 · La línea de estado ──
      await expect(page.getByRole('contentinfo', { name: 'Cómo va la empresa' })).toContainText(/cuadra/, { timeout: 30_000 })

      // ── 7 · F5 y Esc ──
      const conCuenta = grande ? p.movs.probable : p.movs.seguro2
      const cuenta = grande ? '62800000' : '62600000'
      await expect(fila(page, conCuenta)).toHaveAttribute('data-cuenta', cuenta, { timeout: 30_000 })
      await fila(page, conCuenta).click()
      await page.keyboard.press('F5')
      await expect(page).toHaveURL(new RegExp(`/conta/plan/${cuenta}`))
      await expect(page.getByRole('tab', { name: `Mayor · ${cuenta}`, exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: 'Bancos', exact: true }).click()
      await expect(fila(page, conCuenta)).toHaveAttribute('aria-selected', 'true')

      // ── «Confirma lo mismo»: el probable de 1366, desde la pantalla de hoy ──
      if (grande) {
        medidas.nueva = await casadoDe(s, p, p.movs.probable)
      } else {
        await page.goto(`/conta/bancos/movimientos?banco=${p.banco}&mes=2026-10&mov=${p.movs.probable}`, { timeout: 30_000 })
        await expect(page.getByRole('tab', { name: 'Conciliados', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
        const si = page.locator('.k-zona[data-activa="si"]').getByRole('button', { name: 'Sí, es esto' })
        await expect(si).toBeVisible({ timeout: 30_000 })
        await si.click()
        await expect.poll(async () => (await casadoDe(s, p, p.movs.probable)).movimiento, { timeout: 30_000 }).toBe('casado')
        medidas.hoy = await casadoDe(s, p, p.movs.probable)
        await page.getByRole('tab', { name: 'Bancos', exact: true }).click()
      }

      // Esc cierra la pestaña de Bancos.
      await fila(page, p.movs.aclarar).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('tab', { name: 'Bancos', exact: true })).toHaveCount(0, { timeout: 30_000 })
      expect(errores, 'errores de la página').toEqual([])
    } catch (e) { await contarPantalla(page, `bancos ${ancho}`); throw e }
  })
}

test('confirma lo mismo: el probable, desde la pantalla nueva y desde la de hoy', async ({ page }, info) => {
  void page
  test.skip(info.project.name === 'movil', 'De ordenador')
  test.skip(!medidas.nueva || !medidas.hoy, 'Faltan las dos medidas (las dos pruebas de arriba).')
  console.log(`[E05 · confirma lo mismo] nueva: ${JSON.stringify(medidas.nueva)} · hoy: ${JSON.stringify(medidas.hoy)}`)
  expect(medidas.nueva).toEqual(medidas.hoy)
  expect(medidas.nueva).toMatchObject({ movimiento: 'casado', kind: 'cuenta', confianza: 'probable', quien: 'persona', creado: true,
    asiento: { serie: 3, estado: 'validado', origen: 'bank', lineas: [['62800000', 45, 0], ['banco', 0, 45]] } }) // R08: en el diario, desde las dos
})

test('con el interruptor apagado (la cuenta A) o en el móvil, la pantalla de hoy', async ({ page }, info) => {
  if (info.project.name === 'movil') await entrarComo(page, NUCLEO.email)
  else await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/bancos', { timeout: 30_000 })
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
  await expect(page.locator('[data-prueba="bancos-nucleo"]')).toHaveCount(0)
})
