/// <reference lib="dom" />
// tests/e2e/conta/x25/cuenta-de-cobro.spec.ts — X25 · La «Cuenta de cobro» en la ficha del cliente, como en ERP10, contra
// staging, a 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo del núcleo (semillas K02, K05 y K06b):
//   1. En la ficha del cliente Uno (Terceros › Cobro), su «Cuenta de cobro», la 43000091 (la de la plataforma de la
//      K06b). Su emitida nueva la trae en «Cómo se cobra», con «De su ficha» en gris y la línea del asiento, y queda
//      cobrada con ese asiento: serie 4, la 43000091 al debe y su 43000081 al haber, por 121.
//   2. Regla 31: el cliente Dos, sin cuenta en su ficha, cobrado al banco de su ficha (57200001), deja el mismo asiento
//      que el camino de antes (main: conta_banco_a_mano con el mismo banco, su 430, el concepto y 121).
//   3. En la ficha del cliente Dos (Terceros › Datos fiscales), el NIF del cliente Uno escrito con guion: «Ya tienes a
//      … con este NIF», con «Abrirlo», que abre su ficha.
// Al acabar, la cuenta de cobro del Uno se quita (las e2e del K05 esperan su banco). Números inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x25'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const UNO = '43000081'
const DOS = '43000082'
const PLATAFORMA = '43000091'
const emitida = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-emitida-nucleo"]')
const aviso = (page: Page) => emitida(page).locator('[data-prueba="aviso-ficha"]')

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

type Asiento = { id: string; status: string; series: number; journal_line: { position: number; debit: number; credit: number; company_account: { code: string } }[] }
const SELECT = 'select=id,status,series,journal_line(position,debit,credit,company_account(code))'
const huella = (e: Asiento) => JSON.stringify({ serie: e.series, estado: e.status,
  apuntes: e.journal_line.sort((a, b) => a.position - b.position).map((l) => [l.company_account.code, Number(l.debit), Number(l.credit)]) })
const cobroDe = async (s: Sesion, numero: string) => {
  const e = await pedir<Asiento[]>(s, `journal_entry?${SELECT}&account_id=eq.${NUCLEO.id}&concept=eq.${encodeURIComponent(`Cobro factura ${numero}`)}&status=eq.validado`)
  expect(e, `el cobro de la ${numero}`).toHaveLength(1)
  return e[0]
}

/** El tercero (cliente) y el id de una cuenta del plan de la gestoría, por su código (regla 9: con su empresa). */
async function cuenta(s: Sesion, code: string): Promise<string> {
  const [c] = await pedir<{ id: string }[]>(s, `company_account?select=id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&code=eq.${code}`)
  expect(c, `la ${code} de la gestoría`).toBeTruthy()
  return c.id
}
async function clienteDe(s: Sesion, code: string): Promise<{ id: string; nombre: string; nif: string | null }> {
  const [l] = await pedir<{ entity_id: string }[]>(s, `company_account_link?select=entity_id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&entity=eq.customer&role=eq.principal&company_account_id=eq.${await cuenta(s, code)}`)
  expect(l, `el cliente de la ${code}`).toBeTruthy()
  const [p] = await pedir<{ id: string; name: string; tax_id: string | null }[]>(s, `party?select=id,name,tax_id&id=eq.${l.entity_id}`)
  return { id: p.id, nombre: p.name, nif: p.tax_id }
}
const quitarCuentaDeCobro = (s: Sesion, partyId: string) =>
  pedir(s, 'rpc/company_account_link_unset', { p_company: EMPRESA(), p_entity: 'customer', p_entity_id: partyId, p_role: 'pago', p_quien_nombre: 'Prueba e2e X25' }).catch(() => null)

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

