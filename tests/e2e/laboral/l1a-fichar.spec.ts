/// <reference lib="dom" />
// tests/e2e/laboral/l1a-fichar.spec.ts
//
// L1a · PR 1 (27/10/2026): fichar desde el portal, de verdad, en staging-conta
// (cuenta A), en ordenador y en móvil.
//   · El trabajador de prueba ficha ENTRADA y SALIDA desde su portal y la
//     pantalla dice lo que se guardó. Si la base ya tiene fichar() (la 1905),
//     además enseña «Lo que se ha guardado»; con la base de antes, el INSERT de
//     siempre. El front vale para las dos.
//   · Sin red: el fichaje se queda en el móvil y la pantalla lo dice; al volver
//     la red se envía, o sale el aviso con el motivo (regla 8).
//   · Mis ajustes: el texto de qué se guarda, para qué y cuánto tiempo.
//   · El administrador: Control horario abre, con el botón para descargar ese
//     texto.
// Las capturas van como adjuntos del informe (artefacto del run): Laboral no
// es un frente con carpeta de capturas.
//
// Deja la jornada CERRADA: si al empezar hay una abierta (de un run que se
// cortó), la cierra primero; y al acabar, si queda abierta, también.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../conta/sesion'

const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')

// Puerta del Sol: cerca de los locales de prueba, si tienen coordenadas.
test.use({ geolocation: { latitude: 40.4168, longitude: -3.7038 }, permissions: ['geolocation'] })

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

// Los botones de la portada, por su nombre. Con una expresión sobre el TEXTO,
// «Fichar salida» no casaba: el botón lleva el icono y un espacio delante
// (e2e #995, con la jornada abierta). Sin «\b» al final: el nombre de «Fichar
// entrada» sale pegado a su subtítulo. La pantalla de fichar dice «FICHAR …» en
// mayúsculas y la barra de abajo, «Fichar» solo: ninguno casa.
const botonDeLaPortada = (page: Page, tipo: 'entrada' | 'salida' | 'cualquiera') =>
  page.getByRole('button', { name: tipo === 'cualquiera' ? /^Fichar (entrada|salida)/ : new RegExp(`^Fichar ${tipo}`) })

/** Lo que enseña la pantalla, para que un fallo lo diga. */
async function loQueSeVe(page: Page): Promise<string> {
  const texto = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
  return texto.replace(/\s+/g, ' ').trim().slice(0, 400) || '(la página está vacía)'
}

async function alInicio(page: Page) {
  await page.goto('/')
  try {
    await expect(botonDeLaPortada(page, 'cualquiera')).toBeVisible({ timeout: 30_000 })
  } catch {
    throw new Error(`La portada del trabajador no enseña «Fichar entrada» ni «Fichar salida». En ${page.url()} se ve: ${await loQueSeVe(page)}`)
  }
}

async function jornadaAbierta(page: Page): Promise<boolean> {
  return botonDeLaPortada(page, 'salida').isVisible()
}

/**
 * El botón tiene que activarse: el trabajador ficha siempre (fuera del radio o
 * sin ubicación, marcado). Si no, la pantalla dice por qué, y el fallo lo cita.
 */
async function botonActivo(page: Page, boton: ReturnType<Page['getByRole']>) {
  try {
    await expect(boton).toBeEnabled({ timeout: 20_000 })
  } catch {
    const motivo = await page.locator('[data-prueba="por-que-no-se-puede"]').textContent().catch(() => null)
    throw new Error(`El botón de fichar no se activa. La pantalla dice: ${motivo ?? '(nada: botón gris sin explicación)'}`)
  }
}

/** Pulsa fichar y pasa los avisos que salgan (fuera de zona, anticipado, contexto). */
async function fichar(page: Page) {
  await botonDeLaPortada(page, 'cualquiera').click()
  const boton = page.getByRole('button', { name: /FICHAR (ENTRADA|SALIDA)/ })
  await botonActivo(page, boton)
  await boton.click()
  const confirmar = page.getByRole('button', { name: /^(Fichar igualmente|Entendido, fichar|Sí, me voy|Sí, fichar (ENTRADA|SALIDA))$/ })
  const final = page.locator('[data-prueba="fichaje-hecho"], [data-prueba="fichaje-pendiente"]')
  for (let i = 0; i < 4; i++) {
    await expect(confirmar.or(final).first()).toBeVisible({ timeout: 20_000 })
    if (await final.first().isVisible()) return
    await confirmar.first().click()
  }
  await expect(final.first()).toBeVisible()
}

