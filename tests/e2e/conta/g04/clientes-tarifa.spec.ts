// tests/e2e/conta/g04/clientes-tarifa.spec.ts
//
// G04 · Tarea 4 · Clientes (con su panel y «Cobrado por otra vía»), «Asignar a
// un cliente», la ficha y «Tarifa y paquetes» (con «+ Crear › Servicio» y
// «Cambiar precios»), en el ordenador y en el móvil, fieles a la maqueta del
// 08/11 (tableros Main, Ficha y Tarifa).
//
// La sesión, el marco, el menú y la cuenta de prueba son staging y el código de
// verdad. Lo que las pantallas LEEN de las vistas y tablas del G04, y lo que
// GUARDAN por sus funciones, se simula con la siembra inventada (siembra.ts: por
// qué no se siembra en staging). Las dos empresas de la cuenta de prueba se
// ven como gestorías con nombres inventados, también en las capturas (T11).
// Cada acción tiene que decir en pantalla lo que ha hecho (regla 8), y nada se
// escribe en GoCardless ni en el CRM: solo se llama a funciones de Sumied.
//
//   1. Clientes: la banda del próximo cobro, «Lo que tienes que hacer», «Las
//      dos», el panel de un cliente con el cargo devuelto y «Cobrado por otra
//      vía» (lo dice).
//   2. «Asignar a un cliente»: propone por NIF y une (lo dice).
//   3. La ficha: el recibo del mes que viene con sus trabajadores y los cobros.
//   4. Tarifa: niveles, la laboral con «Pruébalo», el paquete; cambiar un precio
//      (lo dice); «+ Crear › Servicio» (lo dice); «Cambiar precios» con «Ver a
//      quién afecta» antes de aplicar (lo dice).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { FRASES, siembra } from './siembra'

const DIR = 'docs/conta/capturas/g04'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

/** Las dos empresas de la cuenta de prueba, en el orden de la base (cambian de id en cada carril). */
async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

/** Lo que leen y guardan las pantallas del G04, simulado; las llamadas a funciones quedan apuntadas. */
async function simular(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const llamadas: { f: string; cuerpo: Record<string, unknown> }[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })
  // Las empresas: gestorías con nombres inventados (el resto de la fila, la de staging).
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    // Si la prueba ya acabó, la respuesta no le importa a nadie: no se convierte en un error de la prueba.
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Record<string, unknown>) => {
      const i = [Q, A].indexOf(String(x.id))
      if (i < 0) return x
      const y: Record<string, unknown> = { ...x, sector: 'gestoria', is_hospitality: false }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = NOMBRES[i]
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Record<string, unknown>)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Record<string, unknown>) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  await page.route(/\/rest\/v1\/([a-z_]+)\?/, (r) => {
    const nombre = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    if (r.request().method() !== 'GET' || !(nombre in datos)) return r.fallback()
    return json(r, datos[nombre])
  })
  // Las funciones de lectura (la 2209 y la 2308) devuelven las mismas filas que las vistas y las tablas de antes.
  const LECTURAS: Record<string, (d: typeof datos) => unknown[]> = {
    conta_lista_clientes: (d) => d.conta_consulta_cliente_empresa,
    conta_lista_que_hacer: (d) => d.conta_consulta_que_hacer,
    conta_lista_gc_cobros: (d) => d.conta_gc_cobro,
    conta_lista_gc_mandatos: (d) => d.conta_gc_mandato,
    conta_lista_gc_suscripciones: (d) => d.conta_gc_suscripcion.filter((x) => x.estado === 'active'),
    conta_lista_fichas: (d) => d.conta_gestoria_cliente,
  }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    if (f in LECTURAS) return json(r, LECTURAS[f](datos))
    if (!(f in FRASES)) return r.fallback()
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    llamadas.push({ f, cuerpo })
    return json(r, FRASES[f](cuerpo))
  })
  return llamadas
}

async function preparar(page: Page) {
  const s = await entrarComo(page, CUENTA_A.email)
  const [Q, A] = await empresas(s)
  const llamadas = await simular(page, Q, A)
  return { Q, A, llamadas }
}

