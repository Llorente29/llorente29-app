// tests/e2e/conta/i01c/csv.spec.ts
//
// I01c · P1 definitiva · «Ya presenté uno fuera · pegar CSV», con la marca
// Sumied, en ordenador y en móvil, contra staging-conta. La función
// conta-justificante-csv, fuera de producción, usa SIEMPRE el doble: el PDF
// INVENTADO que esta prueba deja en <cuenta>/doble-aeat/<CSV>.pdf. Ninguna
// llamada a Hacienda, ningún dato real.
//
// Lo que se mira:
//   · el campo grande arriba con «Traer de Hacienda»: un CSV sin la forma no se
//     manda (no gasta un intento del día de la AEAT) y se dice por qué;
//   · mientras trae, el indicador; al terminar, la ficha rellena (modelo,
//     periodo, fecha y hora, justificante, expediente, presentador, resultado y
//     casillas) con el PDF al lado; se guarda y sale en Presentados «traído de
//     Hacienda por su CSV»;
//   · ordenador: un CSV que Hacienda no tiene, y uno de OTRA empresa: se dice y
//     no se guarda nada; y un REIMPRESO subido en PDF: se saca su CSV, se trae
//     el original y se guarda;
//   · móvil: un 303 que sale a 0,00 € porque compensó con trimestres
//     anteriores: «0,00 €» y debajo lo compensado, en la ficha y en Presentados.
//
// Periodos que no pisa nadie: justificantes.spec.ts usa los 303 del 3T y 4T de
// 2025 y del 1T de 2026, y sus 111, 115 y 202; la e2e del I01b, el 2T y el 3T
// de 2026. Aquí: el 111 y el 115 del 4T de 2025 (ordenador) y el 303 del 4T de
// 2024 y el 111 del 2T de 2026 (móvil).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf } from '../../../conta/fixtures/justificantes/pdfJustificante.mjs'

test.skip(CARRIL === null, 'Traer por CSV necesita su carril: escribe declaraciones de la empresa A.')

const DIR = 'docs/conta/capturas/i01c'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

type J = { modelo: string; ejercicio: number; periodo: string; presentada: string; csv: string; justificante: string; nif?: string; casillas: Record<string, number> }
const BASE = JUSTIFICANTES_A as Record<string, J>
const con = (k: string, c: Partial<J>): J => ({ ...BASE[k], ...c })

const ORDENADOR = {
  pegado: con('111-3T-2025', { periodo: '4T', presentada: '20-01-2026 10:05:12', csv: 'PRUEBC111T4CCCCC', justificante: '9971110000004' }),
  reimpreso: con('115-3T-2025', { periodo: '4T', presentada: '20-01-2026 10:06:30', csv: 'PRUEBC115T4DDDDD', justificante: '9971150000004' }),
  // El de otra empresa: otro NIF en el impreso.
  otra: con('111-3T-2025', { periodo: '2T', presentada: '20-07-2025 10:05:12', csv: 'PRUEBCOTRAEMPRES', justificante: '9971110000002', nif: 'B12345674' }),
  noEsta: 'PRUEBCNOESTAAQUI',
}
const MOVIL = {
  // El 303 que sale a cero porque compensó 647,28 € de trimestres anteriores.
  compensado: con('303-4T-2025', { ejercicio: 2024, periodo: '4T', presentada: '30-01-2025 09:15:07', csv: 'PRUEBD4T2024BBBB', justificante: '9963030000004',
    casillas: { ...BASE['303-4T-2025'].casillas, '46': 647.28, '64': 647.28, '66': 647.28, '110': 2000, '78': 647.28, '87': 1352.72, '69': 0, '71': 0 } }),
  pegado: con('111-3T-2025', { ejercicio: 2026, periodo: '2T', presentada: '20-07-2026 10:05:12', csv: 'PRUEBD111T2CCCCC', justificante: '9961110000002' }),
}

let empresa = ''
let sesionA: Sesion

/** Deja un PDF inventado donde lo busca el doble de conta-justificante-csv (si ya estaba, igual: es el mismo). */
async function alDoble(s: Sesion, j: J) {
  const r = await fetch(`${STAGING_URL}/storage/v1/object/conta-documentos/${CUENTA_A.id}/doble-aeat/${j.csv}.pdf`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
    body: Buffer.from(justificantePdf(j)),
  })
  if (!r.ok && r.status !== 409 && !/exists|Duplicate/i.test(await r.text())) throw new Error(`No se ha podido dejar el PDF en el doble: HTTP ${r.status}`)
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

