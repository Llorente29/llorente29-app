/// <reference lib="dom" />
// tests/e2e/conta/x26/modificar.spec.ts — X26 · «Modificar» una recibida contabilizada, como en ERP10, contra staging, a
// 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo del núcleo (semillas K02 y K04):
//   una recibida a mano del Proveedor de Prueba Ficha Uno, a la 62800000, validada («Contabilizada · asiento N»).
//   «Modificar»: la franja dice «Modificando el asiento N»; la cuenta de gasto pasa a una 628 nueva («Electricidad»,
//   inventada) e Intro. Sigue «Contabilizada · asiento N» con el MISMO N, y en el asiento está la cuenta nueva; la del
//   proveedor y el IVA, igual (regla 31: el número de asientos y el saldo de su cuenta, antes y después).
// Números y nombres inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x26'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const franja = (page: Page) => ficha(page).locator('.kf-estado')
const aviso = (page: Page) => ficha(page).locator('[data-prueba="aviso-ficha"]')

async function pedir<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

/** La vara de la regla 31, la misma antes y después: los asientos validados de la gestoría y el saldo de la cuenta del proveedor. */
async function vara(s: Sesion) {
  const asientos = await pedir<{ id: string }[]>(s, `journal_entry?select=id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&status=eq.validado`)
  const [prov] = await pedir<{ id: string }[]>(s, `company_account?select=id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&code=eq.40000071`)
  const lineas = await pedir<{ debit: number; credit: number; journal_entry: { status: string } }[]>(s,
    `journal_line?select=debit,credit,journal_entry!inner(status)&account_id=eq.${NUCLEO.id}&company_account_id=eq.${prov.id}&journal_entry.status=eq.validado`)
  return { asientos: asientos.length, saldoProveedor: Math.round(lineas.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0) * 100) / 100 }
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X26 · ${ancho} × ${alto}: «Modificar» la cuenta de gasto de una recibida contabilizada: el mismo asiento, la cuenta nueva`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const n = `${Date.now() % 100000}`
    const numero = `X26-${ancho}-${n}`

    // Una a mano, a la 62800000, validada.
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#kf-proveedor')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.type('Ficha Uno')
    await page.keyboard.press('Enter')
    await ficha(page).locator('#kf-numero').fill(numero)
    await ficha(page).locator('#kf-fecha').fill('20/10/2026')
    await ficha(page).locator('#kf-fecha').press('Tab')
    await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
    await ficha(page).getByRole('combobox', { name: 'Tipo de IVA 1' }).selectOption('21')
    await ficha(page).getByRole('button', { name: 'Quitar el tipo 10 %' }).click()
    await ficha(page).locator('#kf-cuenta-0').fill('62800000')
    await page.getByRole('option', { name: /^62800000 · / }).click()
    const local = ficha(page).getByRole('combobox', { name: 'Local' })
    if (await local.isEnabled()) await local.selectOption({ index: 1 })
    await ficha(page).getByRole('checkbox', { name: 'Guardarla sin documento' }).check()
    await ficha(page).getByRole('textbox', { name: 'Por qué no tiene documento' }).fill('Prueba e2e X26: escrita a mano, sin documento')
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    const [fac] = await pedir<{ id: string; journal_entry_id: string }[]>(s, `supplier_invoice?select=id,journal_entry_id&account_id=eq.${NUCLEO.id}&invoice_number=eq.${numero}`)
    expect(fac?.journal_entry_id, 'la recibida, con su asiento').toBeTruthy()
    const [antes] = await pedir<{ series: number; number: number }[]>(s, `journal_entry?select=series,number&id=eq.${fac.journal_entry_id}`)
    const varaAntes = await vara(s)

    // La cuenta nueva: una 628 inventada («Electricidad»), en la gestoría.
    const nueva = await pedir<{ code: string }>(s, 'rpc/company_account_add', { p_company: EMPRESA(), p_hoja: '628', p_nombre: `Electricidad X26 ${n}`, p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: 'Prueba e2e X26', p_source: 'manual' })

    // «Modificar»: la franja, la cuenta nueva e Intro.
    await page.goto(`/conta/documentos/recibidas/${fac.id}`, { timeout: 30_000 })
    await expect(franja(page)).toContainText(`Contabilizada · asiento ${antes.number}.`, { timeout: 30_000 })
    const modificar = ficha(page).locator('[data-prueba="modificar"]')
    await expect(modificar).toBeEnabled({ timeout: 30_000 })
    await modificar.click()
    await expect(franja(page)).toContainText(`Modificando el asiento ${antes.number}.`)
    const casilla = ficha(page).locator('[data-prueba="modificar-asiento"] tr[data-cuenta="62800000"] input')
    await casilla.fill(nueva.code)
    await page.getByRole('option', { name: new RegExp(`^${nueva.code} · `) }).click()
    await expect(ficha(page).locator(`[data-prueba="modificar-asiento"] tr[data-cuenta="${nueva.code}"]`)).toBeVisible()
    await page.screenshot({ path: `${DIR}/modificando-${ancho}.png` })
    await casilla.press('Enter')
    await expect(aviso(page)).toContainText(`Modificado: el asiento ${antes.number} sigue siendo el ${antes.number}, con 62800000 → ${nueva.code}.`, { timeout: 60_000 })
    await expect(franja(page)).toContainText(`Contabilizada · asiento ${antes.number}.`, { timeout: 30_000 })

    // El mismo asiento, con la cuenta nueva; la regla 31.
    const [despues] = await pedir<{ id: string; series: number; number: number; status: string; journal_line: { position: number; company_account: { code: string } }[] }[]>(s,
      `journal_entry?select=id,series,number,status,journal_line(position,company_account(code))&id=eq.${fac.journal_entry_id}`)
    expect({ serie: despues.series, numero: despues.number, estado: despues.status }).toEqual({ serie: antes.series, numero: antes.number, estado: 'validado' })
    expect(despues.journal_line.map((l) => l.company_account.code)).toContain(nueva.code)
    expect(despues.journal_line.map((l) => l.company_account.code)).not.toContain('62800000')
    const varaDespues = await vara(s)
    console.log(`[X26] regla 31 · antes ${JSON.stringify(varaAntes)} · después ${JSON.stringify(varaDespues)}`)
    expect(varaDespues).toEqual(varaAntes)
    expect(errores).toEqual([])
  })
}
