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

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
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
      await expect(barra.getByText('Conectar')).toBeVisible()
      // Lo que no funciona no se enseña (respuesta 3, punto 4).
      await expect(page.getByText('Por correo')).toHaveCount(0)
      await expect(page.getByText(/crédito/i)).toHaveCount(0)

      // La banda, las cinco cifras y la tabla.
      await expect(page.getByText(/^He casado yo 3 de 8 movimientos de octubre\./)).toBeVisible()
      for (const c of ['Saldo en el banco', 'Saldo en contabilidad', 'Casado solo', 'Para confirmar', 'Por aclarar']) await expect(page.locator('.cxb-cifra-etiqueta', { hasText: c })).toBeVisible()
      await expect(page.getByText('· tarjeta de Ana Prueba (···0937)')).toBeVisible()
      await expect(page.getByText(/Tarjeta de Ana \(···0937\)|pídele el ticket a Ana/).first()).toBeVisible()
      await capturar(page, 'movimientos')

      // «Sí» confirma con contenido, y «Deshacer» lo devuelve (regla 8).
      const comision = page.locator('.cxb-fila', { hasText: 'Comision mantenimiento' })
      await comision.getByRole('button', { name: 'Sí', exact: true }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Casado: Comisión del banco')
      await page.locator('.cxb-fila', { hasText: 'Comision mantenimiento' }).getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Deshecho: el movimiento del 03/10')

      // Por aclarar, y la tarjeta que nadie ha dado de alta (respuesta 3).
      await page.getByRole('button', { name: 'Por aclarar', exact: true }).click()
      await capturar(page, 'por-aclarar')
      await barra.getByRole('button', { name: /Banco B01 · Mercado/ }).click()
      await expect(page.getByText(/Por aclarar: tarjeta acabada en 1234, ¿de quién es\?/)).toBeVisible()
      await expect(page.locator('.cxb-fila', { hasText: 'FERRETERIA' }).getByRole('button', { name: 'Dar de alta la tarjeta' })).toBeVisible()
      await capturar(page, 'tarjeta-desconocida')

      // Reglas.
      await pestanas.getByRole('link', { name: 'Reglas' }).click()
      await expect(page.getByRole('heading', { name: 'Reglas', level: 2 })).toBeVisible()
      await expect(page.getByRole('form', { name: 'Regla nueva' })).toBeVisible()
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

      // Cierre del mes y «Lo que ha hecho Folvy».
      await page.goto(`/conta/bancos/cierre?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Cierre de octubre', level: 2 })).toBeVisible()
      await capturar(page, 'cierre')
      await page.goto(`/conta/bancos/hecho?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Lo que ha hecho Folvy', level: 2 })).toBeVisible()
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
      await expect(page.locator('.cxb-fila:not(.cxb-cabeza)').first()).toBeVisible()
      await capturar(page, 'para-confirmar')

      await page.getByRole('button', { name: 'Por aclarar', exact: true }).click()
      await expect(page.getByText('· tarjeta de Ana Prueba (···0937)')).toBeVisible()
      await capturar(page, 'por-aclarar')
    } finally {
      await base.deshacerTodo('Limpieza después de las pantallas B01 (móvil)')
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    }
  })
})
