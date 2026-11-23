/// <reference lib="dom" />
// tests/e2e/conta/x21b/pago.spec.ts — X21b · «Cómo se paga» admite cualquier cuenta del plan, y «No está» solo si no
// existe en el plan (Julio, 21/11; regla 30), contra staging, a 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo
// del núcleo (la de las K06), con el navegador en español:
//   1. Una a mano de su proveedor (base 100 al 21 %): en «Cómo se paga», una 430 de cliente que existe y no es la de
//      ninguna plataforma (el caso de Julio: la escribió y salía «No está: crearla»). Sale en la lista, se elige con su
//      nombre, y una línea dice el asiento que hará: la del proveedor al debe y la 430 al haber, por 121,00 €.
//   2. Otro buscador con la misma regla: esa 430, escrita en «A qué cuenta de gasto va», dice que existe pero que
//      ahí solo van cuentas de gasto; ningún «No está».
// No se guarda la factura. La 430: la primera de cliente de la empresa que no es de una plataforma o, si no hay, una
// inventada (T11) que se crea antes con company_account_add_codigo (X20).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'
import { siguienteLibre } from '../../../../src/modules/conta/lib/planEmpresa'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x21b'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)

async function rest<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => { window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas') })
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

/** Una 430 de cliente de la empresa que no es la de una plataforma (o una inventada, creada ahora). */
async function una430(s: Sesion): Promise<{ code: string; name: string }> {
  const cuentas = await rest<{ id: string; code: string; name: string; status: string | null }[]>(s,
    `company_account?select=id,code,name,status&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&code=like.430*&order=code`)
  const enlaces = await rest<{ company_account_id: string; entity_id: string }[]>(s,
    `company_account_link?select=company_account_id,entity_id&account_id=eq.${NUCLEO.id}&company_id=eq.${EMPRESA()}&entity=eq.customer`)
  const plataformas = new Set((await rest<{ party_id: string }[]>(s, `party_role?select=party_id&account_id=eq.${NUCLEO.id}&role=eq.platform`)).map((r) => r.party_id))
  const dePlataforma = new Set(enlaces.filter((l) => plataformas.has(l.entity_id)).map((l) => l.company_account_id))
  const ya = cuentas.find((c) => c.code.length === 8 && c.status !== 'cerrada' && !dePlataforma.has(c.id))
  if (ya) return ya
  const codigo = siguienteLibre('4300', 8, new Set(cuentas.map((c) => c.code)))
  if (!codigo) throw new Error('No quedan códigos libres bajo la 4300.')
  const r = await rest<{ code: string; name: string }>(s, 'rpc/company_account_add_codigo', { p_company: EMPRESA(), p_codigo: codigo, p_nombre: 'Cliente inventado X21b', p_quien_nombre: 'Prueba e2e X21b' })
  return { code: r.code, name: 'Cliente inventado X21b' }
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X21b · ${ancho} × ${alto}: «Cómo se paga» con una 430 que existe, con la línea del asiento; y «No está» solo si no está en el plan`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const errores = vigilar(page)
    const cliente = await una430(s)
    console.log(`[X21b] la 430: ${cliente.code} · ${cliente.name}`)

    // Una a mano: su proveedor, base 100 al 21 %, a la 600.
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#kf-proveedor')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.type('Ficha Uno')
    await page.keyboard.press('Enter')
    await ficha(page).locator('#kf-numero').fill(`X21B-${Date.now() % 100000}`)
    await ficha(page).locator('#kf-fecha').fill('20/10/2026')
    await ficha(page).locator('#kf-fecha').press('Tab')
    await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
    await ficha(page).getByRole('combobox', { name: 'Tipo de IVA 1' }).selectOption('21')
    await ficha(page).getByRole('button', { name: 'Quitar el tipo 10 %' }).click()

    // 2 · «A qué cuenta de gasto va»: la 430 existe, pero ahí solo van las de gasto. Ningún «No está».
    await ficha(page).locator('#kf-cuenta-0').fill(cliente.code)
    const noVa = ficha(page).locator('[data-prueba="existe-no-va"]')
    await expect(noVa).toHaveText(`La ${cliente.code} · ${cliente.name} existe, pero aquí solo van cuentas de gasto (las del 6).`, { timeout: 30_000 })
    await expect(ficha(page).getByRole('button', { name: /^No está/ })).toHaveCount(0)
    await page.screenshot({ path: `${DIR}/gasto-existe-${ancho}.png` })
    await ficha(page).locator('#kf-cuenta-0').fill('600')
    await page.getByRole('option', { name: /^60000000 · / }).click()

    // 1 · «Cómo se paga»: la 430 sale en la lista y se elige, con su nombre, y la línea del asiento.
    await ficha(page).locator('#kf-pago').fill(cliente.code)
    const opcion = page.getByRole('option', { name: `${cliente.code} · ${cliente.name}` })
    await expect(opcion).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page).getByRole('button', { name: /^No está/ })).toHaveCount(0)
    await opcion.click()
    await expect(ficha(page).locator('#kf-pago')).toHaveValue(cliente.code)
    // K11b · El nombre de la cuenta del pago, en el `title` de su subcuenta (sin casilla propia, como ERP10).
    await expect(ficha(page).locator('[data-prueba="pago-cuenta"]')).toHaveAttribute('title', new RegExp(`^${cliente.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await expect(ficha(page).locator('#kf-pago-fecha')).toHaveValue('20/10/2026')
    const linea = ficha(page).locator('[data-prueba="pago-asiento"]')
    await expect(linea).toHaveText(new RegExp(`^No es un banco ni la caja: al validar, un asiento del pago con (la \\d{8} del proveedor|la del proveedor) al debe y la ${cliente.code} · ${cliente.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} al haber, por 121,00 €, y la factura queda pagada\\.$`))
    // No se corta y cabe: la línea, entera dentro de la ficha.
    const cabe = await linea.evaluate((e) => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1 })
    expect(cabe, 'la línea del asiento cabe').toBe(true)
    await page.screenshot({ path: `${DIR}/pago-con-430-${ancho}.png` })

    // Y lo que no está en el plan, sí: «No está: crear la …».
    const libre = siguienteLibre('4300', 8, new Set((await rest<{ code: string }[]>(s, `company_account?select=code&company_id=eq.${EMPRESA()}&code=like.430*`)).map((c) => c.code)))
    await ficha(page).locator('#kf-pago').fill(libre ?? '43009999')
    await expect(ficha(page).getByRole('button', { name: `No está: crear la ${libre}` })).toBeVisible({ timeout: 30_000 })
    expect(errores).toEqual([])
  })
}