test.beforeAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e I01c CSV (carril)' },
    'resolution=merge-duplicates,return=minimal')
  sesionA = await pedirSesion(CUENTA_A.email)
  const empresas = await api(sesionA, 'GET', `company?account_id=eq.${CUENTA_A.id}&select=id&order=created_at&limit=1`) as { id: string }[]
  expect(empresas.length, 'la cuenta A del carril no tiene empresa').toBe(1)
  empresa = empresas[0].id
  for (const j of [ORDENADOR.pegado, ORDENADOR.reimpreso, ORDENADOR.otra, MOVIL.compensado, MOVIL.pegado]) await alDoble(sesionA, j)
})

test.afterAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: false, source: 'manual_grant', grant_reason: 'e2e I01c CSV (carril): se apaga al acabar' },
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
/** Cuántas veces se llama a la función (un CSV sin forma no puede llamarla). */
function contarLlamadas(page: Page) {
  const n = { v: 0 }
  page.on('request', (r) => { if (r.url().includes('/functions/v1/conta-justificante-csv') && r.method() === 'POST') n.v++ })
  return n
}
const campo = (page: Page) => page.getByLabel('CSV del justificante')
async function traer(page: Page, csv: string) {
  await campo(page).fill(csv)
  await page.getByRole('button', { name: 'Traer de Hacienda' }).click()
}

