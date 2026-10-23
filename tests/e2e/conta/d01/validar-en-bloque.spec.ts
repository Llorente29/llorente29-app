/// <reference lib="dom" />
// tests/e2e/conta/d01/validar-en-bloque.spec.ts
//
// D06 · Bloque 1 de Compras y gastos (Julio, 23/10, tablero 2b), contra
// staging-conta, en ordenador (1440) y móvil (390):
//
//   1. validar 3 de 5 con 2 que no están listas: «¿Lista para validar?» en
//      cada fila (las que no, con su motivo y sin marcar), «Marcar las que
//      están listas (3)», la barra azul con la cuenta y el total, «Quitar la
//      marca», la confirmación con el reparto por cuenta y por local, y al
//      final «Validadas las 3»: las 3 con su asiento validado y las 2 en
//      revisión, sin asiento;
//   2. una posible duplicada (el mismo proveedor y el mismo número sin
//      espacios, guiones ni ceros a la izquierda): se avisa en la lista y en
//      su ficha, antes de validar;
//   3. sin PDF no se valida: «Falta su PDF» en la lista y en la ficha, y
//      «Validar y siguiente» apagado; marcada «Sin PDF» con su motivo, se
//      enciende;
//   4. el NIF leído mal en un carácter (el de su ficha es válido y el leído no):
//      ámbar, «He leído mal el NIF; uso el de su ficha», y el asiento que se
//      crea, a la vista.
//
// La 1 VALIDA de verdad (deja asientos): solo corre en un carril
// (E2E_CARRIL), que se borra entero al acabar; sin carril se salta y lo dice.
// Las demás no validan nada. Cada prueba prepara SUS facturas por la API, con
// la sesión de la persona administradora de A (la misma RLS que la pantalla),
// del proveedor de la semilla D01 (Mayorista Prueba Alfa: su 400 y su gasto
// 60000000 están en el plan de A, así sale el asiento), con números únicos por
// lado y por ejecución; y las borra al acabar.
//
// «La foto sustituida por el PDF bueno» (punto 4 del encargo) vive en la base
// (conta_factura_desde_lectura, tanda 0800): desde la rama, staging la pasa en
// ROLLBACK, así que aquí no se puede ver. La prueba la de staging
// (supabase/staging/sql/20261207_d06_prepago_y_pdf_prueba.sql) y la unitaria
// del historial (tests/unit/modules/conta/d06). Importes inventados.

import { test, expect, type Page, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
/** Mayorista Prueba Alfa (semilla D01): subcuenta 40000006 y gasto 60000000 en el plan de A. */
const ALFA = enCarril('d0100000-0000-4000-8000-000000000001')
const QUIEN = 'Prueba e2e D06'
const PDF = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
/** Hoy en Madrid (AAAA-MM-DD): la factura cae en un periodo abierto y sale su asiento. */
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const r2 = (n: number) => Math.round(n * 100) / 100

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── Los datos ───────────────────────────────────────────────────────────────

interface Preparada { id: string; numero: string; ruta: string | null }

/** Sube el PDF inventado a la carpeta de A, en una ruta única: el documento de la factura. */
async function subirPdf(s: Sesion, nombre: string): Promise<string> {
  const ruta = `${CUENTA_A.id}/d06-e2e/${nombre}.pdf`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
    body: readFileSync(PDF),
  })
  const t = await r.text()
  expect(r.ok || /exists|duplicate/i.test(t), `subir el PDF de prueba: ${r.status} ${t.slice(0, 200)}`).toBe(true)
  return ruta
}

/**
 * Una recibida «por revisar» de Mayorista Prueba Alfa, de hoy, en el local de
 * A, con una línea al 21 % de `base`: con su PDF subido, o sin documento; y,
 * si se da, lo que leyó (el NIF de la factura).
 */
