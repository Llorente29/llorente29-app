/// <reference lib="dom" />
// tests/e2e/conta/d01/ficha-recibida.spec.ts
//
// D03 · La ficha de la factura recibida, COMPLETA (encargo «Para D · la ficha
// de la recibida completa», tablero 3b, sección «Pruebas»), contra
// staging-conta, en ordenador (1440) y móvil (390):
//
//   1. una recibida que entró sola (con su recepción y su lectura) y una
//      escrita a mano: la misma pantalla, los mismos bloques, campos y «Más
//      acciones»; debajo del título, «Entró con la recepción…» o «Escrita a
//      mano…», según sea;
//   2. cambiar un importe de IVA: «Cambiado» con «Antes · Deshacer», la barra
//      «1 cambio sin guardar», el asiento rehecho al momento como VISTA PREVIA
//      (la cifra, en su tabla) y NADA en la base hasta «Guardar cambios», que
//      dice lo que ha guardado; después sí está (REST) y sale en el Historial;
//   3. salir con un cambio sin guardar por el menú y con ‹ ›: «¿Salir sin
//      guardar?» con lo que cambió; «Seguir editando» lo conserva; «Salir sin
//      guardar» sale y lo pierde;
//   4. con cambios sin guardar, Intro no valida y «Validar y siguiente» está
//      apagado con «Guarda o descarta primero»;
//   5. dos tipos de IVA, como la COHELDI P26 4.980 (127,40 al 4 % → 5,10 y
//      136,26 al 10 % → 13,63, sin filas de impuesto: el IVA va en sus líneas):
//      base, IVA y total, y el asiento con 47200004 y 47200010; y la captura de
//      la ficha terminada al lado del tablero 3b (ordenador);
//   6. subir un PDF a una recibida sin documento: se ve a la derecha y, al
//      guardar, queda puesto y el Historial dice «Puso el PDF»;
//   7. «Sin PDF»: sin motivo no deja; con motivo queda marcada y en el Historial.
//
// Datos: cada prueba prepara SUS facturas por la API, con la sesión de la
// persona administradora de A (la misma RLS que la pantalla), del proveedor de
// la semilla D01 (Mayorista Prueba Alfa: su subcuenta 400 y su gasto 60000000
// ya están en el plan de A, así sale el asiento) y con números únicos por lado
// y por ejecución; y las borra al acabar (con ellas se van sus líneas, sus
// filas de IVA, su reparto y su historial: on delete cascade). La recepción
// de la que «entró» es un borrador sin líneas (no mueve stock ni coste: los
// disparadores de goods_receipt son de cambio de estado) y se borra también.
// La lectura del fichero (goods_receipt_ai_session) solo se crea en un carril:
// esa tabla no deja borrar a una persona, y el carril se borra entero al
// acabar. Sin carril, la recibida «entró sola» igual, sin «· leída de su PDF».
// Nada se valida: «Validar y siguiente» deja un asiento para siempre.
//
// Staging tiene aplicada la tanda 0790 (conta_recibida_guardar,
// conta_recibida_papel_poner, conta_recibida_sin_papel, supplier_invoice_expense
// y supplier_invoice_change): «Guardar cambios» guarda de verdad. No cuenta con
// la 0770 (solo en ROLLBACK). Importes inventados.

import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/d03'
const TABLERO = 'tests/e2e/conta/d01/tablero-3b.webp'  // la maqueta, junto a la prueba (la rama no fija capturas)
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
/** Mayorista Prueba Alfa (semilla D01): subcuenta 40000006 y gasto 60000000 en el plan de A. */
const ALFA = enCarril('d0100000-0000-4000-8000-000000000001')
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const QUIEN = 'Prueba e2e D03'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
/** Hoy en Madrid (AAAA-MM-DD): la factura cae en un periodo abierto y sale su asiento. */
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const ficha = (id: string) => `/conta/documentos/recibidas/${id}?ver=por-revisar`

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── Los datos ───────────────────────────────────────────────────────────────

interface Linea { texto: string; importe: number; iva: number }

/** La COHELDI P26 4.980, con sus cifras: dos líneas al 4 % (127,40) y una al 10 % (136,26). Sin filas de impuesto. */
const COMO_COHELDI: Linea[] = [
  { texto: 'Leche entera 1 L', importe: 80.0, iva: 4 },
  { texto: 'Huevos frescos', importe: 47.4, iva: 4 },
  { texto: 'Género variado', importe: 136.26, iva: 10 },
]
const UNA_AL_21: Linea[] = [{ texto: 'Material de limpieza', importe: 100.0, iva: 21 }]

const r2 = (n: number) => Math.round(n * 100) / 100
function totales(lineas: readonly Linea[]) {
  const por = new Map<number, number>()
  for (const l of lineas) por.set(l.iva, r2((por.get(l.iva) ?? 0) + l.importe))
  const base = r2([...por.values()].reduce((a, b) => a + b, 0))
  const iva = r2([...por.entries()].reduce((a, [t, b]) => a + r2(b * t / 100), 0))
  return { base, iva, total: r2(base + iva) }
}

interface Preparada { id: string; numero: string; recepcion: string | null }

/**
 * Una recibida «por revisar» de Mayorista Prueba Alfa, de hoy:
 *   · 'sola': source 'ocr' con su lectura (reading), y la recepción de la que
 *     entró (un borrador sin líneas, en el local de A); en un carril, además, la
 *     lectura de su fichero (sin fichero: no tiene PDF enlazado);
 *   · 'a-mano': source 'manual', como la guarda «Nueva recibida a mano».
 * Sin documento en ninguna de las dos.
 */
