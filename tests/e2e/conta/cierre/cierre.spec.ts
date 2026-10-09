/// <reference lib="dom" />
// tests/e2e/conta/cierre/cierre.spec.ts
//
// «El día se cierra a las 6:00» contra staging-conta, en ordenador (1440) y
// móvil (390). Capturas en docs/conta/capturas/cierre/ (COMPARACION.md).
//
// Datos: el asiento de ventas VALIDADO del 04/10 en Norte Centro (cuenta A,
// semilla del C04) y sus tres pedidos no confirmados: el que cerró el cron de
// staging de verdad (7B001, 17,00 €, en preparación) y los dos de
// supabase/seeds/conta/seed_cierre_staging.sql. Total: 66,80 €.
// Lo que escribe (la hora de cierre) se hace en UN tamaño y se deja como estaba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo, pedirSesion } from '../sesion'
import { rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/cierre'
const ASIENTO_04 = 'fc7df35a-c53c-460e-907a-ebea3d7fef8b'
const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

test('A · el asiento de ventas del día dice sus no confirmados, y «Ver» los enseña con cómo acabaron', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/conta/libros/diario/${ASIENTO_04}`)
  await expect(page.getByRole('heading', { level: 1, name: /Ventas del día · Norte Centro/ })).toBeVisible()
  const bloque = page.getByLabel('Pedidos no confirmados')
  await expect(bloque.getByText('3 pedidos no confirmados · 66,80 € · no están en estas ventas')).toBeVisible()
  await bloque.getByRole('button', { name: 'Ver' }).click()
  const lista = page.getByRole('table', { name: 'Lista de pedidos no confirmados' })
  for (const [codigo, importe, como] of [['7B001', '17,00 €', 'En preparación'], ['G153', '22,40 €', 'Entrega fallida'], ['D6B55', '27,40 €', 'Esperando recogida']]) {
    const fila = lista.getByRole('row').filter({ hasText: codigo })
    await expect(fila).toHaveCount(1)
    await expect(fila.getByText(importe)).toBeVisible()
    await expect(fila.getByText(como)).toBeVisible()
  }
  // Ningún estado en inglés.
  await expect(lista.getByText(/awaiting|delivery|failed|cancelled|in_preparation/i)).toHaveCount(0)
  await capturar(page, 'asiento-no-confirmados')
})

test('A · el libro dice cuándo se cierra hoy, como información', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  const nota = page.getByRole('note').filter({ hasText: 'Hoy se cierra mañana a las 6:00. Sus ventas se proponen entonces.' })
  await expect(nota).toBeVisible()
  // Información, no aviso: no es ámbar ni una alerta.
  await expect(nota).not.toHaveClass(/ambar|franja/)
  await capturar(page, 'libro-dia-en-curso')
})

test('A · Ajustes › Ejercicio: «Hora de cierre del día», y cambiarla confirma en pantalla', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/ejercicio')
  // En el ordenador la tarjeta lleva su título; en el móvil, su nombre y la etiqueta delante del valor.
  await expect(page.getByRole('region', { name: 'Hora de cierre del día' })).toBeVisible()
  if (lado(page) === 'movil') await expect(page.getByText('Hora de cierre del día: 6:00 (la de serie)')).toBeVisible()
  await expect(page.getByTestId('hora-cierre')).toHaveText('6:00 (la de serie)')
  await expect(page.getByText('A esa hora se dan por terminadas las ventas del día anterior. Un pedido que siga abierto se cierra como no confirmado.')).toBeVisible()
  await capturar(page, 'ajustes-hora-cierre')
  if (lado(page) !== 'ordenador') return
  const apartado = page.getByRole('region', { name: 'Hora de cierre del día' })
  const tarjeta = page.getByRole('form', { name: 'Hora de cierre del día' })
  await apartado.getByRole('button', { name: 'Cambiar' }).click()
  await tarjeta.getByLabel('Hora de cierre del día').fill('05:30')
  await tarjeta.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Guardado: cada día se cierra a las 5:30 del día siguiente. Lo que siga abierto a esa hora se cierra como no confirmado.')).toBeVisible()
  await expect(page.getByTestId('hora-cierre')).toHaveText('5:30')
  // Y se deja como estaba.
  await apartado.getByRole('button', { name: 'Cambiar' }).click()
  await tarjeta.getByLabel('Hora de cierre del día').fill('06:00')
  await tarjeta.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByTestId('hora-cierre')).toHaveText('6:00 (la de serie)')
})

test('RLS · B no ve los no confirmados de A, ni su asiento, ni su rastro', async ({ page }) => {
  const b = await pedirSesion(CUENTA_B.email)
  const lista = await rest<unknown[]>(b, 'POST', 'rpc/conta_no_confirmados', { p_company: EMPRESA_A, p_desde: '2026-10-01', p_hasta: '2026-10-31', p_location: null })
  expect(lista.status).toBe(200)
  expect(lista.datos).toEqual([])
  const rastro = await rest<unknown[]>(b, 'GET', `sales_day_close_log?select=id&company_id=eq.${EMPRESA_A}`)
  expect(rastro.datos).toEqual([])
  // Y A sí los ve, para que lo de B no sea un cero por error.
  const a = await pedirSesion(CUENTA_A.email)
  const deA = await rest<unknown[]>(a, 'POST', 'rpc/conta_no_confirmados', { p_company: EMPRESA_A, p_desde: '2026-10-04', p_hasta: '2026-10-04', p_location: null })
  expect(deA.datos.length).toBe(3)
  await entrarComo(page, CUENTA_B.email)
  await page.goto(`/conta/libros/diario/${ASIENTO_04}`)
  await expect(page.getByText('Ese asiento no está.')).toBeVisible()
  await expect(page.getByLabel('Pedidos no confirmados')).toHaveCount(0)
})
