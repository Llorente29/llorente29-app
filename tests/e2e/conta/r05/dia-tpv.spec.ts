// tests/e2e/conta/r05/dia-tpv.spec.ts
//
// R05 · Un día del TPV en Cierres del día, contra staging-conta, en el carril de
// la cuenta A (su empresa de hostelería, la del cierre de Glovo del 24/09).
//
//   Lo que la pantalla todavía no hace (subir los ficheros y elegir las cuentas
//   va en el PR siguiente), se prepara por la API con la sesión del usuario:
//   a qué cuenta va cada forma de pago (conta_tpv_forma_cuenta) y el día del
//   ejemplo INVENTADO de Revo, leído con el lector del R04 y guardado con
//   conta_tpv_dia_guardar.
//
//   1. La fila: «TPV · Revo», quién lo subió, «2 facturas con NIF», 48
//      facturas, «5001 a 5048», base, IVA y total, «Efectivo, tarjeta y
//      plataformas» y «Listo para validar».
//   2. «Validar los N listos»: el día del TPV se valida con su PDF y su asiento,
//      y lo dice; después sale «Validado».
// Las capturas, en docs/conta/capturas/r05 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'

const DIR = 'docs/conta/capturas/r05'
const CIERRE_GLOVO = enCarril('acebcda4-f03a-4f84-bfe4-062a941e60a2')
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function rpc<T>(s: Sesion, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${t}`)
  return (t ? JSON.parse(t) : null) as T
}

/** La empresa del cierre de Glovo, sus cuentas de cobro y el día del ejemplo guardado (si no lo estaba ya). */
async function preparar(s: Sesion): Promise<string> {
  const cierre = await rest<{ company_id: string }[]>(s, 'GET', `sales_day_summary?select=company_id&id=eq.${CIERRE_GLOVO}`)
  const empresa = cierre.datos[0]?.company_id
  if (!empresa) throw new Error('No encuentro la empresa del cierre de Glovo del 24/09 en el carril.')
  const ctas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&company_id=eq.${empresa}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.datos.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.datos.length} cuentas).`)
  const ya = await rest<{ id: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=id&company_id=eq.${empresa}`)
  if (!ya.datos.length) {
    const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
    const r = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: empresa, forma, canal, company_account_id: cta, created_by_name: 'e2e R05' })))
    if (r.status >= 300) throw new Error(`No se han podido guardar las cuentas de las formas de pago: ${r.status} ${JSON.stringify(r.datos)}`)
  }
  // R07 · Desde la 0900, sin la cuenta de la factura del día no se valida.
  await asegurarFacturaDelDia(s, empresa)
  const lectura = leerRevo(['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`))) })))
  if (!lectura.ok) throw new Error(lectura.problemas.join(' | '))
  const dias = await rpc<{ dia: string; estado: string }[]>(s, 'conta_tpv_dias', { p_company: empresa, p_desde: '2026-11-09', p_hasta: '2026-11-09' })
  if (!dias.length) await rpc(s, 'conta_tpv_dia_guardar', { p_company: empresa, p_dia: '2026-11-09', p_programa: 'revo', p_lectura: lectura.lectura.dias[0].lectura, p_quien_nombre: 'Prueba e2e' })
  return empresa
}

test('el día del TPV sale en Cierres del día, una fila por día, y se valida con el mismo botón', async ({ page }) => {
  test.setTimeout(300_000)
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  await preparar(s)
  await page.goto('/conta/ventas/cierres?ver=todos&q=5001')
  await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  const fila = page.getByText('TPV · Revo', { exact: true }).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('5001 a 5048').first()).toBeVisible()
  await expect(page.getByText(/2 facturas con NIF/).first()).toBeVisible()
  await expect(page.getByText(/1\.100,00 €/).first()).toBeVisible()
  if (lado(page) === 'ordenador') {
    await expect(page.getByText('Efectivo, tarjeta y plataformas').first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'De dónde' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Numeración' })).toBeVisible()
    // Listo para validar (si saliera en espera, el motivo va en la misma fila y el fallo lo enseña).
    const filaTpv = page.getByRole('row').filter({ hasText: 'TPV · Revo' }).first()
    await expect(filaTpv, `la fila dice: ${await filaTpv.innerText()}`).toContainText('Listo para validar')
  }
  await foto(page, 'cierres-tpv')

  // Solo en el ordenador: validar escribe (en el carril) y no se deshace; el móvil comprueba la fila.
  if (lado(page) !== 'ordenador') { expect(errores).toEqual([]); return }
  const boton = page.getByRole('button', { name: /^Validar los \d+ listos/ }).first()
  await expect(boton).toBeEnabled({ timeout: 30_000 })
  await boton.click()
  const dialogo = page.getByRole('dialog')
  // La lista del diálogo enseña como mucho 8, los del TPV primero.
  await expect(dialogo.getByText(/TPV · Revo · 9 nov/).first()).toBeVisible()
  await expect(dialogo.getByText(/Los días del TPV no llevan factura de Sumied/)).toBeVisible()
  await dialogo.getByRole('button', { name: /^Validar \d+ cierres?$/ }).click()
  const resultado = page.locator('[data-prueba="resultado-validar"]')
  await expect(resultado.getByText(/^✓ TPV · Revo · 9 nov: validado con su PDF y (el asiento nº [\d.]+|la factura del día es el asiento nº [\d.]+ y su cobro el nº [\d.]+) · 48 facturas, 5001 a 5048 \(1\.100,00 €\)\.$/)).toBeVisible({ timeout: 200_000 })
  await expect(page.getByText('Validado').first()).toBeVisible({ timeout: 30_000 })
  await foto(page, 'cierres-tpv-validado')
  expect(errores).toEqual([])
})
