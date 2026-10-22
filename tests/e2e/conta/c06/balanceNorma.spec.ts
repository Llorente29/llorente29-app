/// <reference lib="dom" />
// tests/e2e/conta/c06/balanceNorma.spec.ts
//
// C06b (respuesta 6 de Julio, tarea 1): el balance según la norma. Los clientes
// a los que se debe dinero van al pasivo y los proveedores que deben, al activo
// (no compensación; mapeo de serie por el signo, 20261111T0600). En pantalla:
// una nota de una línea bajo «Clientes», de apoyo —sin icono de aviso ni color
// de error—, y el balance sigue cuadrando. En ordenador y en móvil, con su
// captura en docs/conta/capturas/c06b/.
//
// Cuenta A (semillas del C04 y del C05, todo inventado). Solo lee.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c06b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NOTA = 'Los clientes a los que debes dinero van al pasivo, como dice el Plan Contable. Por eso esta cifra puede no coincidir con la de tu programa anterior.'

test('bajo «Clientes», la nota de la norma, de apoyo; y el balance cuadra', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/balances/balance')
  await expect(page.getByRole('heading', { name: 'Balance de situación' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Cuadre del balance' })).toContainText('Cuadra')

  // Una por cada línea de clientes del modelo (en el normal, también la de grupo).
  // S02 · PR 2: el balance va en la plantilla Informe y la nota es la fila de nota
  // de la tabla (`tr.s-informe-nota`, una celda a todo el ancho), antes `.cxl-nota-linea`.
  const nota = page.locator('tr.s-informe-nota').first()
  await expect(nota).toHaveText(NOTA)
  // Justo debajo de la línea de clientes, no en otro sitio.
  const anterior = nota.locator('xpath=preceding-sibling::*[1]')
  await expect(anterior).toContainText(/Clientes por ventas/)
  // De apoyo: sin icono, sin rojo ni ámbar, letra más pequeña que la línea. El estilo
  // (letra, color) lo lleva su celda: se mide ahí.
  const estilo = await nota.locator('td').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { color: s.color, fondo: s.backgroundColor, letra: parseFloat(s.fontSize), iconos: el.querySelectorAll('svg, img, [aria-hidden="true"]').length }
  })
  expect(estilo.iconos).toBe(0)
  expect(estilo.fondo).toBe('rgba(0, 0, 0, 0)')
  const [r, g, b] = estilo.color.match(/\d+/g)!.map(Number)
  expect(r > g + 40 && r > b + 40, `color de la nota ${estilo.color}: parece de error o de aviso`).toBe(false)
  expect(estilo.letra).toBeLessThanOrEqual(13)

  await nota.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/balance-nota-clientes-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
})
