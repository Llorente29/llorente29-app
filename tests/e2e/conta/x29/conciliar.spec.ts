/// <reference lib="dom" />
// tests/e2e/conta/x29/conciliar.spec.ts — X29 · «Conciliar» (Gestión de extractos bancarios, maquetas nucleo_23, 23b y
// 23c), contra staging, a 1366 × 768 y a 1920 × 1080, en la gestoría de ejemplo del núcleo (semillas K02, K04 y K05),
// con su «Banco principal» (57200001):
//   · «Traer el extracto» lee un Norma 43 de prueba (tres pagos inventados de hoy, con una palabra nueva en cada pasada y
//     un concepto largo) y lo dice;
//   · a los tres se les da la propuesta que daría Sumied (la 62800000, «probable»: no la contabiliza solo), como hace el
//     agente con bank_proponer;
//   · el filtro «Contabilizados: No» deja lo pendiente; los tres se marcan con el teclado (Espacio en cada fila) e Intro
//     los contabiliza en bloque, y lo dice;
//   · en la base, cada uno conciliado con su asiento validado de la serie 3 (la 62800000 contra la 57200001);
//   · el panel «Casar con facturas» se pliega (queda una pestaña estrecha con las propuestas), se recuerda al volver a
//     entrar y se despliega;
//   · el concepto largo se corta con «…» y el title lo dice entero;
//   · la pantalla cabe sin estirarse: la ventana no pasa del ancho máximo, la columna de bancos y el panel miden lo mismo a
//     1366 que a 1920, y la página no rueda.
// Cada ancho, su propio fichero (x29-<ancho>-…): lo de una pasada anterior se deshace antes (su casado y el extracto).

import { test, expect, type Page } from '@playwright/test'
import { enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x29'
const BANCO = () => enCarril('c0e20000-0000-4000-8000-0000000000b0')
const GASTO = '62800000'
/** El ancho máximo de la ventana (piezas.css, --kp-ventana-max), con un píxel de holgura. */
const VENTANA_MAX = 1351
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')
const pantalla = (page: Page) => zona(page).locator('[data-prueba="conciliar-nucleo"]')
const hoyMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())

