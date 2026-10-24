/// <reference lib="dom" />
// tests/e2e/conta/d01/nif-de-la-ficha.spec.ts
//
// N1 · El NIF de la ficha del proveedor, desde la factura y antes de validar
// (Julio, 23/10: CARREFOUR 2026FBFN01634861 seguía sin NIF y bloqueada).
// Contra staging-conta, en ordenador (1440) y móvil (390):
//
//   un proveedor de A sin NIF y una factura suya por revisar, sin lectura (como
//   la de CARREFOUR: el documento no lo trae). La ficha de la factura dice que
//   le falta el NIF y por qué no hay asiento, deja escribirlo, rechaza uno mal
//   escrito con su porqué, y al guardar uno bueno dice «Guardado: … ya tiene el
//   NIF … en su ficha» y su ficha lo tiene (leído por la API, con la misma RLS).
//
// No valida nada. Prepara su proveedor y su factura por la API con la sesión
// de la persona administradora de A, con nombres y un NIF inventados y únicos
// por ejecución (un DNI con su letra), y los borra al acabar.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const QUIEN = 'Prueba e2e N1'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
/** Un DNI inventado con su letra (válido), distinto en cada ejecución. */
function dniInventado(): string {
  const n = 10_000_000 + Math.floor(Math.random() * 89_999_999)
  return `${n}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`
}

async function preparar(s: Sesion, nombre: string, numero: string): Promise<{ proveedor: string; factura: string }> {
  const p = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: nombre })
  expect(p.status, `el proveedor de prueba: ${JSON.stringify(p.datos).slice(0, 300)}`).toBe(201)
  const proveedor = p.datos[0].id
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: proveedor, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: numero, invoice_date: hoy(), status: 'en_revision', source: 'manual',
    tax_base_total: 70.28, tax_total: 13.98, grand_total: 84.26, created_by_name: QUIEN,
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  return { proveedor, factura: f.datos[0].id }
}

async function limpiar(s: Sesion, x: { proveedor: string; factura: string } | null) {
  if (!x) return
  const d1 = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${x.factura}`)
  if (d1.status >= 300) console.log(`[limpieza] la factura: HTTP ${d1.status} ${JSON.stringify(d1.datos).slice(0, 200)}`)
  const d2 = await rest(s, 'DELETE', `supplier?account_id=eq.${CUENTA_A.id}&id=eq.${x.proveedor}`)
  if (d2.status >= 300) console.log(`[limpieza] el proveedor: HTTP ${d2.status} ${JSON.stringify(d2.datos).slice(0, 200)}`)
}

test('N1 · sin NIF en su ficha: se escribe en la factura, se comprueba y se guarda antes de validar, y lo dice', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const marca = `PN1${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const nombre = `Proveedor sin NIF ${marca}`
  let x: { proveedor: string; factura: string } | null = null
  try {
    x = await preparar(s, nombre, `${marca}-1`)
    await page.goto(`/conta/documentos/recibidas/${x.factura}?ver=por-revisar`)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })

    const bloque = page.locator('[data-prueba="nif-de-la-ficha"]')
    await expect(bloque).toContainText(`La ficha de ${nombre} no tiene NIF y el documento no lo trae`, { timeout: 30_000 })
    // Por qué no hay asiento: el de siempre, a la vista.
    await expect(page.getByText(`A ${nombre} le falta el NIF`).first()).toBeVisible({ timeout: 40_000 })

    const campo = page.getByRole('textbox', { name: `NIF de ${nombre}` })
    await campo.fill('12345678A')
    await page.getByRole('button', { name: 'Guardar en su ficha' }).click()
    await expect(page.getByText('La letra no corresponde a ese número: revisa el NIF.')).toBeVisible()

    const nif = dniInventado()
    await campo.fill(nif.toLowerCase())
    await page.getByRole('button', { name: 'Guardar en su ficha' }).click()
    await expect(page.locator('[data-prueba="nif-guardado"]')).toHaveText(`Guardado: ${nombre} ya tiene el NIF ${nif} en su ficha. Vuelvo a preparar el asiento.`, { timeout: 30_000 })
    // La ficha ya tiene NIF: el bloque se va, y el porqué de antes también.
    await expect(bloque).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText(`A ${nombre} le falta el NIF`)).toHaveCount(0, { timeout: 40_000 })

    const r = await rest<{ tax_id: string | null; tax_id_type: string | null; tax_id_check_status: string | null }[]>(s, 'GET',
      `supplier?select=tax_id,tax_id_type,tax_id_check_status&account_id=eq.${CUENTA_A.id}&id=eq.${x.proveedor}`)
    expect(r.datos?.[0]).toEqual({ tax_id: nif, tax_id_type: 'nif_es', tax_id_check_status: 'valid' })
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    await limpiar(s, x)
  }
})