async function prepararRecibida(s: Sesion, como: 'sola' | 'a-mano', numero: string, lineas: readonly Linea[]): Promise<Preparada> {
  const t = totales(lineas)
  const fecha = hoy()
  let recepcion: string | null = null
  let sesion: string | null = null
  if (como === 'sola') {
    const g = await rest<{ id: string }[]>(s, 'POST', 'goods_receipt', {
      account_id: CUENTA_A.id, location_id: LOCAL_A, supplier_id: ALFA, receipt_date: fecha, status: 'borrador', created_by_name: QUIEN,
    })
    expect(g.status, `la recepción de prueba: ${JSON.stringify(g.datos).slice(0, 300)}`).toBe(201)
    recepcion = g.datos[0].id
    if (CARRIL !== null) {
      const a = await rest<{ id: string }[]>(s, 'POST', 'goods_receipt_ai_session', {
        account_id: CUENTA_A.id, goods_receipt_id: recepcion, kind: 'pdf', input_files: [], status: 'confirmed',
      })
      expect(a.status, `la lectura de prueba: ${JSON.stringify(a.datos).slice(0, 300)}`).toBe(201)
      sesion = a.datos[0].id
    }
  }
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: ALFA, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: numero, invoice_date: fecha, status: 'en_revision', source: como === 'sola' ? 'ocr' : 'manual',
    tax_base_total: t.base, tax_total: t.iva, grand_total: t.total, created_by_name: QUIEN,
    ...(como === 'sola'
      ? {
        needs_review: true, reading_confidence: 'probable', ai_session_id: sesion,
        reading: {
          porque: ['Las líneas suman la base y el total cuadra (prueba e2e D03).'], comprobaciones: [], confianza: 'probable',
          factura: { proveedor: { nombre: 'Mayorista Prueba Alfa', nif: 'A00000018' } },
        },
      }
      : { notes: 'Dada de alta a mano en Contabilidad, sin fichero (prueba e2e D03).' }),
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  const id = f.datos[0].id
  const l = await rest(s, 'POST', 'supplier_invoice_line', lineas.map((x, i) => ({
    supplier_invoice_id: id, raw_text: x.texto, qty: 1, unit_price: x.importe, line_amount: x.importe, vat_pct: x.iva, position: i,
  })))
  expect(l.status, `sus líneas: ${JSON.stringify(l.datos).slice(0, 300)}`).toBe(201)
  if (recepcion) {
    const v = await rest(s, 'POST', 'supplier_invoice_receipt', { supplier_invoice_id: id, goods_receipt_id: recepcion })
    expect(v.status, `el enlace con su recepción: ${JSON.stringify(v.datos).slice(0, 300)}`).toBe(201)
  }
  return { id, numero, recepcion }
}

/** Borra lo preparado: el documento subido (si lo hay), la factura (con lo que cuelga, en cascada) y su recepción. */
async function limpiar(s: Sesion, ps: readonly (Preparada | null)[]) {
  for (const p of ps) {
    if (!p) continue
    const [f] = (await rest<{ raw_document_url: string | null }[]>(s, 'GET', `supplier_invoice?select=raw_document_url&account_id=eq.${CUENTA_A.id}&id=eq.${p.id}`)).datos ?? []
    if (f?.raw_document_url) {
      await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${f.raw_document_url}`, {
        method: 'DELETE', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` },
      }).catch(() => undefined)
    }
    const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${p.id}`)
    if (d.status >= 300) console.log(`[limpieza] la factura ${p.numero}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
    if (p.recepcion) await rest(s, 'DELETE', `goods_receipt?account_id=eq.${CUENTA_A.id}&id=eq.${p.recepcion}`)
  }
}

