/// <reference lib="dom" />
// tests/e2e/conta/x28/tesoreria.spec.ts — X28 · Tesorería como ERP10 («Introducción de asientos por tesorería»,
// maqueta nucleo_21), contra staging, a 1366 × 768 y a 1920 × 1080, en la gestoría de ejemplo del núcleo (semillas
// K02, K04 y K05), con su «Banco principal» (57200001):
//   · «Leer fichero de extracto bancario» lee un Norma 43 de prueba (tres movimientos inventados, de hoy, con una
//     palabra nueva en cada pasada) y lo dice; antes de empezar se comprueba que los tres siguen sin contabilizar;
//   · los tres se contabilizan SOLO CON EL TECLADO: en la línea, la subcuenta y después Intro hasta el final, que
//     contabiliza y baja al siguiente sin contabilizar;
//   · en la base, cada uno conciliado con su asiento VALIDADO de la serie 3, la 62800000 contra la 57200001;
//   · la pantalla cabe sin estirarse: la ventana no pasa del ancho máximo y las casillas cortas miden lo mismo a 1366
//     que a 1920; la página no rueda.
// Cada ancho, su propio fichero (x28-<ancho>-…): lo de una pasada anterior se deshace antes (su casado y el extracto).

import { test, expect, type Page } from '@playwright/test'
import { enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x28'
const BANCO = () => enCarril('c0e20000-0000-4000-8000-0000000000b0')
const GASTO = '62800000'
/** El ancho máximo de la ventana (piezas.css, --kp-ventana-max), con un píxel de holgura. */
const VENTANA_MAX = 1351
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')
const pantalla = (page: Page) => zona(page).locator('[data-prueba="tesoreria-nucleo"]')
const hoyMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())

