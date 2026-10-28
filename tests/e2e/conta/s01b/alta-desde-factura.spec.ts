/// <reference lib="dom" />
// tests/e2e/conta/s01b/alta-desde-factura.spec.ts
//
// S01b · Dar de alta al proveedor desde la propia factura, y que la ficha se
// rellene sola (encargo S01b, «Pruebas»), contra staging-conta, en ordenador
// (1440) y móvil (390):
//
//   una recibida «por revisar» de un proveedor que NO existe (nombre y NIF
//   inventados en cada ejecución), con lo que leyó del papel (dirección,
//   correo, teléfono y web):
//     1. Revisar factura ofrece «Dar de alta a <nombre>»; el formulario sale
//        DENTRO del bloque «Proveedor y factura», relleno con lo leído;
//     2. «Darlo de alta y elegirlo»: queda elegido y guardado en la factura, y
//        lo dice con contenido (regla 8);
//     3. con su cuenta de gasto (la propuesta, o 60000000 si no hay ninguna),
//        se valida: el asiento queda validado;
//     4. la ficha del proveedor sale rellena: NIF, razón social y dirección; el
//        contacto «Facturación» con el correo, el teléfono y la nota «De la
//        factura <número>.»; y, si la base ya tiene la 1304, cada dato con su
//        «De la factura <número>, la guardó …».
//
// Lanzarla dos veces seguidas da lo mismo: cada ejecución inventa su proveedor
// (nombre, NIF con su control bien) y su número, y no depende de nada que deje
// la anterior. Validar deja un asiento para siempre: solo se valida en un
// carril (E2E_CARRIL), que se borra entero al acabar; sin carril, se para
// antes de validar, comprueba la ficha y lo borra todo.
//
// Staging puede no tener aún la 1304 (la e2e va antes del ensayo, regla de
// Julio): el navegador guarda los datos igual, sin su origen, y la prueba lo
// mira con la columna o sin ella. Datos inventados.

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { borrarProveedor, cifInventado, rest } from '../api'

const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const QUIEN = 'Prueba e2e S01b'
const PDF = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'
const GASTO_DE_RESERVA = '60000000'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
/** Hoy en Madrid (AAAA-MM-DD): la factura cae en un periodo abierto y sale su asiento. */
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

interface Papel { nombre: string; nif: string; calle: string; cp: string; ciudad: string; correo: string; telefono: string; web: string }
interface Preparada { id: string; numero: string; ruta: string }

/** Sube el PDF inventado a la carpeta de A, en una ruta única: el documento de la factura. */
async function subirPdf(s: Sesion, nombre: string): Promise<string> {
  const ruta = `${CUENTA_A.id}/s01b-e2e/${nombre}.pdf`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
    body: readFileSync(PDF),
  })
  const t = await r.text()
  expect(r.ok || /exists|duplicate/i.test(t), `subir el PDF de prueba: ${r.status} ${t.slice(0, 200)}`).toBe(true)
  return ruta
}

