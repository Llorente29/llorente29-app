/// <reference lib="dom" />
// tests/e2e/conta/c00/marco.spec.ts
//
// Tarea 2 del C00, rehecha con el patrón único (S02 · PR 1): el marco del
// módulo de contabilidad en la cuenta B: SIN interruptor `conta` y SIN módulos
// de Cocina (respuesta 1 de Julio, «Fuera de Folvy»). Si algo falla aquí, está
// mal.
//
// El marco del S02: la barra a la izquierda (en el móvil, en un cajón), con el
// apartado activo abierto y sus páginas debajo; arriba la cabecera con la
// franja del color de la empresa, «Buscar o hacer algo», la Ayuda y el
// usuario; letra Inter y los colores del patrón en todas las marcas.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'

test('cuenta B (sin interruptor ni Cocina): el módulo carga y funciona solo', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta')
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
  // C02 §5a: Ajustes es un índice; en el ordenador abre «Tu empresa», en el móvil el índice.
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()

  // El marco es el del módulo, no el de Folvy: ni barra de módulos ni burbuja.
  await expect(page.locator('button[aria-label$="Folvy Copiloto"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navegacion principal' })).toHaveCount(0)

  // La cabecera del patrón: la franja del color de la empresa encima (3 px),
  // «Buscar o hacer algo» y la Ayuda.
  const franja = page.locator('.s-franja-empresa')
  await expect(franja).toBeVisible()
  expect(Math.round((await franja.boundingBox())?.height ?? 0)).toBe(3)
  if (movil) {
    await expect(page.getByRole('button', { name: 'Buscar o hacer algo' })).toBeVisible()
  } else {
    const buscar = page.getByRole('button', { name: /Buscar o hacer algo/ })
    await expect(buscar).toBeVisible()
    await expect(buscar).toHaveAttribute('aria-keyshortcuts', 'Control+K')
  }
  // La Ayuda (los atajos de teclado y cómo se leen los colores) es del ordenador:
  // en el móvil no hay teclado que explicar y la cabecera no la lleva.
  if (movil) await expect(page.getByRole('button', { name: 'Ayuda' })).toHaveCount(0)
  else await expect(page.getByRole('button', { name: 'Ayuda' })).toBeVisible()

  // S01c: en el móvil, el menú va en un cajón que abre el botón de la cabecera.
  if (movil) await page.getByRole('button', { name: 'Abrir el menú' }).click()
  const menu = page.getByRole('navigation', { name: 'Menú de contabilidad' })
  await expect(menu).toBeVisible()

  // Ajustes activo y ABIERTO, con sus páginas debajo (S02: ya no hay pestañas
  // en la cabecera). La portada de Ajustes es «Tu empresa» en el ordenador, así
  // que el apartado dice «estás dentro» ('true') o «estás aquí» ('page').
  await expect(menu.getByRole('link', { name: 'Ajustes', exact: true })).toHaveAttribute('aria-current', /^(page|true)$/)
  const paginas = menu.getByRole('list', { name: 'Páginas de Ajustes' })
  await expect(paginas).toBeVisible()
  // El índice dice lo que hay (C02, N6). DM1 · PR 1 (30/10): «Personas y asesor» ya tiene pantalla y se llama «Usuarios».
  await expect(paginas.getByRole('link', { name: 'Usuarios', exact: true })).toBeVisible()
  // S02: el plan y las tablas son de Contabilidad › Definiciones, no de Ajustes.
  await expect(paginas.getByRole('link', { name: 'Tablas generales' })).toHaveCount(0)
  // Laboral no sale hasta que exista (decisión 5 del S02), ni lo que no tiene pantalla.
  for (const sinPantalla of ['Laboral', 'Por hacer']) {
    await expect(menu.getByRole('link', { name: sinPantalla, exact: true })).toHaveCount(0)
  }
  // Favoritos va abajo, en la barra, no en la cabecera.
  await expect(menu.getByRole('button', { name: 'Favoritos' })).toBeVisible()
  if (movil) {
    await page.getByRole('button', { name: 'Cerrar el menú' }).click()
    await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)
  }

  // Letra Inter dentro del módulo (S02: la misma en todas las marcas).
  await page.evaluate(() => document.fonts.ready)
  const letra = await page.locator('.cx').first().evaluate((el) => getComputedStyle(el).fontFamily)
  expect(letra).toContain('Inter Variable')
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true)

  // Los colores del patrón (S02, decisión 1: el borde de los campos #7F8FA6).
  const colores = await page.locator('.cx').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { tinta: s.getPropertyValue('--s-tinta').trim(), campo: s.getPropertyValue('--s-borde-control').trim(), barra: s.getPropertyValue('--s-barra').trim() }
  })
  expect(colores.tinta.toUpperCase()).toBe('#172443')
  expect(colores.campo.toUpperCase()).toBe('#7F8FA6')
  expect(colores.barra.toUpperCase()).toBe('#0B1F3B')

  // La IA aún no contesta: lo que no funciona no se enseña (C06b, respuesta 6):
  // ni la barra «Pregunta o pide algo» ni el botón de la IA del móvil.
  await expect(page.locator('.cx-pregunta')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Preguntar a / })).toHaveCount(0)

  // Los solapes se miden con la pantalla CARGADA: con el esqueleto delante no
  // hay nada que tapar y la medida pasa sin medir (así pasó hasta el 03/10, y
  // falló el día que el contenido llegó a mitad de medida). En el móvil, el
  // índice de Ajustes; en el ordenador, el panel de «Tu empresa».
  if (movil) await expect(page.getByRole('navigation', { name: 'Ajustes' }).getByText('Socios y cargos')).toBeVisible()
  else await expect(page.locator('.cx-ajustes-solo .cx-ajustes-panel')).toBeVisible()

  await page.screenshot({ path: `${DIR}/marco-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta A (con interruptor): «Folvy Conta» sale en la barra de Folvy', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La barra de módulos es la misma lógica en los dos tamaños')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Folvy Conta' })).toBeVisible()
  await page.getByRole('button', { name: 'Folvy Conta' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})

test('cuenta B (sin interruptor): «Folvy Conta» NO sale en la barra de Folvy', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La barra de módulos es la misma lógica en los dos tamaños')
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Menú de usuario' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Folvy Conta' })).toHaveCount(0)
})
