/// <reference lib="dom" />
// tests/e2e/conta/c06/recorrido.spec.ts
//
// C06 · Tarea 6 · El recorrido ENTERO de la cuenta del frente C con la marca de
// pruebas, en ordenador y en móvil, en el orden en que lo haría el cliente:
//
//   1. la invitación: el administrador de plataforma de prueba da de alta una
//      cuenta nueva con conta-crear-cuenta, la de verdad, desplegada en staging
//      (supabase/staging/funciones.txt). El correo no sale (la marca de pruebas
//      no tiene remitente: lo dice la respuesta) y fuera de producción el
//      enlace viene en la respuesta. Se pinta la invitación (N19) con LOS
//      MISMOS datos que mandó la función;
//   2. la entrada: el enlace de la invitación → «Activa tu cuenta» (pone su
//      contraseña) → la entrada N18 con su correo y su contraseña;
//   3. el alta con su plan y su banco: la conversación entera —«¿De qué
//      programa vienes?» incluida (Cegid Diez)— hasta el IBAN; el alta termina
//      con el plan activado, y la tarjeta «Traer tu contabilidad de Diez» del
//      Inicio solo tiene pendiente lo de Diez;
//   4. traer de Diez desde la C0009: la registra Folvy (aquí, la función de
//      staging e2e_c06_recorrido_base) y la tarjeta lo dice. La lectura de la
//      C0009 —solo GET— la hace después el workflow diez-importar en modo
//      lectura-staging contra la empresa que esta prueba deja escrita;
//   5. el Inicio, los libros y el balance.
//
// Y en TODAS las pantallas: ni una vez «Folvy», y ni un error de la página.
//
// «Activar cuenta» y «Entrar» tienen que abrir su contabilidad, sin atajos: la
// prueba no inyecta la sesión (como sesion.ts) en ningún momento del camino
// del cliente. Si una de las dos se queda en un aviso, falla y dice qué se ve.
//
// Cada ejecución crea una cuenta «Recorrido de Prueba C06 …» por tamaño. Su
// empresa la quita supabase/seeds/conta/e2e_limpieza.sql a los 30 minutos.

import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { FRENTE, STAGING_URL, anonKey, pedirSesion, type Sesion, correoDelCarril } from '../sesion'
import { redQuieta } from '../red'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'
import { MARCAS } from '../../../../supabase/functions/_shared/marcas'
import { contrasenaCambiada, invitacion } from '../../../../supabase/functions/send-email/marca'

// C06b (respuesta 6, tarea 5): las contraseñas de los usuarios del C06
// (sola.*, c06.plataforma) solo se dan en las ramas conta/c06*. Fuera del
// frente C entrarían con HTTP 400: se saltan, con el motivo, no se dan por rojas.
test.skip(FRENTE !== 'c', 'Pruebas del frente C (C06): sus usuarios solo reciben contraseña en las ramas conta/c06*.')

const DIR = 'docs/conta/capturas/c06'
const PLATAFORMA = correoDelCarril('c06.plataforma@c06-prueba.test')
const MARCA = MARCAS.contabilidad
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  return errores
}

/** Ni una «Folvy» a la vista: texto, título y textos alternativos. */
async function sinFolvy(page: Page, donde: string) {
  await page.evaluate(() => document.fonts.ready)
  const visto = await page.evaluate(() => ({
    texto: document.body.innerText,
    titulo: document.title,
    etiquetas: [...document.querySelectorAll('[aria-label],[alt],[title],[placeholder]')]
      .map((e) => [e.getAttribute('aria-label'), e.getAttribute('alt'), e.getAttribute('title'), e.getAttribute('placeholder')].filter(Boolean).join(' ')).join(' | '),
  }))
  expect(visto.texto.split('\n').filter((l) => /folvy/i.test(l)).slice(0, 5), `«Folvy» en el texto de ${donde}`).toEqual([])
  expect(visto.titulo, `«Folvy» en el título de ${donde}`).not.toMatch(/folvy/i)
  expect(visto.etiquetas, `«Folvy» en una etiqueta de ${donde}`).not.toMatch(/folvy/i)
}

