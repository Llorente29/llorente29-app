/// <reference lib="dom" />
// tests/e2e/conta/i01c/justificantes.spec.ts
//
// I01c · P1 · «Subir justificantes» en Impuestos › Presentados, con la marca
// Sumied, en ordenador y móvil. Con justificantes INVENTADOS de la empresa A
// (tests/conta/fixtures/justificantes/pdfJustificante.mjs), generados aquí: ni
// un PDF real en el repositorio, en staging ni en las capturas.
//
// El ordenador y el móvil corren a la vez en el mismo carril: cada uno con su
// año (el ordenador, 2025; el móvil, los mismos datos en 2024), para que cada
// uno tenga su repaso y sus diferencias sin pisarse. Y nunca 2026: el 3T de
// 2026 de A es el de la e2e del I01b («No se puede calcular todavía»).
//
// Lo que prepara, SOLO DENTRO DE SU CARRIL, como el administrador de A (lo que
// haría la pantalla): Impuestos encendido (como la plataforma del carril) y el
// 303 del 4T calculado con [27], [45] y [110] escritas a mano, para que al
// subir su justificante salgan las diferencias casilla a casilla.
//
// Recorre: subir 5 justificantes + una factura + un PDF sin texto → el repaso
// (Leído · No se pudo leer, las diferencias del 4T) → «Escribirlo a mano» (se
// abre y se cancela) → «Confirmar y guardar 5» → Presentados con lo subido, y
// el mensaje con contenido → otra vez el mismo: «Ya estaba» → el 4T en Modelo
// oficial, «Del justificante de Hacienda».

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf, otroDocumentoPdf, sinTextoPdf } from '../../../conta/fixtures/justificantes/pdfJustificante.mjs'

test.skip(CARRIL === null, 'Subir justificantes necesita su carril: escribe declaraciones de la empresa A.')

const DIR = 'docs/conta/capturas/i01c'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const anoDe = (page: Page) => (lado(page) === 'movil' ? 2024 : 2025)

type J = { modelo: string; ejercicio: number; periodo: string; presentada: string; csv: string; justificante: string; casillas: Record<string, number> }

/** Los justificantes de 2025, llevados a otro año (fechas, CSV y número cambian con él). */
function delAno(ano: number): Record<string, J> {
  const d = ano - 2025
  return Object.fromEntries(Object.entries(JUSTIFICANTES_A as Record<string, J>).map(([k, j]) => {
    const [f, h] = j.presentada.split(' ')
    const [dd, mm, aa] = f.split('-')
    return [k, { ...j, ejercicio: j.ejercicio + d, presentada: `${dd}-${mm}-${Number(aa) + d} ${h}`,
      csv: j.csv.replace('2025', String(ano)).replace(/^PRUEBA/, d ? 'PRUEBB' : 'PRUEBA'), justificante: j.justificante.replace(/^999/, d ? '998' : '999') }]
  }))
}

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
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e I01c (carril)' },
    'resolution=merge-duplicates,return=minimal')
  const a = await pedirSesion(CUENTA_A.email)
  const empresas = await api(a, 'GET', `company?account_id=eq.${CUENTA_A.id}&select=id&order=created_at&limit=1`) as { id: string }[]
  expect(empresas.length, 'la cuenta A del carril no tiene empresa').toBe(1)
  empresa = empresas[0].id
})

test.afterAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: false, source: 'manual_grant', grant_reason: 'e2e I01c (carril): se apaga al acabar' },
    'resolution=merge-duplicates,return=minimal')
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
async function sinDesbordar(page: Page, donde: string) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, `${donde}: la página se sale ${sobra} px por la derecha`).toBeLessThanOrEqual(1)
}
const pdf = (nombre: string, bytes: ArrayBuffer) => ({ name: nombre, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })

