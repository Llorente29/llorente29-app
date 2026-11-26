/// <reference lib="dom" />
// tests/e2e/conta/r20/cifras.spec.ts
//
// R20 · Las cifras de «Clientes y cuotas», 100 % fiables (Julio, 26/11), a 1366 y a 1920:
//   1. arriba, «GoCardless cobrará en <mes>», según GoCardless, y el día principal y los otros días; cada cifra se abre
//      en su lista y la lista suma exactamente la cifra;
//   2. «Cuotas en Sumied · <mes>», según las cuotas de Sumied, con las altas y las bajas de las líneas de Sumied (una
//      baja sale como baja, no «sin bajas»); como no cuadra con GoCardless, la diferencia en ámbar con sus partes, que
//      suman exactamente la diferencia;
//   3. «GoCardless no cobró» (aún sin cruzar con el banco, y lo dice), recibo a recibo, también el del mandato ya
//      cancelado, por antigüedad: cada tramo se abre en su lista y los tramos suman la cifra.
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad. Lo que la pantalla LEE se simula con la
// siembra inventada del G04 (../g04/siembra.ts), y lo de GoCardless es INVENTADO (T11). Nada se escribe.

import { mkdirSync } from 'node:fs'
import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { dia, FRASES, pantallas, siembra } from '../g04/siembra'

