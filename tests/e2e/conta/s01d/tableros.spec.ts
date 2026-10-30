/// <reference lib="dom" />
// tests/e2e/conta/s01d/tableros.spec.ts
//
// S01d · Bancos y retenciones (#400): las capturas de los cuatro tableros de
// la maqueta, en ordenador (1440) y móvil (390), contra staging-conta, cuenta
// A. Con un Norma 43 INVENTADO en «B01 · Mercado» (una liquidación sin cuadro
// y dos recargas que propone una regla de prueba):
//   1 y 2 · «Decirlo yo» repartido en dos cuentas, con «Falta por repartir:
//           0,00 €» (tarjetas apiladas en el móvil), y casado;
//   3     · Préstamos y aplazamientos con un cuadro en Excel leído al lado y
//           «cuadra con lo aplazado». No se confirma: el alta
//           (bank_contrato_guardar, 0935) llega a staging de verdad al
//           fusionar; desde la rama solo va en ROLLBACK;
//   4     · «Validar y siguiente» hasta la tarjeta de fin de cuenta.
// Las capturas van a docs/conta/capturas/s01d/bancos/. Al acabar deshace lo
// casado, el extracto y la regla de prueba; lo validado queda anulado con su
// contraasiento (como en b01/conciliar).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA, conLimpieza } from '../b01/datos'

const DIR = 'docs/conta/capturas/s01d/bancos'
const MERCADO = BANCOS_B01[2]
const NOMBRE = 's01d-tableros.n43'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// Mercado, después de su primer extracto (b01): 4.185,25 €. Todo inventado.
const EXTRACTO = escribirNorma43([
  { entidad: '0182', oficina: '9103', cuenta: '0000000013', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-14', hasta: '2026-10-14', saldoInicialCent: 418_525, movimientos: [
    { fecha: '2026-10-14', importeCent: -133_334, comun: '99', concepto: 'LIQUIDACION APLAZADO INVENTADO' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA S01D INVENTADA' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA S01D INVENTADA' },
  ] },
])

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes de los tableros S01d')
  await quitarLoMio(base)
  const asientosAntes = await base.contarAsientosA()
  const bancos = crearBancos(base.bd)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  for (const [nombre, texto] of [['b01-tres-cuentas.n43', FICHERO], [NOMBRE, EXTRACTO]] as const) {
    const a = { nombre, sha256: createHash('sha256').update(texto).digest('hex'), contenido: { texto } }
    const { extracto, cuadre } = leerYCuadrar(a)
    await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))
  }
  await base.bd.rpc('bank_regla_guardar', { p_company: EMPRESA_A, p_id: null, p_palabras: 'Cuando el concepto tenga «RECARGA S01D» → Saldo prepago · 40700001',
    p_condicion: { contiene: 'RECARGA S01D' }, p_destino: { cuenta: '40700001' }, p_origen: 'persona', p_estado: 'activa' })
  const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-15')
  expect(r.fallos).toEqual([])
  return { ...base, asientosAntes }
}

/** El extracto de prueba y su regla, fuera (después de deshacer los casados). */
async function quitarLoMio(base: Awaited<ReturnType<typeof baseDeA>>) {
  const { data: ext } = await base.cliente.from('bank_statement').select('id').eq('treasury_account_id', MERCADO).eq('file_name', NOMBRE)
  for (const e of ext ?? []) await base.bd.rpc('bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de los tableros S01d' })
  const { data: reglas } = await base.cliente.from('bank_rule').select('id, status').eq('company_id', EMPRESA_A).contains('condition', { contiene: 'RECARGA S01D' })
  for (const r of reglas ?? []) {
    if (r.status !== 'apagada') await base.bd.rpc('bank_regla_estado', { p_id: r.id, p_estado: 'apagada' })
    await base.bd.rpc('bank_regla_borrar', { p_id: r.id })
  }
}