test('el trabajador ficha entrada y salida desde su portal, y ve lo que se guardó', async ({ page, context }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, TRABAJADOR)
  await alInicio(page)

  // Una jornada abierta de un run anterior se cierra antes de empezar.
  if (await jornadaAbierta(page)) {
    await fichar(page)
    await alInicio(page)
  }

  await test.step('entrada', async () => {
    await fichar(page)
    await expect(page.locator('[data-prueba="fichaje-hecho"]')).toHaveText(/^Entrada \d{2}:\d{2} · /)
    if (await page.locator('[data-prueba="lo-que-se-guardo"]').isVisible()) {
      await expect(page.locator('[data-prueba="lo-que-se-guardo"]')).toContainText('la del servidor')
    }
    await captura(page, '1-entrada-hecha')
  })

  await test.step('salida sin red: se queda en el móvil y lo dice', async () => {
    await alInicio(page)
    await botonDeLaPortada(page, 'salida').click()
    const boton = page.getByRole('button', { name: /FICHAR SALIDA/ })
    await botonActivo(page, boton)
    await context.setOffline(true)
    await boton.click()
    const confirmar = page.getByRole('button', { name: /^(Fichar igualmente|Sí, me voy|Sí, fichar SALIDA)$/ })
    const pendiente = page.getByText(/Sin conexión: tu salida está guardada en este móvil/)
    for (let i = 0; i < 4; i++) {
      await expect(confirmar.or(pendiente).first()).toBeVisible({ timeout: 20_000 })
      if (await pendiente.isVisible()) break
      await confirmar.first().click()
    }
    await expect(pendiente).toBeVisible()
    await captura(page, '2-salida-sin-red')
    await context.setOffline(false)
  })

  await test.step('al volver la red: se envía, o sale el aviso con el motivo', async () => {
    await alInicio(page)
    const aviso = page.locator('[data-prueba="fichajes-pendientes"]')
    await expect(aviso).toBeVisible({ timeout: 30_000 })
    await expect(aviso).toContainText(/Se ha enviado el fichaje|No se ha podido guardar tu salida/, { timeout: 90_000 })
    await captura(page, '3-aviso-de-lo-pendiente')
    const quitar = aviso.getByRole('button', { name: /quitar este aviso/ })
    if (await quitar.isVisible()) await quitar.click()
  })

  await test.step('la jornada queda cerrada', async () => {
    await alInicio(page)
    if (await jornadaAbierta(page)) {
      await fichar(page)
      await expect(page.locator('[data-prueba="fichaje-hecho"]')).toHaveText(/^Salida \d{2}:\d{2} · /)
      await captura(page, '4-salida-hecha')
      await alInicio(page)
    }
    await expect(botonDeLaPortada(page, 'entrada')).toBeVisible()
  })

  expect(errores, 'errores de la página al fichar').toEqual([])
})

test('Mis ajustes cuenta qué se guarda al fichar, para qué y cuánto tiempo', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, TRABAJADOR)
  await page.goto('/')
  await page.getByText('Mi Portal', { exact: true }).first().click({ timeout: 30_000 })
  await page.getByText('Mis ajustes', { exact: true }).first().click()
  const texto = page.locator('[data-prueba="que-se-guarda"]')
  await texto.getByRole('button').first().click()
  await expect(texto).toContainText('solo en el momento de fichar')
  await expect(texto).toContainText('La ubicación exacta, tres meses')
  await expect(texto).toContainText('cuatro años')
  await captura(page, '5-mis-ajustes-que-se-guarda')
  expect(errores, 'errores de la página en Mis ajustes').toEqual([])
})

test('Control horario: abre, y la empresa descarga el texto de qué se guarda', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/personal/control-horario', { timeout: 30_000 })
  const descargar = page.locator('[data-prueba="descargar-que-se-guarda"]')
  await expect(descargar).toBeVisible({ timeout: 30_000 })
  const [descarga] = await Promise.all([page.waitForEvent('download'), descargar.click()])
  expect(descarga.suggestedFilename()).toBe('registro-de-jornada-que-se-guarda.html')
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await captura(page, '6-control-horario')
  expect(errores, 'errores de la página en Control horario').toEqual([])
})
