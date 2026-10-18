/// <reference lib="dom" />
// tests/e2e/conta/s01d/capturas.spec.ts
//
// S01d · Las capturas de ANTES y DESPUÉS del PR 2 (encargo S01b, 18/10), con
// la marca Sumied, en ordenador y móvil: la cabecera del móvil (la empresa
// entera), la expedida y su PDF, las recibidas (crear una a mano), Contactos
// y «Subir factura» (dar de alta un proveedor) y el banco sin banco (cuenta
// B). Solo mira: no escribe nada.
// FASE dice con qué nombre salen: «antes» en el commit que solo trae esta
// prueba; «despues» desde el arreglo.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'

const FASE = 'antes'
const DIR = 'docs/conta/capturas/s01d'
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
  { nombre: 'libro-diario', ruta: 'libros/diario' },
  { nombre: 'expedida', ruta: 'libros/diario/nuevo?tipo=expedida' },
  { nombre: 'recibidas', ruta: 'libros/diario/recibidas' },
  { nombre: 'registro-recibidas', ruta: 'libros/registro/recibidas' },
  { nombre: 'contactos', ruta: 'clientes-y-proveedores' },
  { nombre: 'contactos-proveedores', ruta: 'clientes-y-proveedores?ver=proveedores' },
  { nombre: 'subir-factura', ruta: 'compras?subir=' },
  { nombre: 'bancos-b', ruta: 'bancos', cuenta: 'B' },
  { nombre: 'bancos-cuentas-b', ruta: 'bancos/cuentas', cuenta: 'B' },
]

for (const p of PANTALLAS) {
  test(`${FASE} · ${p.nombre}`, async ({ page }) => {
    await entrarComo(page, (p.cuenta === 'B' ? CUENTA_B : CUENTA_A).email)
    await ir(page, p.ruta)
    await foto(page, p.nombre)
  })
}

test(`${FASE} · el menú del móvil`, async ({ page }) => {
  if (lado(page) !== 'movil') return
  await entrarComo(page, CUENTA_A.email)
  await ir(page, 'libros/diario')
  await page.getByRole('button', { name: 'Abrir el menú' }).click()
  await page.waitForTimeout(600)
  await foto(page, 'menu')
})
