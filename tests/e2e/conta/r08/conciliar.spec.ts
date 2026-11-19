/// <reference lib="dom" />
// tests/e2e/conta/r08/conciliar.spec.ts
//
// R08 · Bancos: conciliar en un paso (maqueta nucleo_10_bancos_conciliar_en_un_paso), contra
// staging, con la cuenta del núcleo en su empresa general y un banco propio de cada tamaño
// (semilla R08: e2e_r08_preparar, noviembre en cinco extractos), a 1456 × 816 y a 1366 × 768:
//   1. el recibo que el banco no cobró (31,50 del 12/11), apartado (la semilla lo deja como lo deja
//      la 2120: la e2e de la rama corre contra staging sin la 2040 ni la 2120, que cambian funciones
//      y solo van de verdad desde main); su fila, «Apartado» con el importe tachado, y a la derecha
//      por qué, con el salto de saldo y «Volver a abrirlo»;
//   2. la pastilla: el saldo del banco es el del último de los tres extractos del 19/11 (1.094,39,
//      «extracto del 19/11, 10:00»), contra lo que está en el diario;
//   3. Espacio y Mayús ↓ marcan las cinco nóminas: «5 marcados · 6.119,71», y a la derecha «Los 5
//      asientos que van al diario», que cuadran;
//   4. F4, «465» e Intro eligen la 46500000; Intro concilia: «5 movimientos a la 46500000», las cinco
//      «Conciliado», y la pantalla dice del asiento lo mismo que la base (por la API): con la 2040,
//      validado y «en el diario»; sin ella, propuesto y «sin pasar al diario»;
//   5. Deshacer una: vuelve a «Por conciliar» y las otras cuatro siguen conciliadas.

