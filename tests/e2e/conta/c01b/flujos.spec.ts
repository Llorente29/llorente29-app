/// <reference lib="dom" />
// tests/e2e/conta/c01b/flujos.spec.ts
//
// C01b §7 · Los flujos de la ficha de proveedor, en ordenador y en móvil, con
// las cuentas A y B (B sin `conta`: la ficha funciona entera igual).
//
// Cada prueba crea SU proveedor (nombre con marca de tiempo) y lo borra al
// terminar, con la sesión del usuario (misma RLS que la pantalla): se pueden
// repetir y no gastan las semillas (la dirección «por confirmar» de Mercados
// del Norte y la F-2026-0915 de Hermanos Ruiz se quedan como están para las
// capturas).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { borrarProveedor, cifInventado, rest } from '../api'

const LOCAL_A = 'c01a0000-0000-4000-8000-0000000000a2'
const movil = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768
const ficha = (id: string, ap = '') => `/kitchen/proveedores/${id}${ap ? `/${ap}` : ''}`
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

async function crearPorApi(s: Sesion, accountId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: accountId, name: `E2E C01b ${sello()}`, ...extra })
  expect(r.status, JSON.stringify(r.datos)).toBe(201)
  return r.datos[0].id
}

/** Un NIF con el dígito de control cambiado: tiene que salir el error al momento. */
function nifMalo(): string {
  const bueno = cifInventado()
  const ultimo = Number(bueno.slice(-1))
  return `${bueno.slice(0, -1)}${(ultimo + 1) % 10}`
}

async function salir(page: Page) { await page.keyboard.press('Tab') }

