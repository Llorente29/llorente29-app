// tests/e2e/conta/x22/nombre.spec.ts — X22 · Cada cuenta, con su nombre guardado (21/11), contra staging, a 1456 × 816
// y a 1366 × 768, en la empresa de la cuenta A del R07 (el día de ejemplo INVENTADO de Revo, 09/11):
//   «A qué cuenta va cada forma de pago» → la factura del día, a la derecha: la línea de la 700 dice «<código> · <nombre
//   del plan>» («70000000 · Ventas de mercaderías»), nunca su explicación («Lo que vendes: …»). El nombre lo da
//   conta_tpv_dia_ejemplo (la 1600).
// Desde una rama, la 1600 va a staging solo en ROLLBACK (W04: cambia en caliente): la base aún da la explicación. La
// prueba lo apunta como el «antes» y comprueba que es la explicación de esa misma cuenta. Sobre main —donde staging
// tiene la 1600 por construcción— es estricta: el nombre del plan o rojo. Así el antes y el después son la misma
// prueba, con la misma cuenta (regla 31).
// No se guarda nada nuevo: las formas de pago y el día, como el R07 (si ya están, se quedan).

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

const DIR = 'docs/conta/capturas/x22'
const CIERRE_GLOVO = enCarril('acebcda4-f03a-4f84-bfe4-062a941e60a2')
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const
/** Sobre main, staging tiene la 1600 (W04): ahí no vale el «antes». */
const ESTRICTA = (process.env.GITHUB_REF_NAME ?? '') === 'main' || process.env.X22_ESTRICTA === '1'

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
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

/** Como el R07: las formas de pago con su cuenta, el 09/11 guardado y la factura del día. Devuelve la 700 de la empresa. */
async function preparar(s: Sesion): Promise<{ code: string; name: string; plain_name: string | null }> {
  const cierre = await rest<{ company_id: string }[]>(s, 'GET', `sales_day_summary?select=company_id&id=eq.${CIERRE_GLOVO}`)
  const empresa = cierre.datos[0]?.company_id
  if (!empresa) throw new Error('No encuentro la empresa del cierre de Glovo del 24/09 en el carril.')
  const ctas = await rest<{ id: string; code: string; name: string; plain_name: string | null; kind: string }[]>(s, 'GET',
    `company_account?select=id,code,name,plain_name,kind&company_id=eq.${empresa}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.datos.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.datos.length} cuentas).`)
  const ya = await rest<{ forma: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=forma&company_id=eq.${empresa}`)
  if (!ya.datos.length) {
    const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
    const r = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: empresa, forma, canal, company_account_id: cta, created_by_name: 'e2e X22' })))
    if (r.status >= 300) throw new Error(`No se han podido guardar las cuentas de las formas de pago: ${r.status} ${JSON.stringify(r.datos)}`)
  }
  const dias = await rpc<{ dia: string }[]>(s, 'conta_tpv_dias', { p_company: empresa, p_desde: '2026-11-09', p_hasta: '2026-11-09' })
  if (!dias.length) {
    const lectura = leerRevo(['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`))) })))
    if (!lectura.ok) throw new Error(lectura.problemas.join(' | '))
    await rpc(s, 'conta_tpv_dia_guardar', { p_company: empresa, p_dia: '2026-11-09', p_programa: 'revo', p_lectura: lectura.lectura.dias[0].lectura, p_quien_nombre: 'Prueba e2e' })
  }
  await asegurarFacturaDelDia(s, empresa)
  // La 700 de ventas: la de la plantilla, como la elige la base (conta_tpv_dia_ejemplo, «v_ventas»).
  const ventas = ctas.datos.find((c) => c.kind === 'template' && c.code.startsWith('700'))
  if (!ventas) throw new Error('El plan de la empresa no tiene la 700 de la plantilla.')
  return ventas
}

for (const tam of TAMANOS) {
  test(`X22 · ${tam.width} × ${tam.height}: la factura del día dice la 700 con su nombre del plan, no su explicación`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
    test.setTimeout(150_000)
    await page.setViewportSize(tam)
    const errores = vigilar(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const ventas = await preparar(s)
    const conNombre = `${ventas.code} · ${ventas.name}`
    const conExplicacion = ventas.plain_name && ventas.plain_name !== ventas.name ? `${ventas.code} · ${ventas.plain_name}` : null
    console.log(`[X22] la ${ventas.code}: nombre del plan «${ventas.name}», explicación «${ventas.plain_name ?? '—'}»`)

    await page.goto('/conta/ajustes/ventas-por-dia')
    await page.getByRole('button', { name: 'A qué cuenta va cada forma de pago' }).click({ timeout: 30_000 })
    const v = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
    await expect(v.getByRole('table', { name: 'A qué cuenta va cada forma de pago' })).toBeVisible({ timeout: 30_000 })
    const asiento = v.locator('[data-prueba="asiento-factura"], [data-prueba="asiento-ejemplo"]').first()
    await expect(asiento).toBeVisible({ timeout: 30_000 })
    const linea = asiento.locator('tbody td:first-child').filter({ hasText: new RegExp(`^${ventas.code} · `) }).first()
    await expect(linea).toBeVisible({ timeout: 30_000 })
    const texto = ((await linea.textContent()) ?? '').trim()

    if (!ESTRICTA && conExplicacion && texto.startsWith(conExplicacion)) {
      // El «antes»: desde la rama, staging aún tiene la de antes. Que sea la explicación de esa misma cuenta.
      console.log(`[X22] antes (la 1600 solo en ROLLBACK desde la rama): «${texto}»`)
      expect(texto.startsWith(conExplicacion)).toBe(true)
    } else {
      console.log(`[X22] ahora: «${texto}»`)
      expect(texto.startsWith(conNombre), `la línea de la ${ventas.code} dice «${texto}»`).toBe(true)
      if (conExplicacion) await expect(v.getByText(ventas.plain_name as string, { exact: false })).toHaveCount(0)
    }
    await page.screenshot({ path: `${DIR}/factura-del-dia-${tam.width}.png` })
    expect(errores).toEqual([])
  })
}