test('Subir justificantes: leer, repasar con sus diferencias, guardar, y Presentados con lo subido', async ({ page }) => {
  const errores = vigilar(page)
  const ano = anoDe(page)
  const js = delAno(ano)
  // El 4T de este año, calculado por Sumied con casillas escritas a mano (sin libro de IVA ese año).
  const a = await pedirSesion(CUENTA_A.email)
  const c = await api(a, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: empresa, p_year: ano, p_period: '4T' }) as { declaracion: string }
  await api(a, 'POST', 'rpc/conta_impuesto_casillas_poner', { p_return: c.declaracion, p_casillas: { '27': 5900, '45': 5400, '110': 2000 }, p_motivo: 'e2e I01c: lo que habría calculado Sumied' })

  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados')
  await page.getByRole('button', { name: 'Subir justificantes' }).click()
  await expect(page.getByText('Arrastra aquí los justificantes en PDF')).toBeVisible()
  await foto(page, 'subir-zona')

  await page.getByLabel('Elegir los justificantes en PDF').setInputFiles([
    pdf(`303-3T-${ano}.pdf`, justificantePdf(js['303-3T-2025'])), pdf(`303-4T-${ano}.pdf`, justificantePdf(js['303-4T-2025'])),
    pdf(`111-3T-${ano}.pdf`, justificantePdf(js['111-3T-2025'])), pdf(`115-3T-${ano}.pdf`, justificantePdf(js['115-3T-2025'])),
    pdf(`202-3P-${ano}.pdf`, justificantePdf(js['202-3P-2025'])), pdf('factura-proveedor.pdf', otroDocumentoPdf()), pdf('escaneado.pdf', sinTextoPdf()),
  ])
  const tabla = page.locator('.s-justificantes-tabla')
  await expect(tabla.getByText('Leído', { exact: true })).toHaveCount(5, { timeout: 30_000 })
  await expect(tabla.getByText('No se pudo leer', { exact: true })).toHaveCount(2)
  await expect(tabla.getByText(`IVA del trimestre · 3T ${ano}`)).toBeVisible()
  await expect(tabla.getByText(`modelo 303 · −1.761,96 € a compensar · presentado el 20/10/${ano}`)).toBeVisible()
  await expect(tabla.getByText(`Pago a cuenta de sociedades · 3.er pago ${ano}`)).toBeVisible()
  await expect(tabla.getByText('El PDF no tiene texto (parece escaneado o una foto): Sumied solo lee el justificante que descarga la Sede.')).toBeVisible()
  await expect(tabla.getByText(/^No se encuentra el modelo/)).toBeVisible()
  // El 4T: Sumied lo había calculado, y dice qué casillas no coinciden.
  await expect(tabla.getByText(/casillas distintas de lo que calculó Sumied/)).toBeVisible()
  await expect(tabla.getByText(/^Sumied lo había calculado y \d+ casillas no coinciden\.$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar y guardar 5' })).toBeEnabled()
  await sinDesbordar(page, 'Subir justificantes · repaso')
  await foto(page, 'subir-repaso')
  // Las diferencias, de cerca.
  await tabla.locator('tr', { hasText: `IVA del trimestre · 4T ${ano}` }).screenshot({ path: `${DIR}/subir-diferencias-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })

  // El que no se pudo leer: escribirlo a mano (se abre, se ve y se cancela).
  await tabla.locator('tr', { hasText: 'escaneado.pdf' }).getByRole('button', { name: 'Escribirlo a mano' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Escribirlo a mano' })
  await expect(dialogo.getByLabel('Por qué a mano')).toHaveValue(/^El PDF no se pudo leer: El PDF no tiene texto/)
  await foto(page, 'subir-a-mano')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Confirmar y guardar 5' }).click()
  const hecho = page.locator('.s-impuestos-hecho, .s-impuestos-fallo').first()
  await expect(hecho).toHaveText(new RegExp(`^Guardados 5 justificantes: IVA del trimestre · 3T ${ano}, IVA del trimestre · 4T ${ano}, Retenciones · 3T ${ano}, Alquiler · 3T ${ano}, Pago a cuenta de sociedades · 3\\.er pago ${ano}\\. Otros 2 no se han guardado`), { timeout: 60_000 })
  // Presentados, con lo subido: el CSV y su PDF.
  for (const k of ['303-3T-2025', '303-4T-2025', '111-3T-2025', '115-3T-2025', '202-3P-2025']) await expect(page.getByText(js[k].csv)).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(js['303-3T-2025'].csv) }).getByRole('button', { name: 'PDF ↗' })).toBeVisible()
  await sinDesbordar(page, 'Presentados con lo subido')
  await foto(page, 'presentados-subidos')

  // Otra vez el mismo: «Ya estaba», y nada que guardar.
  await page.getByRole('button', { name: 'Subir justificantes' }).click()
  await page.getByLabel('Elegir los justificantes en PDF').setInputFiles([pdf(`303-3T-${ano}.pdf`, justificantePdf(js['303-3T-2025']))])
  await expect(page.locator('.s-justificantes-tabla').getByText('Ya estaba', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Nada que guardar todavía.')).toBeVisible()

  // El 4T en el Modelo oficial: las casillas del justificante, y dicho.
  await ir(page, `impuestos/iva/${ano}/4T`)
  await page.getByRole('tab', { name: /Modelo oficial/ }).click()
  await expect(page.getByText('Del justificante de Hacienda').first()).toBeVisible()
  await expect(page.getByText('1.631,96 €').first()).toBeVisible()
  await sinDesbordar(page, 'IVA del 4T subido · Modelo oficial')
  await foto(page, 'iva-subido-casillas')
  expect(errores, errores.join('\n')).toEqual([])
})