interface Cabecera { tax_base_total: number; tax_total: number; grand_total: number; invoice_number: string; status: string; raw_document_url: string | null; no_document_at: string | null; no_document_reason: string | null }
async function cabecera(s: Sesion, id: string): Promise<Cabecera> {
  const r = await rest<Cabecera[]>(s, 'GET',
    `supplier_invoice?select=tax_base_total,tax_total,grand_total,invoice_number,status,raw_document_url,no_document_at,no_document_reason&account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
  expect(r.datos, `la factura ${id} por REST`).toHaveLength(1)
  return r.datos[0]
}
const cifras = (c: Cabecera) => [Number(c.tax_base_total), Number(c.tax_total), Number(c.grand_total)]
async function filasDeIva(s: Sesion, id: string): Promise<number[][]> {
  const r = await rest<{ vat_pct: number; base: number; vat_amount: number }[]>(s, 'GET',
    `supplier_invoice_tax?select=vat_pct,base,vat_amount&account_id=eq.${CUENTA_A.id}&supplier_invoice_id=eq.${id}&order=vat_pct`)
  return (r.datos ?? []).map((x) => [Number(x.vat_pct), Number(x.base), Number(x.vat_amount)])
}

// ── La pantalla ─────────────────────────────────────────────────────────────

/**
 * El documento se pliega y se recuerda por persona (conta_user_pref): si otra
 * prueba lo dejó plegado, se enseña (con él, el hueco del PDF y el Historial
 * del ordenador).
 */
async function documentoALaVista(page: Page): Promise<Locator> {
  const documento = page.getByRole('complementary', { name: 'Documento' })
  const mostrar = documento.getByRole('button', { name: 'Documento', exact: true })
  if (await mostrar.count()) await mostrar.click()
  return documento
}

async function abrir(page: Page, p: Preparada) {
  await page.goto(ficha(p.id))
  await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: `Mayorista Prueba Alfa · ${p.numero}` })).toBeVisible({ timeout: 30_000 })
  await documentoALaVista(page)
}

const region = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true })
const barra = (page: Page) => page.getByRole('region', { name: 'Cambios sin guardar' })
const historial = (page: Page) => page.locator('[data-prueba="historial"]')
const validar = (page: Page) => page.locator('[data-validar-y-siguiente]')

/** La tabla del asiento que se crea (la vista previa, mientras no tenga asiento). */
const asiento = (page: Page) => page.locator('details.s-asiento-ficha table.s-asiento-tabla')
/** La línea del asiento de una cuenta: [debe, haber] como se ven. */
async function lineaDelAsiento(page: Page, cuenta: RegExp): Promise<[string, string]> {
  const fila = asiento(page).locator('tbody tr').filter({ has: page.locator('td.s-asiento-codigo', { hasText: cuenta }) })
  await expect(fila, `la línea ${cuenta} en el asiento`).toHaveCount(1, { timeout: 20_000 })
  const c = fila.locator('td.s-lista-cifra')
  return [((await c.nth(0).textContent()) ?? '').trim(), ((await c.nth(1).textContent()) ?? '').trim()]
}

/** Abre «Más acciones» del encabezado y devuelve lo que trae (el primer renglón de cada opción). */
async function opcionesDeMasAcciones(page: Page): Promise<string[]> {
  const encabezado = page.locator('header.s-encabezado')
  await encabezado.getByRole('button', { name: 'Más acciones', exact: true }).click()
  const grupo = page.getByRole('group', { name: 'Más acciones', exact: true })
  await expect(grupo).toBeVisible()
  const textos = (await grupo.locator('button, a').allInnerTexts()).map((t) => t.split('\n')[0].trim()).filter(Boolean)
  await page.keyboard.press('Escape')
  await expect(grupo).toHaveCount(0)
  return textos
}

/** Lo que la ficha ofrece, para comparar la que entró sola con la escrita a mano. */
async function huellaDeLaFicha(page: Page) {
  const raiz = page.locator('[data-prueba="ficha-recibida"]')
  // Lo que se lee aparte tiene que haber llegado antes de mirar (isVisible no espera):
  // el asiento (de él cuelga «Editar el asiento a mano») y el hueco del PDF.
  await expect(raiz.locator('details.s-asiento-ficha').getByRole('button', { name: 'Editar el asiento a mano' })).toBeVisible({ timeout: 20_000 })
  await expect(raiz.locator('[data-prueba="hueco-pdf"]').first()).toBeVisible({ timeout: 20_000 })
  const pruebas = [...new Set(await raiz.locator('[data-prueba]').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-prueba') ?? '')))].sort()
  const bloques = await raiz.locator('section.s-bloque-ficha').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label') ?? ''))
  const controles: Record<string, boolean> = {}
  const editable = async (l: Locator) => (await l.count()) === 1 && (await l.isEditable())
  controles['Cambiar de proveedor'] = await region(page, 'Proveedor y factura').getByRole('button', { name: 'Cambiar de proveedor' }).isVisible()
  controles['Nº de factura'] = await editable(page.getByRole('textbox', { name: 'Nº de factura' }))
  controles['Fecha de la factura'] = await page.getByLabel('Fecha de la factura').first().isEditable()
  controles['Base de la línea 1'] = await editable(region(page, 'Importes por tipo de IVA').getByRole('textbox', { name: /^Base / }).first())
  controles['Tipo de IVA de la línea 1'] = await page.getByRole('combobox', { name: 'Tipo de IVA de la línea 1' }).isEnabled()
  for (const b of ['+ Otro tipo de IVA', '+ Retención (IRPF)', '+ Recargo de equivalencia', '+ Repartir en varias cuentas o locales']) {
    controles[b] = await page.getByRole('button', { name: b, exact: true }).isVisible()
  }
  controles['Cuenta de gasto (F4)'] = await region(page, 'A qué gasto va').getByRole('button', { name: /^Cuenta de gasto/ }).first().isEnabled()
  controles['Forma de pago'] = await page.getByRole('combobox', { name: 'Forma de pago' }).isEnabled()
  controles['Vence'] = await page.getByLabel('Vence', { exact: true }).first().isEditable()
  controles['Estado del pago'] = await page.getByRole('combobox', { name: 'Estado del pago' }).isEnabled()
  controles['Subir el PDF o la foto'] = (await page.locator('[data-prueba="hueco-pdf"] input[type="file"]').count()) === 1
  controles['Sin PDF'] = await page.getByRole('checkbox', { name: /Sin PDF/ }).isEnabled()
  controles['Editar el asiento a mano'] = await page.getByRole('button', { name: 'Editar el asiento a mano' }).isVisible()
  controles['Validar y siguiente'] = await validar(page).first().isVisible()
  return { pruebas, bloques, controles, masAcciones: await opcionesDeMasAcciones(page) }
}

/** Un PDF de verdad, mínimo (una página con una línea de texto), hecho aquí: con su tabla xref bien contada. */
function pdfMinimo(texto: string): Buffer {
  const contenido = `BT /F1 18 Tf 72 760 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((o, i) => { posiciones.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Captura de la página entera: la ventana al alto del documento (como las demás e2e), y vuelta a su tamaño. */
async function capturar(page: Page, ruta: string) {
  await page.evaluate(() => document.fonts.ready)
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(400)
  const png = await page.screenshot({ path: ruta })
  await page.setViewportSize(ventana)
  return png
}

// ── 1 · La misma pantalla ───────────────────────────────────────────────────

test('D03 · una recibida que entró sola y una escrita a mano: la misma pantalla y las mismas opciones', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `${lado(page)}-${sello()}`
  let sola: Preparada | null = null
  let aMano: Preparada | null = null
  try {
    sola = await prepararRecibida(s, 'sola', `PD03-SOLA-${marca}`, COMO_COHELDI)
    aMano = await prepararRecibida(s, 'a-mano', `PD03-MANO-${marca}`, UNA_AL_21)

    await abrir(page, sola)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toHaveAttribute('data-origen', 'sola')
    // De dónde vino, sin inventar: la recepción de la que salió, en su local; leída de su PDF si hay lectura (en el carril).
    const deDonde = page.locator('[data-prueba="de-donde-vino"]')
    await expect(deDonde).toHaveText(new RegExp(`^Entró con la recepción del \\d{2}/\\d{2}( en .+?)?${CARRIL !== null ? ' · leída de su PDF' : '( · leída de su PDF)?'}$`), { timeout: 20_000 })
    await expect(deDonde).not.toContainText('Escrita a mano')
    await expect(historial(page)).toContainText('Se dio de alta la factura')
    const deLaSola = await huellaDeLaFicha(page)

    await abrir(page, aMano)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toHaveAttribute('data-origen', 'a-mano')
    await expect(page.locator('[data-prueba="de-donde-vino"]')).toHaveText(new RegExp(`^Escrita a mano el \\d{2}/\\d{2} por ${QUIEN}$`), { timeout: 20_000 })
    await expect(historial(page)).toContainText(`Escrita a mano (${QUIEN})`)
    const deLaAMano = await huellaDeLaFicha(page)

    // La regla de Julio: la misma pantalla para las dos. Los mismos bloques, las mismas piezas, los mismos campos que se editan y las mismas acciones.
    expect(deLaAMano).toEqual(deLaSola)
    expect(deLaSola.bloques).toEqual(['Proveedor y factura', 'Importes por tipo de IVA', 'A qué gasto va', 'Pago'])
    for (const p of ['de-donde-vino', 'importes-iva', 'linea-iva', 'totales-iva', 'gasto', 'linea-gasto', 'campo-vence', 'hueco-pdf', 'historial']) {
      expect(deLaSola.pruebas, `«${p}» en la ficha`).toContain(p)
    }
    expect(Object.entries(deLaSola.controles).filter(([, si]) => !si).map(([c]) => c), 'lo que no se puede tocar antes de validar').toEqual([])
    // Sin documento, «Más acciones» trae «Subir el PDF» (con documento, «Cambiar el PDF»): Marcar como duplicada · Descartar con motivo · Ver el historial.
    for (const a of ['Subir el PDF', 'Marcar como duplicada', 'Descartar con motivo', 'Ver el historial']) expect(deLaSola.masAcciones).toContain(a)
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [sola, aMano])
  }
})

// ── 2 · Cambiar un importe: vista previa, nada guardado hasta «Guardar cambios» ──

test('D03 · cambiar un importe de IVA rehace el asiento como vista previa y no guarda nada hasta «Guardar cambios»', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'sola', `PD03-IMP-${lado(page)}-${sello()}`, COMO_COHELDI)
    await abrir(page, p)
    const importes = region(page, 'Importes por tipo de IVA')
    await expect(importes.getByLabel('Base al 10 %')).toHaveValue('136,26')
    // Antes de tocar: el proveedor, 282,39 al haber.
    expect((await lineaDelAsiento(page, /^400\d+$/))[1]).toBe('282,39')
    await expect(barra(page)).toHaveCount(0)

    await importes.getByLabel('Base al 10 %').fill('146,26')
    // La cuota se rehace con la base y el tipo.
    await expect(importes.getByLabel('Cuota al 10 %')).toHaveValue('14,63')
    // El campo, «Cambiado», con «Antes: … · Deshacer» debajo.
    const bloqueIva = importes.locator('[data-prueba="importes-iva"]')
    await expect(bloqueIva).toHaveAttribute('data-cambiado', '')
    await expect(importes.locator('.s-campo-cambiado')).toHaveText(/^Cambiado$/i)
    await expect(importes.locator('.s-campo-antes')).toContainText('Antes: 127,40 al 4 % + 136,26 al 10 %')
    await expect(importes.getByRole('button', { name: /^Deshacer el cambio de Importes por tipo de IVA/ })).toBeVisible()
    // La barra: cuántos y qué.
    await expect(barra(page)).toContainText('1 cambio sin guardar')
    await expect(barra(page)).toContainText('Importes por tipo de IVA: 127,40 al 4 % + 136,26 al 10 % → 127,40 al 4 % + 146,26 al 10 %')
    await expect(importes.locator('[data-prueba="totales-iva"]')).toContainText(/Total\s*293,39\s€/)
    // El asiento, rehecho al momento: el IVA al 10 %, el gasto y el proveedor con lo nuevo.
    await expect.poll(async () => (await lineaDelAsiento(page, /^47200010$/))[0]).toBe('14,63')
    expect((await lineaDelAsiento(page, /^60000000$/))[0]).toBe('273,66')
    expect((await lineaDelAsiento(page, /^400\d+$/))[1]).toBe('293,39')
    await expect(asiento(page).locator('tfoot')).toContainText('Cuadra')
    await expect(page.locator('details.s-asiento-ficha .s-asiento-pie')).toContainText('es la vista previa de cómo quedará: no se guarda ni se envía nada hasta «Guardar cambios»')

    // Y en la base, nada: la cabecera como estaba y sin filas de IVA (la COHELDI no las tiene).
    await page.waitForTimeout(1_000)
    expect(cifras(await cabecera(s, p.id))).toEqual([263.66, 18.73, 282.39])
    expect(await filasDeIva(s, p.id)).toEqual([])

    // «Guardar cambios»: lo guarda y lo dice con contenido (regla 8).
    await barra(page).getByRole('button', { name: /^Guardar cambios/ }).click()
    const dicho = page.locator('.s-barra-cambios[data-tono="ok"]')
    await expect(dicho).toContainText(/Guardado: IVA .*263,66.*18,73.*→.*273,66.*19,73/, { timeout: 30_000 })
    await expect(barra(page)).toHaveCount(0)
    await expect(bloqueIva).not.toHaveAttribute('data-cambiado', '')
    expect(cifras(await cabecera(s, p.id))).toEqual([273.66, 19.73, 293.39])
    expect(await filasDeIva(s, p.id)).toEqual([[4, 127.4, 5.1], [10, 146.26, 14.63]])
    // La ficha relee lo guardado, y el Historial lo cuenta.
    await expect(importes.getByLabel('Base al 10 %')).toHaveValue('146,26')
    await expect(historial(page)).toContainText('Cambió los importes por tipo de IVA', { timeout: 20_000 })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})

