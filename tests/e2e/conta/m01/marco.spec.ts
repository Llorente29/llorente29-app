/// <reference lib="dom" />
// tests/e2e/conta/m01/marco.spec.ts
//
// M01 · El marco nuevo (maqueta N30, decisiones de Julio sobre el F01), en la
// cuenta A de staging-conta (todo inventado). Desde el S01 el marco es el
// esqueleto (tests/e2e/conta/s01/esqueleto.spec.ts prueba lo suyo); aquí:
//   · la barra de productos desplegada y plegada, que se recuerda (en la base);
//   · lo que no tiene pantalla no sale (antes, Impuestos apagado con «Próximamente»);
//   · el «Te toca hoy» del Inicio;
//   · la densidad, en el menú del usuario, que se recuerda;
//   · una pantalla vieja (Bancos) dentro del marco, con su estilo y sus pestañas;
//   · el buscador general (Ctrl K), que es del marco y no de Libros.
// Las capturas van a docs/conta/capturas/m01 (frente D).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapanSinPregunta } from '../solapes'
import { redQuieta } from '../red'

const DIR = 'docs/conta/capturas/m01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

/** Ningún esqueleto de carga a la vista (la empresa de arriba, el Inicio, el balance…). */
async function esperarCargado(page: Page) {
  await expect(page.locator('.cxm .cx-hueso')).toHaveCount(0, { timeout: 30_000 })
}

async function capturar(page: Page, nombre: string, medir = true) {
  // La foto, con la pantalla ya cargada: no con su esqueleto.
  await esperarCargado(page)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
  if (medir) expect(await loQueTapanSinPregunta(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })

/** S01: el menú del usuario («Admin · Medio ▾»), con el nivel, la densidad y la cinta. */
async function abrirUsuario(page: Page) {
  await page.getByRole('button', { name: /\. Tus preferencias$/ }).click()
}
/** S01: la densidad se cambia en el menú del usuario, y lo dice. */
async function cambiarDensidad(page: Page, cual: 'Cómoda' | 'Compacta') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Densidad' }).getByRole('button', { name: cual }).click()
  await expect(page.getByRole('status').filter({ hasText: `Densidad: ${cual.toLowerCase()}.` })).toBeVisible()
}

/** El «Te toca hoy» ya ha contado: la franja deja de estar ocupada y ningún número dice «…». */
async function esperarNumeros(page: Page) {
  const franja = page.getByRole('region', { name: 'Te toca hoy' })
  await expect(franja).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(franja.locator('.cxm-chip-numero', { hasText: '…' })).toHaveCount(0)
}

