/// <reference lib="dom" />
// tests/e2e/conta/flujos.spec.ts
//
// Los flujos que pide el encargo C01 (§7.3), en ordenador y en móvil, contra
// staging-conta:
//   · crear un proveedor;
//   · NIF e IBAN inválidos rechazados con su mensaje;
//   · una propuesta leída de una factura que se confirma;
//   · completar la ficha hasta el 100 %;
//   · marcar una factura como pagada y ver cambiar «Le debes» y «Próximo pago».
// Y VIES de verdad (solo en ordenador: una consulta real por ejecución).
//
// Cada prueba crea SU proveedor y lo borra al terminar: no toca las semillas.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from './sesion'
import { borrarProveedor, cifInventado, rest } from './api'

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const enDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

let sesion: Sesion
const creados: string[] = []

test.beforeEach(async ({ page }) => {
  sesion = await entrarComo(page, CUENTA_A.email)
})

test.afterEach(async () => {
  while (creados.length) await borrarProveedor(sesion, creados.pop()!)
})

async function crearProveedor(page: Page, nombre: string, nif: string): Promise<string> {
  await page.goto('/kitchen/proveedores')
  await page.getByRole('button', { name: 'Nuevo proveedor' }).click()
  await page.getByLabel('Nombre con el que lo conocéis').fill(nombre)
  await page.getByLabel('NIF (opcional)').fill(nif)
  await page.getByRole('button', { name: 'Crear y completar su ficha' }).click()
  await page.waitForURL(/\/kitchen\/proveedores\/[0-9a-f-]{36}\/datos-fiscales$/)
  const id = page.url().split('/').slice(-2)[0]
  creados.push(id)
  return id
}

const ficha = (id: string, ap?: string) => `/kitchen/proveedores/${id}${ap ? `/${ap}` : ''}`

test('crear, rechazar lo malo, confirmar lo leído y completar la ficha al 100 %', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  const nif = cifInventado()
  const id = await crearProveedor(page, `Prueba e2e ${info.project.name} ${Date.now()}`, nif)

  // Nace con el NIF comprobado (pasó el algoritmo al crearlo).
  await expect(page.getByLabel('NIF', { exact: true })).toHaveValue(nif)

  // NIF inválido: se dice al momento y no se guarda.
  const malo = nif.slice(0, -1) + String((Number(nif.slice(-1)) + 1) % 10)
  await page.getByLabel('NIF', { exact: true }).fill(malo)
  await expect(page.getByText(/no cuadra/).first()).toBeVisible()
  await page.getByLabel('NIF', { exact: true }).fill(nif)

  // Una propuesta leída de una factura: se enseña con su origen y se confirma.
  const p = await rest(sesion, 'POST', 'supplier_proposal', {
    account_id: CUENTA_A.id, supplier_id: id, field: 'legal_name',
    value: 'Prueba Leída de Factura, S.L.', source: 'supplier_invoice', source_label: 'Leído de su factura F-E2E-1',
  })
  expect(p.status).toBe(201)
  await page.reload()
  await expect(page.getByText('Leído de su factura F-E2E-1')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText('Leído de su factura F-E2E-1')).toHaveCount(0)
  await expect(page.getByLabel('Razón social')).toHaveValue('Prueba Leída de Factura, S.L.')

  // Datos fiscales.
  await page.getByLabel('Calle y número').fill('C/ Prueba 1')
  await page.getByLabel('Código postal').fill('28021')
  await page.getByLabel('Población').fill('Madrid')
  await expect(page.getByLabel('Provincia')).toHaveValue('Madrid') // sale del CP
  await page.getByLabel('Régimen de IVA').selectOption('general')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Datos fiscales guardados.')).toBeVisible()

  // Contabilidad: tipo de gasto.
  await page.goto(ficha(id, 'contabilidad'))
  await page.getByLabel('Sus facturas se apuntan en').selectOption({ label: 'Comida y bebida' })
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText(/Sus facturas se apuntan en Comida y bebida/)).toBeVisible()

  // Pago: IBAN malo rechazado, y luego el bueno.
  await page.goto(ficha(id, 'pago'))
  await page.getByLabel('Forma de pago').selectOption('transfer')
  await page.getByLabel('Plazo (días desde la factura)').fill('30')
  await page.getByLabel('IBAN', { exact: true }).fill('ES91 2100 0418 4502 0005 1333')
  await expect(page.getByText('Este IBAN no es correcto: revisa los dígitos.')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Forma de pago guardada.')).toHaveCount(0)
  await page.getByLabel('IBAN', { exact: true }).fill('ES91 2100 0418 4502 0005 1332')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Guardado. IBAN comprobado.')).toBeVisible()

  // Contactos: pedidos y administración.
  await page.goto(ficha(id, 'contactos'))
  for (const [nombre, rol, tel] of [['Ana Prueba', 'orders', '600 111 222'], ['Luis Prueba', 'admin', '600 333 444']]) {
    await page.getByRole('button', { name: '+ Añadir contacto' }).click()
    await page.getByLabel('Nombre', { exact: true }).fill(nombre)
    await page.getByLabel('Qué lleva').selectOption(rol)
    await page.getByLabel('Teléfono').fill(tel)
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(nombre)).toBeVisible()
  }

  // Documentos: el certificado del banco.
  await page.goto(ficha(id, 'documentos'))
  await page.getByLabel('Certificado de titularidad bancaria').setInputFiles({
    name: 'certificado-prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% prueba e2e\n'),
  })
  await expect(page.getByText(/Certificado del banco subido/)).toBeVisible()

  // Al 100 %.
  await page.goto(ficha(id))
  await expect(page.getByText('Ficha al 100 %').first()).toBeVisible()
  if (!movil) await expect(page.getByText('No falta nada.')).toBeVisible()
})