// ── 3 · Salir con un cambio sin guardar ─────────────────────────────────────

test('D03 · salir con un cambio sin guardar, por el menú y con ‹ ›: avisa, «Seguir editando» lo conserva y «Salir sin guardar» lo pierde', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `${lado(page)}-${sello()}`
  let p: Preparada | null = null
  let otra: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'sola', `PD03-SAL-${marca}`, COMO_COHELDI)
    // Otra en la cola, para que ‹ › tenga adónde ir.
    otra = await prepararRecibida(s, 'a-mano', `PD03-OTRA-${marca}`, UNA_AL_21)
    const numero = () => region(page, 'Proveedor y factura').getByRole('textbox', { name: 'Nº de factura' })
    const aviso = page.getByRole('dialog', { name: '¿Salir sin guardar?' })
    const cambiar = async () => {
      await numero().fill(`${p!.numero}-X`)
      await expect(barra(page)).toContainText('1 cambio sin guardar')
      await expect(region(page, 'Proveedor y factura').locator('[data-prueba="campo-numero"] .s-campo-cambiado')).toHaveText(/^Cambiado$/i)
    }
    const conservado = async () => {
      await expect(aviso).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/recibidas/${p!.id}\\?`))
      await expect(numero()).toHaveValue(`${p!.numero}-X`)
      await expect(barra(page)).toContainText('1 cambio sin guardar')
    }
    const queDice = async () => {
      await expect(aviso).toBeVisible()
      await expect(aviso).toContainText(`Has cambiado Nº de factura en Mayorista Prueba Alfa ${p!.numero}. Si sales ahora, ese cambio se pierde.`)
      for (const b of ['Salir sin guardar', 'Seguir editando', 'Guardar y salir']) await expect(aviso.getByRole('button', { name: b })).toBeVisible()
    }
    const perdido = async () => {
      expect((await cabecera(s, p!.id)).invoice_number, 'en la base, el número de siempre').toBe(p!.numero)
      await abrir(page, p!)
      await expect(numero()).toHaveValue(p!.numero)
      await expect(barra(page)).toHaveCount(0)
    }

    // ‹ ›: a otra factura de la cola.
    await abrir(page, p)
    await cambiar()
    const navega = page.locator('header.s-encabezado').getByRole('group', { name: /^Facturas por revisar: \d+ de \d+$/ })
    await expect(navega).toBeVisible({ timeout: 20_000 })
    const flecha = (await navega.getByRole('button', { name: 'La siguiente' }).isEnabled())
      ? navega.getByRole('button', { name: 'La siguiente' }) : navega.getByRole('button', { name: 'La anterior' })
    await expect(flecha).toBeEnabled()
    await flecha.click()
    await queDice()
    await aviso.getByRole('button', { name: 'Seguir editando' }).click()
    await conservado()
    await flecha.click()
    await queDice()
    await aviso.getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(aviso).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/conta/documentos/recibidas/${UUID}\\?`))
    await expect(page).not.toHaveURL(new RegExp(`/recibidas/${p.id}\\?`))
    await perdido()

    // El menú: un enlace de la barra de contabilidad (en el móvil, en su cajón).
    await cambiar()
    const enlaceDelMenu = async () => {
      if (lado(page) === 'movil') await page.getByRole('button', { name: 'Abrir el menú' }).click()
      const menu = page.getByRole('navigation', { name: 'Menú de contabilidad' })
      await menu.getByRole('list', { name: 'Páginas de Compras y gastos' }).getByRole('link', { name: 'Facturas recibidas' }).click()
    }
    await enlaceDelMenu()
    await queDice()
    await aviso.getByRole('button', { name: 'Seguir editando' }).click()
    const cerrarMenu = page.getByRole('button', { name: 'Cerrar el menú' })
    if (await cerrarMenu.isVisible()) await cerrarMenu.click()
    await conservado()
    await enlaceDelMenu()
    await queDice()
    await aviso.getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(aviso).toHaveCount(0)
    await expect(page).toHaveURL(/\/conta\/documentos(\?|$)/)
    await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toBeVisible({ timeout: 20_000 })
    await perdido()
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p, otra])
  }
})

