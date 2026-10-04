/// <reference lib="dom" />
// tests/e2e/conta/c00/proveedores-de-siempre.spec.ts
//
// Respuesta 7 del C00: el C01 se separa de #138 y Foodint queda exactamente
// como hoy. Cocina › Proveedores es la pantalla de siempre (SuppliersPage),
// para toda cuenta: la ruta ya no depende de nada del módulo de contabilidad,
// ni del interruptor `conta`. La cuenta A lo tiene encendido y aun así ve la de
// siempre, que es el caso más exigente: si la ficha nueva se colase por el
// interruptor, saldría aquí.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

test('cuenta A: Cocina › Proveedores es la pantalla de siempre', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/kitchen/proveedores')
  await expect(page.getByRole('heading', { level: 2, name: 'Proveedores' })).toBeVisible()
  await expect(page.getByPlaceholder('Buscar por nombre o CIF…')).toBeVisible()
  await expect(page.getByRole('button', { name: /Nuevo proveedor/ })).toBeVisible()
  // Lo de la ficha nueva del C01 no está: ni sus apartados ni su «Subir factura».
  await expect(page.getByText('Subir factura')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Datos fiscales/ })).toHaveCount(0)
})
