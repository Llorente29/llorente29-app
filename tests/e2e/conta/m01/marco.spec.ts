/// <reference lib="dom" />
// tests/e2e/conta/m01/marco.spec.ts
//
// M01 · El marco nuevo (maqueta N30, decisiones de Julio sobre el F01), en la
// cuenta A de staging-conta (todo inventado). Desde el S01 el marco es el
// esqueleto (tests/e2e/conta/s01/esqueleto.spec.ts prueba lo suyo); desde el
// S02 (PR 1), el del patrón único: sin pestañas en la cabecera ni cinta. Aquí:
//   · la barra desplegada (232 px) y plegada (64), que se recuerda (en la base);
//   · lo que no tiene pantalla no sale (antes, Impuestos apagado con «Próximamente»);
//   · el «Te toca hoy» del Inicio;
//   · la densidad (Cómoda de serie, 56 px; Compacta, 40), en el menú del usuario, que se recuerda;
//   · una pantalla vieja (Bancos) dentro del marco, con su estilo, sus páginas en
//     la barra y (S02 · PR 2) su encabezado del patrón con sus acciones;
//   · el buscador general (Ctrl K), que es del marco y no de Libros;
//   · las piezas, en la única muestra (el patrón único).
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

/**
 * Las preferencias se guardan en la base (conta_user_pref). Antes de recargar
 * o de pasar a la siguiente prueba, que la base haya contestado: recargar a
 * medias corta el guardado y la prueba mediría lo de antes.
 */
async function guardandoPreferencias(page: Page, hacer: () => Promise<unknown>) {
  const guardado = page.waitForResponse((r) => r.url().includes('/rest/v1/conta_user_pref') && r.request().method() !== 'GET')
  await hacer()
  expect((await guardado).ok()).toBe(true)
}

