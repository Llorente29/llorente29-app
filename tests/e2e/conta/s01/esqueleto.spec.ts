/// <reference lib="dom" />
// tests/e2e/conta/s01/esqueleto.spec.ts
//
// S01 · El esqueleto, en staging-conta, en ordenador y en móvil:
//   · la cuenta A (hostelería): la barra de productos, la cabecera de UNA fila
//     de 48 px, las pestañas de Contabilidad y la cinta de Asientos; en
//     Compras y gastos, Liquidaciones;
//   · la cuenta D (sin hostelería, Julio 17/10): ni Liquidaciones ni nada de
//     hostelería en el esqueleto;
//   · el nivel cambia las palabras y nunca las posiciones (mismas cajas);
//   · Favoritos se guarda en la base: sigue al recargar y en otro navegador;
//   · la cinta se oculta, se recuerda y vuelve;
//   · Sumied (?marca=sumied): la barra azul noche, como la maqueta 1.
// Cada prueba deja las preferencias como estaban (van en la base y las
// pruebas corren de una en una, en el mismo carril).
// Capturas en docs/conta/capturas/s01.

import { test, expect, type Browser, type Page } from '@playwright/test'
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
const pestanas = (page: Page, producto: string) => page.getByRole('navigation', { name: `Pestañas de ${producto}` })
const cinta = (page: Page) => page.getByRole('toolbar', { name: 'Acciones de Asientos' })
const aviso = (page: Page, texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto })

async function abrirUsuario(page: Page) { await page.getByRole('button', { name: /\. Tus preferencias$/ }).click() }
async function abrirFavoritos(page: Page) { await page.getByRole('button', { name: 'Favoritos' }).click() }
async function nivel(page: Page, cual: 'Sin experiencia' | 'Medio' | 'Experto') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Tu nivel' }).getByRole('button', { name: new RegExp(`^${cual}`) }).click()
  await expect(aviso(page, `Nivel: ${cual.toLowerCase()}.`)).toBeVisible()
}

