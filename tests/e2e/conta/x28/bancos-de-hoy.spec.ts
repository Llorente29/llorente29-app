/// <reference lib="dom" />
// tests/e2e/conta/x28/bancos-de-hoy.spec.ts — X28 · La pantalla de Bancos de fuera del núcleo, que sigue en el menú
// (con el interruptor del núcleo apagado, en el móvil, y su pestaña «Movimientos»). Lo que la probaba vivía en las
// e2e de E05 y E05b, que se quitaron con la pantalla de bancos del núcleo (respuesta X28 · 2, punto 2). Lo de ellas que
// era de esta pantalla, aquí, contra staging y con sus mismas semillas (e2e_e05_preparar y e2e_e05b_preparar):
//   1. con el interruptor apagado (la cuenta A) o en el móvil, /conta/bancos es la pantalla de siempre (ni el marco
//      del núcleo ni Tesorería);
//   2. «Sí, es esto» en Movimientos concilia lo propuesto: su casado y su asiento de la serie 3 (la 62800000 contra el
//      banco, 45,00), como medía E05;
//   3. «Buscar factura» en Movimientos paga la factura: su casado, la factura pagada y el asiento de la serie 3 (el
//      proveedor contra el banco), como medía E05b.
// Datos inventados (las semillas de E05 y E05b).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { EMPRESA, NUCLEO } from '../k02/comun'
import { MOTOR_BANCOS } from '../../../../supabase/functions/_shared/bancos/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

interface Factura { id: string; numero: string; total: number }
interface Preparado { cuenta: string; empresa: string; banco: string; cuenta572: string; cuentaProveedor?: string; movs: Record<'probable', string>; facturas?: Record<'hoy', Factura>; pagos?: Record<'hoy', string> }
type Casado = { movimiento?: string; kind?: string; confianza?: string; quien?: string; factura?: string; asiento: { serie: number; estado: string; origen: string; lineas: (string | number)[][] } | null }

async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function preparar(s: Sesion, rpc: 'e2e_e05_preparar' | 'e2e_e05b_preparar'): Promise<Preparado> {
  const r = await rest<Preparado>(s, 'POST', `rpc/${rpc}`, { p_lado: 'estrecho', p_motor: MOTOR_BANCOS })
  expect(r.status, `${rpc}: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  return r.datos
}

/** El casado de un movimiento, con la vara de E05 y E05b: la 572, «banco»; la del proveedor, «proveedor»; el total de la factura, «total». */
async function casadoDe(s: Sesion, p: Preparado, mov: string, f?: Factura): Promise<Casado> {
  const m = await rest<{ status: string; bank_match: { kind: string; confidence: string; by_who: string; status: string; journal_entry: { series: number; status: string; source_type: string; journal_line: { debit: number; credit: number; company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
    `bank_movement?select=status,bank_match(kind,confidence,by_who,status,journal_entry(series,status,source_type,journal_line(debit,credit,company_account(code))))&account_id=eq.${p.cuenta}&id=eq.${mov}`)
  const fac = f ? await rest<{ status: string }[]>(s, 'GET', `supplier_invoice?select=status&account_id=eq.${p.cuenta}&id=eq.${f.id}`) : null
  const vivo = m.datos[0]?.bank_match.find((b) => b.status === 'vivo') ?? null
  const e = vivo?.journal_entry ?? null
  const importe = (x: number) => (f && Number(x) === f.total ? 'total' : Number(x))
  const cuenta = (c: string) => (c === p.cuenta572 ? 'banco' : c === p.cuentaProveedor ? 'proveedor' : c)
  return {
    movimiento: m.datos[0]?.status, kind: vivo?.kind, confianza: vivo?.confidence, quien: vivo?.by_who, factura: fac?.datos[0]?.status,
    asiento: e ? { serie: e.series, estado: e.status, origen: e.source_type,
      lineas: e.journal_line.map((l) => [cuenta(l.company_account.code), importe(l.debit), importe(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) } : null,
  }
}

/** La cuenta del núcleo, en su empresa general (la de las semillas de E05 y E05b), con las pestañas limpias. */
async function entrarEnLaEmpresa(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${EMPRESA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}`) })).toBeVisible({ timeout: 30_000 })
  return s
}

test('con el interruptor apagado (la cuenta A) o en el móvil, Bancos es la pantalla de siempre', async ({ page }, info) => {
  if (info.project.name === 'movil') await entrarComo(page, NUCLEO.email)
  else await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/bancos', { timeout: 30_000 })
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
  await expect(page.locator('[data-prueba="tesoreria-nucleo"]')).toHaveCount(0)
})

test('«Sí, es esto» en Movimientos concilia lo propuesto (como medía E05)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador')
  test.setTimeout(180_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  const s = await entrarEnLaEmpresa(page)
  const p = await preparar(s, 'e2e_e05_preparar')
  try {
    await page.goto(`/conta/bancos/movimientos?banco=${p.banco}&mes=2026-10&mov=${p.movs.probable}`, { timeout: 30_000 })
    const si = page.locator('.k-zona[data-activa="si"]').getByRole('button', { name: 'Sí, es esto' })
    await expect(si).toBeVisible({ timeout: 30_000 })
    await si.click()
    await expect.poll(async () => (await casadoDe(s, p, p.movs.probable)).movimiento, { timeout: 30_000 }).toBe('casado')
    const c = await casadoDe(s, p, p.movs.probable)
    console.log(`[X28 · Bancos de siempre · Sí, es esto] ${JSON.stringify(c)}`)
    expect(c).toMatchObject({ movimiento: 'casado', kind: 'cuenta', confianza: 'probable', quien: 'persona',
      asiento: { serie: 3, origen: 'bank', lineas: [['62800000', 45, 0], ['banco', 0, 45]] } })
    // El mismo estado que medía E05 (validado con la 2040 del R08; propuesto en una base sin ella).
    expect(c.asiento?.estado).toMatch(/^(validado|propuesto)$/)
    expect(errores).toEqual([])
  } catch (e) { await contarPantalla(page, 'Sí, es esto'); throw e }
})

test('«Buscar factura» en Movimientos paga la factura (como medía E05b)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador')
  test.setTimeout(180_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  const s = await entrarEnLaEmpresa(page)
  const p = await preparar(s, 'e2e_e05b_preparar')
  const g = p.facturas!.hoy
  try {
    await page.goto(`/conta/bancos/movimientos?banco=${p.banco}&mes=2026-10&mov=${p.pagos!.hoy}`, { timeout: 30_000 })
    const zona = page.locator('.k-zona[data-activa="si"]')
    const boton = zona.getByRole('button', { name: /^Buscar (otra )?factura$/ }).first()
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
    const dialogo = page.getByRole('dialog', { name: '¿Qué factura paga?' })
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole('textbox', { name: 'Buscar factura' }).fill(g.numero)
    await dialogo.getByRole('link', { name: new RegExp(g.numero) }).click()
    await expect.poll(async () => (await casadoDe(s, p, p.pagos!.hoy, g)).movimiento, { timeout: 30_000 }).toBe('casado')
    const c = await casadoDe(s, p, p.pagos!.hoy, g)
    console.log(`[X28 · Bancos de siempre · Buscar factura] ${JSON.stringify(c)}`)
    expect(c).toMatchObject({ movimiento: 'casado', kind: 'factura_recibida', confianza: 'probable', quien: 'persona', factura: 'pagada',
      asiento: { serie: 3, origen: 'bank', lineas: [['banco', 0, 'total'], ['proveedor', 'total', 0]] } })
    expect(errores).toEqual([])
  } catch (e) { await contarPantalla(page, 'Buscar factura'); throw e }
})