import { test, expect, type Page } from '@playwright/test'
import { entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, cargada, NUCLEO } from '../k02/comun'
import { MOTOR_BANCOS } from '../../../../supabase/functions/_shared/bancos/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/e05-bancos'
interface Preparado { cuenta: string; empresa: string; banco: string; cuenta572: string; noviembre: Record<string, string>; nominas: string[]; saldoBanco: number }

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
  const r = await rest<Preparado>(s, 'POST', 'rpc/e2e_r08_preparar', { p_lado: lado, p_motor: MOTOR_BANCOS })
  expect(r.status, `e2e_r08_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  return r.datos
}

/** El estado de cada movimiento y el de su asiento vivo, por la API. */
async function estados(s: Sesion, p: Preparado, ids: readonly string[]) {
  const r = await rest<{ id: string; status: string; bank_match: { status: string; journal_entry: { status: string } | null }[] }[]>(s, 'GET',
    `bank_movement?select=id,status,bank_match(status,journal_entry(status))&account_id=eq.${p.cuenta}&id=in.(${ids.join(',')})`)
  return Object.fromEntries(r.datos.map((m) => [m.id, `${m.status}/${m.bank_match.find((b) => b.status === 'vivo')?.journal_entry?.status ?? '—'}`]))
}

for (const [lado, ancho, alto] of [['ancho', 1456, 816], ['estrecho', 1366, 768]] as const) {
  test(`Bancos a ${ancho} × ${alto}: marcar cinco, conciliarlas en un paso, verlas conciliadas y deshacer una`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const grande = ancho === 1456
    const s = await entrarComo(page, NUCLEO.email)
    const p = await preparar(s, `r08${lado}`)
    const telefonia = p.noviembre.telefonia
    try {
      await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
      await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
      await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
      await page.goto(`/conta/bancos?banco=${p.banco}&mes=2026-11`, { timeout: 30_000 })
      await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
      await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
      await abierta(page, 'Bancos')

      // ── 1 · El recibo que el banco no cobró, apartado solo ──
      await expect(fila(page, telefonia).locator('.kb-etiqueta')).toHaveText('Apartado', { timeout: 30_000 })
      await expect(fila(page, telefonia).locator('s')).toHaveText('31,50')
      await expect(pantalla(page).locator('[data-prueba="por-conciliar"]')).toHaveText('9 por conciliar · 0 conciliados · 1 apartado')

      // ── 2 · La pastilla: el saldo del último extracto del 19/11, contra el diario ──
      await expect(pantalla(page).locator('.kf-estado')).toContainText('Banco 1.094,39')
      await expect(pantalla(page).locator('.kf-estado')).toContainText('extracto del 19/11, 10:00')

      await fila(page, telefonia).click()
      const apartado = page.locator('[data-prueba="apartado"]')
      await expect(apartado).toContainText('Apartado: el banco no cobró este recibo.')
      await expect(apartado).toContainText('El día antes la cuenta cerró en 7.214,10 y este extracto abre en 7.245,60 sin ninguna línea que lo explique.')
      await expect(apartado.locator('[data-prueba="reabrir"]')).toHaveText('Volver a abrirlo')
      if (grande) await captura(page, 'r08-apartado', ancho)

      // ── 3 · Marcar las cinco nóminas: Espacio y Mayús ↓ ──
      await expect(fila(page, p.nominas[0])).toBeVisible()
      const primera = pantalla(page).locator('[data-movimiento]').first()
      await primera.click()
      await page.keyboard.press(' ')
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown')
      const barra = page.locator('[data-prueba="barra-marcados"]')
      await expect(barra).toContainText('5 marcados · 6.119,71')
      for (const id of p.nominas) await expect(fila(page, id)).toHaveAttribute('data-marcado', 'true')
      const van = page.locator('[data-prueba="van-al-diario"]')
      await expect(van).toContainText('5 pagos marcados · 19/11')
      await expect(van).toContainText('Los 5 asientos que van al diario')
      await expect(van).toContainText('Al pulsar Conciliar van al diario. No hay que confirmarlos después. Si te equivocas, Deshacer los quita.')

      // ── 4 · F4, la 46500000 e Intro: en el diario ──
      await page.keyboard.press('F4')
      const cuenta = page.locator('#kb-barra-cuenta')
      await expect(cuenta).toBeFocused()
      await cuenta.fill('465')
      await expect(barra.getByRole('option').first()).toContainText('46500000', { timeout: 30_000 })
      await page.keyboard.press('Enter')
      await expect(cuenta).toHaveValue(/^46500000 · /)
      await expect(van.locator('.kb-etiqueta')).toHaveText('Cuadran')
      await expect(van).toContainText('46500000 al debe')
      await expect(van).toContainText(`Cada uno, contra el banco (${p.cuenta572}) al haber.`)
      await expect(page.locator('#kb-conciliar-n')).toBeFocused()
      await expect(page.locator('#kb-conciliar-n')).toBeInViewport()
      await captura(page, 'r08-marcados', ancho)
      const t0 = Date.now()
      await page.keyboard.press('Enter')
      await expect(aviso(page)).toHaveText('5 movimientos a la 46500000 · 6.119,71 € · en el diario.', { timeout: 60_000 })
      console.log(`[R08 · conciliar las cinco a ${ancho}] ${Date.now() - t0} ms`)
      for (const id of p.nominas) await expect(fila(page, id).locator('.kb-etiqueta')).toHaveText('Conciliado', { timeout: 30_000 })
      await expect(barra).toHaveCount(0)
      const hechos = Object.values(await estados(s, p, p.nominas))
      const enElDiario = hechos[0] === 'casado/validado'
      console.log(`[R08 · los cinco asientos] ${hechos.join(', ')} (${enElDiario ? 'con la 2040' : 'staging sin la 2040'})`)
      expect(hechos).toEqual(Array(5).fill(enElDiario ? 'casado/validado' : 'casado/propuesto'))
      await expect(pantalla(page).locator('[data-prueba="por-conciliar"]')).toHaveText('4 por conciliar · 5 conciliados · 1 apartado')
      if (grande) await captura(page, 'r08-conciliados', ancho)

      // ── 5 · Deshacer una: las otras cuatro siguen ──
      await fila(page, p.nominas[0]).click()
      await expect(page.locator('[data-prueba="conciliado"]')).toContainText(enElDiario ? 'Conciliado · en el diario.' : 'Conciliado, sin pasar al diario.')
      await page.locator('[data-prueba="que-es"] [data-prueba="deshacer"]').click()
      // R08 · 1, punto 3: detrás ya hay otros asientos (las otras cuatro), así que no sale del diario: contraasiento, y lo dice.
      await expect(aviso(page)).toHaveText(enElDiario ? /vuelve a estar por conciliar, y su asiento \d+\/\d+ se anula con un contraasiento: detrás ya hay otros asientos en el diario, y quitarlo dejaría un hueco en la numeración\.$/ : /vuelve a estar por conciliar, y su asiento propuesto se quita\.$/, { timeout: 30_000 })
      await expect(fila(page, p.nominas[0]).locator('.kb-etiqueta')).toHaveText('Por conciliar', { timeout: 30_000 })
      const tras = await estados(s, p, p.nominas)
      expect(tras[p.nominas[0]]).toBe('pendiente/—')
      expect(p.nominas.slice(1).map((id) => tras[id])).toEqual(Array(4).fill(enElDiario ? 'casado/validado' : 'casado/propuesto'))
      expect(errores, 'errores de la página').toEqual([])
    } catch (e) { await contarPantalla(page, `r08 ${ancho}`); throw e }
  })
}
