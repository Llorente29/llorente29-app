// tests/e2e/conta/gp/portal-punta-a-punta.spec.ts
//
// GP · Tarea 5 (Julio, nº 15: «la e2e en staging con las respuestas
// simuladas») · EL PORTAL DE PUNTA A PUNTA, en el ordenador y en el móvil:
//
//   1. La gestoría, en la ficha del cliente, pestaña «Portal»: «Invitar al
//      portal» a Tomás Ruiz. Lo dice en pantalla (regla 8).
//   2. Tomás entra con el enlace del correo (?token_hash), ve su recibo
//      devuelto y el próximo, y paga el devuelto con tarjeta. Al volver de la
//      página de pago, el portal pregunta cómo ha ido (seguir) y enseña la frase
//      de Code 1 tal cual: el pago ya está apuntado en la contabilidad de la
//      gestoría. El devuelto deja de salir.
//
// Por qué simulada (nº 15): staging solo tiene la base, sin el login de
// Supabase ni las funciones con el sandbox de GoCardless y la clave de pruebas
// de Stripe. La gestoría entra en staging con la cuenta de prueba de verdad; lo
// que leen las pantallas de G04 sale de su siembra inventada
// (tests/e2e/conta/g04/siembra.ts) y lo del portal, de la de aquí. La prueba de
// verdad la hace Claude en la demo, desde el Chrome de Julio, con capturas.
// Todo inventado (T11). Las fechas, alrededor de hoy: el devuelto es el recibo
// de este mes, el próximo es el del que viene y la última factura es la del
// pasado (ninguna fecha se repite para dos cosas distintas, nº 11).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, STAGING_URL, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { FRASES, pantallas, siembra } from '../g04/siembra'

const DIR = 'docs/conta/capturas/gp/punta-a-punta'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']
const CORREO = 'tomas.ruiz@talleresruiz.example'
const OPERACION = '0000aaaa-0000-4000-8000-0000000005a1'
const json = (r: Route, cuerpo: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })

// ── Las fechas, de hoy (Madrid) ──────────────────────────────────────────────
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
function mes(delta: number): string {
  const [a, m] = hoy().split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
const diaDe = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`
const haceDias = (n: number) => { const x = new Date(`${hoy()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString() }

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── 1 · La gestoría ──────────────────────────────────────────────────────────

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

/** Lo que leen las pantallas de G04 (su siembra) y la pestaña «Portal» (la de aquí), simulado. */
async function simularGestoria(page: Page, Q: string, A: string) {
  const datos: Record<string, unknown[]> = { ...siembra(Q, A), conta_portal_ajustes: [{ pagar_devuelto: ['banco', 'tarjeta'] }] }
  const llamadas: { f: string; cuerpo: Record<string, unknown> }[] = []
  let invitado = false
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
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
    return json(r, nombre === 'conta_portal_ajustes' ? datos[nombre][0] : datos[nombre])
  })
  const LECTURAS = pantallas(datos as ReturnType<typeof siembra>)
  const acceso = () => ({ id: 'acc-1', correo: CORREO, nombre: 'Tomás Ruiz', permiso: 'todo', invitado_at: new Date().toISOString(), invitado_por_name: 'Persona de Prueba', revocado_at: null })
  const PORTAL: Record<string, () => unknown> = {
    conta_portal_ficha: () => ({
      accesos: invitado ? [acceso()] : [],
      mensajes: [{ id: 'm1', de: 'cliente', autor: 'Tomás Ruiz', texto: '¿Me podéis mandar el modelo 303 del trimestre?', adjuntos: [], cuando: haceDias(1), leido: haceDias(1) }],
      peticiones: [{ id: 'q1', tipo: 'subir', titulo: 'Facturas de gasto del mes', detalle: null, fecha_limite: diaDe(mes(1), 10), estado: 'pendiente', created_at: haceDias(2), hecha_at: null, hecha_por_name: null, respuesta: null, creada_por_name: 'Persona de Prueba' }],
      incidencias: [], solicitudes: [], subidas: [],
    }),
    conta_portal_pendiente: () => ({ mensajes: [], incidencias: [], solicitudes: [], subidas: [] }),
  }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f in PORTAL) return json(r, PORTAL[f]())
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (!(f in FRASES)) return r.fallback()
    llamadas.push({ f, cuerpo })
    return json(r, FRASES[f](cuerpo))
  })
  // El servidor del portal (conta-portal): la invitación. Nunca sale un correo de verdad.
  await page.route(/\/functions\/v1\/conta-portal$/, (r) => {
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    llamadas.push({ f: `conta-portal:${String(cuerpo.accion)}`, cuerpo })
    if (cuerpo.accion !== 'invitar') return json(r, { ok: false, frase: 'No simulado.' })
    invitado = true
    return json(r, { ok: true, id: 'acc-1', enviado: true, frase: `Invitada ${CORREO}. Le llega un correo con el enlace para entrar. En la demo, el correo va al buzón de pruebas.` })
  })
  return llamadas
}