test('Clientes: la banda, lo que tienes que hacer, «Las dos», el panel y «Cobrado por otra vía»', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const { llamadas } = await preparar(page)
  await page.goto('/conta/ventas/clientes-y-cuotas')
  await expect(page.getByRole('heading', { level: 1, name: 'Clientes y cuotas' })).toBeVisible({ timeout: 30_000 })

  // «Las dos»: los de las dos empresas y los sin empresa, en «Otros».
  await page.getByRole('radiogroup', { name: 'Empresa' }).getByRole('radio', { name: 'Las dos' }).click()
  await expect(page.getByRole('radio', { name: 'Las dos' })).toHaveAttribute('aria-checked', 'true')
  const banda = page.locator('.g4-banda')
  await expect(banda).toContainText('Próximo cobro de GoCardless')
  await expect(banda).toContainText(/\d+ cobros · [\d.]+,\d\d €/)
  const hacer = page.getByRole('region', { name: 'Lo que tienes que hacer' })
  await expect(hacer).toContainText('Cobros de GoCardless sin cliente')
  await expect(hacer).toContainText('que aún no están unidas a su cliente en Sumied')
  const tabla = page.getByRole('table', { name: 'Tus clientes' })
  for (const n of ['Transportes de Ejemplo, S.L.', 'Cliente Ejemplo Dos', 'Panadería Muestra, S.L.']) await expect(tabla.getByRole('row', { name: `Abrir ${n}` })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/clientes-las-dos-${lado(page)}.png`, fullPage: true })

  // El panel de un cliente con un cargo devuelto: «Cobrado por otra vía» guarda y lo dice.
  await tabla.getByRole('row', { name: 'Abrir Panadería Muestra, S.L.' }).click()
  const panel = page.getByRole('complementary', { name: 'Resumen del cliente' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Devuelto')
  await panel.getByRole('button', { name: 'Cobrado por otra vía' }).click()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/clientes-panel-otra-via-${lado(page)}.png`, fullPage: false })
  await panel.getByRole('button', { name: 'Guardar' }).click()
  await expect(panel.getByRole('status').filter({ hasText: 'ya no sale en «Te deben»' }).last()).toBeVisible()
  expect(llamadas.map((l) => l.f)).toEqual(['conta_gc_cobro_otra_via'])
  expect(llamadas[0].cuerpo).toMatchObject({ p_gc_cobro: 'PM1', p_via: 'transferencia' })
  expect(errores).toEqual([])
})

