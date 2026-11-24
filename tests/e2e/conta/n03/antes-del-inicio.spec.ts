/// <reference lib="dom" />
// tests/e2e/conta/n03/antes-del-inicio.spec.ts
//
// N03 · Una factura de antes del día en que la empresa empezó en Sumied: Sumied para y
// pregunta (Julio, 17/11). En el ordenador y en el móvil:
//   1. La ventana: al validar una recibida del 14/10/2026 en una empresa que empezó el
//      01/11/2026, sale la pregunta con el texto aprobado, palabra por palabra; los dos
//      botones del mismo tamaño y ninguno de por defecto (el foco no está en un botón).
//      Cerrarla no contesta: la factura sigue en revisión y sin asiento. «Sí, ya estaba»
//      lo dice con contenido (regla 8) y la ficha queda marcada, con «No estaba
//      contabilizada» y sin «Validar».
//   2. La lista: la marcada sale (regla 7) en «Apartadas» con su etiqueta gris
//      «Ya contabilizada en ERP10».
// Lo que dice la base (conta_recibida_antes_del_inicio y conta_recibida_responder_antes_del_inicio,
// de la 0955, y el estado de la lista de la 0956) está SIMULADO en el navegador con la forma
// que devuelve: staging solo ensaya la 0956 en ROLLBACK hasta que se aplique en producción. Que
// la base PARA de verdad (sin respuesta, «ya estaba», «es nueva», la traída) lo prueba la
// prueba de staging de la tanda (supabase/staging/sql/20261117_n03_antes_del_inicio_prueba.sql).
// «No, es nueva» no se pulsa aquí: contabilizaría de verdad en staging.
// La factura es de la prueba (a mano, sin PDF) y se borra al acabar.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/n03'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
/** Mayorista Prueba Alfa (semilla D01). */
const ALFA = enCarril('d0100000-0000-4000-8000-000000000001')
const QUIEN = 'Prueba e2e N03'
const FECHA = '2026-10-14'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Una recibida a mano del 14/10/2026, por revisar, marcada «Sin PDF» (así «Validar» se enciende). */
async function preparar(s: Sesion, numero: string): Promise<string> {
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: ALFA, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: numero, invoice_date: FECHA, status: 'en_revision', source: 'manual',
    tax_base_total: 100, tax_total: 21, grand_total: 121, created_by_name: QUIEN,
    notes: 'Dada de alta a mano, sin fichero (prueba e2e N03).',
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  const id = f.datos[0].id
  const l = await rest(s, 'POST', 'supplier_invoice_line', [{ supplier_invoice_id: id, raw_text: 'Material de limpieza', qty: 1, unit_price: 100, line_amount: 100, vat_pct: 21, position: 0 }])
  expect(l.status, `su línea: ${JSON.stringify(l.datos).slice(0, 300)}`).toBe(201)
  const sin = await rest(s, 'POST', 'rpc/conta_recibida_sin_papel', { p_invoice: id, p_sin: true, p_motivo: 'Prueba e2e N03: no hay papel', p_quien_nombre: QUIEN })
  expect(sin.status, `«Sin PDF»: ${JSON.stringify(sin.datos).slice(0, 300)}`).toBe(200)
  return id
}
async function limpiar(s: Sesion, id: string | null) {
  if (!id) return
  const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
  if (d.status >= 300) console.log(`[limpieza] la factura ${id}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
}

/** Lo que devolvería conta_recibida_antes_del_inicio: de antes del 01/11/2026, con ERP10; y la respuesta, si ya la hay. */
function antesDelInicio(respuesta: 'ya_estaba' | null) {
  return {
    preguntar: respuesta === null, fecha: FECHA, dia_inicio: '2026-11-01', programa: 'ERP10', respuesta,
    respondida_por: respuesta ? QUIEN : null, respondida_el: respuesta ? '2026-11-17T10:00:00+00:00' : null, tiene_asiento: false, traida: null,
  }
}

async function abrir(page: Page, id: string) {
  const laFicha = page.locator('[data-prueba="ficha-recibida"]')
  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`, { waitUntil: 'load' })
  try {
    await expect(laFicha).toBeVisible({ timeout: 20_000 })
  } catch {
    await page.reload({ waitUntil: 'load' })
    await expect(laFicha).toBeVisible({ timeout: 30_000 })
  }
}