test('La gestoría invita a Tomás Ruiz desde la pestaña «Portal» de la ficha, y lo dice', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  const [Q, A] = await empresas(s)
  const llamadas = await simularGestoria(page, Q, A)
  await page.goto(`/conta/ventas/clientes-y-cuotas/cliente/c8?empresa=${Q}&pestana=portal`)
  await expect(page.getByRole('heading', { level: 1, name: 'Transportes de Ejemplo, S.L.' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tab', { name: 'Portal' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Quién entra en su portal' })).toBeVisible()
  await expect(page.getByText(/Nadie de Transportes de Ejemplo, S\.L\. entra todavía/)).toBeVisible()
  await expect(page.getByText('Pagar con tarjeta o Bizum')).toBeVisible()

  await page.getByRole('button', { name: 'Invitar al portal' }).click()
  await page.getByLabel('Correo').fill(CORREO)
  await page.getByLabel('Nombre (opcional)').fill('Tomás Ruiz')
  await page.getByRole('button', { name: 'Mandar la invitación' }).click()
  // Por su texto: en staging, la franja «BUILD LOCAL · NO ES PRODUCCIÓN» también es un role=status.
  await expect(page.getByText(`Invitada ${CORREO}. Le llega un correo con el enlace para entrar.`, { exact: false })).toBeVisible()
  await expect(page.getByText('Tomás Ruiz', { exact: true })).toBeVisible()
  const inv = llamadas.find((l) => l.f === 'conta-portal:invitar')
  expect(inv?.cuerpo).toMatchObject({ accion: 'invitar', cliente: 'c8', correo: CORREO, nombre: 'Tomás Ruiz', permiso: 'todo' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/1-gestoria-invita-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

// ── 2 · Tomás, en su portal ──────────────────────────────────────────────────

const C = '0000cccc-0000-4000-8000-0000000005a1'
const marca = { nombre: 'Gestoría de Prueba Norte, S.L.', logo_ruta: null, color: '#172443', correo: 'hola@gestoria.example', telefono: null, empresa_id: '0000aaaa-0000-4000-8000-000000000001' }
const lineas = [{ texto: 'Gestoría mensual · Estándar', importeCent: 6050 }, { texto: 'Gestión laboral · 4 trabajadores', importeCent: 9680 }]

/** Lo que lee el portal de Tomás. Antes de pagar, con el devuelto de este mes; después, sin él. */
function lecturas(pagado: boolean): Record<string, unknown> {
  const devueltos = pagado ? [] : [{ recibo_id: 'r-este', mes: mes(0), importe_cent: 15730, devuelto_el: haceDias(2), gc_estado: 'failed', en_marcha: null }]
  const proximo = { recibo_id: 'r-siguiente', mes: mes(1), estado: 'preparado', estado_texto: 'Próximo', total_cent: 17666, anterior_cent: 15730, lineas: [...lineas, { texto: 'Gestión laboral · 1 trabajador más', importeCent: 1936 }],
    cambios: [{ texto: '+1 trabajador' }], cargo_el: diaDe(mes(1), 4), parado: [], incidencia: null, cuenta_final: '0000', cuenta_pais: 'ES' }
  return {
    conta_portal_entrada: { clientes: [{ cliente_id: C, cliente: 'Talleres Ruiz, S.L.', permiso: 'todo', gestoria: marca }] },
    conta_portal_inicio: {
      gestoria: marca, cliente: { id: C, nombre: 'Talleres Ruiz, S.L.', nif: 'B00000000' }, yo: { nombre: 'Tomás Ruiz', correo: CORREO, permiso: 'todo' },
      peticiones: [], proximo, devueltos, pagar_devuelto: ['banco', 'tarjeta'], mensajes_sin_leer: 0, puede_subir: true,
      novedades: [{ tipo: 'factura', id: 'f-pasado', titulo: `Factura 2026/1/0${mes(-1).slice(5)}`, total: 157.3, cuando: `${diaDe(mes(-1), 4)}T00:00:00Z` }],
    },
    conta_portal_mensajes_leidos: 0,
  }
}

async function simularPortal(page: Page) {
  const estado = { pagado: false, llamadas: [] as Record<string, unknown>[] }
  // Sin sesión al empezar (entra con el enlace); la vuelta del pago recarga la página y la conserva.
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('e2e-empezado')) { localStorage.removeItem('sumied-portal'); sessionStorage.setItem('e2e-empezado', '1') } } catch { /* sin almacenamiento */ }
  })
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort())
  // El enlace del correo: Supabase canjea el token_hash por la sesión de Tomás.
  await page.route(`${STAGING_URL}/auth/v1/verify**`, (r) => json(r, {
    access_token: 'e2e.portal.tomas', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'e2e-refresco',
    user: { id: '0000dddd-0000-4000-8000-0000000005a1', aud: 'authenticated', role: 'authenticated', email: CORREO, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }))
  await page.route(`${STAGING_URL}/auth/v1/user**`, (r) => json(r, { id: '0000dddd-0000-4000-8000-0000000005a1', aud: 'authenticated', role: 'authenticated', email: CORREO, app_metadata: {}, user_metadata: {} }))
  await page.route(`${STAGING_URL}/rest/v1/rpc/**`, (r) => {
    const f = new URL(r.request().url()).pathname.split('/').pop()!
    const d = lecturas(estado.pagado)
    return f in d ? json(r, d[f]) : json(r, { message: `no simulado: ${f}` }, 404)
  })
  // El servidor del portal: «Pagar con tarjeta» lleva a la página de pago (aquí, de vuelta al portal con ?vuelta),
  // y «seguir» dice cómo ha ido, con la frase de Code 1 (conta_recibo_pagado_portal), tal cual.
  await page.route(`${STAGING_URL}/functions/v1/conta-portal`, (r) => {
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    estado.llamadas.push(cuerpo)
    if (cuerpo.accion === 'tarjeta') return json(r, { ok: true, operacion: OPERACION, url: `/portal.html?vuelta=${OPERACION}#inicio`, frase: 'Te llevamos a la página de pago.' })
    if (cuerpo.accion === 'seguir') {
      estado.pagado = true
      return json(r, { ok: true, estado: 'hecha', frase: `Apuntado: el recibo de ${mes(0)} se ha pagado con tarjeta desde el portal; su factura y su cobro ya están en la contabilidad.` })
    }
    return json(r, { ok: false, frase: 'No simulado.' })
  })
  return estado
}