async function contarPantalla(page: Page, que: string) {
  const texto = await zona(page).innerText().catch(() => '(sin zona)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Lo de una pasada anterior de este ancho, fuera: su casado deshecho y el extracto deshecho. */
async function limpiar(s: Sesion, ancho: number) {
  const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=like.x28-${ancho}-*`)
  for (const e of ext.datos ?? []) {
    const movs = await rest<{ id: string; bank_match: { id: string; status: string }[] }[]>(s, 'GET', `bank_movement?select=id,bank_match(id,status)&statement_id=eq.${e.id}`)
    for (const m of movs.datos ?? []) for (const b of m.bank_match.filter((x) => x.status === 'vivo')) {
      const r = await rest(s, 'POST', 'rpc/bank_deshacer', { p_match: b.id, p_motivo: 'Limpieza de la e2e del X28' })
      expect(r.status, `deshacer lo de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
    }
    const r = await rest(s, 'POST', 'rpc/bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de la e2e del X28' })
    expect(r.status, `deshacer el extracto de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  }
}

/** El Norma 43 de prueba: tres pagos de hoy, con importes de esta pasada (no se repiten entre pasadas). */
async function extracto(s: Sesion, ancho: number) {
  const b = await rest<{ iban: string | null }[]>(s, 'GET', `treasury_account?select=iban&id=eq.${BANCO()}`)
  const iban = (b.datos?.[0]?.iban ?? 'ES0099990000000000000000').replace(/\s/g, '')
  const hoy = hoyMadrid()
  const base = 1000 + (Date.now() % 50000)
  // Una palabra inventada en cada pasada: ninguna regla, ninguna factura ni el historial de las pasadas de antes la
  // casan, así que el agente de conciliación no la contabiliza solo (solo lo hace con lo «seguro»).
  const palabra = Array.from({ length: 8 }, (_, i) => 'BCDFGHJKLMNPRSTVZ'[Math.floor(Date.now() / 17 ** i) % 17]).join('')
  const conceptos = ['UNO', 'DOS', 'TRES'].map((n) => `PRUEBA X28 ${palabra} ${n}`)
  const texto = escribirNorma43([{
    entidad: iban.slice(4, 8), oficina: iban.slice(8, 12), cuenta: iban.slice(14, 24), nombre: 'GESTORIA DE EJEMPLO', desde: hoy, hasta: hoy, saldoInicialCent: 10_000_000,
    movimientos: conceptos.map((c, i) => ({ fecha: hoy, importeCent: -(base + i * 7), comun: '17', concepto: c })),
  }])
  return { nombre: `x28-${ancho}-${Date.now()}.n43`, texto, conceptos }
}

const medidas: Record<number, Record<string, number | null>> = {}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`X28 · ${ancho} × ${alto}: leer un extracto y contabilizar tres movimientos solo con el teclado; cabe sin estirarse`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarComo(page, NUCLEO.email)
    await limpiar(s, ancho)
    const f = await extracto(s, ancho)

    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
    await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
    await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    await abierta(page, 'Inicio')
    await page.goto(`/conta/bancos?banco=${BANCO()}`, { timeout: 30_000 })
    await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
    await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })

    // Leer el extracto aquí mismo.
    await pantalla(page).locator('[data-prueba="fichero-extracto"]').setInputFiles({ name: f.nombre, mimeType: 'text/plain', buffer: Buffer.from(f.texto, 'latin1') })
    const aviso = pantalla(page).locator('[data-prueba="aviso-tesoreria"]')
    await expect(aviso, 'el extracto, leído y dicho').toContainText(`Leído «${f.nombre}»: 3 movimientos nuevos`, { timeout: 60_000 })
    const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=eq.${f.nombre}`)
    const movs = await rest<{ id: string }[]>(s, 'GET', `bank_movement?select=id&statement_id=eq.${ext.datos[0]?.id}&order=amount.desc`)
    const ids = (movs.datos ?? []).map((m) => m.id)
    expect(ids, 'los tres movimientos del extracto').toHaveLength(3)
    for (const id of ids) await expect(pantalla(page).locator(`tr[data-movimiento="${id}"]`), 'cada movimiento, una fila').toBeVisible({ timeout: 30_000 })
    // Antes de empezar: los tres siguen sin contabilizar (no depende de la suerte: si el agente los hubiera casado, aquí se dice).
    const antes = await rest<{ id: string; status: string }[]>(s, 'GET', `bank_movement?select=id,status&statement_id=eq.${ext.datos[0]?.id}`)
    expect((antes.datos ?? []).filter((x) => x.status === 'casado'), 'los tres, sin contabilizar al empezar').toEqual([])

    // Medir antes de contabilizar: la ventana y las casillas cortas.
    const m = await pantalla(page).evaluate((z) => {
      const r = (q: string) => { const e = z.querySelector(q); return e ? Math.round(e.getBoundingClientRect().width) : null }
      return { ventana: r('.kp-ventana'), doc: r('#ts-ed-doc'), fecha: r('#ts-ed-fecha'), subcuenta: r('#ts-ed-subcuenta'), saldo: r('#ts-saldo'), periodo: r('#ts-periodo'),
        ingresos: r('#ts-total-ingresos'), sobra: document.documentElement.scrollWidth - window.innerWidth, rueda: document.documentElement.scrollHeight - window.innerHeight }
    })
    console.log(`[X28] ${ancho} · ${JSON.stringify(m)}`)
    medidas[ancho] = m
    expect(m.ventana!, 'la ventana no pasa del ancho máximo').toBeLessThanOrEqual(VENTANA_MAX)
    expect(m.sobra, 'la página no rueda de lado').toBeLessThanOrEqual(1)
    expect(m.rueda, 'la página no rueda hacia abajo').toBeLessThanOrEqual(1)
    await page.screenshot({ path: `${DIR}/tesoreria-${ancho}.png` })

    // Los tres, solo con el teclado. La pantalla abre en el primer movimiento sin contabilizar del EJERCICIO (puede ser
    // uno de la semilla, de octubre: respuesta X28 · 3); la prueba elige el primero de los suyos con el teclado (el foco
    // en su fila e Intro), y después comprueba que la pantalla baja sola al segundo y al tercero.
    const orden = await pantalla(page).locator('tr[data-movimiento]').evaluateAll(
      (trs, mios) => trs.map((t) => t.getAttribute('data-movimiento') ?? '').filter((x) => (mios as string[]).includes(x)), ids)
    expect(orden, 'los tres, en la lista').toHaveLength(3)
    await pantalla(page).locator(`tr[data-movimiento="${orden[0]}"]`).focus()
    await page.keyboard.press('Enter')
    const sub = pantalla(page).locator('#ts-ed-subcuenta')
    try { for (let i = 0; i < 3; i++) {
      const elegida = pantalla(page).locator('tr[aria-selected="true"]')
      await expect(elegida, i === 0 ? 'el primero de los suyos, elegido con el teclado' : `la pantalla ha bajado sola al ${i + 1}.º`).toHaveAttribute('data-movimiento', orden[i], { timeout: 30_000 })
      await expect(sub).toBeFocused({ timeout: 10_000 })
      await sub.fill(GASTO)
      await page.keyboard.press('Enter')   // la subcuenta → el concepto
      await expect(pantalla(page).locator('#ts-ed-concepto')).toBeFocused()
      await page.keyboard.press('Enter')   // el concepto → el local
      await expect(pantalla(page).locator('#ts-ed-local')).toBeFocused()
      await page.keyboard.press('Enter')   // el local (el último, sin hostelería) → contabiliza
      await expect(aviso, `el ${i + 1}.º, contabilizado y dicho`).toContainText(`a la ${GASTO}`, { timeout: 30_000 })
      await expect(pantalla(page).locator(ids.map((id) => `tr[data-movimiento="${id}"][data-contabilizado="si"]`).join(', ')), 'contabilizados en la lista').toHaveCount(i + 1, { timeout: 30_000 })
    } } catch (e) { await contarPantalla(page, 'contabilizar con el teclado'); throw e }

    // En la base: cada uno conciliado, con su asiento validado de la serie 3 (la 62800000 contra el banco).
    for (const id of ids) {
      const r = await rest<{ status: string; bank_match: { status: string; journal_entry: { series: number; status: string; number: number | null; journal_line: { company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
        `bank_movement?select=status,bank_match(status,journal_entry(series,status,number,journal_line(company_account(code))))&id=eq.${id}`)
      const vivo = r.datos[0]?.bank_match.find((b) => b.status === 'vivo')
      expect({ movimiento: r.datos[0]?.status, serie: vivo?.journal_entry?.series, estado: vivo?.journal_entry?.status, numero: (vivo?.journal_entry?.number ?? 0) > 0,
        cuentas: vivo?.journal_entry?.journal_line.map((l) => l.company_account.code).sort() }, `el movimiento ${id}, en el diario`)
        .toEqual({ movimiento: 'casado', serie: 3, estado: 'validado', numero: true, cuentas: ['57200001', GASTO] })
    }
    await page.screenshot({ path: `${DIR}/tesoreria-contabilizados-${ancho}.png` })

    // A 1920, las casillas cortas miden lo mismo que a 1366 (no se estiran).
    if (ancho === 1920 && medidas[1366]) {
      for (const k of ['doc', 'fecha', 'subcuenta', 'saldo', 'periodo', 'ingresos']) {
        expect(Math.abs((medidas[1920][k] ?? 0) - (medidas[1366][k] ?? 0)), `${k} mide lo mismo a 1366 y a 1920`).toBeLessThanOrEqual(1)
      }
    }
    expect(errores).toEqual([])
  })
}
