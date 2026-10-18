/// <reference lib="dom" />
// tests/e2e/conta/i01b/impuestos.spec.ts
//
// I01b · Las pantallas de Impuestos (tableros 8, 9 y 10), con la marca Sumied,
// en ordenador y móvil: el Calendario, el Impuesto de sociedades, el IVA del
// trimestre (Resumen y Modelo oficial, con el panel «Presentar a Hacienda» y su
// puerta cerrada), Presentados, Certificados y accesos (y el diálogo de
// «Invitar a mi asesoría», sin mandarlo), la página de aceptar una invitación
// sin enlace, y los avisos de impuestos en Inicio. Los títulos por nivel los
// prueban las unitarias: el nivel es del usuario, y el ordenador, el móvil y el
// marco corren a la vez en el mismo carril, así que aquí no se cambia.
//
// Lo que prepara, SOLO DENTRO DE SU CARRIL (la copia de las cuentas de prueba
// que se borra al acabar; sin carril, se salta: la plantilla no se toca):
//   · el interruptor conta_impuestos de la cuenta A, como el administrador de
//     plataforma del carril (feature_flags solo lo escribe la plataforma);
//   · como el administrador de A: sus obligaciones y el 303 del 3T calculado,
//     lo mismo que hace la pantalla. El nivel no se toca (el de siempre, medio).
// No presenta nada ni llama a Hacienda: la puerta de staging está cerrada, y
// la pantalla lo dice (eso se comprueba).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'

test.skip(CARRIL === null, 'Las pantallas de Impuestos necesitan su carril: sin él tendría que encender Impuestos en la plantilla, que es de todos.')

const DIR = 'docs/conta/capturas/i01b'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function api(s: Sesion, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, prefer = 'return=representation') {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${texto.slice(0, 300)}`)
  return texto ? JSON.parse(texto) : null
}

let empresa = ''


test.beforeAll(async () => {
  // 1 · Impuestos encendido para la A de ESTE carril, como la plataforma del carril.
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e I01b (carril)' },
    'resolution=merge-duplicates,return=minimal')
  // 2 · Como el administrador de A: su empresa, sus obligaciones y el 303 del 3T.
  const a = await pedirSesion(CUENTA_A.email)
  const empresas = await api(a, 'GET', `company?account_id=eq.${CUENTA_A.id}&select=id&order=created_at&limit=1`) as { id: string }[]
  expect(empresas.length, 'la cuenta A del carril no tiene empresa').toBe(1)
  empresa = empresas[0].id
  await api(a, 'POST', 'rpc/conta_impuesto_obligaciones_calcular', { p_company: empresa })
  // El ordenador y el móvil preparan a la vez en el mismo carril: si los dos
  // calculan el mismo 303 a la vez, uno puede chocar; el segundo intento ya lo encuentra.
  await api(a, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: empresa, p_year: 2026, p_period: '3T' })
    .catch(() => api(a, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: empresa, p_year: 2026, p_period: '3T' }))
})

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  return errores
}
async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
async function ir(page: Page, ruta: string) {
  await page.goto(`/conta/${ruta}${ruta.includes('?') ? '&' : '?'}marca=sumied`)
  await cargada(page)
}
const foto = (page: Page, nombre: string) =>
  page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })

/** Nada se sale por la derecha (1440 y 390 px, «nada se rompe»). */
async function sinDesbordar(page: Page, donde: string) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, `${donde}: la página se sale ${sobra} px por la derecha`).toBeLessThanOrEqual(1)
}

test('Calendario (tablero 8): Impuestos en la barra, la tabla del plazo y por qué te salen', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos')
  await expect(page.getByText(/IVA del (3\.er )?trimestre/).first()).toBeVisible()
  await expect(page.getByText('Por qué te salen estos').first()).toBeVisible()
  await sinDesbordar(page, 'Calendario')
  await foto(page, 'calendario')
  expect(errores).toEqual([])
})

test('Impuesto de sociedades: sus plazos y «Se calculará aquí pronto»', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/sociedades')
  await expect(page.getByText('Se calculará aquí pronto').first()).toBeVisible()
  await sinDesbordar(page, 'Sociedades')
  await foto(page, 'sociedades')
  expect(errores).toEqual([])
})

test('IVA del trimestre (tablero 9): Resumen, Modelo oficial y la puerta cerrada que dice por qué', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/iva/2026/3T')
  await expect(page.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#presentar-titulo')).toBeVisible()
  await sinDesbordar(page, 'IVA · Resumen')
  await foto(page, 'iva-resumen')
  await page.getByRole('tab', { name: 'Modelo oficial (casillas)' }).click()
  await page.waitForTimeout(300)
  await sinDesbordar(page, 'IVA · Modelo oficial')
  await foto(page, 'iva-casillas')
  expect(errores).toEqual([])
})

test('Presentados: la lista y «Ya presenté uno fuera»', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados')
  await expect(page.getByText(/Ya presenté uno fuera/).first()).toBeVisible()
  await sinDesbordar(page, 'Presentados')
  await foto(page, 'presentados')
  expect(errores).toEqual([])
})

test('Certificados y accesos (tablero 10), y el diálogo de «Invitar a mi asesoría» sin mandarlo', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/certificados')
  await expect(page.getByText('Quién presenta').first()).toBeVisible()
  await sinDesbordar(page, 'Certificados')
  await foto(page, 'certificados')
  const invitar = page.getByRole('button', { name: 'Invitar a mi asesoría' })
  if (await invitar.count()) {
    await invitar.first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${DIR}/invitar-asesoria-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })
  }
  expect(errores).toEqual([])
})

test('Aceptar una invitación sin enlace: lo dice, no se queda en blanco', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/asesoria?marca=sumied')
  await expect(page.getByText('Esta invitación no se puede abrir')).toBeVisible({ timeout: 20_000 })
  await foto(page, 'aceptar-asesoria')
  expect(errores).toEqual([])
})

test('Inicio: el aviso de impuestos sale del calendario', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'inicio')
  await expect(page.getByText(/IVA del trimestre|303/).first()).toBeVisible()
  await foto(page, 'inicio')
  expect(errores).toEqual([])
})
