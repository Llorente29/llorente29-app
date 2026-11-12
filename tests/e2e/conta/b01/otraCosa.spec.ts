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
    await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
    await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()

    // Lo que sale: «Pago a un proveedor…».
    await page.getByText('Transferencia a SUMINISTROS B01', { exact: false }).first().click()
    const panel = page.locator('.cxn-panel')
    await panel.getByText('¿Es otra cosa?').click()
    await expect(panel.getByRole('button', { name: 'Pago a un proveedor…' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Cobro de un cliente…' })).toHaveCount(0)
    await capturar(page, 'otra-cosa-pago')
    await panel.getByRole('button', { name: 'Pago a un proveedor…' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Pago a un proveedor' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText('¿De qué proveedor es?')).toBeVisible()
    const opcion = dialogo.getByRole('option').first()
    if (await opcion.count()) {
      await opcion.click()
      await expect(dialogo.getByRole('note')).toContainText('Sale 250,00 €')
      await expect(dialogo.getByRole('button', { name: 'Es su pago' })).toBeEnabled()
    }
    await capturar(page, 'otra-cosa-pago-proveedor')
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()

    // Lo que entra: «Cobro de un cliente…».
    await page.getByText('Transferencia recibida ref 88213', { exact: false }).first().click()
    await panel.getByText('¿Es otra cosa?').click()
    await expect(panel.getByRole('button', { name: 'Cobro de un cliente…' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Pago a un proveedor…' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Cobro de un cliente…' }).click()
    await expect(page.getByRole('dialog', { name: 'Cobro de un cliente' }).getByText('¿De qué cliente es?')).toBeVisible()
    await capturar(page, 'otra-cosa-cobro-cliente')
  })
})