test('el marco (S01): los productos con su nombre, plegada y desplegada, y el «Te toca hoy» del Inicio', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/inicio')
  await expect(page.locator('.cxm')).toBeVisible()
  // Letra Geist en el marco (Folvy) y fondo de N30, sin el degradado de antes.
  await page.evaluate(() => document.fonts.ready)
  const raiz = await page.locator('.cxm').evaluate((el) => { const s = getComputedStyle(el); return { fondo: s.backgroundColor, imagen: s.backgroundImage } })
  expect(raiz).toEqual({ fondo: 'rgb(238, 241, 245)', imagen: 'none' })

  // «Te toca hoy» (Julio, 16/10): sale lo que tiene algo, con su número; lo que
  // está a 0, no; y si todo está a 0, una línea gris «Nada pendiente hoy».
  // Mientras cuenta dice «…» (y la franja está ocupada); «—» sería que no se ha
  // podido contar.
  const franja = page.getByRole('region', { name: 'Te toca hoy' })
  await esperarNumeros(page)
  const numeros = await franja.locator('.cxm-chip-numero').allTextContents()
  expect(numeros).not.toContain('—')
  expect(numeros).not.toContain('0')
  if (numeros.length === 0) await expect(franja.getByText('Nada pendiente hoy')).toBeVisible()
  else await expect(franja.getByText('Nada pendiente hoy')).toHaveCount(0)
  await expect(franja.getByRole('link')).toHaveCount(numeros.length)
  const primeraCarga = await franja.locator('.cxm-chip-numero').allTextContents()

  if (lado(page) === 'movil') {
    // Abajo (S01): Inicio, Contabilidad, Compras y gastos, Bancos y «Más».
    await expect(menu(page).locator('.s-barra-item .s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Más'])
    await expect(menu(page).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await capturar(page, 'marco-plegado')
    await menu(page).getByRole('button', { name: 'Más' }).click()
    const hoja = page.getByRole('dialog', { name: 'Menú' })
    // Lo que no tiene pantalla no sale (S01: nada vacío): ni Ventas ni Impuestos.
    await expect(hoja.getByRole('link')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes', 'Volver a Folvy'])
    await esperarCargado(page)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/marco-mas-movil.png` })
    await hoja.getByRole('button', { name: 'Cerrar' }).click()
    return
  }

  // Desplegada (de serie, S01): unos 88 px, cada producto con su nombre.
  const barra = menu(page)
  await expect(barra.locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes'])
  expect(Math.round((await barra.boundingBox())!.width)).toBe(88)
  await expect(barra.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
  // Ni Impuestos ni Ventas: un producto sin pantalla no sale (antes, apagado con «Próximamente»).
  await expect(barra.getByText('Impuestos')).toHaveCount(0)
  await expect(page.getByText('Próximamente')).toHaveCount(0)
  await capturar(page, 'marco-desplegado')

  // Plegada: solo los iconos, con su nombre para el lector; se recuerda (en la base).
  await barra.getByRole('button', { name: 'Plegar el menú' }).click()
  expect(Math.round((await barra.boundingBox())!.width)).toBe(56)
  await expect(barra.getByRole('link', { name: 'Contabilidad' })).toBeVisible()
  await page.reload()
  await expect(menu(page).getByRole('button', { name: 'Desplegar el menú' })).toBeVisible()
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(56)
  await esperarNumeros(page)
  await expect(page.getByRole('region', { name: 'Te toca hoy' }).locator('.cxm-chip-numero')).toHaveText(primeraCarga)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'marco-plegado')
  await menu(page).getByRole('button', { name: 'Desplegar el menú' }).click()
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(88)

  // La densidad, en el menú del usuario (S01): compacta de serie; se recuerda.
  await cambiarDensidad(page, 'Cómoda')
  await page.reload()
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')
  await cambiarDensidad(page, 'Compacta')
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'compacta')

  // «Volver a Folvy», en el menú del usuario (con Folvy; en el producto solo no hay).
  await abrirUsuario(page)
  await expect(page.getByRole('link', { name: 'Volver a Folvy' })).toBeVisible()
})

test('una pantalla vieja dentro del marco: Bancos, con su estilo y sus pestañas', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/bancos')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  if (lado(page) === 'ordenador') {
    // Sus pestañas las sigue pintando Bancos (hasta que el frente B la pase): arriba no se repiten.
    await expect(page.getByRole('navigation', { name: 'Pestañas de Bancos' })).toHaveCount(1)
    await expect(menu(page).getByRole('link', { name: 'Bancos', exact: true })).toHaveAttribute('aria-current', 'page')
    // Su estilo de hoy: las tarjetas con el radio de antes (no el de 8 px del marco).
    const tarjetas = page.locator('.cx-principal .cx-tarjeta')
    if (await tarjetas.count()) expect(await tarjetas.first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('8px')
  }
  if (lado(page) === 'movil') {
    // En el móvil, Bancos abre su portada por niveles (PortadaMovil), sin pestañas:
    // la pantalla de siempre, dentro del marco, con Bancos marcado abajo.
    await expect(page.getByRole('navigation', { name: 'Pestañas de Bancos' })).toHaveCount(0)
    await expect(menu(page).getByRole('link', { name: 'Bancos' })).toHaveAttribute('aria-current', 'page')
  }
  await redQuieta(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await capturar(page, 'pantalla-vieja')
})

test('Libros (S01): «Libros y listados» marcada en la cabecera; las áreas, en la pantalla hasta el paso 3', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'En el móvil Libros va por niveles y pinta sus áreas')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  const pestanas = page.getByRole('navigation', { name: 'Pestañas de Contabilidad' })
  await expect(pestanas).toBeVisible()
  // La de la dirección, activa: si está dentro de «Más», el botón la nombra.
  await expect(pestanas.locator('[aria-current="page"], .s-pestana-activa')).toHaveText(/^Libros y listados/)
  await expect(page.getByRole('navigation', { name: 'Áreas de Libros' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Balance de situación' })).toBeVisible({ timeout: 30_000 })
  await capturar(page, 'pestanas-libros')
})

test('el buscador general: Ctrl K es del marco, agrupa por tipo y abre con Intro', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  else await page.keyboard.press('Control+k')
  const dialogo = page.getByRole('dialog', { name: 'Buscar todo' })
  await expect(dialogo).toBeVisible()
  // Ctrl K ya no abre el de Libros: es del marco.
  await expect(page.getByRole('dialog', { name: 'Buscar en Libros' })).toHaveCount(0)

  // Un proveedor de la semilla: sale en su grupo (y las facturas suyas, en el de facturas).
  await dialogo.getByLabel('Qué buscas').fill('Prueba')
  const terceros = dialogo.getByRole('group', { name: 'Clientes y proveedores' })
  await expect(terceros.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await expect(dialogo.getByText('buscando…')).toHaveCount(0, { timeout: 15_000 })
  await expect(dialogo.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/buscador-${lado(page)}.png` })

  // Lo vivo primero (Julio, 16/10): los asientos anulados de las e2e, al final de su grupo y en gris.
  await dialogo.getByLabel('Qué buscas').fill('Prueba e2e')
  const asientos = dialogo.getByRole('group', { name: 'Asientos' })
  await expect(asientos.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await expect(dialogo.getByText('buscando…')).toHaveCount(0, { timeout: 15_000 })
  const apagados = await asientos.getByRole('option').evaluateAll((os) => os.map((o) => o.classList.contains('cxm-buscador-opcion-apagada')))
  expect(apagados).toEqual([...apagados].sort((a, b) => Number(a) - Number(b)))

  // Una opción, con ↓ e Intro: «balance» lleva al Balance de situación.
  await dialogo.getByLabel('Qué buscas').fill('balance de situ')
  const opcion = dialogo.getByRole('group', { name: 'Opciones' }).getByRole('option', { name: /Balance de situación/ })
  await expect(opcion).toBeVisible()
  await expect(opcion).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/conta\/libros\/balances\/balance$/)
  await expect(dialogo).toHaveCount(0)

  // Escape cierra.
  if (lado(page) === 'ordenador') {
    await page.keyboard.press('Control+k')
    await expect(dialogo).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
  }
})

