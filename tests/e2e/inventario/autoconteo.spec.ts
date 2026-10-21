/// <reference lib="dom" />
// tests/e2e/inventario/autoconteo.spec.ts
//
// EL AUTOCONTEO SE APLICA SOLO (0390 y 0400, encargo de Julio del 21/10), de
// punta a punta en staging-conta, en ordenador y en móvil:
//
//   1. LA TABLET: el trabajador de prueba entra, abre «Conteo» y cuenta sus tres
//      productos: uno con menos (10 → 4), uno que cuadra (20) y uno con muchos
//      menos (30 → 2), que le pide mirarlo otra vez. Al terminar, la tablet dice
//      «El stock ya está al día» y la base lo confirma: aprobado, «al_terminar»,
//      dos ajustes (−6 y −28) y la diferencia guardada.
//   2. LA PANTALLA DE CONTEOS: el administrador abre ese mismo recuento en
//      Almacén → Inventarios y ve «Aplicado al terminar el recuento, a las …»
//      con las diferencias en palabras de oficina.
//   3. EL AVISO: un autoconteo de ayer con el fallo de la noche apuntado sale en
//      rojo en Almacén; se abre, se cierra, «Aplicar entero» lo aplica y el aviso
//      se va.
//
// El escenario lo prepara supabase/seeds/conta/seed_autoconteo_e2e_staging.sql
// (e2e_autoconteo_preparar), en el carril de esta ejecución. Capturas en
// docs/inventario/capturas/e2e-*.png.
//
// Se lanza a mano (Julio, 21/10): Actions → «Pruebas e2e en staging-conta» →
// Run workflow en la rama, con pruebas = tests/e2e/inventario.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, enCarril, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const DIR = 'docs/inventario/capturas'
const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')
const NORTE_CENTRO = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const LATAS = 'Latas de cola (prueba de autoconteo)'
const PAN = 'Pan de hamburguesa (prueba de autoconteo)'
const BOLSAS = 'Bolsas de papel (prueba de autoconteo)'

type Preparado = { count_id: string; code: string }

async function preparar(caso: 'hoy' | 'fallido'): Promise<Preparado> {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<Preparado>(s, 'POST', 'rpc/e2e_autoconteo_preparar', { p_caso: caso })
  expect(r.status, `e2e_autoconteo_preparar(${caso}): ${JSON.stringify(r.datos)}`).toBe(200)
  return r.datos
}

async function leerConteo(id: string) {
  const s = await pedirSesion(CUENTA_A.email)
  const c = await rest<{ status: string; auto_applied_via: string | null; approved_at: string | null }[]>(
    s, 'GET', `inventory_count?id=eq.${id}&select=status,auto_applied_via,approved_at`)
  const m = await rest<{ qty_base: number }[]>(
    s, 'GET', `stock_movement?source_type=eq.inventory_count&source_id=eq.${id}&select=qty_base&order=qty_base`)
  const l = await rest<{ variance_qty: number | null }[]>(
    s, 'GET', `inventory_count_line?inventory_count_id=eq.${id}&select=variance_qty&order=position`)
  return { conteo: c.datos[0], movimientos: m.datos.map(x => Number(x.qty_base)), diferencias: l.datos.map(x => x.variance_qty === null ? null : Number(x.variance_qty)) }
}

/** Cuenta el producto que está en pantalla: escribe la cantidad y guarda; si pide mirarlo otra vez, la segunda. */
async function contar(page: Page, producto: string, primero: number, segundo?: number) {
  await expect(page.getByText(producto, { exact: true })).toBeVisible()
  await page.getByLabel(/^Cantidad en /).first().fill(String(primero))
  await page.getByRole('button', { name: 'Guardar y seguir' }).click()
  const otraVez = page.getByRole('button', { name: 'Guardar el nuevo recuento' })
  if (segundo !== undefined) {
    await expect(otraVez, `${producto}: tiene que pedir mirarlo otra vez`).toBeVisible()
    await page.getByLabel(/^Cantidad en /).last().fill(String(segundo))
    await otraVez.click()
  }
  await expect(otraVez).toHaveCount(0)
}

async function abrirAlmacen(page: Page) {
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/supply/inventario')
  await expect(page.getByRole('heading', { name: 'Almacén' })).toBeVisible()
}

