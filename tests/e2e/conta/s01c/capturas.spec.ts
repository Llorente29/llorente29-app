/// <reference lib="dom" />
// tests/e2e/conta/s01c/capturas.spec.ts
//
// S01c · Las capturas de ANTES y DESPUÉS del PR 1 (encargo S01b, 18/10), con
// la marca Sumied, en ordenador y móvil: el logo, la barra (desplegada,
// plegada y en el móvil), el asiento nuevo, el IBAN de Bancos y cajas, los
// Acumulados, una tabla apilada y la cabecera con el ejercicio. Solo mira:
// no escribe nada (la barra plegada se deja como estaba).
// FASE dice con qué nombre salen: «antes» en el commit que solo trae esta
// prueba; «despues» desde el arreglo.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'

const FASE = 'antes'
const DIR = 'docs/conta/capturas/s01c'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function cargada(page: Page) {
  await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}
async function ir(page: Page, ruta: string) {
  await page.goto(`/conta/${ruta}${ruta.includes('?') ? '&' : '?'}marca=sumied`)
  await cargada(page)
}
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${FASE}-${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })

const PANTALLAS: { nombre: string; ruta: string; cuenta?: 'B' }[] = [
  { nombre: 'inicio', ruta: 'inicio' },
  { nombre: 'expedida', ruta: 'libros/diario/nuevo?tipo=expedida' },
  { nombre: 'libro-diario', ruta: 'libros/diario' },
  { nombre: 'bancos-y-cajas', ruta: 'ajustes/tablas/bancos-y-cajas' },
  { nombre: 'acumulados', ruta: 'libros/mayor/acumulados' },
  { nombre: 'sumas-saldos', ruta: 'libros/mayor/sumas-saldos' },
  { nombre: 'registro-recibidas', ruta: 'libros/registro/recibidas' },
  { nombre: 'cuentas-anuales', ruta: 'libros/anuales/cuentas-anuales' },
  { nombre: 'ejercicios', ruta: 'libros/cierre/ejercicios' },
  { nombre: 'diario-resumido', ruta: 'libros/diario/resumido' },
  { nombre: 'inicio-b', ruta: 'inicio', cuenta: 'B' },
]

for (const p of PANTALLAS) {
  test(`${FASE} · ${p.nombre}`, async ({ page }) => {
    await entrarComo(page, (p.cuenta === 'B' ? CUENTA_B : CUENTA_A).email)
    await ir(page, p.ruta)
    await foto(page, p.nombre)
  })
}

test(`${FASE} · la expedida con importes que no cuadran`, async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'libros/diario/nuevo?tipo=expedida')
  const debe = page.getByLabel('Debe del apunte 1')
  if (await debe.count()) await debe.fill('121')
  await page.waitForTimeout(300)
  await foto(page, 'expedida-sin-cuadrar')
})

test(`${FASE} · la barra plegada (ordenador) y el menú (móvil)`, async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'inicio')
  if (lado(page) === 'ordenador') {
    const plegar = page.getByRole('button', { name: 'Plegar el menú' })
    if (await plegar.count() === 0) return
    await plegar.click()
    await page.waitForTimeout(800)
    await foto(page, 'barra-plegada')
    await page.getByRole('button', { name: 'Desplegar el menú' }).click()
    await page.waitForTimeout(800)
  } else {
    // Antes: la barra de abajo con «Más»; después: el botón de menú abre el cajón.
    const menu = page.getByRole('button', { name: /^(Más|Abrir el menú)$/ }).first()
    if (await menu.count() === 0) return
    await menu.click()
    await page.waitForTimeout(600)
    await foto(page, 'menu')
  }
})