test('marcar una factura como pagada cambia «Le debes» y «Próximo pago»', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  const id = await crearProveedor(page, `Prueba pago ${info.project.name} ${Date.now()}`, cifInventado())
  const venc = enDias(30)
  const f = await rest(sesion, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, supplier_id: id, invoice_number: 'F-E2E-PAGO', invoice_date: hoy(),
    status: 'aprobada', tax_base_total: 102.02, tax_total: 21.43, grand_total: 123.45, due_date: venc,
  })
  expect(f.status).toBe(201)

  await page.goto(ficha(id))
  await expect(page.getByText('123,45 €').first()).toBeVisible()          // Le debes
  if (!movil) await expect(page.getByText('Próximo pago')).toBeVisible()

  if (movil) await page.goto(ficha(id, 'facturas'))
  await page.getByRole('button', { name: /Factura F-E2E-PAGO/ }).click()
  await page.getByRole('button', { name: 'Marcar como pagada' }).click()
  await expect(page.getByText(/F-E2E-PAGO marcada como pagada/)).toBeVisible()

  await page.goto(ficha(id))
  if (movil) {
    await expect(page.getByText('nada pendiente')).toBeVisible()
  } else {
    await expect(page.getByText('Nada pendiente')).toBeVisible()              // Próximo pago
    await expect(page.locator('.cf-cifra').filter({ hasText: 'Le debes' })).toContainText('0 €')
  }
  // Y deshacer lo devuelve.
  if (movil) await page.goto(ficha(id, 'facturas'))
  await page.getByRole('button', { name: /Factura F-E2E-PAGO/ }).click()
  await page.getByRole('button', { name: 'Deshacer el pago' }).click()
  await expect(page.getByText(/vuelve a estar por pagar/)).toBeVisible()
})

test('VIES de verdad: un NIF-IVA europeo real queda comprobado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Una consulta real a VIES por ejecución basta')
  // IE6388047V: Google Ireland Ltd., NIF-IVA público y en alta en VIES.
  const id = await crearProveedor(page, `Prueba VIES ${Date.now()}`, '')
  await page.getByLabel('Tipo de NIF').selectOption('vat_eu')
  await page.getByLabel('NIF-IVA (con las letras del país delante)').fill('IE6388047V')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Comprobado en VIES (registro europeo)')).toBeVisible({ timeout: 30_000 })
  const r = await rest<{ tax_id_check_status: string; tax_id_verified_at: string | null }[]>(
    sesion, 'GET', `supplier?select=tax_id_check_status,tax_id_verified_at&id=eq.${id}`)
  expect(r.datos[0].tax_id_check_status).toBe('valid')
  expect(r.datos[0].tax_id_verified_at).not.toBeNull()
})
