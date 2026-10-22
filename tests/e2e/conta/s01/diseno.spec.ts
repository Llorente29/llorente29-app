/// <reference lib="dom" />
// tests/e2e/conta/s01/diseno.spec.ts
//
// S01 · El sistema de diseño en su página (ajustes/sistema-diseno, datos
// inventados), en la cuenta A de staging-conta, en las dos marcas. Rehecho con
// el S02 (PR 1): la página es ahora la única muestra, «El patrón único», con
// las seis plantillas; y los colores del patrón son los mismos en todas las
// marcas.
//   · Folvy y Sumied pintan con los colores del patrón (acción, fondo, letra);
//   · las seis plantillas, en su orden, y los estados que tienen que existir
//     (cargando, vacío, error con «Reintentar» y guardado);
//   · lo que se toca: las pestañas de estado, el «Por qué» del veredicto y el
//     documento que se pliega y vuelve;
//   · un menú del marco se cierra con Escape y devuelve el foco.
// Capturas en docs/conta/capturas/s01.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page, errores: string[]) {
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

const estilo = (page: Page, sel: string, prop: 'backgroundColor' | 'fontFamily' | 'color') =>
  page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

// S02, decisión 1: un solo juego de colores, el del patrón, en todas las marcas.
const FONDO = 'rgb(244, 247, 251)'    // #F4F7FB
const ACCION = 'rgb(30, 99, 201)'     // #1E63C9

test('el patrón en Folvy: los colores del patrón (ya no los de N30)', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/sistema-diseno')
  await expect(page.getByRole('heading', { level: 1, name: 'El patrón único' })).toBeVisible()
  // S02: antes, Folvy seguía con el fondo de N30 (rgb 238, 241, 245) y su azul
  // (rgb 47, 91, 255); ahora pinta con los del patrón, como Sumied.
  expect(await estilo(page, '.cxm', 'backgroundColor')).toBe(FONDO)
  expect(await estilo(page, '.s-boton-principal', 'backgroundColor')).toBe(ACCION)
  await capturar(page, 'sistema-folvy')
  expect(errores).toEqual([])
})

test('el patrón en Sumied: colores por tokens, las seis plantillas, sus estados y lo que se toca', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/sistema-diseno?marca=sumied')
  await expect(page.getByRole('heading', { level: 1, name: 'El patrón único' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // La marca, por los tokens: acción #1E63C9, fondo #F4F7FB, Inter; el ámbar de «Por revisar» #8A4B00.
  expect(await estilo(page, '.s-boton-principal', 'backgroundColor')).toBe(ACCION)
  expect(await estilo(page, '.cxm', 'backgroundColor')).toBe(FONDO)
  // S02: el contenedor del sistema es el del marco (.cx); .s-raiz ya no se pinta.
  expect(await estilo(page, '.cx', 'fontFamily')).toMatch(/^"?Inter Variable"?/)
  expect(await estilo(page, '.s-chip[data-tono="duda"]', 'color')).toBe('rgb(138, 75, 0)')
  // Los colores con nombre, cada uno con su token.
  const colores = page.getByRole('region', { name: 'Colores con nombre' })
  for (const token of ['--s-tinta', '--s-fondo', '--s-accion', '--s-borde-control', '--s-barra']) await expect(colores.getByText(token, { exact: true })).toBeVisible()

  // S02: la muestra ya no lleva los campos de antes (el importe, la subcuenta):
  // enseña las seis plantillas del patrón, en su orden.
  await expect(page.locator('h2.s-muestra-titulo')).toHaveText(['1 · Bandeja', '2 · Lista', '3 · Ficha', '4 · Informe', '5 · Asistente', '6 · Hoja de líneas'])

  // Los estados que tienen que existir: cargando, vacío, error con «Reintentar» y lo guardado (regla 8).
  await expect(page.getByLabel('Así se ve cargando')).toBeVisible()
  // (la tabla en el ordenador, las tarjetas en el móvil: las dos con ese nombre)
  await expect(page.getByLabel('Lista vacía').getByText(/^Todo al día\. No queda ninguna por revisar\./)).toBeVisible()
  const error = page.getByRole('alert').filter({ hasText: 'Así se ve un error' })
  await expect(error.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByText('Así se ve lo guardado: «Validada. Ya está en tu contabilidad».')).toBeVisible()

  // La Lista: las pestañas de estado suman «Todas», y la elegida queda marcada.
  const estado = page.getByRole('tablist', { name: 'Estado' })
  await expect(estado.getByRole('tab', { name: /^Por revisar/ })).toHaveAttribute('aria-selected', 'true')
  await estado.getByRole('tab', { name: /^Por pagar/ }).click()
  await expect(estado.getByRole('tab', { name: /^Por pagar/ })).toHaveAttribute('aria-selected', 'true')
  await expect(estado.getByRole('tab', { name: /^Por revisar/ })).toHaveAttribute('aria-selected', 'false')
  // La fila de la que se vino, marcada (al volver de una ficha).
  await expect(page.locator('[data-fila="2"]')).toHaveAttribute('data-actual', '')

  await capturar(page, 'sistema-sumied')

  // La Ficha: el veredicto de la IA dice su porqué al pulsarlo, y lo esconde.
  const veredicto = page.getByRole('region', { name: 'Lo que dice Sumied de esta factura' })
  await expect(veredicto.getByRole('heading', { name: 'Lista para contabilizar' })).toBeVisible()
  await veredicto.getByRole('button', { name: 'Por qué' }).click()
  await expect(veredicto.getByText('Cuadra: bases + IVA = total, al céntimo.')).toBeVisible()
  await veredicto.getByRole('button', { name: 'Ocultar' }).click()
  await expect(veredicto.getByText('Cuadra: bases + IVA = total, al céntimo.')).toHaveCount(0)
  // Lo propuesto lleva su etiqueta; el asiento que se crea, cuadrado.
  await expect(page.locator('.s-campo-propuesto').first()).toHaveText('Propuesto')
  await expect(page.locator('details.s-asiento-ficha').getByText('Cuadra', { exact: true })).toBeVisible()

  // El documento de la derecha se pliega y vuelve: los datos ocupan todo el ancho.
  const ficha = page.locator('.s-ficha')
  const documento = page.getByRole('complementary', { name: 'Documento' })
  await documento.getByRole('button', { name: 'Plegar el documento' }).click()
  await expect(ficha).toHaveAttribute('data-documento', 'oculto')
  await capturar(page, 'sistema-sumied-documento-plegado')
  await documento.getByRole('button', { name: 'Documento' }).click()
  await expect(ficha).toHaveAttribute('data-documento', 'si')
  await expect(documento.getByRole('button', { name: 'Plegar el documento' })).toBeVisible()

  // S02: aquí ya no hay diálogo de muestra. Lo mismo que se miraba en él —Escape
  // lo cierra y el foco vuelve al botón que lo abrió— se mira en un menú del
  // marco: la Ayuda en el ordenador; el cajón del menú en el móvil.
  const abrir = lado(page) === 'ordenador'
    ? page.getByRole('button', { name: 'Ayuda' })
    : page.getByRole('button', { name: 'Abrir el menú' })
  const abierto = lado(page) === 'ordenador'
    ? page.getByRole('group', { name: 'Ayuda' })
    : page.getByRole('dialog', { name: 'Menú' })
  await abrir.click()
  await expect(abierto).toBeVisible()
  await capturar(page, 'sistema-sumied-dialogo')
  await page.keyboard.press('Escape')
  await expect(abierto).toHaveCount(0)
  await expect(abrir).toBeFocused()

  expect(errores).toEqual([])
})
