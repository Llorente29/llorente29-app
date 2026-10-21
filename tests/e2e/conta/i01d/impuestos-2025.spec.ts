// tests/e2e/conta/i01d/impuestos-2025.spec.ts
//
// I01d · Cargar los impuestos de 2025 (Julio, 21/10), con la marca Sumied, en
// ordenador y en móvil, contra staging-conta. En el Trimestre de 2025, cada
// periodo sin cargar sale «Sin cargar · Pegar CSV»; «Pegar CSV» abre el mismo
// «pegar CSV» de Presentados; Sumied trae el PDF de Hacienda y rellena las
// casillas. La función conta-justificante-csv, fuera de producción, usa SIEMPRE
// el doble: el PDF INVENTADO que esta prueba deja en <cuenta>/doble-aeat/<CSV>.pdf.
// Ninguna llamada a Hacienda, ningún dato real: CSV, NIF de la gestoría y cifras
// inventados.
//
// En la cuenta D del carril (Asesoría de Prueba Oeste, NIF inventado), que
// presenta el 303 y cuyos impuestos no escribe ninguna otra e2e: la empresa A ya
// tiene el 4T de 2025 y el 1T de 2026 de justificantes.spec.ts.
//   · ordenador: el 303 del 4T de 2025 sin cargar → pegar su CSV → presentado;
//     y en el 1T de 2026, lo pendiente de 2025 sale de ese 4T (no de un número
//     escrito); con el 1T cargado también, casan.
//   · móvil: el 303 del 3T de 2025 sin cargar → pegar su CSV → presentado; y en
//     la cartera del 4T, el 1T y el 2T de 2025 dicen «sin cargar».

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_D, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf } from '../../../conta/fixtures/justificantes/pdfJustificante.mjs'

test.skip(CARRIL === null, 'Cargar 2025 necesita su carril: escribe declaraciones de la cuenta D.')

const DIR = 'docs/conta/capturas/i01d'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

type J = { modelo: string; ejercicio: number; periodo: string; presentada: string; csv: string; justificante: string; nif: string; nombre: string; casillas: Record<string, number> }
const BASE = JUSTIFICANTES_A as Record<string, J>
const deD = (k: string, nif: string, c: Partial<J>): J => ({ ...BASE[k], nif, nombre: 'ASESORIA DE PRUEBA OESTE, S.L.', ...c })

/** El 4T de 2025 deja 1.631,96 € a compensar ([87]); el 1T de 2026 empieza con esa [110] y aplica 300,00. */
const justificantes = (nif: string) => ({
  t4: deD('303-4T-2025', nif, { csv: 'PRUEBI01D4T2025O', justificante: '9963030000014' }),
  t1: deD('303-4T-2025', nif, { ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 10:00:00', csv: 'PRUEBI01D1T2026O', justificante: '9963030000021',
    casillas: { ...BASE['303-4T-2025'].casillas, '04': 59700, '06': 5970, '27': 6001.5, '46': 300, '64': 300, '66': 300, '110': 1631.96, '78': 300, '87': 1331.96, '69': 0, '71': 0 } }),
  t3: deD('303-3T-2025', nif, { csv: 'PRUEBI01D3T2025M', justificante: '9963030000013' }),
})

let empresa = { id: '', nif: '' }

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

/** Deja un PDF inventado donde lo busca el doble. Si ya estaba (el almacén sobrevive entre runs), se queda: mismo CSV, mismos datos. */
async function alDoble(s: Sesion, j: J) {
  const r = await fetch(`${STAGING_URL}/storage/v1/object/conta-documentos/${CUENTA_D.id}/doble-aeat/${j.csv}.pdf`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
    body: Buffer.from(justificantePdf(j)),
  })
  if (!r.ok && r.status !== 409 && !/exists|Duplicate/i.test(await r.text())) throw new Error(`No se ha podido dejar el PDF en el doble: HTTP ${r.status}`)
}

test.beforeAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_D.id, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e I01d 2025 (carril)' },
    'resolution=merge-duplicates,return=minimal')
  const d = await pedirSesion(CUENTA_D.email)
  const empresas = await api(d, 'GET', `company?account_id=eq.${CUENTA_D.id}&select=id,tax_id&order=created_at&limit=1`) as { id: string; tax_id: string }[]
  expect(empresas.length, 'la cuenta D del carril no tiene empresa').toBe(1)
  empresa = { id: empresas[0].id, nif: empresas[0].tax_id }
  const j = justificantes(empresa.nif)
  for (const x of [j.t4, j.t1, j.t3]) await alDoble(d, x)
})

test.afterAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: CUENTA_D.id, feature_key: 'conta_impuestos', enabled: false, source: 'manual_grant', grant_reason: 'e2e I01d 2025 (carril): se apaga al acabar' },
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
const tarjeta303 = (page: Page) => page.locator('.s-trimestre-tira').getByRole('button').filter({ hasText: 'IVA · 303' })
const filaCartera = (page: Page, texto: string) => page.locator('[data-prueba="cartera"] tr').filter({ hasText: texto })

