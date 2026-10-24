/// <reference lib="dom" />
// tests/e2e/conta/c03/terceros.spec.ts
//
// C03 · Clientes, plataformas y socios de marca, contra staging-conta, en
// ordenador (1440) y móvil (390), con las capturas junto a las maquetas
// (docs/conta/capturas/c03/, COMPARACION.md, frente a N9Cliente y N10Socio).
//
// Datos: supabase/seeds/conta/seed_c03_staging.sql (todo inventado): en la
// cuenta A, Plataforma Norte (plataforma + proveedor + cliente, cuatro
// liquidaciones, una «con diferencia»), Marcas del Sur (socio de marca con dos
// locales; octubre sale 6.887 €), Catering Eventos Norte (cliente normal) y
// Distribuciones Antiguas (archivado).
//
// Lo que escribe (subir liquidación, confirmar la del socio, alta, archivar)
// se hace en UN tamaño y se deshace al acabar por la API, con la sesión del
// usuario (la misma RLS que la pantalla). Las capturas se toman ANTES de
// escribir nada, para que salgan siempre iguales.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo, pedirSesion, type Sesion, enCarril } from '../sesion'
import { borrarProveedor, cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c03'
const CATERING = enCarril('c0300000-0000-4000-8000-000000000011')
const FIXTURE_GLOVO = 'tests/conta/fixtures/liquidaciones/glovo.csv'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
// La semilla es de octubre de 2026: las cifras del mes solo se comprueban ese mes.
const enOctubre = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()).startsWith('2026-10')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

/** C06b (respuesta 6): la barra de la IA ya no se enseña (solo diría «Muy pronto»); el ejemplo de cada pantalla queda para cuando vuelva. */
async function sinBarra(page: Page) {
  await expect(page.locator('.cx-pregunta')).toHaveCount(0)
}

async function partyDe(s: Sesion, nombre: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'GET', `party?select=id&account_id=eq.${CUENTA_A.id}&name=eq.${encodeURIComponent(nombre)}`)
  expect(r.datos?.length, `la semilla tiene a ${nombre} en la cuenta A`).toBe(1)
  return r.datos[0].id
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

test('lista de clientes y proveedores: papeles, filtros y archivados', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/clientes-y-proveedores')
  // S01 · paso 3: Contactos, con sus papeles (Plataformas y Socios, con hostelería: A lo es).
  // S02: los papeles ya no son pestañas de la cabecera: son las páginas de Contactos, debajo del
  // apartado en la barra; en el móvil, la barra va en el cajón y hay que abrirlo (al elegir una
  // página se cierra solo).
  await expect(page.getByRole('heading', { level: 1, name: 'Contactos' })).toHaveCount(1)
  const papeles = page.getByRole('navigation', { name: 'Menú de contabilidad' }).getByRole('list', { name: 'Páginas de Contactos' })
  const abrirMenu = async () => { if (lado(page) === 'movil') await page.getByRole('button', { name: 'Abrir el menú' }).click() }
  await abrirMenu()
  // Por su nombre (.s-barra-nombre): «Todos» puede llevar al lado su contador, que no es parte del nombre.
  await expect(papeles.locator('.s-barra-nombre')).toHaveText(['Todos', 'Clientes', 'Proveedores', 'Plataformas', 'Socios de marca'])
  await expect(papeles.getByRole('link', { name: 'Todos', exact: true })).toHaveAttribute('aria-current', 'page')
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Cerrar el menú' }).click()
  const plataforma = page.getByRole('link', { name: /Plataforma Norte/ })
  await expect(plataforma).toBeVisible()
  await expect(page.getByRole('link', { name: /Marcas del Sur/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Catering Eventos Norte/ })).toBeVisible()
  // Regla 7: el archivado no sale en «Todos», sale en su filtro.
  await expect(page.getByRole('link', { name: /Distribuciones Antiguas/ })).toHaveCount(0)
  await capturar(page, 'lista')
  await abrirMenu()
  await papeles.getByRole('link', { name: 'Plataformas', exact: true }).click()
  await expect(page).toHaveURL(/[?&]ver=plataformas(&|$)/)
  await abrirMenu()
  await expect(papeles.getByRole('link', { name: 'Plataformas', exact: true })).toHaveAttribute('aria-current', 'page')
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Cerrar el menú' }).click()
  await expect(page.getByRole('link', { name: /Plataforma Norte/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Catering Eventos Norte/ })).toHaveCount(0)
  await page.getByRole('button', { name: /^Archivados · \d+$/ }).click()
  await expect(page.getByRole('link', { name: /Distribuciones Antiguas/ })).toBeVisible()
  await expect(page.getByText(/histórico de 2024/).first()).toBeVisible()
  // Buscar por NIF.
  await abrirMenu()
  await papeles.getByRole('link', { name: 'Todos', exact: true }).click()
  await page.getByLabel('Buscar por nombre o NIF').fill('B91030023')
  await expect(page.getByRole('link', { name: /Marcas del Sur/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Plataforma Norte/ })).toHaveCount(0)
})

