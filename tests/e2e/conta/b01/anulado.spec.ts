/// <reference lib="dom" />
// tests/e2e/conta/b01/anulado.spec.ts
//
// B01·20 · El cargo que el banco anula (maqueta aprobada por Julio, 07/11), en
// staging-conta, cuenta A, en ordenador. Prepara el Norma 43 inventado de los
// tres bancos del B01 y, además, un extracto INVENTADO de «B01 · Norte» del
// 14/10 con un cargo de 2.150,00 € con el que el saldo del banco no bajó: el
// extracto empieza 2.150,00 € por encima de donde acabó el anterior (el hueco)
// y acaba donde acabó el anterior. Eso es lo que el banco nos da cuando anula
// un cargo sin saldo y la anulación no llega.
//   · antes: el aviso en la cuenta, con sus palabras, sus dos cifras y los
//     botones (captura «anulado-antes»);
//   · «Quitarlo»: la confirmación con contenido, el aviso se va y el cargo
//     sigue en la lista, tachado y con su etiqueta (captura «anulado-despues»);
//   · «Deshacer» desde la fila: vuelve a contar y el aviso vuelve;
//   · «No, es bueno»: el aviso se va y no vuelve.
// Las capturas van a docs/conta/capturas/b01/. Al acabar DESHACE todo: el
// extracto de la prueba y lo casado en los bancos B01.

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA, conLimpieza } from './datos'

const DIR = 'docs/conta/capturas/b01'
const NORTE = BANCOS_B01[0]
const NOMBRE = 'b01s-anulado.n43'
const CARGO_CENT = 215_000

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-ordenador.png`, fullPage: true })
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

type Base = Awaited<ReturnType<typeof baseDeA>>

/** El extracto de la prueba, fuera (con sus movimientos). */
async function quitarLoMio(base: Base) {
  const { data: ext } = await base.cliente.from('bank_statement').select('id').eq('treasury_account_id', NORTE).eq('file_name', NOMBRE)
  for (const e of ext ?? []) await base.bd.rpc('bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de la prueba del cargo anulado' })
}

async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes del cargo anulado')
  await quitarLoMio(base)
  const bancos = crearBancos(base.bd)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  const importar = async (nombre: string, texto: string) => {
    const a = { nombre, sha256: createHash('sha256').update(texto).digest('hex'), contenido: { texto } }
    const { extracto, cuadre } = leerYCuadrar(a)
    await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))
  }
  await importar('b01-tres-cuentas.n43', FICHERO)
  // Donde acabó Norte antes del 14/10, según su último extracto con saldo.
  const { data: ult, error } = await base.cliente.from('bank_statement').select('closing_balance, period_to')
    .eq('treasury_account_id', NORTE).not('closing_balance', 'is', null).lt('period_to', '2026-10-14').order('period_to', { ascending: false }).limit(1)
  if (error || !ult?.length) throw new Error(`No se puede leer el saldo de Norte: ${error?.message ?? 'sin extractos'}`)
  const finalCent = Math.round(Number(ult[0].closing_balance) * 100)
  // El 14/10: empieza 2.150,00 € por encima (el hueco) y, con el cargo, acaba donde acabó el anterior.
  await importar(NOMBRE, escribirNorma43([
    { entidad: '0182', oficina: '9101', cuenta: '0000000011', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-14', hasta: '2026-10-14', saldoInicialCent: finalCent + CARGO_CENT, movimientos: [
      { fecha: '2026-10-14', importeCent: -CARGO_CENT, comun: '15', concepto: 'ADEUDO TGSS CUOTAS OCTUBRE INVENTADO' },
    ] },
  ]))
  const { data: ext } = await base.cliente.from('bank_statement').select('id, continuity, continuity_gap').eq('treasury_account_id', NORTE).eq('file_name', NOMBRE)
  expect(ext?.[0]?.continuity, 'el extracto de la prueba tiene que llegar con su hueco').toBe('hueco')
  const { data: mov } = await base.cliente.from('bank_movement').select('id').eq('statement_id', ext![0].id)
  return { base, extracto: String(ext![0].id), movimiento: String(mov![0].id), finalCent }
}

test.describe('B01·20 · El cargo que el banco anula', () => {
  test.describe.configure({ timeout: 300_000 })
  test.use({ actionTimeout: 20_000 })

  test('ordenador: el aviso, «Quitarlo», «Deshacer» y «No, es bueno»', async ({ page }) => {
    test.skip(((page.viewportSize()?.width ?? 1440) < 768), 'En ordenador: las capturas de la maqueta.')
    const { base, extracto, movimiento, finalCent } = await preparar()
    const euros = (c: number) => eurosExactos(c / 100).replace(' €', '')
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()

      // Antes: el aviso, con sus palabras y sus dos cifras.
      const aviso = page.getByTestId(`anulado-${extracto}`)
      await expect(aviso).toBeVisible()
      await expect(aviso).toContainText('El banco anuló este cargo: no había saldo')
      await expect(aviso).toContainText('Lo apuntó el 14/10 y, como no había saldo, lo anuló.')
      // El concepto limpio, como en el resto de Bancos (el del banco, tal cual, va en el panel del movimiento).
      await expect(aviso).toContainText('Adeudo TGSS cuotas octubre INVENTADO')
      await expect(page.getByTestId('anulado-cifras')).toContainText(`banco ${euros(finalCent)} €. Sin él: los dos, ${euros(finalCent)} €.`)
      await expect(aviso.getByRole('button', { name: 'Quitarlo' })).toBeVisible()
      await expect(aviso.getByRole('button', { name: 'No, es bueno' })).toBeVisible()
      await capturar(page, 'anulado-antes')

      // «Quitarlo»: confirma con contenido; el cargo sigue en la lista, tachado y con su etiqueta.
      await aviso.getByRole('button', { name: 'Quitarlo' }).click()
      await expect(page.getByTestId('aviso-arriba')).toHaveText(`Quitado: el cargo de 2.150,00 € del 14/10 ya no cuenta. El saldo de Sumied es el del banco: ${euros(finalCent)} €.`)
      await expect(aviso).toHaveCount(0)
      const fila = page.getByTestId(`mov-${movimiento}`)
      await expect(fila.getByTestId(`apartado-${movimiento}`)).toHaveText('Anulado por el banco: no había saldo')
      await expect(fila.locator('.cxn-tachado')).toBeVisible()
      await fila.scrollIntoViewIfNeeded()
      await capturar(page, 'anulado-despues')

      // «Deshacer» desde la fila: vuelve a contar y el aviso vuelve.
      await fila.getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.getByText(/^Deshecho: el movimiento del 14\/10 de −2\.150,00 € vuelve a contar/)).toBeVisible()
      await expect(page.getByTestId(`anulado-${extracto}`)).toBeVisible()

      // «No, es bueno»: se va y no vuelve.
      await page.getByTestId(`anulado-${extracto}`).getByRole('button', { name: 'No, es bueno' }).click()
      await expect(page.getByTestId('aviso-arriba')).toHaveText('Hecho: el cargo de 2.150,00 € del 14/10 se queda, y no te vuelvo a avisar de él.')
      await page.reload()
      await expect(page.getByTestId('cuadre')).toBeVisible()
      await expect(page.getByTestId(`anulado-${extracto}`)).toHaveCount(0)
    }, async () => {
      await base.deshacerTodo('Limpieza después del cargo anulado')
      await quitarLoMio(base)
    })
  })
})
