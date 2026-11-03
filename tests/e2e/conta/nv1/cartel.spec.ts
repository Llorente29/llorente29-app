/// <reference lib="dom" />
// tests/e2e/conta/nv1/cartel.spec.ts
//
// NV1 · El cartel de versión nueva dice qué cambia (maqueta «Cartel de
// novedades», aprobada por Julio el 03/11), en el ordenador (1440) y en el
// móvil (390), con una versión simulada:
//   · /version.json dice que hay otra build publicada;
//   · /novedades.json trae lo que cambia: de Sumied, de Folvy y común;
//   · la escritura de lo visto (los datos del usuario) se contesta aquí, para
//     no tocar al usuario de pruebas.
// Lo demás (la sesión, el marco, las dos marcas, las rutas) es staging y el
// código de verdad.
//   1. Sumied: el cartel con las 3 primeras y «y 1 novedad más», la línea de
//      «Se aplica al momento», «Luego» lo quita hasta la próxima versión.
//   2. Sumied: «Ver todas las novedades» lleva a Ayuda › Novedades, por día,
//      con «Nuevo para ti» y el enlace a cada pantalla; lo de Folvy no sale.
//   3. «Actualizar ahora»: apunta lo visto y vuelve a cargar.
//   4. Folvy: su cartel, con lo suyo y lo común; lo de Sumied no sale.
// Cada pantalla, con su captura AL LADO de la maqueta (docs/conta/capturas/nv1).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

// El service worker deja pasar las peticiones a la red sin guardarlas (public/sw.js), pero
// las atiende él: la prueba no vería las suyas y leería el /novedades.json de verdad.
test.use({ serviceWorkers: 'block' })

