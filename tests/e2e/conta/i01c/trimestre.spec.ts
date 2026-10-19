// tests/e2e/conta/i01c/trimestre.spec.ts
//
// I01c · Impuestos › Trimestre (maqueta_303_v2), con la marca Sumied, en
// ordenador y en móvil, contra staging-conta. Ningún dato real: cifras
// inventadas con la forma del caso del 19/10.
//
// Lo que se mira:
//   · la pestaña «Trimestre» abre el último trimestre acabado;
//   · la tira del trimestre con el selector 1T…4T y, por modelo (303, 111,
//     115 y 202), su estado, importe y fecha; el 202 del 2T dice «No toca»;
//   · la cartera del 303, sacada de los 303 presentados: 1.500,00 pendientes,
//     el 1T sale a compensar 1.200,50, el 2T aplica 400,25 → la [110] del 3T,
//     2.300,25, y la línea de que casa;
//   · el borrador del 3T calculado ANTES de apuntar el 1T y el 2T (la [110]
//     desfasada, como el de producción el 19/10) se vuelve a calcular al abrir,
//     y la pantalla lo dice con la cifra (regla 8);
//   · al pulsar un modelo, su ficha con el PDF del justificante;
//   · la empresa por la ruta (impuestos/empresa/<id>/trimestre/…): la vista de
//     despacho. Por eso la prueba crea su propia empresa en la cuenta A, que
//     además no pisa los periodos de 2026 de la empresa A que usan
//     justificantes.spec.ts y la e2e del I01b. Se borra al acabar.

import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { justificantePdf } from '../../../conta/fixtures/justificantes/pdfJustificante.mjs'

test.skip(CARRIL === null, 'El trimestre necesita su carril: escribe declaraciones en la cuenta A.')

const DIR = 'docs/conta/capturas/i01c'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

/** Los dos 303 presentados, inventados (las casillas cuadran entre sí). */
const presentado = (nif: string, l: 'ordenador' | 'movil', periodo: '1T' | '2T') => {
  const s = l === 'ordenador' ? 'O' : 'M'
  return periodo === '1T'
    ? { modelo: '303', ejercicio: 2026, periodo, presentada: '20-04-2026 10:06:28', csv: `PRUEBTRIM${s}1T2026`.slice(0, 16), justificante: `99830${s === 'O' ? 1 : 2}0002601`, nif,
        resultado: -1200.5, casillas: { '27': 5000, '45': 6200.5, '46': -1200.5, '64': -1200.5, '65': 100, '66': -1200.5, '110': 1500, '78': 0, '87': 1500, '69': -1200.5, '71': -1200.5 } }
    : { modelo: '303', ejercicio: 2026, periodo, presentada: '20-07-2026 10:51:15', csv: `PRUEBTRIM${s}2T2026`.slice(0, 16), justificante: `99830${s === 'O' ? 1 : 2}0002602`, nif,
        resultado: 0, casillas: { '27': 8000, '45': 7599.75, '46': 400.25, '64': 400.25, '65': 100, '66': 400.25, '110': 2700.5, '78': 400.25, '87': 2300.25, '69': 0, '71': 0 } }
}
const iso = (dmy: string) => { const [f, h] = dmy.split(' '); const [d, m, y] = f.split('-'); return `${y}-${m}-${d}T${h}` }

