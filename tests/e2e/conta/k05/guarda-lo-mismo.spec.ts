/// <reference lib="dom" />
// tests/e2e/conta/k05/guarda-lo-mismo.spec.ts
//
// K05 · «Guarda lo mismo» (regla 31): la misma factura emitida, hecha por
// Facturación (conta_venta_guardar + conta_venta_emitir, lo que hace su
// «Emitir») y escrita en la ficha nueva del núcleo, deja el mismo asiento y la
// misma anotación en el libro de expedidas. Se comparan con la misma vara a
// los dos lados: la serie y el estado; cada apunte (cuenta, debe, haber), con
// la 430 del cliente como «cliente»; y del libro: el libro, el tipo de
// factura, la base, el tipo, la cuota, el total, el NIF y el nombre. El número
// no (Facturación lo da; en la ficha se escribe el de la factura).
// Y la de Facturación, abierta en la ficha nueva: «Hecha por Sumied».

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k05'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const CLIENTE = () => enCarril('c0e50000-0000-4000-8000-0000000000c3')
const NOMBRE = 'Cliente de Prueba Mismo Asiento, S.L.'
const ficha = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-emitida-nucleo"]')

async function pedir<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 400)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

/** La vara, la misma a los dos lados: el asiento (serie, estado, apuntes) y sus filas del libro de expedidas. */
async function vara(s: Sesion, entryId: string) {
  const [e] = await pedir<{ series: number; status: string; journal_line: { position: number; debit: number; credit: number; company_account: { code: string } }[] }[]>(s,
    `journal_entry?select=series,status,journal_line(position,debit,credit,company_account(code))&account_id=eq.${NUCLEO.id}&id=eq.${entryId}`)
  const libro = await pedir<Record<string, unknown>[]>(s,
    `vat_book_entry?select=book,invoice_type,tax_base,tax_rate,tax_amount,total,counterpart_tax_id,counterpart_name&account_id=eq.${NUCLEO.id}&entry_id=eq.${entryId}&order=tax_rate.desc`)
  return {
    serie: e.series, estado: e.status,
    apuntes: e.journal_line.sort((a, b) => a.position - b.position).map((l) => [/^430/.test(l.company_account.code) ? 'cliente' : l.company_account.code, Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    libro: libro.map((x) => ({ ...x, tax_base: Number(x.tax_base), tax_rate: Number(x.tax_rate), tax_amount: Number(x.tax_amount), total: Number(x.total) })),
  }
}

test('guarda lo mismo: la misma emitida por Facturación y por la ficha nueva deja el mismo asiento y el mismo libro', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
  test.setTimeout(300_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, NUCLEO.email)

  // ── Por Facturación: guardar y emitir (lo que hace su «Emitir»), con la base 200,00 al 21 % a la 70000000. ──
  const [tipo] = await pedir<{ id: string }[]>(s, 'tax_rate?select=id&tax_system=eq.iva&is_system=eq.true&treatment=eq.taxed&rate=eq.21&valid_to=is.null&limit=1')
  const [cuenta] = await pedir<{ id: string }[]>(s, `company_account?select=id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&code=eq.70000000`)
  const g = await pedir<{ id: string }>(s, 'rpc/conta_venta_guardar', {
    p_company: EMPRESA(), p_id: null,
    p_datos: { cliente_id: CLIENTE(), fecha: '2026-10-20', vence: null, serie: 'F', forma_cobro_id: null, local_id: null, notas: null, correo: null, retencion_id: null, recargo: false, motivo: null },
    p_lineas: [{ concepto: 'Servicio de prueba K05', cantidad: 1, precio: 200, descuento: 0, tipo_id: tipo.id, cuenta_id: cuenta.id }],
    p_quien_nombre: 'Prueba e2e K05',
  })
  const em = await pedir<{ numero: string; asiento: string | null }>(s, 'rpc/conta_venta_emitir', { p_id: g.id, p_quien_nombre: 'Prueba e2e K05' })
  console.log(`[K05 guarda lo mismo] Facturación: ${JSON.stringify(em)}`)
  expect(em.asiento, 'el asiento de la emitida de Facturación').toBeTruthy()

  // ── Por la ficha nueva: la misma, escrita a mano (el número, el de la factura). Sin cobro: Facturación no lo apunta al emitir. ──
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await abierta(page, 'Inicio')
  await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await ficha(page).locator('#kf-cliente').fill('Mismo Asiento')
  await page.getByRole('option', { name: /^43000083 · / }).click()
  await ficha(page).locator('#kf-numero').fill('K05M-1')
  await ficha(page).locator('#kf-fecha').fill('20/10/2026')
  await ficha(page).locator('#kf-fecha').press('Tab')
  await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('200')
  await ficha(page).getByRole('textbox', { name: 'Base 1' }).press('Tab')
  await expect(ficha(page).locator('#kf-venta-0')).toHaveValue('70000000', { timeout: 15_000 })
  await ficha(page).locator('#kf-cobro').fill('')
  await ficha(page).locator('[data-guardar-y-siguiente]').click()
  await expect(ficha(page).locator('[data-prueba="aviso-ficha"]')).toContainText('Apuntada y validada', { timeout: 60_000 })
  const [nuestra] = await pedir<{ id: string }[]>(s, `journal_entry?select=id&account_id=eq.${NUCLEO.id}&document_ref=eq.K05M-1&status=eq.validado`)

  // ── La misma vara a los dos lados. ──
  const deFacturacion = await vara(s, em.asiento!)
  const deLaFicha = await vara(s, nuestra.id)
  console.log(`[K05 guarda lo mismo] Facturación: ${JSON.stringify(deFacturacion)}`)
  console.log(`[K05 guarda lo mismo] la ficha:     ${JSON.stringify(deLaFicha)}`)
  expect(deLaFicha).toEqual(deFacturacion)
  expect(deLaFicha.apuntes).toEqual([['47700021', 0, 42], ['70000000', 0, 200], ['cliente', 242, 0]])
  expect(deLaFicha.libro).toEqual([{ book: 'issued', invoice_type: 'F1', tax_base: 200, tax_rate: 21, tax_amount: 42, total: 242, counterpart_tax_id: 'B00000729', counterpart_name: NOMBRE }])

  // ── La de Facturación, en la ficha nueva: «Hecha por Sumied», con su asiento. ──
  await page.goto(`/conta/ventas/facturas/${g.id}`, { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page).locator('.kf-estado')).toContainText('Hecha por Sumied.', { timeout: 30_000 })
  await expect(ficha(page).locator('#kf-numero')).toHaveValue(em.numero)
  await cargada(page, 'la hecha sola')
  await page.screenshot({ path: `${DIR}/hecha-sola-1456.png` })

  expect(errores, 'errores de la página').toEqual([])
})