/** «Sin cargar · Pegar CSV» → «Pegar CSV» → el CSV → «Traer de Hacienda» → la ficha → «Guardar en Presentados». */
async function pegar(page: Page, j: J, nombre: string) {
  await expect(tarjeta303(page)).toContainText('Sin cargar · Pegar CSV')
  const ficha = page.locator('[data-prueba="ficha-modelo"]')
  await expect(ficha.locator('[data-prueba="sin-cargar"]')).toContainText('Se presentó fuera, antes de llevar los impuestos en Sumied.')
  await expect(page.locator('[data-prueba="que-falta"]')).toContainText('Sin cargar')
  await sinDesbordar(page, `${j.periodo} ${j.ejercicio} sin cargar`)
  await foto(page, `${nombre}-sin-cargar`)

  await ficha.getByRole('button', { name: 'Pegar CSV' }).click()
  const campo = page.getByLabel('CSV del justificante')
  await expect(campo).toBeVisible()
  await campo.fill(j.csv)
  await page.getByRole('button', { name: 'Traer de Hacienda' }).click()
  const traida = page.locator('[data-prueba="ficha-traida"]')
  await expect(traida).toBeVisible({ timeout: 30_000 })
  await expect(traida.getByText('Traído de Hacienda')).toBeVisible()
  await expect(traida.getByText(`IVA del trimestre · ${j.periodo} ${j.ejercicio}`)).toBeVisible()
  await expect(traida.getByText(j.csv)).toBeVisible()
  await expect(traida.getByText(`${Object.keys(j.casillas).length} casillas del impreso`)).toBeVisible()
  await sinDesbordar(page, `${j.periodo} ${j.ejercicio} traído`)
  await foto(page, `${nombre}-traido`)
  await page.getByRole('button', { name: 'Guardar en Presentados' }).click()
  await expect(page.locator('.s-impuestos-hecho')).toHaveText(/^Apuntado el 303 del .* como presentado fuera, con \d+ casillas\./, { timeout: 30_000 })
  // Se vuelve a leer el trimestre: ya está presentado, con su CSV.
  await expect(tarjeta303(page)).toContainText('Presentado', { timeout: 20_000 })
  await expect(ficha).toContainText(j.csv)
}

test('2025 en el Trimestre: «Sin cargar · Pegar CSV», se pega el CSV y queda presentado; la cartera de 2026 sale del 4T de 2025', async ({ page }) => {
  const errores = vigilar(page)
  const j = justificantes(empresa.nif)
  await entrarComo(page, CUENTA_D.email)

  if (lado(page) === 'ordenador') {
    // El año se elige en el selector del Trimestre: 2025.
    await ir(page, 'impuestos/trimestre/2026/4T')
    await page.getByLabel('Ejercicio').selectOption('2025')
    await expect(page).toHaveURL(/\/impuestos\/trimestre\/2025\/4T/)
    await cargada(page)
    await pegar(page, j.t4, 'i01d-4t-2025')
    await sinDesbordar(page, '4T 2025 presentado')
    await foto(page, 'i01d-4t-2025-presentado')

    // El 1T de 2026, sin cargar: lo pendiente de 2025 sale del 4T que se acaba de pegar.
    await ir(page, 'impuestos/trimestre/2026/1T')
    await expect(filaCartera(page, 'Pendiente de 2025')).toContainText('1.631,96 €')
    await expect(filaCartera(page, 'Pendiente de 2025')).toContainText('Lo que dejó el 303 del 4T de 2025.')
    await expect(filaCartera(page, 'Pendiente al empezar el 1T')).toContainText('1.631,96 €')
    // Con el 1T cargado también, su [110] casa con lo que dejó el 4T.
    await pegar(page, j.t1, 'i01d-1t-2026')
    await expect(filaCartera(page, 'Pendiente de 2025')).toContainText('Lo que dejó el 303 del 4T de 2025.')
    await expect(page.getByText('✓ Las cuotas a compensar casan con los 303 anteriores')).toBeVisible()
    await sinDesbordar(page, '1T 2026 con la cartera')
    await foto(page, 'i01d-1t-2026-cartera')
  } else {
    await ir(page, 'impuestos/trimestre/2025/3T')
    await pegar(page, j.t3, 'i01d-3t-2025')
    // En el 4T de 2025, la cartera dice lo que falta: el 1T y el 2T sin cargar.
    await ir(page, 'impuestos/trimestre/2025/4T')
    await expect(filaCartera(page, '1T 2025 · sin cargar')).toContainText('Pega su CSV para que la cartera siga.')
    await expect(filaCartera(page, '2T 2025 · sin cargar')).toBeVisible()
    await sinDesbordar(page, 'Cartera del 4T de 2025')
    await foto(page, 'i01d-4t-2025-cartera')
  }
  // Ningún texto de la pantalla dice «papel».
  expect((await page.locator('main, .s-pantalla').first().innerText()).toLowerCase()).not.toContain('papel')
  expect(errores).toEqual([])
})