test('Tomás entra con el enlace, ve su recibo devuelto y lo paga con tarjeta; la gestoría ya lo tiene apuntado', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const estado = await simularPortal(page)
  // El enlace del correo, como llega al buzón de pruebas.
  await page.goto('/portal.html?token_hash=e2e-enlace&type=magiclink')
  await expect(page.getByText('Talleres Ruiz, S.L.').first()).toBeVisible({ timeout: 30_000 })
  // Su recibo devuelto, el próximo (con la cuenta de cargo) y la última factura, cada uno con su fecha.
  await expect(page.getByText(/no se ha podido cobrar|devuelto/i).first()).toBeVisible()
  await expect(page.getByText(/De tu cuenta ES•• •••• •••• •••• •••• 0000/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Pagar ahora desde tu banco/ })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/2-portal-con-devuelto-${lado(page)}.png`, fullPage: true })

  await page.getByRole('button', { name: /Pagar con tarjeta o Bizum/ }).click()
  // Vuelve de la página de pago: el portal pregunta cómo ha ido y lo dice (regla 8), con la frase de Code 1.
  await expect(page.getByText(/Apuntado: el recibo de .* se ha pagado con tarjeta desde el portal/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Pagar con tarjeta o Bizum/ })).toHaveCount(0)
  expect(estado.llamadas.map((l) => l.accion)).toEqual(['tarjeta', 'seguir'])
  expect(estado.llamadas[0]).toMatchObject({ cliente: C, recibo: 'r-este' })
  expect(estado.llamadas[1]).toMatchObject({ operacion: OPERACION })
  await page.screenshot({ path: `${DIR}/3-portal-pagado-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
