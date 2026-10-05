/// <reference lib="dom" />
// tests/e2e/conta/c02/propuestas.spec.ts
//
// C02, tarea 5: aceptar una propuesta de la IA sobre el plan (encargo §8,
// «aceptar una propuesta de la IA»). Un proveedor nuevo sin subcuenta → la
// tarjeta verde con su porqué y su confianza → «Prefiero una cuenta común»
// (enlaza con la 40000000, que ya existe: no crea nada que se quede en
// staging) → la pantalla dice lo que ha hecho, y la propuesta no vuelve.
// Al terminar se borra el proveedor de prueba.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { borrarProveedor, rest } from '../api'

const DIR = 'docs/conta/capturas/c02'

test('cuenta A: un proveedor nuevo sin subcuenta, la propuesta con su porqué, y aceptarla', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  // Un proveedor de comida (tipo de gasto de serie, a la 600): le toca el 400.
  const gasto = await rest<{ id: string }[]>(s, 'GET', 'expense_category?select=id&code=eq.food_beverage&is_system=eq.true')
  const nombre = `E2E C02 Propuesta ${Date.now().toString(36)}`
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: nombre, expense_category_id: gasto.datos[0].id })
  expect(r.status, JSON.stringify(r.datos)).toBe(201)
  const id = r.datos[0].id
  try {
    await page.goto('/conta/ajustes/plan')
    await expect(page.getByRole('searchbox', { name: 'Buscar una cuenta' })).toBeVisible()
    const tarjeta = page.getByRole('region', { name: 'Lo que propone Folvy' }).filter({ hasText: nombre })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta).toContainText(/subcuenta\. ¿(Le|Les) creo la suya en el 400\?/)
    await expect(tarjeta).toContainText(new RegExp(`${nombre} → 4000\\d{4}`))
    await expect(tarjeta).toContainText('Confianza alta')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/propuesta-ordenador.png` })

    await tarjeta.getByRole('button', { name: 'Prefiero una cuenta común' }).click()
    await expect(page.getByRole('status').getByText(/^Hecho: \d+ enlaces? cambiados?\. Está en el historial del plan\.$/)).toBeVisible()
    // No vuelve: está contestada.
    await expect(page.getByRole('region', { name: 'Lo que propone Folvy' }).filter({ hasText: nombre })).toHaveCount(0)
    // Y su ficha dice que su cuenta es la común.
    await page.goto(`/kitchen/proveedores/${id}/contabilidad`)
    await expect(page.getByRole('region', { name: 'Sus cuentas' }).locator('.cx-dato').filter({ hasText: 'Su cuenta' })).toContainText('40000000')
  } finally {
    await borrarProveedor(s, id)
  }
})
