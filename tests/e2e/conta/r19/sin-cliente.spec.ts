/// <reference lib="dom" />
// tests/e2e/conta/r19/sin-cliente.spec.ts
//
// R19 · paso 1 · «Cobros de GoCardless sin cliente» (Julio, 25/11), a 1366 y a 1920:
//   1. arriba, lo que GoCardless cobrará este mes SIN ATAR a su ficha: suscripciones, clientes y euros, con la forma de
//      contar de la copia (lo atado no sale; lo que no cobra este mes no cuenta);
//   2. lo propuesto por correo sin confirmar también sale, con la propuesta de Sumied; con sus mandatos (banco y
//      dígitos, Q08) y, si el email está en varios clientes de GoCardless, sin proponer por email;
//   3. «No tiene ficha: apuntar para QBO» lo apunta (conta_gc_enlace_sin_ficha) y lo dice;
//   4. lo ya apuntado sale en su lista, con su Excel para dárselo a QBO.
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad. Lo que la pantalla LEE se simula con la
// siembra inventada del G04 (../g04/siembra.ts) y lo de GoCardless es INVENTADO (T11). Nada se escribe.

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

function asignar(Q: string) {
  const s = (cliente: string, id: string, importe: number, cobra = true) => ({ company_id: Q, gc_id: id, gc_cliente_id: cliente, nombre: 'GESTORIA MENSUAL', al_mes: importe,
    estado: 'active', proximo_cobro_fecha: cobra ? '2026-12-04' : '2027-01-04', proximo_cobro_importe: importe, cobra_en_el_mes: cobra })
  return {
    suscripciones: [s('CU-PROP', 'SB-1', 60.5), s('CU-PROP', 'SB-2', 10, false), s('CU-OTRO', 'SB-3', 24.2), s('CU-SIN', 'SB-4', 100), s('CU-APUNT', 'SB-5', 50), s('CU-ATADO', 'SB-6', 30)],
    meses: [{ company_id: Q, mes: '2026-12' }],
    gc_clientes: [
      { company_id: Q, gc_id: 'CU-PROP', nombre: 'GRUPO DE PRUEBA SL', correo: 'grupo@ejemplo.test', nif: null,
        enlace: { estado: 'propuesto', por: 'correo', party_id: null, candidatas: ['c8', 'c6'], porque: 'Su correo está en 2 fichas.' } },
      { company_id: Q, gc_id: 'CU-OTRO', nombre: 'OTRO DE PRUEBA SL', correo: 'repetido@ejemplo.test', nif: null, enlace: null },
      { company_id: Q, gc_id: 'CU-SIN', nombre: 'NADIE DE PRUEBA SL', correo: 'repetido@ejemplo.test', nif: null, enlace: null },
      { company_id: Q, gc_id: 'CU-APUNT', nombre: 'APUNTADO DE PRUEBA SL', correo: 'apuntado@ejemplo.test', nif: null,
        enlace: { estado: 'sin_ficha', por: 'persona', party_id: null, candidatas: [], porque: 'Persona de prueba dijo que no tiene ficha en Bitrix24.' }, mandatos: [] },
      { company_id: Q, gc_id: 'CU-ATADO', nombre: 'ATADO DE PRUEBA SL', correo: null, nif: null, enlace: { estado: 'atado', por: 'persona', party_id: 'c8', candidatas: [] }, mandatos: [] },
    ],
  }
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
  // Lo que QBO dejó pendiente en su Excel: aquí, nada. Y los mandatos (Q08), de su tabla.
  await page.route(/\/rest\/v1\/conta_gc_enlace\?/, (r) => json(r, []))
  await page.route(/\/rest\/v1\/conta_gc_mandato\?/, (r) => json(r, [
    { company_id: Q, gc_cliente_id: 'CU-PROP', estado: 'active', referencia: 'REF-PRUEBA-1', cuenta_final: '00', banco: 'Banco de Prueba' },
    { company_id: Q, gc_cliente_id: 'CU-OTRO', estado: 'active', referencia: 'REF-PRUEBA-2', cuenta_final: '99', banco: 'Otro Banco de Prueba' },
  ]))
  const LECTURAS: Record<string, (c: Record<string, unknown>) => unknown> = { ...pantallas(datos), conta_pantalla_asignar: () => asignar(Q) }
  const APUNTAR: Record<string, (c: Record<string, unknown>) => unknown> = {
    conta_gc_enlace_sin_ficha: () => ({ frase: 'NADIE DE PRUEBA SL no tiene ficha en Bitrix24: hay que crearla allí. Hasta entonces, sus cobros no salen en ninguna ficha.', deshacer_hasta: null }),
  }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (f in APUNTAR) { llamadas.push({ f, cuerpo }); return json(r, APUNTAR[f](cuerpo)) }
    if (f in FRASES) { llamadas.push({ f, cuerpo }); return json(r, FRASES[f](cuerpo)) }
    return r.fallback()
  })
  return llamadas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Cobros de GoCardless sin cliente» a ${ancho}: todo lo sin atar, la propuesta de Sumied, el banco y apuntar para QBO`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Unir los cobros de GoCardless, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const llamadas = await simular(page, Q, A)
    await page.goto('/conta/ventas/clientes-y-cuotas?ver=sin-cliente', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Cobros de GoCardless sin cliente' })).toBeVisible({ timeout: 30_000 })

    // 1. Arriba, lo sin atar que GoCardless cobrará este mes: lo atado y lo apuntado van aparte; lo que no cobra este mes no cuenta.
    await expect(page.locator('.g4-tf-subtitulo')).toHaveText('3 suscripciones de 3 clientes de GoCardless: 184,70 € en diciembre, sin atar a su ficha. Sumied propone la más probable; tú confirmas. En GoCardless no cambia nada.')
    await expect(page.locator('.g4-as-uno')).toHaveCount(3)
    await expect(page.getByRole('region', { name: 'ATADO DE PRUEBA SL' })).toHaveCount(0)

    // 2. Lo propuesto por correo sin confirmar, con la propuesta de Sumied y sus mandatos.
    const prop = page.getByRole('region', { name: 'GRUPO DE PRUEBA SL' })
    await expect(prop.locator('.g4-as-propuesta')).toHaveText('Propuesta de Sumied · 2 posibles por email: elige cuál')
    await expect(prop.locator('[data-prueba="mandatos"]')).toHaveText('Mandato: Banco de Prueba ··00 · ref. REF-PRUEBA-1 (activo)')
    await expect(prop.getByRole('radiogroup', { name: 'Posibles' }).getByRole('radio')).toHaveText(['Transportes de Ejemplo, S.L.', 'Construcciones Ficticias, S.A.'])
    await expect(prop.getByLabel('Buscar otro cliente para GRUPO DE PRUEBA SL')).toBeVisible()
    // Con el email en dos clientes de GoCardless, no se propone por email (Q08) y se ve el banco para elegir.
    const otro = page.getByRole('region', { name: 'OTRO DE PRUEBA SL' })
    await expect(otro.locator('[data-prueba="mandatos"]')).toHaveText('Mandato: Otro Banco de Prueba ··99 · ref. REF-PRUEBA-2 (activo)')
    await expect(otro.locator('[data-prueba="correo-en-varios"]')).toHaveText('Su email está en 2 clientes de GoCardless: no se propone por email. Mira la cuenta y la referencia para elegir.')
    await expect(page.getByRole('region', { name: 'NADIE DE PRUEBA SL' }).locator('[data-prueba="mandatos"]')).toHaveCount(0)
    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/sin-cliente-${ancho}.png`, fullPage: true })

    // 3. «No tiene ficha: apuntar para QBO»: lo apunta y lo dice.
    await page.getByRole('region', { name: 'NADIE DE PRUEBA SL' }).getByRole('button', { name: 'No tiene ficha: apuntar para QBO' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'NADIE DE PRUEBA SL no tiene ficha en Bitrix24: hay que crearla allí.' })).toBeVisible()
    expect(llamadas.filter((l) => l.f === 'conta_gc_enlace_sin_ficha').map((l) => l.cuerpo)).toEqual([{ p_company: Q, p_gc_cliente: 'CU-SIN' }])

    // 4. Lo ya apuntado, en su lista, con su Excel para QBO.
    const apuntados = page.locator('[data-prueba="apuntados-qbo"]')
    await expect(apuntados.getByRole('heading')).toHaveText('Apuntados para QBO · sin ficha en Bitrix24 (1)')
    await expect(apuntados.locator('li')).toHaveText('APUNTADO DE PRUEBA SL · 50,00 € en diciembre · apuntado@ejemplo.test · lo apuntó Persona de prueba')
    const [bajada] = await Promise.all([page.waitForEvent('download'), apuntados.getByRole('button', { name: 'Bajar la lista para QBO' }).click()])
    expect(bajada.suggestedFilename()).toMatch(/^sumied-sin-ficha-para-qbo-\d{4}-\d{2}-\d{2}\.xlsx$/)
    const libro = XLSX.read(Buffer.concat(await (await bajada.createReadStream()).toArray() as Buffer[]), { type: 'buffer' })
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[libro.SheetNames[0]])
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ Empresa: NOMBRES[0], 'Cliente de GoCardless': 'APUNTADO DE PRUEBA SL', 'Su código en GoCardless': 'CU-APUNT',
      Correo: 'apuntado@ejemplo.test', 'Cobrará este mes': 50, 'Lo apuntó': 'Persona de prueba' })

    expect(llamadas.map((l) => l.f), 'solo se ha apuntado lo que se ha pulsado').toEqual(['conta_gc_enlace_sin_ficha'])
    expect(errores).toEqual([])
  })
}
