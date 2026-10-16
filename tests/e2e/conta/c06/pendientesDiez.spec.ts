/// <reference lib="dom" />
// tests/e2e/conta/c06/pendientesDiez.spec.ts
//
// C06b · Respuesta 7, tarea 1: Libros › Diario › «Pendientes de adjuntar en
// Diez», en ordenador y móvil, con su captura en docs/conta/capturas/c06b/.
//
// Las filas las da la RED, no staging: Playwright contesta las lecturas de
// external_send, journal_entry y journal_entry_document de ESTOS asientos
// (ids inventados c06b7000-…), el PDF del bucket y «Ya está adjunto». Así no
// se siembra nada en la cuenta A, que comparten los tres frentes (otro frente
// vería envíos que no son suyos). El camino de la base —el CHECK, quién marca,
// B que no ve nada, lo que se autoriza— lo prueba la de staging
// (supabase/staging/sql/20261111_c06b_diez_pdf_pendiente_prueba.sql).
// Todo inventado.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c06b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ID = (n: number) => `c06b7000-0000-4000-8000-00000000000${n}`
const PDF = Buffer.from('%PDF-1.3\n% C06b prueba inventada\n%%EOF\n')

const ASIENTOS = [
  { id: ID(1), concept: 'Ventas Uber · Taberna de Prueba Norte', entry_date: '2026-10-01', series: 1, number: 9101, status: 'validado', doc: 9901, factura: 'UBR-PRU-20261001' },
  { id: ID(2), concept: 'Ventas Uber · Taberna de Prueba Norte', entry_date: '2026-10-02', series: 1, number: 9102, status: 'validado', doc: 9902, factura: 'UBR-PRU-20261002' },
  { id: ID(3), concept: 'Ventas Uber · Taberna de Prueba Norte', entry_date: '2026-10-03', series: 1, number: 9103, status: 'validado', doc: 9903, factura: 'UBR-PRU-20261003' },
  { id: ID(4), concept: 'Ventas Uber · Taberna de Prueba Norte', entry_date: '2026-09-30', series: 1, number: 9090, status: 'anulado', doc: 9890, factura: 'UBR-PRU-20260930', contra: ID(5) },
]