// ── 4 · Con cambios sin guardar, Intro no valida ────────────────────────────

test('D03 · con cambios sin guardar, Intro no valida y «Validar y siguiente» está apagado («Guarda o descarta primero»)', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'sola', `PD03-INT-${lado(page)}-${sello()}`, COMO_COHELDI)
    await abrir(page, p)
    const boton = validar(page)
    await expect(boton).toHaveCount(1)
    await expect(boton).toBeEnabled({ timeout: 20_000 })
    await expect(page.locator('[data-prueba="guarda-primero"]')).toHaveCount(0)
    // (Sin cambios no se pulsa Intro: validaría de verdad.)

    await region(page, 'Importes por tipo de IVA').getByLabel('Base al 4 %').fill('130,00')
    await expect(barra(page)).toContainText('1 cambio sin guardar')
    await expect(boton).toBeDisabled()
    await expect(boton).toHaveAttribute('title', 'Guarda o descarta primero')
    await expect(page.locator('[data-prueba="guarda-primero"]')).toHaveText('Guarda o descarta primero')
    // Intro, fuera de los campos (el foco en la página, no en un botón ni en un campo).
    await page.locator('h1.s-titulo-pagina').click()
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.() })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1_500)
    await expect(page).toHaveURL(new RegExp(`/recibidas/${p.id}\\?`))
    await expect(barra(page)).toContainText('1 cambio sin guardar')
    // En la base: sigue en revisión, con lo de antes, y sin asiento validado.
    const c = await cabecera(s, p.id)
    expect([c.status, ...cifras(c)]).toEqual(['en_revision', 263.66, 18.73, 282.39])
    const asientos = await rest<{ id: string }[]>(s, 'GET', `journal_entry?select=id&account_id=eq.${CUENTA_A.id}&source_type=eq.supplier_invoice&source_id=eq.${p.id}&status=eq.validado`)
    expect(asientos.datos).toEqual([])

    // «Descartar» lo devuelve todo y el botón vuelve a encenderse.
    await barra(page).getByRole('button', { name: 'Descartar' }).click()
    await expect(barra(page)).toHaveCount(0)
    await expect(region(page, 'Importes por tipo de IVA').getByLabel('Base al 4 %')).toHaveValue('127,40')
    await expect(boton).toBeEnabled()
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})

