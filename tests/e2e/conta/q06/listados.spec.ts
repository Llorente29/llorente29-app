/// <reference lib="dom" />
// tests/e2e/conta/q06/listados.spec.ts
//
// Q06 · Los listados del núcleo, contra staging, con la cuenta A del carril
// (sus asientos y sus libros son los de las semillas del C04 y del C05, todo
// inventado), a 1456 × 816 y a 1366 × 768, con el navegador en español.
//
// «MISMAS CIFRAS QUE EL LISTADO DE HOY» (regla 31), con la misma vara a los dos
// lados: primero, con el interruptor apagado, se leen los listados de hoy
// (sumas y saldos, el mayor de una cuenta, el diario y los dos libros de IVA)
// con sus fechas de siempre; después se enciende conta_nucleo en la cuenta A
// del carril (la fila de verdad, escrita por la plataforma como en el Q05), y
// se leen los nuevos con las MISMAS fechas. Se comparan cifra a cifra.
//
// Y lo que pide el encargo: abrir el mayor de una cuenta, abrir un movimiento
// (su documento a la derecha; Intro, su asiento en otra pestaña), F5 desde
// sumas y saldos, «Ver como se imprime» y bajar el PDF y el Excel. Al acabar,
// el interruptor se apaga (también si algo falla).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { cargada, noRueda, zonaActiva } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/q06'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')

/** La fila de verdad del carril: la plataforma enciende o apaga conta_nucleo en la cuenta A (como el Q05). */
async function nucleo(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_nucleo', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e Q06 Listados (carril)' : 'e2e Q06 Listados (carril): se apaga' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}

/** Una cifra como la pinta cualquiera de las dos pantallas («1.234,56 €», «1.234,56 D») a número. */
// La pantalla de hoy escribe el negativo con el signo tipográfico «−» (U+2212, eurosExactos) y la nueva
// con el guion «-» (Intl): los dos son el mismo signo. Sin esto, el «−50,00 €» de hoy se leía +50 (#1555).
const numero = (t: string | null): number => {
  const limpio = (t ?? '').replace(/\u2212/g, '-').replace(/[^\d,-]/g, '').replace(',', '.')
  return limpio ? Number(limpio) : 0
}

/** La medida de la regla 31, al registro del run: la cifra de hoy y la nueva, leídas con el mismo lector. */
const medida: string[] = []
function igual(que: string, deHoy: number, nueva: number) {
  const dos = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  medida.push(`${que}: hoy ${dos(deHoy)} · nuevo ${dos(nueva)}${deHoy === nueva ? '' : '  ← NO'}`)
  expect.soft(nueva, `${que}: la de hoy`).toBe(deHoy)
}

