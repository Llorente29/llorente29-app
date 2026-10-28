/// <reference lib="dom" />
// tests/e2e/laboral/l1a-informe.spec.ts
//
// L1a · PR 2 (28/10/2026): el informe para la Inspección con un fichaje
// corregido, en staging-conta (cuenta A del carril), en ordenador y en móvil.
//   · El administrador corrige a mano (con motivo) una jornada del trabajador
//     de prueba: una entrada y una salida que no se ficharon.
//   · Personal › Registro de jornada: el día sale con sus horas y con la
//     corrección a la vista (quién, cuándo, por qué); baja el PDF y la hoja de
//     cálculo, y cada botón dice lo que ha hecho.
//   · El enlace para la Inspección: se crea, y abre sin sesión con el mismo
//     registro y su caducidad.
// Lo que va en la 0706 (la tarjeta del portal para contestar una corrección y
// la firma invalidada) no se puede ver desde la rama: staging solo la recibe
// en ROLLBACK. Lo prueba la de staging (20261028_l1a_correcciones_e_informe).
// Las capturas van como adjuntos del informe (artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const TRABAJADOR_FICHA = enCarril('c01a0000-0000-4000-8000-0000000000e7') // «Trabajador de Prueba» (semilla del autoconteo)
const MOTIVO = 'No fichó (prueba e2e del informe)'
// add_manual_clock_entry con p_force deja escrito que se forzó, delante del motivo.
const MOTIVO_GUARDADO = `FORZADO · ${MOTIVO}`

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

/** El día de hace n días, en Madrid (AAAA-MM-DD), y una hora de ese día. */
function diaDeHace(n: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - n * 86_400_000))
}
const aLas = (dia: string, hhmm: string) => {
  // Hora de Madrid → instante: se prueba el desfase de ese día (+01:00 o +02:00).
  for (const off of ['+01:00', '+02:00']) {
    const t = new Date(`${dia}T${hhmm}:00${off}`)
    const vuelta = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
    if (vuelta === hhmm) return t.toISOString()
  }
  throw new Error(`No sé convertir ${dia} ${hhmm}`)
}

test('el informe para la Inspección, con un fichaje corregido: la pantalla, el PDF, la hoja y el enlace', async ({ page, browser }) => {
  test.setTimeout(3 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  // Ordenador y móvil corren a la vez en el mismo carril: cada uno corrige su
  // propio día, o el informe de uno ve las marcas del otro.
  const dia = diaDeHace(test.info().project.name === 'movil' ? 4 : 3)
  const mes = dia.slice(0, 7)

  // El administrador pone a mano la jornada que no se fichó, con su motivo.
  const s = await pedirSesion(CUENTA_A.email)
  for (const [tipo, hora] of [['entrada', '09:00'], ['salida', '13:30']] as const) {
    const r = await rest(s, 'POST', 'rpc/add_manual_clock_entry', {
      p_employee_id: TRABAJADOR_FICHA, p_type: tipo, p_datetime: aLas(dia, hora),
      p_reason: MOTIVO, p_actor_label: 'Administrador de la prueba', p_force: true,
    })
    expect(r.status, `add_manual_clock_entry(${tipo}): ${JSON.stringify(r.datos)}`).toBe(200)
  }

  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/personal/registro-jornada?persona=${TRABAJADOR_FICHA}&mes=${mes}`, { timeout: 30_000 })
  const informe = page.locator('[data-prueba="informe-jornada"]')
  await expect(informe).toBeVisible({ timeout: 30_000 })
  await expect(informe.getByRole('heading', { level: 1 })).toContainText('Registro de jornada · Trabajador de Prueba')

  const fila = page.locator(`[data-prueba="informe-dia"][data-dia="${dia}"]`)
  await expect(fila).toContainText('09:00')
  await expect(fila).toContainText('13:30')
  await expect(fila).toContainText('4 h 30')
  await expect(fila).toContainText('Entrada añadida después (09:00)')
  await expect(fila).toContainText(`motivo: «${MOTIVO_GUARDADO}»`)
  await expect(fila).toContainText('Corregido después')
  // Sin códigos: ni ids ni nombres internos.
  await expect(informe).not.toContainText(TRABAJADOR_FICHA)
  await expect(informe).not.toContainText('create_manual')
  await captura(page, '1-informe')

  // El PDF y la hoja: bajan, y la pantalla lo dice.
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('[data-prueba="bajar-pdf"]').click()])
  expect(pdf.suggestedFilename()).toMatch(/^registro-de-jornada-trabajador-de-prueba-\d{4}-\d{2}\.pdf$/)
  await expect(page.locator('[data-prueba="registro-hecho"]')).toContainText('Descargado el PDF')
  const [hoja] = await Promise.all([page.waitForEvent('download'), page.locator('[data-prueba="bajar-hoja"]').click()])
  expect(hoja.suggestedFilename()).toMatch(/\.csv$/)
  await expect(page.locator('[data-prueba="registro-hecho"]')).toContainText('Descargada la hoja de cálculo')

  // El enlace para la Inspección: se crea y abre sin sesión.
  await page.locator('[data-prueba="crear-enlace"]').click()
  const url = (await page.locator('[data-prueba="enlace-url"]').textContent())?.trim() ?? ''
  expect(url).toMatch(/\/inspeccion\?t=[0-9a-f]{48}$/)
  await captura(page, '2-enlace')
  const ruta = url.slice(url.indexOf('/inspeccion'))

  const sinSesion = await browser.newContext()
  const inspector = await sinSesion.newPage()
  await inspector.goto(ruta, { timeout: 30_000 })
  await expect(inspector.locator('[data-prueba="inspeccion"]')).toBeVisible({ timeout: 30_000 })
  await expect(inspector.locator('[data-prueba="inspeccion-caduca"]')).toContainText('Caduca el')
  await expect(inspector.locator(`[data-prueba="informe-dia"][data-dia="${dia}"]`)).toContainText('Entrada añadida después (09:00)')
  const png = await inspector.screenshot({ fullPage: true })
  await test.info().attach(`${test.info().project.name}-3-inspeccion.png`, { body: png, contentType: 'image/png' })

  // Un enlace inventado no abre, y lo dice.
  await inspector.goto('/inspeccion?t=inventado', { timeout: 30_000 })
  await expect(inspector.locator('[data-prueba="inspeccion-error"]')).toContainText(/no es válido|caducado|retirado/)
  await sinSesion.close()

  expect(errores, 'errores de la página en el informe').toEqual([])
})

test('Personal abre con «Para revisar» sin errores, y el menú lleva al registro de jornada', async ({ page }) => {
  test.skip(test.info().project.name !== 'ordenador', 'el menú, en ordenador')
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/personal', { timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await captura(page, '4-personal')
  // El lateral pinta cada apartado como un botón (con su título), no como enlace.
  await page.getByRole('button', { name: 'Registro de jornada', exact: true }).first().click()
  await expect(page.locator('[data-prueba="registro-jornada"]')).toBeVisible({ timeout: 30_000 })
  expect(errores, 'errores de la página en Personal').toEqual([])
})