async function preparar(s: Sesion, numero: string, base: number, o: { pdf: boolean; nifLeido?: string }): Promise<Preparada> {
  const iva = r2(base * 0.21)
  const ruta = o.pdf ? await subirPdf(s, numero.replace(/[^A-Za-z0-9-]/g, '_')) : null
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: ALFA, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: numero, invoice_date: hoy(), status: 'en_revision', source: o.nifLeido ? 'ocr' : 'manual',
    tax_base_total: base, tax_total: iva, grand_total: r2(base + iva), created_by_name: QUIEN, raw_document_url: ruta,
    ...(o.nifLeido
      ? {
        needs_review: true, reading_confidence: 'probable',
        reading: { porque: ['Prueba e2e D06.'], comprobaciones: [], confianza: 'probable', factura: { proveedor: { nombre: 'Mayorista Prueba Alfa', nif: o.nifLeido } } },
      }
      : {}),
  })
  expect(f.status, `la factura de prueba ${numero}: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  const id = f.datos[0].id
  const l = await rest(s, 'POST', 'supplier_invoice_line', [{ supplier_invoice_id: id, raw_text: 'Material de limpieza', qty: 1, unit_price: base, line_amount: base, vat_pct: 21, position: 0 }])
  expect(l.status, `su línea: ${JSON.stringify(l.datos).slice(0, 300)}`).toBe(201)
  return { id, numero, ruta }
}

/** Borra lo preparado: su PDF y la factura (con lo que cuelga, en cascada). Con asiento validado no se deja: en el carril se va con él. */
async function limpiar(s: Sesion, ps: readonly (Preparada | null)[]) {
  for (const p of ps) {
    if (!p) continue
    if (p.ruta) {
      await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${p.ruta}`, {
        method: 'DELETE', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` },
      }).catch(() => undefined)
    }
    const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${p.id}`)
    if (d.status >= 300) console.log(`[limpieza] la factura ${p.numero}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
  }
}

async function validadas(s: Sesion, ids: readonly string[]): Promise<string[]> {
  const r = await rest<{ source_id: string }[]>(s, 'GET',
    `journal_entry?select=source_id&account_id=eq.${CUENTA_A.id}&source_type=eq.supplier_invoice&status=eq.validado&source_id=in.(${ids.join(',')})`)
  return (r.datos ?? []).map((x) => x.source_id)
}

/** El NIF de la ficha de Alfa, y uno leído mal en un carácter (el de control cambiado: deja de ser válido). */
async function nifDeAlfa(s: Sesion): Promise<{ ficha: string; leidoMal: string }> {
  const r = await rest<{ tax_id: string | null }[]>(s, 'GET', `supplier?select=tax_id&account_id=eq.${CUENTA_A.id}&id=eq.${ALFA}`)
  const ficha = (r.datos?.[0]?.tax_id ?? '').replace(/[\s.-]/g, '').toUpperCase()
  expect(ficha, 'el NIF de la ficha de Mayorista Prueba Alfa').toMatch(/^[A-Z0-9]{9}$/)
  const ultimo = ficha.slice(-1)
  const otro = /\d/.test(ultimo) ? String((Number(ultimo) + 1) % 10) : (ultimo === 'A' ? 'B' : 'A')
  return { ficha, leidoMal: ficha.slice(0, -1) + otro }
}

// ── La pantalla ─────────────────────────────────────────────────────────────

/** La lista «Por revisar», buscando por el sello de la prueba: solo sus facturas. */
async function abrirLista(page: Page, q: string) {
  await page.goto(`/conta/documentos?ver=por-revisar&q=${encodeURIComponent(q)}`)
  await expect(page.locator('[data-fila]').first()).toBeVisible({ timeout: 30_000 })
}
const fila = (page: Page, p: Preparada) => page.locator(`[data-fila="${p.id}"]`)
const casilla = (page: Page, p: Preparada) => fila(page, p).locator('input.s-lista-casilla')
/** «¿Lista para validar?» de una fila, ya comprobado. */
async function listaDe(page: Page, p: Preparada): Promise<Locator> {
  const c = fila(page, p).locator('.s-lista-para-validar')
  await expect(c, `«¿Lista para validar?» de ${p.numero}`).toBeVisible({ timeout: 40_000 })
  return c
}

async function abrirFicha(page: Page, p: Preparada) {
  await page.goto(`/conta/documentos/recibidas/${p.id}?ver=por-revisar`)
  await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: `Mayorista Prueba Alfa · ${p.numero}` })).toBeVisible({ timeout: 30_000 })
}
const veredicto = (page: Page) => page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ })
const validar = (page: Page) => page.locator('[data-validar-y-siguiente]')

// ── 1 · Validar 3 de 5, con 2 que no están listas ───────────────────────────

test('D06 · validar en bloque: 3 de 5, con 2 que no están listas (sin PDF y el NIF leído mal): la barra, el reparto y lo que pasó', async ({ page }) => {
  test.skip(CARRIL === null, 'Valida de verdad (deja asientos): solo en un carril, que se borra entero al acabar.')
  test.setTimeout(240_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PD06B${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const ps: Preparada[] = []
  try {
    const { leidoMal } = await nifDeAlfa(s)
    // Bases distintas: tres del mismo proveedor y del mismo día con el mismo total serían «posibles duplicadas».
    const [l1, l2, l3] = [await preparar(s, `${marca}-L1`, 101, { pdf: true }), await preparar(s, `${marca}-L2`, 102, { pdf: true }), await preparar(s, `${marca}-L3`, 103, { pdf: true })]
    const sinPdf = await preparar(s, `${marca}-N1`, 104, { pdf: false })
    const nifMal = await preparar(s, `${marca}-N2`, 105, { pdf: true, nifLeido: leidoMal })
    ps.push(l1, l2, l3, sinPdf, nifMal)

    await abrirLista(page, marca)
    await expect(page.locator('[data-fila]')).toHaveCount(5)
    for (const p of [l1, l2, l3]) await expect(await listaDe(page, p), `${p.numero} tiene que estar lista`).toHaveText('✓ Lista')
    await expect(await listaDe(page, sinPdf)).toContainText('No está lista.')
    await expect(await listaDe(page, sinPdf)).toContainText('Falta su PDF')
    await expect(await listaDe(page, nifMal)).toContainText('He leído mal el NIF; uso el de su ficha')

    // «Marcar las que están listas»: las 3, no las otras 2.
    await page.getByRole('button', { name: 'Marcar las que están listas (3)' }).click()
    for (const p of [l1, l2, l3]) await expect(casilla(page, p)).toBeChecked()
    for (const p of [sinPdf, nifMal]) await expect(casilla(page, p)).not.toBeChecked()
    const barra = page.getByRole('region', { name: 'Facturas marcadas' })
    await expect(barra).toContainText('3 marcadas')
    await expect(barra).toContainText(`Total ${(r2((101 + 102 + 103) * 1.21)).toLocaleString('es-ES', { minimumFractionDigits: 2 })}`)
    await barra.getByRole('button', { name: 'Quitar la marca' }).click()
    await expect(barra).toHaveCount(0)
    for (const p of ps) await expect(casilla(page, p)).not.toBeChecked()

    // Marcadas a mano las 5: se validan solo las 3 listas.
    for (const p of ps) await casilla(page, p).check()
    await expect(barra).toContainText('5 marcadas')
    await expect(barra).toContainText('3 listas para validar')
    await barra.getByRole('button', { name: 'Validar las 3' }).click()
    const dialogo = page.getByRole('dialog', { name: '¿Validar 3 facturas recibidas?' })
    await expect(dialogo).toBeVisible()
    const reparto = dialogo.getByRole('table', { name: 'Así quedan repartidas' })
    for (const c of ['Cuenta', 'Nombre', 'Facturas', 'Base', 'Total']) await expect(reparto.getByRole('columnheader', { name: c })).toBeVisible()
    await expect(reparto).toContainText('Por local')
    await expect(dialogo).toContainText('Las 2 que no están listas se quedan en «Por revisar» con su motivo.')
    await dialogo.getByRole('button', { name: 'Validar las 3' }).click()

    const resultado = page.locator('[data-prueba="resultado-bloque"]')
    await expect(resultado).toContainText('Validadas las 3: cada una con su asiento.', { timeout: 120_000 })
    await expect.poll(async () => (await validadas(s, ps.map((p) => p.id))).sort(), { timeout: 30_000 }).toEqual([l1.id, l2.id, l3.id].sort())
    const siguen = await rest<{ id: string; status: string }[]>(s, 'GET', `supplier_invoice?select=id,status&account_id=eq.${CUENTA_A.id}&id=in.(${sinPdf.id},${nifMal.id})`)
    expect((siguen.datos ?? []).map((x) => x.status)).toEqual(['en_revision', 'en_revision'])
    // Las 3 se van de «Por revisar»; las 2 se quedan, con su motivo.
    await expect(page.locator('[data-fila]')).toHaveCount(2, { timeout: 30_000 })
    await expect(await listaDe(page, sinPdf)).toContainText('Falta su PDF')
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, ps)
  }
})

// ── 2 · Una posible duplicada ───────────────────────────────────────────────

test('D06 · una posible duplicada (el mismo número sin espacios, guiones ni ceros a la izquierda) se avisa en la lista y en su ficha', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PD06D${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const ps: Preparada[] = []
  try {
    const una = await preparar(s, `${marca} 007`, 110, { pdf: true })
    const otra = await preparar(s, `${marca}-7`, 111, { pdf: true })
    ps.push(una, otra)
    await abrirLista(page, marca)
    for (const p of ps) {
      await expect(await listaDe(page, p)).toContainText('No está lista.')
      await expect(await listaDe(page, p)).toContainText('Puede estar repetida: ya tienes otra con el número')
    }
    await abrirFicha(page, una)
    await expect(veredicto(page)).toContainText('Revisa esto')
    await expect(veredicto(page)).toContainText(`Puede estar repetida: ya tienes otra con el número ${marca}-7`)
    // El asiento que se crea, a la vista también con el aviso (punto 8).
    await expect(page.locator('details.s-asiento-ficha table.s-asiento-tabla')).toBeVisible({ timeout: 30_000 })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, ps)
  }
})

// ── 3 · Sin PDF no se valida ────────────────────────────────────────────────

test('D06 · sin PDF no se valida: «Falta su PDF» y el botón apagado; con «Sin PDF» y su motivo, se enciende', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PD06P${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  let p: Preparada | null = null
  try {
    p = await preparar(s, `${marca}-1`, 120, { pdf: false })
    await abrirLista(page, marca)
    await expect(await listaDe(page, p)).toContainText('Falta su PDF')
    await expect(casilla(page, p)).not.toBeChecked()

    await abrirFicha(page, p)
    await expect(veredicto(page)).toContainText('Falta su PDF: súbelo o márcala «Sin PDF» con su motivo para poder validarla.')
    await expect(validar(page)).toBeDisabled({ timeout: 20_000 })
    await expect(page.locator('[data-prueba="falta-pdf"]')).toBeVisible()
    // Intro tampoco valida.
    await page.locator('h1.s-titulo-pagina').click()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1_500)
    expect(await validadas(s, [p.id])).toEqual([])

    // «Sin PDF» con su motivo (la misma función que «Más acciones › Sin PDF»): se enciende.
    const sin = await rest(s, 'POST', 'rpc/conta_recibida_sin_papel', { p_invoice: p.id, p_sin: true, p_motivo: 'Prueba e2e D06: no hay papel', p_quien_nombre: QUIEN })
    expect(sin.status, JSON.stringify(sin.datos).slice(0, 300)).toBe(200)
    await page.reload()
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-prueba="falta-pdf"]')).toHaveCount(0, { timeout: 20_000 })
    await expect(validar(page)).toBeEnabled({ timeout: 20_000 })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})

// ── 4 · El NIF leído mal en un carácter ─────────────────────────────────────

test('D06 · el NIF leído mal en un carácter: ámbar, «He leído mal el NIF; uso el de su ficha», y el asiento que se crea a la vista', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PD06N${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  let p: Preparada | null = null
  try {
    const { ficha, leidoMal } = await nifDeAlfa(s)
    p = await preparar(s, `${marca}-1`, 130, { pdf: true, nifLeido: leidoMal })
    await abrirFicha(page, p)
    const v = veredicto(page)
    await expect(v).toHaveAttribute('data-tono', /.+/)
    await expect(v.getByRole('heading', { level: 2 })).toHaveText('Revisa esto', { timeout: 30_000 })
    await expect(v).not.toContainText('No encaja')
    await expect(v).toContainText(`He leído mal el NIF; uso el de su ficha (leí ${leidoMal}; su ficha dice`)
    await expect(v).toContainText(ficha.slice(1, 8))
    // El asiento se propone: su tabla, con sus cuentas de ocho cifras.
    const asiento = page.locator('details.s-asiento-ficha table.s-asiento-tabla')
    await expect(asiento).toBeVisible({ timeout: 30_000 })
    for (const f of await asiento.locator('tbody tr').all()) await expect(f).toContainText(/\d{8}/)
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})
