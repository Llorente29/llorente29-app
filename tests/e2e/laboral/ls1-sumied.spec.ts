/// <reference lib="dom" />
// tests/e2e/laboral/ls1-sumied.spec.ts
//
// LS1 (28/10/2026) · Laboral dentro de Sumied, con «Empresa de Prueba Sola»
// (la empresa solo de Sumied del carril, sin nada de Folvy), en staging-conta,
// en ordenador (1440) y en móvil (390), con la marca Sumied en la pestaña.
//
//   1. De cero: el administrador da de alta un centro de trabajo y a una
//      persona (el alta corta, con su acceso al portal); la persona entra en
//      /acceso desde el móvil y ficha; pide una corrección desde su portal; el
//      administrador la aprueba y corrige una entrada sin salida dentro de
//      «Para revisar»; y saca el informe para la Inspección (PDF).
//   2. Cada pantalla de Laboral abre sin errores, sin «Folvy» y sin «local»
//      (en Sumied es «centro»); las que aún no existen dicen «Llega en …».
//
// El interruptor `conta_laboral` de la empresa del carril lo enciende la
// plataforma del carril (feature_flags solo lo escribe la plataforma). Todo lo
// que se crea es de la cuenta del carril y se borra con él; los usuarios de las
// personas dadas de alta quedan en auth de staging (llevan un nombre al azar).
// Las capturas van como adjuntos del informe (artefacto del run): Laboral no
// es un frente con carpeta de capturas.

import { test, expect, type Browser, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, correoDePrueba, correoDelCarril, entrarComo, pedirSesion, type Sesion } from '../conta/sesion'
import { rest } from '../conta/api'

const SOLA = correoDelCarril('sola.admin@c06-prueba.test')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
// Puerta del Sol: el centro de la prueba se da de alta aquí, y aquí ficha la persona.
const SOL = { latitude: 40.4168, longitude: -3.7038 }
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'

/** Las pantallas de Sumied › Laboral, por su dirección (la de Equipo es la vacía). */
const PANTALLAS = [
  '', 'ahora-mismo', 'para-revisar', 'control-horario', 'registro-jornada', 'bolsa-horas', 'recordatorios-fichaje', 'kiosko',
  'calendario', 'plantilla-turnos', 'disponibilidad', 'turnos-abiertos', 'cambios', 'plantilla',
  'solicitudes', 'formacion', 'nominas', 'centros', 'portal',
]
const LLEGA: [string, string][] = [['contrato', 'noviembre'], ['nominasSumied', 'enero'], ['seguros', 'febrero'], ['sepe', 'febrero']]

/** La marca Sumied en la pestaña, como si se entrara por app.sumied.com. */
async function conMarcaSumied(page: Page) {
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
}

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  return errores
}

/** El día de hace n días, en Madrid (AAAA-MM-DD), y una hora de ese día como instante. */
function diaDeHace(n: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - n * 86_400_000))
}
function aLas(dia: string, hhmm: string): string {
  for (const off of ['+01:00', '+02:00']) {
    const t = new Date(`${dia}T${hhmm}:00${off}`)
    const vuelta = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
    if (vuelta === hhmm) return t.toISOString()
  }
  throw new Error(`No sé convertir ${dia} ${hhmm}`)
}

function dniAlAzar(): string {
  const n = 10_000_000 + Math.floor(Math.random() * 89_999_999)
  return `${n}${LETRAS_DNI[n % 23]}`
}

/** Unas letras al azar: el apellido de la persona y el nombre del centro de este run. */
function marcaDelRun(): string {
  const l = 'bcdfghjklmnprstvz'
  let s = ''
  for (let i = 0; i < 6; i++) s += l[Math.floor(Math.random() * l.length)]
  return s
}

async function cuentaDe(s: Sesion): Promise<string> {
  const r = await rest<{ account_id: string }[]>(s, 'GET', `user_profiles?select=account_id&user_id=eq.${s.user.id}&active=eq.true`)
  expect(r.status, JSON.stringify(r.datos)).toBe(200)
  expect(r.datos.length, 'el administrador de la empresa sola no tiene perfil').toBeGreaterThan(0)
  return r.datos[0].account_id
}

