/// <reference lib="dom" />
// tests/e2e/conta/x27c/fiel.spec.ts — X27c · La ficha, fiel a ERP10 también en una pantalla grande (respuesta X27 · 1),
// contra staging, a 1366 × 768 y a 1920 × 1080, en la gestoría de ejemplo del núcleo (semillas K02, K04 y K05):
//   · la ficha del «Proveedor de Prueba Ficha Uno», la del «Cliente de Prueba Emitida Uno» y el asiento general nuevo
//     no pasan del ancho máximo de la ventana (el de la maqueta a 1366);
//   · ninguna casilla corta se estira: el NIF, el código postal, los días y el % deducible miden lo mismo a 1366 que a
//     1920, y el rótulo «% I.V.A. deducible» se lee entero;
//   · los tres bloques, en su recuadro, y «Página web» y «Subcuenta suplidos» en la ficha;
//   · el teléfono se guarda en el contacto principal del proveedor (una sola verdad, la de Cocina), y el aviso sin
//     punto doble («…, S.L.»).
// Nombres inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x27c'
const PROVEEDOR = () => enCarril('c0e40000-0000-4000-8000-0000000000a1')
const CLIENTE = () => enCarril('c0e50000-0000-4000-8000-0000000000c1')
/** El ancho máximo de la ventana (piezas.css, --kp-ventana-max), con un píxel de holgura. */
const VENTANA_MAX = 1351
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

/** Lo que mide cada casilla (px) y la ventana. */
const medir = (page: Page, ids: readonly string[]) => zona(page).evaluate((z, lista) => {
  const ancho = (s: string) => { const e = z.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : null }
  return { ventana: ancho('.kp-ventana'), ...Object.fromEntries((lista as string[]).map((i) => [i, ancho(`#${i}`)])) } as Record<string, number | null>
}, ids)

const medidas: Record<number, Record<string, number | null>> = {}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`X27c · ${ancho} × ${alto}: la ficha y el asiento general no se estiran; cada casilla mide lo que su dato`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(150_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)

    // La ficha del proveedor.
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${PROVEEDOR()}`, { timeout: 30_000 })
    const ficha = zona(page).locator('[data-prueba="ficha-proveedor-nucleo"]')
    await expect(ficha).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#ft-nombre')).toHaveValue(/Ficha Uno/, { timeout: 30_000 })
    const m = await medir(page, ['ft-nombre', 'ft-nif', 'ft-postal', 'ft-dias', 'ft-deducible', 'ft-correo', 'ft-observaciones', 'ft-web', 'ft-suplidos'])
    console.log(`[X27c] ${ancho} · proveedor ${JSON.stringify(m)}`)
    medidas[ancho] = m
    expect(m.ventana!, 'la ventana no pasa del ancho máximo').toBeLessThanOrEqual(VENTANA_MAX)
    expect(m['ft-nif']!, 'el NIF es corto').toBeLessThanOrEqual(112)
    expect(m['ft-postal']!, 'el código postal es corto').toBeLessThanOrEqual(66)
    expect(m['ft-dias']!, 'los días, tres cifras').toBeLessThanOrEqual(50)
    expect(m['ft-nombre']!, 'el nombre, largo con tope').toBeLessThanOrEqual(562)
    expect(m['ft-web'], '«Página web» en la ficha').not.toBeNull()
    expect(m['ft-suplidos'], '«Subcuenta suplidos» en la ficha').not.toBeNull()
    const rotulo = ficha.locator('label[for="ft-deducible"]')
    expect(await rotulo.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'el rótulo «% I.V.A. deducible», entero').toBe(true)
    await expect(ficha.locator('[data-pieza="bloque"][data-recuadro="si"]')).toHaveCount(3)
    await page.screenshot({ path: `${DIR}/proveedor-${ancho}.png` })

    // El teléfono, una sola verdad: el contacto principal del proveedor (supplier_contact), el que usa Cocina.
    const tel = `9${String(Date.now() % 100000000).padStart(8, '0')}`
    await page.locator('#ft-telefono').fill(tel)
    await ficha.locator('[data-boton="guardar"]').click()
    await expect(ficha.locator('.kp-barra-aviso')).toContainText('Guardado: Proveedor de Prueba Ficha Uno, S.L.', { timeout: 30_000 })
    await expect(ficha.locator('.kp-barra-aviso')).not.toContainText('S.L..')
    const r = await fetch(`${STAGING_URL}/rest/v1/supplier_contact?select=phone&supplier_id=eq.${PROVEEDOR()}&is_primary=eq.true`,
      { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })
    expect(await r.json(), 'el teléfono, en su contacto principal').toEqual([{ phone: tel }])

    // La del cliente.
    await page.goto(`/conta/clientes-y-proveedores/${CLIENTE()}`, { timeout: 30_000 })
    const cli = zona(page).locator('[data-prueba="ficha-cliente-nucleo"]')
    await expect(cli).toBeVisible({ timeout: 30_000 })
    const mc = await medir(page, ['ft-nif', 'ft-postal', 'ft-dias'])
    expect(mc.ventana!).toBeLessThanOrEqual(VENTANA_MAX)
    expect(mc['ft-nif']!).toBeLessThanOrEqual(112)
    await page.screenshot({ path: `${DIR}/cliente-${ancho}.png` })

    // El asiento general (la misma pieza de ventana).
    await page.goto('/conta/libros/diario/nuevo', { timeout: 30_000 })
    await expect(zona(page).locator('#ag-fecha')).toBeVisible({ timeout: 30_000 })
    const ma = await medir(page, ['ag-fecha'])
    console.log(`[X27c] ${ancho} · asiento general ${JSON.stringify(ma)}`)
    expect(ma.ventana!, 'el asiento general no pasa del ancho máximo').toBeLessThanOrEqual(VENTANA_MAX)
    await page.screenshot({ path: `${DIR}/asiento-${ancho}.png` })

    // A 1920, las casillas cortas miden lo mismo que a 1366 (no se estiran).
    if (ancho === 1920 && medidas[1366]) {
      for (const k of ['ft-nif', 'ft-postal', 'ft-dias', 'ft-deducible', 'ft-nombre']) {
        expect(Math.abs((medidas[1920][k] ?? 0) - (medidas[1366][k] ?? 0)), `${k} mide lo mismo a 1366 y a 1920`).toBeLessThanOrEqual(1)
      }
    }
    expect(errores).toEqual([])
  })
}