async function porLaRed(page: Page) {
  const adjuntos = new Set<string>()
  // R8: el contraasiento del anulado, que no llegó a Diez; «Enviar el contraasiento» lo manda.
  let contraEnDiez = false
  const json = (r: Route, cuerpo: unknown, cab: Record<string, string> = {}) => r.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(cuerpo) })
  const envios = () => [...ASIENTOS.map((a) => ({ entry_id: a.id, ext_year: '2026', ext_series: '1', ext_number: a.doc, ext_invoice_number: a.factura, sent_at: `${a.entry_date}T22:00:00Z`,
    document_status: adjuntos.has(a.id) ? 'adjunto' : 'pendiente_diez' })),
    ...(contraEnDiez ? [{ entry_id: ID(5), ext_year: '2026', ext_series: '1', ext_number: 9904, ext_invoice_number: 'UBR-PRU-20260930-ANUL', sent_at: '2026-10-14T10:00:00Z', document_status: null }] : [])]
  await page.route(/\/rest\/v1\/external_send\?/, async (r) => {
    const pendientes = envios().filter((e, i) => e.document_status === 'pendiente_diez' && ASIENTOS[i].status !== 'anulado').length
    // Como PostgREST: el recuento va en content-range, y el navegador solo lo deja leer si se expone por CORS.
    if (r.request().method() === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': `*/${pendientes}`, 'access-control-expose-headers': 'content-range', 'access-control-allow-origin': '*' }, body: '' })
    const url = r.request().url()
    if (url.includes('last_error')) return json(r, contraEnDiez ? [] : [{ entry_id: ID(5), last_error: 'Diez no ha aceptado el contraasiento: facturas/add → 500' }])
    return json(r, url.includes('ext_year') ? envios() : [])
  })
  await page.route(/\/rest\/v1\/journal_entry\?.*c06b7000/, (r) => json(r, ASIENTOS.map(({ id, concept, entry_date, series, number, status, contra }) => ({ id, concept, entry_date, series, number, status, voided_by_entry_id: contra ?? null }))))
  await page.route(/\/functions\/v1\/conta-diez-enviar/, async (r) => {
    const { entry_id } = r.request().postDataJSON() as { entry_id: string }
    if (entry_id !== ID(5)) return r.fulfill({ status: 400, body: '{}' })
    contraEnDiez = true
    return json(r, { estado: 'en_diez', serie: '1', documento: 9904, enlazada: false, pdfPendiente: false, texto: 'Anulada también en Diez: 1/9890 (UBR-PRU-20260930) con 1/9904 (UBR-PRU-20260930-ANUL).' })
  })
  await page.route(/\/rest\/v1\/journal_entry_document\?.*c06b7000/, (r) => json(r, ASIENTOS.map((a) => ({ entry_id: a.id, storage_path: `${CUENTA_A.id}/${a.id}/0123456789abcdef.pdf`, file_name: `ResumenDeVentas_${a.factura}.pdf` }))))
  await page.route(/\/storage\/v1\/object\/conta-documentos\//, (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF }))
  await page.route(/\/rest\/v1\/rpc\/conta_diez_adjunto_a_mano/, async (r) => {
    const { p_entry } = r.request().postDataJSON() as { p_entry: string }
    const a = ASIENTOS.find((x) => x.id === p_entry)!
    const ya = adjuntos.has(p_entry); adjuntos.add(p_entry)
    return json(r, { serie: '1', numero: a.doc, ya_estaba: ya, via: 'a_mano' })
  })
}

test('Pendientes de adjuntar en Diez: cuántos, el más antiguo, la referencia, el zip y «Ya está adjunto»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await porLaRed(page)
  await page.goto('/conta/libros/diario/pendientes-diez')
  await expect(page.getByRole('heading', { name: 'Pendientes de adjuntar en Diez' })).toBeVisible({ timeout: 20_000 })

  // La acción, en la barra de Libros, cuenta lo pendiente: con filas, nunca «nada pendiente» (regla 7).
  // M01 (Julio, 16/10): en el ordenador, en la segunda fila de la barra de
  // arriba, con el número escrito («· 3»); en el móvil, en la lista del área.
  await expect(page.getByRole('link', { name: /Pendientes de adjuntar en Diez/ }))
    .toContainText((page.viewportSize()?.width ?? 1440) >= 768 ? 'Pendientes de adjuntar en Diez · 3' : '3 sin su PDF')
  // Cuántos y el más antiguo (lo anulado no cuenta aquí: va aparte).
  await expect(page.getByText('3 facturas están en Diez sin su PDF. La más antigua, del 01/10/26.')).toBeVisible()
  const lista = page.getByRole('list', { name: 'Facturas en Diez sin su PDF' })
  await expect(lista.getByRole('listitem')).toHaveCount(3)
  // La referencia en Diez de cada una, y el nombre que lleva en el zip.
  await expect(lista.getByRole('listitem').first()).toContainText('En Diez: asiento 1/9901 (2026) · factura UBR-PRU-20261001')
  await expect(lista.getByRole('listitem').first()).toContainText('En el zip: 2026-1-9901.pdf')
  // Lo anulado en Folvy que sigue en Diez, aparte y en ámbar.
  const anulados = page.getByRole('list', { name: 'Anulados que siguen en Diez' })
  await expect(anulados.getByRole('listitem')).toHaveCount(1)
  await expect(anulados).toContainText('falta su contraasiento en Diez')
  // R8: por qué no ha llegado su contraasiento, y el botón que lo manda.
  await expect(anulados).toContainText('No ha llegado: Diez no ha aceptado el contraasiento: facturas/add → 500')
  await expect(anulados.getByRole('button', { name: 'Enviar el contraasiento' })).toBeVisible()

  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/pendientes-diez-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])

  // «Descargar todos»: un zip con cada PDF con el nombre de su referencia en Diez (regla 8: lo dice).
  const [bajada] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar todos (3)' }).click()])
  expect(bajada.suggestedFilename()).toMatch(/^PDF pendientes en Diez \d{4}-\d{2}-\d{2}\.zip$/)
  const zip = (await (await bajada.createReadStream()).toArray()).map((x: Buffer) => x.toString('latin1')).join('')
  for (const n of ['2026-1-9901.pdf', '2026-1-9902.pdf', '2026-1-9903.pdf']) expect(zip).toContain(n)
  await expect(page.getByRole('status').filter({ hasText: 'Bajado:' })).toContainText('con 3 de 3 PDF, cada uno con el nombre de su referencia en Diez')

  // «Ya está adjunto», uno: lo dice y sale de la lista.
  await lista.getByRole('listitem').first().getByRole('button', { name: 'Ya está adjunto' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Hecho:' })).toContainText('el PDF de 1/9901 queda adjunto en Diez')
  await expect(lista.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByText('2 facturas están en Diez sin su PDF. La más antigua, del 02/10/26.')).toBeVisible()

  // R8: «Enviar el contraasiento»: lo dice con su contenido y el anulado sale de la lista (ya está anulado también en Diez).
  await anulados.getByRole('button', { name: 'Enviar el contraasiento' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Anulada también en Diez' })).toContainText('1/9890 (UBR-PRU-20260930) con 1/9904 (UBR-PRU-20260930-ANUL)')
  await expect(page.getByRole('list', { name: 'Anulados que siguen en Diez' })).toHaveCount(0)
})