/** Una emitida a mano del cliente, base 100 al 21 %, a la 70000000. */
async function escribirEmitida(page: Page, quien: 'Uno' | 'Dos', code: string, numero: string) {
  await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
  await expect(emitida(page)).toBeVisible({ timeout: 30_000 })
  await expect(emitida(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(emitida(page).locator('#kf-cliente')).toBeFocused({ timeout: 15_000 })
  await page.keyboard.type(`Emitida ${quien}`)
  await expect(page.getByRole('option', { name: new RegExp(`^${code} · `) })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await emitida(page).locator('#kf-numero').fill(numero)
  await emitida(page).locator('#kf-fecha').fill('01/10/2026')
  await emitida(page).locator('#kf-fecha').press('Tab')
  await emitida(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
  await emitida(page).getByRole('textbox', { name: 'Base 1' }).press('Tab')
  await expect(emitida(page).locator('[data-prueba="total"]')).toHaveText('121,00')
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X25 · ${ancho} × ${alto}: la cuenta de cobro en la ficha del cliente y su emitida la trae; el NIF repetido con «Abrirlo»`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const uno = await clienteDe(s, UNO)
    const dos = await clienteDe(s, DOS)
    const n = `${Date.now() % 100000}`
    try {
      // 1 · Su «Cuenta de cobro» en Terceros › Cobro: la 43000091.
      await page.goto(`/conta/clientes-y-proveedores/${uno.id}/cobro`, { timeout: 30_000 })
      const caja = page.locator('[data-prueba="cuenta-de-cobro"]')
      await expect(caja).toBeVisible({ timeout: 30_000 })
      await caja.getByRole('combobox', { name: 'Cuenta de cobro' }).fill(PLATAFORMA)
      await page.getByRole('option', { name: new RegExp(`^${PLATAFORMA} · `) }).click()
      await expect(caja.locator('[data-prueba="cuenta-de-cobro-dicho"]')).toHaveText(new RegExp(`^Guardada: la ${PLATAFORMA} · .+ es su cuenta de cobro\\. Sus facturas la traen en «Cómo se cobra»\\.$`), { timeout: 30_000 })
      // La casilla enseña la guardada, con su nombre del plan (no solo el aviso: e2e 44950611942, la captura la sacó vacía).
      await expect(caja.getByRole('combobox', { name: 'Cuenta de cobro' })).toHaveValue(PLATAFORMA)
      await expect(caja.getByRole('textbox', { name: 'Nombre de la cuenta de cobro' })).not.toHaveValue('')
      await page.screenshot({ path: `${DIR}/ficha-cliente-${ancho}.png` })

      // Su emitida nueva la trae, «De su ficha», con la línea del asiento; y queda cobrada con ese asiento.
      const num1 = `X25-${ancho}-${n}-1`
      await escribirEmitida(page, 'Uno', UNO, num1)
      await expect(emitida(page).locator('#kf-cobro')).toHaveValue(PLATAFORMA, { timeout: 15_000 })
      await expect(emitida(page).locator('[data-prueba="origen-cobro"]')).toHaveText('De su ficha')
      await expect(emitida(page).locator('[data-prueba="cobro-asiento"]')).toContainText(`con la ${PLATAFORMA}`)
      await page.screenshot({ path: `${DIR}/emitida-${ancho}.png` })
      await emitida(page).locator('[data-guardar-y-siguiente]').click()
      await expect(aviso(page)).toContainText(`Cobro apuntado en la ${PLATAFORMA}: 4 / `, { timeout: 60_000 })
      expect(JSON.parse(huella(await cobroDe(s, num1)))).toEqual({ serie: 4, estado: 'validado', apuntes: [[PLATAFORMA, 121, 0], [UNO, 0, 121]] })

      // 2 · Regla 31: el Dos, sin cuenta en su ficha, al banco de su ficha: el mismo asiento que el camino de main.
      const num2 = `X25-${ancho}-${n}-2`
      await escribirEmitida(page, 'Dos', DOS, num2)
      await expect(emitida(page).locator('#kf-cobro')).toHaveValue('57200001', { timeout: 15_000 })
      await emitida(page).locator('[data-guardar-y-siguiente]').click()
      await expect(aviso(page)).toContainText('Cobro apuntado en la 57200001', { timeout: 60_000 })
      const despues = huella(await cobroDe(s, num2))
      const [enlace] = await pedir<{ entity_id: string }[]>(s, `company_account_link?select=entity_id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&entity=eq.bank_account&role=eq.principal&company_account_id=eq.${await cuenta(s, '57200001')}`)
      expect(enlace, 'el banco de la 57200001').toBeTruthy()
      const num0 = `X25-${ancho}-${n}-0`
      const r0 = await pedir<{ asiento_id: string }>(s, 'rpc/conta_banco_a_mano', { p_banco: enlace.entity_id, p_fecha: '2026-10-01', p_cuenta: DOS, p_concepto: `Cobro factura ${num0}`, p_importe: 121, p_quien_nombre: 'Prueba e2e X25' })
      const [a0] = await pedir<Asiento[]>(s, `journal_entry?${SELECT}&account_id=eq.${NUCLEO.id}&id=eq.${r0.asiento_id}`)
      const antes = huella(a0)
      console.log(`[X25] regla 31 · antes (el camino de main, conta_banco_a_mano): ${antes}`)
      console.log(`[X25] regla 31 · después (${num2}): ${despues}`)
      expect(despues).toBe(antes)

      // 3 · El NIF del Uno en la ficha del Dos, con guion: «Ya tienes a … con este NIF», con «Abrirlo».
      expect(uno.nif, 'el NIF del cliente Uno').toBeTruthy()
      const conGuion = `${uno.nif!.slice(0, 1)}-${uno.nif!.slice(1)}`
      await page.goto(`/conta/clientes-y-proveedores/${dos.id}/datos-fiscales`, { timeout: 30_000 })
      const nif = page.getByRole('textbox', { name: 'NIF', exact: true })
      await expect(nif).toBeVisible({ timeout: 30_000 })
      await nif.fill(conGuion)
      await page.getByRole('button', { name: 'Guardar datos fiscales' }).click()
      const frase = page.locator('[data-prueba="nif-repetido"]')
      await expect(frase).toContainText(`Ya tienes a ${uno.nombre} con este NIF.`, { timeout: 30_000 })
      await page.screenshot({ path: `${DIR}/nif-repetido-${ancho}.png` })
      await frase.getByRole('link', { name: 'Abrirlo' }).click()
      await expect(page).toHaveURL(new RegExp(`/clientes-y-proveedores/${uno.id}`), { timeout: 30_000 })
      expect(errores).toEqual([])
    } finally {
      await quitarCuentaDeCobro(s, uno.id)
    }
  })
}