/** S01: el menú del usuario, con el nivel y la densidad (S02: ya sin «Ocultar la cinta»). */
async function abrirUsuario(page: Page) {
  // S01d: en el móvil, el usuario va en el cajón del menú.
  if ((page.viewportSize()?.width ?? 1440) < 768 && await page.getByRole('dialog', { name: 'Menú' }).count() === 0) {
    await page.getByRole('button', { name: 'Abrir el menú' }).click()
  }
  await page.getByRole('button', { name: /\. Tus preferencias$/ }).click()
}
/** S01: la densidad se cambia en el menú del usuario, y lo dice (S02: con sus filas, «Densidad: cómoda, filas de 56 px.»). */
async function cambiarDensidad(page: Page, cual: 'Cómoda' | 'Compacta') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Densidad' }).getByRole('button', { name: new RegExp(`^${cual}`) }).click()
  await expect(page.getByRole('status').filter({ hasText: `Densidad: ${cual.toLowerCase()}, filas de ${cual === 'Cómoda' ? 56 : 40} px.` })).toBeVisible()
  if (await page.getByRole('dialog', { name: 'Menú' }).count()) await page.getByRole('button', { name: 'Cerrar el menú' }).click()
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
  // S02: el fondo del patrón (#F4F7FB) en todas las marcas (antes, el de N30 con
  // Folvy), sin el degradado de antes.
  await page.evaluate(() => document.fonts.ready)
  const raiz = await page.locator('.cxm').evaluate((el) => { const s = getComputedStyle(el); return { fondo: s.backgroundColor, imagen: s.backgroundImage } })
  expect(raiz).toEqual({ fondo: 'rgb(244, 247, 251)', imagen: 'none' })

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
    // S01c: el botón de menú de la cabecera abre el cajón con todos los productos.
    await capturar(page, 'marco-plegado')
    await page.getByRole('button', { name: 'Abrir el menú' }).click()
    const hoja = page.getByRole('dialog', { name: 'Menú' })
    // Lo que no tiene pantalla no sale (S01: nada vacío): ni Ventas ni Impuestos. S02 · PR 2: Facturación sí.
    // V02: Inicio está abierto (es el activo) y enseña su página, Documentos (la puerta).
    await expect(hoja.getByRole('link')).toHaveText([/^Inicio/, /^Documentos/, /^Contabilidad/, /^Ventas/, /^Compras y gastos/, /^Bancos/, /^Contactos/, /^Ajustes/, 'Volver a Folvy'])
    await expect(menu(page).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await esperarCargado(page)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/marco-mas-movil.png` })
    await hoja.getByRole('button', { name: 'Cerrar el menú' }).click()
    await expect(hoja).toHaveCount(0)
    return
  }

  // Desplegada (de serie, S01c): S02, 232 px (antes 220), cada apartado con su
  // nombre en una línea; abajo, Favoritos y Ajustes.
  const barra = menu(page)
  await expect(barra.locator('.s-barra-item .s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Ventas', 'Compras y gastos', 'Bancos', 'Contactos', 'Favoritos', 'Ajustes'])
  expect(Math.round((await barra.boundingBox())!.width)).toBe(232)
  // Cada nombre en una sola línea (S01b: «Compras y gastos» se partía).
  for (const alto of await barra.locator('.s-barra-item').evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect().height))) expect(alto).toBeLessThanOrEqual(48)
  // …y entero, sin «…», con su chip al lado (S01c: «Compras y gas…» con el chip 23).
  const cortados = await barra.locator('.s-barra-nombre').evaluateAll((xs) => xs.filter((x) => x.scrollWidth > x.clientWidth).map((x) => x.textContent))
  expect(cortados, 'nombres cortados en la barra desplegada').toEqual([])
  // El apartado, no el logo (que también lleva a Inicio y se llama así).
  await expect(barra.locator('a.s-barra-item').filter({ hasText: 'Inicio' })).toHaveAttribute('aria-current', 'page')
  // Ni Impuestos ni Ventas: un producto sin pantalla no sale (antes, apagado con «Próximamente»).
  await expect(barra.getByText('Impuestos')).toHaveCount(0)
  await expect(page.getByText('Próximamente')).toHaveCount(0)
  await capturar(page, 'marco-desplegado')

  // Plegada: solo los iconos, con su nombre para el lector; se recuerda (en la base).
  await guardandoPreferencias(page, () => barra.getByRole('button', { name: 'Plegar el menú' }).click())
  expect(Math.round((await barra.boundingBox())!.width)).toBe(64)
  await expect(barra.getByRole('link', { name: 'Contabilidad' })).toBeVisible()
  await page.reload()
  await expect(menu(page).getByRole('button', { name: 'Desplegar el menú' })).toBeVisible()
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(64)
  await esperarNumeros(page)
  await expect(page.getByRole('region', { name: 'Te toca hoy' }).locator('.cxm-chip-numero')).toHaveText(primeraCarga)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'marco-plegado')
  await guardandoPreferencias(page, () => menu(page).getByRole('button', { name: 'Desplegar el menú' }).click())
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(232)

  // La densidad, en el menú del usuario (S01). S02 (decisión 2 de Julio, 22/10):
  // Cómoda de serie (antes, Compacta); se recuerda. Se deja en Cómoda, la de serie,
  // que es la que leen las demás pruebas.
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')
  await guardandoPreferencias(page, () => cambiarDensidad(page, 'Compacta'))
  await page.reload()
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'compacta')
  await guardandoPreferencias(page, () => cambiarDensidad(page, 'Cómoda'))
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')

  // «Volver a Folvy», en el menú del usuario (con Folvy; en el producto solo no hay).
  await abrirUsuario(page)
  await expect(page.getByRole('link', { name: 'Volver a Folvy' })).toBeVisible()
})

test('una pantalla vieja dentro del marco: Bancos, con su estilo, sus páginas y su encabezado', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/bancos')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  if (lado(page) === 'ordenador') {
    // S01 · paso 3: sus páginas, en el esqueleto (una sola vez) y su barra, en la fila de acciones.
    // S02: las páginas ya no van en la franja de pestañas (S01f) sino debajo de
    // Bancos, en la barra, en su orden; la cinta es la fila de acciones.
    const paginas = menu(page).getByRole('list', { name: 'Páginas de Bancos' })
    await expect(page.getByRole('list', { name: 'Páginas de Bancos' })).toHaveCount(1)
    await expect(paginas).toBeVisible()
    await expect(paginas).toHaveClass(/s-barra-paginas/)
    // S02 · PR 2: «Cierre del mes» se mudó a Contabilidad › Cierre y Registro › Cerrar el mes.
    await expect(paginas.locator('.s-barra-nombre')).toHaveText(['Movimientos', 'Préstamos y aplazamientos', 'Cuentas y extractos', 'Reglas'])
    await expect(paginas.getByRole('link', { name: 'Movimientos', exact: true })).toHaveAttribute('aria-current', 'page')
    // S02 · PR 2: Bancos pinta su encabezado (EncabezadoPagina, con bancos/acciones.ts): el h1
    // visible de la página y sus acciones; el marco ya no pone su fila (nada sale dos veces).
    await expect(page.getByRole('toolbar', { name: 'Acciones de Movimientos' })).toHaveCount(0)
    const encabezado = page.locator('header.s-encabezado')
    await expect(encabezado.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
    // La regla del patrón: un solo principal, «Subir extracto».
    await expect(encabezado.locator('.s-boton-principal')).toHaveText('Subir extracto')
    await expect(page.locator('.cxl-areas, .cxl-barra, .cxl-tuyos')).toHaveCount(0)
    // S02: el apartado dice «estás dentro» ('true'): estás en una de sus páginas.
    await expect(menu(page).getByRole('link', { name: 'Bancos', exact: true })).toHaveAttribute('aria-current', 'true')
    // Su estilo de hoy: las tarjetas con el radio de antes (no el de 8 px del marco).
    const tarjetas = page.locator('.cx-principal .cx-tarjeta')
    if (await tarjetas.count()) expect(await tarjetas.first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('8px')
  }
  if (lado(page) === 'movil') {
    // S02 · PR 2: se fue la portada por niveles del móvil (PortadaMovil). Bancos abre
    // Movimientos con su encabezado y el principal abajo, bajo el pulgar; el marco no
    // pone su fila de acciones, y las páginas salen en el cajón, con Bancos marcado
    // (S01c) y «estás dentro» ('true').
    await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
    await expect(page.locator('.cxb-apartado')).toHaveCount(0)
    await expect(page.locator('.s-pulgar .s-boton-principal')).toHaveText('Subir extracto')
    await expect(page.getByRole('list', { name: 'Páginas de Bancos' })).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: 'Acciones de Movimientos' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Abrir el menú' }).click()
    await expect(menu(page).getByRole('link', { name: /^Bancos/ })).toHaveAttribute('aria-current', 'true')
    await expect(menu(page).getByRole('list', { name: 'Páginas de Bancos' }).getByRole('link', { name: 'Movimientos', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Cerrar el menú' }).click()
    await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)
  }
  await redQuieta(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await capturar(page, 'pantalla-vieja')
})

test('Libros (S01): «Libros y listados» marcada en la barra; sus libros, en «Ver» del encabezado', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'En el móvil Libros va por niveles y pinta sus áreas')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  // S02: las páginas de Contabilidad, debajo del apartado en la barra (antes, pestañas en la cabecera con «Más»).
  const paginas = menu(page).getByRole('list', { name: 'Páginas de Contabilidad' })
  await expect(paginas).toBeVisible()
  await expect(paginas.locator('[aria-current="page"] .s-barra-nombre')).toHaveText('Libros y listados')
  await expect(page.getByRole('navigation', { name: 'Áreas de Libros' })).toHaveCount(0)
  // S02: los libros son a dónde ir dentro de la página: el selector «Ver» nombra el de la dirección.
  // PR 2: cada libro pinta su encabezado (EncabezadoLibro), con el nombre del libro como h1 visible
  // y «Ver: …» delante de sus botones; el marco ya no pone su fila de acciones.
  await expect(page.getByRole('heading', { level: 1, name: 'Balance de situación' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('header.s-encabezado').getByRole('button', { name: 'Ver: Balance de situación. Cambiar' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Acciones de Libros y listados' })).toHaveCount(0)
  await capturar(page, 'pestanas-libros')
})

test('el buscador general: Ctrl K es del marco, agrupa por tipo y abre con Intro', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  // S02: el botón del móvil se llama «Buscar o hacer algo» (antes, «Buscar»).
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Buscar o hacer algo' }).click()
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
  // S01 · PR 3 (entrega 5): ya no hay «Proponer lo pendiente»; los asientos se
  // proponen solos. Con «Enviar a Diez» apagado (staging), «+ Nuevo asiento» es
  // la única acción, y en el móvil no hace falta «⋯».
  await expect(acciones.getByRole('button', { name: 'Proponer lo pendiente' })).toHaveCount(0)
  if (lado(page) === 'movil') await expect(acciones.getByRole('button')).toHaveCount(1)
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

  // C07 (Julio, 22/10): con «Enviar a Diez» apagado (A), sin columna de Diez (c06/diezTodo.spec.ts, encendido).
  await expect(lista.getByRole('columnheader', { name: 'Diez' })).toHaveCount(0)
  // S02 (decisión 2 de Julio, 22/10): Cómoda de serie, filas de 56 px (antes,
  // Compacta de serie con filas de 28). Se mira la de serie y luego la otra.
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')
  const altoComoda = (await lista.locator('.cxt-fila').first().boundingBox())!.height
  expect(altoComoda).toBeGreaterThanOrEqual(55)
  expect(altoComoda).toBeLessThanOrEqual(58)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'libro-diario-comoda')

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

  // Compacta: filas de 40 px, más bajas que las de Cómoda; y se vuelve a la de serie.
  await cambiarDensidad(page, 'Compacta')
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'compacta')
  const altoCompacta = (await lista.locator('.cxt-fila').first().boundingBox())!.height
  expect(altoCompacta).toBeLessThanOrEqual(42)
  expect(altoComoda).toBeGreaterThan(altoCompacta + 8)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'libro-diario-compacta')
  await cambiarDensidad(page, 'Cómoda')

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

test('Libros sin el recuadro de antes (S01): sus libros en «Ver» del encabezado, y el ejercicio en la cabecera', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'En el móvil Libros va por niveles y pinta sus áreas')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  await expect(page.getByRole('heading', { level: 1, name: 'Balance de situación' })).toBeVisible({ timeout: 30_000 })
  // La cinta (antes, la segunda fila de la barra de arriba, Julio 16/10) llevaba
  // sus 14 libros en una o dos filas, nunca tras «⋯». S02: son a dónde ir dentro
  // de la página, así que van todos en el selector «Ver», con el título de su
  // grupo dentro del menú; ninguno se queda fuera. PR 2: el selector va en el
  // encabezado del libro (EncabezadoLibro), no en la fila de acciones del marco,
  // y su «Más acciones» no repite los libros.
  await expect(page.getByRole('toolbar', { name: 'Acciones de Libros y listados' })).toHaveCount(0)
  const fila = page.locator('header.s-encabezado')
  const ver = fila.getByRole('button', { name: 'Ver: Balance de situación. Cambiar' })
  await expect(ver).toBeVisible()
  await ver.click()
  const libros = fila.getByRole('group', { name: 'Ver', exact: true })
  for (const g of ['Diario', 'Mayor', 'Estados', 'IVA', 'Retenciones']) await expect(libros.getByRole('group', { name: g, exact: true })).toBeVisible()
  expect(await libros.getByRole('link').count()).toBeGreaterThanOrEqual(14)
  // Dentro del menú, el que se está viendo lleva aria-current="true".
  await expect(libros.getByRole('link', { name: /^Balance de situación/ })).toHaveAttribute('aria-current', 'true')
  // S02: el ejercicio, con el botón del periodo de la cabecera (un <select> encima).
  await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Ejercicio' })).toBeVisible()
  await capturar(page, 'libros-ver')
  await expect(page.locator('.cxl-tuyos, .cxl-cabeza, .cxl-barra, .cxm-subpestanas')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(libros).toHaveCount(0)
  await fila.getByRole('button', { name: 'Más acciones' }).click()
  const mas = fila.getByRole('group', { name: 'Más acciones' })
  await expect(mas.getByRole('link', { name: /^Qué cuentas alimentan cada línea/ })).toBeVisible()
  await expect(mas.getByRole('link', { name: /^Balance de situación/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await ver.click()
  await libros.getByRole('link', { name: /^Pérdidas y ganancias/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Pérdidas y ganancias' })).toBeVisible()
  await expect(fila.getByRole('button', { name: 'Ver: Pérdidas y ganancias. Cambiar' })).toBeVisible()
})

// ── Tarea 3 · Las piezas comunes, en la página de muestra ────────────────
//
// S02: la muestra de las piezas del M01 (/conta/ajustes/muestra-piezas) se ha
// juntado con la del sistema de diseño en una sola, «El patrón único», y sus
// tres piezas (TablaDensa, FormularioBloques, PanelDocumento) ya no se enseñan
// ahí: la tabla densa se sigue mirando en el libro diario (arriba). Lo que
// cumplían en la muestra lo cumplen ahora sus plantillas: la Lista (la tabla,
// con su pie y la fila de la que se vino), la Ficha (los datos por bloques,
// con lo propuesto marcado y el asiento que cuadra) y el documento a su lado,
// que se pliega y deja los datos a todo el ancho.

test('la muestra de las piezas: la dirección vieja lleva al patrón, con su lista, su ficha por bloques y el documento', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/ajustes/muestra-piezas')
  await expect(page).toHaveURL(/\/conta\/ajustes\/sistema-diseno$/)
  await expect(page.getByRole('heading', { level: 1, name: 'El patrón único' })).toBeVisible()
  await expect(page.getByText(/Datos inventados: aquí no se lee ni se escribe nada\./)).toBeVisible()

  // La lista: sus tres filas, su pie con el total y la fila de la que se vino, marcada.
  const lista = page.getByLabel('Lista de muestra')
  await expect(lista.locator('[data-fila]')).toHaveCount(3)
  await expect(lista.locator('[data-fila="2"]')).toHaveAttribute('data-actual', '')
  await expect(page.locator('.s-lista-pie').first()).toContainText('3 facturas')

  if (lado(page) === 'movil') {
    await capturar(page, 'piezas', false)
    return
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'piezas-tabla', false)

  // La ficha por bloques: cada bloque con su título; lo propuesto, con su etiqueta y su motivo.
  for (const b of ['Proveedor y factura', 'A qué gasto va']) await expect(page.getByRole('region', { name: b })).toBeVisible()
  const gasto = page.getByRole('region', { name: 'A qué gasto va' })
  await expect(gasto.locator('.s-campo-ficha[data-tono="propuesto"] .s-campo-propuesto')).toHaveText('Propuesto')
  await expect(gasto.getByText('Lo usaste en sus facturas anteriores.')).toBeVisible()
  // El asiento común (encargo «Ficha de la recibida completa», punto 7): la cabecera, sus 3 líneas
  // (el debe arriba, el haber debajo) y la fila de totales con «Cuadra».
  const asiento = page.locator('details.s-asiento-ficha table')
  await expect(asiento.getByRole('row')).toHaveCount(5)
  await expect(asiento.locator('tbody tr').last()).toContainText('Bebidas Inventadas')
  await expect(asiento.locator('tfoot')).toContainText('Cuadra')
  await expect(asiento.locator('tfoot')).toContainText('110,87')

  // El documento: «Plegar el documento» deja los datos a todo el ancho, y «Documento» lo devuelve.
  const ficha = page.locator('.s-ficha')
  const datos = page.locator('.s-ficha-datos')
  const doc = page.getByRole('complementary', { name: 'Documento' })
  await expect(doc.getByText('Aquí va el PDF, grande.')).toBeVisible()
  await ficha.scrollIntoViewIfNeeded()
  await capturar(page, 'piezas-formulario', false)
  const ancho = (await datos.boundingBox())!.width
  await doc.getByRole('button', { name: 'Plegar el documento' }).click()
  await expect(ficha).toHaveAttribute('data-documento', 'oculto')
  await expect(doc.getByRole('button', { name: 'Documento' })).toBeVisible()
  expect((await datos.boundingBox())!.width).toBeGreaterThan(ancho + 300)
  // En la muestra se pliega sin guardar nada (en la ficha de verdad se recuerda por persona).
  await doc.getByRole('button', { name: 'Documento' }).click()
  await expect(ficha).toHaveAttribute('data-documento', 'si')
})
