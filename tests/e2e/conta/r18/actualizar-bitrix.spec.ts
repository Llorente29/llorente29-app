/// <reference lib="dom" />
// tests/e2e/conta/r18/actualizar-bitrix.spec.ts
//
// R18b · Ajustes › Cobros › Tu CRM: «Actualizar Bitrix24», apagado de serie. Contra staging (cuenta A), a 1366 × 768
// y a 1920 × 1080, con la cuenta como gestoría y su Bitrix24 conectado SIMULADOS (inventado, T11: el portal es el de
// QBO, sin datos suyos). El interruptor y la clave se leen y guardan con las funciones de la 1730 (simuladas aquí con
// su forma; las prueba su prueba de staging, en ROLLBACK).
//   1. Apagado: arriba, «Bitrix24 no se actualiza: lo enciende Julio en Ajustes.»; sin el botón «Encender» (quien
//      mira no es de la plataforma); y en toda la visita nadie llama a la pestaña de Bitrix24 (no se escribe nada).
//   2. «Guardar la clave»: la manda con la cuenta y lo dice; la clave no vuelve a la pantalla.
// Sin palabras de dentro: ni «webhook» ni «placement».

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/r18'
const LINEA = 'Bitrix24 no se actualiza: lo enciende Julio en Ajustes.'
const CLAVE = 'https://crm.asesoriaqbo.es/rest/1/clavedepruebainventada0/'
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })

async function empresas(s: Sesion): Promise<string[]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  return (r.datos ?? []).map((x) => x.id)
}

async function simular(page: Page, ids: string[]) {
  const llamadas: { f: string; cuerpo: Record<string, unknown> }[] = []
  let clave = false
  // La cuenta, como gestoría: sus empresas con el sector «gestoria» (el resto de la fila, la de staging).
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Record<string, unknown>) => (ids.includes(String(x.id)) ? { ...x, sector: 'gestoria', is_hospitality: false } : x)
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Record<string, unknown>)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Record<string, unknown>) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  await page.route(/\/rest\/v1\/conta_cobro_gocardless\?/, (r) => json(r, []))
  await page.route(/\/rest\/v1\/conta_crm\?/, (r) => json(r, [{
    crm: 'bitrix24', entorno: 'real', portal: 'crm.asesoriaqbo.es', url_ref: '00000000-0000-4000-8000-000000000018', conectada_at: '2026-11-07T10:00:00Z',
    ultima_lectura_at: '2026-11-24T03:19:00Z', empresas_leidas: 0, mapa: null, campos_medidos: [], mapa_contactos: null, campos_medidos_contactos: [], contactos_leidos: null,
  }]))
  await page.route(/\/rest\/v1\/rpc\/conta_crm_actualizar_estado(\?|$)/, (r) => json(r, {
    actualizar: false, quien: null, cuando: null, clave, clave_quien: clave ? 'Persona de prueba' : null, clave_cuando: clave ? new Date().toISOString() : null, puede_encender: false,
  }))
  await page.route(/\/rest\/v1\/rpc\/conta_crm_clave_escribir_guardar(\?|$)/, (r) => {
    llamadas.push({ f: 'clave', cuerpo: r.request().postDataJSON() as Record<string, unknown> })
    clave = true
    return json(r, { frase: 'Clave guardada. Bitrix24 sigue sin actualizarse hasta que Julio lo encienda.' })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_crm_actualizar_poner(\?|$)/, (r) => { llamadas.push({ f: 'poner', cuerpo: r.request().postDataJSON() as Record<string, unknown> }); return json(r, { actualizar: false, frase: 'Apagado.' }) })
  // Nada de esta pantalla llama a la pestaña de Bitrix24 (la que escribe en las fichas).
  await page.route(/\/functions\/v1\/conta-bitrix-pestana/, (r) => { llamadas.push({ f: 'pestana', cuerpo: {} }); return json(r, {}) })
  return llamadas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`a ${ancho} × ${alto}: «Actualizar Bitrix24» apagado de serie, la línea de arriba y guardar la clave`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Ajustes de la gestoría, en el ordenador')
    test.setTimeout(120_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarComo(page, CUENTA_A.email)
    const llamadas = await simular(page, await empresas(s))
    await page.goto('/conta/ajustes/cobros')
    const bloque = page.locator('[data-prueba="actualizar-bitrix"]')
    await expect(bloque).toBeVisible({ timeout: 30_000 })
    await expect(bloque).toHaveAttribute('data-tono', 'apagado')
    await expect(bloque.locator('[data-prueba="actualizar-linea"]')).toHaveText(LINEA)
    await expect(bloque.getByRole('button', { name: 'Encender' })).toHaveCount(0)
    await expect(bloque.locator('[data-prueba="actualizar-clave"]')).toHaveText('Aún no hay clave para actualizar Bitrix24.')
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(/webhook|placement/i)
    await bloque.scrollIntoViewIfNeeded()
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/actualizar-apagado-${ancho}.png` })

    // Guardar la clave: va con la cuenta, lo dice y la clave no vuelve a la pantalla.
    await bloque.getByLabel('Clave para actualizar Bitrix24').fill(CLAVE)
    await bloque.getByRole('button', { name: 'Guardar la clave' }).click()
    await expect(bloque.getByRole('status')).toHaveText('Clave guardada. Bitrix24 sigue sin actualizarse hasta que Julio lo encienda.')
    await expect(bloque.locator('[data-prueba="actualizar-clave"]')).toContainText('Clave para actualizar guardada')
    await expect(bloque.locator('[data-prueba="actualizar-linea"]')).toHaveText(LINEA)
    expect(await page.locator('main').innerText()).not.toContain('clavedepruebainventada0')
    expect(llamadas.filter((l) => l.f === 'clave').map((l) => ({ cuenta: l.cuerpo.p_account, url: l.cuerpo.p_url }))).toEqual([{ cuenta: CUENTA_A.id, url: CLAVE }])
    expect(llamadas.filter((l) => l.f === 'pestana' || l.f === 'poner'), 'con el interruptor apagado no se llama a nada que escriba en Bitrix24').toEqual([])
    expect(errores).toEqual([])
  })
}