const DIR = 'docs/conta/capturas/nv1'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function alLado(page: Page, nombre: string, maqueta: 'ordenador' | 'movil' | 'novedades') {
  const l = lado(page)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${l}.png` })
  const pantalla = await page.screenshot()
  const ancho = l === 'movil' ? 390 : 1440
  const m = await page.context().newPage()
  await m.setViewportSize({ width: maqueta === 'novedades' ? 720 : ancho, height: maqueta === 'movil' ? 844 : 900 })
  await m.goto(`file://${process.cwd()}/docs/nv1/maqueta-${maqueta}.html`)
  const dibujo = await m.screenshot()
  await m.close()
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">Maqueta aprobada · ${maqueta}</figcaption><img style="max-width:100%" src="data:image/png;base64,${dibujo.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${nombre}-${l}.png`, fullPage: true })
  await otra.close()
}

const NOVEDADES = [
  { id: '9001-1', pr: 9001, fecha: '2026-11-03T18:00:00Z', producto: 'sumied', apartado: 'Pagos', frase: 'Ya puedes pagar varias facturas de una vez y mandar el justificante por WhatsApp.', ruta: '/conta/compras' },
  { id: '9001-2', pr: 9001, fecha: '2026-11-03T18:00:00Z', producto: 'sumied', apartado: 'Liquidaciones', frase: 'Un mes entero en una pantalla, por plataforma y tienda.', ruta: '/conta/ventas/liquidaciones' },
  { id: '9000-1', pr: 9000, fecha: '2026-11-03T17:00:00Z', producto: 'comun', apartado: 'Novedades', frase: 'Cada versión nueva te dice qué cambia.', ruta: null },
  { id: '8999-1', pr: 8999, fecha: '2026-11-03T16:00:00Z', producto: 'folvy', apartado: 'Cocina', frase: 'La comanda dice para qué hora es.', ruta: null },
  { id: '8998-1', pr: 8998, fecha: '2026-10-30T10:00:00Z', producto: 'sumied', apartado: 'Usuarios', frase: 'Invita a cualquier persona a una o varias empresas y elige qué puede hacer en cada una.', ruta: null },
]

async function simular(page: Page): Promise<{ vistas: unknown[] }> {
  const r = { vistas: [] as unknown[] }
  await page.route(/\/version\.json(\?|$)/, (x) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ buildId: '209912312359-otraversion', builtAt: '2099-12-31T23:59:00Z' }) }))
  await page.route(/\/novedades\.json(\?|$)/, (x) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOVEDADES) }))
  await page.route(/\/auth\/v1\/user(\?|$)/, async (x) => {
    if (x.request().method() !== 'PUT') return x.fallback()
    const cuerpo = x.request().postDataJSON() as { data?: Record<string, unknown> }
    r.vistas.push(cuerpo)
    // El usuario, el del propio token (sub y email): no se escribe nada en staging.
    const token = (x.request().headers()['authorization'] ?? '').replace(/^Bearer\s+/i, '')
    const yo = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as { sub?: string; email?: string }
    return x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: yo.sub, email: yo.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: cuerpo.data ?? {} }) })
  })
  return r
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('1 · Sumied: el cartel dice qué cambia, y «Luego» lo quita hasta la próxima versión', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const r = await simular(page)
  await page.goto('/conta/ventas/liquidaciones?marca=sumied')
  const cartel = page.locator('[data-prueba="cartel-version"]')
  await expect(cartel).toBeVisible({ timeout: 30_000 })
  await expect(cartel.getByRole('heading', { name: 'Hay una versión nueva de Sumied' })).toBeVisible()
  await expect(cartel.locator('[data-prueba="novedades-cartel"] li')).toHaveText([
    'Pagos: Ya puedes pagar varias facturas de una vez y mandar el justificante por WhatsApp.',
    'Liquidaciones: Un mes entero en una pantalla, por plataforma y tienda.',
    'Novedades: Cada versión nueva te dice qué cambia.',
    'Y 1 novedad más.',
  ])
  // Lo de Folvy no sale en Sumied.
  await expect(cartel).not.toContainText('Cocina')
  await expect(cartel.locator('[data-prueba="novedades-nota"]')).toHaveText('Se aplica al momento. No pierdes lo que estabas haciendo.')
  await expect(cartel.getByRole('button', { name: 'Actualizar ahora' })).toBeVisible()
  if (lado(page) === 'movil') {
    expect(await cartel.getAttribute('data-forma')).toBe('hoja')
    expect((await cartel.getByRole('button', { name: 'Actualizar ahora' }).boundingBox())!.height).toBe(48)
  } else {
    expect(await cartel.getAttribute('data-forma')).toBe('cartel')
    expect((await cartel.boundingBox())!.width).toBe(420)
  }
  await alLado(page, 'cartel', lado(page) === 'movil' ? 'movil' : 'ordenador')

  // «Luego»: fuera, y lo visto apuntado (en los datos del usuario: vale en el móvil también).
  await cartel.getByRole('button', { name: 'Luego' }).click()
  await expect(cartel).toHaveCount(0)
  await expect.poll(() => r.vistas.length).toBeGreaterThan(0)
  expect(r.vistas[0]).toMatchObject({ data: { novedades_vistas_hasta: '2026-11-03T18:00:00Z' } })
  // Hasta la próxima versión: al volver a cargar, sigue sin salir.
  await page.reload()
  await page.waitForTimeout(3000)
  await expect(cartel).toHaveCount(0)
  expect(errores).toEqual([])
})

test('2 · Sumied: «Ver todas las novedades» lleva a Ayuda › Novedades', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await simular(page)
  await page.goto('/conta/ventas/liquidaciones?marca=sumied')
  const cartel = page.locator('[data-prueba="cartel-version"]')
  await expect(cartel).toBeVisible({ timeout: 30_000 })
  await cartel.getByRole('link', { name: 'Ver todas las novedades' }).click()
  await expect(page).toHaveURL(/\/conta\/ayuda\/novedades/)
  const pagina = page.locator('[data-prueba="novedades"]')
  await expect(pagina.getByRole('heading', { level: 1, name: 'Novedades de Sumied' })).toBeVisible({ timeout: 30_000 })
  await expect(pagina).toContainText('Ayuda › Novedades')
  const dias = pagina.locator('[data-prueba="novedades-dia"]')
  await expect(dias).toHaveCount(2)
  await expect(dias.nth(0)).toContainText('3 nov 2026')
  await expect(dias.nth(0)).toContainText('Nuevo para ti')
  await expect(dias.nth(0).getByRole('link', { name: 'Ir a Liquidaciones' })).toHaveAttribute('href', '/conta/ventas/liquidaciones')
  await expect(dias.nth(1)).toContainText('Usuarios. Invita a cualquier persona')
  await expect(pagina).not.toContainText('Cocina')
  await alLado(page, 'novedades', 'novedades')
  if (lado(page) === 'ordenador') {
    // También desde la Ayuda de la cabecera.
    await page.getByRole('button', { name: 'Ayuda' }).click()
    await expect(page.locator('[data-prueba="ayuda-novedades"]')).toHaveAttribute('href', '/conta/ayuda/novedades')
  }
  expect(errores).toEqual([])
})

test('3 · «Actualizar ahora» apunta lo visto y vuelve a cargar', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const r = await simular(page)
  await page.goto('/conta/ventas/liquidaciones?marca=sumied')
  const cartel = page.locator('[data-prueba="cartel-version"]')
  await expect(cartel).toBeVisible({ timeout: 30_000 })
  const recarga = page.waitForEvent('load')
  await cartel.getByRole('button', { name: 'Actualizar ahora' }).click()
  await recarga
  expect(r.vistas.at(-1)).toMatchObject({ data: { novedades_vistas_hasta: '2026-11-03T18:00:00Z' } })
  expect(errores).toEqual([])
})

test('4 · Folvy: su cartel, con lo suyo y lo común', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await simular(page)
  await page.goto('/?marca=folvy')
  const cartel = page.locator('[data-prueba="cartel-version"]')
  await expect(cartel).toBeVisible({ timeout: 30_000 })
  await expect(cartel.getByRole('heading', { name: 'Hay una versión nueva de Folvy' })).toBeVisible()
  await expect(cartel.locator('[data-prueba="novedades-cartel"] li')).toHaveText([
    'Novedades: Cada versión nueva te dice qué cambia.',
    'Cocina: La comanda dice para qué hora es.',
  ])
  await expect(cartel).not.toContainText('Liquidaciones')
  await expect(cartel.getByRole('link', { name: 'Ver todas las novedades' })).toHaveAttribute('href', '/configuracion/novedades')
  expect(errores).toEqual([])
})
