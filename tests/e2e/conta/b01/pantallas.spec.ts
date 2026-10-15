/// <reference lib="dom" />
// tests/e2e/conta/b01/pantallas.spec.ts
//
// B01 · tarea 5: las pantallas de Bancos en staging-conta, cuenta A, en
// ordenador (1440) y móvil (390). Antes de mirar, prepara lo mismo que la
// demostración del motor (el Norma 43 inventado de los tres bancos B01, ver
// datos.ts), da de alta UNA tarjeta de débito (···0937, «Ana Prueba», en
// Banco B01 · Norte) y concilia. Las capturas van a docs/conta/capturas/b01/
// pantallas/ para compararlas con N17Bancos. Al acabar, DESHACE todo: los
// casados, las propuestas y la tarjeta; el libro de A con los mismos asientos
// que antes (mismo recuento, misma vara: regla 31).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA } from './datos'

const DIR = 'docs/conta/capturas/b01/pantallas'
const NORTE = BANCOS_B01[0]
const MERCADO = BANCOS_B01[2]
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** Una pieza sola (la banda del agente), para verla de cerca. */
async function capturarPieza(page: Page, selector: string, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.locator(selector).first().screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  // Nada flotante tapa contenido (respuesta 4). En el ordenador Bancos no tiene
  // ninguna pieza flotante (sin la barra de «Muy pronto»): se comprueba que no esté.
  if (await page.locator(FLOTANTES_CONTA.join(', ')).count() === 0) expect(lado(page)).toBe('ordenador')
  else expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

/** Un importe cortado con «…» esconde lo que la pantalla existe para enseñar (respuesta 4: el cierre en el móvil decía «44.237,8…»). */
async function importesCortados(page: Page): Promise<string[]> {
  return page.locator('.cxb-cifra-valor').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent ?? ''))
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

/** Como la demostración del motor, con la tarjeta de Ana dada de alta. */
async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes de las pantallas B01')
  const asientosAntes = await base.contarAsientosA()
  const bancos = crearBancos(base.bd)
  const abierto = { nombre: 'b01-tres-cuentas.n43', sha256: createHash('sha256').update(FICHERO).digest('hex'), contenido: { texto: FICHERO } }
  const { extracto, cuadre } = leerYCuadrar(abierto)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  await bancos.importar(abierto, extracto, cuadre, emparejar(extracto, mios))
  await base.bd.rpc('bank_tarjeta_guardar', { p_treasury: NORTE, p_id: null, p_last4: '0937', p_titular: 'Ana Prueba', p_local: null, p_comun: true })
  const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-13')
  expect(r.fallos).toEqual([])
  // Como «Subir extracto»: la pasada del agente queda registrada con su resumen (la banda la enseña).
  await base.bd.rpc('bank_agente_registrar', { p_company: EMPRESA_A, p_disparo: 'extracto',
    p_resultado: { casados: r.casadosSolos, propuestos: r.propuestos, por_aclarar: r.porAclarar, antes_corte: r.antesDelCorte, fallos: 0 } })
  return { ...base, asientosAntes }
}

