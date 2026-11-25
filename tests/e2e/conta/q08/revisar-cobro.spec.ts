/// <reference lib="dom" />
// tests/e2e/conta/q08/revisar-cobro.spec.ts
//
// Q08 · Paso 3 · «Revisar el cobro» de diciembre frente a GoCardless, en una
// empresa con su cuenta REAL de GoCardless, a 1366 y a 1920:
//   1. arriba, una sola línea: «En paralelo: Sumied no cobra ni envía nada.
//      Compara con GoCardless»;
//   2. las diferencias arriba y en ámbar, con su motivo en palabras: «Nueva en
//      diciembre», «No se cobra en diciembre», «Importe distinto», «Sin atar a
//      su ficha»; las iguales, plegadas;
//   3. el botón de mandar el cobro a GoCardless NO sale;
//   4. «Descargar en Excel» baja el fichero y lo dice (regla 8).
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad.
// Lo que la pantalla LEE (el cobro de Sumied del mes, las suscripciones, los
// clientes y los enlaces de GoCardless) se simula con datos inventados (T11),
// como en el G04: en staging no hay una conexión real de GoCardless, y con una
// real nada se cobra ni se envía. Nada se escribe.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/q08'
const MES = '2026-12'
const NOMBRE = 'Gestoría de Prueba Norte, S.L.'

async function empresa(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const id = r.datos?.[0]?.id
  if (!id) throw new Error(`La cuenta de prueba A no tiene empresas (HTTP ${r.status}).`)
  return id
}

const recibo = (id: string, partyId: string, cliente: string, totalCent: number) => ({
  id, cliente_id: partyId, cliente, clave: `${partyId}|${MES}`, lineas: [{ asignacionId: `a-${id}`, servicioId: null, texto: 'Gestoría mensual', importeCent: totalCent, cuenta: '1 × cuota', trabajadores: null }],
  total_cent: totalCent, cobrar_cent: totalCent, anterior_cent: totalCent, cambios: [], pide_clic: null, parado: [], decision: 'pendiente', estado: 'preparado',
  cargo_el: null, confirmado_el: null, factura: null, factura_id: null,
})