/** La sesión de una persona dada de alta, con su usuario (el correo sintético que no ve). */
async function sesionDeUsuario(usuario: string, clave: string): Promise<Sesion> {
  const r = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${usuario}@empleado.folvy.app`, password: clave }),
  })
  if (!r.ok) throw new Error(`No se pudo entrar como ${usuario}: HTTP ${r.status}`)
  return await r.json() as Sesion
}

test.beforeAll(async () => {
  // Laboral encendido para la empresa sola de ESTE carril, como la plataforma.
  const sola = await pedirSesion(SOLA)
  const cuenta = await cuentaDe(sola)
  const plataforma = await pedirSesion(PLATAFORMA)
  // Cada proceso (ordenador y móvil) lo enciende: el segundo pisa al primero (merge-duplicates), no choca.
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: {
      apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ account_id: cuenta, feature_key: 'conta_laboral', enabled: true, source: 'manual_grant', grant_reason: 'e2e LS1 (carril)' }),
  })
  expect([200, 201, 204], `encender conta_laboral: HTTP ${r.status} ${await r.text()}`).toContain(r.status)
})

async function portalDeLaPersona(browser: Browser) {
  // El portal, siempre en el móvil: es donde ficha la persona.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    geolocation: SOL, permissions: ['geolocation'], locale: 'es-ES', timezoneId: 'Europe/Madrid',
  })
  const page = await ctx.newPage()
  await conMarcaSumied(page)
  return { ctx, page }
}

test('de cero: un centro, una persona, fichar desde el portal, corregir en «Para revisar» y el informe', async ({ page, browser }) => {
  test.setTimeout(6 * 60_000)
  const errores = vigilar(page)
  const run = marcaDelRun()
  // Ordenador y móvil corren a la vez en el mismo carril: cada uno con su nombre de pila,
  // porque «Para revisar» nombra a cada persona por él.
  const pila = test.info().project.name === 'movil' ? 'Marta' : 'Lucía'
  const nombre = `${pila} Prueba${run}`
  const centro = `Oficina ${run}`
  const hace2 = diaDeHace(2)
  const hace1 = diaDeHace(1)

  await conMarcaSumied(page)
  const sola = await entrarComo(page, SOLA)

  // 1 · El centro de trabajo, con su ubicación y su radio.
  await page.goto('/conta/laboral/centros', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="laboral-centros"]')).toBeVisible({ timeout: 30_000 })
  await captura(page, '01-centros')
  await page.locator('[data-prueba="centro-nuevo"]').click()
  await page.locator('[data-prueba="centro-nombre"]').fill(centro)
  await page.locator('[data-prueba="centro-direccion"]').fill('Puerta del Sol, 1, Madrid')
  await page.locator('[data-prueba="centro-lat"]').fill(String(SOL.latitude))
  await page.locator('[data-prueba="centro-lng"]').fill(String(SOL.longitude))
  await captura(page, '02-centro-nuevo')
  await page.locator('[data-prueba="centro-guardar"]').click()
  await expect(page.locator('[data-prueba="centro-hecho"]')).toContainText(`Dado de alta: ${centro}, con ubicación y un radio de 200 m`, { timeout: 20_000 })
  await expect(page.locator('[data-prueba="centro"]').filter({ hasText: centro })).toContainText('Ubicación puesta · radio 200 m')
  await captura(page, '03-centro-hecho')

  // 2 · El alta corta de la persona, con su acceso al portal.
  await page.goto('/conta/laboral', { timeout: 30_000 })
  await page.locator('[data-prueba="equipo-alta"]').click()
  await page.locator('[data-prueba="alta-nombre"]').fill(nombre)
  await page.locator('[data-prueba="alta-dni"]').fill(dniAlAzar())
  await page.locator('[data-prueba="alta-telefono"]').fill('600123456')
  await page.locator('[data-prueba="alta-puesto"]').fill('Administración')
  await page.locator('[data-prueba="alta-centro"]').selectOption({ label: centro })
  await page.locator('[data-prueba="alta-jornada"]').fill('40')
  await captura(page, '04-alta')
  await page.locator('[data-prueba="alta-guardar"]').click()
  const credenciales = page.locator('[data-prueba="alta-credenciales"]')
  try {
    await expect(credenciales).toBeVisible({ timeout: 30_000 })
  } catch {
    throw new Error(`El alta no termina. La pantalla dice: ${await page.locator('[data-prueba="alta-error"]').textContent().catch(() => '(nada)')}`)
  }
  const usuario = (await page.locator('[data-prueba="alta-usuario"]').textContent())?.trim() ?? ''
  const clave = (await page.locator('[data-prueba="alta-contrasena"]').textContent())?.trim() ?? ''
  expect(usuario).toMatch(new RegExp(`^${pila === 'Marta' ? 'marta' : 'lucia'}\\.prueba${run}\\d*$`))
  await expect(page.locator('[data-prueba="alta-donde"]')).toContainText('/acceso')
  await captura(page, '05-alta-credenciales')
  await page.getByRole('button', { name: 'Hecho' }).click()

  const empleados = await rest<{ id: string }[]>(sola, 'GET', `employees?select=id&username=eq.${usuario}`)
  expect(empleados.datos.length, `la persona ${usuario} no está en employees`).toBe(1)
  const persona = empleados.datos[0].id

  // 3 · La persona entra en /acceso desde el móvil, con la marca Sumied, y ficha.
  const { ctx, page: movil } = await portalDeLaPersona(browser)
  const erroresMovil = vigilar(movil)
  await movil.goto('/acceso', { timeout: 30_000 })
  await expect(movil.getByText('Sumied', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  await captura(movil, '06-acceso')
  await movil.getByPlaceholder('tu.usuario').fill(usuario)
  await movil.locator('input[type="password"]').fill(clave)
  await movil.getByRole('button', { name: /Entrar/ }).click()
  const portada = movil.getByRole('button', { name: /^Fichar entrada/ })
  try {
    await expect(portada).toBeVisible({ timeout: 40_000 })
  } catch {
    const se = (await movil.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)
    throw new Error(`Después de «Entrar» en /acceso no sale la portada del trabajador. En ${movil.url()} se ve: ${se || '(nada)'} · Errores: ${erroresMovil.join(' | ') || 'ninguno'}`)
  }
  await expect(movil.locator('[data-marca-portal="sumied"]')).toBeVisible()
  await expect(movil.locator('body')).not.toContainText(/folvy|APPCC|Recepciones/i)
  await captura(movil, '07-portal')
  await portada.click()
  const boton = movil.getByRole('button', { name: /FICHAR ENTRADA/ })
  await expect(boton).toBeEnabled({ timeout: 30_000 })
  // Sin «local» (en Sumied es «centro»), sin contar la banda de staging («BUILD LOCAL»).
  const textoFichar = (await movil.locator('body').innerText()).replace(/BUILD LOCAL/g, '')
  expect(textoFichar).not.toMatch(/\blocal(es)?\b/i)
  await captura(movil, '08-fichar')
  await boton.click()
  const hecho = movil.locator('[data-prueba="fichaje-hecho"]')
  const confirmar = movil.getByRole('button', { name: /^(Fichar igualmente|Entendido, fichar|Sí, fichar ENTRADA)$/ })
  await expect(hecho.or(confirmar).first()).toBeVisible({ timeout: 30_000 })
  if (await confirmar.first().isVisible()) await confirmar.first().click()
  await expect(hecho).toContainText(centro, { timeout: 30_000 })
  await expect(movil.locator('[data-prueba="lo-que-se-guardo"]')).toContainText('del centro, dentro del radio')
  await captura(movil, '09-fichado')

  // Una entrada de hace dos días sin salida (se le olvidó): la pone el administrador.
  // Después de fichar hoy: con ella abierta, la portada diría «Fichar salida».
  const r0 = await rest(sola, 'POST', 'rpc/add_manual_clock_entry', {
    p_employee_id: persona, p_type: 'entrada', p_datetime: aLas(hace2, '09:00'),
    p_reason: 'Entrada en papel (prueba LS1)', p_actor_label: 'Administrador de la prueba', p_force: true,
  })
  expect(r0.status, `add_manual_clock_entry: ${JSON.stringify(r0.datos)}`).toBe(200)

  // La persona pide desde su portal que le pongan la entrada de ayer (se le olvidó).
  const yo = await sesionDeUsuario(usuario, clave)
  const pet = await rest(yo, 'POST', 'rpc/request_clock_correction', {
    p_employee_id: persona, p_requested_by_employee_id: persona, p_kind: 'add',
    p_reason: 'Se me olvidó fichar al llegar', p_proposed_type: 'entrada', p_proposed_datetime: aLas(hace1, '08:30'),
  })
  expect(pet.status, `request_clock_correction: ${JSON.stringify(pet.datos)}`).toBe(200)
  expect(erroresMovil, 'errores de la página en el portal').toEqual([])
  await ctx.close()

  // 4 · «Para revisar»: corregir la entrada sin salida ahí mismo y aprobar la
  // petición (en este orden: con la entrada de hace dos días aún abierta, la
  // base no deja añadir otra entrada detrás).
  await page.goto('/conta/laboral/para-revisar', { timeout: 30_000 })
  const peticion = page.locator('[data-prueba="peticion"]').filter({ hasText: nombre })
  await expect(peticion).toContainText('Añadir una entrada a las 08:30', { timeout: 30_000 })
  await expect(peticion).toContainText('Se me olvidó fichar al llegar')
  const caso = page.locator('[data-prueba="para-revisar-caso"]').filter({ hasText: 'Entró a las 09:00' }).filter({ hasText: pila })
  await expect(caso.first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '10-para-revisar')
  await caso.first().locator('[data-prueba="para-revisar-corregir"]').click()
  await page.locator('[data-prueba="corregir-hora"]').fill('17:00')
  await page.locator('[data-prueba="corregir-motivo"]').fill('No fichó la salida (prueba LS1)')
  await captura(page, '11-corregir')
  await page.locator('[data-prueba="corregir-guardar"]').click()
  await expect(page.locator('[data-prueba="revisar-hecho"]')).toContainText(`Corregido: ${nombre} sale a las 17:00`, { timeout: 20_000 })
  await captura(page, '12-corregido')
  await peticion.locator('[data-prueba="peticion-aprobar"]').click()
  await expect(page.locator('[data-prueba="revisar-hecho"]')).toContainText('Aprobada: añadir una entrada a las 08:30', { timeout: 20_000 })
  await captura(page, '12b-aprobada')

  // 5 · El informe para la Inspección, con la corrección a la vista, y su PDF.
  await page.goto(`/conta/laboral/registro-jornada?persona=${persona}&mes=${hace2.slice(0, 7)}`, { timeout: 30_000 })
  const informe = page.locator('[data-prueba="informe-jornada"]')
  await expect(informe).toBeVisible({ timeout: 30_000 })
  const fila = page.locator(`[data-prueba="informe-dia"][data-dia="${hace2}"]`)
  await expect(fila).toContainText('09:00')
  await expect(fila).toContainText('17:00')
  await expect(fila).toContainText('8 h')
  await expect(fila).toContainText('No fichó la salida (prueba LS1)')
  await captura(page, '13-informe')
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('[data-prueba="bajar-pdf"]').click()])
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
  await expect(page.locator('[data-prueba="registro-hecho"]')).toContainText('Descargado el PDF')

  expect(errores, 'errores de la página').toEqual([])
})

test('cada pantalla de Laboral abre sin errores, sin «Folvy» ni «local», y lo que falta dice cuándo llega', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const errores = vigilar(page)
  await conMarcaSumied(page)
  await entrarComo(page, SOLA)
  const conFolvy: string[] = []
  const conLocal: string[] = []

  for (const p of PANTALLAS) {
    await page.goto(`/conta/laboral${p ? `/${p}` : ''}`, { timeout: 30_000 })
    const raiz = page.locator(`[data-laboral-pagina="${p || 'equipo'}"]`)
    await expect(raiz, `la pantalla «${p || 'equipo'}» no abre`).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
    await expect(page.getByText('Cargando…', { exact: true })).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined)
    const texto = await page.locator('body').innerText()
    for (const linea of texto.split('\n')) {
      if (/folvy/i.test(linea)) conFolvy.push(`${p || 'equipo'}: ${linea.trim().slice(0, 120)}`)
    }
    for (const linea of (await raiz.innerText()).split('\n')) {
      if (/\blocal(es)?\b/i.test(linea)) conLocal.push(`${p || 'equipo'}: ${linea.trim().slice(0, 120)}`)
    }
    await captura(page, `pantalla-${p || 'equipo'}`)
  }

  for (const [que, cuando] of LLEGA) {
    await page.goto(`/conta/laboral/llega/${que}`, { timeout: 30_000 })
    await expect(page.locator('[data-prueba="laboral-llega"]')).toContainText(`Llega en ${cuando}`, { timeout: 30_000 })
    await captura(page, `llega-${que}`)
  }

  expect(conFolvy, '«Folvy» a la vista en Sumied').toEqual([])
  expect(conLocal, '«local» en Sumied (tiene que decir «centro»)').toEqual([])
  expect(errores, 'errores de la página').toEqual([])
})
