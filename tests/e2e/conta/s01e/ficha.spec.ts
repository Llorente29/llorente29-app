/// <reference lib="dom" />
// tests/e2e/conta/s01e/ficha.spec.ts
//
// S01e · La ficha de cada préstamo o aplazamiento (tablero 5), en ordenador
// (1440) y móvil (390), contra staging-conta, cuenta A. Con dos contratos
// INVENTADOS que la prueba da de alta la primera vez (bank_contrato_guardar,
// como el administrador de A) y reutiliza después: A no puede borrar
// contratos, y así no se acumulan.
//   · el préstamo: la fila de la lista abre la ficha como página, con su miga;
//     las cuatro cifras, el cuadro con «Próxima», los filtros y la nota de las
//     cuotas de antes del cuadro;
//   · el aplazamiento con el cuadro de un solo año: «a corto, al menos …» y el
//     aviso de las cuotas que faltan, con su botón.
// Las capturas van a docs/conta/capturas/s01e/bancos/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { EMPRESA_A, baseDeA } from '../b01/datos'

const DIR = 'docs/conta/capturas/s01e/bancos'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const PRESTAMO = 'Préstamo S01e inventado'
const APLAZAMIENTO = 'Aplazamiento S01e inventado'

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

/** Los dos contratos de prueba: los crea si no están (la primera vez) y devuelve sus ids. */
async function contratos(): Promise<{ prestamo: string; aplazamiento: string }> {
  const base = await baseDeA()
  const buscar = async (nombre: string) => {
    const { data, error } = await base.cliente.from('recurring_contract').select('id').eq('company_id', EMPRESA_A).eq('name', nombre).eq('is_active', true).limit(1)
    if (error) throw new Error(error.message)
    return (data?.[0]?.id as string | undefined) ?? null
  }
  const cuentas = { capital_corto: '52000000', capital_largo: '17000000', intereses: '66230000' }
  let prestamo = await buscar(PRESTAMO)
  if (!prestamo) {
    const r = await base.bd.rpc<{ id: string }>('bank_contrato_guardar', { p_company: EMPRESA_A, p_datos: {
      tipo: 'prestamo', nombre: PRESTAMO, contiene: 'PRESTAMO S01E INVENTADO', importe: 6000, ...cuentas, documento: 'cuadro-inventado.xlsx', documento_tipo: 'excel',
      cuadro: [
        { fecha: '2026-12-03', cuota: 1100, capital: 1000, intereses: 100 }, { fecha: '2027-06-03', cuota: 1090, capital: 1000, intereses: 90 },
        { fecha: '2027-12-03', cuota: 1080, capital: 1000, intereses: 80 }, { fecha: '2028-06-03', cuota: 1070, capital: 1000, intereses: 70 },
        { fecha: '2028-12-03', cuota: 1060, capital: 1000, intereses: 60 }, { fecha: '2029-06-03', cuota: 1050, capital: 1000, intereses: 50 },
      ] } })
    prestamo = r.id
  }
  let aplazamiento = await buscar(APLAZAMIENTO)
  if (!aplazamiento) {
    const r = await base.bd.rpc<{ id: string }>('bank_contrato_guardar', { p_company: EMPRESA_A, p_datos: {
      tipo: 'aplazamiento', nombre: APLAZAMIENTO, contiene: 'APLAZAMIENTO S01E INVENTADO', importe: 10000, cuotas: 36, pendiente: 9400,
      capital_corto: '52000000', intereses: '66230000', documento: 'resolucion-inventada.pdf', documento_tipo: 'pdf',
      cuadro: [{ fecha: '2027-11-30', cuota: 330, capital: 300, intereses: 30 }, { fecha: '2027-12-31', cuota: 328, capital: 300, intereses: 28 }] } })
    aplazamiento = r.id
  }
  return { prestamo, aplazamiento }
}

test.describe('S01e · la ficha de un préstamo o aplazamiento', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('el préstamo: la fila abre su ficha, con las cuatro cifras y el cuadro', async ({ page }) => {
    const ids = await contratos()
    await entrarComo(page, CUENTA_A.email)
    vigilar(page)
    await page.goto('/conta/bancos/prestamos')
    await expect(page.getByRole('heading', { name: 'Préstamos y aplazamientos', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: PRESTAMO }).click()

    await expect(page).toHaveURL(new RegExp(`contrato=${ids.prestamo}`))
    await expect(page.getByRole('heading', { name: PRESTAMO, level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Préstamos y aplazamientos' }).first()).toBeVisible()
    await expect(page.getByText(/^Préstamo · se carga el día 3/)).toBeVisible()
    await expect(page.getByText('Queda por pagar')).toBeVisible()
    await expect(page.getByText('6.000,00 €').first()).toBeVisible()
    await expect(page.getByText(/^a corto .* · a largo /)).toBeVisible()
    await expect(page.getByText('0 de 6 pagadas')).toBeVisible()
    await expect(page.getByText('Las cuotas de antes del cuadro están en contabilidad.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Todas · 6' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Pagadas · 0' })).toBeVisible()
    await expect(page.getByText('Próxima').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subir un cuadro nuevo' }).first()).toBeVisible()
    await capturar(page, 'tablero-5-ficha-prestamo')

    // Los filtros: pagadas, ninguna; y vuelta a todas.
    await page.getByRole('button', { name: 'Pagadas · 0' }).click()
    await expect(page.getByText('Aún no hay ninguna cuota pagada.')).toBeVisible()
    await page.getByRole('button', { name: 'Todas · 6' }).click()
    // La miga vuelve a la lista.
    await page.getByRole('link', { name: 'Préstamos y aplazamientos' }).first().click()
    await expect(page.getByRole('heading', { name: 'Préstamos y aplazamientos', level: 1 })).toBeVisible()
  })

  test('el aplazamiento con el cuadro de un solo año: «al menos» a corto y faltan las cuotas del año siguiente', async ({ page }) => {
    const ids = await contratos()
    await entrarComo(page, CUENTA_A.email)
    vigilar(page)
    await page.goto(`/conta/bancos/prestamos?contrato=${ids.aplazamiento}`)
    await expect(page.getByRole('heading', { name: APLAZAMIENTO, level: 1 })).toBeVisible()
    await expect(page.getByText('10.000,00 €').first()).toBeVisible()
    await expect(page.getByText(/^a corto, al menos .*: faltan las cuotas de 2028$/)).toBeVisible()
    await expect(page.getByText('0 de 2 pagadas')).toBeVisible()
    await expect(page.getByText('Faltan las cuotas de 2028: sube el cuadro de ese año cuando llegue.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subir el cuadro de 2028' })).toBeVisible()
    await capturar(page, 'tablero-5-ficha-aplazamiento')
  })
})
