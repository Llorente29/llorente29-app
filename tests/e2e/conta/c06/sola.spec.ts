/// <reference lib="dom" />
// tests/e2e/conta/c06/sola.spec.ts
//
// C06 · Contabilidad sola, con la marca de pruebas («Contabilidad», forzada con
// ?marca= porque aún no hay dominio). En ordenador (1440) y móvil (390), contra
// staging-conta, con las cuentas del frente C (supabase/seeds/conta/seed_c06_staging.sql):
//
//   · la entrada N18, sin sesión;
//   · el alta conversada con la marca (cuenta «Taller de Prueba Solo», sin empresa);
//   · el recorrido de «Empresa de Prueba Sola»: aterrizaje, Inicio, menú, plan,
//     libro, libros y balances, fichas;
//   · y en TODAS: ni una vez la palabra «Folvy» (ni en la página ni en el
//     título de la pestaña) y ni un error de la página.
//
// La cuenta B no se toca (respuesta 1 del C06, 6). La empresa de la cuenta del
// recorrido se prepara por la API la primera vez y se deja; el alta borra al
// acabar lo que crea.

import { test, expect, type Page } from '@playwright/test'
import { FRENTE, entrarComo, type Sesion, correoDelCarril } from '../sesion'
import { redQuieta } from '../red'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c06'
const SOLA = { email: correoDelCarril('sola.admin@c06-prueba.test'), empresa: 'Empresa de Prueba Sola, S.L.' }
const ALTA = { email: correoDelCarril('sola.alta@c06-prueba.test') }
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// C06b (respuesta 6, tarea 5): las contraseñas de los usuarios del C06
// (sola.*, c06.plataforma) solo se dan en las ramas conta/c06*. Fuera del
// frente C entrarían con HTTP 400: se saltan, con el motivo, no se dan por rojas.
test.skip(FRENTE !== 'c', 'Pruebas del frente C (C06): sus usuarios solo reciben contraseña en las ramas conta/c06*.')

/** La marca de pruebas en esta pestaña, como si se hubiera entrado con ?marca=contabilidad. */
async function conMarca(page: Page) {
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'contabilidad') })
}

/** Los errores de la página: el recorrido no puede tener ninguno. */
function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  return errores
}

/** Ni una «Folvy» a la vista: en el texto de la página, en el título ni en los textos alternativos. */
async function sinFolvy(page: Page, donde: string) {
  await page.evaluate(() => document.fonts.ready)
  const visto = await page.evaluate(() => ({
    texto: document.body.innerText,
    titulo: document.title,
    etiquetas: [...document.querySelectorAll('[aria-label],[alt],[title],[placeholder]')]
      .map((e) => [e.getAttribute('aria-label'), e.getAttribute('alt'), e.getAttribute('title'), e.getAttribute('placeholder')].filter(Boolean).join(' ')).join(' | '),
  }))
  const donde_ = (t: string) => t.split('\n').filter((l) => /folvy/i.test(l)).slice(0, 5)
  expect(donde_(visto.texto), `«Folvy» en el texto de ${donde}`).toEqual([])
  expect(visto.titulo, `«Folvy» en el título de ${donde}`).not.toMatch(/folvy/i)
  expect(visto.etiquetas, `«Folvy» en una etiqueta de ${donde}`).not.toMatch(/folvy/i)
}