test('plataforma (N9): te debe, liquidaciones con diferencia y lo aprendido', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const id = await partyDe(s, 'Plataforma Norte')
  await page.goto(`/conta/clientes-y-proveedores/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Plataforma Norte' })).toBeVisible()
  if (lado(page) === 'ordenador') {
    await expect(page.getByText('Plataforma de reparto')).toBeVisible()
    await expect(page.getByText('Liquida cada 15 días')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subir liquidación' })).toBeVisible()
    await expect(page.getByText('Te debe', { exact: true })).toBeVisible()
    // La de agosto llegó con 212,30 € de menos: no se cuadra sola (regla 3).
    await expect(page.getByText(/faltan 212,30 € en el banco/).first()).toBeVisible()
    await expect(page.getByText('Con diferencia').first()).toBeVisible()
    await expect(page.getByLabel('Lo que he aprendido de este cliente')).toBeVisible()
    await expect(page.getByLabel('Sus cuentas')).toBeVisible()
    await sinBarra(page)
  } else {
    await expect(page.getByRole('button', { name: 'Subir liquidación' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Liquidaciones/ })).toBeVisible()
  }
  await capturar(page, 'plataforma')
  if (lado(page) === 'movil') {
    await page.getByRole('link', { name: /Liquidaciones/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible()
    await expect(page.getByText(/faltan 212,30 € en el banco/).first()).toBeVisible()
    await capturar(page, 'plataforma-liquidaciones')
  }
})

test('plataforma: subir la liquidación de Glovo con la fixture', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe en la base: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const id = await partyDe(s, 'Plataforma Norte')
  const borrar = () => rest(s, 'DELETE', `channel_settlement?account_id=eq.${CUENTA_A.id}&import_key=like.glovo:GL-*`)
  await borrar()
  try {
    await page.goto(`/conta/clientes-y-proveedores/${id}`)
    await page.getByRole('button', { name: 'Subir liquidación' }).click()
    await page.getByLabel('Fichero de liquidaciones').setInputFiles(FIXTURE_GLOVO)
    await expect(page.getByText(/^\d+ liquidaciones de Glovo$/)).toBeVisible()
    await page.getByRole('button', { name: 'Subir', exact: true }).click()
    // Regla 8: dice lo que ha subido.
    await expect(page.getByText(/^Subidas de «glovo\.csv»: \d+ liquidaciones nuevas\.$/)).toBeVisible()
    // Volver a subir el mismo fichero no duplica: actualiza.
    await page.getByRole('button', { name: 'Subir liquidación' }).click()
    await page.getByLabel('Fichero de liquidaciones').setInputFiles(FIXTURE_GLOVO)
    await page.getByRole('button', { name: 'Subir', exact: true }).click()
    await expect(page.getByText(/^Subidas de «glovo\.csv»: 0 liquidaciones nuevas y \d+ que ya estaban \(actualizadas\)\.$/)).toBeVisible()
  } finally {
    const b = await borrar()
    expect(b.status, 'se borran las liquidaciones subidas').toBeLessThan(300)
  }
})

test('socio de marca (N10): el mes por local y «Preparar liquidación»', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const id = await partyDe(s, 'Marcas del Sur')
  await page.goto(`/conta/clientes-y-proveedores/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Marcas del Sur' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Preparar liquidación de / })).toBeVisible()
  await sinBarra(page)
  if (enOctubre()) {
    // 6.420 − 1.180 + 1.647 = 6.887 € a su favor (4.090 en Norte Centro y 2.797 en Norte Mercado).
    await expect(page.getByText('6.887 €').first()).toBeVisible()
    if (lado(page) === 'ordenador') {
      await expect(page.getByText('6.887,00 € a su favor')).toBeVisible()
      await expect(page.getByText(/Norte Centro · 3\.800,00 € − 700,00 € \+ 990,00 €/)).toBeVisible()
      await expect(page.getByText(/Norte Mercado · 2\.620,00 € − 480,00 € \+ 657,00 €/)).toBeVisible()
    }
  }
  if (lado(page) === 'ordenador') await expect(page.getByLabel('Liquidaciones anteriores')).toBeVisible()
  await capturar(page, 'socio')
})

