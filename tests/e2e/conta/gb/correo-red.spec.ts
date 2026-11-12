// tests/e2e/conta/gb/correo-red.spec.ts
//
// GBd · El plan B, en pruebas: el correo de «Cambio deshecho», en el ordenador
// y en el móvil (el mismo HTML que manda Resend, de red.ts). Lo que pide el
// diseño: arriba, en una frase, qué ha pasado; una tabla de dos filas («Lo que
// pusiste» y «Lo que queda»); el botón «Abrir la ficha»; legible en el móvil
// (sin barra de desplazamiento de lado); sin códigos de campo ni jerga.
// Empresa, persona e importes inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { correoDeLaRed, enlaceDeLaFicha } from '../../../../supabase/functions/conta-bitrix-pestana/red'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

test('el correo de «Cambio deshecho»: qué ha pasado, «Lo que pusiste / Lo que queda» y «Abrir la ficha»', async ({ page }) => {
  const c = correoDeLaRed({ empresa: 'Bodegas Prueba, S.L.', antes: '999,00', despues: '200,00', quien: 'Equipo Prueba',
    cuando: '12/11/2026 a las 10:05', enlace: enlaceDeLaFicha('b24-s3mr2y.bitrix24.es', '12') })
  await page.setContent(c.html)
  await expect(page.locator('body')).toContainText('Cambio deshecho en Bodegas Prueba, S.L.')
  await expect(page.locator('body')).toContainText('Sumied ha vuelto a poner la Cuota mensual de Bodegas Prueba, S.L.: la cambió Equipo Prueba el 12/11/2026 a las 10:05')
  const filas = page.locator('table tr')
  await expect(filas).toHaveCount(2)
  await expect(filas.nth(0)).toHaveText(/Lo que pusiste\s*999,00 €/)
  await expect(filas.nth(1)).toHaveText(/Lo que queda\s*200,00 €/)
  await expect(page.locator('body')).toContainText('se cambia en la pestaña Sumied de la ficha')
  const boton = page.getByRole('link', { name: 'Abrir la ficha' })
  await expect(boton).toHaveAttribute('href', 'https://b24-s3mr2y.bitrix24.es/crm/company/details/12/')
  await expect(page.locator('body')).not.toContainText(/UF_CRM|webhook|evento|sincroniz/i)
  // Legible en el móvil: nada se sale por el lado.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${DIR}/gbd-correo-${lado(page)}.png`, fullPage: true })
})
