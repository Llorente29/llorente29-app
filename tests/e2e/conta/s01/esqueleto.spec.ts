/// <reference lib="dom" />
// tests/e2e/conta/s01/esqueleto.spec.ts
//
// S01 · El esqueleto, en staging-conta, en ordenador y en móvil. Rehecho con
// el patrón único del S02 (PR 1): ya no hay pestañas en la cabecera ni cinta.
//   · la cuenta A (hostelería): la barra (o el cajón del móvil) con el
//     apartado activo abierto y sus páginas debajo, la cabecera de 56 px con
//     la franja de la empresa, y la fila de acciones de Asientos; en Compras y
//     gastos, Liquidaciones;
//   · la cuenta D (sin hostelería, Julio 17/10): ni Liquidaciones ni nada de
//     hostelería en el esqueleto;
//   · el nivel cambia las palabras y nunca las posiciones (mismas cajas);
//   · Favoritos (abajo en la barra) se guarda en la base: sigue al recargar y
//     en otro navegador;
//   · la fila de acciones no se oculta: todo sigue a mano, en la fila o en
//     «Más acciones»;
//   · Sumied (?marca=sumied): la barra azul noche.
// Cada prueba deja las preferencias como estaban (van en la base y las
// pruebas corren de una en una, en el mismo carril).
// Capturas en docs/conta/capturas/s01.

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page, errores: string[]) {
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
}
async function capturar(page: Page, nombre: string) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
}

const barra = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })
/** S01c: en el móvil los productos van en un cajón que abre el botón de menú de la cabecera. */
async function abrirCajon(page: Page) {
  await page.getByRole('button', { name: 'Abrir el menú' }).click()
  await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
}
async function cerrarCajon(page: Page) {
  const cajon = page.getByRole('dialog', { name: 'Menú' })
  if (await cajon.count() === 0) return
  await page.getByRole('button', { name: 'Cerrar el menú' }).click()
  await expect(cajon).toHaveCount(0)
}
/** S02: la fila de acciones de la página (antes, la cinta), con el mismo nombre. */
const fila = (page: Page, pagina = 'Asientos') => page.getByRole('toolbar', { name: `Acciones de ${pagina}` })
/** S02: lo que no cabe en la fila va en «Más acciones», con un grupo por título dentro del menú. */
async function masAcciones(donde: Locator) {
  await donde.getByRole('button', { name: 'Más acciones', exact: true }).click()
  const menu = donde.getByRole('group', { name: 'Más acciones', exact: true })
  await expect(menu).toBeVisible()
  return menu
}
const aviso = (page: Page, texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto })

/** S01d: en el móvil, Favoritos y el usuario van en el cajón del menú. */
async function enElCajon(page: Page) {
  if (lado(page) === 'movil' && await page.getByRole('dialog', { name: 'Menú' }).count() === 0) await abrirCajon(page)
}
/**
 * S02: las páginas de un apartado ya no son pestañas de la cabecera: salen
 * debajo del apartado activo, en la barra (en el móvil, en el cajón, que se abre).
 */
async function paginas(page: Page, apartado: string) {
  await enElCajon(page)
  const lista = page.getByRole('list', { name: `Páginas de ${apartado}` })
  await expect(lista).toBeVisible()
  return lista
}
/** Los nombres de las páginas, sin el número de su contador. */
const nombres = (lista: Locator) => lista.locator('.s-barra-nombre')
async function abrirUsuario(page: Page) { await enElCajon(page); await page.getByRole('button', { name: /\. Tus preferencias$/ }).click() }
// exact: con el menú abierto, «Quitar «…» de Favoritos» también lleva la palabra.
async function abrirFavoritos(page: Page) { await enElCajon(page); await page.getByRole('button', { name: 'Favoritos', exact: true }).click() }
async function nivel(page: Page, cual: 'Sin experiencia' | 'Medio' | 'Experto') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Tu nivel' }).getByRole('button', { name: new RegExp(`^${cual}`) }).click()
  await expect(aviso(page, `Nivel: ${cual.toLowerCase()}.`)).toBeVisible()
}

