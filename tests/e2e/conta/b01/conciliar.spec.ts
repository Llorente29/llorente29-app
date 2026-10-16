/// <reference lib="dom" />
// tests/e2e/conta/b01/conciliar.spec.ts
//
// B02 · tarea 4: «Bancos · Conciliar» (maqueta N17b) en staging-conta, cuenta
// A, en ordenador (1440) y móvil (390). Prepara lo de las pantallas del B01
// (el Norma 43 inventado de los tres bancos, conciliado) y, además, un
// segundo extracto INVENTADO de «B01 · Mercado» con tres recargas iguales el
// mismo día y una regla encendida sin confirmar que las propone con punto
// verde. Mira:
//   · que el cuadre, la barra, la banda y los contadores dicen lo mismo;
//   · el bloque («3 seguros seleccionados · Confirmar los 3»), los iguales en
//     una fila, el teclado (↑↓, espacio, Intro) y el buscador;
//   · el panel lateral (texto del banco tal cual, «¿Es otra cosa?», el
//     asiento que se crea) y «Casados solos», que se abre y se deshace.
// Las capturas van a docs/conta/capturas/b02/. Al acabar DESHACE todo: los
// casados, las propuestas, el extracto de las recargas y la regla; el libro
// de A con los mismos asientos que antes (misma vara: regla 31).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA } from './datos'

const DIR = 'docs/conta/capturas/b02'
const NORTE = BANCOS_B01[0]
const MERCADO = BANCOS_B01[2]
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// Mercado, después de su primer extracto (2.500 + 2.000 − 220 − 60 − 34,75): 4.185,25 €; después de este, 3.885,25 €.
const RECARGAS = escribirNorma43([
  { entidad: '0182', oficina: '9103', cuenta: '0000000013', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-14', hasta: '2026-10-14', saldoInicialCent: 418_525, movimientos: [
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
  ] },
])

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

async function abrir(nombre: string, texto: string) {
  return { nombre, sha256: createHash('sha256').update(texto).digest('hex'), contenido: { texto } }
}

async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes de Conciliar B02')
  await quitarLoMio(base)
  const asientosAntes = await base.contarAsientosA()
  const bancos = crearBancos(base.bd)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  for (const [nombre, texto] of [['b01-tres-cuentas.n43', FICHERO], ['b02-recargas.n43', RECARGAS]] as const) {
    const a = await abrir(nombre, texto)
    const { extracto, cuadre } = leerYCuadrar(a)
    await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))
  }
  await base.bd.rpc('bank_regla_guardar', { p_company: EMPRESA_A, p_id: null, p_palabras: 'Cuando el concepto tenga «RECARGA MONEDERO» → Saldo prepago · 40700001',
    p_condicion: { contiene: 'RECARGA MONEDERO' }, p_destino: { cuenta: '40700001' }, p_origen: 'persona', p_estado: 'activa' })
  const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-15')
  expect(r.fallos).toEqual([])
  return { ...base, asientosAntes }
}

/** El extracto de las recargas y la regla de prueba, fuera (después de deshacer los casados). */
async function quitarLoMio(base: Awaited<ReturnType<typeof baseDeA>>) {
  const { data: ext } = await base.cliente.from('bank_statement').select('id').eq('treasury_account_id', MERCADO).eq('file_name', 'b02-recargas.n43')
  for (const e of ext ?? []) await base.bd.rpc('bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de Conciliar B02' })
  const { data: reglas } = await base.cliente.from('bank_rule').select('id, status').eq('company_id', EMPRESA_A).contains('condition', { contiene: 'RECARGA MONEDERO' })
  for (const r of reglas ?? []) {
    if (r.status !== 'apagada') await base.bd.rpc('bank_regla_estado', { p_id: r.id, p_estado: 'apagada' })
    await base.bd.rpc('bank_regla_borrar', { p_id: r.id })
  }
}

/** Los números que enseñan la banda, la barra y los contadores, leídos de la pantalla. */
async function lasCifras(page: Page) {
  const frase = (await page.getByTestId('frase').textContent()) ?? ''
  const barra = (await page.getByTestId('barra').textContent()) ?? ''
  const n = (re: RegExp, t: string) => Number(re.exec(t)?.[1] ?? NaN)
  const contador = async (b: string) => Number(await page.getByTestId(`contador-${b}`).textContent())
  return {
    frase: { casados: n(/He casado yo (\d+)/, frase), todos: n(/de (\d+) movimientos/, frase), confirmar: n(/Te quedan (\d+) por confirmar/, frase), aclarar: n(/y (\d+) por aclarar/, frase) },
    barra: { casados: n(/(\d+) casados solos/, barra), confirmar: n(/(\d+) para confirmar/, barra), aclarar: n(/(\d+) por aclarar/, barra) },
    contadores: { casados: await contador('casados'), confirmar: await contador('confirmar'), aclarar: await contador('aclarar'), todos: await contador('todos') },
  }
}