async function capturar(page: Page, nombre: string, contenedor: string | null = '.cx-principal') {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  if (contenedor && await page.locator(FLOTANTES_CONTA.join(', ')).count() > 0) {
    expect(await loQueTapan(page, contenedor, FLOTANTES_CONTA)).toEqual([])
  }
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/recorrido-${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

/** Un correo pintado tal cual lo recibe el cliente, para compararlo con su maqueta. */
async function pintarCorreo(page: Page, html: string, nombre: string) {
  const otra = await page.context().newPage()
  await otra.setViewportSize(page.viewportSize() ?? { width: 1440, height: 900 })
  await otra.setContent(html, { waitUntil: 'load' })
  await otra.screenshot({ path: `${DIR}/recorrido-${nombre}-${lado(page)}.png`, fullPage: true })
  await otra.close()
}

/** Un IBAN español inventado, con sus dígitos de control bien (mod 97). Entidad 9999: no existe. */
function ibanInventado(): string {
  const bban = `99990000${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`
  const numerico = `${bban}142800` // «ES00» con E=14, S=28
  let r = 0
  for (const c of numerico) r = (r * 10 + Number(c)) % 97
  return `ES${String(98 - r).padStart(2, '0')}${bban}`
}

const log = (page: Page) => page.getByRole('log', { name: 'Conversación del alta' })
async function decir(page: Page, texto: string) {
  const entrada = page.getByRole('textbox', { name: 'Tu respuesta' })
  await expect(entrada).toBeEnabled()
  await entrada.fill(texto)
  await entrada.press('Enter')
}

/** Lo que staging no puede hacer (sin hook): se mide y se deja escrito. */
function apuntar(nota: string) {
  test.info().annotations.push({ type: 'staging', description: nota })
  console.log(`[recorrido] ${nota}`)
}

test('el recorrido entero: invitación, entrada, alta con plan y banco, Diez desde la C0009, Inicio, libros y balance', async ({ page, baseURL }) => {
  test.setTimeout(1_080_000) // 7 min del recorrido + hasta 11 esperando el turno de la C0009
  const errores = vigilar(page)
  const l = lado(page)
  const sello = Date.now()
  const nombreCuenta = `Recorrido de Prueba C06 ${l} ${sello}`
  const razonSocial = `Recorrido de Prueba C06, S.L.`
  const correo = `recorrido.${l}.${sello}@c06-prueba.test`
  const persona = 'Lucía Inventada'
  const clave = `Rc06${sello}Ok`
  mkdirSync(DIR, { recursive: true })

  // ── 1 · La invitación ─────────────────────────────────────────────────────
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/functions/v1/conta-crear-cuenta`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Origin: baseURL! },
    body: JSON.stringify({ empresa: nombreCuenta, correo, nombre: persona, marca: MARCA.id, motivo: 'Recorrido e2e del C06 (tarea 6), staging.' }),
  })
  const alta = await r.json() as { status?: string; account_id?: string; invitacion_enviada?: boolean; motivo?: string | null; enlace?: string | null; error?: string }
  expect(r.status, `conta-crear-cuenta: ${JSON.stringify(alta)}`).toBe(200)
  expect(alta.account_id).toBeTruthy()
  // La marca de pruebas no tiene remitente: el correo no sale, y la respuesta lo dice (regla 8).
  expect(alta.invitacion_enviada).toBe(false)
  expect(alta.motivo ?? '').toMatch(/no tiene remitente/)
  expect(alta.enlace ?? '').toMatch(new RegExp(`^${baseURL!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/welcome\\?token_hash=[^&]+&type=recovery&marca=contabilidad$`))
  const correoInvitacion = invitacion(MARCA, { nombre: persona, empresa: nombreCuenta, enlace: alta.enlace, diasCaducidad: 7 })
  expect(correoInvitacion.subject).toBe('Contabilidad · Entra en tu contabilidad')
  expect(`${correoInvitacion.subject} ${correoInvitacion.html} ${correoInvitacion.text}`).not.toMatch(/folvy/i)
  await pintarCorreo(page, correoInvitacion.html, 'n19-invitacion')

  // ── 2 · La entrada: el enlace, su contraseña y la entrada N18 ─────────────
  await page.goto(alta.enlace!.replace(baseURL!, ''))
  // Con la marca, con su estilo (el de N18): sin la cabecera de Folvy y con «Email».
  await expect(page.getByRole('heading', { level: 1, name: 'Activa tu cuenta' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.mx-entrar')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveValue(correo)
  await expect(page.getByText('App del equipo')).toHaveCount(0)
  await sinFolvy(page, 'la bienvenida')
  await capturar(page, 'bienvenida', null)
  const claves = page.locator('input[type="password"]')
  await claves.nth(0).fill(clave)
  await claves.nth(1).fill(clave)
  await page.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Activar cuenta' }).click()
  const tras = await Promise.race([
    page.waitForURL(/\/conta\//, { timeout: 30_000 }).then(() => 'dentro' as const),
    page.getByText(/^Activación (completada|guardada)|no se pudo abrir tu cuenta/).first().waitFor({ timeout: 30_000 }).then(() => 'aviso' as const),
  ]).catch(() => 'nada' as const)
  if (tras !== 'dentro') {
    // Lo que se ve, para saber qué pasó (los informes de Playwright no siempre se pueden bajar).
    const visto = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500)
    throw new Error(`Tras «Activar cuenta», no abre su contabilidad. URL ${page.url()} · «${visto}»`)
  }
  apuntar(`Bienvenida: «Activar cuenta» abre su contabilidad (${page.url().replace(baseURL!, '')}).`)
  await sinFolvy(page, 'la bienvenida hecha')
  // Su contraseña es la que puso: se comprueba en la base, no en la pantalla.
  const suya = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email: correo, password: clave }),
  })
  expect(suya.status, 'la contraseña de la bienvenida vale para entrar').toBe(200)
  // Y el aviso de «contraseña cambiada» (N20) que se le manda cuando la cambia, pintado.
  const cambiada = contrasenaCambiada(MARCA, {
    cuando: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'short' }),
    entrar: `${baseURL}/login?marca=contabilidad`,
  })
  expect(`${cambiada.subject} ${cambiada.html}`).not.toMatch(/folvy/i)
  await pintarCorreo(page, cambiada.html, 'n20-contrasena-cambiada')

  // La entrada N18, como al día siguiente: sin sesión, con su correo y su contraseña.
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/login?marca=contabilidad')
  await expect(page.getByRole('heading', { level: 1, name: 'Entra en tu contabilidad' })).toBeVisible()
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(clave)
  await sinFolvy(page, 'la entrada')
  await capturar(page, 'n18-entrar', null)
  await page.getByRole('button', { name: 'Entrar' }).click()
  const entrada = await Promise.race([
    page.waitForURL(/\/conta\/(inicio|alta)/, { timeout: 30_000 }).then(() => 'dentro' as const),
    page.getByRole('alert').waitFor({ timeout: 30_000 }).then(() => 'aviso' as const),
  ]).catch(() => 'nada' as const)
  if (entrada !== 'dentro') {
    const visto = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500)
    throw new Error(`Al pulsar «Entrar», no entra. URL ${page.url()} · «${visto}»`)
  }
  apuntar('Entrada N18: entra con su correo y su contraseña y abre su contabilidad.')
  const s = await pedirSesionDe(correo, clave)

  // ── 3 · El alta con su plan y su banco ────────────────────────────────────
  // Sin empresa, el Inicio lleva al alta: es donde aterriza la primera vez.
  await expect(page).toHaveURL(/\/conta\/alta$/, { timeout: 20_000 })
  await expect(page.locator('.cx-alta-logo')).toHaveText('Contabilidad')
  await expect(log(page).getByText(/NIF/).last()).toBeVisible()
  await sinFolvy(page, 'el alta')
  const nif = cifInventado()
  await decir(page, nif)
  await expect(log(page).getByText(`Entendido: NIF ${nif}. Con él empiezo la ficha de tu empresa.`)).toBeVisible()
  await decir(page, razonSocial)
  await expect(log(page).getByText(`Entendido: ${razonSocial}. Lo he puesto como razón social.`)).toBeVisible()
  await page.getByLabel('Calle').fill('Calle del Recorrido')
  await page.getByLabel('Número').fill('6')
  await page.getByLabel('Código postal').fill('28004')
  await page.getByLabel('Población').fill('Madrid')
  await page.getByRole('button', { name: 'Es esta' }).click()
  await expect(log(page).getByText('Apuntada la dirección: Calle del Recorrido 6, 28004 Madrid.')).toBeVisible()
  await decir(page, 'tenemos una ferretería, vendemos herramientas y tornillos en la tienda')
  await page.getByRole('button', { name: 'Añadir las marcadas' }).click()
  await expect(log(page).getByText(/Ahora, tus impuestos\. ¿Presentas el IVA cada tres meses\?/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Sí, cada tres meses' }).click()
  await page.getByRole('button', { name: 'Sí', exact: true }).click() // nóminas o profesionales
  await page.getByRole('button', { name: 'No', exact: true }).click() // alquiler con retención
  await expect(log(page).getByText(/¿Prefieres el plan de pymes o el general\?/)).toBeVisible()
  await sinFolvy(page, 'el alta, en las cuentas')
  await capturar(page, 'alta-plan', null)
  await decir(page, 'el de pymes')
  await expect(log(page).getByText(/^Entendido: plan de pymes\./)).toBeVisible()
  // C06, respuesta 4: de qué programa viene. Con la lista entera a la vista.
  await expect(log(page).getByText('¿De qué programa vienes?').last()).toBeVisible()
  for (const x of ['Cegid Diez', 'Holded', 'Sage', 'a3', 'ContaSol', 'Quipu', 'Otro', 'Empiezo de cero']) {
    await expect(page.getByRole('button', { name: x, exact: true })).toBeVisible()
  }
  await sinFolvy(page, 'el alta, de qué programa vienes')
  await capturar(page, 'alta-programa', null)
  await page.getByRole('button', { name: 'Cegid Diez', exact: true }).click()
  await expect(log(page).getByText(/^Vienes de Cegid Diez: al terminar el alta activo el plan general contable de pymes/)).toBeVisible()
  await expect(log(page).getByText('¿Cuál es el IBAN de la cuenta del banco de la empresa?')).toBeVisible()
  await decir(page, ibanInventado())
  // El alta no termina sin el plan activado: lo activa al terminar y lo dice.
  await expect(log(page).getByText(/^Listo: .* está montada\. Plan activado: \d+ cuentas de serie, \d+ subcuentas/)).toBeVisible({ timeout: 45_000 })
  await sinFolvy(page, 'el alta terminada')
  await capturar(page, 'alta-hecha', null)

  const empresas = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${alta.account_id}&setup_completed_at=not.is.null`)
  expect(empresas.datos?.length, 'el alta deja UNA empresa terminada').toBe(1)
  const empresa = empresas.datos[0].id
  const programa = await rest<{ programa: string }[]>(s, 'GET', `conta_programa_anterior?select=programa&account_id=eq.${alta.account_id}&company_id=eq.${empresa}`)
  expect(programa.datos, 'la respuesta queda guardada').toEqual([{ programa: 'diez' }])

  // La tarjeta «Traer tu contabilidad de Diez», solo para lo que falte: con
  // datos, plan y banco hechos en el alta, solo el paso 4.
  const tarjeta = page.getByRole('region', { name: 'Traer tu contabilidad de Diez' })
  const paso = (n: number) => tarjeta.locator('.cxi-diez-paso').nth(n - 1)
  await page.goto('/conta/inicio')
  await expect(tarjeta).toBeVisible({ timeout: 20_000 })
  for (const n of [1, 2, 3]) await expect(paso(n)).toHaveClass(/cxi-diez-paso-hecho/)
  await sinFolvy(page, 'el Inicio recién dado de alta')
  await capturar(page, 'inicio-pasos-alta')

  // ── 4 · Traer de Diez desde la C0009 ──────────────────────────────────────
  await expect(paso(4)).toHaveClass(/cxi-diez-paso-falta/)
  await expect(paso(4)).toContainText('Lo hace Contabilidad por ti: en cuanto registre tu base de Diez, la trae.')
  // Folvy registra su base (en staging, la función de la semilla del recorrido).
  // La C0009 es una y la usan los dos carriles: si la tiene el recorrido de
  // otro, «ocupada», y se espera su turno (la función se la da a los 10 min).
  const pedirBase = () => fetch(`${STAGING_URL}/rest/v1/rpc/e2e_c06_recorrido_base`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company: empresa }),
  })
  let base = await pedirBase()
  const desde = Date.now()
  while (base.status === 200 && (await base.clone().json()) === 'ocupada' && Date.now() - desde < 11 * 60_000) {
    await page.waitForTimeout(15_000)
    base = await pedirBase()
  }
  if (Date.now() - desde > 1_000) console.log(`[recorrido] la C0009 estaba en otro carril: ${Math.round((Date.now() - desde) / 1000)} s esperando turno`)
  expect(base.status, `se registra la C0009: ${await base.clone().text()}`).toBe(200)
  expect(await base.clone().json(), 'la C0009 es de este recorrido (no «ocupada»)').toBe('C0009')
  const listo = await rest<{ falta: string; pasos: { paso: string; base?: string }[] }>(s, 'POST', 'rpc/conta_diez_listo', { p_company: empresa })
  expect(listo.status).toBe(200)
  expect(listo.datos.falta, 'con datos, plan y banco, solo falta traer de Diez').toBe('diez')
  await page.reload()
  await expect(paso(4)).toContainText('Tu base de Diez (C0009) está registrada: Contabilidad trae tu contabilidad y te avisa.')
  await expect(tarjeta.locator('.cxi-diez-paso-hecho')).toHaveCount(3)
  await sinFolvy(page, 'el Inicio con la base registrada')
  await capturar(page, 'inicio-pasos-diez')
  // La lectura de la C0009 (solo GET) la hace diez-importar «lectura-staging»
  // contra esta empresa: se deja escrita para lanzarlo.
  writeFileSync(`${DIR}/recorrido-empresa-${l}.json`, `${JSON.stringify({ cuenta: alta.account_id, empresa, nombre: nombreCuenta, base: 'C0009', cuando: new Date().toISOString() }, null, 2)}\n`)
  console.log(`[recorrido] empresa del recorrido (${l}): ${empresa}`)

  // ── 5 · Inicio, libros y balance ──────────────────────────────────────────
  await expect(page.getByRole('heading', { level: 1, name: /^(Buenos días|Buenas tardes|Buenas noches), Lucía$/ })).toBeVisible()
  for (const t of ['En el banco', 'Te deben', 'Debes', 'IVA del trimestre']) await expect(page.locator('.cxi-cifra-etiqueta', { hasText: t })).toBeVisible()
  await capturar(page, 'inicio')
  for (const [ruta, nombre, titulo] of [
    ['/conta/libros', 'libros', 'Libros'],
    ['/conta/libros/diario', 'libro', 'el libro diario'],
    ['/conta/libros/balances/balance', 'balance', 'el balance'],
  ] as const) {
    await page.goto(ruta)
    await expect(page.locator('.cx-principal')).toBeVisible()
    await redQuieta(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await sinFolvy(page, titulo)
    await capturar(page, nombre)
  }
  expect(errores, 'errores de la página en el recorrido').toEqual([])
})

