/// <reference lib="dom" />
// tests/e2e/conta/b01/otraCosa.spec.ts
//
// B01·21 · «¿Es otra cosa?» con las opciones que faltaban: «Pago a un
// proveedor…» en lo que sale y «Cobro de un cliente…» en lo que entra (antes
// había que «Apuntar sin factura» y escribir la cuenta a mano). En staging,
// cuenta A, en ordenador, con el Norma 43 inventado de los bancos del B01. Solo
// mira y saca las capturas: no casa nada.
// Las capturas van a docs/conta/capturas/b01/ («otra-cosa-*»).

import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA } from './datos'

const DIR = 'docs/conta/capturas/b01'
const NORTE = BANCOS_B01[0]

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-ordenador.png`, fullPage: true })
}

type Estado = { mismo: boolean; abierto: boolean } | null
/** El bloque «¿Es otra cosa?» del panel: si es el mismo elemento que se marcó y si sigue abierto. */
async function estadoBloque(page: Page): Promise<Estado> {
  const b = page.locator('.cxn-panel details.cxn-otra-cosa')
  if (!(await b.count())) return null
  return b.evaluate((el) => ({ mismo: (el as HTMLElement & { _marca?: boolean })._marca === true, abierto: (el as HTMLDetailsElement).open }))
}

test.describe('B01·21 · «¿Es otra cosa?»', () => {
  test.describe.configure({ timeout: 300_000 })
  test.use({ actionTimeout: 20_000 })

  test('ordenador: «Pago a un proveedor…» y «Cobro de un cliente…»', async ({ page }) => {
    test.skip(((page.viewportSize()?.width ?? 1440) < 768), 'En ordenador.')
    const base = await baseDeA()
    await base.deshacerTodo('Limpieza antes de «¿Es otra cosa?»')
    const bancos = crearBancos(base.bd)
    const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
    const a = { nombre: 'b01-tres-cuentas.n43', sha256: createHash('sha256').update(FICHERO).digest('hex'), contenido: { texto: FICHERO } }
    const { extracto, cuadre } = leerYCuadrar(a)
    await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))

    await entrarComo(page, CUENTA_A.email)
    // La pasada del día que lanza Bancos al abrirse recarga la lista y vuelve a montar el panel (se pliega
    // «¿Es otra cosa?»): aquí no toca. Lo mismo que hace la e2e de conciliar.
    await page.route('**/rest/v1/rpc/bank_agente_toca_hoy', (ruta) => ruta.fulfill({ status: 200, contentType: 'application/json', body: 'false' }))
    await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
    await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()

    // Lo que sale: «Pago a un proveedor…».
    await page.getByText('Transferencia a SUMINISTROS B01', { exact: false }).first().click()
    const panel = page.locator('.cxn-panel')
    /** Abre «¿Es otra cosa?» si está plegado (si algo vuelve a montar el panel, se pliega). */
    const abrirOtraCosa = async (boton: string) => {
      const b = panel.getByRole('button', { name: boton })
      if (!(await b.isVisible())) await panel.getByText('¿Es otra cosa?').click()
      await expect(b).toBeVisible()
      return b
    }
    await abrirOtraCosa('Pago a un proveedor…')
    await expect(panel.getByRole('button', { name: 'Pago a un proveedor…' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Cobro de un cliente…' })).toHaveCount(0)

    // ¿Se pliega solo? La captura de otra-cosa-pago (#634) salió plegada aunque la prueba lo
    // acababa de abrir. Se marca el bloque abierto y se mira: (1) tras 5 s sin tocar nada, como
    // una persona que lee; (2) tras una captura de página entera, que cambia el tamaño de la
    // ventana mientras dura. Las cifras van al informe del run.
    await panel.locator('details.cxn-otra-cosa').evaluate((el) => { (el as HTMLElement & { _marca?: boolean })._marca = true })
    await page.waitForTimeout(5_000)
    const sinTocar = await estadoBloque(page)
    await page.screenshot({ path: test.info().outputPath('sonda.png'), fullPage: true })
    const trasCaptura = await estadoBloque(page)
    test.info().annotations.push({ type: 'pliegue', description: JSON.stringify({ sinTocar, trasCaptura }) })
    console.log(`[pliegue] sin tocar 5 s: ${JSON.stringify(sinTocar)} · tras la captura de página entera: ${JSON.stringify(trasCaptura)}`)

    // La captura, con la ventana ya tan alta como la página (la foto no cambia el tamaño) y el
    // bloque comprobado abierto justo antes.
    const alto = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 1440, height: alto })
    await abrirOtraCosa('Pago a un proveedor…')
    await expect(panel.locator('details.cxn-otra-cosa')).toHaveAttribute('open', '')
    await capturar(page, 'otra-cosa-pago')
    await (await abrirOtraCosa('Pago a un proveedor…')).click()
    const dialogo = page.getByRole('dialog', { name: 'Pago a un proveedor' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText('¿De qué proveedor es?')).toBeVisible()
    const opcion = dialogo.getByRole('option').first()
    // El que más palabras del banco tiene sale el primero (no lo primero que diga «Norte»).
    await expect(opcion).toContainText('Suministros B01 del Norte')
    if (await opcion.count()) {
      await opcion.click()
      await expect(dialogo.getByRole('note')).toContainText('Sale 250,00 €')
      await expect(dialogo.getByRole('button', { name: 'Es su pago' })).toBeEnabled()
    }
    await capturar(page, 'otra-cosa-pago-proveedor')
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()

    // Lo que entra: «Cobro de un cliente…».
    await page.getByText('Transferencia recibida ref 88213', { exact: false }).first().click()
    await abrirOtraCosa('Cobro de un cliente…')
    await expect(panel.getByRole('button', { name: 'Pago a un proveedor…' })).toHaveCount(0)
    await (await abrirOtraCosa('Cobro de un cliente…')).click()
    await expect(page.getByRole('dialog', { name: 'Cobro de un cliente' }).getByText('¿De qué cliente es?')).toBeVisible()
    await capturar(page, 'otra-cosa-cobro-cliente')
  })
})