// Los dos locales de la semilla (cuenta A).
test('plataforma: el 347 según su contrato (respuesta 2) — sin decir pregunta; dicho, lo aplica', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe en la base: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const id = await partyDe(s, 'Plataforma Norte')
  const modelo = async () => (await rest<{ platform_model: string | null }[]>(s, 'GET',
    `party_role?select=platform_model&account_id=eq.${CUENTA_A.id}&party_id=eq.${id}&role=eq.platform`)).datos?.[0]?.platform_model
  const sinDecir = () => rest(s, 'PATCH', `party_role?account_id=eq.${CUENTA_A.id}&party_id=eq.${id}&role=eq.platform`, { platform_model: null })
  expect(await modelo(), 'la semilla no dice cómo vende Plataforma Norte').toBeNull()
  try {
    await page.goto(`/conta/clientes-y-proveedores/${id}`)
    const cuentas = page.getByLabel('Sus cuentas')
    // Sin fuente, no asume: lo pregunta, con la norma en pequeño.
    await expect(cuentas.getByText('Según su contrato: comisionista o revendedor. ¿Cuál es?')).toBeVisible()
    await expect(cuentas.getByText(/RD 1065\/2007, art\. 34\.3/)).toBeVisible()
    await cuentas.getByRole('button', { name: 'Vende en mi nombre (comisionista)' }).click()
    // Regla 8: lo confirma en pantalla, con lo que significa.
    await expect(cuentas.getByText(/347 como proveedor.*tus ventas no/i)).toBeVisible()
    await expect(cuentas.getByText(/art\. 33\.2\.a/)).toBeVisible()
    await expect.poll(modelo).toBe('comisionista')
    await cuentas.getByRole('button', { name: 'Cambiar' }).click()
    await expect(cuentas.getByRole('button', { name: 'Me compra y revende' })).toBeVisible()
    await expect.poll(modelo).toBeNull()
    await cuentas.getByRole('button', { name: 'Me compra y revende' }).click()
    await expect(cuentas.getByText(/347 de ventas/)).toBeVisible()
    await expect.poll(modelo).toBe('revendedor')
  } finally {
    const b = await sinDecir()
    expect(b.status, 'Plataforma Norte vuelve a «sin decir»').toBeLessThan(300)
  }
})

const LOCALES = [
  { id: enCarril('c01a0000-0000-4000-8000-0000000000a2'), nombre: 'Norte Centro' },
  { id: enCarril('e0200000-0000-4000-8000-0000000000a3'), nombre: 'Norte Mercado' },
]