test('A (hostelería): la barra con Contabilidad abierta, la cabecera de 56 px y la fila de acciones de Asientos', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/libros/diario')
  const cabecera = page.locator('.s-cabecera')
  await expect(cabecera).toBeVisible()

  // S02: la cabecera es de 56 px (antes, una fila de 48), con la franja de 3 px
  // del color de la empresa encima; todo lo suyo dentro de esa altura.
  const caja = (await cabecera.boundingBox())!
  expect(Math.round(caja.height)).toBe(56)
  expect(Math.round((await page.locator('.s-franja-empresa').boundingBox())!.height)).toBe(3)
  const fuera = await cabecera.locator('a, button').evaluateAll((xs, alto) => xs.filter((x) => {
    const r = x.getBoundingClientRect()
    return r.height > 0 && (r.top < 0 || r.bottom > (alto as number) + 1)
  }).map((x) => x.textContent), caja.y + caja.height)
  expect(fuera).toEqual([])

  if (lado(page) === 'ordenador') {
    // «Buscar o hacer algo» · Ctrl K, la Ayuda y el usuario, en la cabecera del ordenador.
    await expect(cabecera.getByRole('button', { name: /Buscar o hacer algo/ })).toHaveAttribute('aria-keyshortcuts', 'Control+K')
    await expect(cabecera.getByRole('button', { name: 'Ayuda' })).toBeVisible()
    await expect(cabecera.getByRole('button', { name: /\. Tus preferencias$/ })).toBeVisible()
    // S02: Favoritos ya no va en la cabecera (antes, solo la estrella): va abajo en
    // la barra, con Ajustes, y con su nombre escrito.
    await expect(cabecera.getByRole('button', { name: 'Favoritos', exact: true })).toHaveCount(0)
    await expect(barra(page).getByRole('button', { name: 'Favoritos', exact: true })).toHaveText('Favoritos')
  } else {
    // S01d (Julio, 18/10): en el móvil la cabecera es menú, logo y Buscar, y nada más.
    await expect(cabecera.locator('a:visible, button:visible')).toHaveCount(3)
    await expect(cabecera.getByRole('button', { name: 'Abrir el menú' })).toBeVisible()
    await expect(cabecera.getByRole('link', { name: 'Inicio' })).toBeVisible()
    await expect(cabecera.getByRole('button', { name: 'Buscar o hacer algo' })).toBeVisible()
    // La empresa, ENTERA (sin cortarse) en la fila de debajo, con su cambio de empresa.
    // S02: el nombre va en .s-empresa-nombre, y el botón ocupa toda la fila.
    const empresa = page.locator('.s-cab-fila-movil .s-empresa-nombre')
    await expect(empresa).toBeVisible()
    expect(await empresa.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    await expect(page.locator('.s-cab-fila-movil').getByRole('button', { name: /Cambiar de empresa$/ })).toBeVisible()
    // Favoritos y el usuario, en el cajón.
    await abrirCajon(page)
    const cajon = page.getByRole('dialog', { name: 'Menú' })
    await expect(cajon.getByRole('button', { name: 'Favoritos', exact: true })).toBeVisible()
    await expect(cajon.getByRole('button', { name: /\. Tus preferencias$/ })).toBeVisible()
    await cerrarCajon(page)
  }

  // S02: las páginas de Contabilidad, debajo del apartado en la barra (antes,
  // pestañas de la cabecera con «Más ▾»), con Asientos marcada.
  const tabs = await paginas(page, 'Contabilidad')
  const lista = await nombres(tabs).allTextContents()
  expect(lista.slice(0, 4)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro'])
  expect(lista.slice(4).every((n) => n === 'Importar')).toBe(true)
  await expect(tabs.getByRole('link', { name: 'Asientos' })).toHaveAttribute('aria-current', 'page')
  await cerrarCajon(page)

  // S02: la cinta de la maqueta 1 (NUEVO · REVISAR · UTILIDADES) es ahora la fila
  // de acciones. El libro diario pinta su barra, así que lo del catálogo va
  // entero en «Más acciones», y REVISAR (a dónde ir dentro de la página) es el
  // selector «Ver».
  const c = fila(page)
  const ver = c.getByRole('button', { name: 'Ver: Libro diario. Cambiar' })
  await expect(ver).toBeVisible()
  const mas = await masAcciones(c)
  // S02 · PR 2: la emitida es de Facturación y las recibidas (y Digitalizar), de
  // Compras y gastos; en Asientos queda lo que es un asiento a mano.
  await expect(mas.getByRole('group', { name: 'Nuevo' }).getByRole('link')).toHaveText(['Tesorería', 'General', 'Predefinidos'])
  await expect(mas.getByRole('group', { name: 'Utilidades' }).getByRole('button', { name: 'Búsqueda' })).toBeVisible()
  await expect(mas.getByRole('group', { name: 'Utilidades' }).getByRole('link')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(mas).toHaveCount(0)
  await ver.click()
  const revisar = c.getByRole('group', { name: 'Ver', exact: true }).getByRole('group', { name: 'Revisar' })
  await expect(revisar.getByRole('link')).toHaveText(['Para revisar', 'Libro diario'])
  // Dentro de un menú, la que se está viendo lleva aria-current="true".
  await expect(revisar.getByRole('link', { name: 'Libro diario' })).toHaveAttribute('aria-current', 'true')
  await capturar(page, 'esqueleto-asientos')
  await revisar.getByRole('link', { name: 'Para revisar' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\?ver=revisar/)
  await expect(fila(page).getByRole('button', { name: 'Ver: Para revisar. Cambiar' })).toBeVisible()

  // La barra: lo que tiene pantalla, con Contabilidad marcada. S02: Favoritos va
  // abajo, con Ajustes; y el apartado dice «estás dentro» ('true') porque estás
  // en una de sus páginas. S02 · PR 2: Facturación sale, con Facturas emitidas.
  if (lado(page) === 'ordenador') {
    await expect(barra(page).locator('.s-barra-item .s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Facturación', 'Compras y gastos', 'Bancos', 'Contactos', 'Favoritos', 'Ajustes'])
    await expect(barra(page).getByRole('link', { name: 'Contabilidad', exact: true })).toHaveAttribute('aria-current', 'true')
  } else {
    // S01c: el cajón, con todos los apartados (y «Volver a Folvy»: A no es el producto solo).
    // S01d: y, sobre Ajustes, Favoritos y el usuario («<nombre> · nivel <nivel>»).
    await abrirCajon(page)
    await expect(barra(page).locator('.s-barra-item .s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Facturación', 'Compras y gastos', 'Bancos', 'Contactos', 'Favoritos', / · nivel (sin experiencia|medio|experto)$/, 'Ajustes', 'Volver a Folvy'])
    await expect(barra(page).getByRole('link', { name: 'Contabilidad', exact: true })).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)
  }

  // Compras y gastos en una empresa de hostelería: con Liquidaciones. S02: «Por
  // revisar» (/conta/compras, ahora «Recepciones del local») ya no es una página
  // de la barra: cuelga de Facturas recibidas, que es la que queda marcada.
  await page.goto('/conta/compras')
  const compras = await paginas(page, 'Compras y gastos')
  await expect(nombres(compras)).toHaveText(['Facturas recibidas', 'Liquidaciones'])
  await expect(compras.getByRole('link', { name: 'Facturas recibidas' })).toHaveAttribute('aria-current', 'page')
  await cerrarCajon(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Recepciones del local' })).toBeVisible()
  await capturar(page, 'esqueleto-compras-hosteleria')
  expect(errores).toEqual([])
})

test('D (sin hostelería): ni Liquidaciones ni nada de hostelería en el esqueleto', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_D.email)
  vigilar(page, errores)
  await page.goto('/conta/compras')
  const tabs = await paginas(page, 'Compras y gastos')
  await expect(nombres(tabs)).toHaveText(['Facturas recibidas'])
  // S02: lo del marco es la cabecera, la barra (o el cajón), la fila de acciones y el encabezado.
  await expect(page.locator('.s-cabecera, .s-barra, .s-cajon, .s-acciones-pagina, .s-encabezado').getByText(/Liquidaci|plataforma|Catcher|socio/i)).toHaveCount(0)
  await cerrarCajon(page)
  // La misma barra que A: el esqueleto es uno; lo que cambia es lo de hostelería.
  if (lado(page) === 'ordenador') await expect(barra(page).locator('.s-barra-item .s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Facturación', 'Compras y gastos', 'Bancos', 'Contactos', 'Favoritos', 'Ajustes'])
  // Ni por la dirección: una liquidación no marca ninguna página.
  await page.goto('/conta/compras/liquidacion/nueva')
  await expect((await paginas(page, 'Compras y gastos')).locator('[aria-current="page"]')).toHaveCount(0)
  await cerrarCajon(page)
  await page.goto('/conta/compras')
  // Paso 3: dentro de las pantallas, tampoco (inventario del paso 1, §3). Se mira con la red quieta:
  // lo de hostelería no sale hasta saber de qué es la empresa, y aquí no tiene que salir nunca.
  await expect(page.getByRole('heading', { name: 'Qué tienes que mirar' })).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Liquidaciones del mes' })).toHaveCount(0)
  await expect(page.getByText('Lo que llega con el género')).toHaveCount(0)
  await capturar(page, 'esqueleto-compras-sin-hosteleria')
  await page.goto('/conta/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toHaveCount(1)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/Sube la quincena de Catcher/)).toHaveCount(0)
  // Ventas: sin plataformas; la factura emitida, a mano. S02 · PR 2: la hoja se
  // titula «Nueva factura emitida» (antes, «expedida»).
  await page.goto('/conta/ventas')
  await expect(page.getByText(/^Tus ventas llegan con Facturación/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/plataforma/i)).toHaveCount(0)
  await page.getByRole('link', { name: 'Apuntar una factura expedida' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura emitida' })).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('el nivel cambia las palabras y nunca las posiciones', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(fila(page)).toBeVisible()
  // Todo cargado antes de medir: la empresa (su botón, no el hueco de mientras
  // carga) y las preferencias (Favoritos ya leídos).
  await expect(page.getByRole('button', { name: /Cambiar de empresa$/ })).toBeVisible()
  await abrirFavoritos(page)
  await expect(page.getByRole('group', { name: 'Favoritos' })).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)
  // S02: lo que se mide es lo del marco de ahora: la barra (con las páginas del
  // apartado, antes las pestañas), la cabecera, la empresa y la fila de acciones
  // (antes, la cinta).
  const medir = async () => page.locator('.s-barra a, .s-barra button, .s-cabecera a, .s-cabecera button, .s-empresa, .s-acciones-pagina a, .s-acciones-pagina button')
    .evaluateAll((xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') }))
  // Se mide con la pantalla quieta: lo que llega de la base después (lo que hay
  // por revisar bajo Inicio, el ejercicio de Libros en la cabecera) mueve cosas,
  // y eso no es el nivel. Dos lecturas iguales separadas 1 s, o 15 s de margen.
  const cajas = async () => {
    // Lo que llega tarde de la base (p. ej. «Validar y enviar a Diez», que sale
    // solo si hay asientos para Diez) añade un botón, y eso tampoco es el nivel:
    // primero la red quieta.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
    let previa = await medir()
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000)
      const ahora = await medir()
      if (ahora.join('|') === previa.join('|')) return ahora
      previa = ahora
    }
    return previa
  }
  const antes = await cajas()
  // En el móvil no hay barra a la vista (va en el cajón) ni pestañas: menú, logo,
  // Buscar, la empresa, «Ver», la barra del diario y «Más acciones».
  expect(antes.length).toBeGreaterThan(lado(page) === 'movil' ? 6 : 8)

  try {
    await nivel(page, 'Experto')
    await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
    expect(await cajas()).toEqual(antes)
    // Se guarda en la base: sigue al recargar.
    await page.reload()
    await enElCajon(page)
    await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
    // S01d: en el móvil se mira en el cajón y se cierra, como cuando se midió «antes».
    if (lado(page) === 'movil') {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)
    }
    expect(await cajas()).toEqual(antes)
    await capturar(page, 'esqueleto-nivel-experto')

    await nivel(page, 'Sin experiencia')
    expect(await cajas()).toEqual(antes)
  } finally {
    // Pase lo que pase, el nivel vuelve a medio: las preferencias van en la base y la siguiente prueba las lee.
    await nivel(page, 'Medio')
  }
  expect(await cajas()).toEqual(antes)
})

test('Inicio como bandeja: impuestos con el plazo que toca, las gráficas a un clic y el nivel cambia palabras, no cajas', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/inicio')
  // Los impuestos que vienen: o sus modelos con el plazo que toca, o que no toca nada, o que aún no los sabe.
  // I01b (P5, 18/10): salen de conta_impuesto_calendario y dan UN plazo, el que toca —el de
  // domiciliar si está domiciliado— (encargo I01b), no los dos como antes.
  const impuestos = page.getByRole('region', { name: 'Impuestos que vienen' })
  await expect(impuestos).toBeVisible({ timeout: 30_000 })
  await expect(impuestos.getByText(/Presentarlo hasta el|Domiciliado: presentarlo hasta el|Se pasó el plazo: era hasta el|no toca presentar nada|Aún no sé qué modelos presentas/).first()).toBeVisible({ timeout: 30_000 })
  // Las gráficas, a un clic: de serie no están.
  await expect(page.locator('.cxi-barras')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver la evolución' }).click()
  await expect(page.locator('.cxi-cifra .cxi-barras').first()).toBeVisible()
  await page.getByRole('button', { name: 'Ocultar la evolución' }).click()
  await expect(page.locator('.cxi-barras')).toHaveCount(0)

  await page.waitForLoadState('networkidle')
  const medir = async () => page.locator('.cxi-cifra, .cxi-seccion-titulo, .cxi-cifras-cabeza button')
    .evaluateAll((xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') }))
  const cajas = async () => {
    let previa = await medir()
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000)
      const ahora = await medir()
      if (ahora.join('|') === previa.join('|')) return ahora
      previa = ahora
    }
    return previa
  }
  const banco = page.locator('.cxi-cifra-etiqueta [data-actual]').first()
  // S02 · PR 3: «En el banco» era el libro aquí y el extracto en Bancos; ahora dice lo que es.
  await expect(banco).toHaveText('Bancos · en contabilidad')
  const antes = await cajas()
  expect(antes.length).toBeGreaterThan(5)
  try {
    await nivel(page, 'Experto')
    await expect(banco).toHaveText('Bancos (572)')
    await expect(page.getByRole('heading', { name: 'Calendario fiscal' })).toBeVisible()
    expect(await cajas()).toEqual(antes)
    await capturar(page, 'inicio-experto')
    await nivel(page, 'Sin experiencia')
    await expect(banco).toHaveText('Tus bancos, en contabilidad')
    await expect(page.getByRole('heading', { name: 'Lo que toca presentar a Hacienda' })).toBeVisible()
    expect(await cajas()).toEqual(antes)
    await capturar(page, 'inicio-sin-experiencia')
  } finally {
    await nivel(page, 'Medio')
  }
  await expect(banco).toHaveText('Bancos · en contabilidad')
  await capturar(page, 'inicio-bandeja')
  expect(errores).toEqual([])
})

async function favoritosEnOtroNavegador(browser: Browser, email: string): Promise<string[]> {
  const contexto = await browser.newContext()
  const otra = await contexto.newPage()
  await entrarComo(otra, email)
  await otra.goto('/conta/inicio')
  await abrirFavoritos(otra)
  const fav = otra.getByRole('group', { name: 'Favoritos' })
  // Leídos de la base (no lo de serie de mientras carga).
  await expect(fav).toHaveAttribute('aria-busy', 'false')
  const lista = await fav.locator('.s-menu-fila .s-menu-item').allTextContents()
  await contexto.close()
  return lista
}

test('Favoritos: se fija desde el menú, se guarda en la base y sigue en otro navegador', async ({ page, browser }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(fila(page)).toBeVisible()
  await abrirFavoritos(page)
  const fav = page.getByRole('group', { name: 'Favoritos' })
  await expect(fav).toHaveAttribute('aria-busy', 'false')
  await expect(fav.getByText('Aún no tienes ninguno. Fija abajo lo que más uses y saldrá aquí.')).toBeVisible()
  // Lo que se puede fijar desde aquí: esta pantalla y sus acciones (S02: las de su fila, antes la cinta).
  await expect(fav.getByRole('button', { name: /^Contabilidad › Asientos/ })).toBeVisible()
  // S02 · PR 2: «Expedida» ya no es de Asientos (es «Nueva factura emitida», de
  // Facturación): se fija «Tesorería», que sigue en la fila de Asientos.
  await fav.getByRole('button', { name: /^Tesorería/ }).click()
  try {
    // Fijar lo dice (regla 8), y dice dónde está: S02, abajo en la barra (antes, arriba en la cabecera).
    await expect(aviso(page, 'Fijado en Favoritos: «Tesorería». Lo tienes abajo, en Favoritos.')).toBeVisible()

    await page.reload()
    await abrirFavoritos(page)
    const tras = page.getByRole('group', { name: 'Favoritos' })
    await expect(tras).toHaveAttribute('aria-busy', 'false')
    await expect(tras.getByRole('link', { name: 'Tesorería' })).toHaveAttribute('href', '/conta/libros/diario/nuevo?tipo=tesoreria')
    await capturar(page, 'esqueleto-favoritos')

    // Otro navegador (otro ordenador): la misma lista, porque está en la base.
    expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual(['Tesorería'])

    // Quitar también lo dice; y la lista queda vacía.
    await tras.getByRole('button', { name: 'Quitar «Tesorería» de Favoritos' }).click()
    await expect(aviso(page, 'Quitado de Favoritos: «Tesorería».')).toBeVisible()
    expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual([])
  } finally {
    // Si algo falló a medias, «Tesorería» no se queda fijado para la siguiente prueba (van en la base).
    await page.goto('/conta/libros/diario')
    await abrirFavoritos(page)
    const f = page.getByRole('group', { name: 'Favoritos' })
    await expect(f).toHaveAttribute('aria-busy', 'false')
    const quitar = f.getByRole('button', { name: 'Quitar «Tesorería» de Favoritos' })
    if (await quitar.count()) await quitar.click()
  }
})

test('Ajustes › Empresa: la marca de hostelería se cambia, lo dice y el esqueleto cambia sin recargar', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_D.email)
  vigilar(page, errores)
  // La entrada «Empresa» directamente: en el móvil, /conta/ajustes es la lista de entradas.
  await page.goto('/conta/ajustes/empresa')
  const marca = page.getByRole('group', { name: '¿Es un negocio de hostelería?' })
  await expect(page.getByTestId('es-hosteleria')).toHaveText('No', { timeout: 30_000 })
  try {
    await marca.getByRole('button', { name: 'Sí, es hostelería' }).click()
    // Regla 8: dice qué sale.
    await expect(page.getByText(/^Hecho: es de hostelería\. Ya salen Liquidaciones/)).toBeVisible()
    await expect(page.getByTestId('es-hosteleria')).toHaveText('Sí')
    // El esqueleto lo lee otra vez: Liquidaciones sale en Compras y gastos sin recargar.
    // S02: sus páginas, debajo del apartado en la barra; «Por revisar» ya no es una de ellas.
    if (lado(page) === 'ordenador') await barra(page).getByRole('link', { name: 'Compras y gastos', exact: true }).click()
    else await page.goto('/conta/compras')
    await expect(nombres(await paginas(page, 'Compras y gastos'))).toHaveText(['Facturas recibidas', 'Liquidaciones'])
    await cerrarCajon(page)
  } finally {
    // Pase lo que pase, D vuelve a no ser de hostelería (las demás pruebas lo cuentan).
    await page.goto('/conta/ajustes/empresa')
    await expect(page.getByTestId('es-hosteleria')).not.toHaveText('', { timeout: 30_000 })
    if ((await page.getByTestId('es-hosteleria').textContent()) !== 'No') {
      await marca.getByRole('button', { name: 'No', exact: true }).click()
      await expect(page.getByText(/^Hecho: no es de hostelería\./)).toBeVisible()
    }
  }
  await page.goto('/conta/compras')
  await expect(nombres(await paginas(page, 'Compras y gastos'))).toHaveText(['Facturas recibidas'])
  expect(errores).toEqual([])
})