async function simular(page: Page, E: string) {
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })
  // La empresa: una gestoría con nombre inventado.
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    const cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Record<string, unknown>) => (String(x.id) !== E ? x : { ...x, sector: 'gestoria', is_hospitality: false, legal_name: NOMBRE, trade_name: NOMBRE })
    return r.fulfill({ response: resp, body: JSON.stringify(Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Record<string, unknown>)) : cuerpo) })
  })
  // El cobro de Sumied de diciembre, preparado, con la cuenta REAL de GoCardless.
  await page.route(/\/rest\/v1\/rpc\/conta_pantalla_cobro/, (r) => json(r, {
    mes: { mes: MES, sin_recibo: [], iguales_aprobados: false, aviso_el: null, cargo_el: null, preparado_at: '2026-11-24T10:00:00Z', preparado_por_name: 'Persona de Prueba', enviado_at: null, enviado_por_name: null },
    ajustes: { dia_aviso: 2, dia_cargo: 4 }, conexion: { entorno: 'real' },
    recibos: [recibo('r1', 'p-igual', 'Cliente Igual de Prueba, S.L.', 12100), recibo('r2', 'p-distinto', 'Cliente Distinto de Prueba, S.L.', 15000), recibo('r3', 'p-baja', 'Cliente de Baja de Prueba, S.L.', 9000)],
  }))
  await page.route(/\/rest\/v1\/conta_recibo\?/, (r) => json(r, [
    { id: 'r1', party_id: 'p-igual', total_cent: 12100, decision: 'pendiente', party: { name: 'Cliente Igual de Prueba, S.L.' } },
    { id: 'r2', party_id: 'p-distinto', total_cent: 15000, decision: 'pendiente', party: { name: 'Cliente Distinto de Prueba, S.L.' } },
    { id: 'r3', party_id: 'p-baja', total_cent: 9000, decision: 'pendiente', party: { name: 'Cliente de Baja de Prueba, S.L.' } },
  ]))
  await page.route(/\/rest\/v1\/conta_gc_suscripcion\?/, (r) => json(r, [
    { gc_id: 'SB1', gc_cliente_id: 'CU-IGUAL', nombre: 'GESTORIA MENSUAL', proximo_cobro_importe: 121, proximo_cobro_fecha: '2026-12-04', estado: 'active' },
    { gc_id: 'SB2', gc_cliente_id: 'CU-DISTINTO', nombre: 'GESTORIA MENSUAL', proximo_cobro_importe: 161, proximo_cobro_fecha: '2026-12-04', estado: 'active' },
    { gc_id: 'SB3', gc_cliente_id: 'CU-NUEVO', nombre: 'GESTORIA MENSUAL', proximo_cobro_importe: 106, proximo_cobro_fecha: '2026-12-04', estado: 'active' },
    { gc_id: 'SB4', gc_cliente_id: 'CU-SUELTO', nombre: 'Vigilancia de notificaciones', proximo_cobro_importe: 60.5, proximo_cobro_fecha: '2026-12-07', estado: 'active' },
  ]))
  await page.route(/\/rest\/v1\/conta_gc_cliente\?/, (r) => json(r, [
    { gc_id: 'CU-IGUAL', nombre: 'Cliente Igual de Prueba, S.L.', party_id: 'p-igual' },
    { gc_id: 'CU-DISTINTO', nombre: 'Cliente Distinto de Prueba, S.L.', party_id: 'p-distinto' },
    { gc_id: 'CU-NUEVO', nombre: 'Cliente Nuevo de Prueba, S.L.', party_id: null },
    { gc_id: 'CU-SUELTO', nombre: 'Cliente Sin Ficha de Prueba', party_id: null },
  ]))
  await page.route(/\/rest\/v1\/conta_gc_enlace\?/, (r) => json(r, [{ gc_cliente_id: 'CU-NUEVO', party_id: 'p-nuevo', estado: 'atado' }]))
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Revisar el cobro» de diciembre frente a GoCardless a ${ancho}: en paralelo, diferencias en ámbar, sin «Enviar» y el Excel`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'La revisión del cobro, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const E = await empresa(s)
    await simular(page, E)
    await page.goto(`/conta/ventas/clientes-y-cuotas/cobro?empresa=${E}&mes=${MES}`, { timeout: 30_000 })

    // 1. Una sola línea arriba: en paralelo.
    await expect(page.locator('[data-prueba="en-paralelo"]')).toHaveText('En paralelo: Sumied no cobra ni envía nada. Compara con GoCardless.', { timeout: 30_000 })

    // 2. Las diferencias, arriba y en ámbar, con su motivo en palabras.
    const frente = page.locator('[data-prueba="frente-a-gocardless"]')
    await expect(frente).toBeVisible()
    const diferencias = frente.getByRole('table', { name: 'Diferencias con GoCardless en diciembre' })
    await expect(diferencias.locator('tbody tr')).toHaveCount(4)
    for (const [cliente, motivo] of [['Cliente Sin Ficha de Prueba', 'Sin atar a su ficha'], ['Cliente Nuevo de Prueba, S.L.', 'Nueva en diciembre'],
      ['Cliente de Baja de Prueba, S.L.', 'No se cobra en diciembre'], ['Cliente Distinto de Prueba, S.L.', 'Importe distinto']] as const) {
      const fila = diferencias.locator('tbody tr', { hasText: cliente })
      await expect(fila.locator('.g5-etiqueta')).toHaveText(motivo)
      await expect(fila.locator('.g5-etiqueta')).toHaveAttribute('data-tono', 'aviso')
    }
    await expect(frente.getByRole('button', { name: 'Ver el que cobra lo mismo' })).toBeVisible()
    // El frente va encima de la revisión de Sumied (las diferencias, arriba).
    const yFrente = (await frente.boundingBox())!.y
    const yCambios = (await page.getByRole('heading', { name: /Con cambios/ }).boundingBox())!.y
    expect(yFrente).toBeLessThan(yCambios)

    // 3. Con la cuenta real de GoCardless, el botón de mandar el cobro no sale.
    await expect(page.getByRole('button', { name: 'Enviar el cobro' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Enviar el cobro' })).toHaveCount(0)

    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/revisar-cobro-${ancho}.png` })

    // 4. El Excel, y lo dice.
    const [bajada] = await Promise.all([page.waitForEvent('download'), frente.getByRole('button', { name: 'Descargar en Excel' }).click()])
    expect(bajada.suggestedFilename()).toBe('Cobro de diciembre frente a GoCardless - Gestoria de Prueba Norte S L.xlsx')
    await expect(frente.getByRole('status')).toHaveText(/^Bajado: .*\.xlsx, 5 clientes \(4 con diferencias\)\.$/)

    expect(errores).toEqual([])
  })
}
