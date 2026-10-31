/// <reference lib="dom" />
// tests/e2e/conta/s01f/interruptores.spec.ts
//
// S01f (31/10) · La sección «Sumied» de la ficha de la cuenta, en la
// administración de la plataforma: el superadministrador de prueba enciende y
// apaga «Laboral» en la A de su carril, con su motivo, y lo ve reflejado.
//
// Las dos llamadas a la base van con datos inventados (page.route): desde la
// rama, la 1705 (el tipo nuevo de la auditoría) solo pasa por staging en
// ROLLBACK, y sin ella el cambio de verdad no se puede apuntar. El camino de
// verdad lo prueban supabase/staging/sql/20261031_s01f_interruptores_prueba.sql
// y el ensayo de producción. Aquí se mira la pantalla: la fila, el motivo en la
// propia fila, «Guardar» sin motivo apagado, la confirmación con contenido y la
// fila con su nuevo estado. Ordenador y móvil. Capturas en docs/conta/capturas/s01f/interruptores.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01f/interruptores'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

/** Los interruptores de la cuenta, en memoria: lo que la base devolvería. */
function conBaseInventada(page: Page) {
  const estado = {
    conta: { encendida: true, cambiada: '2026-10-06T09:00:00Z', quien: null as string | null, motivo: null as string | null },
    conta_impuestos: { encendida: true, cambiada: '2026-10-18T09:00:00Z', quien: null as string | null, motivo: 'Modelos en Sumied' as string | null },
    conta_laboral: { encendida: false, cambiada: null as string | null, quien: null as string | null, motivo: null as string | null },
  }
  const llamadas: Record<string, unknown>[] = []
  void page.route(/\/rest\/v1\/rpc\/conta_interruptores_de_cuenta/, (r) => json(r, {
    interruptores: (['conta', 'conta_impuestos', 'conta_laboral'] as const).map((clave) => ({ clave, existe: !!estado[clave].cambiada, ...estado[clave] })),
    datos: { asientos: 12, facturas_recibidas: 3, impuestos: 1 },
  }))
  void page.route(/\/rest\/v1\/rpc\/conta_interruptor_cambiar/, async (r) => {
    const a = r.request().postDataJSON() as { p_clave: 'conta_laboral'; p_encender: boolean; p_motivo: string }
    llamadas.push(a)
    const de = estado[a.p_clave].encendida
    estado[a.p_clave] = { encendida: a.p_encender, cambiada: '2026-10-31T17:30:00Z', quien: 'Plataforma de prueba', motivo: a.p_motivo }
    await json(r, { cuenta: 'Taberna de Prueba Norte', cambiados: de === a.p_encender ? [] : [{ clave: a.p_clave, de, a: a.p_encender }] })
  })
  return llamadas
}

test.describe('S01f · los interruptores de Sumied de una cuenta', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('el administrador de la plataforma enciende y apaga «Laboral», con su motivo, y lo ve reflejado', async ({ page }) => {
    await entrarComo(page, PLATAFORMA)
    const llamadas = conBaseInventada(page)
    await page.goto(`/_admin/cuentas/${CUENTA_A.id}`)
    const seccion = page.locator('[data-prueba="seccion-sumied"]')
    await expect(seccion.getByRole('heading', { name: 'Sumied' })).toBeVisible({ timeout: 30_000 })
    await expect(seccion).toContainText('Lo que esta cuenta tiene de Sumied.')
    await expect(seccion.locator('[data-prueba="interruptor-conta"]')).toContainText('Encendida desde el 06/10/2026 · no consta quién · sin motivo apuntado')
    const laboral = seccion.locator('[data-prueba="interruptor-conta_laboral"]')
    await expect(laboral.getByRole('switch', { name: 'Laboral' })).toHaveAttribute('aria-checked', 'false')

    // Encender: el motivo sale en la propia fila; sin motivo, «Guardar» no hace nada.
    await laboral.getByRole('switch', { name: 'Laboral' }).click()
    await expect(laboral.getByLabel('Vas a encender «Laboral». ¿Por qué?')).toBeVisible()
    await expect(laboral.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await laboral.getByLabel('Vas a encender «Laboral». ¿Por qué?').fill('Llevamos sus nóminas')
    await capturar(page, 'encender-laboral-motivo')
    await laboral.getByRole('button', { name: 'Guardar' }).click()
    await expect(seccion.getByRole('status')).toHaveText('Encendido lo laboral de Taberna de Prueba Norte. Ya sale en su Sumied.')
    await expect(laboral.getByRole('switch', { name: 'Laboral' })).toHaveAttribute('aria-checked', 'true')
    await expect(laboral).toContainText('Encendida desde el 31/10/2026 por Plataforma de prueba · «Llevamos sus nóminas»')
    await capturar(page, 'laboral-encendida')

    // Apagar, con su motivo.
    await laboral.getByRole('switch', { name: 'Laboral' }).click()
    await laboral.getByLabel('Vas a apagar «Laboral». ¿Por qué?').fill('Lo lleva la gestoría')
    await laboral.getByRole('button', { name: 'Guardar' }).click()
    await expect(seccion.getByRole('status')).toHaveText('Apagado lo laboral de Taberna de Prueba Norte: ya no sale en su Sumied. No se ha borrado nada.')
    await expect(laboral.getByRole('switch', { name: 'Laboral' })).toHaveAttribute('aria-checked', 'false')
    expect(llamadas).toEqual([
      expect.objectContaining({ p_clave: 'conta_laboral', p_encender: true, p_motivo: 'Llevamos sus nóminas' }),
      expect.objectContaining({ p_clave: 'conta_laboral', p_encender: false, p_motivo: 'Lo lleva la gestoría' }),
    ])

    // Apagar la contabilidad avisa de lo que hay dentro antes de pedir el motivo.
    const conta = seccion.locator('[data-prueba="interruptor-conta"]')
    await conta.getByRole('switch', { name: 'Contabilidad' }).click()
    await expect(conta.locator('[data-prueba="aviso-apagar"]')).toContainText('12 asientos, 3 facturas recibidas y 1 impuesto')
    await expect(conta.getByRole('button', { name: 'Apagar la contabilidad' })).toBeDisabled()
    await capturar(page, 'apagar-contabilidad-aviso')
    await conta.getByRole('button', { name: 'Cancelar' }).click()
    expect(llamadas).toHaveLength(2)
  })
})