// Un PNG de 1 × 1 de verdad (para que el bucket lo acepte por su tipo).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

test('Ajustes › Empresa: el logo de la empresa sale en la cabecera; lo que no vale, se dice antes de subir', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_D.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/empresa')
  const tarjeta = page.getByRole('region', { name: 'El logo de la empresa' })
  await expect(tarjeta.getByTestId('logo-empresa-sin')).toBeVisible({ timeout: 30_000 })
  const elegir = page.getByLabel('Elegir el logo de la empresa')
  // Un texto no es un logo: se dice, y no se sube nada (regla 8).
  await elegir.setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
  await expect(tarjeta.getByText('El logo tiene que ser PNG, JPG o WebP. No se ha subido nada.')).toBeVisible()
  try {
    await elegir.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 })
    await expect(tarjeta.getByText('Logo puesto: «logo.png». Ya sale en la cabecera, al lado del nombre de la empresa.')).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByTestId('logo-empresa')).toBeVisible()
    // S02: el logo va en el cuadrado del botón de empresa (antes .s-cab-cliente-logo).
    if (lado(page) === 'ordenador') await expect(page.locator('.s-cabecera img.s-empresa-cuadrado')).toBeVisible()
  } finally {
    if (await tarjeta.getByRole('button', { name: 'Quitar el logo' }).count()) {
      await tarjeta.getByRole('button', { name: 'Quitar el logo' }).click()
      await expect(tarjeta.getByText(/^Logo quitado\./)).toBeVisible()
    }
  }
  await expect(tarjeta.getByTestId('logo-empresa-sin')).toBeVisible()
  if (lado(page) === 'ordenador') await expect(page.locator('.s-cabecera img.s-empresa-cuadrado')).toHaveCount(0)
  expect(errores).toEqual([])
})