test('la tablet aplica el autoconteo al terminarlo, y la pantalla de conteos lo cuenta en palabras de oficina', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const { count_id, code } = await preparar('hoy')

  // ── 1 · La tablet ──────────────────────────────────────────────────────────
  await entrarComo(page, TRABAJADOR)
  await page.goto('/')
  await page.getByText('Conteo', { exact: true }).click()
  await page.getByRole('button', { name: 'Empezar a contar' }).click()
  await contar(page, LATAS, 4)
  await contar(page, PAN, 20)
  await contar(page, BOLSAS, 2, 2)

  const final = page.getByTestId('conteo-terminado')
  await expect(final).toHaveAttribute('data-estado', 'aplicado', { timeout: 20_000 })
  await expect(page.getByText('El stock ya está al día')).toBeVisible()
  // Lo que espera Folvy no se enseña nunca, tampoco al final.
  await expect(page.getByText(/ajustad|faltaba|sobraba|cuadra/i)).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/e2e-tablet-aplicado${sufijo}.png`, fullPage: true })

  const hecho = await leerConteo(count_id)
  expect(hecho.conteo.status).toBe('aprobado')
  expect(hecho.conteo.auto_applied_via).toBe('al_terminar')
  expect(hecho.movimientos, 'dos ajustes: −28 bolsas y −6 latas; el pan cuadra').toEqual([-28, -6])
  expect(hecho.diferencias, 'la diferencia queda guardada, en el orden de la tablet').toEqual([-6, 0, -28])

  // ── 2 · La pantalla de conteos, como administrador ─────────────────────────
  // En la misma página: la sesión del administrador se pone después y es la que queda.
  const oficina = page
  await abrirAlmacen(oficina)
  await oficina.getByRole('button', { name: /Inventarios/ }).click()
  await oficina.getByRole('button', { name: 'Autoinventario', exact: true }).click()
  const fila = oficina.getByRole('button', { name: new RegExp(code) })
  await expect(fila).toContainText('Aplicado')
  await fila.click()

  const resumen = oficina.getByTestId('resumen-autoconteo')
  await expect(resumen).toHaveAttribute('data-via', 'al_terminar')
  await expect(resumen).toContainText(/Aplicado al terminar el recuento, a las \d{1,2}:\d{2}, lo terminó Trabajador de Prueba/)
  await expect(resumen).toContainText('Lo que ha cambiado en el stock · 2')
  await expect(resumen).toContainText(BOLSAS)
  await expect(resumen).toContainText(/Faltaban 28\sud; quedan 2\sud/)
  await expect(resumen).toContainText(/Faltaban 6\sud; quedan 4\sud/)
  await expect(resumen.getByRole('button', { name: 'Ver los 1 que cuadran' })).toBeVisible()
  // Un autoconteo aplicado no se revisa: ni motivos ni «Aprobar».
  await expect(oficina.getByRole('button', { name: /Aprobar|Faltan .* motivo/ })).toHaveCount(0)
  await oficina.evaluate(() => document.fonts.ready)
  await oficina.screenshot({ path: `${DIR}/e2e-conteo-aplicado${sufijo}.png`, fullPage: true })
})

test('un autoconteo que no se pudo aplicar sale en rojo en Almacén, y se aplica entero desde ahí', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const { count_id, code } = await preparar('fallido')

  await abrirAlmacen(page)
  const aviso = page.getByTestId('aviso-autoconteos-sin-aplicar')
  await expect(aviso).toBeVisible()
  await expect(aviso).toContainText(code)
  await expect(aviso).toContainText('No se ha podido aplicar')
  await expect(aviso).toContainText('lock timeout')
  await page.evaluate(() => document.fonts.ready)
  await aviso.screenshot({ path: `${DIR}/e2e-aviso${sufijo}.png` })

  await aviso.getByRole('button', { name: new RegExp(code) }).click()
  // Se quedó «contando» (la noche no llegó a cerrarlo): primero se cierra.
  await page.getByRole('button', { name: 'Cerrar conteo' }).click()
  await expect(page.getByText('No se ha podido aplicar solo:')).toBeVisible()
  await expect(page.getByText('es un autoconteo')).toBeVisible()
  await page.getByRole('button', { name: 'Aplicar entero (1 contados)' }).click()
  // Regla 8: la pantalla dice que se ha aplicado (la frase del recuento aprobado).
  await expect.poll(async () => (await leerConteo(count_id)).conteo.status, { timeout: 20_000 }).toBe('aprobado')
  await expect(page.getByText(/^Aprobado por .+ · 1 producto ajustado/)).toBeVisible()

  const hecho = await leerConteo(count_id)
  expect(hecho.movimientos, 'el pan: de 20 a 18').toEqual([-2])

  // De vuelta en Almacén, el aviso ya no está.
  await page.goto('/supply/inventario')
  await expect(page.getByRole('heading', { name: 'Almacén' })).toBeVisible()
  await expect(page.getByTestId('aviso-autoconteos-sin-aplicar')).toHaveCount(0)
})