test('«Asignar a un cliente»: propone por NIF y une, sin tocar GoCardless', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const { Q, llamadas } = await preparar(page)
  await page.goto('/conta/ventas/clientes-y-cuotas')
  await expect(page.getByRole('heading', { level: 1, name: 'Clientes y cuotas' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: 'Las dos' }).click()
  await page.getByRole('region', { name: 'Lo que tienes que hacer' }).getByRole('button', { name: /Asignar a un cliente/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cobros de GoCardless sin cliente' })).toBeVisible()
  const uno = page.getByRole('region', { name: 'TRANSPORTES DE EJEMPLO SL' })
  await expect(uno).toContainText('Propuesto por NIF: Transportes de Ejemplo, S.L.')
  const otro = page.getByRole('region', { name: 'Persona Inventada' })
  await expect(otro).toContainText('Sin propuesta')
  await expect(otro.getByRole('button', { name: 'Elige un cliente' })).toBeDisabled()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/asignar-${lado(page)}.png`, fullPage: true })
  await uno.getByRole('button', { name: 'Unir a Transportes de Ejemplo, S.L.' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Enlazado: TRANSPORTES DE EJEMPLO SL de GoCardless es Transportes de Ejemplo, S.L.' })).toBeVisible()
  expect(llamadas).toEqual([{ f: 'conta_gestoria_enlazar', cuerpo: { p_company: Q, p_gc_cliente: 'CU1x', p_party: 'c8' } }])
  expect(errores).toEqual([])
})

test('La ficha: el recibo del mes que viene con sus trabajadores, y los cobros', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const { Q } = await preparar(page)
  await page.goto(`/conta/ventas/clientes-y-cuotas/cliente/c8?empresa=${Q}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Transportes de Ejemplo, S.L.' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Así le llegará el recibo de/)).toBeVisible()
  await expect(page.getByText('Gestión laboral · 18 trabajadores')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ficha-${lado(page)}.png`, fullPage: true })
  await page.getByRole('tab', { name: 'Cobros' }).click()
  await expect(page.getByText('Devuelto').first()).toBeVisible()
  await page.screenshot({ path: `${DIR}/ficha-cobros-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('Tarifa: niveles, laboral y paquete; cambiar un precio, crear un servicio y «Cambiar precios» lo dicen', async ({ page }) => {
  test.setTimeout(150_000)
  const errores = vigilar(page)
  const { llamadas } = await preparar(page)
  await page.goto('/conta/ventas/clientes-y-cuotas/tarifas')
  await expect(page.getByRole('heading', { level: 1, name: 'Tarifa y paquetes' })).toBeVisible({ timeout: 30_000 })
  const lista = page.getByRole('navigation', { name: 'Servicios y paquetes' })
  await expect(lista).toContainText('3 niveles · de 45 a 95 € al mes')
  await expect(lista).toContainText('Tramo 1–5 por 100 €, después 18 €')
  await expect(lista).toContainText('Trabajo suelto · 60 €')
  await expect(lista).toContainText('Cuando toque')
  await expect(lista).toContainText('150 € al mes · ahorra 10,50 €')
  await expect(page.getByText('EL MÁS ELEGIDO')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/tarifa-niveles-${lado(page)}.png`, fullPage: true })

  // Cambiar el precio de un nivel: guarda desde un mes y lo dice.
  await page.getByRole('textbox', { name: 'Precio de Estándar' }).fill('62,00')
  await page.getByRole('button', { name: /^Guardar el precio desde/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Guardado Gestoría mensual · Estándar (precio de tarifa): 62,00 €' })).toBeVisible()

  // La laboral: sus reglas y «Pruébalo».
  await lista.getByRole('button', { name: /Gestión laboral/ }).click()
  await expect(page.getByRole('radio', { name: /Tramo y después por trabajador/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('226,00 € al mes')).toBeVisible()
  await page.getByRole('button', { name: 'Un trabajador menos' }).click()
  await expect(page.getByText('208,00 € al mes')).toBeVisible()
  await page.screenshot({ path: `${DIR}/tarifa-laboral-${lado(page)}.png`, fullPage: true })

  // El paquete.
  await lista.getByRole('button', { name: /Pack Pyme/ }).click()
  await expect(page.getByText('El cliente ahorra 10,50 € al mes (126 € al año)')).toBeVisible()
  await expect(page.getByText('Desde el 6.º trabajador se cobra cada uno a 18,00 € al mes.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/tarifa-paquete-${lado(page)}.png`, fullPage: true })

  // + Crear › Servicio: crea y lo dice.
  await page.getByRole('button', { name: '+ Crear ▾' }).click()
  await page.getByRole('menuitem', { name: /^Servicio/ }).click()
  const crear = page.getByRole('region', { name: 'Crear un servicio' })
  await crear.getByRole('textbox', { name: 'Nombre' }).fill('Asesoría de prueba')
  await crear.getByRole('textbox', { name: /Precio de tarifa/ }).fill('30')
  await crear.getByRole('button', { name: 'Crear el servicio' }).click()
  await expect(crear.getByRole('status').filter({ hasText: 'Creado el servicio «Asesoría de prueba»' })).toBeVisible()
  await page.screenshot({ path: `${DIR}/tarifa-crear-servicio-${lado(page)}.png`, fullPage: true })

  // Cambiar precios: parte de lo que se está viendo (la laboral); primero a quién afecta; después, aplicar lo dice.
  await lista.getByRole('button', { name: /Gestión laboral/ }).click()
  await page.getByRole('button', { name: 'Más opciones ▾' }).click()
  await page.getByRole('menuitem', { name: /^Cambiar precios/ }).click()
  const cambio = page.getByRole('region', { name: 'Cambiar precios' })
  await expect(cambio.getByRole('button', { name: '✓ Gestión laboral' })).toHaveAttribute('aria-pressed', 'true')
  await expect(cambio).toContainText('Sube un 3 % Gestión laboral, a todos los clientes que lo tienen')
  await cambio.getByRole('button', { name: 'Ver a quién afecta' }).click()
  const afecta = cambio.getByRole('table')
  await expect(afecta).toContainText(/Transportes de Ejemplo, S\.L\.|Cliente Ejemplo Dos/)
  await page.screenshot({ path: `${DIR}/tarifa-cambiar-precios-${lado(page)}.png`, fullPage: true })
  await cambio.getByRole('button', { name: /^Aplicar el cambio a \d+ clientes?$/ }).click()
  await expect(cambio.getByRole('status').filter({ hasText: 'Aplicado: Gestión laboral sube un 3 %' })).toBeVisible()
  expect(llamadas.map((l) => l.f)).toEqual(['conta_tarifa_precio_guardar', 'conta_tarifa_servicio_crear', 'conta_tarifa_cambio_ensayar', 'conta_tarifa_cambio_aplicar'])
  expect(llamadas[1].cuerpo).toMatchObject({ p_nombre: 'Asesoría de prueba', p_forma: 'fijo', p_periodo: 'mes', p_importe: 30, p_ensayo: false })
  expect(errores).toEqual([])
})