async function contarPantalla(page: Page, que: string) {
  const texto = await zona(page).innerText().catch(() => '(sin zona)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Lo de una pasada anterior de este ancho, fuera: su casado deshecho y el extracto deshecho. */
async function limpiar(s: Sesion, ancho: number) {
  const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=like.x29-${ancho}-*`)
  for (const e of ext.datos ?? []) {
    const movs = await rest<{ id: string; bank_match: { id: string; status: string }[] }[]>(s, 'GET', `bank_movement?select=id,bank_match(id,status)&statement_id=eq.${e.id}`)
    for (const m of movs.datos ?? []) for (const b of m.bank_match.filter((x) => x.status === 'vivo')) {
      const r = await rest(s, 'POST', 'rpc/bank_deshacer', { p_match: b.id, p_motivo: 'Limpieza de la e2e del X29' })
      expect(r.status, `deshacer lo de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
    }
    const r = await rest(s, 'POST', 'rpc/bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de la e2e del X29' })
    expect(r.status, `deshacer el extracto de la pasada anterior: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  }
}

/** El Norma 43 de prueba: tres pagos de hoy, con importes y una palabra de esta pasada, y un concepto que no cabe. */
async function extracto(s: Sesion, ancho: number) {
  const b = await rest<{ iban: string | null }[]>(s, 'GET', `treasury_account?select=iban&id=eq.${BANCO()}`)
  const iban = (b.datos?.[0]?.iban ?? 'ES0099990000000000000000').replace(/\s/g, '')
  const hoy = hoyMadrid()
  const base = 2000 + (Date.now() % 50000)
  const palabra = Array.from({ length: 8 }, (_, i) => 'BCDFGHJKLMNPRSTVZ'[Math.floor(Date.now() / 17 ** i) % 17]).join('')
  const conceptos = ['UNO', 'DOS', 'TRES'].map((n) => `PRUEBA X29 ${palabra} ${n} RECIBO DOMICILIADO DE UN PROVEEDOR INVENTADO CON UN CONCEPTO MUY LARGO`)
  const texto = escribirNorma43([{
    entidad: iban.slice(4, 8), oficina: iban.slice(8, 12), cuenta: iban.slice(14, 24), nombre: 'GESTORIA DE EJEMPLO', desde: hoy, hasta: hoy, saldoInicialCent: 10_000_000,
    movimientos: conceptos.map((c, i) => ({ fecha: hoy, importeCent: -(base + i * 7), comun: '17', concepto: c })),
  }])
  return { nombre: `x29-${ancho}-${Date.now()}.n43`, texto, conceptos }
}

/** Entrar en Conciliar con el banco de la semilla, y esperar a que haya leído. */
async function abrir(page: Page) {
  await page.goto(`/conta/bancos/conciliar?banco=${BANCO()}`, { timeout: 30_000 })
  await expect(pantalla(page)).toBeVisible({ timeout: 30_000 })
  await expect(pantalla(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
}

const medidas: Record<number, Record<string, number | null>> = {}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`X29 · ${ancho} × ${alto}: traer un extracto, filtrar lo pendiente, marcar tres y contabilizarlos con Intro; el panel se pliega; cabe sin estirarse`, async ({ page }, info) => {
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
    await abrir(page)
    // El panel, desplegado para empezar (una pasada anterior pudo dejarlo plegado).
    if (await pantalla(page).locator('[data-prueba="casar-plegado"]').isVisible()) {
      await pantalla(page).locator('[data-prueba="casar-plegado"]').click()
      await expect(pantalla(page).locator('[data-prueba="casar-desplegado"]')).toBeVisible({ timeout: 10_000 })
    }

    // Traer el extracto desde la barra.
    await pantalla(page).locator('[data-prueba="fichero-extracto"]').setInputFiles({ name: f.nombre, mimeType: 'text/plain', buffer: Buffer.from(f.texto, 'latin1') })
    const aviso = pantalla(page).locator('[data-prueba="aviso-conciliar"]')
    await expect(aviso, 'el extracto, leído y dicho').toContainText(`Leído «${f.nombre}»: 3 movimientos nuevos`, { timeout: 60_000 })
    const ext = await rest<{ id: string }[]>(s, 'GET', `bank_statement?select=id&treasury_account_id=eq.${BANCO()}&file_name=eq.${f.nombre}`)
    const movs = await rest<{ id: string; status: string; amount: number }[]>(s, 'GET', `bank_movement?select=id,status,amount&statement_id=eq.${ext.datos[0]?.id}&order=amount.desc`)
    const ids = (movs.datos ?? []).map((m) => m.id)
    expect(ids, 'los tres movimientos del extracto').toHaveLength(3)
    expect((movs.datos ?? []).filter((x) => x.status === 'casado'), 'los tres, sin contabilizar al empezar').toEqual([])
    // La propuesta que daría Sumied, «probable» (no la contabiliza solo).
    for (const x of movs.datos ?? []) {
      const r = await rest(s, 'POST', 'rpc/bank_proponer', { p_movement: x.id, p_estado: 'propuesto', p_confianza: 'probable', p_porque: 'Como las 3 anteriores (prueba X29)',
        p_propuesta: { motor: MOTOR_BANCOS, origen: 'historial', destino: { tipo: 'cuenta', concepto: 'Prueba X29', lineas: [{ cuenta: GASTO, importe: Math.abs(Number(x.amount)) }] } } })
      expect([200, 204], `la propuesta del ${x.id}: ${JSON.stringify(r.datos).slice(0, 300)}`).toContain(r.status)
    }
    await abrir(page)

    // Lo pendiente: «Contabilizados: No».
    await pantalla(page).locator('#cn-f-contabilizados').getByRole('button', { name: 'No', exact: true }).click()
    const fila = (id: string) => pantalla(page).locator(`tr[data-movimiento="${id}"]`)
    for (const id of ids) await expect(fila(id), 'cada movimiento, una fila, en ámbar (propuesto)').toHaveAttribute('data-color', 'ambar', { timeout: 30_000 })
    await expect(pantalla(page).locator('tr[data-movimiento][data-contabilizado="si"]'), 'con el filtro, nada contabilizado a la vista').toHaveCount(0)
    await expect(pantalla(page).locator('[data-prueba="pie"]'), 'el pie cuenta lo sin contabilizar').toContainText('sin contabilizar')

    // El concepto largo, cortado con «…», y el title lo dice entero.
    const corto = fila(ids[0]).locator('td').nth(2).locator('.cn-corto')
    const c = await corto.evaluate((e) => ({ title: e.getAttribute('title'), cortado: e.scrollWidth > e.clientWidth, puntos: getComputedStyle(e).textOverflow }))
    expect(c.title, 'el title, el concepto entero').toContain('CON UN CONCEPTO MUY LARGO')
    expect(c.cortado, 'el concepto no cabe y se corta').toBe(true)
    expect(c.puntos, 'se corta con «…»').toBe('ellipsis')
    // Lo corto cabe entero: la fecha, el importe y el saldo de la fila, y las fechas del filtro.
    const cabe = await fila(ids[0]).evaluate((tr) => {
      const td = (i: number) => tr.querySelectorAll('td')[i] as HTMLElement
      const no = (e: HTMLElement | null) => !!e && e.scrollWidth > e.clientWidth + 1
      return { fecha: no(td(1)), importe: no(td(4)), saldo: no(td(5)), desde: no(document.querySelector('#cn-desde')), hasta: no(document.querySelector('#cn-hasta')) }
    })
    expect(cabe, 'la fecha, el importe, el saldo y las fechas del filtro caben enteros').toEqual({ fecha: false, importe: false, saldo: false, desde: false, hasta: false })

    // Medir: la ventana, la columna de bancos y el panel.
    const m = await pantalla(page).evaluate((z) => {
      const r = (q: string) => { const e = z.querySelector(q) ?? document.querySelector(q); return e ? Math.round(e.getBoundingClientRect().width) : null }
      return { ventana: r('.kp-ventana'), bancos: r('.cn-bancos'), panel: r('.cn-panel'), subcuenta: r('#cn-ed-subcuenta'), importe: r('#cn-ed-importe'),
        sobra: document.documentElement.scrollWidth - window.innerWidth, rueda: document.documentElement.scrollHeight - window.innerHeight }
    })
    console.log(`[X29] ${ancho} · ${JSON.stringify(m)}`)
    medidas[ancho] = m
    expect(m.ventana!, 'la ventana no pasa del ancho máximo').toBeLessThanOrEqual(VENTANA_MAX)
    expect(m.sobra, 'la página no rueda de lado').toBeLessThanOrEqual(1)
    expect(m.rueda, 'la página no rueda hacia abajo').toBeLessThanOrEqual(1)
    await page.screenshot({ path: `${DIR}/conciliar-${ancho}.png` })

    // Marcar los tres con el teclado (Espacio en cada fila) y contabilizarlos con Intro.
    try {
      for (const id of ids) { await fila(id).focus(); await page.keyboard.press(' '); await expect(fila(id), 'marcado').toHaveAttribute('data-marcado', 'si') }
      await expect(pantalla(page).locator('[data-prueba="marcados"]'), 'lo marcado, contado').toContainText('3 marcados')
      await page.keyboard.press('Enter')
      await expect(aviso, 'los tres, contabilizados y dicho').toContainText('Contabilizados: 3 movimientos', { timeout: 60_000 })
      for (const id of ids) await expect(fila(id), 'con el filtro «No», lo contabilizado sale de la lista').toHaveCount(0, { timeout: 30_000 })
    } catch (e) { await contarPantalla(page, 'marcar y contabilizar'); throw e }

    // En la base: cada uno conciliado, con su asiento validado de la serie 3 (la 62800000 contra el banco).
    for (const id of ids) {
      const r = await rest<{ status: string; bank_match: { status: string; journal_entry: { series: number; status: string; number: number | null; journal_line: { company_account: { code: string } }[] } | null }[] }[]>(s, 'GET',
        `bank_movement?select=status,bank_match(status,journal_entry(series,status,number,journal_line(company_account(code))))&id=eq.${id}`)
      const vivo = r.datos[0]?.bank_match.find((b) => b.status === 'vivo')
      expect({ movimiento: r.datos[0]?.status, serie: vivo?.journal_entry?.series, estado: vivo?.journal_entry?.status, numero: (vivo?.journal_entry?.number ?? 0) > 0,
        cuentas: vivo?.journal_entry?.journal_line.map((l) => l.company_account.code).sort() }, `el movimiento ${id}, en el diario`)
        .toEqual({ movimiento: 'casado', serie: 3, estado: 'validado', numero: true, cuentas: ['57200001', GASTO] })
    }
    // Con «Todos», los tres en verde.
    await pantalla(page).locator('#cn-f-contabilizados').getByRole('button', { name: 'Todos', exact: true }).click()
    for (const id of ids) await expect(fila(id), 'contabilizado, en verde').toHaveAttribute('data-color', 'verde', { timeout: 30_000 })

    // El panel: plegar (una pestaña estrecha), se recuerda al volver a entrar, y desplegar.
    await pantalla(page).locator('[data-prueba="casar-desplegado"] .cn-plegar').click()
    const plegado = pantalla(page).locator('[data-prueba="casar-plegado"]')
    await expect(plegado, 'plegado: la pestaña estrecha').toBeVisible({ timeout: 10_000 })
    await expect(plegado).toContainText(/Casar con facturas · \d+ propuestas?/)
    const estrecha = await plegado.evaluate((e) => Math.round(e.getBoundingClientRect().width))
    expect(estrecha, 'la pestaña plegada es estrecha').toBeLessThanOrEqual(30)
    await page.screenshot({ path: `${DIR}/conciliar-plegado-${ancho}.png` })
    await expect.poll(async () => (await rest<{ casar_plegado: boolean | null }[]>(s, 'GET', `conta_user_pref?select=casar_plegado&user_id=eq.${s.user.id}`)).datos?.[0]?.casar_plegado,
      { timeout: 15_000, message: 'plegado, guardado para esta persona' }).toBe(true)
    await abrir(page)
    await expect(plegado, 'al volver a entrar, sigue plegado').toBeVisible({ timeout: 15_000 })
    await plegado.click()
    await expect(pantalla(page).locator('[data-prueba="casar-desplegado"]'), 'desplegado otra vez').toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => (await rest<{ casar_plegado: boolean | null }[]>(s, 'GET', `conta_user_pref?select=casar_plegado&user_id=eq.${s.user.id}`)).datos?.[0]?.casar_plegado,
      { timeout: 15_000, message: 'desplegado, guardado' }).toBe(false)

    // A 1920, la columna de bancos y el panel miden lo mismo que a 1366 (no se estiran).
    if (ancho === 1920 && medidas[1366]) {
      for (const k of ['bancos', 'panel', 'subcuenta', 'importe']) {
        expect(Math.abs((medidas[1920][k] ?? 0) - (medidas[1366][k] ?? 0)), `${k} mide lo mismo a 1366 y a 1920`).toBeLessThanOrEqual(1)
      }
    }
    expect(errores).toEqual([])
  })
}
