/// <reference lib="dom" />
// tests/e2e/conta/q08/decisiones-qbo.spec.ts
//
// Q08 · Paso 2 · «Cargar decisiones de QBO», en la pantalla de Clientes que
// monta la ruta de verdad (la G04), a 1366 y a 1920:
//   1. el botón sale ARRIBA, en la cabecera, al lado de «Exportar»
//      (el #800 lo puso en la pantalla de antes, que no monta ninguna ruta, y
//      en producción no se veía: Julio, 25/11);
//   2. al elegir el Excel, lo dice con sus números (regla 8);
//   3. y enseña, fila a fila, lo que no se ha atado, con su porqué (regla 7).
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad.
// Lo que la pantalla LEE se simula con la siembra inventada del G04 (por qué, en
// ../g04/siembra.ts), y el Excel es INVENTADO y se hace aquí mismo (T11): el de
// QBO no entra nunca en el repositorio. Las dos funciones que atan se simulan y
// quedan apuntadas: nada se escribe.

import { mkdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
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

/** El Excel «Atar clientes GoCardless» contestado, con sus cabeceras de verdad y cuatro filas inventadas: una de cada clase. */
function excelInventado(): Buffer {
  const cab = ['Grupo', 'Cobra', 'Cliente en GoCardless', 'Correo en GoCardless', '€/mes en GoCardless', 'Qué paga (suscripciones)', 'Ficha candidata 1', 'Ficha candidata 2', 'Ficha candidata 3', 'Decisión', 'Nº de ficha en Bitrix24', 'Notas', 'Qué hacer']
  const f = (cliente: string, correo: string, c1: string, decision: string) => ['Dos fichas posibles', 'Prueba Norte', cliente, correo, '121', 'GESTORIA MENSUAL', c1, '', '', decision, '', '', '']
  const hoja = XLSX.utils.aoa_to_sheet([
    cab,
    f('CLIENTE UNO DE PRUEBA SL', 'uno@ejemplo.test', 'CLIENTE UNO DE PRUEBA SL · nº 9001 · activa', 'Es la candidata 1'),
    f('CLIENTE DOS DE PRUEBA SL', 'dos@ejemplo.test', 'CLIENTE DOS DE PRUEBA SL · nº 9002 · activa', 'no es esta, mirar la ficha de la madre'),
    f('CLIENTE TRES DE PRUEBA SL', 'tres@ejemplo.test', '', ''),
    f('CLIENTE QUE NO ESTA LEIDO SL', 'nadie@ejemplo.test', '', 'Es la candidata 1'),
  ])
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Para atar')
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
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
  await page.route(/\/rest\/v1\/conta_gc_cliente\?/, (r) => json(r, [
    { company_id: Q, gc_id: 'CU-UNO', nombre: 'CLIENTE UNO DE PRUEBA SL', correo: 'uno@ejemplo.test' },
    { company_id: Q, gc_id: 'CU-DOS', nombre: 'CLIENTE DOS DE PRUEBA SL', correo: 'dos@ejemplo.test' },
    { company_id: Q, gc_id: 'CU-TRES', nombre: 'CLIENTE TRES DE PRUEBA SL', correo: 'tres@ejemplo.test' },
  ]))
  await page.route(/\/rest\/v1\/conta_gestoria_cliente\?/, (r) => json(r, [
    { party_id: 'p-uno', bitrix_id: '9001', party: { name: 'Cliente Uno de Prueba, S.L.' } },
    { party_id: 'p-dos', bitrix_id: '9002', party: { name: 'Cliente Dos de Prueba, S.L.' } },
  ]))
  const LECTURAS = pantallas(datos)
  const ATAR: Record<string, (c: Record<string, unknown>) => unknown> = {
    conta_gc_enlace_decision_externa: () => ({ frase: 'Atado: CLIENTE UNO DE PRUEBA SL de GoCardless es Cliente Uno de Prueba, S.L. (lo decidió QBO, Excel del 12/11).' }),
    conta_gc_enlace_pendiente_externo: (c) => ({ frase: `Pendiente de revisar. QBO, Excel del 12/11 escribió: «${String(c.p_texto)}».` }),
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
  test(`«Cargar decisiones de QBO» a ${ancho}: arriba en Clientes y cuotas, lo dice y enseña lo que no se ata`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'La carga del Excel de QBO, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const llamadas = await simular(page, Q, A)
    await page.goto('/conta/ventas/clientes-y-cuotas', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes y cuotas' })).toBeVisible({ timeout: 30_000 })

    // 1. Arriba, en la cabecera, al lado de «Exportar».
    const cabecera = page.locator('.g4-cabecera')
    const boton = cabecera.getByRole('button', { name: 'Cargar decisiones de QBO' })
    await expect(boton).toBeVisible()
    await expect(cabecera.getByRole('button', { name: 'Exportar' })).toBeVisible()
    await expect(boton).toBeInViewport()

    // 2. Se elige el Excel y lo dice, con sus números.
    const [elegir] = await Promise.all([page.waitForEvent('filechooser'), boton.click()])
    await elegir.setFiles({ name: 'Atar clientes GoCardless contestado.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excelInventado() })
    const resultado = page.locator('[data-prueba="decisiones-qbo"]')
    await expect(resultado.getByRole('status')).toHaveText('Cargadas las decisiones de QBO (4 filas): 1 atados a su ficha, 1 pendientes de revisar con el texto de QBO, 1 que se atan solos, 1 que no están en lo leído de GoCardless.', { timeout: 30_000 })
    expect(llamadas.map((l) => l.f)).toEqual(['conta_gc_enlace_decision_externa', 'conta_gc_enlace_pendiente_externo'])
    expect(llamadas[0].cuerpo).toMatchObject({ p_company: Q, p_gc_cliente: 'CU-UNO', p_party: 'p-uno', p_origen: 'QBO, Excel del 12/11' })

    // 3. Lo que no se ha atado, fila a fila, con su porqué.
    await expect(resultado.locator('summary')).toHaveText('Lo que no se ha atado (2)')
    await expect(resultado.locator('li[data-resultado="pendiente"]')).toContainText('CLIENTE DOS DE PRUEBA SL')
    await expect(resultado.locator('li[data-resultado="pendiente"]')).toContainText('mirar la ficha de la madre')
    await expect(resultado.locator('li[data-resultado="sin_cliente"]')).toContainText('No está en lo leído de GoCardless')

    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/decisiones-qbo-${ancho}.png` })
    expect(errores).toEqual([])
  })
}