test('socio de marca: preparar, lo que no se cierra dice por qué, y confirmar la de un local', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe en la base: solo en un tamaño')
  test.skip(!enOctubre(), 'La semilla del socio es de octubre de 2026')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const id = await partyDe(s, 'Marcas del Sur')
  const borrar = () => rest(s, 'DELETE', `licensed_settlement?account_id=eq.${CUENTA_A.id}&party_id=eq.${id}&period_from=eq.2026-10-01&formula=eq.compras_aportaciones_comision`)
  // Lo que espera la prueba lo dice la BASE, no la semilla (regla 31): en
  // staging hay más ventas que las de la semilla (06/10: una de Last.app sin
  // base imponible en Norte Centro, de la semilla del R02), y entonces ese
  // local no se cierra.
  const calculo = await Promise.all(LOCALES.map(async (l) => {
    const r = await rest<{ importe: number; faltan: { texto: string }[] }>(s, 'POST', 'rpc/brand_partner_settlement_compute',
      { p_party: id, p_location: l.id, p_desde: '2026-10-01', p_hasta: '2026-10-31' })
    expect(r.status, `la base calcula ${l.nombre}`).toBe(200)
    return { ...l, importe: r.datos.importe, faltan: r.datos.faltan.map((f) => f.texto) }
  }))
  const cerrable = calculo.find((c) => c.faltan.length === 0)
  expect(cerrable, `algún local se puede cerrar: ${JSON.stringify(calculo)}`).toBeTruthy()
  const euros = (n: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(Math.abs(n)) + ' €'
  await borrar()
  try {
    await page.goto(`/conta/clientes-y-proveedores/${id}`)
    await page.getByRole('button', { name: 'Preparar liquidación de octubre' }).click()
    for (const c of calculo) {
      const zona = page.getByRole('region', { name: `Liquidación de ${c.nombre}` })
      await expect(zona.getByText(`${euros(c.importe)} a su favor`)).toBeVisible()
      const boton = zona.getByRole('button', { name: `Confirmar ${c.nombre}` })
      if (c.faltan.length) {
        // Regla 8 y la del encargo: no se cierra, y dice por qué con las palabras de la base.
        const aviso = zona.getByRole('status').filter({ hasText: 'No se puede cerrar' })
        for (const f of c.faltan) await expect(aviso).toContainText(f)
        await expect(boton).toBeDisabled()
      } else {
        await expect(boton).toBeEnabled()
      }
    }
    const zona = page.getByRole('region', { name: `Liquidación de ${cerrable!.nombre}` })
    await zona.getByRole('button', { name: `Confirmar ${cerrable!.nombre}` }).click()
    await expect(zona.getByText(`Confirmada la de ${cerrable!.nombre}: ${euros(cerrable!.importe)} a su favor.`)).toBeVisible()
    const r = await rest<{ status: string; amount: number; location_id: string }[]>(s, 'GET', `licensed_settlement?select=status,amount,location_id&account_id=eq.${CUENTA_A.id}&party_id=eq.${id}&period_from=eq.2026-10-01&formula=eq.compras_aportaciones_comision`)
    expect(r.datos).toEqual([{ status: 'confirmada', amount: cerrable!.importe, location_id: cerrable!.id }])
  } finally {
    const b = await borrar()
    expect(b.status, 'se borra la liquidación confirmada de prueba').toBeLessThan(300)
  }
})

test('cliente normal: sin facturas, lo dice; archivar y recuperar', async ({ page }, info) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/conta/clientes-y-proveedores/${CATERING}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Catering Eventos Norte' })).toBeVisible()
  await expect(page.getByText('Sus facturas, en Ventas › Facturas.')).toBeVisible()
  await sinBarra(page)
  await capturar(page, 'cliente')
  test.skip(info.project.name === 'movil', 'Archivar escribe en la base: solo en un tamaño')
  try {
    // S02: la fila de acciones del marco también puede llevar su «Más acciones» (sin «···»):
    // éste es el de la ficha, el de los tres puntos.
    await page.getByRole('button', { name: 'Más acciones', exact: true }).filter({ hasText: '···' }).click()
    await page.getByRole('menuitem', { name: 'Archivar' }).click()
    await page.getByLabel('Por qué (opcional)').fill('Prueba e2e')
    await page.getByRole('button', { name: 'Archivar', exact: true }).click()
    await expect(page.getByText('Catering Eventos Norte archivado. Ya no sale en las listas; está en «Archivados» con sus cuentas y su histórico.')).toBeVisible()
    await expect(page.getByRole('link', { name: /Catering Eventos Norte/ })).toHaveCount(0)
    await page.getByRole('button', { name: /^Archivados · \d+$/ }).click()
    await page.getByRole('link', { name: /Catering Eventos Norte/ }).click()
    await expect(page.getByText('Archivado · Prueba e2e.')).toBeVisible()
    await capturar(page, 'cliente-archivado')
    await page.getByRole('button', { name: 'Recuperar' }).click()
    await expect(page.getByText('Catering Eventos Norte recuperado: vuelve a salir en la lista.')).toBeVisible()
  } finally {
    // Pase lo que pase, Catering vuelve a estar sin archivar (la siguiente ejecución lo necesita así).
    const s = await pedirSesion(CUENTA_A.email)
    await rest(s, 'POST', 'rpc/party_set_archived', { p_party: CATERING, p_archivar: false, p_nota: null })
  }
})

