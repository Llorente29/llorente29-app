/// <reference lib="dom" />
// tests/e2e/conta/r19/copia-gc.spec.ts
//
// R19 · paso 0 · «Bajar la copia de GoCardless», en Clientes y cuotas (la ruta de verdad, la G04), a 1366 y a 1920:
//   1. el botón sale ARRIBA, en la cabecera, al lado de «Exportar», con la línea de la última copia debajo
//      (de cuándo es y lo que GoCardless cobrará el mes que viene, según ella);
//   2. se puede elegir una copia de antes;
//   3. al pulsarlo baja un Excel con cinco hojas (Resumen, Clientes, Mandatos, Suscripciones y Cobros), con lo
//      copiado entero, y lo dice (regla 8).
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad. Lo que la pantalla LEE se simula con la
// siembra inventada del G04 (../g04/siembra.ts) y las copias son INVENTADAS (T11). Nada se escribe.

import { mkdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { FRASES, pantallas, siembra } from '../g04/siembra'

const DIR = 'docs/conta/capturas/r19'
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

const CUENTA = (euros: number, suscripciones: number, clientes: number) =>
  ({ regla: 'suscripciones active con su próximo cobro en el mes', mes: '2026-12', suscripciones, clientes, euros, dias: { '2026-12-04': suscripciones } })
const COPIAS = [
  { id: 'copia-nueva', tomada_at: '2026-11-25T14:02:00Z', por: 'persona', quien_name: 'Persona de prueba', clientes: 2, mandatos: 1, suscripciones: 3, cobros: 1, huella: 'h1', cuenta: CUENTA(133.1, 2, 2) },
  { id: 'copia-vieja', tomada_at: '2026-11-25T02:00:00Z', por: 'cada_noche', quien_name: null, clientes: 2, mandatos: 1, suscripciones: 3, cobros: 1, huella: 'h0', cuenta: CUENTA(121, 2, 2) },
]
const FILAS = [
  { tipo: 'cliente', gc_id: 'CU-UNO', datos: { gc_id: 'CU-UNO', nombre: 'CLIENTE UNO DE PRUEBA SL', correo: 'uno@ejemplo.test', nif: 'B00000011', mandatos_vivos: 1, suscripciones_activas: 2 } },
  { tipo: 'cliente', gc_id: 'CU-DOS', datos: { gc_id: 'CU-DOS', nombre: 'CLIENTE DOS DE PRUEBA SL', correo: 'dos@ejemplo.test', nif: null, mandatos_vivos: 0, suscripciones_activas: 1 } },
  { tipo: 'cobro', gc_id: 'PM-UNO', datos: { gc_id: 'PM-UNO', mandato_gc_id: 'MD-UNO', suscripcion_gc_id: 'SB-UNO', estado: 'paid_out', fecha: '2026-11-04', importe: 60.5, motivo_es: 'Cobrado' } },
  { tipo: 'mandato', gc_id: 'MD-UNO', datos: { gc_id: 'MD-UNO', gc_cliente_id: 'CU-UNO', estado: 'active', referencia: 'REF-PRUEBA-1', esquema: 'sepa_core' } },
  { tipo: 'suscripcion', gc_id: 'SB-DOS', datos: { gc_id: 'SB-DOS', gc_cliente_id: 'CU-DOS', nombre: 'GESTION LABORAL', importe: 72.6, estado: 'active', proximo_cobro_fecha: '2026-12-04', proximo_cobro_importe: 72.6 } },
  { tipo: 'suscripcion', gc_id: 'SB-TRES', datos: { gc_id: 'SB-TRES', gc_cliente_id: 'CU-UNO', nombre: 'VIEJA', importe: 10, estado: 'cancelled' } },
  { tipo: 'suscripcion', gc_id: 'SB-UNO', datos: { gc_id: 'SB-UNO', gc_cliente_id: 'CU-UNO', nombre: 'GESTORIA MENSUAL', importe: 60.5, estado: 'active', proximo_cobro_fecha: '2026-12-04', proximo_cobro_importe: 60.5 } },
]

async function simular(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const pedidas: { que: string; copia?: string; empresa?: unknown }[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Record<string, unknown>) => {
      const i = [Q, A].indexOf(String(x.id))
      if (i < 0) return x
      const y: Record<string, unknown> = { ...x, sector: 'gestoria', is_hospitality: false }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = NOMBRES[i]
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Record<string, unknown>)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Record<string, unknown>) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  await page.route(/\/rest\/v1\/([a-z_]+)\?/, (r) => {
    const nombre = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    if (r.request().method() !== 'GET' || !(nombre in datos)) return r.fallback()
    return json(r, datos[nombre])
  })
  // Lo copiado: el navegador lo pide de 1.000 en 1.000 (aquí cabe en una).
  await page.route(/\/rest\/v1\/conta_gc_copia_fila\?/, (r) => {
    const copia = /copia_id=eq\.([^&]+)/.exec(r.request().url())?.[1]
    pedidas.push({ que: 'filas', copia })
    return json(r, FILAS)
  })
  const LECTURAS = pantallas(datos)
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f === 'conta_gc_copias') { pedidas.push({ que: 'copias', empresa: cuerpo.p_company }); return json(r, COPIAS) }
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (f in FRASES) { pedidas.push({ que: `escribe:${f}` }); return json(r, FRASES[f](cuerpo)) }
    return r.fallback()
  })
  return pedidas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Bajar la copia de GoCardless» a ${ancho}: arriba en Clientes y cuotas, de cuándo es, y el Excel con sus cinco hojas`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'La copia de GoCardless, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const pedidas = await simular(page, Q, A)
    await page.goto('/conta/ventas/clientes-y-cuotas', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes y cuotas' })).toBeVisible({ timeout: 30_000 })

    // 1. Arriba, en la cabecera, al lado de «Exportar», con la línea de la última copia.
    const cabecera = page.locator('.g4-cabecera')
    const bloque = cabecera.locator('[data-prueba="copia-gc"]')
    const boton = bloque.getByRole('button', { name: 'Bajar la copia de GoCardless' })
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await expect(boton).toBeInViewport()
    await expect(cabecera.getByRole('button', { name: 'Exportar' })).toBeVisible()
    await expect(bloque.locator('[data-prueba="copia-gc-linea"]')).toHaveText('Copia del 25/11/2026 15:02 · en diciembre GoCardless cobrará 133,10 € a 2 clientes (2 suscripciones)')

    // 2. Se puede elegir la de antes (la de la noche).
    const fechas = bloque.getByLabel('Copia de GoCardless')
    await expect(fechas.locator('option')).toHaveText(['25/11/2026 15:02', '25/11/2026 03:00'])
    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/copia-gc-${ancho}.png` })
    await fechas.selectOption('copia-vieja')

    // 3. El Excel: cinco hojas y todo lo copiado, de la copia elegida; y lo dice.
    const [bajada] = await Promise.all([page.waitForEvent('download'), boton.click()])
    expect(bajada.suggestedFilename()).toBe('sumied-copia-gocardless-gestoria-de-prueba-norte-s-l-2026-11-25-0300.xlsx')
    const libro = XLSX.read(await (await bajada.createReadStream()).toArray().then((x) => Buffer.concat(x as Buffer[])), { type: 'buffer' })
    expect(libro.SheetNames).toEqual(['Resumen', 'Clientes', 'Mandatos', 'Suscripciones', 'Cobros'])
    const hoja = (n: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[n])
    expect(hoja('Resumen')[0]).toMatchObject({ 'Copia del': '25/11/2026 03:00', Por: 'La lectura de cada noche', 'Euros que cobra': 121, Suscripciones: 3 })
    expect(hoja('Clientes').map((f) => f.Nombre)).toEqual(['CLIENTE UNO DE PRUEBA SL', 'CLIENTE DOS DE PRUEBA SL'])
    expect(hoja('Suscripciones').map((f) => f.Importe)).toEqual([72.6, 10, 60.5])
    expect(hoja('Cobros')[0]).toMatchObject({ Cobro: 'PM-UNO', Estado: 'paid_out', Importe: 60.5, Motivo: 'Cobrado' })
    await expect(bloque.getByRole('status')).toHaveText('Bajada la copia de GoCardless de Gestoría de Prueba Norte, S.L. (25/11/2026 03:00).')

    expect(pedidas.filter((p) => p.que === 'filas').map((p) => p.copia)).toEqual(['copia-vieja'])
    expect(pedidas.filter((p) => p.que.startsWith('escribe:')), 'bajar la copia no escribe nada').toEqual([])
    expect(errores).toEqual([])
  })
}
