/// <reference lib="dom" />
// tests/e2e/conta/i01c/justificantes.spec.ts
//
// I01c · P1 · «Subir justificantes» en Impuestos › Presentados, con la marca
// Sumied, en ordenador y móvil. Con justificantes INVENTADOS de la empresa A
// (tests/conta/fixtures/justificantes/pdfJustificante.mjs), generados aquí: ni
// un PDF real en el repositorio, en staging ni en las capturas.
//
// El ordenador y el móvil corren a la vez en el mismo carril: cada uno con sus
// periodos (el ordenador, el 3T y el 4T de 2025; el móvil, el 1T de 2026),
// para que cada uno tenga su repaso y sus diferencias sin pisarse. Nunca el 2T
// ni el 3T de 2026: el 3T de A es el de la e2e del I01b, y su [110] sale del 2T.
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

import { test, expect, type Locator, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
// @ts-expect-error: módulo .mjs de las fixtures, sin tipos
import { JUSTIFICANTES_A, justificantePdf, otroDocumentoPdf, sinTextoPdf } from '../../../conta/fixtures/justificantes/pdfJustificante.mjs'

test.skip(CARRIL === null, 'Subir justificantes necesita su carril: escribe declaraciones de la empresa A.')

const DIR = 'docs/conta/capturas/i01c'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

type J = { modelo: string; ejercicio: number; periodo: string; presentada: string; csv: string; justificante: string; casillas: Record<string, number> }
const BASE = JUSTIFICANTES_A as Record<string, J>
const con = (k: string, c: Partial<J>): J => ({ ...BASE[k], ...c })

/**
 * Lo de cada lado. Sumied solo calcula un 303 cuyo plazo tiene festivos
 * cargados (2026 y 2027): el ordenador, el 4T de 2025 (vence en enero de 2026);
 * el móvil, el 1T de 2026. Nunca el 2T ni el 3T de 2026: la [110] del 3T de A
 * sale del 2T, y la e2e del I01b la quiere sin saber.
 */
interface Lado { calcular: { ano: number; periodo: string }; lista: J[]; objetivo: J; casilla87: string }
function deLado(l: 'ordenador' | 'movil'): Lado {
  if (l === 'ordenador') {
    const lista = ['303-3T-2025', '303-4T-2025', '111-3T-2025', '115-3T-2025', '202-3P-2025'].map((k) => BASE[k])
    return { calcular: { ano: 2025, periodo: '4T' }, lista, objetivo: lista[1], casilla87: '1.631,96 €' }
  }
  const lista = [
    con('303-3T-2025', { ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 11:02:41', csv: 'PRUEBB1T2026AAAA', justificante: '9983030000001' }),
    con('111-3T-2025', { ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 11:05:12', csv: 'PRUEBB111T1CCCCC', justificante: '9981110000001' }),
    con('115-3T-2025', { ejercicio: 2026, periodo: '1T', presentada: '20-04-2026 11:06:30', csv: 'PRUEBB115T1DDDDD', justificante: '9981150000001' }),
    con('202-3P-2025', { ejercicio: 2026, periodo: '1P', presentada: '20-04-2026 10:40:00', csv: 'PRUEBB2021PEEEEE', justificante: '9982020000001' }),
  ]
  return { calcular: { ano: 2026, periodo: '1T' }, lista, objetivo: lista[0], casilla87: '300,00 €' }
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
// La tarjeta recorta lo que se sale, así que la página no desborda aunque un botón
// quede cortado: se mira el botón contra el ancho de la pantalla.
async function dentroDeLaPantalla(page: Page, boton: Locator, donde: string) {
  const caja = await boton.boundingBox()
  const ancho = page.viewportSize()?.width ?? 0
  expect(caja, `${donde}: no se ve`).not.toBeNull()
  expect(Math.round((caja?.x ?? 0) + (caja?.width ?? 0)), `${donde}: se sale por la derecha`).toBeLessThanOrEqual(ancho)
}
const pdf = (nombre: string, bytes: ArrayBuffer) => ({ name: nombre, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })

test('Subir justificantes: leer, repasar con sus diferencias, guardar, y Presentados con lo subido', async ({ page }) => {
  const errores = vigilar(page)
  const { calcular, lista, objetivo, casilla87 } = deLado(lado(page))
  const n = lista.length
  const nombre = (j: J) => `${j.modelo}-${j.periodo}-${j.ejercicio}.pdf`
  // El 303 objetivo, calculado por Sumied con casillas escritas a mano (sin libro de IVA en ese periodo).
  const a = await pedirSesion(CUENTA_A.email)
  const c = await api(a, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: empresa, p_year: calcular.ano, p_period: calcular.periodo }) as { declaracion: string }
  await api(a, 'POST', 'rpc/conta_impuesto_casillas_poner', { p_return: c.declaracion, p_casillas: { '27': 5900, '45': 5400, '110': 2000 }, p_motivo: 'e2e I01c: lo que habría calculado Sumied' })

  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'impuestos/presentados')
  await page.getByRole('button', { name: 'Subir justificantes' }).click()
  await expect(page.getByText('Arrastra aquí los justificantes en PDF')).toBeVisible()
  await foto(page, 'subir-zona')

  await page.getByLabel('Elegir los justificantes en PDF').setInputFiles([
    ...lista.map((j) => pdf(nombre(j), justificantePdf(j))), pdf('factura-proveedor.pdf', otroDocumentoPdf()), pdf('escaneado.pdf', sinTextoPdf()),
  ])
  const tabla = page.locator('.s-justificantes-tabla')
  await expect(tabla.getByText('Leído', { exact: true })).toHaveCount(n, { timeout: 30_000 })
  await expect(tabla.getByText('No se pudo leer', { exact: true })).toHaveCount(2)
  const p303 = lista[0]
  await expect(tabla.getByText(`IVA del trimestre · ${p303.periodo} ${p303.ejercicio}`)).toBeVisible()
  await expect(tabla.getByText(`modelo 303 · 1.761,96 € a compensar · presentado el ${p303.presentada.slice(0, 10).replace(/-/g, '/')}`)).toBeVisible()
  await expect(tabla.getByText(/^Pago a cuenta de sociedades · \d\.(er|º) pago \d{4}$/)).toBeVisible()
  await expect(tabla.getByText('modelo 202 · 960,00 € a ingresar', { exact: false })).toBeVisible()
  // El escaneado y la factura: ninguno deja ver un CSV. Una frase, la misma, sin encadenar motivos.
  await expect(tabla.getByText('No encontramos el CSV en este PDF. Pégalo a mano.', { exact: true })).toHaveCount(2)
  // El objetivo: Sumied lo había calculado, y dice qué casillas no coinciden.
  const filaObjetivo = tabla.locator('tr', { hasText: `IVA del trimestre · ${objetivo.periodo} ${objetivo.ejercicio}` })
  await expect(filaObjetivo.getByText(/casillas distintas de lo que calculó Sumied/)).toBeVisible()
  await expect(filaObjetivo.getByText(/^Sumied lo había calculado y \d+ casillas no coinciden\.$/)).toBeVisible()
  await expect(page.getByRole('button', { name: `Confirmar y guardar ${n}` })).toBeEnabled()
  await sinDesbordar(page, 'Subir justificantes · repaso')
  await foto(page, 'subir-repaso')
  await filaObjetivo.screenshot({ path: `${DIR}/subir-diferencias-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })

  // El que no se pudo leer: escribirlo a mano (se abre, se ve y se cancela).
  await tabla.locator('tr', { hasText: 'escaneado.pdf' }).getByRole('button', { name: 'Escribirlo a mano' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Escribirlo a mano' })
  await expect(dialogo.getByLabel('Por qué a mano')).toHaveValue('El PDF no se pudo leer')
  // El diálogo es fijo: se fotografía la pantalla, no la página entera (que lo parte).
  await page.screenshot({ path: `${DIR}/subir-a-mano-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: `Confirmar y guardar ${n}` }).click()
  const hecho = page.locator('.s-impuestos-hecho, .s-impuestos-fallo').first()
  await expect(hecho).toHaveText(new RegExp(`^Guardados ${n} justificantes: .* Otros 2 no se han guardado: no se pudieron leer o ya estaban\\.$`), { timeout: 60_000 })
  // Presentados, con lo subido: el CSV y su PDF.
  for (const j of lista) await expect(page.getByText(j.csv)).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(p303.csv) }).getByRole('button', { name: 'PDF ↗' })).toBeVisible()
  await sinDesbordar(page, 'Presentados con lo subido')
  await dentroDeLaPantalla(page, page.getByRole('button', { name: 'Subir justificantes' }), 'Presentados · «Subir justificantes»')
  await foto(page, 'presentados-subidos')

  // Otra vez el mismo: «Ya estaba», y nada que guardar.
  await page.getByRole('button', { name: 'Subir justificantes' }).click()
  await page.getByLabel('Elegir los justificantes en PDF').setInputFiles([pdf(nombre(p303), justificantePdf(p303))])
  await expect(page.locator('.s-justificantes-tabla').getByText('Ya estaba', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Nada que guardar todavía.')).toBeVisible()

  // El objetivo en el Modelo oficial: las casillas del justificante, y dicho.
  await ir(page, `impuestos/iva/${objetivo.ejercicio}/${objetivo.periodo}`)
  await page.getByRole('tab', { name: /Modelo oficial/ }).click()
  await expect(page.getByText('Del justificante de Hacienda').first()).toBeVisible()
  await expect(page.getByText(casilla87).first()).toBeVisible()
  await sinDesbordar(page, 'IVA subido · Modelo oficial')
  await foto(page, 'iva-subido-casillas')
  expect(errores, errores.join('\n')).toEqual([])
})