test('alta de cliente con el NIF de un proveedor: una sola ficha con los dos papeles', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe en la base: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const nombre = `Proveedor C03 e2e ${Date.now()}`
  const nif = cifInventado()
  const p = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: nombre, tax_id: nif, tax_id_type: 'nif_es', country_code: 'ES' })
  expect(p.status, 'se crea el proveedor de prueba').toBe(201)
  try {
    await page.goto('/conta/clientes-y-proveedores')
    await page.getByRole('toolbar', { name: 'Acciones de Todos' }).getByRole('link', { name: /Nuevo cliente/ }).click()
    await page.getByLabel('Nombre con el que lo conocéis').fill('Otro nombre cualquiera')
    await page.getByLabel('NIF (opcional)').fill(nif)
    // Regla 1: un NIF, un tercero.
    await expect(page.getByText(`Es el mismo que tu proveedor ${nombre}: hacerlo también cliente.`)).toBeVisible()
    await page.getByRole('button', { name: 'Hacerlo también cliente' }).click()
    await expect(page.getByText(`${nombre} ya es también cliente: una sola ficha para las dos cosas.`)).toBeVisible()
    await expect(page).toHaveURL(/\/conta\/clientes-y-proveedores\/[0-9a-f-]+\/datos-fiscales$/)
    const roles = await rest<{ role: string }[]>(s, 'GET', `party_role?select=role,party!inner(name)&account_id=eq.${CUENTA_A.id}&party.name=eq.${encodeURIComponent(nombre)}&order=role`)
    expect(roles.datos.map((r) => r.role)).toEqual(['customer', 'supplier'])
  } finally {
    await borrarProveedor(s, p.datos[0].id)
    await rest(s, 'DELETE', `party?account_id=eq.${CUENTA_A.id}&name=eq.${encodeURIComponent(nombre)}`)
  }
})

// S01d: «Nuevo proveedor» desde Contactos (S02: la fila de acciones, antes la cinta; ?nuevo=proveedor): se queda en la lista,
// lo dice con su nombre (regla 8) y lo enseña buscándolo por su NIF.
test('S01d · alta de proveedor desde Contactos: lo confirma y sale en la lista', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe en la base: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const nombre = `Proveedor S01d e2e ${Date.now()}`
  const nif = cifInventado()
  try {
    await page.goto('/conta/clientes-y-proveedores')
    await page.getByRole('toolbar', { name: 'Acciones de Todos' }).getByRole('link', { name: /Nuevo proveedor/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo proveedor' })
    await dialogo.getByLabel('Nombre con el que lo conocéis').fill(nombre)
    await dialogo.getByLabel('NIF (opcional)').fill(nif)
    await dialogo.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(page.getByText(`Proveedor ${nombre} dado de alta. Ya puedes subir sus facturas.`)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Nuevo proveedor' })).toHaveCount(0)
    await expect(page.getByLabel('Buscar por nombre o NIF')).toHaveValue(nif)
    await expect(page.getByRole('link', { name: new RegExp(nombre) })).toBeVisible()
    const roles = await rest<{ role: string }[]>(s, 'GET', `party_role?select=role,party!inner(name)&account_id=eq.${CUENTA_A.id}&party.name=eq.${encodeURIComponent(nombre)}`)
    expect(roles.datos.map((r) => r.role)).toEqual(['supplier'])
  } finally {
    const p = await rest<{ id: string }[]>(s, 'GET', `supplier?select=id&account_id=eq.${CUENTA_A.id}&name=eq.${encodeURIComponent(nombre)}`)
    for (const x of p.datos ?? []) await borrarProveedor(s, x.id)
    await rest(s, 'DELETE', `party?account_id=eq.${CUENTA_A.id}&name=eq.${encodeURIComponent(nombre)}`)
  }
})

test('RLS: la cuenta B no ve los terceros de A', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Solo API')
  const b = await entrarComo(page, CUENTA_B.email)
  for (const t of ['party', 'party_role', 'customer_fiscal', 'brand_partner_contribution']) {
    const r = await rest<unknown[]>(b, 'GET', `${t}?select=account_id&account_id=eq.${CUENTA_A.id}`)
    expect(r.datos, `B no lee ${t} de A`).toEqual([])
  }
  const l = await rest<unknown[]>(b, 'GET', `channel_settlement?select=id&account_id=eq.${CUENTA_A.id}`)
  expect(l.datos, 'B no lee liquidaciones de A').toEqual([])
  const w = await rest<unknown>(b, 'POST', 'party', { account_id: CUENTA_A.id, name: 'Intruso', source: 'manual' })
  expect(w.status, 'B no escribe terceros en A').toBeGreaterThanOrEqual(400)
  const rpc = await rest<unknown>(b, 'POST', 'rpc/party_set_archived', { p_party: CATERING, p_archivar: true, p_nota: 'intruso' })
  expect(rpc.status, 'B no archiva un tercero de A').toBeGreaterThanOrEqual(400)
})