/** Lo que hay en la base: las anotaciones del libro de recibidas de la cuenta A en unas fechas (para el registro del run). */
async function anotacionesRecibidas(s: Sesion, desde: string, hasta: string): Promise<string[]> {
  const r = await fetch(`${STAGING_URL}/rest/v1/vat_book_entry?select=number,invoice_type,issue_date,tax_base,tax_amount,voided_at,source_type&account_id=eq.${CUENTA_A.id}`
    + `&book=in.(received,investment)&issue_date=gte.${desde}&issue_date=lte.${hasta}&order=issue_date`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })
  const filas = (await r.json()) as { number: string | null; invoice_type: string; issue_date: string; tax_base: number; tax_amount: number; voided_at: string | null; source_type: string }[]
  return filas.map((f) => `${f.issue_date} ${f.invoice_type} ${f.number ?? 'sin número'} base ${f.tax_base} cuota ${f.tax_amount}${f.voided_at ? ' (anulada)' : ''} · ${f.source_type}`)
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}.png` })
}

const listado = (page: Page) => zonaActiva(page).locator('[data-prueba="listado-nucleo"]')
async function listadoCargado(page: Page, que: string) {
  await expect(listado(page)).toHaveAttribute('data-listado', que, { timeout: 30_000 })
  await expect(listado(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 45_000 })
  await expect(listado(page).locator('.kl-tabla tbody tr').first()).toBeVisible({ timeout: 30_000 })
}
async function elPeriodo(page: Page, nombre: string) {
  await listado(page).getByRole('combobox', { name: 'Periodo' }).selectOption({ label: nombre })
  await expect(listado(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 45_000 })
}
const total = (page: Page, col: string) => listado(page).locator(`[data-prueba="total-${col}"]`)

/** Lo que dicen los listados de hoy (núcleo apagado), con sus fechas de siempre. */
interface DeHoy {
  sumas: { debe: number; haber: number; cuenta: string }
  mayor: { debe: number; haber: number; saldo: number }
  diario: { mes: string; debe: number; haber: number }[]
  emitidas: { base: number; cuota: number }
  recibidas: { base: number; cuota: number }
}

async function leerLosDeHoy(page: Page): Promise<DeHoy> {
  await page.goto('/conta/libros/mayor/sumas-saldos', { timeout: 30_000 })
  const ss = page.locator('table[aria-label="Sumas y saldos"]')
  await expect(ss).toBeVisible({ timeout: 45_000 })
  const [debe, haber] = [numero(await ss.locator('tfoot td[data-titulo="Debe"]').textContent()), numero(await ss.locator('tfoot td[data-titulo="Haber"]').textContent())]
  // La primera subcuenta (la de un cliente si la hay): la del mayor y la de F5.
  const clientes = ss.locator('tbody a', { hasText: /^43\d+ · / })
  const enlace = (await clientes.count()) ? clientes.first() : ss.locator('tbody a').first()
  const cuenta = ((await enlace.textContent()) ?? '').split(' · ')[0].trim()
  expect(cuenta, 'una subcuenta en sumas y saldos de la cuenta A').toMatch(/^\d{4,}$/)

  await page.goto(`/conta/libros/mayor/libro-mayor?cuenta=${cuenta}`, { timeout: 30_000 })
  const my = page.locator(`table[aria-label="Mayor de la ${cuenta}"]`)
  await expect(my).toBeVisible({ timeout: 45_000 })
  const mayor = { debe: numero(await my.locator('tfoot td[data-titulo="Debe"]').textContent()), haber: numero(await my.locator('tfoot td[data-titulo="Haber"]').textContent()),
    saldo: numero(await my.locator('tfoot td[data-titulo="Saldo"]').textContent()) * (/H\s*$/.test((await my.locator('tfoot td[data-titulo="Saldo"]').textContent()) ?? '') ? -1 : 1) }

  await page.goto('/conta/libros/diario/resumido', { timeout: 30_000 })
  await expect(page.locator('section[aria-label="Diario resumido"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('section[aria-label="Diario resumido"] [aria-busy="true"]')).toHaveCount(0, { timeout: 45_000 })
  const meses = page.locator('table[aria-label^="Diario resumido de "]')
  const diario: DeHoy['diario'] = []
  for (let i = 0; i < await meses.count(); i++) {
    const t = meses.nth(i)
    diario.push({ mes: ((await t.getAttribute('aria-label')) ?? '').replace('Diario resumido de ', ''), debe: numero(await t.locator('tfoot td[data-titulo="Debe"]').textContent()), haber: numero(await t.locator('tfoot td[data-titulo="Haber"]').textContent()) })
  }

  const libro = async (ruta: string) => {
    await page.goto(ruta, { timeout: 30_000 })
    const cifras = page.getByRole('group', { name: 'Cifras del libro' })
    await expect(cifras).toBeVisible({ timeout: 45_000 })
    const v = await cifras.locator('.cxl-cifra-valor').allTextContents()
    return { base: numero(v[0]), cuota: numero(v[1]) }
  }
  return { sumas: { debe, haber, cuenta }, mayor, diario, emitidas: await libro('/conta/libros/registro/expedidas'), recibidas: await libro('/conta/libros/registro/recibidas') }
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`los listados del núcleo a ${ancho} × ${alto}: mismas cifras que hoy, el mayor, un movimiento, F5 y la hoja`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(420_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    const sufijo = `${ancho}`
    try {
      // ── 1. Lo de hoy, con el interruptor apagado.
      await nucleo(false)
      const sesion = await entrarComo(page, CUENTA_A.email)
      const hoy = await leerLosDeHoy(page)

      // ── 2. El núcleo encendido: los mismos listados en la ventana nueva.
      await nucleo(true)
      await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
      await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
      await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))

      // Sumas y saldos, desde la cinta: Listados › Sumas y saldos (a 1366 × 768 la cinta nace plegada: por su dirección).
      if (alto >= 800) {
        await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Listados' }).click()
        await page.getByRole('group', { name: 'Generales' }).getByRole('button', { name: 'Sumas y saldos', exact: true }).click()
      } else {
        await page.goto('/conta/libros/mayor/sumas-saldos', { timeout: 30_000 })
      }
      await listadoCargado(page, 'sumas')
      await elPeriodo(page, 'Todo el ejercicio')
      igual('sumas y saldos · Debe', hoy.sumas.debe, numero(await total(page, 'Debe').textContent()))
      igual('sumas y saldos · Haber', hoy.sumas.haber, numero(await total(page, 'Haber').textContent()))
      await expect(listado(page).getByRole('status').filter({ hasText: /^Cuadra\./ })).toBeVisible()
      await cargada(page, 'sumas y saldos')
      await noRueda(page, 'sumas y saldos')
      await capturar(page, `1-sumas-y-saldos-${sufijo}`)

      // «Abrir: a 1 cifra» deja los grupos; «todo» abre hasta los movimientos.
      await listado(page).getByRole('button', { name: 'a 1 cifra' }).click()
      await expect(listado(page).locator('tbody tr[data-clase="cuenta"]')).toHaveCount(0)
      await listado(page).getByRole('button', { name: 'a 3 cifras' }).click()
      const fila = listado(page).locator(`tbody tr[data-clase="cuenta"][data-cuenta="${hoy.sumas.cuenta}"]`)
      await expect(fila).toBeVisible()

      // Abrir una subcuenta: sus movimientos, ahí mismo.
      await fila.click()
      await expect(fila).toHaveAttribute('aria-expanded', 'true')
      await expect(listado(page).locator(`tbody tr[data-clase="movimiento"][data-cuenta="${hoy.sumas.cuenta}"]`).first()).toBeVisible({ timeout: 30_000 })
      await capturar(page, `2-sumas-y-saldos-abierta-${sufijo}`)

      // ── 3. F5 desde la subcuenta: su mayor, en otra pestaña.
      await fila.focus()
      await page.keyboard.press('F5')
      await expect(page).toHaveURL(new RegExp(`/conta/plan/${hoy.sumas.cuenta}`), { timeout: 30_000 })
      await listadoCargado(page, 'mayor')
      await expect(page.getByRole('tablist', { name: 'Lo que tienes abierto' }).getByRole('tab', { name: new RegExp(`Mayor · ${hoy.sumas.cuenta}`) })).toBeVisible()
      await elPeriodo(page, 'Todo el ejercicio')
      const cuenta = listado(page).locator(`tbody tr[data-clase="cuenta"][data-cuenta="${hoy.sumas.cuenta}"]`)
      const cifras = await cuenta.locator('td.kl-der').allTextContents()
      igual(`mayor ${hoy.sumas.cuenta} · Debe`, hoy.mayor.debe, numero(cifras[0]))
      igual(`mayor ${hoy.sumas.cuenta} · Haber`, hoy.mayor.haber, numero(cifras[1]))
      igual(`mayor ${hoy.sumas.cuenta} · saldo`, hoy.mayor.saldo, Math.round((numero(cifras[2]) - numero(cifras[3])) * 100) / 100)

      // ── 4. Un movimiento: su documento a la derecha; Intro, su asiento en otra pestaña.
      const mov = listado(page).locator('tbody tr[data-clase="movimiento"]').first()
      await mov.click()
      await expect(mov).toHaveAttribute('aria-selected', 'true')
      // El de esta pestaña: la de sumas y saldos sigue montada (escondida) con su panel.
      await expect(listado(page).getByRole('button', { name: 'Abrir el asiento' })).toBeEnabled()
      await cargada(page, 'el mayor con un movimiento')
      await capturar(page, `3-mayor-${sufijo}`)
      await mov.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/conta\/libros\/diario\/[0-9a-f-]{36}/, { timeout: 30_000 })

      // ── 5. El diario y los libros de IVA: las cifras de hoy.
      await page.goto('/conta/libros/diario/resumido', { timeout: 30_000 })
      await listadoCargado(page, 'diario')
      await elPeriodo(page, 'Todo el ejercicio')
      const meses = listado(page).locator('tbody tr[data-clase="mes"]')
      await expect(meses).toHaveCount(hoy.diario.length)
      for (let i = 0; i < hoy.diario.length; i++) {
        const v = await meses.nth(i).locator('td.kl-der').allTextContents()
        igual(`diario ${hoy.diario[i].mes} · Debe`, hoy.diario[i].debe, numero(v[0]))
        igual(`diario ${hoy.diario[i].mes} · Haber`, hoy.diario[i].haber, numero(v[1]))
      }
      await cargada(page, 'el diario')
      await capturar(page, `4-diario-${sufijo}`)

      for (const [ruta, que, deHoy] of [['/conta/libros/registro/expedidas', 'emitidas', hoy.emitidas], ['/conta/libros/registro/recibidas', 'recibidas', hoy.recibidas]] as const) {
        await page.goto(ruta, { timeout: 30_000 })
        await expect(listado(page)).toHaveAttribute('data-listado', que, { timeout: 30_000 })
        await expect(listado(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 45_000 })
        if (que === 'recibidas') {
          // Qué facturas son, leído en la base (#1555: la semilla del C05 deja un abono, R1, con base y cuota en negativo).
          const [d, h] = await listado(page).locator('.kl-datos input[aria-label="Desde"], .kl-datos input[aria-label="Hasta"]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))
          const iso = (f: string) => f.split('/').reverse().join('-')
          console.log(`[Q06] libro de recibidas del ${d} al ${h}, en la base:\n  ${(await anotacionesRecibidas(sesion, iso(d), iso(h))).join('\n  ') || 'ninguna'}`)
        }
        igual(`libro de ${que} · base`, deHoy.base, numero(await total(page, 'Base').textContent()))
        igual(`libro de ${que} · cuota`, deHoy.cuota, numero(await total(page, 'Cuota').textContent()))
        if (que === 'emitidas') { await cargada(page, 'el libro de emitidas'); await capturar(page, `5-libro-de-emitidas-${sufijo}`) }
      }

      console.log(`[Q06] mismas cifras a ${ancho} × ${alto} (regla 31):\n  ${medida.splice(0).join('\n  ')}`)

      // ── 6. «Ver como se imprime», el PDF y el Excel (sumas y saldos, su pestaña sigue como se dejó).
      await page.goto('/conta/libros/mayor/sumas-saldos', { timeout: 30_000 })
      await listadoCargado(page, 'sumas')
      await listado(page).getByRole('button', { name: 'Ver como se imprime' }).click()
      await expect(listado(page).locator('.kl-hoja')).toBeVisible()
      await expect(listado(page).locator('[data-prueba="pagina"]')).toHaveText(/^Página 1 de \d+$/)
      await expect(listado(page).locator('.kl-hoja-cabecera')).toContainText('Balance de sumas y saldos')
      await capturar(page, `6-como-se-imprime-${sufijo}`)
      const [pdf] = await Promise.all([page.waitForEvent('download'), listado(page).getByRole('button', { name: 'PDF', exact: true }).click()])
      expect(pdf.suggestedFilename()).toMatch(/^Balance de sumas y saldos \d{2}-\d{2}-\d{4} a \d{2}-\d{2}-\d{4}\.pdf$/)
      await expect(listado(page).getByRole('status').filter({ hasText: /^Bajado: Balance de sumas y saldos .*\.pdf, \d+ páginas?\.$/ })).toBeVisible()
      const [xls] = await Promise.all([page.waitForEvent('download'), listado(page).getByRole('button', { name: 'Excel', exact: true }).click()])
      expect(xls.suggestedFilename()).toMatch(/\.xlsx$/)
      await expect(listado(page).getByRole('status').filter({ hasText: /^Bajado: .*\.xlsx, \d+ filas\.$/ })).toBeVisible()
      // Esc, en la hoja, vuelve al listado.
      await listado(page).getByRole('button', { name: 'Excel', exact: true }).focus()
      await page.keyboard.press('Escape')
      await expect(listado(page).locator('.kl-hoja')).toHaveCount(0)
      await expect(listado(page).getByRole('button', { name: 'Ver como se imprime' })).toBeVisible()
      // Lo que no sale (decisión de Julio, 19/11): no hay nada detrás.
      await expect(listado(page).getByRole('button', { name: /Entregar|Enviar por correo|Comparar con/ })).toHaveCount(0)

      expect(errores, 'errores de la página').toEqual([])
    } finally {
      await nucleo(false)
    }
  })
}
