/// <reference lib="dom" />
// tests/e2e/laboral/n1-ficha-de-hoy.spec.ts
//
// N1 · Paso 0 (01/11/2026): LAS CAPTURAS de la ficha de hoy, antes de
// sustituirla. Abre Personal › Empleados en Folvy (staging, cuenta A, datos
// inventados), entra en la primera persona y saca una captura de cada una de
// las 8 pestañas del modal de StaffPage: en ordenador, todas; en móvil, todas
// también, porque la ficha nueva tiene que funcionar en el móvil y hace falta
// ver de dónde se parte.
//
// Es una herramienta del paso 0, no una prueba de regresión: NO falla si una
// pestaña no se puede abrir, lo apunta. Las capturas van al informe de
// Playwright (artefacto del run), no al repositorio. La ficha de hoy se retira
// en el PR 2 del N1, y este fichero con ella.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../conta/sesion'

test.skip(process.env.GITHUB_EVENT_NAME === 'schedule', 'las capturas del paso 0 no corren de noche')

const PESTANAS = ['Datos', 'Fichajes', 'Bolsa', 'Docs', 'Ausencias', 'Formaciones', 'Contrato', 'Disponibilidad']

async function capturar(page: Page, n: number, nombre: string) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(1_000)
  const fichero = `${test.info().project.name}-${String(n).padStart(2, '0')}-${nombre.toLowerCase()}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

test('N1 paso 0 · la ficha de hoy, pestaña a pestaña', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)
  // El modal mide como mucho el 90 % de la ventana y lo demás va con scroll:
  // con una ventana alta, cada pestaña sale entera en la captura.
  const ancho = page.viewportSize()?.width ?? 1440
  await page.setViewportSize({ width: ancho, height: 2600 })
  await page.goto('/personal', { timeout: 30_000 })
  await capturar(page, 0, 'lista')

  // La primera persona de la lista (una tarjeta con su nombre).
  const primera = page.locator('.grid.gap-3 > div.cursor-pointer').first()
  await expect(primera).toBeVisible({ timeout: 30_000 })
  await primera.click()
  // El Modal de ui.tsx no lleva role="dialog": es el último «fixed inset-0 z-50».
  const modal = page.locator('div.fixed.inset-0.z-50').last()
  await expect(modal.getByRole('button', { name: 'Datos', exact: true })).toBeVisible({ timeout: 15_000 })

  let n = 0
  for (const p of PESTANAS) {
    n += 1
    await test.step(p, async () => {
      try {
        await modal.getByRole('button', { name: p, exact: true }).click({ timeout: 10_000 })
        await capturar(page, n, p)
      } catch (e) {
        test.info().annotations.push({ type: 'no se pudo capturar', description: `${p}: ${(e as Error).message.split('\n')[0]}` })
      }
    })
  }
  for (const e of errores) test.info().annotations.push({ type: 'error de la página', description: e })
  console.log(`[N1 paso 0] ${test.info().project.name}: ${PESTANAS.length} pestañas, ${errores.length} errores de página apuntados.`)
})