// ── Tarea 4 · El libro diario en el marco ────────────────────────────────

/** El diario ya pintado: la tabla (o la lista del móvil) con filas y nada contando. */
async function esperarDiario(page: Page) {
  const lista = lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' })
    : page.getByRole('list', { name: 'Asientos del libro diario' })
  await expect(lista).toBeVisible({ timeout: 30_000 })
  await esperarCargado(page)
  const franja = page.getByRole('region', { name: 'Te toca hoy' })
  await expect(franja).toHaveAttribute('aria-busy', 'false')
  return lista
}

test('el libro diario en el marco: tabla densa en compacta y en cómoda, Te toca hoy, vistas, Diez y el cuadre', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  const lista = await esperarDiario(page)
  // En la barra de acciones del marco, con su tecla; el ejercicio, en la barra de arriba.
  const acciones = page.getByRole('toolbar', { name: 'Acciones del libro diario' })
  await expect(acciones.getByRole('button', { name: '+ Nuevo asiento' })).toHaveAttribute('aria-keyshortcuts', 'Insert')
  if (lado(page) === 'movil') {
    // En el móvil (Julio, 16/10): solo el principal a la vista; lo demás en «⋯».
    await expect(acciones.getByRole('button')).toHaveCount(2)
    await acciones.getByRole('button', { name: 'Más acciones del libro diario' }).click()
    await expect(acciones.getByRole('button', { name: 'Proponer lo pendiente' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(acciones.getByRole('button', { name: 'Proponer lo pendiente' })).toHaveCount(0)
  } else {
    await expect(acciones.getByRole('button', { name: 'Proponer lo pendiente' })).toBeVisible()
  }
  await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Ejercicio' })).toBeVisible()
  // Te toca hoy: lo que espera revisión, que filtra al pulsarlo.
  await expect(page.getByRole('region', { name: 'Te toca hoy' }).getByRole('button', { name: /^\d+ para revisar$/ })).toBeVisible()
  // Vistas, filtros y exportar.
  await expect(page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: '+ Guardar vista' })).toBeVisible()
  for (const b of ['Excel', 'CSV', 'PDF']) await expect(page.getByRole('group', { name: 'Exportar' }).getByRole('button', { name: b })).toBeVisible()
  // El pie: cuántos y el cuadre.
  await expect(page.getByRole('status', { name: 'Cuadre' })).toContainText(/^Debe .+ · Haber .+ · Cuadra$/)
  // Lo de C de antes en Libros no está: ni el recuadro ni su Ctrl K, ni el título grande.
  await expect(page.locator('.cxl-tuyos, .cxl-cabeza')).toHaveCount(0)

  if (lado(page) === 'movil') {
    await page.evaluate(() => window.scrollTo(0, 0))
    await capturar(page, 'libro-diario')
    // En el móvil, tocar un asiento lo abre.
    await lista.getByRole('button').first().click()
    await expect(page).toHaveURL(/\/conta\/libros\/diario\/[0-9a-f-]{36}/)
    return
  }

  // La columna del número en Diez; y la cabecera se queda arriba al bajar.
  await expect(lista.getByRole('columnheader', { name: 'Diez' })).toBeVisible()
  // Compacta (de serie): filas de unos 28 px, unas 30 por pantalla.
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'compacta')
  const altoCompacta = (await lista.locator('.cxt-fila').first().boundingBox())!.height
  expect(altoCompacta).toBeLessThanOrEqual(30)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'libro-diario-compacta')

  // Teclado: ↓ marca la fila activa, Espacio la marca, Intro la despliega.
  await lista.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(lista.locator('.cxt-fila').nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.cxt-pie')).toContainText('1 marcado')
  await page.keyboard.press('Enter')
  await expect(lista.locator('.cxt-fila').nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(lista.getByRole('link', { name: 'Abrir el asiento' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(lista.getByRole('link', { name: 'Abrir el asiento' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Desmarcar' }).click()

  // Cómoda: filas más altas (unas 20 por pantalla); se recuerda.
  await cambiarDensidad(page, 'Cómoda')
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')
  const altoComoda = (await lista.locator('.cxt-fila').first().boundingBox())!.height
  expect(altoComoda).toBeGreaterThan(altoCompacta + 8)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'libro-diario-comoda')
  await cambiarDensidad(page, 'Compacta')

  // Las fechas, en dd/mm/aaaa y en español, sea cual sea el idioma del navegador (Julio, 16/10).
  const desde = page.getByRole('group', { name: 'Filtros' }).getByLabel('Desde', { exact: true })
  await expect(desde).toHaveAttribute('placeholder', 'dd/mm/aaaa')
  await desde.fill('01102026')
  await expect(desde).toHaveValue('01/10/2026')
  await expect(page.locator('.cxt-pie')).toContainText(/ de \d+ asientos/)
  await page.getByRole('group', { name: 'Filtros' }).getByRole('button', { name: 'Quitar filtros' }).click()
  await expect(desde).toHaveValue('')

  // Una vista guardada: con un filtro puesto, se guarda con nombre y se borra (del navegador).
  await page.getByRole('group', { name: 'Filtros' }).getByLabel('Buscar').fill('ventas')
  await expect(page.locator('.cxt-pie')).toContainText(/ de \d+ asientos/)
  await page.getByRole('button', { name: '+ Guardar vista' }).click()
  await page.getByLabel('Nombre de la vista').fill('Ventas e2e')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Vista guardada: «Ventas e2e». Sale aquí cada vez que abras la pantalla.')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Ventas e2e', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Borrar la vista «Ventas e2e»' }).click()
  await expect(page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Ventas e2e', exact: true })).toHaveCount(0)

  // Exportar: lo dice en pantalla, con el fichero y cuántos (regla 8).
  const bajada = page.waitForEvent('download')
  await page.getByRole('group', { name: 'Exportar' }).getByRole('button', { name: 'CSV' }).click()
  expect((await bajada).suggestedFilename()).toMatch(/^libro-diario-\d{4}.*\.csv$/)
  await expect(page.getByRole('status').filter({ hasText: /^Bajado libro-diario-.+\.csv: \d+ asientos\.$/ })).toBeVisible()
})

test('Libros sin el recuadro de antes: las acciones del área en una fila y el ejercicio arriba', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'En el móvil Libros va por niveles')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  await expect(page.getByRole('heading', { name: 'Balance de situación' })).toBeVisible({ timeout: 30_000 })
  // La segunda fila de la barra de arriba (Julio, 16/10): unos 36 px, dentro de la barra, fija al bajar.
  const fila = page.locator('.cxm-subpestanas')
  const sub = fila.getByRole('navigation', { name: 'Acciones de Balances' })
  await expect(sub.getByRole('link', { name: 'Balance de situación' })).toHaveAttribute('aria-current', 'page')
  expect(Math.round((await fila.boundingBox())!.height)).toBeLessThanOrEqual(37)
  await page.evaluate(() => window.scrollTo(0, 400))
  expect(Math.round((await fila.boundingBox())!.y)).toBeLessThanOrEqual(80)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'libros-subpestanas')
  await expect(sub.getByRole('link', { name: 'Pérdidas y ganancias' })).toBeVisible()
  await expect(page.locator('.cxl-tuyos, .cxl-cabeza, .cxl-barra')).toHaveCount(0)
  await sub.getByRole('link', { name: 'Pérdidas y ganancias' }).click()
  await expect(page.getByRole('heading', { name: 'Pérdidas y ganancias' })).toBeVisible()
})

// ── Tarea 3 · Las tres piezas comunes, en su página de muestra ───────────

test('la muestra de las piezas: tabla densa, formulario por bloques y panel del documento', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/ajustes/muestra-piezas')
  await expect(page.getByRole('heading', { name: 'Muestra de las piezas' })).toBeVisible()
  await expect(page.getByText('Datos inventados, escritos en la página')).toBeVisible()

  // La tabla: 40 asientos, el cuadre, y la franja que filtra.
  await expect(page.locator('.cxt-pie').first()).toContainText('40 asientos')
  await expect(page.getByRole('status', { name: 'Cuadre' })).toContainText('Cuadra')
  await page.getByRole('region', { name: 'Te toca hoy' }).getByRole('button', { name: /para revisar$/ }).click()
  await expect(page.locator('.cxt-pie').first()).toContainText(/^\d+ de 40 asientos/)
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Todos' }).click()

  if (lado(page) === 'movil') {
    await capturar(page, 'piezas', false)
    return
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'piezas-tabla', false)

  // El formulario: lo propuesto en azul hasta que Tab lo acepta; F4 busca subcuenta; Ctrl S guarda y lo dice.
  const form = page.getByRole('form', { name: 'Factura F-2026-118 · Distribuciones Prueba SL' })
  await expect(form.locator('.cxf-leyenda')).toContainText('propuesto por la máquina: Tab lo acepta, escribir lo cambia')
  await expect(form.getByLabel('Fecha', { exact: true })).toHaveValue('12/10/2026')
  await expect(form.getByLabel('Vence', { exact: true })).toHaveValue('11/11/2026')
  const gasto = form.getByLabel(/^Subcuenta de gasto/)
  await expect(gasto).toHaveClass(/cxf-propuesto/)
  await gasto.focus()
  await page.keyboard.press('Tab')
  await expect(gasto).toHaveClass(/cxf-aceptado/)
  await gasto.focus()
  await page.keyboard.press('F4')
  const buscar = page.getByRole('dialog', { name: 'Buscar subcuenta' })
  await buscar.getByLabel('Número o nombre de la subcuenta').fill('publicidad')
  await page.keyboard.press('Enter')
  await expect(gasto).toHaveValue('62700000')
  await page.keyboard.press('Control+s')
  await expect(form.getByRole('status')).toHaveText('Guardado (de muestra: no se escribe nada en ninguna parte).')
  await expect(form.getByText('3 de 12')).toBeVisible()
  await gasto.focus()
  await page.keyboard.press('PageDown')
  await expect(form.getByText('4 de 12')).toBeVisible()

  // El panel del documento: «Ocultar ›» deja el formulario a todo el ancho y se recuerda.
  const doc = page.getByRole('complementary', { name: 'Documento' })
  await expect(doc.getByRole('img', { name: /F-2026-118/ })).toBeVisible()
  await expect(doc.getByRole('region', { name: 'Por qué lo propongo así' })).toBeVisible()
  await form.scrollIntoViewIfNeeded()
  await capturar(page, 'piezas-formulario', false)
  const ancho = (await form.boundingBox())!.width
  await doc.getByRole('button', { name: 'Ocultar ›' }).click()
  await expect(doc.getByRole('button', { name: '‹ Documento' })).toBeVisible()
  expect((await form.boundingBox())!.width).toBeGreaterThan(ancho + 300)
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Documento' }).getByRole('button', { name: '‹ Documento' })).toBeVisible()
  await page.getByRole('button', { name: '‹ Documento' }).click()
})