// ── 5 · Dos tipos de IVA (la COHELDI), y la captura junto al tablero ────────

test('D03 · dos tipos de IVA, como la COHELDI: base, IVA y total, y el asiento con 47200004 y 47200010; la captura junto al tablero 3b', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'sola', `P26 4.980-${lado(page)}-${sello()}`, COMO_COHELDI)
    await abrir(page, p)
    const importes = region(page, 'Importes por tipo de IVA')
    // Una línea por tipo (antes: «Tipo de IVA: —»), de menor a mayor.
    await expect(importes.locator('[data-prueba="linea-iva"]')).toHaveCount(2)
    await expect(importes.getByRole('combobox', { name: 'Tipo de IVA de la línea 1' })).toHaveValue('4')
    await expect(importes.getByRole('combobox', { name: 'Tipo de IVA de la línea 2' })).toHaveValue('10')
    await expect(importes.getByLabel('Base al 4 %')).toHaveValue('127,40')
    await expect(importes.getByLabel('Cuota al 4 %')).toHaveValue('5,10')
    await expect(importes.getByLabel('Base al 10 %')).toHaveValue('136,26')
    await expect(importes.getByLabel('Cuota al 10 %')).toHaveValue('13,63')
    const tot = importes.locator('[data-prueba="totales-iva"]')
    await expect(tot).toContainText(/Base\s*263,66/)
    await expect(tot).toContainText(/IVA\s*18,73/)
    await expect(tot).toContainText(/Total\s*282,39\s€/)
    await expect(importes.locator('[data-prueba="contra-pdf"]')).toContainText('Igual que el PDF')
    // El asiento: el gasto, el IVA de cada tipo en su cuenta y el proveedor; debe arriba, haber debajo; cuadra.
    expect(await lineaDelAsiento(page, /^60000000$/)).toEqual(['263,66', ''])
    expect(await lineaDelAsiento(page, /^47200004$/)).toEqual(['5,10', ''])
    expect(await lineaDelAsiento(page, /^47200010$/)).toEqual(['13,63', ''])
    expect(await lineaDelAsiento(page, /^400\d+$/)).toEqual(['', '282,39'])
    const codigos = (await asiento(page).locator('tbody td.s-asiento-codigo').allTextContents()).map((x) => x.trim())
    expect(codigos.at(-1), 'el haber (el proveedor) va debajo').toMatch(/^400\d+$/)
    await expect(asiento(page).locator('tfoot')).toContainText('Cuadra')
    await expect(asiento(page).locator('tfoot')).toContainText('282,39')
    await expect(barra(page)).toHaveCount(0)

    // La ficha terminada, sin cambios; y en el ordenador, al lado del tablero 3b.
    mkdirSync(DIR, { recursive: true })
    await page.mouse.move(0, 0)
    const png = await capturar(page, `${DIR}/ficha-recibida-${lado(page)}.png`)
    expect(errores).toEqual([])
    if (lado(page) === 'ordenador') {
      const tablero = readFileSync(TABLERO).toString('base64')
      const laFicha = png.toString('base64')
      await page.setViewportSize({ width: 2600, height: 1500 })
      await page.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 24px; background: #eceae6; font: 15px system-ui, sans-serif; color: #222; }
        .lado { display: flex; gap: 24px; align-items: flex-start; }
        figure { margin: 0; flex: 1 1 0; min-width: 0; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 1px 4px rgb(0 0 0 / .12); }
        figcaption { font-weight: 600; margin: 0 0 10px; }
        img { width: 100%; height: auto; display: block; }
      </style></head><body><div class="lado">
        <figure><figcaption>La ficha, hecha (staging, ordenador): ${p.numero}</figcaption><img alt="La ficha de la recibida" src="data:image/png;base64,${laFicha}"></figure>
        <figure><figcaption>El tablero 3b · «Ficha completa»</figcaption><img alt="El tablero 3b" src="data:image/webp;base64,${tablero}"></figure>
      </div></body></html>`)
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))
      await page.screenshot({ path: `${DIR}/ficha-y-tablero-ordenador.png`, fullPage: true })
    }
  } finally {
    await limpiar(s, [p])
  }
})

// ── 6 · Subir un PDF ────────────────────────────────────────────────────────

test('D03 · subir un PDF a una recibida sin documento: se ve a la derecha, se guarda y el Historial dice «Puso el PDF»', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'a-mano', `PD03-PDF-${lado(page)}-${sello()}`, UNA_AL_21)
    const nombre = `factura-e2e-d03-${lado(page)}.pdf`
    await abrir(page, p)
    const documento = page.getByRole('complementary', { name: 'Documento' })
    const hueco = page.locator('[data-prueba="hueco-pdf"]')
    await expect(hueco).toContainText('Arrastra aquí el PDF o la foto')
    await hueco.locator('input[type="file"]').setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: pdfMinimo(`Factura ${p.numero} - prueba e2e D03`) })
    // Elegido, se ve a la derecha (aún sin guardar) y cuenta como un cambio.
    await expect(documento.getByRole('img', { name: `El documento elegido para la factura ${p.numero}` })).toBeVisible({ timeout: 20_000 })
    await expect(documento.getByText('Sin guardar', { exact: true })).toBeVisible()
    await expect(documento).not.toContainText(/No he podido pintar|no se ha podido abrir/)
    await expect(barra(page)).toContainText(`1 cambio sin guardar · PDF: el que tenía → «${nombre}»`)
    expect((await cabecera(s, p.id)).raw_document_url, 'sin guardar, la factura sigue sin documento').toBeNull()

    await barra(page).getByRole('button', { name: /^Guardar cambios/ }).click()
    await expect(page.locator('.s-barra-cambios[data-tono="ok"]')).toContainText(`Documento puesto: «${nombre}».`, { timeout: 30_000 })
    const c = await cabecera(s, p.id)
    expect(c.raw_document_url, 'el documento, en la carpeta de la cuenta').toMatch(new RegExp(`^${CUENTA_A.id}/.+\\.pdf$`))
    // Guardado: ya no es un cambio pendiente; es el suyo, a la derecha, y el Historial lo cuenta.
    await expect(barra(page)).toHaveCount(0)
    await expect(documento.getByText('Sin guardar', { exact: true })).toHaveCount(0)
    await expect(documento.getByRole('img',{ name: `La factura ${p.numero} tal como llegó` })).toBeVisible({ timeout: 20_000 })
    await expect(hueco).toHaveCount(0)
    await expect(historial(page)).toContainText('Puso el PDF', { timeout: 20_000 })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})

// ── 7 · «Sin PDF», con su motivo ────────────────────────────────────────────

test('D03 · «Sin PDF»: sin motivo no deja; con motivo queda marcada y en el Historial', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'a-mano', `PD03-SIN-${lado(page)}-${sello()}`, UNA_AL_21)
    const motivo = `Ticket perdido (prueba e2e D03 ${lado(page)})`
    await abrir(page, p)
    const casilla = page.getByRole('checkbox', { name: /Sin PDF/ })
    await expect(casilla).not.toBeChecked()
    await casilla.check()
    await expect(barra(page)).toContainText('1 cambio sin guardar')
    // Sin motivo: no se guarda, y lo dice.
    await barra(page).getByRole('button', { name: /^Guardar cambios/ }).click()
    await expect(barra(page).getByRole('alert')).toContainText('Sin PDF: no se ha guardado (di por qué no hay documento)')
    await expect(barra(page)).toContainText('cambio')
    expect((await cabecera(s, p.id)).no_document_at, 'sin motivo, no queda marcada').toBeNull()

    // Con motivo: queda marcada, con su motivo, y lo dice.
    await page.getByLabel('Por qué no hay').fill(motivo)
    await barra(page).getByRole('button', { name: /^Guardar cambios/ }).click()
    await expect(page.locator('.s-barra-cambios[data-tono="ok"]')).toContainText(`Marcada «Sin PDF»: ${motivo}.`, { timeout: 30_000 })
    await expect(barra(page)).toHaveCount(0)
    const c = await cabecera(s, p.id)
    expect(c.no_document_at).not.toBeNull()
    expect(c.no_document_reason).toBe(motivo)
    await expect(casilla).toBeChecked()
    await expect(page.getByLabel('Por qué no hay')).toHaveValue(motivo)
    await expect(historial(page)).toContainText('Marcó «Sin PDF»', { timeout: 20_000 })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})

// ── D04 · El reparto de la pantalla y un PDF que se lea ─────────────────────

/**
 * Un PDF como el de la COHELDI (00-VR26102011251.pdf): A4, letra pequeña
 * (6 pt) y dos páginas. El de producción no se baja a staging; éste tiene su
 * forma: mucho texto pequeño, que es lo que se veía borroso.
 */
function pdfComoLaCoheldi(): Buffer {
  const pagina = (n: number) => {
    const lineas = Array.from({ length: 40 }, (_, i) => `COHELDI S.L. · albaran ${n}-${String(i + 1).padStart(2, '0')} · Ref 0${i}4.98${i} · 1,000 kg x 12,74 = 12,74 · IVA 4 %`)
    return `BT /F1 6 Tf 40 800 Td 8 TL ${lineas.map((l) => `(${l.replace(/[()\\]/g, '')}) '`).join(' ')} ET`
  }
  const contenidos = [pagina(1), pagina(2)]
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    ...contenidos.map((c) => `<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((o, i) => { posiciones.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Cada página pintada: su lienzo (píxeles de verdad) contra lo que ocupa en pantalla × la densidad. */
async function lienzos(page: Page) {
  return page.locator('[data-prueba="papel-pdf"] canvas').evaluateAll((xs) => xs.map((c) => {
    const k = c as HTMLCanvasElement
    return { ancho: k.width, css: k.clientWidth, dpr: window.devicePixelRatio, hoja: k.closest('.s-documento-hoja')?.clientWidth ?? 0 }
  }))
}
/** Pintado a la resolución del panel: el lienzo es lo que ocupa × la densidad (± 2 px de redondeo). */
async function aLaResolucionDelPanel(page: Page) {
  await expect.poll(async () => {
    const ls = await lienzos(page)
    return ls.length === 2 && ls.every((l) => l.css > 0 && Math.abs(l.ancho - l.css * l.dpr) <= 2)
  }, { timeout: 20_000, message: 'cada página, pintada al ancho que ocupa × devicePixelRatio' }).toBe(true)
  return lienzos(page)
}

test('D04 · la COHELDI: el PDF a la resolución del panel (no a un tamaño fijo), con sus dos páginas; se vuelve a pintar al ampliar y al mover el separador, que se recuerda', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const movil = lado(page) === 'movil'
  let p: Preparada | null = null
  try {
    p = await prepararRecibida(s, 'sola', `PD04-COHELDI-${lado(page)}-${sello()}`, COMO_COHELDI)
    const ruta = `${CUENTA_A.id}/d04/00-VR26102011251-${sello()}.pdf`
    const subido = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
      method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' }, body: new Uint8Array(pdfComoLaCoheldi()),
    })
    expect(subido.ok, `subir el PDF: ${subido.status} ${(await subido.text()).slice(0, 200)}`).toBe(true)
    const r = await rest(s, 'PATCH', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${p.id}`, { raw_document_url: ruta })
    expect(r.status, JSON.stringify(r.datos)).toBeLessThan(300)

    await abrir(page, p)
    const papel = page.locator('[data-prueba="papel-pdf"]')
    await expect(papel).toHaveAttribute('data-paginas', '2', { timeout: 30_000 })
    await expect(page.getByRole('img', { name: new RegExp(`La factura ${p.numero} tal como llegó`) })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Página 2 de 2' })).toBeAttached()
    // Al abrirlo, ocupa todo el ancho del panel; y se pinta a esa resolución por la densidad (no a un tamaño fijo).
    const antes = await aLaResolucionDelPanel(page)
    for (const l of antes) expect(Math.abs(l.css - l.hoja), 'la página, a todo el ancho del panel').toBeLessThanOrEqual(40)

    if (!movil) {
      // El reparto: los datos, como mucho 680 px; el PDF, lo que queda.
      const datos = await page.locator('.s-ficha-datos').boundingBox()
      expect(datos!.width).toBeLessThanOrEqual(681)
      // Ampliar: más píxeles, no los mismos estirados.
      await page.getByRole('button', { name: 'Acercar' }).click()
      await expect.poll(async () => (await lienzos(page))[0]?.ancho ?? 0, { timeout: 20_000 }).toBeGreaterThan(antes[0].ancho * 1.15)
      const ampliado = await aLaResolucionDelPanel(page)
      expect(ampliado[0].ancho).toBeGreaterThan(antes[0].ancho)
      await page.getByRole('button', { name: 'Alejar' }).click()
      await aLaResolucionDelPanel(page)
      // El separador: cinco flechas a la izquierda, datos 100 px más estrechos, el PDF más ancho y repintado.
      const sep = page.getByRole('separator', { name: 'Ancho de los datos y del documento' })
      const de = Number(await sep.getAttribute('aria-valuenow'))
      await sep.focus()
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
      await expect(sep).toHaveAttribute('aria-valuenow', String(de - 100))
      await expect.poll(async () => (await lienzos(page))[0]?.css ?? 0, { timeout: 20_000 }).toBeGreaterThan(antes[0].css + 50)
      await aLaResolucionDelPanel(page)
      // Se recuerda: al volver, el mismo ancho.
      await page.reload()
      await expect(page.getByRole('separator', { name: 'Ancho de los datos y del documento' })).toHaveAttribute('aria-valuenow', String(de - 100), { timeout: 30_000 })
      await page.getByRole('separator', { name: 'Ancho de los datos y del documento' }).focus()
      await page.keyboard.press('End')
    } else {
      // En el móvil: el PDF arriba, y se puede plegar.
      const doc = await page.getByRole('complementary', { name: 'Documento' }).boundingBox()
      const datos = await page.locator('.s-ficha-datos').boundingBox()
      expect(doc!.y, 'el documento, encima de los datos').toBeLessThan(datos!.y)
      await expect(page.getByRole('separator', { name: 'Ancho de los datos y del documento' })).toBeHidden()
      await page.getByRole('button', { name: 'Plegar el documento' }).click()
      await expect(page.getByRole('complementary', { name: 'Documento' }).getByRole('button', { name: 'Documento', exact: true })).toBeVisible()
      await page.getByRole('complementary', { name: 'Documento' }).getByRole('button', { name: 'Documento', exact: true }).click()
      await aLaResolucionDelPanel(page)
    }
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, [p])
  }
})