test('N03 · 1 · la ventana: el texto aprobado, dos botones iguales, cerrar no contesta, y «Sí, ya estaba» lo dice', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let id: string | null = null
  try {
    id = await preparar(s, `N03-${lado(page)}-${sello()}`)
    let respuesta: 'ya_estaba' | null = null
    const respuestas: unknown[] = []
    await page.route(/\/rest\/v1\/rpc\/conta_recibida_antes_del_inicio(\?|$)/, (r) => json(r, antesDelInicio(respuesta)))
    await page.route(/\/rest\/v1\/rpc\/conta_recibida_responder_antes_del_inicio(\?|$)/, (r) => {
      const p = (r.request().postDataJSON() ?? {}) as { p_respuesta?: string | null }
      respuestas.push(p.p_respuesta ?? null)
      respuesta = p.p_respuesta === 'ya_estaba' ? 'ya_estaba' : null
      return json(r, { respuesta, programa: 'ERP10', texto: 'Hecho. No se contabiliza: ya estaba en ERP10.' })
    })
    await abrir(page, id)
    const validar = page.locator('[data-validar-y-siguiente]')
    await expect(validar).toBeEnabled({ timeout: 30_000 })
    await validar.click()

    // La ventana, palabra por palabra.
    const ventana = page.getByRole('dialog', { name: 'Esta factura es del 14/10/2026, y esta empresa empezó en Sumied el 01/11/2026.' })
    await expect(ventana).toBeVisible({ timeout: 20_000 })
    await expect(ventana.getByRole('heading', { level: 2 })).toHaveText('Esta factura es del 14/10/2026, y esta empresa empezó en Sumied el 01/11/2026.')
    await expect(ventana.locator('[data-prueba="pregunta-antes"]')).toHaveText('¿Ya estaba contabilizada en ERP10?')
    const si = ventana.getByRole('button', { name: 'Sí, ya estaba', exact: true })
    const no = ventana.getByRole('button', { name: 'No, es nueva', exact: true })
    await expect(si).toBeVisible()
    await expect(no).toBeVisible()
    // Del mismo tamaño y el mismo peso (la misma clase), uno al lado del otro.
    const [cs, cn] = [await si.boundingBox(), await no.boundingBox()]
    expect(Math.abs((cs?.width ?? 0) - (cn?.width ?? 1)), 'los dos botones, del mismo ancho').toBeLessThan(2)
    expect(await si.getAttribute('class')).toBe(await no.getAttribute('class'))
    // Ninguno es el de por defecto: el foco no está en un botón.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON')
    await page.screenshot({ path: `${DIR}/ventana-${lado(page)}.png` })

    // Cerrar no contesta: sigue en revisión y sin asiento.
    await page.keyboard.press('Escape')
    await expect(ventana).toHaveCount(0)
    expect(respuestas).toEqual([])
    const tras = await rest<{ status: string }[]>(s, 'GET', `supplier_invoice?select=status&account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
    expect(tras.datos.map((x) => x.status)).toEqual(['en_revision'])
    const asientos = await rest<{ id: string }[]>(s, 'GET', `journal_entry?select=id&account_id=eq.${CUENTA_A.id}&source_type=eq.supplier_invoice&source_id=eq.${id}`)
    expect(asientos.datos).toEqual([])

    // «Sí, ya estaba»: lo dice con contenido y la ficha queda marcada.
    await validar.click()
    await expect(ventana).toBeVisible({ timeout: 20_000 })
    await si.click()
    await expect(ventana).toHaveCount(0)
    expect(respuestas).toEqual(['ya_estaba'])
    await expect(page.locator('[data-prueba="antes-hecho"]')).toHaveText('Hecho. No se contabiliza: ya estaba en ERP10.', { timeout: 20_000 })
    const marca = page.locator('[data-prueba="ya-contabilizada"]')
    await expect(marca).toContainText('Ya contabilizada en ERP10: no se contabiliza en Sumied', { timeout: 20_000 })
    await expect(marca.getByRole('button', { name: 'No estaba contabilizada' })).toBeVisible()
    await expect(validar).toBeDisabled()
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, id)
  }
})

test('N03 · 2 · la lista: la marcada sale en «Apartadas», con «Ya contabilizada en ERP10» en gris', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  let id: string | null = null
  try {
    const numero = `N03-L-${lado(page)}-${sello()}`
    id = await preparar(s, numero)
    const nuestra = id
    // La lista de verdad, con nuestra factura como la devuelve la 0956 cuando se contestó «Sí, ya estaba».
    await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos(\?|$)/, async (r) => {
      const res = await r.fetch()
      const cuerpo = (await res.json()) as { filas?: Record<string, unknown>[] }
      for (const f of cuerpo.filas ?? []) {
        if (f.id === nuestra) {
          f.estado = 'ya_contabilizada'
          f.programa_antes = 'ERP10'
          f.porque = `Ya estaba contabilizada en ERP10: no se contabiliza en Sumied (${QUIEN}, 17/11/2026).`
        }
      }
      return r.fulfill({ response: res, json: cuerpo })
    })
    await page.goto('/conta/documentos?ver=otras', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Facturas recibidas', level: 1 })).toBeVisible({ timeout: 40_000 })
    // En «Apartadas» (y no en «Por revisar»): la fila, con su etiqueta gris.
    const suNumero = page.getByText(numero).first()
    await expect(suNumero).toBeVisible({ timeout: 40_000 })
    await expect(page.getByText('Ya contabilizada en ERP10', { exact: true }).first()).toBeVisible()
    // «Qué es» solo sale con más de un tipo en «Apartadas»: si sale, la suya está y la deja sola.
    const que = page.getByRole('group', { name: 'Qué es' })
    if (await que.count()) {
      const opcion = que.getByRole('button', { name: /^Ya contabilizada en ERP10 · \d+$/ })
      await expect(opcion).toBeVisible()
      await opcion.click()
      await expect(opcion).toHaveAttribute('aria-pressed', 'true')
      await expect(suNumero).toBeVisible()
    }
    await suNumero.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/lista-${lado(page)}.png`, fullPage: true })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, id)
  }
})