/** Un cuadro de amortización inventado, como el Excel del banco (títulos con una fila de cabecera encima). */
function cuadroExcel(): Buffer {
  const filas = [
    ['Cuadro de amortización · préstamo inventado'],
    [],
    ['Fecha', 'Cuota', 'Amortización', 'Intereses', 'Capital pendiente'],
    ['30/11/2026', '300,00', '250,00', '50,00', '750,00'],
    ['30/12/2026', '300,00', '260,00', '40,00', '490,00'],
    ['30/01/2027', '500,00', '490,00', '10,00', '0,00'],
  ]
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Cuadro')
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test.describe('S01d · los cuatro tableros de Bancos', () => {
  test.describe.configure({ timeout: 300_000 })
  test.use({ actionTimeout: 20_000 })

  test('tableros 1 y 2 · repartir un movimiento en dos cuentas, hasta «Falta por repartir: 0,00 €»', async ({ page }) => {
    const base = await preparar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()
      await page.getByRole('button', { name: /^Por aclarar/ }).first().click()
      const fila = page.locator('.cxn-fila', { hasText: 'LIQUIDACION APLAZADO INVENTADO' })
      await expect(fila, `Las filas: ${(await page.locator('.cxn-fila').allTextContents()).join(' ‖ ').slice(0, 900)}`).toHaveCount(1)
      await fila.getByRole('button', { name: 'Decirlo yo' }).click()

      const d = page.getByRole('dialog')
      await expect(d).toContainText('Decirlo yo · a qué va este movimiento')
      await d.getByLabel('Cuenta de la línea 1').fill('52010000')
      await d.getByLabel('Importe de la línea 1').fill('1.303,46')
      await d.getByLabel('Concepto de la línea 1').fill('Capital')
      // Hay dos «Falta por repartir» (el pie de la tabla y el fijo del móvil): cuenta el que se ve.
      const falta = d.locator('.cxr-falta:visible').first()
      await expect(falta).toContainText('Falta por repartir: 29,88')
      // «+ Repartir en otra cuenta» trae lo que falta.
      await d.getByRole('button', { name: '+ Repartir en otra cuenta' }).click()
      await expect(d.getByLabel('Importe de la línea 2')).toHaveValue('29,88')
      await d.getByLabel('Cuenta de la línea 2').fill('66230000')
      await d.getByLabel('Concepto de la línea 2').fill('Intereses')
      await expect(falta).toContainText('Falta por repartir: 0,00')
      const casar = d.getByRole('button', { name: 'Casar repartido en 2 cuentas' })
      await expect(casar).toBeEnabled()
      await capturar(page, 'tablero-1-2-repartir')

      await casar.click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText(/^Casado con .*52010000.*\+.*66230000/)
    }, async () => {
      await base.deshacerTodo('Limpieza después de repartir S01d')
      await quitarLoMio(base)
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    })
  })

  test('tablero 3 · Préstamos y aplazamientos: subir el cuadro en Excel y verlo al lado, cuadrado', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    vigilar(page)
    await page.goto('/conta/bancos/prestamos')
    await expect(page.getByRole('heading', { name: 'Préstamos y aplazamientos', level: 1 })).toBeVisible()
    await expect(page.getByText('Lo que queda por pagar')).toBeVisible()
    await page.getByLabel('Fichero del cuadro').setInputFiles({ name: 'cuadro-inventado.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: cuadroExcel() })

    const panel = page.getByRole('complementary', { name: 'Cuadro leído' })
    await expect(panel).toContainText('Cuadro leído · cuadro-inventado.xlsx')
    await expect(panel.getByRole('row')).toHaveCount(4)
    await panel.getByLabel('Nombre', { exact: true }).fill('Préstamo inventado')
    await panel.getByLabel('Lo que pone el banco').fill('AMORTIZACION PRESTAMO INVENTADO')
    await panel.getByLabel('Capital a corto').fill('52000000')
    await panel.getByLabel('Intereses', { exact: true }).fill('66230000')
    await expect(panel.getByRole('status')).toContainText('La suma del capital da 1.000,00')
    await expect(panel.getByRole('status')).toContainText('cuadra con lo aplazado')
    await expect(panel.getByRole('button', { name: 'Confirmar y crear el contrato' })).toBeEnabled()
    await capturar(page, 'tablero-3-prestamos')
    // Sin confirmar: el alta llega a staging de verdad al fusionar (ver la cabecera).
  })

  test('tablero 4 · «Validar y siguiente» hasta el fin de cuenta', async ({ page }) => {
    const base = await preparar()
    let validados = 0
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()
      await page.getByRole('region', { name: 'Confirmar en bloque' }).getByRole('button', { name: /^Confirmar los 2/ }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Confirmados los 2: sus asientos esperan en «Por validar».')

      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10&ver=validar`)
      const lista = page.getByRole('grid', { name: /^Por validar de octubre en / })
      const fin = page.locator('[data-prueba="fin-de-cuenta"]')
      await expect(lista.or(fin)).toBeVisible()
      for (let i = 0; i < 15 && !(await fin.isVisible()); i++) {
        const antes = await lista.getByRole('row').count()
        await lista.getByRole('row').first().getByRole('button', { name: 'Validar y siguiente' }).click()
        await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText(/^Validado: .+ es el asiento \d+\./)
        validados++
        await expect.poll(async () => (await fin.isVisible()) || (await lista.getByRole('row').count()) < antes).toBe(true)
      }
      await expect(fin).toBeVisible()
      await expect(fin).toContainText(/^.*al día/)
      await expect(fin.getByRole('heading', { level: 2 })).toContainText('Has terminado')
      await expect(fin).toContainText(validados === 1 ? 'Validado 1 movimiento' : `Validados ${validados} movimientos`)
      await capturar(page, 'tablero-4-fin-de-cuenta')
      // «Volver a la lista»: la lista vacía, sin saltar de banco.
      await fin.getByRole('button', { name: 'Volver a la lista' }).click()
      await expect(page.getByText('Nada por validar de octubre en')).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`banco=${MERCADO}`))
    }, async () => {
      await base.deshacerTodo('Limpieza después del fin de cuenta S01d')
      await quitarLoMio(base)
      // Lo validado no se borra: deshacerlo lo anula con su contraasiento (dos asientos por cada uno).
      expect(await base.contarAsientosA()).toBe(base.asientosAntes + 2 * validados)
    })
  })
})