async function capturar(page: Page, nombre: string, contenedor: string | null = '.cx-principal') {
  // Una captura con esqueletos no enseña la pantalla: se espera a que cargue.
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  // Con la marca, en ordenador no hay nada flotando (sin barra de la IA): no hay
  // nada que pueda tapar. En el móvil, la barra inferior sí, y se mide.
  const flotantes = await page.locator(FLOTANTES_CONTA.join(', ')).count()
  if (contenedor && flotantes > 0) expect(await loQueTapan(page, contenedor, FLOTANTES_CONTA)).toEqual([])
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

async function cuentaDe(s: Sesion): Promise<string> {
  const r = await rest<{ account_id: string }[]>(s, 'GET', `user_profiles?select=account_id&user_id=eq.${s.user.id}&active=eq.true`)
  expect(r.datos?.length, 'el usuario del frente C tiene su cuenta (semilla seed_c06_staging.sql)').toBe(1)
  return r.datos[0].account_id
}

/** La empresa de «Empresa de Prueba Sola», terminada, la primera vez. Se deja para las siguientes. */
async function empresaDelRecorrido(s: Sesion, cuenta: string): Promise<string> {
  const ya = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${cuenta}&setup_completed_at=not.is.null`)
  if (ya.datos?.length) return ya.datos[0].id
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: cuenta, legal_name: SOLA.empresa, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    fiscal_street: 'Calle de la Prueba', fiscal_number: '3', fiscal_postal_code: '28004', fiscal_city: 'Madrid', fiscal_province: 'Madrid',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se prepara la empresa del recorrido: ${JSON.stringify(r.datos)}`).toBe(201)
  const id = r.datos[0].id
  expect((await rest(s, 'POST', 'company_tax_profile', {
    account_id: cuenta, company_id: id, tax_territory: 'peninsula_baleares', vat_period: 'quarterly', tax_forms: ['303', '347', '390'],
  })).status, 'y su perfil fiscal').toBe(201)
  // Una ferretería: nada de hostelería.
  expect((await rest(s, 'POST', 'company_activity', {
    account_id: cuenta, company_id: id, kind: 'business', description: 'Venta de ferretería', iae_code: '1_6534', cnae_version: '2025', cnae_code: '4752', is_main: true,
  })).status, 'y su actividad').toBe(201)
  return id
}

/** El mes que Inicio pide cerrar: el anterior al de hoy en Madrid (regla 4), con su primer y último día. */
function mesAnterior(): { inicio: string; fin: string } {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number)
  const ano = m === 1 ? y - 1 : y
  const mes = m === 1 ? 12 : m - 1
  const dos = (n: number) => String(n).padStart(2, '0')
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { inicio: `${ano}-${dos(mes)}-01`, fin: `${ano}-${dos(mes)}-${dos(ultimo)}` }
}

/**
 * M01 (#224): «Cerrar <mes>» solo sale si ese mes está por cerrar en la
 * contabilidad: un ejercicio abierto que lo cubre, sin traer y sin cierre. Lo
 * deja así la semilla (seed_c06_sola_ejercicio_staging.sql, en la plantilla que
 * copia cada carril); aquí se comprueba antes de mirar la tarjeta, para que un
 * fallo diga si es la pantalla o el estado. Devuelve el ejercicio.
 */
type Ejercicio = { id: string; ends_on: string; origin: string; origin_program: string | null; imported_until: string | null }

async function mesAnteriorAbierto(s: Sesion, empresa: string): Promise<Ejercicio> {
  const m = mesAnterior()
  const ej = await rest<(Ejercicio & { status: string })[]>(s, 'GET',
    `fiscal_year?select=id,status,ends_on,origin,origin_program,imported_until&company_id=eq.${empresa}&starts_on=lte.${m.inicio}&ends_on=gte.${m.fin}`)
  expect(ej.datos, `un ejercicio cubre ${m.inicio} (semilla seed_c06_sola_ejercicio_staging.sql)`).toHaveLength(1)
  expect(ej.datos[0].status, 'el ejercicio está abierto').toBe('open')
  expect(ej.datos[0].imported_until === null || ej.datos[0].imported_until < m.inicio, `${m.inicio} no está traído de otro programa`).toBe(true)
  const cierres = await rest<unknown[]>(s, 'GET', `fiscal_period_lock?select=month&company_id=eq.${empresa}&month=eq.${m.inicio}&reopened_at=is.null`)
  expect(cierres.datos, `${m.inicio} sin cerrar`).toEqual([])
  const { id, ends_on, origin, origin_program, imported_until } = ej.datos[0]
  return { id, ends_on, origin, origin_program, imported_until }
}

// ── La entrada N18 ──────────────────────────────────────────────────────────