async function crearEmpresa(s: Sesion, l: string): Promise<{ id: string; nif: string }> {
  const nif = cifInventado()
  const [c] = await api<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Trimestre e2e ${l}, S.L.`, tax_id: nif, tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  await api(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: c.id, tax_territory: 'peninsula_baleares', tax_forms: ['303', '111', '115'] })
  await api(s, 'POST', 'rpc/conta_impuesto_obligaciones_calcular', { p_company: c.id })
  // Lo que la regla no ponga (de los cuatro de la tira) lo decide una persona; lo que ya está, no
  // se vuelve a decidir: «El 111 ya está en la lista» (e2e 658, las respuestas del alta ya lo traen).
  const hay = (await api<{ form_code: string }[]>(s, 'GET', `tax_obligation?company_id=eq.${c.id}&valid_to=is.null&active=is.true&select=form_code`)).map((o) => o.form_code)
  for (const m of ['303', '111', '115', '202'].filter((x) => !hay.includes(x))) {
    await api(s, 'POST', 'rpc/conta_impuesto_obligacion_decidir', { p_company: c.id, p_form: m, p_presenta: true, p_motivo: 'Prueba e2e del trimestre.' })
  }
  return { id: c.id, nif }
}

/** Sube el PDF del justificante y lo enlaza con su declaración, como hace la pantalla. */
async function conPdf(s: Sesion, declaracion: string, cuenta: string, j: ReturnType<typeof presentado>) {
  const bytes = Buffer.from(justificantePdf(j))
  const huella = createHash('sha256').update(bytes).digest('hex')
  const ruta = `${cuenta}/impuestos/${declaracion}/${huella}.pdf`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/conta-documentos/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' }, body: bytes,
  })
  if (!r.ok && !/exists|Duplicate/i.test(await r.text())) throw new Error(`No se ha podido subir el PDF: HTTP ${r.status}`)
  await api(s, 'POST', 'rpc/conta_impuesto_justificante_guardar', { p_return: declaracion, p_ruta: ruta, p_huella: huella, p_tamano: bytes.length })
}

/** Enciende o apaga Impuestos en la cuenta A (como csv.spec.ts: la plataforma, y sin duplicar). */
async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e I01c trimestre (carril)' : 'e2e I01c trimestre (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

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
  await page.goto(`/conta/${ruta}?marca=sumied`)
  await cargada(page)
}
const foto = (page: Page, nombre: string) =>
  page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
async function sinDesbordar(page: Page, donde: string) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, `${donde}: la página se sale ${sobra} px por la derecha`).toBeLessThanOrEqual(1)
}
const fila = (page: Page, texto: string) => page.locator('[data-prueba="cartera"] tr').filter({ hasText: texto })

test('La pestaña Trimestre abre el último trimestre acabado', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/calendario')
  await page.getByRole('link', { name: 'Trimestre', exact: true }).first().click()
  await expect(page).toHaveURL(/\/conta\/impuestos\/trimestre\/\d{4}\/[1-4]T/)
  await expect(page.getByRole('heading', { name: /^El trimestre/ })).toBeVisible()
  await expect(page.locator('[data-prueba="cartera"]')).toBeVisible({ timeout: 20_000 })
  expect(errores).toEqual([])
})

test('Trimestre de una empresa por la ruta: la tira, la cartera de los 303 presentados y el borrador puesto al día', async ({ page }) => {
  const errores = vigilar(page)
  const l = lado(page)
  const s = await pedirSesion(CUENTA_A.email)
  const e = await crearEmpresa(s, l)
  try {
    // El borrador del 3T, calculado ANTES de tener el 1T y el 2T: sin la [110] que le toca.
    await api(s, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: e.id, p_year: 2026, p_period: '3T' })
    const j1 = presentado(e.nif, l, '1T')
    const j2 = presentado(e.nif, l, '2T')
    await api(s, 'POST', 'rpc/conta_impuesto_justificante_apuntar', { p_company: e.id, p_datos: { ...j1, presentada: iso(j1.presentada) } })
    const a2 = await api<{ declaracion: string; cuenta: string }>(s, 'POST', 'rpc/conta_impuesto_justificante_apuntar', { p_company: e.id, p_datos: { ...j2, presentada: iso(j2.presentada) } })
    await conPdf(s, a2.declaracion, a2.cuenta, j2)
    const antes = await api<{ cartera: { desfasada: boolean } }>(s, 'POST', 'rpc/conta_impuesto_trimestre', { p_company: e.id, p_year: 2026, p_quarter: 3 })
    expect(antes.cartera.desfasada, 'el borrador del 3T tendría que estar desfasado antes de abrir la pantalla').toBe(true)

    await entrarComo(page, CUENTA_A.email)
    await ir(page, `impuestos/empresa/${e.id}/trimestre/2026/3T`)
    await expect(page.getByRole('heading', { name: `El trimestre · Trimestre e2e ${l}, S.L.` })).toBeVisible()

    // Se pone al día solo, y lo dice con la cifra.
    await expect(page.getByRole('status').filter({ hasText: 'Vuelto a calcular el 3T' }))
      .toHaveText(/^Vuelto a calcular el 3T: ahora trae la \[110\] 2\.300,25 €, lo que dejó el 2T\/2026\./, { timeout: 30_000 })

    // La tira: los cuatro modelos, en su orden.
    const tira = page.getByRole('list', { name: 'Modelos del 3.er trimestre 2026' })
    await expect(tira.getByRole('button')).toHaveCount(4)
    await expect(tira.getByRole('button').nth(0)).toContainText('IVA · 303')
    await expect(tira.getByRole('button').nth(1)).toContainText('Retenciones · 111')
    await expect(tira.getByRole('button').nth(2)).toContainText('Alquiler · 115')
    await expect(tira.getByRole('button').nth(3)).toContainText('Sociedades · 202')
    await expect(tira.getByRole('button').nth(1)).toContainText('Hasta el 20/10')
    await expect(page.getByRole('radio', { name: '3T' })).toHaveAttribute('aria-checked', 'true')

    // La cartera, de los 303 presentados.
    await expect(fila(page, 'Pendiente de 2025')).toContainText('1.500,00 €')
    await expect(fila(page, '1T 2026 · salió a compensar')).toContainText('1.200,50 €')
    await expect(fila(page, '2T 2026 · aplicado')).toContainText('−400,25 €')
    await expect(fila(page, 'Pendiente al empezar el 3T')).toContainText('2.300,25 €')
    await expect(page.getByText('✓ Las cuotas a compensar casan con los 303 anteriores')).toBeVisible()
    await sinDesbordar(page, 'Trimestre 3T')
    await foto(page, 'trimestre-3t')

    // En la base, el borrador ya trae la [110].
    const despues = await api<{ cartera: { desfasada: boolean; borrador: { c110: number } } }>(s, 'POST', 'rpc/conta_impuesto_trimestre', { p_company: e.id, p_year: 2026, p_quarter: 3 })
    expect([despues.cartera.desfasada, Number(despues.cartera.borrador.c110)]).toEqual([false, 2300.25])

    // El 2T: el 202 no toca, y la ficha del 303 con su PDF.
    await page.getByRole('radio', { name: '2T' }).click()
    await expect(page).toHaveURL(new RegExp(`/impuestos/empresa/${e.id}/trimestre/2026/2T`))
    const tira2 = page.getByRole('list', { name: 'Modelos del 2.º trimestre 2026' })
    await expect(tira2.getByRole('button').filter({ hasText: 'Sociedades · 202' })).toContainText('No toca este trimestre')
    await tira2.getByRole('button').filter({ hasText: 'IVA · 303' }).click()
    const ficha = page.locator('[data-prueba="ficha-modelo"]')
    await expect(ficha.getByRole('heading', { name: 'IVA · 303 · 2T 2026' })).toBeVisible()
    await expect(ficha.getByText('Presentado 20/07')).toBeVisible()
    await expect(ficha.locator('[data-prueba="resultado-ficha"]')).toContainText('0,00 €')
    await expect(ficha.getByText(j2.csv)).toBeVisible()
    await expect(ficha.locator('iframe.s-csv-pdf-visor')).toBeVisible({ timeout: 20_000 })
    await expect(ficha.getByRole('link', { name: 'Abrir el PDF ↗' })).toBeVisible()
    await sinDesbordar(page, 'Ficha del 303 del 2T')
    await foto(page, 'trimestre-ficha')

    // Otro modelo: su ficha, sin declaración, dice su plazo.
    await tira2.getByRole('button').filter({ hasText: 'Retenciones · 111' }).click()
    await expect(ficha.getByRole('heading', { name: 'Retenciones · 111 · 2T 2026' })).toBeVisible()
    await expect(ficha.getByText(/Aún no está en Sumied\. Se presenta hasta el/)).toBeVisible()
    expect(errores).toEqual([])
  } finally {
    const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${e.id}&account_id=eq.${CUENTA_A.id}`)
    expect(b.status, `Borrar la empresa de prueba: ${JSON.stringify(b.datos)}`).toBeLessThan(300)
    expect((b.datos ?? []).length, 'la empresa de prueba no se ha borrado (RLS)').toBe(1)
  }
})