test('A (hostelería): barra de productos, cabecera de una fila de 48 px, pestañas de Contabilidad y la cinta de Asientos', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/libros/diario')
  const cabecera = page.locator('.s-cabecera')
  await expect(cabecera).toBeVisible()

  // UNA fila de 48 px (Julio, respuesta 3): todo lo de la cabecera dentro de esa altura.
  const caja = (await cabecera.boundingBox())!
  expect(Math.round(caja.height)).toBe(48)
  const fuera = await cabecera.locator('a, button').evaluateAll((xs, alto) => xs.filter((x) => {
    const r = x.getBoundingClientRect()
    return r.height > 0 && (r.top < 0 || r.bottom > (alto as number) + 1)
  }).map((x) => x.textContent), caja.y + caja.height)
  expect(fuera).toEqual([])

  // Buscar · Ctrl K y Favoritos, en la cabecera.
  if (lado(page) === 'ordenador') await expect(cabecera.getByRole('button', { name: 'Buscar', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+K')
  await expect(cabecera.getByRole('button', { name: 'Favoritos' })).toBeVisible()
  // Solo la estrella (Julio, 17/10): sin texto a la vista; «Favoritos» al pasar el ratón y para el lector.
  await expect(cabecera.getByRole('button', { name: 'Favoritos' })).toHaveText('')
  await expect(cabecera.getByRole('button', { name: 'Favoritos' })).toHaveAttribute('title', 'Favoritos')

  // Las pestañas de Contabilidad, con Asientos marcada.
  const tabs = pestanas(page, 'Contabilidad')
  if (lado(page) === 'ordenador') {
    const mas = tabs.getByRole('button', { name: /▾$/ })
    if (await mas.count()) await mas.click()
  }
  const nombres = await tabs.getByRole('link').allTextContents()
  expect(nombres.slice(0, 4)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro'])
  expect(nombres.slice(4).every((n) => n === 'Importar')).toBe(true)
  await expect(tabs.getByRole('link', { name: 'Asientos' })).toHaveAttribute('aria-current', 'page')
  if (lado(page) === 'ordenador') await page.keyboard.press('Escape')

  // La cinta de la maqueta 1: NUEVO · REVISAR · UTILIDADES.
  const c = cinta(page)
  await expect(c.getByRole('group', { name: 'Nuevo' }).getByRole('link')).toHaveText(['Expedida', 'Recibida', 'Tesorería', 'General', 'Predefinidos'])
  await expect(c.getByRole('group', { name: 'Revisar' }).getByRole('link')).toHaveText(['Para revisar', 'Libro diario'])
  await expect(c.getByRole('group', { name: 'Utilidades' }).getByRole('button', { name: 'Búsqueda' })).toBeVisible()
  await expect(c.getByRole('link', { name: 'Libro diario' })).toHaveAttribute('aria-current', 'page')
  await capturar(page, 'esqueleto-asientos')
  await c.getByRole('link', { name: 'Para revisar' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\?ver=revisar/)
  await expect(cinta(page).getByRole('link', { name: 'Para revisar' })).toHaveAttribute('aria-current', 'page')

  // La barra de productos: lo que tiene pantalla, con Contabilidad marcada.
  if (lado(page) === 'ordenador') {
    await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes'])
    await expect(barra(page).getByRole('link', { name: 'Contabilidad' })).toHaveAttribute('aria-current', 'page')
  } else {
    await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Más'])
  }

  // Compras y gastos en una empresa de hostelería: con Liquidaciones.
  await page.goto('/conta/compras')
  await expect(pestanas(page, 'Compras y gastos').getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas', 'Liquidaciones'])
  await expect(pestanas(page, 'Compras y gastos').getByRole('link', { name: 'Por revisar' })).toHaveAttribute('aria-current', 'page')
  await capturar(page, 'esqueleto-compras-hosteleria')
  expect(errores).toEqual([])
})

test('D (sin hostelería): ni Liquidaciones ni nada de hostelería en el esqueleto', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_D.email)
  vigilar(page, errores)
  await page.goto('/conta/compras')
  const tabs = pestanas(page, 'Compras y gastos')
  await expect(tabs.getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas'])
  await expect(page.locator('.s-cabecera, .s-barra, .s-barra-inferior, .s-cinta').getByText(/Liquidaci|plataforma|Catcher|socio/i)).toHaveCount(0)
  // La misma barra que A: el esqueleto es uno; lo que cambia es lo de hostelería.
  if (lado(page) === 'ordenador') await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes'])
  // Ni por la dirección: una liquidación no marca ninguna pestaña.
  await page.goto('/conta/compras/liquidacion/nueva')
  await expect(pestanas(page, 'Compras y gastos').locator('[aria-current="page"]')).toHaveCount(0)
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
  expect(errores).toEqual([])
})

test('el nivel cambia las palabras y nunca las posiciones', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(cinta(page)).toBeVisible()
  // Todo cargado antes de medir: la empresa (su botón) y las preferencias (Favoritos ya leídos).
  await expect(page.locator('.s-cab-empresa')).toBeVisible()
  await abrirFavoritos(page)
  await expect(page.getByRole('group', { name: 'Favoritos' })).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  const medir = async () => page.locator('.s-barra a, .s-barra-inferior a, .s-pestanas a, .s-cinta a, .s-cinta button, .s-cab-empresa, .s-cab-derecha button')
    .evaluateAll((xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') }))
  // Se mide con la pantalla quieta: lo que llega de la base después (lo que hay
  // por revisar bajo Inicio, el ejercicio de Libros en la cabecera) mueve cosas,
  // y eso no es el nivel. Dos lecturas iguales separadas 1 s, o 15 s de margen.
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
  const antes = await cajas()
  expect(antes.length).toBeGreaterThan(8)

  try {
    await nivel(page, 'Experto')
    await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
    expect(await cajas()).toEqual(antes)
    // Se guarda en la base: sigue al recargar.
    await page.reload()
    await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
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
  await expect(cinta(page)).toBeVisible()
  await abrirFavoritos(page)
  const fav = page.getByRole('group', { name: 'Favoritos' })
  await expect(fav).toHaveAttribute('aria-busy', 'false')
  await expect(fav.getByText('Aún no tienes ninguno. Fija abajo lo que más uses y saldrá aquí.')).toBeVisible()
  // Lo que se puede fijar desde aquí: esta pantalla y lo de su cinta.
  await expect(fav.getByRole('button', { name: /^Contabilidad › Asientos/ })).toBeVisible()
  await fav.getByRole('button', { name: /^Expedida/ }).click()
  try {
    // Fijar lo dice (regla 8).
    await expect(aviso(page, 'Fijado en Favoritos: «Expedida». Lo tienes arriba, en Favoritos.')).toBeVisible()

    await page.reload()
    await abrirFavoritos(page)
    const tras = page.getByRole('group', { name: 'Favoritos' })
    await expect(tras).toHaveAttribute('aria-busy', 'false')
    await expect(tras.getByRole('link', { name: 'Expedida' })).toHaveAttribute('href', '/conta/libros/diario/nuevo?tipo=expedida')
    await capturar(page, 'esqueleto-favoritos')

    // Otro navegador (otro ordenador): la misma lista, porque está en la base.
    expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual(['Expedida'])

    // Quitar también lo dice; y la lista queda vacía.
    await tras.getByRole('button', { name: 'Quitar «Expedida» de Favoritos' }).click()
    await expect(aviso(page, 'Quitado de Favoritos: «Expedida».')).toBeVisible()
    expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual([])
  } finally {
    // Si algo falló a medias, «Expedida» no se queda fijado para la siguiente prueba (van en la base).
    await page.goto('/conta/libros/diario')
    await abrirFavoritos(page)
    const f = page.getByRole('group', { name: 'Favoritos' })
    await expect(f).toHaveAttribute('aria-busy', 'false')
    const quitar = f.getByRole('button', { name: 'Quitar «Expedida» de Favoritos' })
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
    if (lado(page) === 'ordenador') await barra(page).getByRole('link', { name: 'Compras y gastos' }).click()
    else await page.goto('/conta/compras')
    await expect(pestanas(page, 'Compras y gastos').getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas', 'Liquidaciones'])
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
  await expect(pestanas(page, 'Compras y gastos').getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas'])
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
    if (lado(page) === 'ordenador') await expect(page.locator('.s-cabecera img.s-cab-cliente-logo')).toBeVisible()
  } finally {
    if (await tarjeta.getByRole('button', { name: 'Quitar el logo' }).count()) {
      await tarjeta.getByRole('button', { name: 'Quitar el logo' }).click()
      await expect(tarjeta.getByText(/^Logo quitado\./)).toBeVisible()
    }
  }
  await expect(tarjeta.getByTestId('logo-empresa-sin')).toBeVisible()
  if (lado(page) === 'ordenador') await expect(page.locator('.s-cabecera img.s-cab-cliente-logo')).toHaveCount(0)
  expect(errores).toEqual([])
})

test('Definiciones › Analítica: apagar el local lo quita del asiento a mano; encenderlo lo devuelve, y lo dice', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/ajustes/analitica')
  // En Contabilidad › Definiciones, con su cinta: Plan · Tablas · Analítica.
  await expect(pestanas(page, 'Contabilidad').locator('[aria-current="page"]').first()).toHaveText(/^Definiciones/)
  if (lado(page) === 'ordenador') await expect(page.getByRole('toolbar', { name: 'Acciones de Definiciones' }).getByRole('link', { name: /^Analítica/ })).toHaveAttribute('aria-current', 'page')
  const local = page.getByRole('region', { name: 'Local' })
  await expect(local.getByText('Encendido')).toBeVisible({ timeout: 30_000 })
  await page.goto('/conta/libros/diario/nuevo')
  await expect(page.getByLabel('Local del apunte 1')).toBeVisible({ timeout: 30_000 })
  try {
    await page.goto('/conta/ajustes/analitica')
    await local.getByRole('button', { name: 'Apagar' }).click()
    // Regla 8: dice qué deja de salir y que lo guardado se queda.
    await expect(local.getByText(/^«Local» apagado: ya no se pide ni se enseña en el asiento a mano.*Lo guardado se queda\.$/)).toBeVisible()
    await expect(local.getByText('Apagado')).toBeVisible()
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
  // «Expedida» y «Tesorería» ponen su serie y dicen qué se apunta.
  await page.goto('/conta/libros/diario/nuevo?tipo=expedida')
  await expect(page.getByRole('heading', { name: 'Nueva factura expedida' })).toBeVisible({ timeout: 30_000 })
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

test('la cinta se oculta, se recuerda y vuelve (nunca desaparece sin decir dónde está)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await cinta(page).getByRole('button', { name: 'Ocultar' }).click()
  await expect(cinta(page)).toHaveCount(0)
  await expect(aviso(page, 'Cinta oculta: «Mostrar la cinta» la saca otra vez.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Mostrar la cinta' })).toBeVisible()
  await expect(cinta(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar la cinta' }).click()
  await expect(cinta(page)).toBeVisible()
  await expect(aviso(page, 'La cinta vuelve a estar a la vista.')).toBeVisible()
})

test('Sumied: la barra azul noche, la cabecera de 48 px y la cinta, como la maqueta 1', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?marca=sumied')
  await expect(page.locator('.s-cabecera')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const fondoBarra = await page.locator(lado(page) === 'ordenador' ? '.s-barra' : '.s-barra-inferior').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(fondoBarra).toBe('rgb(11, 31, 59)')
  expect(Math.round((await page.locator('.s-cabecera').boundingBox())!.height)).toBe(48)
  await expect(page.locator('.s-cabecera')).toHaveCSS('font-family', /Inter Variable/)
  await capturar(page, 'esqueleto-sumied')
})