test('N18 · la entrada con la marca: logo, «Entra en tu contabilidad», las cuatro frases y el pie', async ({ page }) => {
  const errores = vigilar(page)
  await page.goto('/login?marca=contabilidad')
  await expect(page.getByRole('heading', { level: 1, name: 'Entra en tu contabilidad' })).toBeVisible()
  await expect(page.getByText('Te ha invitado tu asesor o tu empresa. Entra con tu correo.')).toBeVisible()
  await expect(page.getByLabel('Correo')).toBeVisible()
  await expect(page.getByLabel('Contraseña')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  // Las cuatro frases ciertas hoy (C06, respuesta 2), y ninguna de las que
  // prometen lo que aún no existe.
  for (const f of ['Tus libros —diario, balance y resultados— en un solo sitio.', 'El IVA del trimestre a la vista, con su libro registro.',
    'Cada mes se cierra con sus pasos, y lo cerrado no se toca.', 'Lo que hago yo, lo ves y lo puedes deshacer.']) {
    await expect(page.getByText(f)).toBeVisible()
  }
  for (const f of [/se apunta sola/, /banco se casa/, /listo para presentar/, /Holded|Sage|A3/]) await expect(page.getByText(f)).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Contabilidad' })).toBeVisible()
  await expect(page.getByText('Aviso legal')).toBeVisible()
  expect(await page.title()).toBe('Contabilidad')
  await sinFolvy(page, 'la entrada')
  await capturar(page, 'n18-entrar', null)
  // «He olvidado la contraseña» se queda en la misma pantalla, con la marca.
  await page.getByRole('button', { name: 'He olvidado la contraseña' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Pon una contraseña nueva' })).toBeVisible()
  await sinFolvy(page, 'la contraseña olvidada')
  await capturar(page, 'n18-contrasena', null)
  expect(errores).toEqual([])
})

test('sin marca, la entrada de siempre (Folvy no cambia)', async ({ page }) => {
  await page.goto('/login?marca=folvy')
  await expect(page.getByText('Inicio de sesión')).toBeVisible()
  await expect(page.getByText('Folvy · Restauración Profesional')).toBeVisible()
})

// ── El alta conversada con la marca ─────────────────────────────────────────

test('el alta conversada (N1b) con la marca: sin una palabra de Folvy', async ({ page }) => {
  const errores = vigilar(page)
  await conMarca(page)
  const s = await entrarComo(page, ALTA.email)
  const cuenta = await cuentaDe(s)
  const borrar = async () => {
    const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${cuenta}`)
    for (const c of r.datos ?? []) expect((await rest<unknown[]>(s, 'DELETE', `company?id=eq.${c.id}&account_id=eq.${cuenta}`)).status).toBeLessThan(300)
  }
  await borrar()
  try {
    // Sin empresa, el Inicio lleva al alta: es donde aterriza el cliente la primera vez.
    await page.goto('/conta/inicio')
    await expect(page).toHaveURL(/\/conta\/alta$/)
    const log = page.getByRole('log', { name: 'Conversación del alta' })
    await expect(log.getByText(/NIF/).last()).toBeVisible()
    await expect(page.locator('.cx-alta-logo')).toHaveText('Contabilidad')
    await sinFolvy(page, 'el alta')
    await capturar(page, 'alta', null)
  } finally {
    await borrar()
  }
  expect(errores).toEqual([])
})

// ── El recorrido de la cuenta sola ──────────────────────────────────────────

test('el recorrido: aterrizaje, Inicio, menú, plan, libro, libros y balances y fichas, sin «Folvy» y sin errores', async ({ page }) => {
  test.setTimeout(180_000)
  const errores = vigilar(page)
  await conMarca(page)
  const s = await entrarComo(page, SOLA.email)
  const cuenta = await cuentaDe(s)
  const empresa = await empresaDelRecorrido(s, cuenta)
  await mesAnteriorAbierto(s, empresa)

  // Aterrizaje: lo de hostelería no existe para esta cuenta; todo lleva al Inicio de contabilidad.
  await page.goto('/')
  await expect(page).toHaveURL(/\/conta\/inicio$/)
  await page.goto('/kitchen')
  await expect(page).toHaveURL(/\/conta\/inicio$/)

  // Inicio («Estilo nuevo · Inicio»).
  await expect(page.getByRole('heading', { level: 1, name: /^(Buenos días|Buenas tardes|Buenas noches), Marta$/ })).toBeVisible()
  for (const t of ['En el banco', 'Te deben', 'Debes', 'IVA del trimestre']) await expect(page.locator('.cxi-cifra-etiqueta', { hasText: t })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Solo necesito que me digas esto' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Lo que he hecho yo desde ayer' })).toBeVisible()
  // El mes anterior está por cerrar (lo comprueba mesAnteriorAbierto): su tarjeta,
  // ya cargada. Mientras carga el título sale igual, así que se mira su barra.
  await expect(page.getByRole('heading', { level: 2, name: /^Cerrar / })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: /^Cierre de / })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.cxi-cifra-valor').first()).not.toHaveText('…')
  // Sin la barra de la IA (solo contestaría «Muy pronto») ni «Volver a…».
  await expect(page.locator('.cx-pregunta')).toHaveCount(0)
  await expect(page.getByText(/Volver a/)).toHaveCount(0)
  // El menú del producto vendido solo: lo que funciona, nada de «aún no».
  // B01: con Bancos, al tener ruta (encargo del C06, tarea 5: «Bancos, cuando el frente B lo tenga»).
  if (lado(page) === 'ordenador') {
    const menu = page.getByRole('navigation', { name: 'Menú de contabilidad' })
    // El texto de cada entrada (sin el número de lo que hay por mirar, que va aparte).
    // M01: los módulos del marco nuevo (Documentos va dentro de Compras; Impuestos, apagado).
    await expect(menu.locator('.cxm-modulo-nombre')).toHaveText(['Inicio', 'Compras', 'Bancos', 'Libros', 'Impuestos', 'Clientes y proveedores', 'Ajustes'])
  } else {
    const barra = page.getByRole('navigation', { name: 'Menú de contabilidad' })
    await expect(barra.getByRole('link', { name: 'Inicio' })).toBeVisible()
    await expect(barra.getByRole('link', { name: 'Libros' })).toBeVisible()
    await expect(barra.getByRole('button', { name: /Preguntar/ })).toHaveCount(0)
  }
  await sinFolvy(page, 'el Inicio')
  await capturar(page, 'inicio')

  // C06, respuesta 2: en el móvil, «Más» abre el menú entero con lo que
  // funciona (la barra solo tiene sitio para Inicio y Ajustes hoy).
  if (lado(page) === 'movil') {
    const barra = page.getByRole('navigation', { name: 'Menú de contabilidad' })
    await barra.getByRole('button', { name: 'Más' }).click()
    const hoja = page.getByRole('dialog', { name: 'Menú' })
    await expect(hoja.locator('.cxm-modulo-nombre')).toHaveText(['Inicio', 'Compras', 'Bancos', 'Libros', 'Impuestos', 'Clientes y proveedores', 'Ajustes'])
    await sinFolvy(page, 'el menú «Más»')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/mas-movil.png` })
    await hoja.getByRole('link', { name: 'Libros' }).click()
    await expect(page).toHaveURL(/\/conta\/libros/)
    await expect(hoja).toHaveCount(0)
  }

  // Plan contable: activarlo la primera vez; las siguientes ya está.
  await page.goto('/conta/ajustes/plan')
  const activar = page.getByRole('button', { name: 'Activar el plan' })
  if (await activar.count()) {
    await activar.click()
    await expect(page.getByText(/^Plan activado: /)).toBeVisible({ timeout: 30_000 })
  }
  await expect(page.locator('.cx-principal')).toBeVisible()
  await redQuieta(page)
  await sinFolvy(page, 'el plan contable')
  await capturar(page, 'plan')

  // Ejercicio abierto (lo necesitan el libro y los balances).
  await page.goto('/conta/ajustes/ejercicio')
  const ano = new Date().getFullYear()
  const abrir = page.getByRole('button', { name: `Abrir el ejercicio ${ano}` })
  if (await abrir.count()) {
    await abrir.click()
    await expect(page.getByText(`Abierto el ejercicio ${ano}.`)).toBeVisible()
  }
  await sinFolvy(page, 'el ejercicio')

  for (const [ruta, nombre, titulo] of [
    ['/conta/libros/diario', 'libro', 'el libro diario'],
    ['/conta/libros', 'libros', 'Libros'],
    ['/conta/libros/balances/balance', 'balance', 'el balance'],
    ['/conta/libros/balances/pyg', 'pyg', 'la cuenta de pérdidas y ganancias'],
    ['/conta/libros/registro/expedidas', 'registro', 'el libro registro'],
    ['/conta/clientes-y-proveedores', 'fichas', 'clientes y proveedores'],
    ['/conta/compras', 'compras', 'compras'],
    ['/conta/ajustes', 'ajustes', 'ajustes'],
  ] as const) {
    await page.goto(ruta)
    await expect(page.locator('.cx-principal'), `${ruta} (${lado(page)}) abre dentro del marco`).toBeVisible()
    await redQuieta(page)
    await expect(page.getByRole('alert'), `${ruta} (${lado(page)}) sin avisos de error`).toHaveCount(0)
    await sinFolvy(page, titulo)
    if (nombre === 'libro' || nombre === 'balance' || nombre === 'fichas') await capturar(page, nombre)
  }
  expect(errores, 'errores de la página en el recorrido').toEqual([])
})

// M01 (#224): un mes ya cerrado fuera (traído de otro programa) no se pide cerrar.
// La prueba lo pone así en SU carril (el ejercicio, traído hasta el último día del
// mes anterior) y lo deja como estaba, pase lo que pase.
test('Inicio no pide cerrar el mes anterior si ya está cerrado fuera: sin «Cerrar <mes>»', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await conMarca(page)
  const s = await entrarComo(page, SOLA.email)
  const empresa = await empresaDelRecorrido(s, await cuentaDe(s))
  const ej = await mesAnteriorAbierto(s, empresa)
  const m = mesAnterior()
  // Traído de Diez hasta el último día del mes anterior, como lo deja el corte
  // (20261012T0110_c04r_corte_datos): «mixed» si el ejercicio sigue después;
  // «migrated» si ese día es el último del ejercicio (CHECK fiscal_year_traido_coherente).
  const traido = { origin: m.fin === ej.ends_on ? 'migrated' : 'mixed', origin_program: 'diez', imported_until: m.fin }
  const cambio = await rest(s, 'PATCH', `fiscal_year?id=eq.${ej.id}`, traido)
  expect(cambio.status, `el ejercicio, traído hasta el ${m.fin}: ${JSON.stringify(cambio.datos)}`).toBe(200)
  try {
    await page.goto('/conta/inicio')
    await expect(page.getByRole('heading', { level: 1, name: /^(Buenos días|Buenas tardes|Buenas noches), Marta$/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Solo necesito que me digas esto' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Lo que he hecho yo desde ayer' })).toBeVisible()
    await expect(page.locator('.cxi-cifra-valor').first()).not.toHaveText('…')
    await redQuieta(page)
    // Ya cargado todo: ni la tarjeta ni su barra (mientras carga, el título sale un momento).
    await expect(page.getByRole('heading', { level: 2, name: /^Cerrar / })).toHaveCount(0)
    await expect(page.getByRole('progressbar', { name: /^Cierre de / })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await sinFolvy(page, 'el Inicio con el mes cerrado fuera')
  } finally {
    const vuelta = await rest(s, 'PATCH', `fiscal_year?id=eq.${ej.id}`,
      { origin: ej.origin, origin_program: ej.origin_program, imported_until: ej.imported_until })
    expect(vuelta.status, `el ejercicio, como estaba: ${JSON.stringify(vuelta.datos)}`).toBe(200)
  }
  expect(errores).toEqual([])
})

test('sin marca, la cuenta sola también aterriza en su Inicio y nunca ve hostelería', async ({ page }) => {
  await entrarComo(page, SOLA.email)
  await page.goto('/?marca=folvy')
  await expect(page).toHaveURL(/\/conta\/inicio$/)
  await expect(page.locator('.cxi-titulo')).toBeVisible()
})

test('lo que lee un enlace compartido: el index de la marca no dice «Folvy» y el de siempre no cambia', async ({ request }) => {
  // Lo que Vercel sirve con ?marca=contabilidad fuera de producción (y por el
  // dominio de la marca cuando lo tenga): dist/marcas/contabilidad/index.html.
  // vite preview no aplica las reglas de vercel.json; se pide el fichero.
  const marca = await (await request.get('/marcas/contabilidad/index.html')).text()
  expect(marca).not.toMatch(/folvy/i)
  expect(marca).toContain('<title>Contabilidad</title>')
  expect(marca).toContain('<meta property="og:title" content="Contabilidad" />')
  expect(marca).toContain('<meta property="og:image" content="/marcas/contabilidad/vista-previa.png" />')
  expect((await request.get('/marcas/contabilidad/vista-previa.png')).headers()['content-type']).toBe('image/png')
  const siempre = await (await request.get('/index.html')).text()
  expect(siempre).toContain('<title>Folvy</title>')
  expect(siempre).not.toContain('og:')
})