test('Definiciones › Analítica: apagar el local lo quita del asiento a mano; encenderlo lo devuelve, y lo dice', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/analitica')
  // En Contabilidad › Definiciones (S02: la página marcada en la barra), y en su
  // fila Plan · Tablas · Analítica son a dónde ir: el selector «Ver», en Analítica.
  await expect(nombres((await paginas(page, 'Contabilidad')).locator('[aria-current="page"]'))).toHaveText(['Definiciones'])
  await cerrarCajon(page)
  if (lado(page) === 'ordenador') await expect(fila(page, 'Definiciones').getByRole('button', { name: 'Ver: Analítica. Cambiar' })).toBeVisible()
  const local = page.getByRole('region', { name: 'Local' })
  await expect(local.getByText('Encendido', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.goto('/conta/libros/diario/nuevo')
  await expect(page.getByLabel('Local del apunte 1')).toBeVisible({ timeout: 30_000 })
  try {
    await page.goto('/conta/ajustes/analitica')
    await local.getByRole('button', { name: 'Apagar' }).click()
    // Regla 8: dice qué deja de salir y que lo guardado se queda.
    await expect(local.getByText(/^«Local» apagado: ya no se pide ni se enseña en el asiento a mano.*Lo guardado se queda\.$/)).toBeVisible()
    await expect(local.getByText('Apagado', { exact: true })).toBeVisible()
    await page.goto('/conta/libros/diario/nuevo')
    await expect(page.getByLabel('Cuenta del apunte 1')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Local del apunte 1')).toHaveCount(0)
    await capturar(page, 'analitica-asiento-sin-local')
  } finally {
    await page.goto('/conta/ajustes/analitica')
    await expect(local.getByText(/^(Encendido|Apagado)$/)).toBeVisible({ timeout: 30_000 })
    if (await local.getByRole('button', { name: 'Encender' }).count()) {
      await local.getByRole('button', { name: 'Encender' }).click()
      await expect(local.getByText(/^«Local» encendido: se pide y se enseña/)).toBeVisible()
    }
  }
  await page.goto('/conta/libros/diario/nuevo')
  await expect(page.getByLabel('Local del apunte 1')).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('Asientos › Predefinidos: se guarda uno desde el asiento a mano, sale en la lista y al usarlo rellena el asiento', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  const nombre = `Alquiler e2e ${lado(page)} ${Date.now()}`
  // «Expedida» y «Tesorería» ponen su serie y dicen qué se apunta. S02 · PR 2: la
  // expedida se titula «Nueva factura emitida».
  await page.goto('/conta/libros/diario/nuevo?tipo=expedida')
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura emitida' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Serie')).toHaveValue('1')
  await page.goto('/conta/libros/diario/nuevo?tipo=tesoreria')
  await expect(page.getByRole('heading', { name: 'Nuevo cobro o pago' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Serie')).toHaveValue('3')

  await page.goto('/conta/libros/diario/nuevo?tipo=predefinido')
  const lista = page.getByRole('region', { name: 'Tus asientos predefinidos' })
  await expect(lista).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Cuenta del apunte 1')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Concepto', { exact: true }).fill('Alquiler del local')
  await page.getByLabel('Cuenta del apunte 1').fill('62100000')
  await page.getByLabel('Debe del apunte 1').fill('1200')
  await page.getByLabel('Cuenta del apunte 2').fill('57200001')
  await page.getByLabel('Haber del apunte 2').fill('1200')
  const guardar = page.getByRole('region', { name: 'Guardar como predefinido' })
  await guardar.getByLabel('Nombre del predefinido').fill(nombre)
  await guardar.getByRole('button', { name: 'Guardar como predefinido' }).click()
  // Regla 8: dice qué ha guardado y dónde está.
  await expect(guardar.getByText(`Guardado como predefinido «${nombre}»: 2 apuntes, serie General, sin importes. Lo tienes en Asientos › Predefinidos.`)).toBeVisible()
  await expect(lista.getByRole('button', { name: nombre })).toBeVisible()

  // Usarlo en un asiento nuevo: concepto y cuentas puestos, los importes por escribir.
  await page.goto('/conta/libros/diario/nuevo?tipo=predefinido')
  await lista.getByRole('button', { name: nombre }).click()
  await expect(lista.getByText(`Puesto «${nombre}»: 2 apuntes; escribe los 2 importes que faltan.`)).toBeVisible()
  await expect(page.getByLabel('Concepto', { exact: true })).toHaveValue('Alquiler del local')
  await expect(page.getByLabel('Cuenta del apunte 1')).toHaveValue('62100000')
  await expect(page.getByLabel('Cuenta del apunte 2')).toHaveValue('57200001')
  await expect(page.getByLabel('Debe del apunte 1')).toHaveValue('')
  await capturar(page, 'asiento-predefinido')
  expect(errores).toEqual([])
})

test('Asientos › Recibida de antes lleva a Compras y gastos: la misma ficha, en un solo sitio', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  // S02 · PR 2: las recibidas son solo de Compras y gastos (regla 1 del patrón).
  // La dirección de antes (Contabilidad › Asientos › Recibida) lleva a Facturas
  // recibidas, en «Por revisar», con su página marcada en la barra.
  await page.goto('/conta/libros/diario/recibidas')
  await expect(page).toHaveURL(/\/conta\/documentos\?ver=por-revisar$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toBeVisible({ timeout: 30_000 })
  await expect(nombres((await paginas(page, 'Compras y gastos')).locator('[aria-current="page"]'))).toHaveText(['Facturas recibidas'])
  await cerrarCajon(page)
  // «Revisar(las) de una en una» abre la primera de la cola (lo que antes hacía
  // Asientos › Recibida); en el ordenador, en el encabezado; en el móvil, abajo.
  await page.getByRole('button', { name: /^Revisar(las)? de una en una/ }).click()
  await expect(page).toHaveURL(/\/conta\/documentos\/recibidas\/[0-9a-f-]{36}/, { timeout: 30_000 })
  // S02: la ficha lleva su encabezado: las migas (el «1 de N» va en su propio
  // grupo, al lado de «La anterior» y «La siguiente») y el veredicto de la IA
  // arriba de los datos (antes, «Lo que he leído»).
  const migas = page.getByRole('navigation', { name: 'Estás en' })
  await expect(migas.getByRole('listitem')).toHaveText(['Compras y gastos', 'Facturas recibidas', /.+/], { timeout: 30_000 })
  await expect(page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ })).toBeVisible({ timeout: 30_000 })
  const id = page.url().match(/recibidas\/([0-9a-f-]{36})/)![1]
  // «1 de N»: la primera de la MISMA cola que recorre la ficha (la pestaña «Por
  // revisar», con el orden de la lista): es la 1 y «La anterior» está apagada.
  const cola = page.getByRole('group', { name: /^Facturas: 1 de \d+$/ })
  await expect(cola).toBeVisible()
  await expect(cola.getByRole('button', { name: 'La anterior' })).toBeDisabled()
  await expect(cola.getByRole('button', { name: 'La siguiente' })).toBeVisible()
  // En el móvil el principal va abajo, bajo el pulgar; es el mismo botón.
  await expect(page.getByRole('button', { name: /^Validar y siguiente/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toHaveCount(0)
  if (lado(page) === 'ordenador') await expect(page.getByRole('button', { name: /^Validar y siguiente/ })).toHaveAttribute('aria-keyshortcuts', 'Enter')
  await capturar(page, 'asientos-recibida')
  // La dirección de antes de UNA factura lleva a su ficha en Compras y gastos, con su consulta.
  await page.goto(`/conta/libros/diario/recibidas/${id}?ver=para-mirar`)
  await expect(page).toHaveURL(new RegExp(`/conta/documentos/recibidas/${id}\\?ver=para-mirar$`), { timeout: 30_000 })
  await expect(page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ })).toBeVisible({ timeout: 30_000 })
  await expect(migas.getByRole('listitem')).toHaveText(['Compras y gastos', 'Facturas recibidas', /.+/])
  await expect(nombres((await paginas(page, 'Compras y gastos')).locator('[aria-current="page"]'))).toHaveText(['Facturas recibidas'])
  await cerrarCajon(page)
  await expect(page.getByRole('button', { name: /^Validar y siguiente/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Está bien · apuntar' })).toHaveCount(0)
  expect(errores).toEqual([])
})

test('Ctrl K es la paleta de órdenes: «cobro» abre Tesorería y «mayor 57200001» su mayor', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/inicio')
  await expect(page.getByRole('button', { name: /Cambiar de empresa$/ })).toBeVisible({ timeout: 30_000 })
  const abrir = async () => {
    // S02: el botón del móvil se llama «Buscar o hacer algo» (antes, «Buscar»).
    if (lado(page) === 'movil') await page.getByRole('button', { name: 'Buscar o hacer algo' }).click()
    else await page.keyboard.press('Control+k')
    const d = page.getByRole('dialog', { name: 'Buscar todo' })
    await expect(d).toBeVisible()
    return d
  }
  let dialogo = await abrir()
  await dialogo.getByLabel('Qué buscas').fill('cobro')
  const tesoreria = dialogo.getByRole('group', { name: 'Opciones' }).getByRole('option', { name: /Tesorería.*Contabilidad › Asientos/ })
  await expect(tesoreria).toBeVisible()
  await tesoreria.click()
  await expect(page.getByRole('heading', { name: 'Nuevo cobro o pago' })).toBeVisible({ timeout: 30_000 })

  dialogo = await abrir()
  await dialogo.getByLabel('Qué buscas').fill('mayor 57200001')
  const mayor = dialogo.getByRole('group', { name: 'Opciones' }).getByRole('option', { name: /Mayor de la 57200001/ })
  await expect(mayor).toBeVisible()
  await mayor.click()
  await expect(page).toHaveURL(/\/conta\/plan\/57200001$/, { timeout: 30_000 })
  expect(errores).toEqual([])
})

test('Recibida (maqueta 3): el porqué de la IA, corregir en Compras, y «No es una factura» con su motivo, que se deshace', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  // La de la semilla de la D01 (en revisión, sin asiento: la e2e de Documentos la abre y no la apunta).
  // S02: la lista es Facturas recibidas (`para-mirar` lleva a «Por revisar»); cada
  // fila se abre con su botón «Abrir <proveedor> <número>» (en el móvil, la tarjeta).
  await page.goto('/conta/documentos?ver=para-mirar&mes=2026-10')
  await page.getByRole('button', { name: /Mayorista Prueba Alfa/ }).first().click()
  await expect(page).toHaveURL(/\/documentos\/recibidas\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const id = page.url().match(/recibidas\/([0-9a-f-]{36})/)![1]
  // S02 · PR 2: la ficha vive solo en Compras y gastos (antes, también en libros/diario/recibidas).
  await page.goto(`/conta/documentos/recibidas/${id}?ver=para-mirar`)
  // S02: «Lo que he comprobado» ya no es un bloque: va dentro de «Por qué», en el veredicto.
  const veredicto = page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ })
  await expect(veredicto).toBeVisible({ timeout: 30_000 })
  await veredicto.getByRole('button', { name: 'Por qué' }).click()
  await expect(veredicto.getByRole('button', { name: 'Ocultar' })).toHaveAttribute('aria-expanded', 'true')
  await expect(veredicto.locator('.s-veredicto-detalle li').first()).toBeVisible()
  // «El asiento que se crea», plegable y abierto de serie (nivel medio).
  await expect(page.locator('details.s-asiento-ficha')).toHaveAttribute('open', '')

  // S02: lo que no es validar va en «Más acciones» del encabezado: corregir (en la
  // recepción, en Compras; antes «Corregir en Compras» en «Lo que he leído») y
  // «No es una factura».
  const mas = await masAcciones(page.locator('header.s-encabezado'))
  await expect(mas.getByRole('link', { name: /^Corregir los importes/ })).toHaveAttribute('href', '/conta/compras')

  // «No es una factura» → ficha completa (tablero 3b): «Descartar con motivo», en
  // «Más acciones», en el ordenador y en el móvil (el proveedor se cambia en su campo).
  await mas.getByRole('button', { name: /^Descartar con motivo/ }).click()
  const dialogo = page.getByRole('dialog', { name: 'Descartar con motivo' })
  await expect(dialogo.getByRole('button', { name: 'Descartar' })).toBeDisabled()
  await dialogo.getByRole('button', { name: 'Es un presupuesto' }).click()
  await dialogo.getByRole('button', { name: 'Descartar' }).click()
  // Regla 8: lo dice (en la siguiente, si la hay; si no, aquí). S02: «Por revisar», con mayúscula, como su pestaña.
  await expect(page.getByRole('status').getByText(/^Descartada: «Es un presupuesto»\. No es una factura y sale de «Por revisar»/)).toBeVisible({ timeout: 30_000 })

  // La misma factura: dice qué es, quién y cuándo, y se deshace.
  await page.goto(`/conta/documentos/recibidas/${id}?ver=todas`)
  const descartada = page.getByRole('region', { name: 'No es una factura' })
  await expect(descartada).toContainText('«Es un presupuesto»', { timeout: 30_000 })
  await expect(descartada).toContainText(/La descartó .+ el \d{2}\/\d{2}\/\d{4}/)
  await expect(page.getByRole('region', { name: /^Lo que dice .+ de esta factura$/ }).getByRole('heading', { name: 'No es una factura' })).toBeVisible()
  await capturar(page, 'recibida-descartada')
  await descartada.getByRole('button', { name: 'Deshacer: sí es una factura' }).click()
  await expect(page.getByRole('status').getByText(/^Recuperada: es una factura y vuelve a «(en revisión|aprobada|con diferencias|borrador)»\./)).toBeVisible({ timeout: 30_000 })
  await expect(descartada).toHaveCount(0)
  expect(errores).toEqual([])
})

// S02: la cinta ya no existe, y con ella «Ocultar» y «Mostrar la cinta» (decisión
// del patrón: las acciones de la página no se esconden). Lo que esta prueba
// cuidaba —que las acciones nunca desaparezcan sin decir dónde están— lo cumple
// ahora la fila: siempre a la vista, y cada acción del catálogo a mano, en la
// fila o en «Más acciones», también después de recargar.
test('la fila de acciones no se oculta: cada acción sigue a mano, en la fila o en «Más acciones»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  for (const vuelta of ['antes', 'al recargar']) {
    if (vuelta === 'al recargar') await page.reload()
    const c = fila(page)
    await expect(c, vuelta).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Ocultar|Mostrar) la cinta$/ })).toHaveCount(0)
    await expect(c.getByRole('button', { name: 'Ocultar', exact: true })).toHaveCount(0)
    await expect(c.getByRole('button', { name: 'Ver: Libro diario. Cambiar' })).toBeVisible()
    const mas = await masAcciones(c)
    // S02 · PR 2: la emitida, las recibidas y Digitalizar ya no son de Asientos
    // (Facturación y Compras y gastos): no salen aquí, ni en la fila ni en el menú.
    for (const a of ['Tesorería', 'General', 'Predefinidos']) {
      await expect(mas.getByRole('link', { name: a, exact: true }), `${a} (${vuelta})`).toBeVisible()
    }
    for (const a of ['Expedida', 'Recibida', 'Recibida a mano', 'Digitalizar', 'Nueva factura emitida']) {
      await expect(page.getByRole('link', { name: a, exact: true }), `${a} fuera de Asientos (${vuelta})`).toHaveCount(0)
    }
    await expect(mas.getByRole('button', { name: 'Búsqueda', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(mas).toHaveCount(0)
  }
  // Y en el menú del usuario ya no hay nada de la cinta.
  await abrirUsuario(page)
  await expect(page.getByRole('group', { name: 'Densidad' })).toBeVisible()
  await expect(page.getByRole('button', { name: /la cinta/ })).toHaveCount(0)
})

test('Sumied: la barra azul noche y la cabecera de 56 px con la franja de la empresa', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?marca=sumied')
  await expect(page.locator('.s-cabecera')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  if (lado(page) === 'movil') await abrirCajon(page)
  const fondoBarra = await page.locator(lado(page) === 'ordenador' ? '.s-barra' : '.s-cajon').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(fondoBarra).toBe('rgb(11, 31, 59)')
  if (lado(page) === 'movil') await page.keyboard.press('Escape')
  // S02: 56 px (antes 48) y, encima, la franja de 3 px del color de la empresa.
  expect(Math.round((await page.locator('.s-cabecera').boundingBox())!.height)).toBe(56)
  expect(Math.round((await page.locator('.s-franja-empresa').boundingBox())!.height)).toBe(3)
  await expect(page.locator('.s-cabecera')).toHaveCSS('font-family', /Inter Variable/)
  // La fila de acciones (antes, la cinta) debajo de la cabecera.
  await expect(fila(page)).toBeVisible()
  await capturar(page, 'esqueleto-sumied')
})