test('Pegar el CSV: trae el original de Hacienda, la ficha con el PDF al lado, y a Presentados', async ({ page }) => {
  const errores = vigilar(page)
  const llamadas = contarLlamadas(page)
  const l = lado(page)
  const j = l === 'ordenador' ? ORDENADOR.pegado : MOVIL.pegado
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados?fuera=1')
  await expect(campo(page)).toBeVisible()
  await expect(campo(page)).toBeFocused()

  // Sin la forma: no se manda, y se dice.
  await campo(page).fill('PRUEBA 123')
  await expect(page.getByRole('button', { name: 'Traer de Hacienda' })).toBeDisabled()
  await expect(page.getByText('Son 16 letras y números, como aparecen arriba en el justificante.')).toBeVisible()
  await sinDesbordar(page, 'Pegar CSV')
  await foto(page, 'csv-pegar')
  expect(llamadas.v, 'un CSV sin forma ha llamado a la función').toBe(0)

  // Mientras trae, el indicador (la respuesta se retiene un momento para verlo).
  await page.route('**/functions/v1/conta-justificante-csv', async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.continue().catch(() => {}) })
  await campo(page).fill(j.csv.toLowerCase().replace(/(.{4})/g, '$1 '))
  await page.getByRole('button', { name: 'Traer de Hacienda' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Trayendo el justificante de Hacienda…' })).toBeVisible()
  await foto(page, 'csv-trayendo')

  // La ficha, rellena, con el PDF al lado. (La retención se quita cuando ya ha llegado: quitarla
  // con la petición retenida la daba por atendida y la respuesta no llegaba; e2e 641.)
  const ficha = page.locator('[data-prueba="ficha-traida"]')
  await expect(ficha).toBeVisible({ timeout: 30_000 })
  await page.unroute('**/functions/v1/conta-justificante-csv')
  await expect(ficha.getByText('Traído de Hacienda')).toBeVisible()
  await expect(ficha.getByText(`Retenciones · ${j.periodo} ${j.ejercicio}`)).toBeVisible()
  await expect(ficha.getByText(j.justificante)).toBeVisible()
  await expect(ficha.getByText(j.csv)).toBeVisible()
  await expect(ficha.getByText(`2026PRUEBA111${j.periodo}`)).toBeVisible()
  await expect(ficha.getByText('GESTORIA INVENTADA DE PRUEBA (00000000T)')).toBeVisible()
  // En el resultado (el importe sale también en sus casillas [28] y [30]).
  await expect(ficha.locator('[data-prueba="resultado"] .s-cifra')).toHaveText('1.702,50 €')
  await expect(ficha.locator('[data-prueba="resultado"]')).toContainText('a ingresar')
  await expect(ficha.getByText(`${Object.keys(j.casillas).length} casillas del impreso`)).toBeVisible()
  await expect(ficha.locator('iframe.s-csv-pdf-visor')).toBeVisible()
  await sinDesbordar(page, 'Ficha traída')
  await foto(page, 'csv-ficha')

  await page.getByRole('button', { name: 'Guardar en Presentados' }).click()
  await expect(page.locator('.s-impuestos-hecho')).toHaveText(/^Apuntado el 111 del .* como presentado fuera, con \d+ casillas\./, { timeout: 30_000 })
  const fila = page.getByRole('row', { name: new RegExp(j.csv) })
  await expect(fila.getByText('fuera · traído de Hacienda por su CSV')).toBeVisible()
  await expect(fila.getByRole('button', { name: 'PDF ↗' })).toBeVisible()
  expect(llamadas.v, 'una sola llamada por CSV').toBe(1)

  // Otra vez el mismo: ya está, y no se pregunta a Hacienda (la función para antes).
  await page.getByRole('button', { name: 'Ya presenté uno fuera · pegar CSV' }).click()
  await traer(page, j.csv)
  await expect(page.getByRole('alert').filter({ hasText: 'Ese justificante ya está en Presentados' })).toBeVisible({ timeout: 30_000 })
  await sinDesbordar(page, 'Presentados con lo traído')
  await foto(page, 'csv-presentados')
  expect(errores).toEqual([])
})

test('Ordenador: no está, de otra empresa, y un reimpreso subido en PDF', async ({ page }) => {
  test.skip(lado(page) !== 'ordenador', 'Los errores y el reimpreso, en ordenador; el móvil hace el 303 compensado.')
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados?fuera=1')

  // Hacienda no lo tiene.
  await traer(page, ORDENADOR.noEsta)
  await expect(page.getByRole('alert')).toHaveText('Hacienda no tiene ningún justificante con ese CSV. Revísalo letra a letra con el del PDF. No se ha guardado nada.', { timeout: 30_000 })
  await foto(page, 'csv-no-esta')

  // De otra empresa: se trae, se mira y no se guarda.
  await traer(page, ORDENADOR.otra.csv)
  await expect(page.getByRole('alert')).toHaveText(/^Ese justificante es de otra empresa\. Es de otro NIF \(B12345674\), no del de .* \(B28000016\): no se guarda\.$/, { timeout: 30_000 })
  await foto(page, 'csv-otra-empresa')
  const otra = await api(sesionA, 'GET', `tax_return?company_id=eq.${empresa}&aeat_csv=eq.${ORDENADOR.otra.csv}&select=id`) as unknown[]
  expect(otra, 'el de otra empresa ha dejado algo').toEqual([])

  // Un reimpreso: no se lee, pero su CSV sí; se trae el original.
  await page.getByLabel('Subir el PDF del justificante para sacar su CSV').setInputFiles({
    name: '115-4T-2025-reimpreso.pdf', mimeType: 'application/pdf', buffer: Buffer.from(justificantePdf(ORDENADOR.reimpreso, { reimpreso: true })),
  })
  const ficha = page.locator('[data-prueba="ficha-traida"]')
  await expect(ficha.getByText('Alquiler · 4T 2025')).toBeVisible({ timeout: 30_000 })
  await expect(campo(page)).toHaveValue(ORDENADOR.reimpreso.csv)
  await foto(page, 'csv-reimpreso')
  await page.getByRole('button', { name: 'Guardar en Presentados' }).click()
  await expect(page.getByRole('row', { name: new RegExp(ORDENADOR.reimpreso.csv) }).getByText('fuera · traído de Hacienda por su CSV')).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('Móvil: un 303 a cero que compensó con trimestres anteriores', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'El 303 compensado, en móvil.')
  const errores = vigilar(page)
  const j = MOVIL.compensado
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados?fuera=1')
  await traer(page, j.csv)
  const ficha = page.locator('[data-prueba="ficha-traida"]')
  await expect(ficha.getByText('647,28 € compensado con trimestres anteriores')).toBeVisible({ timeout: 30_000 })
  await expect(ficha.locator('[data-prueba="resultado"] .s-cifra')).toHaveText('0,00 €')
  await sinDesbordar(page, 'Ficha del 303 compensado')
  await foto(page, 'csv-compensado')
  await page.getByRole('button', { name: 'Guardar en Presentados' }).click()
  const fila = page.getByRole('row', { name: new RegExp(j.csv) })
  await expect(fila.getByText('647,28 € compensado con trimestres anteriores')).toBeVisible({ timeout: 30_000 })
  await sinDesbordar(page, 'Presentados con el 303 compensado')
  await foto(page, 'presentados-compensado')
  expect(errores).toEqual([])
})