const DIR = 'docs/conta/capturas/r20'
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** El mes que viene (AAAA-MM): el del próximo cobro de esta siembra. */
const mesQueViene = () => { const [a, m] = dia(0).slice(0, 7).split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}` }

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

async function simular(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const M = mesQueViene()
  // Una baja (la renta de Panadería Muestra se cobra por última vez este mes) y un alta (una línea que empieza el mes que viene).
  datos.conta_consulta_asignacion.push(
    { id: 'baja-r20', tipo: 'cuota', cliente_id: 'c1', empresa_id: Q, servicio_id: `ren-${Q}`, nivel_id: null, paquete_id: null, empleado_nombre: null, importe_propio: 30, periodo: 'mes', desde: '2024-01-01', hasta: `${dia(0).slice(0, 7)}-01` },
    { id: 'alta-r20', tipo: 'cuota', cliente_id: 'c3', empresa_id: Q, servicio_id: `ren-${Q}`, nivel_id: null, paquete_id: null, empleado_nombre: null, importe_propio: 20, periodo: 'mes', desde: `${M}-01`, hasta: null },
  )
  // Un recibo fallido de un mandato ya cancelado: también se debe.
  datos.conta_consulta_cargo_devuelto.push({ cuenta_id: 'x', empresa_id: Q, gc_id: 'PM2', suscripcion_gc_id: 'S3-viejo', estado: 'failed', fecha: dia(-100), importe: 60.5,
    clientes: ['c3'], mandato_activo: false, cobrado_despues: false, otra_via: null })
  const s = (gc: string, ficha: string | null, cliente: string, importe: number, d: string) =>
    ({ empresa_id: Q, gc_id: `SB-${gc}`, gc_cliente_id: `CU-${gc}`, cliente_gc: cliente, ficha_id: ficha, nombre: 'GESTORIA MENSUAL', fecha: `${M}-${d}`, importe })
  const cobro = {
    meses: [{ empresa_id: Q, mes: M, leido_at: `${dia(0)}T06:15:00Z` }],
    suscripciones: [s('1', 'c1', 'PANADERIA MUESTRA SL', 145, '04'), s('3', 'c3', 'ESTUDIO DE PRUEBA SL', 121, '04'), s('8', 'c8', 'TRANSPORTES DE EJEMPLO SL', 496.1, '04'),
      s('X', null, 'SIN ATAR DE PRUEBA SL', 33, '14')],
  }
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
  const LECTURAS: Record<string, (c: Record<string, unknown>) => unknown> = { ...pantallas(datos), conta_cifras_del_cobro: () => cobro }
  const llamadas: string[] = []
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (f in FRASES) { llamadas.push(f); return json(r, FRASES[f](cuerpo)) }
    return r.fallback()
  })
  return { M, llamadas }
}

/** Pulsa una cifra (o el nombre de una parte, con su importe) y comprueba que su lista suma exactamente eso; devuelve sus filas. */
async function abrirYSumar(page: Page, boton: Locator, importe?: string): Promise<string[]> {
  const cifra = (importe ?? await boton.innerText()).trim().replace(/^\+/, '')
  await boton.click()
  const panel = page.locator('[data-panel="lista"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-fila="total"] b').last(), `la lista de «${cifra}» suma la cifra`).toHaveText(cifra)
  const filas = await panel.locator('[data-fila="lista"]').allInnerTexts()
  await panel.getByRole('button', { name: 'Cerrar' }).click()
  await expect(panel).toHaveCount(0)
  return filas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`Las cifras de «Clientes y cuotas» a ${ancho}: una fuente, su lista y la diferencia en ámbar`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Las cifras del despacho, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const { M, llamadas } = await simular(page, Q, A)
    const mes = MESES[Number(M.slice(5, 7)) - 1]
    await page.goto('/conta/ventas/clientes-y-cuotas', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes y cuotas' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('radiogroup', { name: 'Empresa' }).getByRole('radio', { name: NOMBRES[0] }).click()

    // 1. GoCardless, con su fuente; la cifra y cada día se abren en su lista, que suma la cifra.
    const banda = page.locator('[data-cifra="gocardless"]')
    await expect(banda).toContainText(`GoCardless cobrará en ${mes} · según GoCardless`)
    await expect(banda.locator('h2')).toHaveText('795,10 € · 4 cobros')
    expect(await abrirYSumar(page, banda.locator('h2 .g4-cifra-boton'))).toHaveLength(4)
    await expect(banda.locator('.g4-banda-linea')).toHaveText('El 4/' + Number(M.slice(5, 7)) + ': 762,10 € (3 cobros) · Otros días de ' + mes + ': 33,00 € (1 cobro)')
    for (const b of await banda.locator('.g4-banda-linea .g4-cifra-boton').all()) await abrirYSumar(page, b)

    // 2. Sumied, con su fuente, sus altas y bajas, y la diferencia en ámbar con sus partes.
    const sumied = page.locator('[data-cifra="sumied"]')
    await expect(sumied).toContainText(`Cuotas en Sumied · ${mes} · según las cuotas de Sumied`)
    await expect(sumied).toHaveAttribute('data-tono', 'aviso')
    await abrirYSumar(page, sumied.locator('.g4-cifra-valor .g4-cifra-boton'))
    await expect(sumied.getByRole('button', { name: '−1 baja (1 cliente)' })).toBeVisible()
    await expect(sumied).not.toContainText('sin bajas')
    await sumied.getByRole('button', { name: '−1 baja (1 cliente)' }).click()
    await expect(page.locator('[data-panel="lista"] [data-fila="lista"]')).toHaveCount(1)
    await expect(page.locator('[data-panel="lista"] [data-fila="lista"]')).toContainText('Panadería Muestra, S.L.')
    await expect(page.locator('[data-panel="lista"] [data-fila="lista"]')).toContainText('Renta')
    await page.locator('[data-panel="lista"]').getByRole('button', { name: 'Cerrar' }).click()
    await expect(sumied.getByRole('button', { name: '+1 alta (1 cliente)' })).toBeVisible()
    const ambar = sumied.locator('[data-cifra="diferencia"]')
    await expect(ambar).toContainText('más en')
    await expect(ambar.getByRole('row').filter({ hasText: 'GoCardless cobra a 1 cliente sin atar a ninguna ficha' })).toContainText('+33,00 €')
    // Las partes suman la diferencia, al céntimo.
    const cent = (t: string) => Math.round(Number(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.')) * 100)
    const filasAmbar = await ambar.getByRole('row').allInnerTexts()
    const partes = filasAmbar.slice(0, -1).map((f) => cent(f.split('\t').at(-1)!))
    expect(partes.reduce((a, b) => a + b, 0)).toBe(cent(filasAmbar.at(-1)!.split('\t').at(-1)!))
    for (const fila of (await ambar.getByRole('row').all()).slice(0, -1)) {
      await abrirYSumar(page, fila.locator('.g4-cifra-boton'), (await fila.locator('td').last().innerText()))
    }

    // 3. «GoCardless no cobró», sin cruzar con el banco (y lo dice), con el mandato cancelado dentro, por antigüedad.
    const nc = page.locator('[data-cifra="no-cobrado"]')
    await expect(nc.locator('.g4-cifra-titulo')).toHaveText('GoCardless no cobró · según GoCardless')
    await expect(nc).toContainText('Falta cruzar con el banco')
    await expect(nc.locator('.g4-cifra-valor')).toHaveText('169,40 €')
    expect(await abrirYSumar(page, nc.locator('.g4-cifra-valor .g4-cifra-boton'))).toHaveLength(2)
    await expect(nc).toContainText('De ellos, con el mandato ya cancelado: 60,50 €')
    expect((await nc.getByRole('row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()))
      .toEqual(['Hasta 30 días 0,00 €', 'De 31 a 60 días 0,00 €', 'De 61 a 90 días 108,90 €', 'Más de 90 días 60,50 €'])
    for (const fila of await nc.getByRole('row').all()) {
      if (await fila.locator('.g4-cifra-boton').count()) await abrirYSumar(page, fila.locator('.g4-cifra-boton'), await fila.locator('td').last().innerText())
    }

    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/cifras-${ancho}.png`, fullPage: false })
    expect(llamadas, 'solo se lee: nada se guarda').toEqual([])
    expect(errores).toEqual([])
  })
}
