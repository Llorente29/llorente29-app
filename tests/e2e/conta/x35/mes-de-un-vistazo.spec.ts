/// <reference lib="dom" />
// tests/e2e/conta/x35/mes-de-un-vistazo.spec.ts
//
// X35 · «El mes de un vistazo», el Inicio de «Clientes y cuotas», a 1366 y a 1920:
//   1. entra por «Clientes y cuotas»: el saludo, los tres meses y la banda del mes con su anillo, su frase y sus píldoras;
//   2. cada cifra (Cobrado, Por facturar, Te deben) se abre en su lista, y la lista suma exactamente la cifra;
//   3. «Cobrado» es el MISMO que el cuadre de «Facturas del mes», al céntimo (las dos pantallas, en la misma prueba);
//   4. «Lo que hay que resolver», ordenado por dinero; cada asunto se abre en su lista y lleva a su pantalla;
//   5. el mes que viene: lo que va a cobrar GoCardless.
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad. Lo que se lee se simula (siembra.ts,
// copiado de las e2e de la Q10 y del R20). Todo inventado (T11). Nada se escribe.

import { mkdirSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { dia } from '../g04/siembra'
import { simularCuenta, simularQ10 } from './siembra'

const DIR = 'docs/conta/capturas/x35'

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}
const cent = (t: string) => Math.round(Number(t.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.')) * 100)

/** Abre una cifra o un asunto y comprueba que su lista suma lo que se enseña; devuelve cuántas filas tiene. */
async function abrirYSumar(page: Page, boton: Locator, importe: string | null): Promise<number> {
  await boton.click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  const suma = await dialogo.getByTestId('x35-lista-suma').innerText()
  if (importe) expect(cent(suma), `la lista suma ${importe}`).toBe(cent(importe))
  const filas = await dialogo.locator('tbody tr').count()
  await page.keyboard.press('Escape')
  await expect(dialogo).toHaveCount(0)
  return filas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«El mes de un vistazo» a ${ancho}: la banda, cada cifra con su lista y Cobrado igual al cuadre`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El Inicio del gestor, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const MES = dia(0).slice(0, 7)
    await simularCuenta(page, Q, A)
    await simularQ10(page, Q, A, MES)

    // 1. La banda del mes.
    await page.goto(`/conta/ventas/clientes-y-cuotas/inicio?empresa=${Q}`, { timeout: 30_000 })
    const inicio = page.getByTestId('x35-inicio')
    await expect(inicio.getByRole('navigation', { name: 'Elegir mes' }).getByRole('button')).toHaveCount(3)
    const banda = page.getByRole('region', { name: /^El mes: / })
    await expect(banda).toBeVisible({ timeout: 40_000 })
    await expect(banda.getByRole('img', { name: /% del mes hecho$/ })).toBeVisible()
    await expect(banda.getByRole('list', { name: 'Los pasos del mes' }).getByRole('listitem')).toHaveCount(5)
    await expect(page.getByTestId('x35-frase')).not.toBeEmpty()
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/inicio-${ancho}.png`, fullPage: true })

    // 2. Cada cifra, con su lista que la suma.
    const cobrado = page.getByTestId('x35-cifra-cobrado')
    await expect(cobrado).toBeVisible()
    const valorCobrado = (await cobrado.locator('span').nth(1).innerText()).trim()
    expect(await abrirYSumar(page, cobrado, valorCobrado)).toBeGreaterThan(0)
    const porFacturar = page.getByTestId('x35-cifra-porFacturar')
    await expect(porFacturar).toBeVisible()
    const filasPorFacturar = Number((await porFacturar.locator('span').nth(1).innerText()).trim())
    expect(await abrirYSumar(page, porFacturar, null)).toBe(filasPorFacturar)
    // X35d · «Te deben» es lo del mes elegido: el único recibo sin cobrar es de hace 100 días, así que este mes da 0,00 €
    // y el recibo sale en «Recibos sin cobrar desde hace más de 90 días».
    const teDeben = page.getByTestId('x35-cifra-teDeben')
    await expect(teDeben.locator('span').nth(1)).toHaveText('0,00 €')
    await expect(page.getByTestId('x35-asunto-viejos')).toContainText('60,50 €')

    // 4. «Lo que hay que resolver», por dinero, y cada asunto con su lista.
    const asuntos = page.locator('[data-testid^="x35-asunto-"]')
    expect(await asuntos.count()).toBeGreaterThan(0)
    const importes: number[] = []
    for (const a of await asuntos.all()) {
      const importe = (await a.locator('span').nth(3).innerText()).trim()
      if (importe.endsWith('€')) { importes.push(cent(importe)); await abrirYSumar(page, a, importe) }
    }
    expect([...importes].sort((x, y) => y - x)).toEqual(importes)
    await page.getByTestId('x35-asunto-mandar').click()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Ir a Facturar el mes ›' })).toBeVisible()
    await page.keyboard.press('Escape')

    // PR 2 · «Cobrado y sin cobrar» (seis meses) y «Dónde se te escapa el dinero», cada uno con su lista.
    const grafica = page.getByTestId('x35-grafica')
    await expect(grafica.locator('[data-testid^="x35-mes-"]')).toHaveCount(6)
    await grafica.getByTestId(`x35-mes-${MES}`).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const escapa = page.getByTestId('x35-escapa')
    await expect(escapa.getByTestId('x35-escapa-pagadoDespues').locator('span').first()).toHaveText('108,90 €')
    expect(await abrirYSumar(page, escapa.getByTestId('x35-escapa-pagadoDespues'), '108,90 €')).toBe(1)
    await expect(escapa.getByTestId('x35-escapa-tarjeta').locator('span').first()).toHaveText('320,28 €')
    expect(await abrirYSumar(page, escapa.getByTestId('x35-escapa-tarjeta'), '320,28 €')).toBe(2)
    await escapa.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/escapa-${ancho}.png`, fullPage: true })

    // 3. Cobrado, igual que el cuadre de «Facturas del mes», al céntimo.
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
    const bancoQ10 = page.locator('[data-prueba="banco"]')
    await bancoQ10.getByRole('button', { name: 'Leer lo cobrado por el banco' }).click({ timeout: 40_000 })
    const frase = await page.locator('[data-prueba="cuadre-vias-frase"]').innerText({ timeout: 30_000 })
    const delCuadre = /Cobrado en [^:]+: ([\d.,]+ €)/.exec(frase)?.[1] ?? ''
    // En esta siembra nada se ha decidido como «no es un cobro»: el Cobrado del Inicio es el del cuadre, tal cual.
    expect(cent(valorCobrado), `«Cobrado» del Inicio (${valorCobrado}) y del cuadre (${delCuadre})`).toBe(cent(delCuadre))

    // 5. El mes que viene.
    await page.goto(`/conta/ventas/clientes-y-cuotas/inicio?empresa=${Q}`, { timeout: 30_000 })
    await page.getByRole('navigation', { name: 'Elegir mes' }).getByRole('button').nth(2).click()
    await expect(page.getByTestId('x35-cifra-seVaACobrar')).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: `${DIR}/siguiente-${ancho}.png`, fullPage: true })

    expect(errores, 'errores de la página').toEqual([])
  })
}