test.describe('B02 · Bancos, conciliar', () => {
  test.describe.configure({ timeout: 300_000 })
  // Un clic que no puede darse falla en 20 s con su motivo, no al acabarse la prueba.
  test.use({ actionTimeout: 20_000 })

  test('ordenador: cuadre, bloque, iguales, teclado, panel y Casados solos', async ({ page }) => {
    test.skip(lado(page) !== 'ordenador', 'En el móvil va la suya.')
    const base = await preparar()
    try {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 2 })).toBeVisible()

      // Una sola cuenta: la banda, la barra y los contadores dicen lo mismo.
      const c = await lasCifras(page)
      expect(c.frase).toEqual({ casados: c.contadores.casados, todos: c.contadores.todos, confirmar: c.contadores.confirmar, aclarar: c.contadores.aclarar })
      expect(c.barra).toEqual({ casados: c.contadores.casados, confirmar: c.contadores.confirmar, aclarar: c.contadores.aclarar })
      for (const t of ['En el banco', 'En contabilidad', 'Te falta por casar']) await expect(page.getByTestId('cuadre')).toContainText(t)
      // El último extracto de Mercado (el de las recargas) acaba en 4.185,25 − 300 = 3.885,25 €.
      await expect(page.getByTestId('cuadre')).toContainText('3.885,25 €')

      // El bloque: lo de punto verde viene marcado; los iguales, en una fila.
      const bloque = page.getByRole('region', { name: 'Confirmar en bloque' })
      await expect(bloque).toContainText('3 seguros seleccionados')
      await expect(bloque.getByRole('button', { name: 'Confirmar los 3' })).toBeVisible()
      const recargas = page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' })
      await capturar(page, 'conciliar')
      await expect(recargas, `Las filas: ${(await page.locator('.cxn-fila').allTextContents()).join(' ‖ ').slice(0, 900)}`).toHaveCount(1)
      await expect(recargas).toContainText('3 iguales')
      await expect(recargas.locator('.cxn-pildora', { hasText: 'Regla' })).toBeVisible()
      await expect(recargas.getByRole('button', { name: 'Confirmar las 3' })).toBeVisible()

      // La casilla quita: ya no son «los seguros».
      await recargas.getByRole('checkbox').uncheck()
      await expect(bloque).toHaveCount(0)
      // Teclado: espacio marca, ↑↓ se mueve y abre el panel.
      const lista = page.getByRole('grid')
      await lista.focus()
      await page.keyboard.press(' ')
      await expect(bloque).toContainText('3 seguros seleccionados')
      await page.keyboard.press('ArrowDown')
      await expect(page.locator('.cxn-panel')).toBeVisible()
      await expect(page.locator('.cxn-panel')).toContainText('Lo que dice el banco, tal cual')

      // El buscador: por importe.
      await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('34,75')
      await expect(page.locator('.cxn-fila')).toHaveCount(1)
      await expect(page.locator('.cxn-fila')).toContainText('FERRETERIA')
      await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('')

      // El panel de un pago: «¿Es otra cosa?» y el asiento que se crea.
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).click()
      const panel = page.locator('.cxn-panel')
      await expect(panel).toContainText('RECARGA MONEDERO INVENTADO')
      await panel.getByText('¿Es otra cosa?').click()
      await expect(panel.getByRole('button', { name: 'Apuntar sin factura…' })).toBeVisible()
      await expect(panel.getByRole('button', { name: /^Traspaso a / }).first()).toBeVisible()
      await expect(panel.getByRole('button', { name: 'No va a contabilidad…' })).toBeVisible()
      await panel.getByText('Ver el asiento que se crea').click()
      await expect(panel.locator('.cxn-asiento')).toContainText('40700001')
      // La lista y el panel, a la vez, antes y después de la captura: si algo los desmonta, se ve aquí.
      await expect(page.getByRole('grid')).toBeVisible()
      await expect(panel).toBeVisible()
      await capturar(page, 'panel')
      await expect(panel, 'el panel se ha cerrado solo durante la captura').toBeVisible()

      // Intro confirma la fila enfocada (los 3 iguales), cada uno como si fuera solo, y lo dice.
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).getByRole('button', { name: 'Confirmar las 3' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Confirmados los 3')

      // Casados solos: en Norte, cada línea dice de qué movimiento habla y se deshace desde ella.
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10&ver=casados`)
      const casados = page.getByRole('list', { name: 'Casados solos' })
      await expect(casados.getByRole('listitem').first()).toContainText('Casado con')
      const antes = await casados.getByRole('listitem').count()
      expect(antes).toBe(Number(await page.getByTestId('contador-casados').textContent()))
      await capturar(page, 'casados-solos')
      await casados.getByRole('listitem').first().getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Deshecho: el movimiento del')
      await expect(casados.getByRole('listitem')).toHaveCount(antes - 1)
      const d = await lasCifras(page)
      expect(d.contadores.casados).toBe(antes - 1)
      expect(d.frase.casados).toBe(antes - 1)
    } finally {
      await base.deshacerTodo('Limpieza después de Conciliar B02')
      await quitarLoMio(base)
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    }
  })

  test('móvil: tarjetas, «Confirmar los 3 seguros» arriba y el panel en hoja', async ({ page }) => {
    test.skip(lado(page) !== 'movil', 'En el ordenador va la suya.')
    const base = await preparar()
    try {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      await expect(page.getByRole('link', { name: 'Confirmar los 3 seguros' })).toBeVisible()
      await capturar(page, 'portada')
      await page.getByRole('link', { name: 'Confirmar los 3 seguros' }).click()
      await expect(page.getByRole('region', { name: 'Confirmar en bloque' }).getByRole('button', { name: 'Confirmar los 3 seguros' })).toBeVisible()
      await capturar(page, 'conciliar')
      await expect(page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }), `Las filas: ${(await page.locator('.cxn-fila').allTextContents()).join(' ‖ ').slice(0, 900)}`).toHaveCount(1)
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).locator('.cxn-quien').click()
      await expect(page.getByRole('dialog')).toContainText('Lo que dice el banco, tal cual')
      await capturar(page, 'panel')
      await page.getByRole('dialog').getByRole('button', { name: 'Cerrar el panel' }).click()
      await page.getByRole('button', { name: /^Por aclarar/ }).click()
      await expect(page.locator('.cxn-fila', { hasText: 'FERRETERIA' })).toBeVisible()
      await capturar(page, 'por-aclarar')
    } finally {
      await base.deshacerTodo('Limpieza después de Conciliar B02 (móvil)')
      await quitarLoMio(base)
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    }
  })
})