async function pedirSesionDe(email: string, clave: string): Promise<Sesion> {
  const r = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: clave }),
  })
  expect(r.status).toBe(200)
  return await r.json() as Sesion
}

// C06, respuesta 4 (retoque 5): la carrera de «Activar cuenta» también SIN
// marca, que es la bienvenida de Folvy (la de Foodint). Misma invitación, el
// enlace abierto con ?marca=folvy, y rellenado al instante: si la carrera
// volviera, «Activar cuenta» no abriría la cuenta.
test('la bienvenida sin marca (la de Folvy): «Activar cuenta» abre la cuenta aunque se rellene al instante', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const sello = Date.now()
  const correo = `recorrido.sinmarca.${lado(page)}.${sello}@c06-prueba.test`
  const clave = `Rc06${sello}Ok`
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/functions/v1/conta-crear-cuenta`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Origin: baseURL! },
    body: JSON.stringify({ empresa: `Recorrido de Prueba C06 sinmarca ${lado(page)} ${sello}`, correo, nombre: 'Pablo Inventado', marca: MARCA.id, motivo: 'Recorrido e2e del C06: la bienvenida sin marca.' }),
  })
  const alta = await r.json() as { enlace?: string | null }
  expect(r.status, JSON.stringify(alta)).toBe(200)
  await page.goto(alta.enlace!.replace(baseURL!, '').replace('marca=contabilidad', 'marca=folvy'))
  // La de siempre: la tarjeta de Folvy, «App del equipo».
  await expect(page.getByText('App del equipo')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.mx-entrar')).toHaveCount(0)
  const claves = page.locator('input[type="password"]')
  await claves.nth(0).fill(clave)
  await claves.nth(1).fill(clave)
  await page.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Activar cuenta' }).click()
  const tras = await Promise.race([
    page.waitForURL(/\/conta\//, { timeout: 30_000 }).then(() => 'dentro' as const),
    page.getByText(/^Activación (completada|guardada)|no se pudo abrir tu cuenta/).first().waitFor({ timeout: 30_000 }).then(() => 'aviso' as const),
  ]).catch(() => 'nada' as const)
  if (tras !== 'dentro') {
    const visto = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500)
    throw new Error(`Sin marca, tras «Activar cuenta», no abre su contabilidad. URL ${page.url()} · «${visto}»`)
  }
  // Con tope, como en solapes.ts: sin él, «networkidle» espera hasta que muere
  // la prueba si la página no deja de pedir (15/10, e2e 38792955068: dentro de
  // la cuenta y dos minutos esperando a la red). Si no se calla, el log dice qué
  // sigue pidiendo: un bucle de peticiones es un fallo de la app, no una espera.
  const abiertas = new Map<object, string>()
  const alPedir = (q: { url: () => string }) => abiertas.set(q, q.url())
  const alAcabar = (q: object) => abiertas.delete(q)
  page.on('request', alPedir); page.on('requestfinished', alAcabar); page.on('requestfailed', alAcabar)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
    console.log(`[red sin parar] ${page.url()} · ${abiertas.size} abiertas: ${[...new Set(abiertas.values())].slice(0, 10).join(' · ')}`)
  })
  page.off('request', alPedir); page.off('requestfinished', alAcabar); page.off('requestfailed', alAcabar)
  await page.screenshot({ path: `${DIR}/recorrido-bienvenida-sin-marca-hecha-${lado(page)}.png` })
  expect(errores).toEqual([])
})
