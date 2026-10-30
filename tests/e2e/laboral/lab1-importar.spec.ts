/// <reference lib="dom" />
// tests/e2e/laboral/lab1-importar.spec.ts
//
// LAB1 (29/10/2026) · Tanda 1 del importador del historial de Cegid: Sumied ›
// Laboral › Importar historial, «solo leer las cabeceras», con «Empresa de
// Prueba Sola» del carril, en ordenador (1440) y en móvil (390).
//
//   1. Un paquete INVENTADO con las nueve hojas y sus cabeceras reales (las de
//      Julio, 29/10) y valores de mentira: todas «Como se esperaba», el botón
//      dice cuántas hojas y filas ha leído, y el lote sale en la lista. Ningún
//      valor llega a la base: se mira el lote por la API.
//   2. El mismo fichero otra vez: lo reconoce, no hace otro lote.
//   3. Un paquete al que le falta una columna y le sobra una hoja: la tabla lo
//      enseña todo (regla 7).
//
// El Excel se genera aquí: ningún dato real en el repositorio. Todo lo que se
// crea es de la cuenta del carril y se borra con ella.

import * as XLSX from 'xlsx'
import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, correoDePrueba, correoDelCarril, entrarComo, pedirSesion, type Sesion } from '../conta/sesion'
import { rest } from '../conta/api'
import { HOJAS_CEGID } from '../../../src/modules/conta/laboral/importar/cegidCabeceras'

const SOLA = correoDelCarril('sola.admin@c06-prueba.test')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')

async function cuentaDe(s: Sesion): Promise<string> {
  const r = await rest<{ account_id: string }[]>(s, 'GET', `user_profiles?select=account_id&user_id=eq.${s.user.id}&active=eq.true`)
  expect(r.status, JSON.stringify(r.datos)).toBe(200)
  expect(r.datos.length, 'el administrador de la empresa sola no tiene perfil').toBeGreaterThan(0)
  return r.datos[0].account_id
}

/** Un paquete como el de Cegid, con valores de mentira. `marca` hace que cada run tenga su propio fichero (su huella). */
function paquete(marca: string, cambiar?: (libro: XLSX.WorkBook) => void): Buffer {
  const libro = XLSX.utils.book_new()
  for (const h of HOJAS_CEGID) {
    const datos = h.clase === 'campo_valor'
      ? h.columnas.map((c, i) => [c, `VALOR INVENTADO ${marca} ${i}`])
      : [[...h.columnas], ...[1, 2, 3].map((n) => h.columnas.map((_c, i) => `inventado ${marca} ${n}-${i}`))]
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), h.nombre)
  }
  cambiar?.(libro)
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

async function leer(page: Page, nombre: string, bytes: Buffer) {
  await page.locator('[data-prueba="importar-fichero"]').setInputFiles({
    name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes,
  })
  await page.locator('[data-prueba="importar-leer"]').click()
  await expect(page.locator('[data-prueba="importar-hecho"], [data-prueba="importar-error"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="importar-error"]')).toHaveCount(0)
}

test.beforeAll(async () => {
  // Laboral encendido para la empresa sola de ESTE carril, como la plataforma (igual que la de LS1).
  const sola = await pedirSesion(SOLA)
  const cuenta = await cuentaDe(sola)
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: {
      apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ account_id: cuenta, feature_key: 'conta_laboral', enabled: true, source: 'manual_grant', grant_reason: 'e2e LAB1 (carril)' }),
  })
  expect([200, 201, 204], `encender conta_laboral: HTTP ${r.status} ${await r.text()}`).toContain(r.status)
})

test('leer solo las cabeceras: el paquete bien, el mismo otra vez y uno distinto', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
  const sola = await entrarComo(page, SOLA)
  const cuenta = await cuentaDe(sola)
  const marca = `${test.info().project.name}-${Date.now()}`

  await page.goto('/conta/laboral/importar-historial')
  await expect(page.locator('[data-laboral-pagina="importar-historial"] [data-prueba="laboral-importar"]')).toBeVisible({ timeout: 30_000 })

  // 1 · El paquete como se espera.
  const bueno = paquete(marca)
  await leer(page, 'paquete inventado.xlsx', bueno)
  await expect(page.locator('[data-prueba="importar-hecho"]'))
    .toContainText('Leídas 9 hojas y 51 filas · 9 de 9 como se esperaban')
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('Guardado como lote nuevo')
  await expect(page.locator('[data-prueba="importar-hojas"] tbody tr')).toHaveCount(9)
  await expect(page.locator('[data-prueba="importar-hojas"]').getByText('Como se esperaba')).toHaveCount(9)
  await captura(page, 'lab1-cabeceras-bien')

  // Ningún valor en la base: el lote guarda nombres de columna y recuentos.
  const lotes = await rest<{ id: string; resumen: unknown }[]>(sola, 'GET',
    `lab_import_lote?select=id,resumen&account_id=eq.${cuenta}&fichero_nombre=eq.${encodeURIComponent('paquete inventado.xlsx')}&order=subido_at.desc`)
  expect(lotes.status, JSON.stringify(lotes.datos)).toBe(200)
  const resumen = JSON.stringify(lotes.datos.find((l) => JSON.stringify(l.resumen).includes('Trabajadores'))?.resumen ?? null)
  expect(resumen).toContain('grupo_cotizacion')
  expect(resumen).not.toContain('INVENTADO')
  expect(resumen).not.toContain('inventado')

  // 2 · El mismo fichero otra vez.
  await leer(page, 'paquete inventado.xlsx', bueno)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('Es el mismo fichero que el lote del')

  // 3 · Le falta una columna y le sobra una hoja.
  const distinto = paquete(`${marca}-b`, (libro) => {
    const h = HOJAS_CEGID.find((x) => x.id === 'contratos')!
    libro.Sheets[h.nombre] = XLSX.utils.aoa_to_sheet([h.columnas.filter((c) => c !== 'coef_parcial')])
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['algo']]), 'Hoja1')
  })
  await leer(page, 'paquete distinto.xlsx', distinto)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('8 de 9 como se esperaban · 1 con columnas distintas · 1 hoja que no se esperaba')
  await expect(page.locator('[data-prueba="importar-hoja-contratos"]')).toContainText('Faltan: coef_parcial')
  await expect(page.locator('[data-prueba="importar-hoja-otra"]')).toContainText('No se esperaba')
  await expect(page.locator('[data-prueba="importar-lotes"] li')).not.toHaveCount(0)
  await captura(page, 'lab1-cabeceras-distintas')

  expect(errores, errores.join('\n')).toEqual([])
})
