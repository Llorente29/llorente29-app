/// <reference lib="dom" />
// tests/e2e/laboral/datos-trabajadores.spec.ts
//
// L00 · Respuesta 1 (27/10/2026): cerrar los datos de los trabajadores no deja
// cojo a Folvy. En staging-conta, cuenta A:
//   · el trabajador de prueba, en móvil: su portal abre, «Mis documentos» es de
//     solo lectura (sin «Subir») y dice a quién entregar un parte, y «Cambios
//     de turno» abre;
//   · el administrador, en ordenador: Empleados, el kiosko y Control horario
//     abren sin error de página.
// Lo que ve cada uno en la base lo prueba la de staging en ROLLBACK
// (supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql). Aquí,
// que las pantallas siguen funcionando, con la base de staging tal como esté:
// el front vale para la base de antes y para la de después de la 1215.

import { test, expect } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../conta/sesion'

const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')

test('el portal del trabajador sigue abriendo: Mis documentos, solo lectura; Cambios de turno', async ({ page }) => {
  test.skip(test.info().project.name !== 'movil', 'el portal, en móvil')
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, TRABAJADOR)
  await page.goto('/')
  await page.getByText('Mi Portal', { exact: true }).first().click({ timeout: 20_000 })
  await page.getByText('Mis documentos', { exact: true }).first().click()
  await expect(page.getByText(/Dáselo a tu encargado/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Subir/ })).toHaveCount(0)
  await page.goto('/')
  await page.getByText('Mi Portal', { exact: true }).first().click({ timeout: 20_000 })
  await page.getByText('Cambios de turno', { exact: true }).first().click()
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  expect(errores, 'errores de la página en el portal').toEqual([])
})

test('Personal sigue abriendo para el administrador: Empleados, Kiosko y Control horario', async ({ page }) => {
  test.skip(test.info().project.name !== 'ordenador', 'Personal, en ordenador')
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await entrarComo(page, CUENTA_A.email)
  for (const ruta of ['/personal', '/personal/kiosko', '/personal/control-horario']) {
    await page.goto(ruta, { timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
    await expect(page).toHaveURL(new RegExp(ruta.replace(/\//g, '\\/')))
  }
  expect(errores, 'errores de la página en Personal').toEqual([])
})