/** La recibida «por revisar» SIN proveedor, de hoy, con su PDF, una línea al 21 % y lo que leyó del papel. */
async function preparar(s: Sesion, numero: string, p: Papel): Promise<Preparada> {
  const ruta = await subirPdf(s, numero)
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: null, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: numero, invoice_date: hoy(), status: 'en_revision', source: 'ocr',
    tax_base_total: 100, tax_total: 21, grand_total: 121, created_by_name: QUIEN, raw_document_url: ruta,
    needs_review: true, reading_confidence: 'probable',
    reading: {
      porque: ['Prueba e2e S01b.'], comprobaciones: [], confianza: 'probable',
      factura: { proveedor: { nombre: p.nombre, nif: p.nif, direccion: `${p.calle}, ${p.cp} ${p.ciudad}`, email: p.correo, telefono: p.telefono, web: p.web } },
    },
  })
  expect(f.status, `la factura de prueba ${numero}: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  const id = f.datos[0].id
  const l = await rest(s, 'POST', 'supplier_invoice_line', [{ supplier_invoice_id: id, raw_text: 'Material de limpieza', qty: 1, unit_price: 100, line_amount: 100, vat_pct: 21, position: 0 }])
  expect(l.status, `su línea: ${JSON.stringify(l.datos).slice(0, 300)}`).toBe(201)
  return { id, numero, ruta }
}

/** El proveedor dado de alta en la prueba (por su NIF, en la cuenta A). */
async function proveedorPorNif(s: Sesion, nif: string): Promise<{ id: string; tax_id: string; legal_name: string | null; fiscal_street: string | null; fiscal_postal_code: string | null; fiscal_city: string | null; website: string | null } | null> {
  const r = await rest<{ id: string; tax_id: string; legal_name: string | null; fiscal_street: string | null; fiscal_postal_code: string | null; fiscal_city: string | null; website: string | null }[]>(s, 'GET',
    `supplier?select=id,tax_id,legal_name,fiscal_street,fiscal_postal_code,fiscal_city,website&account_id=eq.${CUENTA_A.id}&tax_id=eq.${nif}`)
  return r.datos?.[0] ?? null
}

/** ¿Tiene ya staging la 1304 (supplier.data_from_invoice)? */
async function hayOrigen(s: Sesion): Promise<boolean> {
  const r = await rest(s, 'GET', `supplier?select=data_from_invoice&account_id=eq.${CUENTA_A.id}&limit=1`)
  return r.status === 200
}

async function limpiar(s: Sesion, p: Preparada | null, nif: string) {
  if (p) {
    await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${p.ruta}`, {
      method: 'DELETE', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` },
    }).catch(() => undefined)
    const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${p.id}`)
    if (d.status >= 300) console.log(`[limpieza] la factura ${p.numero}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
  }
  const prov = await proveedorPorNif(s, nif)
  if (prov) {
    await rest(s, 'DELETE', `supplier_contact?supplier_id=eq.${prov.id}`)
    await borrarProveedor(s, prov.id)
  }
}

async function abrirFicha(page: Page, p: Preparada) {
  const laFicha = page.locator('[data-prueba="ficha-recibida"]')
  await page.goto(`/conta/documentos/recibidas/${p.id}?ver=por-revisar&q=${encodeURIComponent(p.numero)}`, { waitUntil: 'load' })
  try {
    await expect(laFicha).toBeVisible({ timeout: 20_000 })
  } catch {
    await page.reload({ waitUntil: 'load' })
    await expect(laFicha).toBeVisible({ timeout: 30_000 })
  }
}

test('S01b · alta desde Revisar factura: el formulario relleno con lo leído, elegido al crearlo, validada y la ficha «de la factura…»', async ({ page }) => {
  test.setTimeout(240_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PS01B${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const papel: Papel = {
    nombre: `Suministros Inventados ${marca} S.L.`, nif: cifInventado(), calle: 'Calle Inventada 9', cp: '28001', ciudad: 'Madrid',
    correo: `facturas@${marca.toLowerCase()}.es`, telefono: '+34 910 000 000', web: `${marca.toLowerCase()}.es`,
  }
  let p: Preparada | null = null
  try {
    p = await preparar(s, marca, papel)
    await abrirFicha(page, p)

    // 1 · «Dar de alta a …», dentro del bloque, con lo leído.
    const enlaces = page.locator('[data-prueba="alta-desde-factura"]')
    await expect(enlaces).toBeVisible({ timeout: 30_000 })
    await enlaces.getByRole('button', { name: `Dar de alta a ${papel.nombre}` }).click()
    const form = page.locator('[data-prueba="formulario-alta-factura"]')
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Nombre con el que lo conocéis')).toHaveValue(papel.nombre)
    await expect(form.getByLabel(/^NIF/)).toHaveValue(papel.nif)
    await expect(form.getByLabel('Dirección fiscal')).toHaveValue(`${papel.calle}, ${papel.cp} ${papel.ciudad}`)
    await expect(form.getByLabel('Correo')).toHaveValue(papel.correo)
    await expect(form.getByLabel('Teléfono')).toHaveValue(papel.telefono)
    await expect(form.getByLabel('Web')).toHaveValue(papel.web)

    // 2 · Crearlo: elegido y guardado en la factura, y dicho.
    await form.getByRole('button', { name: 'Darlo de alta y elegirlo' }).click()
    const dicho = page.locator('[data-prueba="aviso-proveedor"]')
    await expect(dicho).toContainText(`Proveedor ${papel.nombre} dado de alta y elegido para esta factura.`, { timeout: 30_000 })
    await expect(dicho).toContainText('Guardado en la factura')
    await expect(form).toHaveCount(0)
    await expect.poll(async () => (await rest<{ supplier_id: string | null }[]>(s, 'GET', `supplier_invoice?select=supplier_id&account_id=eq.${CUENTA_A.id}&id=eq.${p!.id}`)).datos?.[0]?.supplier_id ?? null,
      { message: 'la factura con su proveedor nuevo, guardado', timeout: 20_000 }).not.toBeNull()
    const prov = await proveedorPorNif(s, papel.nif)
    expect(prov, 'el proveedor nuevo, por su NIF').not.toBeNull()

    // 3 · Su cuenta de gasto: la propuesta, o la de reserva si no hay ninguna.
    const cuenta = page.getByRole('button', { name: /^Cuenta de gasto/ }).first()
    await expect(cuenta).toBeVisible({ timeout: 30_000 })
    if (/Elige la cuenta/.test(await cuenta.innerText())) {
      await cuenta.click()
      const hoja = page.getByRole('dialog', { name: 'Buscar la cuenta' })
      await hoja.getByRole('combobox', { name: 'Número o nombre de la cuenta' }).fill(GASTO_DE_RESERVA)
      await hoja.getByRole('option').first().click()
      await page.getByRole('region', { name: 'Cambios sin guardar' }).getByRole('button', { name: /^Guardar cambios/ }).click()
      await expect(page.getByRole('region', { name: 'Cambios sin guardar' })).toHaveCount(0, { timeout: 30_000 })
    }

    if (CARRIL !== null) {
      const validar = page.locator('[data-validar-y-siguiente]')
      await expect(validar).toBeEnabled({ timeout: 30_000 })
      await validar.click()
      await expect.poll(async () => (await rest<{ id: string }[]>(s, 'GET',
        `journal_entry?select=id&account_id=eq.${CUENTA_A.id}&source_type=eq.supplier_invoice&status=eq.validado&source_id=eq.${p!.id}`)).datos?.length ?? 0,
      { message: 'el asiento de la factura, validado', timeout: 60_000 }).toBe(1)
    } else {
      console.log('[S01b] Sin carril: no se valida (deja un asiento para siempre); se mira la ficha y se borra todo.')
    }

    // 4 · La ficha rellena, «de la factura …».
    const ahora = await proveedorPorNif(s, papel.nif)
    expect(ahora).toMatchObject({ tax_id: papel.nif, legal_name: papel.nombre, fiscal_street: papel.calle, fiscal_postal_code: papel.cp, fiscal_city: papel.ciudad, website: papel.web })
    const contactos = await rest<{ name: string; email: string | null; phone: string | null; notes: string | null }[]>(s, 'GET',
      `supplier_contact?select=name,email,phone,notes&supplier_id=eq.${ahora!.id}`)
    expect(contactos.datos).toEqual([{ name: 'Facturación', email: papel.correo, phone: papel.telefono, notes: `De la factura ${marca}.` }])

    await page.goto(`/conta/clientes-y-proveedores/proveedor/${ahora!.id}/datos-fiscales`)
    await expect(page.getByLabel('Calle y número')).toHaveValue(papel.calle, { timeout: 30_000 })
    if (await hayOrigen(s)) {
      for (const campo of ['nif', 'direccion', 'web']) {
        await expect(page.locator(`[data-prueba="origen-${campo}"]`).first(), `el origen de ${campo}`).toContainText(`De la factura ${marca}`)
      }
    } else {
      console.log('[S01b] Staging sin la 1304: los datos se guardan sin su origen (lo dice el contacto).')
    }
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${ahora!.id}/contactos`)
    await expect(page.getByText(`De la factura ${marca}.`)).toBeVisible({ timeout: 30_000 })
    expect(errores).toEqual([])
  } finally {
    // Validada (en el carril), su asiento no deja borrarla: se va con el carril.
    if (CARRIL === null) await limpiar(s, p, papel.nif)
  }
})
