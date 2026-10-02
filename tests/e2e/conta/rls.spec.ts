/// <reference lib="dom" />
// tests/e2e/conta/rls.spec.ts
//
// RLS entre las dos cuentas de prueba (encargo C01 §7.4 y respuesta 1 punto 4):
// la cuenta B no ve ni puede tocar proveedores, contactos ni pagos de la A.
// Por la API con la sesión de B (lo mismo que haría su navegador) y por la
// pantalla. Primero, el control: A sí ve lo suyo; si no, la prueba no prueba nada.
//
// No escribe nada en A: si alguna escritura de B entrase, la prueba falla Y
// lo dice, y las semillas se vuelven a cargar con seed_c01_capturas.sql.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo, pedirSesion } from './sesion'
import { rest } from './api'

test('la cuenta B no ve ni toca nada de la cuenta A', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La RLS no depende del tamaño de pantalla')
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)

  // Control: A ve a Hermanos Ruiz, sus contactos y su factura por pagar.
  const suyo = await rest<{ id: string }[]>(a, 'GET', `supplier?select=id&id=eq.${HERMANOS_RUIZ}`)
  expect(suyo.datos).toHaveLength(1)
  const contactosA = await rest<unknown[]>(a, 'GET', `supplier_contact?select=id&supplier_id=eq.${HERMANOS_RUIZ}`)
  expect(contactosA.datos.length).toBeGreaterThan(0)
  const facturaA = await rest<{ id: string }[]>(a, 'GET', `supplier_invoice?select=id&supplier_id=eq.${HERMANOS_RUIZ}&invoice_number=eq.F-2026-0915`)
  expect(facturaA.datos).toHaveLength(1)
  const factura = facturaA.datos[0].id

  // B no VE nada de A.
  for (const ruta of [
    `supplier?select=id&id=eq.${HERMANOS_RUIZ}`,
    `supplier?select=id&account_id=eq.${CUENTA_A.id}`,
    `supplier_contact?select=id&supplier_id=eq.${HERMANOS_RUIZ}`,
    `supplier_proposal?select=id&account_id=eq.${CUENTA_A.id}`,
    `supplier_invoice?select=id&id=eq.${factura}`,
    `supplier_invoice_payment_log?select=id&account_id=eq.${CUENTA_A.id}`,
  ]) {
    const r = await rest<unknown[]>(b, 'GET', ruta)
    expect(r.status, ruta).toBe(200)
    expect(r.datos, ruta).toEqual([])
  }

  // B no MODIFICA nada de A: ni el proveedor, ni sus contactos, ni el pago.
  const cambio = await rest<unknown[]>(b, 'PATCH', `supplier?id=eq.${HERMANOS_RUIZ}`, { notes: 'escrito por la cuenta B' })
  expect(cambio.datos).toEqual([])
  const borrado = await rest<unknown[]>(b, 'DELETE', `supplier_contact?supplier_id=eq.${HERMANOS_RUIZ}`)
  expect(borrado.datos).toEqual([])
  const intruso = await rest(b, 'POST', 'supplier_contact', { account_id: CUENTA_A.id, supplier_id: HERMANOS_RUIZ, name: 'Intruso B' })
  expect(intruso.status).toBeGreaterThanOrEqual(400)
  for (const [rpc, args] of [
    ['mark_supplier_invoice_paid', { p_invoice_id: factura, p_paid_at: '2026-10-02', p_method: 'cash' }],
    ['unmark_supplier_invoice_paid', { p_invoice_id: factura }],
    ['set_supplier_invoice_due_date', { p_invoice_id: factura, p_due_date: '2026-12-31' }],
  ] as const) {
    const r = await rest<{ message?: string }>(b, 'POST', `rpc/${rpc}`, args)
    expect(r.status, rpc).toBeGreaterThanOrEqual(400)
    expect(r.datos.message, rpc).toContain('No encuentro esa factura')
  }

  // Y A sigue igual: la factura por pagar, sin notas de B, con sus contactos.
  const despues = await rest<{ status: string; due_date: string; paid_at: string | null }[]>(a, 'GET', `supplier_invoice?select=status,due_date,paid_at&id=eq.${factura}`)
  expect(despues.datos[0]).toEqual({ status: 'aprobada', due_date: '2026-10-24', paid_at: null })
  const notas = await rest<{ notes: string | null }[]>(a, 'GET', `supplier?select=notes&id=eq.${HERMANOS_RUIZ}`)
  expect(notas.datos[0].notes).not.toBe('escrito por la cuenta B')
  const contactosDespues = await rest<unknown[]>(a, 'GET', `supplier_contact?select=id&supplier_id=eq.${HERMANOS_RUIZ}`)
  expect(contactosDespues.datos.length).toBe(contactosA.datos.length)

  // Por la pantalla: B abre la dirección de la ficha de A y no la ve.
  await entrarComo(page, CUENTA_B.email)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}`)
  await expect(page.getByText('Ese proveedor no existe o no es de esta cuenta.')).toBeVisible()
  await expect(page.getByText('Hermanos Ruiz')).toHaveCount(0)
})