test.describe('cuenta A', () => {
  test('crear, NIF e IBAN inválidos, y completar la ficha al 100 %', async ({ page }) => {
    test.setTimeout(120_000)
    const s = await entrarComo(page, CUENTA_A.email)
    const nombre = `E2E Completo ${sello()}`
    await page.goto('/kitchen/proveedores')
    await page.getByRole('button', { name: 'Nuevo proveedor' }).first().click()
    await page.getByLabel('Nombre con el que lo conocéis').fill(nombre)
    await page.getByLabel('NIF (opcional)').fill(cifInventado())
    await page.getByRole('button', { name: 'Crear y completar su ficha' }).click()
    await expect(page).toHaveURL(/\/kitchen\/proveedores\/[0-9a-f-]+\/datos-fiscales/)
    const id = page.url().match(/proveedores\/([0-9a-f-]+)\//)![1]
    try {
      // NIF inválido: error al momento y no se guarda.
      const nif = page.locator('#campo-taxId')
      const bueno = await nif.inputValue()
      await nif.fill(nifMalo()); await salir(page)
      await expect(nif).toHaveAttribute('aria-invalid', 'true')
      await nif.fill(bueno); await salir(page)
      await expect(nif).toHaveAttribute('aria-invalid', 'false')

      // En el móvil basta con esto y el IBAN; en el ordenador, hasta el 100 %.
      if (!movil(page)) {
        await page.locator('#campo-legalName').fill(`${nombre}, S.L.`); await salir(page)
        await expect(page.getByText('Guardado: razón social.')).toBeVisible()
        await page.locator('#campo-fiscalStreet').fill('Calle de Prueba 1'); await salir(page)
        await page.locator('#campo-fiscalPostalCode').fill('28021'); await salir(page)
        // El CP trae la provincia y la población de la tabla de códigos postales.
        await expect(page.locator('#campo-fiscalProvince')).toHaveValue('Madrid')
        await expect(page.locator('#campo-fiscalCity')).not.toHaveValue('')
        await page.locator('#campo-vatRegime').selectOption('general')
        await expect(page.getByText('Guardado: régimen de IVA.')).toBeVisible()
      }

      await page.goto(ficha(id, 'pago'))
      await page.getByRole('group', { name: 'Forma de pago' }).getByRole('button', { name: 'Transferencia' }).click()
      await expect(page.getByText('Guardado: forma de pago.')).toBeVisible()
      await page.getByRole('group', { name: 'Plazo' }).getByRole('button', { name: '30 días' }).click()
      await expect(page.getByText('Guardado: plazo de pago.')).toBeVisible()
      const iban = page.locator('#campo-iban')
      await iban.fill('ES0000000000000000000000'); await salir(page)
      await expect(iban).toHaveAttribute('aria-invalid', 'true')
      await iban.fill('ES9121000418450200051332'); await salir(page)
      await expect(page.getByText('Guardado: IBAN comprobado.')).toBeVisible()
      if (movil(page)) return

      await page.goto(ficha(id, 'contabilidad'))
      const tipo = page.locator('#campo-expenseCategoryId')
      const primero = await tipo.locator('option').nth(1).getAttribute('value')
      await tipo.selectOption(primero!)
      await expect(page.getByText(/^Guardado: sus facturas van a /)).toBeVisible()

      await page.goto(ficha(id, 'contactos'))
      for (const [papel, nombreC, dato] of [['Pedidos', 'Ana Pedidos', '600000001'], ['Administración', 'Luis Admin', 'admin@e2e.test']] as const) {
        await page.getByRole('button', { name: '+ Añadir contacto' }).click()
        const d = page.getByRole('dialog')
        await d.getByLabel('Nombre', { exact: true }).fill(nombreC)
        await d.getByRole('group', { name: 'Qué lleva' }).getByRole('button', { name: papel }).click()
        await d.getByLabel(dato.includes('@') ? 'Email' : 'Teléfono').fill(dato)
        await d.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText(new RegExp(`${nombreC} añadido como contacto`))).toBeVisible()
      }

      await page.goto(ficha(id, 'documentos'))
      await page.locator('input[aria-label="Certificado de titularidad bancaria"]').setInputFiles({
        name: 'certificado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% e2e C01b\n'),
      })
      await expect(page.getByText(/Certificado del banco subido/)).toBeVisible()

      await page.goto(ficha(id))
      await expect(page.getByText('Ficha al 100 %').first()).toBeVisible()
      await expect(page.getByText('No falta nada.')).toBeVisible()
    } finally {
      await borrarProveedor(s, id)
    }
  })

  test('un dato leído de su factura: se confirma y queda en la ficha', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_A.email)
    const id = await crearPorApi(s, CUENTA_A.id)
    try {
      const p = await rest(s, 'POST', 'supplier_proposal', {
        account_id: CUENTA_A.id, supplier_id: id, field: 'legal_name', value: 'Distribuciones E2E, S.L.',
        source: 'supplier_invoice', source_label: 'Leído de su factura F-E2E-1',
      })
      expect(p.status, JSON.stringify(p.datos)).toBe(201)
      await page.goto(ficha(id, 'datos-fiscales'))
      await expect(page.getByText('Razón social: ¿es esta?')).toBeVisible()
      await expect(page.getByText(/Leído de su factura F-E2E-1/)).toBeVisible()
      await page.getByRole('button', { name: 'Es esta' }).click()
      await expect(page.getByText('Razón social confirmada y guardada en la ficha.')).toBeVisible()
      await expect(page.locator('#campo-legalName')).toHaveValue('Distribuciones E2E, S.L.')
    } finally {
      await borrarProveedor(s, id)
    }
  })

  test('dirección «por confirmar»: se ve el reparto y «Es esta» la guarda repartida', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_A.email)
    const id = await crearPorApi(s, CUENTA_A.id)
    try {
      await rest(s, 'POST', 'supplier_proposal', {
        account_id: CUENTA_A.id, supplier_id: id, field: 'fiscal_address', source: 'legacy_address',
        value: { line: 'Calle Mayor 3, 28100 Alcobendas', street: 'Calle Mayor 3', postal_code: '28100', city: 'Alcobendas', province: 'Madrid' },
      })
      await page.goto(ficha(id, 'datos-fiscales'))
      await expect(page.getByText('Dirección fiscal: ¿es esta?')).toBeVisible()
      await page.getByRole('button', { name: 'Es esta' }).click()
      await expect(page.getByText('Dirección fiscal confirmada y guardada en la ficha.')).toBeVisible()
      await expect(page.locator('#campo-fiscalStreet')).toHaveValue('Calle Mayor 3')
      await expect(page.locator('#campo-fiscalPostalCode')).toHaveValue('28100')
      await expect(page.locator('#campo-fiscalCity')).toHaveValue('Alcobendas')
    } finally {
      await borrarProveedor(s, id)
    }
  })

  test('marcar pagada baja «Le debes» y el próximo pago, y Deshacer lo devuelve; la repetida no cuenta', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_A.email)
    const id = await crearPorApi(s, CUENTA_A.id, { payment_method: 'transfer', payment_terms_days: 30 })
    try {
      const factura = (num: string, status: string) => ({
        account_id: CUENTA_A.id, supplier_id: id, location_id: LOCAL_A, invoice_number: num, invoice_date: '2026-09-20',
        due_date: '2026-10-20', status, tax_base_total: 100, tax_total: 21, grand_total: 121,
      })
      const f1 = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', factura('E2E-001', 'aprobada'))
      expect(f1.status, JSON.stringify(f1.datos)).toBe(201)
      const f2 = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', factura('e2e-001 ', 'aprobada'))
      expect(f2.status, JSON.stringify(f2.datos)).toBe(201)

      const leDebes = page.locator('.cxp-cifra').filter({ hasText: 'Le debes' })
      await page.goto(ficha(id))
      // La repetida no cuenta: 121 €, no 242.
      await expect(leDebes).toContainText('121')
      await expect(leDebes).not.toContainText('242')

      await page.goto(ficha(id, 'facturas'))
      await expect(page.getByText('¿Repetida?')).toBeVisible()
      await page.getByRole('button', { name: 'Ver la factura E2E-001', exact: true }).click()
      await page.getByRole('button', { name: 'Marcar como pagada' }).click()
      await expect(page.getByText(/Factura E2E-001 marcada como pagada el .*Ya no le debes esos 121,00 €\./)).toBeVisible()
      await page.goto(ficha(id))
      await expect(leDebes).toContainText(/nada pendiente/i)
      if (!movil(page)) await expect(page.locator('.cxp-cifra').filter({ hasText: 'Próximo pago' })).toContainText('Nada que pagar')

      // Deshacer (desde la factura pagada) y vuelve a deberse.
      await page.goto(ficha(id, 'facturas'))
      await page.getByRole('button', { name: 'Ver la factura E2E-001', exact: true }).click()
      await page.getByRole('button', { name: 'Deshacer el pago' }).click()
      await expect(page.getByText(/vuelve a estar por pagar/)).toBeVisible()

      // «No es repetida»: entonces sí cuenta.
      await page.getByRole('button', { name: /Ver la factura e2e-001/ }).click()
      await page.getByRole('button', { name: 'No es repetida: apuntarla' }).click()
      await expect(page.getByText(/apuntada: no es repetida/)).toBeVisible()
      await expect(page.getByText('¿Repetida?')).toHaveCount(0)
      await page.goto(ficha(id))
      await expect(leDebes).toContainText('242')
    } finally {
      await borrarProveedor(s, id)
    }
  })

  test('«Artículos que le compras» y «Migrar artículos» funcionan como antes (sin migrar)', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await page.goto(ficha(HERMANOS_RUIZ, movil(page) ? 'articulos' : ''))
    await expect(page.locator('#cxp-articulos')).toHaveText('Artículos que le compras')
    await expect(page.getByText('Tomate pera').first()).toBeVisible()
    await page.getByRole('button', { name: 'Migrar artículos a otro proveedor' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Mover a').selectOption({ label: 'Panadería Luna' })
    await expect(d.getByText(/se mueven directamente/)).toBeVisible()
    // Se ve exactamente qué pasaría, y se cancela: las semillas no se tocan.
    await d.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test('cuenta B (sin `conta`): crear, NIF e IBAN inválidos, igual que A', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_B.email)
  await page.goto('/kitchen/proveedores')
  await page.getByRole('button', { name: 'Nuevo proveedor' }).first().click()
  await page.getByLabel('Nombre con el que lo conocéis').fill(`E2E B ${sello()}`)
  await page.getByRole('button', { name: 'Crear y completar su ficha' }).click()
  await expect(page).toHaveURL(/\/datos-fiscales/)
  const id = page.url().match(/proveedores\/([0-9a-f-]+)\//)![1]
  try {
    const nif = page.locator('#campo-taxId')
    await nif.fill(nifMalo()); await salir(page)
    await expect(nif).toHaveAttribute('aria-invalid', 'true')
    await page.goto(ficha(id, 'pago'))
    const iban = page.locator('#campo-iban')
    await iban.fill('ES0000000000000000000000'); await salir(page)
    await expect(iban).toHaveAttribute('aria-invalid', 'true')
    await iban.fill('ES9121000418450200051332'); await salir(page)
    await expect(page.getByText('Guardado: IBAN comprobado.')).toBeVisible()
  } finally {
    await borrarProveedor(s, id)
  }
})

test('RLS de lo nuevo del C01b: B no ve lo aprendido de A ni puede tocarlo', async ({ page }, info) => {
  void page
  test.skip(info.project.name === 'movil', 'La RLS no depende del tamaño de pantalla')
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)
  // Control: A ve sus filas (al menos lo aprendido de Hermanos Ruiz tras abrir su ficha en las capturas).
  const deA = await rest<unknown[]>(a, 'GET', `supplier_learning?select=id&supplier_id=eq.${HERMANOS_RUIZ}`)
  expect(deA.status).toBe(200)
  for (const ruta of [
    `supplier_learning?select=id&account_id=eq.${CUENTA_A.id}`,
    `supplier_learning_log?select=id&account_id=eq.${CUENTA_A.id}`,
  ]) {
    const r = await rest<unknown[]>(b, 'GET', ruta)
    expect(r.status, ruta).toBe(200)
    expect(r.datos, ruta).toEqual([])
  }
  for (const [rpc, args] of [
    ['supplier_learning_sync', { p_supplier_id: HERMANOS_RUIZ, p_items: [] }],
    ['supplier_learning_fix', { p_supplier_id: HERMANOS_RUIZ, p_campo: 'payment', p_valor: 'cash', p_etiqueta: 'Intruso', p_quien_nombre: 'B' }],
  ] as const) {
    const r = await rest<{ message?: string }>(b, 'POST', `rpc/${rpc}`, args)
    expect(r.status, rpc).toBeGreaterThanOrEqual(400)
    expect(r.datos.message, rpc).toContain('no existe o no es de tu cuenta')
  }
  const intruso = await rest(b, 'POST', 'supplier_learning', {
    account_id: CUENTA_A.id, supplier_id: HERMANOS_RUIZ, campo: 'payment', valor: 'cash', etiqueta: 'x', porque: 'x',
  })
  expect(intruso.status).toBeGreaterThanOrEqual(400)
  // Y A sigue sin nada fijado por B.
  const despues = await rest<{ valor: string }[]>(a, 'GET', `supplier_learning?select=valor&supplier_id=eq.${HERMANOS_RUIZ}&campo=eq.payment`)
  expect(despues.datos.every((x) => x.valor !== 'cash')).toBe(true)
})
