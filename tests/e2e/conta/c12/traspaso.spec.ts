/// <reference lib="dom" />
// tests/e2e/conta/c12/traspaso.spec.ts
//
// C12 (Julio, 24/10) · «Traspasar a Diez», arriba de Contabilidad › Cierre ›
// Cerrar el mes, contra staging-conta, en ordenador (1440) y móvil (390).
// Capturas en docs/conta/capturas/c12/ (van en el artefacto del run).
//
//   1. De verdad: la cuenta A (sin Diez en staging) lee su revisión y la
//      pantalla lo dice en una frase; no hay botón de traspasar.
//   2. Los estados del mes, con la revisión simulada (la pantalla es la de
//      verdad; solo la respuesta de conta_traspaso_revisar es inventada, para
//      no tocar staging): «Faltan 3 cosas» con sus enlaces, «listo para
//      traspasar» con el resumen y el diálogo de confirmar (que dice qué
//      autoriza), y «traspasado a Diez y cerrado» con el cuadre y el informe.
// No escribe nada: el diálogo se cancela.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c12'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const RUTA = '/conta/libros/cierre/cerrar-mes'

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
}
const json = (r: Route, body: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** El mes anterior al de hoy (AAAA-MM-01): un mes terminado, que se puede traspasar. */
function mesAnterior(): string {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

const revision = (o: Record<string, unknown> = {}) => ({
  mes: mesAnterior(), faltan: [], van: 120, ya_en_diez: 14, no_viajan: 2, mes_cerrado: false, modo: 'mensual', conectado: true, traspaso: null,
  por_tipo: [{ tipo: 'ventas', n: 62 }, { tipo: 'recibidas', n: 31 }, { tipo: 'banco', n: 25 }, { tipo: 'anulacion', n: 2 }],
  por_cuenta: [
    { cuenta: '43000002', nombre: 'Clientes plataformas', debe: 6820.4, haber: 0 },
    { cuenta: '57200001', nombre: 'Banco', debe: 5400, haber: 3120.15 },
    { cuenta: '70000002', nombre: 'Ventas', debe: 0, haber: 6200.36 },
  ],
  ...o,
})

/** Simula la revisión del mes (la pantalla y todo lo demás, de verdad). */
async function conRevision(page: Page, r: unknown) {
  await page.route(/\/rest\/v1\/rpc\/conta_traspaso_revisar/, (x) => json(x, r))
}

/** Elige el mes que se traspasa (el anterior, terminado). */
async function elegirMesAnterior(page: Page) {
  const zona = page.getByRole('region', { name: 'Traspasar a Diez' })
  await expect(zona).toBeVisible()
  const selector = zona.getByLabel('Mes que se traspasa')
  if (await selector.count()) {
    const valor = mesAnterior()
    const opciones = await selector.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    if (opciones.includes(valor)) await selector.selectOption(valor)
  }
  return zona
}

test('A · de verdad: sin Diez, la pantalla lo dice en una frase y no ofrece traspasar', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = page.getByRole('region', { name: 'Traspasar a Diez' })
  await expect(zona).toBeVisible()
  await expect(zona.getByTestId('traspaso-frase')).toHaveText('Esta empresa no está conectada con Diez: no hay nada que traspasar.')
  await expect(zona.getByRole('button', { name: /Traspasar .* a Diez/ })).toHaveCount(0)
  // «Cerrar el mes» sigue debajo, como antes.
  await expect(page.getByRole('heading', { name: 'La contabilidad, mes a mes' })).toBeVisible()
  await capturar(page, 'sin-diez')
})

test('A · faltan cosas: el mes en una frase, cada cosa con su enlace, y se puede traspasar igual', async ({ page }) => {
  await conRevision(page, revision({ faltan: [{ codigo: 'asientos', n: 2 }, { codigo: 'recibidas_sin_pdf', n: 1 }] }))
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^Faltan 3 cosas antes de traspasar \w+\.$/)
  const falta = zona.getByRole('list', { name: 'Lo que falta' })
  await expect(falta.getByText('2 asientos del mes sin validar')).toBeVisible()
  await expect(falta.getByText('1 factura recibida sin su PDF')).toBeVisible()
  await expect(falta.getByRole('link', { name: 'Ir a verlo' })).toHaveCount(2)
  // Palabras de la calle: nada de cola ni de envíos.
  await expect(zona.getByText(/cola|env[ií]o/i)).toHaveCount(0)
  await capturar(page, 'faltan')
  await zona.getByRole('button', { name: /^Traspasar \w+ a Diez$/ }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText('Antes faltan cosas:')).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Traspasar igual' })).toBeVisible()
  await capturar(page, 'faltan-confirmar')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
})

test('A · listo: el resumen por tipo y por cuenta, y el diálogo dice qué autoriza', async ({ page }) => {
  await conRevision(page, revision())
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^\w+ está listo para traspasar\.$/)
  const resumen = zona.getByLabel('Lo que va')
  await expect(resumen.locator('p').first()).toContainText('Van 120 asientos · 14 ya estaban en Diez y no se vuelven a mandar · 2 anulados antes de llegar a Diez no viajan')
  // Los tipos, en su lista (el nombre de una cuenta puede llamarse igual: «Ventas»).
  const tipos = resumen.getByRole('list')
  for (const t of ['Ventas', 'Facturas recibidas', 'Banco', 'Anulaciones de lo que ya estaba en Diez']) await expect(tipos.getByText(t, { exact: true })).toBeVisible()
  await resumen.getByText('Totales por cuenta').click()
  await expect(resumen.getByRole('cell', { name: '43000002' })).toBeVisible()
  await capturar(page, 'listo')
  await zona.getByRole('button', { name: /^Traspasar \w+ a Diez$/ }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText(/autorizas escribir en Diez todo lo de \w+: ventas, facturas recibidas, banco, asientos a mano y liquidaciones\. Queda apuntado quién y cuándo\./)).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Traspasar', exact: true })).toBeVisible()
  await capturar(page, 'listo-confirmar')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
})

test('A · traspasado y cerrado: «Cuadra» en verde, quién lo confirmó y el informe', async ({ page }) => {
  const mes = mesAnterior()
  await conRevision(page, revision({
    mes_cerrado: true,
    traspaso: { id: 't1', mes, estado: 'terminado', confirmado_por_nombre: 'Julio', confirmado_en: `${mes.slice(0, 7)}-28T09:00:00Z`, faltaba: [], van: 120, llegaron: 120, no_llegaron: 0,
      cuadre: { cuadra: true, cuentas: 38, diferencias: [], solo_en_diez: [] }, cuadra: true, mes_cerrado: true, cierre_motivo: null, terminado_en: `${mes.slice(0, 7)}-28T09:06:00Z` },
  }))
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^\w+ está traspasado a Diez y cerrado\.$/)
  await expect(zona.getByTestId('traspaso-cuadre')).toHaveText('Cuadra: 38 cuentas tienen en Diez lo mismo que en Sumied.')
  await expect(zona.getByText(/Confirmado por Julio el/)).toBeVisible()
  await expect(zona.getByRole('button', { name: 'Descargar el informe' })).toBeVisible()
  await expect(zona.getByRole('button', { name: /Traspasar .* a Diez/ })).toHaveCount(0)
  await capturar(page, 'cerrado')
})