test.describe('B01 · Bancos, las pantallas', () => {
  test.describe.configure({ timeout: 240_000 })

  test('ordenador: N17 en tres niveles, las cinco sin maqueta y los botones que confirman', async ({ page }) => {
    test.skip(lado(page) !== 'ordenador', 'En el móvil va su prueba.')
    const base = await preparar()
    try {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { level: 1, name: 'Bancos' })).toBeVisible()
      const pestanas = page.getByRole('navigation', { name: 'Pestañas de Bancos' })
      for (const p of ['Movimientos', 'Reglas', 'Cuentas y extractos', 'Cierre del mes']) await expect(pestanas.getByRole('link', { name: p })).toBeVisible()
      const barra = page.getByRole('navigation', { name: 'Acciones de Bancos' })
      for (const g of ['Tus bancos', 'Traer movimientos', 'Automático', 'Tuyos']) await expect(barra.getByRole('group', { name: g })).toBeVisible()
      await expect(barra.getByText('Subir extracto')).toBeVisible()
      // Respuesta 4: la barra en UNA fila, con los nombres cortos; ni «Conectar» ni la barra de «Muy pronto».
      const filas = await Promise.all(['Tus bancos', 'Traer movimientos', 'Automático', 'Tuyos'].map(async (g) => Math.round((await barra.getByRole('group', { name: g }).boundingBox())!.y)))
      expect(new Set(filas).size).toBe(1)
      await expect(barra.getByRole('button', { name: /^B01 Norte/ })).toBeVisible()
      await expect(page.getByText('Conectar')).toHaveCount(0)
      await expect(page.locator('.cx-pregunta')).toHaveCount(0)
      // Lo que no funciona no se enseña (respuesta 3, punto 4).
      await expect(page.getByText('Por correo')).toHaveCount(0)
      await expect(page.getByText(/crédito/i)).toHaveCount(0)

      // La banda, el cuadre (B02: en el banco − en contabilidad = te falta por casar) y la lista.
      await expect(page.getByText(/^He casado yo 3 de 8 movimientos de octubre\./)).toBeVisible()
      for (const c of ['En el banco', 'En contabilidad', 'Te falta por casar']) await expect(page.locator('.cxb-cifra-etiqueta', { hasText: c })).toBeVisible()
      await expect(page.getByText(/· tarjeta de Ana Prueba \(···0937\)/)).toBeVisible()
      await expect(page.getByText(/Tarjeta de Ana \(···0937\)|pídele el ticket a Ana/).first()).toBeVisible()
      // Las migas, sin caracteres raros; un solo botón principal por fila; y la banda del agente.
      await expect(page.getByRole('navigation', { name: 'Estás en' })).toHaveText(/^Bancos›Banco B01 · Norte · ···0011$/)
      await expect(page.locator('.cxc-fila', { hasText: 'Comision mantenimiento' }).getByRole('button', { name: 'Sí', exact: true })).toHaveClass('cx-boton')
      await expect(page.locator('.cxc-fila', { hasText: 'Transferencia recibida' }).getByRole('button', { name: 'Decirlo yo' })).toHaveClass('cx-boton')
      await expect(page.locator('.cxc-fila', { hasText: 'GLOVO' }).getByRole('button', { name: 'Ver' })).toHaveClass('cx-boton-sec')
      await expect(page.getByTestId('pasada-agente')).toContainText(/^Mi última pasada por todos tus bancos, hoy a las \d\d:\d\d \(al subir un extracto\): He casado yo \d+; te propongo \d+ y quedan \d+ por aclarar\.$/)
      // Con la apertura de la semilla, lo que falta por casar es exactamente lo que queda sin casar.
      await expect(page.getByTestId('cuadre')).toContainText('2.175,50 €')
      await expect(page.getByTestId('cuadre')).toContainText('son justo los movimientos sin casar')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'movimientos')
      await capturarPieza(page, '.cxb-banda', 'banda-agente')

      // «Sí» confirma con contenido, y «Deshacer» lo devuelve (regla 8).
      const comision = page.locator('.cxc-fila', { hasText: 'Comision mantenimiento' })
      await comision.getByRole('button', { name: 'Sí', exact: true }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Casado: Comisión del banco')
      await page.locator('.cxc-fila', { hasText: 'Comision mantenimiento' }).getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Deshecho: el movimiento del 03/10')

      // Por aclarar, y la tarjeta que nadie ha dado de alta (respuesta 3).
      await page.getByRole('button', { name: /^Por aclarar \d+$/ }).click()
      await capturar(page, 'por-aclarar')
      await barra.getByRole('button', { name: /^B01 Mercado/ }).click()
      // B02: la tarjeta sin dar de alta la anota el motor (se pregunta una vez por tarjeta, no en cada pago).
      await expect(page.locator('.cxc-fila', { hasText: 'FERRETERIA' })).toContainText('tarjeta ···1234 sin dar de alta')
      await expect(page.locator('.cxc-fila', { hasText: 'FERRETERIA' }).getByRole('button', { name: 'Dar de alta la tarjeta' })).toBeVisible()
      await capturar(page, 'tarjeta-desconocida')

      // Reglas.
      await pestanas.getByRole('link', { name: 'Reglas' }).click()
      await expect(page.getByRole('heading', { name: 'Reglas', level: 2 })).toBeVisible()
      await expect(page.getByRole('form', { name: 'Regla nueva' })).toBeVisible()
      await expect(page.getByText('Mirando lo que se repite…')).toHaveCount(0, { timeout: 30_000 })
      await capturar(page, 'reglas')

      // El gesto único: soltar el Norma 43 en una pantalla de Bancos que no es «Subir».
      await page.locator('.cxb-pagina').evaluate((el, texto) => {
        const dt = new DataTransfer()
        dt.items.add(new File([texto], 'b01-tres-cuentas.n43', { type: 'text/plain' }))
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      }, FICHERO)
      await expect(page.getByRole('heading', { name: 'Subir extracto', level: 2 })).toBeVisible()
      await expect(page.getByText('He leído 3 cuentas, 15 movimientos, del 02/10 al 13/10; cuadra con el saldo del banco.')).toBeVisible()
      await expect(page.getByText('«b01-tres-cuentas.n43» · 3 cuentas')).toBeVisible()
      await capturar(page, 'subir-leido')
      await page.getByRole('button', { name: 'Subir las 3 cuentas' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Subido «b01-tres-cuentas.n43».')
      await expect(page.getByText(/^Después los he mirado: he casado yo/)).toBeVisible()
      await capturar(page, 'subir-hecho')

      // Cuentas y extractos, con la tarjeta de Ana.
      await page.goto(`/conta/bancos/cuentas?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Cuentas y extractos', level: 2 })).toBeVisible()
      await expect(page.getByText('Tarjeta ···0937 · Ana Prueba')).toBeVisible()
      await expect(page.getByText('Solo los 4 últimos dígitos: el número entero no se guarda nunca.').first()).toBeVisible()
      await capturar(page, 'cuentas')

      // Desde la fila de la tarjeta desconocida: el alta viene con sus 4 dígitos puestos.
      await page.goto(`/conta/bancos/cuentas?banco=${MERCADO}&tarjeta=1234&mes=2026-10`)
      await expect(page.getByRole('form', { name: 'Añadir una tarjeta a Banco B01 · Mercado' }).getByLabel('Últimos 4 dígitos')).toHaveValue('1234')

      // Cierre del mes y «Lo que he hecho» (B02: sin la marca, en primera persona).
      await page.goto(`/conta/bancos/cierre?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Cierre de octubre', level: 2 })).toBeVisible()
      await expect(page.getByText('Octubre aún no ha terminado: se cierra a partir del día 1 del mes siguiente.')).toBeVisible()
      await expect(page.getByRole('article', { name: 'Cierre de Banco B01 · Norte' })).toContainText('la explican los movimientos sin casar')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'cierre')
      await page.goto(`/conta/bancos/hecho?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Lo que he hecho', level: 2 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Deshacer' }).first()).toBeVisible()
      await capturar(page, 'hecho-por-folvy')
    } finally {
      await base.deshacerTodo('Limpieza después de las pantallas B01')
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    }
  })

  test('móvil (M4): portada, Para confirmar y Por aclarar en tarjetas', async ({ page }) => {
    test.skip(lado(page) !== 'movil', 'En el ordenador va la suya.')
    const base = await preparar()
    try {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { level: 1, name: 'Bancos' })).toBeVisible()
      await expect(page.getByRole('group', { name: 'Tus bancos' })).toBeVisible()
      await expect(page.locator('.cxb-apartado-titulo', { hasText: 'Para confirmar' })).toBeVisible()
      await expect(page.getByText(/^He casado yo 3 de 8 movimientos de octubre\./)).toBeVisible()
      await expect(page.getByText('Por correo')).toHaveCount(0)
      await capturar(page, 'portada')

      await page.locator('.cxb-apartado', { hasText: 'Para confirmar' }).click()
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 2 })).toBeVisible()
      await expect(page.getByRole('link', { name: '‹ Bancos' })).toBeVisible()
      await expect(page.locator('.cxc-fila').first()).toBeVisible()
      await capturar(page, 'para-confirmar')

      await page.getByRole('button', { name: /^Por aclarar \d+$/ }).click()
      await expect(page.getByText(/· tarjeta de Ana Prueba \(···0937\)/)).toBeVisible()
      await capturar(page, 'por-aclarar')

      // Respuesta 4, punto 2.6: Movimientos entero en el móvil, para verlo al lado del de ordenador.
      await page.getByRole('button', { name: /^Todos \d+$/ }).click()
      await expect(page.getByTestId('pasada-agente')).toBeVisible()
      await expect(page.locator('.cx-barra-ia')).toHaveCount(0)
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'movimientos')
      await capturarPieza(page, '.cxb-banda', 'banda-agente')

      // Respuesta 4: el cierre del mes también en el móvil.
      await page.goto(`/conta/bancos/cierre?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Cierre de octubre', level: 2 })).toBeVisible()
      await expect(page.getByRole('article', { name: 'Cierre de Banco B01 · Norte' })).toContainText('la explican los movimientos sin casar')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'cierre')
    } finally {
      await base.deshacerTodo('Limpieza después de las pantallas B01 (móvil)')
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    }
  })
})
