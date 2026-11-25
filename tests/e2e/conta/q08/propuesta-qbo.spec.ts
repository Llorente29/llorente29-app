/// <reference lib="dom" />
// tests/e2e/conta/q08/propuesta-qbo.spec.ts
//
// Q08 · Los que QBO dejó pendientes en su Excel (escribió un nombre en vez del
// nº de ficha), en «Cobros de GoCardless sin cliente», a 1366 y a 1920:
//   1. salen los primeros, con lo que escribió QBO y la ficha que lleva ese
//      nombre, diciendo si se llama igual o solo lo lleva;
//   2. nada se une solo: «Es esta: unir a …» lo pulsa una persona, y guarda
//      con conta_gc_enlace_confirmar (quién y cuándo); lo dice (regla 8).
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad.
// Lo que la pantalla LEE se simula con la siembra inventada del G04 (por qué, en
// ../g04/siembra.ts), y el Excel es INVENTADO y se hace aquí mismo (T11): el de
// QBO no entra nunca en el repositorio. Las dos funciones que atan se simulan y
// quedan apuntadas: nada se escribe.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { FRASES, pantallas, siembra } from '../g04/siembra'

const DIR = 'docs/conta/capturas/q08'
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

async function simular(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const llamadas: { f: string; cuerpo: Record<string, unknown> }[] = []
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
  // Lo que lee «Cargar decisiones de QBO»: los clientes de GoCardless y las fichas (van después: mandan sobre la siembra).
  // Lo que QBO dejó pendiente: para «Persona Inventada» de GoCardless escribió el nombre corto de una ficha.
  await page.route(/\/rest\/v1\/conta_gc_enlace\?/, (r) => json(r, [
    { company_id: Q, gc_cliente_id: 'CU2x', porque: 'Pendiente de revisar. QBO, Excel del 12/11 escribió: «Construcciones Ficticias».' },
  ]))
  const LECTURAS = pantallas(datos)
  const ATAR: Record<string, (c: Record<string, unknown>) => unknown> = {
    conta_gc_enlace_confirmar: () => ({ frase: 'Enlazado: Persona Inventada de GoCardless es Construcciones Ficticias, S.A.. Desde ahora sus cobros salen en su ficha.', deshacer_hasta: null }),
  }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (f in ATAR) { llamadas.push({ f, cuerpo }); return json(r, ATAR[f](cuerpo)) }
    if (f in FRASES) return json(r, FRASES[f](cuerpo))
    return r.fallback()
  })
  return llamadas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`Lo que QBO dejó pendiente a ${ancho}: la ficha con ese nombre, propuesta y confirmada con un clic`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Unir los cobros de GoCardless, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const llamadas = await simular(page, Q, A)
    await page.goto('/conta/ventas/clientes-y-cuotas?empresa=las-dos&ver=sin-cliente', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Cobros de GoCardless sin cliente' })).toBeVisible({ timeout: 30_000 })

    // 1. El que contestó QBO, el primero, con su texto y la ficha que lleva ese nombre (no se llama igual: lo dice).
    const uno = page.getByRole('region', { name: 'Persona Inventada' })
    await expect(page.locator('.g4-as-uno').first()).toHaveAttribute('aria-label', 'Persona Inventada')
    await expect(uno.locator('[data-qbo]')).toHaveText('QBO escribió «Construcciones Ficticias»: ninguna ficha se llama exactamente así; «Construcciones Ficticias, S.A.» lleva ese nombre. Mira que sea ella antes de unir.')
    // Los demás, como antes.
    await expect(page.getByRole('region', { name: 'TRANSPORTES DE EJEMPLO SL' })).toContainText('Propuesto por NIF: Transportes de Ejemplo, S.L.')
    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/propuesta-qbo-${ancho}.png` })

    // 2. Nada se ha unido solo; lo confirma una persona y lo dice.
    expect(llamadas).toEqual([])
    await uno.getByRole('button', { name: 'Es esta: unir a Construcciones Ficticias, S.A.' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Enlazado: Persona Inventada de GoCardless es Construcciones Ficticias, S.A.' })).toBeVisible()
    expect(llamadas).toEqual([{ f: 'conta_gc_enlace_confirmar', cuerpo: { p_company: Q, p_gc_cliente: 'CU2x', p_party: 'c6' } }])
    expect(errores).toEqual([])
  })
}
