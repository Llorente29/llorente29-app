/// <reference lib="dom" />
// tests/e2e/laboral/lab1-importar.spec.ts
//
// LAB1 (29/10/2026) · Tanda 1 del importador del historial de Cegid: Sumied ›
// Laboral › Importar historial, «solo leer las cabeceras», con «Empresa de
// Prueba Sola» del carril, en ordenador (1440) y en móvil (390).
//
//   1. Un paquete INVENTADO con las nueve hojas y sus cabeceras reales (las de
//      Julio, 29/10) y valores de mentira: todas «Como se esperaba», el botón
//      dice cuántas hojas y filas ha leído, y el lote sale en la lista. Ningún
//      valor llega a la base: se mira el lote por la API.
//   2. El mismo fichero otra vez: lo reconoce, no hace otro lote.
//   3. Un paquete al que le falta una columna y le sobra una hoja: la tabla lo
//      enseña todo (regla 7).
//
// El Excel se genera aquí: ningún dato real en el repositorio. Todo lo que se
// crea es de la cuenta del carril y se borra con ella.

import * as XLSX from 'xlsx'
import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, correoDePrueba, correoDelCarril, entrarComo, pedirSesion, type Sesion } from '../conta/sesion'
import { rest } from '../conta/api'
import { HOJAS_CEGID } from '../../../src/modules/conta/laboral/importar/cegidCabeceras'

const SOLA = correoDelCarril('sola.admin@c06-prueba.test')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')

async function cuentaDe(s: Sesion): Promise<string> {
  const r = await rest<{ account_id: string }[]>(s, 'GET', `user_profiles?select=account_id&user_id=eq.${s.user.id}&active=eq.true`)
  expect(r.status, JSON.stringify(r.datos)).toBe(200)
  expect(r.datos.length, 'el administrador de la empresa sola no tiene perfil').toBeGreaterThan(0)
  return r.datos[0].account_id
}

/** Un paquete como el de Cegid, con valores de mentira. `marca` hace que cada run tenga su propio fichero (su huella). */
function paquete(marca: string, cambiar?: (libro: XLSX.WorkBook) => void): Buffer {
  const libro = XLSX.utils.book_new()
  // Como el paquete de verdad (N1 · respuesta 2): una portada LEEME, y las hojas
  // «campo · valor» con su fila «campo | valor» y su «Centro de trabajo 1».
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Paquete inventado'], ['Empresa', `Empresa Inventada ${marca}`]]), 'LEEME')
  for (const h of HOJAS_CEGID) {
    const campos = [...h.columnas, ...(h.numerados ?? []).map((b) => `${b} 1`)]
    const datos = h.clase === 'campo_valor'
      ? [['campo', 'valor'], ...campos.map((c, i) => [c, `VALOR INVENTADO ${marca} ${i}`])]
      : [[...h.columnas], ...[1, 2, 3].map((n) => h.columnas.map((_c, i) => `inventado ${marca} ${n}-${i}`))]
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), h.nombre)
  }
  cambiar?.(libro)
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

async function leer(page: Page, nombre: string, bytes: Buffer) {
  await page.locator('[data-prueba="importar-fichero"]').setInputFiles({
    name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes,
  })
  await page.locator('[data-prueba="importar-leer"]').click()
  await expect(page.locator('[data-prueba="importar-hecho"], [data-prueba="importar-error"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="importar-error"]')).toHaveCount(0)
}

test.beforeAll(async () => {
  // Laboral encendido para la empresa sola de ESTE carril, como la plataforma (igual que la de LS1).
  const sola = await pedirSesion(SOLA)
  const cuenta = await cuentaDe(sola)
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: {
      apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ account_id: cuenta, feature_key: 'conta_laboral', enabled: true, source: 'manual_grant', grant_reason: 'e2e LAB1 (carril)' }),
  })
  expect([200, 201, 204], `encender conta_laboral: HTTP ${r.status} ${await r.text()}`).toContain(r.status)
})

test('leer solo las cabeceras: el paquete bien, el mismo otra vez y uno distinto', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
  const sola = await entrarComo(page, SOLA)
  const cuenta = await cuentaDe(sola)
  const marca = `${test.info().project.name}-${Date.now()}`

  await page.goto('/conta/laboral/importar-historial')
  await expect(page.locator('[data-laboral-pagina="importar-historial"] [data-prueba="laboral-importar"]')).toBeVisible({ timeout: 30_000 })

  // 1 · El paquete como se espera.
  const bueno = paquete(marca)
  await leer(page, 'paquete inventado.xlsx', bueno)
  await expect(page.locator('[data-prueba="importar-hecho"]'))
    .toContainText('Leídas 9 hojas y 51 filas · 9 de 9 como se esperaban · y su portada (LEEME)')
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('Guardado como lote nuevo')
  // La portada (LEEME): se enseña, no bloquea y no cuenta como «no se esperaba».
  await expect(page.locator('[data-prueba="importar-hoja-portada"]')).toContainText('Portada del paquete')
  await expect(page.locator('[data-prueba="importar-hoja-portada"]')).toContainText(`No se carga: Paquete inventado · Empresa · Empresa Inventada ${marca}.`)
  await expect(page.locator('[data-prueba="importar-hojas"] tbody tr')).toHaveCount(10)
  await expect(page.locator('[data-prueba="importar-hojas"]').getByText('Como se esperaba')).toHaveCount(9)
  await captura(page, 'lab1-cabeceras-bien')

  // Ningún valor en la base: el lote guarda nombres de columna y recuentos.
  const lotes = await rest<{ id: string; resumen: unknown }[]>(sola, 'GET',
    `lab_import_lote?select=id,resumen&account_id=eq.${cuenta}&fichero_nombre=eq.${encodeURIComponent('paquete inventado.xlsx')}&order=subido_at.desc`)
  expect(lotes.status, JSON.stringify(lotes.datos)).toBe(200)
  const resumen = JSON.stringify(lotes.datos.find((l) => JSON.stringify(l.resumen).includes('Trabajadores'))?.resumen ?? null)
  expect(resumen).toContain('grupo_cotizacion')
  expect(resumen).not.toContain('INVENTADO')
  expect(resumen).not.toContain('inventado')

  // 2 · El mismo fichero otra vez.
  await leer(page, 'paquete inventado.xlsx', bueno)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('Es el mismo fichero que el lote del')

  // 3 · Le falta una columna y le sobra una hoja.
  const distinto = paquete(`${marca}-b`, (libro) => {
    const h = HOJAS_CEGID.find((x) => x.id === 'contratos')!
    libro.Sheets[h.nombre] = XLSX.utils.aoa_to_sheet([h.columnas.filter((c) => c !== 'coef_parcial')])
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['algo']]), 'Hoja1')
  })
  await leer(page, 'paquete distinto.xlsx', distinto)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('8 de 9 como se esperaban · 1 con columnas distintas · 1 hoja que no se esperaba')
  await expect(page.locator('[data-prueba="importar-hoja-contratos"]')).toContainText('Faltan: coef_parcial')
  await expect(page.locator('[data-prueba="importar-hoja-otra"]')).toContainText('No se esperaba')
  await expect(page.locator('[data-prueba="importar-lotes"] li')).not.toHaveCount(0)
  await captura(page, 'lab1-cabeceras-distintas')

  expect(errores, errores.join('\n')).toEqual([])
})

// LAB2 (30/10) · Tanda 2: con las cabeceras como se esperan, cargar las filas.
test('cargar las filas: las 51 del paquete, hoja a hoja; otra vez, sin duplicar', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
  const sola = await entrarComo(page, SOLA)
  const marca = `${test.info().project.name}-filas-${Date.now()}`

  await page.goto('/conta/laboral/importar-historial')
  await expect(page.locator('[data-laboral-pagina="importar-historial"] [data-prueba="laboral-importar"]')).toBeVisible({ timeout: 30_000 })
  const bytes = paquete(marca)
  await leer(page, 'paquete con filas.xlsx', bytes)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('9 de 9 como se esperaban')

  // Las 51 filas: Empresa 20 campos, Convenio 10 y 3 por cada una de las siete tablas.
  await page.locator('[data-prueba="importar-cargar"]').click()
  const hecho = page.locator('[data-prueba="importar-filas"]')
  // Si la pantalla dice un error, que la prueba lo enseñe en vez de esperar al tiempo máximo.
  await expect(page.locator('[data-prueba="importar-filas"], [data-prueba="importar-error"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-prueba="importar-error"]')).toHaveCount(0)
  await expect(hecho).toContainText('Cargadas 51 filas de 9 hojas: Empresa 20 · Convenio 10 · Tablas_salariales 3', { timeout: 60_000 })
  await expect(hecho).toContainText('51 nuevas.')
  await captura(page, 'lab2-filas-cargadas')

  // En la base, por la API: 51 filas en el lote de este fichero, con sus datos.
  const lote = await rest<{ id: string }[]>(sola, 'GET',
    `lab_import_lote?select=id&fichero_nombre=eq.${encodeURIComponent('paquete con filas.xlsx')}&order=subido_at.desc&limit=1`)
  expect(lote.status, JSON.stringify(lote.datos)).toBe(200)
  const filas = await rest<{ hoja: string; fila_n: number; datos: Record<string, unknown> }[]>(sola, 'GET',
    `lab_import_fila?select=hoja,fila_n,datos&lote_id=eq.${lote.datos[0].id}&order=hoja,fila_n`)
  expect(filas.status, JSON.stringify(filas.datos).slice(0, 300)).toBe(200)
  expect(filas.datos).toHaveLength(51)
  expect(filas.datos.find((f) => f.hoja === 'conceptos' && f.fila_n === 2)?.datos.concepto).toBe(`inventado ${marca} 2-1`)

  // El mismo fichero otra vez: nada nuevo, nada duplicado.
  await leer(page, 'paquete con filas.xlsx', bytes)
  await page.locator('[data-prueba="importar-cargar"]').click()
  await expect(page.locator('[data-prueba="importar-filas"], [data-prueba="importar-error"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-prueba="importar-error"]')).toHaveCount(0)
  await expect(hecho).toContainText('Ninguna cambia: es lo mismo que ya estaba.', { timeout: 60_000 })
  const otraVez = await rest<{ hoja: string }[]>(sola, 'GET', `lab_import_fila?select=hoja&lote_id=eq.${lote.datos[0].id}`)
  expect(otraVez.datos).toHaveLength(51)

  expect(errores, errores.join('\n')).toEqual([])
})

// N1 · PR 1 (01/11) · Tercer paso: de las filas a las fichas. Un paquete con
// dos bajas y una persona de alta que no está en el equipo, todas inventadas
// (NIF con la marca del run: cada run, personas nuevas). El centro de Cegid se
// confirma a mano: antes de confirmarlo, nadie entra.
function filasDe(h: (typeof HOJAS_CEGID)[number], filas: Record<string, string>[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([[...h.columnas], ...filas.map((f) => h.columnas.map((c) => f[c] ?? ''))])
}

/** Borra las personas y los locales inventados de la prueba del volcado cuyo nombre acaba en `cola` (comodín `*` de PostgREST). */
async function limpiarVolcado(s: Sesion, cola: string): Promise<void> {
  for (const empieza of ['Baja Inventada', 'Alta Inventada', 'Centro inventado']) {
    const tabla = empieza.startsWith('Centro') ? 'locations' : 'employees'
    // Sin devolver las filas: authenticated no lee todas las columnas de employees
    // y un RETURNING * da 42501 (N1 · 6). No se abre ningún permiso por esto.
    const r = await rest(s, 'DELETE', `${tabla}?name=like.${encodeURIComponent(`${empieza} *${cola}`)}`, undefined, 'return=minimal')
    expect(r.status, `borrar ${tabla} «${empieza} …${cola}»: ${JSON.stringify(r.datos)}`).toBe(204)
  }
}

test('pasar a las fichas: sin el centro confirmado nadie entra; confirmado, las bajas entran y otra vez no duplica', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
  const sola = await entrarComo(page, SOLA)
  // Cada run, sus datos (Julio, 02/11): centro, local y personas llevan el número
  // del run y el proyecto, así ordenador y móvil no comparten nada. «Sin centro en
  // Cegid» es UNA clave por cuenta: la deja libre borrar el local al que apunta.
  const run = process.env.GITHUB_RUN_ID ?? 'local'
  const marca = `${test.info().project.name}-volcado-${run}-${Date.now()}`
  const centro = `Centro inventado ${marca}`
  const cuenta = await cuentaDe(sola)
  // Lo que dejó un run de esta prueba que murió antes de limpiar: sus locales
  // (y con ellos, en cascada, sus centros confirmados) y sus personas.
  await limpiarVolcado(sola, '-volcado-*')
  // La empresa sola no tiene centros: uno que se llama como el de Cegid, para
  // que el local propuesto por el nombre sea él.
  const local = await rest<{ id: string }[]>(sola, 'POST', 'locations', { account_id: cuenta, name: centro })
  expect(local.status, JSON.stringify(local.datos)).toBe(201)
  try {
  const bytes = paquete(marca, (libro) => {
    const t = HOJAS_CEGID.find((x) => x.id === 'trabajadores')!
    const c = HOJAS_CEGID.find((x) => x.id === 'contratos')!
    libro.Sheets[t.nombre] = filasDe(t, [
      { trabajador: '1', nombre: `Baja Inventada Uno ${marca}`, nif: `INV1${marca}`, centro, puesto: 'Ayudante', en_alta_hoy: 'N' },
      { trabajador: '2', nombre: `Baja Inventada Dos ${marca}`, nif: `INV2${marca}`, centro, puesto: 'Ayudante', en_alta_hoy: 'N' },
      { trabajador: '3', nombre: `Alta Inventada Tres ${marca}`, nif: `INV3${marca}`, centro, puesto: 'Ayudante', en_alta_hoy: 'S' },
      // N1 · respuesta 3: de baja, fuera del equipo y sin centro en Cegid.
      { trabajador: '4', nombre: `Baja Inventada Cuatro ${marca}`, nif: `INV4${marca}`, puesto: 'Ayudante', en_alta_hoy: 'N' },
    ])
    libro.Sheets[c.nombre] = filasDe(c, [
      { trabajador: '1', contrato_n: '1', fecha_alta: '2023-01-10', fecha_fin: '2024-06-30', tipo_contrato: '401', centro },
      { trabajador: '2', contrato_n: '1', fecha_alta: '2022-02-01', fecha_fin: '2022-08-31', tipo_contrato: '401', centro },
      { trabajador: '4', contrato_n: '1', fecha_alta: '2021-03-01', fecha_fin: '2021-09-30', tipo_contrato: '401' },
    ])
  })

  await page.goto('/conta/laboral/importar-historial')
  await expect(page.locator('[data-laboral-pagina="importar-historial"] [data-prueba="laboral-importar"]')).toBeVisible({ timeout: 30_000 })
  await leer(page, 'paquete con bajas.xlsx', bytes)
  await expect(page.locator('[data-prueba="importar-hecho"]')).toContainText('9 de 9 como se esperaban')
  await page.locator('[data-prueba="importar-cargar"]').click()
  await expect(page.locator('[data-prueba="importar-filas"], [data-prueba="importar-error"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-prueba="importar-error"]')).toHaveCount(0)

  // El centro y «Sin centro en Cegid», sin confirmar: «Pasar a las fichas» no mete a nadie, y lo dice.
  // Por la PRIMERA celda (el nombre del centro): el desplegable de cada fila lleva
  // en sus opciones el local que se llama como el centro, y un filtro por el texto
  // de la fila entera cogía también la de «Sin centro en Cegid» (2 filas, no 1).
  const filaDe = (nombre: string) => page.locator('[data-prueba="volcado-centro"]').filter({ has: page.locator('td:first-child', { hasText: nombre }) })
  const filaCentro = filaDe(centro)
  const filaSinCentro = filaDe('Sin centro en Cegid')
  await expect(filaCentro).toHaveCount(1, { timeout: 30_000 })
  // La 2248 (N1 · respuesta 3) llega a staging de verdad cuando se fusiona en main
  // (es un «cambia»: desde la rama, solo en ROLLBACK). Sin ella, staging no trae la
  // fila «Sin centro en Cegid»: se prueba lo de antes y se apunta, nunca en silencio.
  const conLa2248 = (await filaSinCentro.count()) === 1
  if (!conLa2248) test.info().annotations.push({ type: 'sin la 2248', description: 'staging aún no tiene la 2248: la fila «Sin centro en Cegid» se prueba en main, después del real' })
  if (conLa2248) {
    await expect(filaSinCentro).toContainText('1')
    await expect(page.locator('[data-prueba="volcado-sin-confirmar"]')).toContainText('Faltan confirmar 2 centros')
  }
  const hecho = page.locator('[data-prueba="volcado-hecho"]')
  // N1 · PR 2: con algún centro sin local, el primer clic avisa nombrándolo y no pasa nada; el segundo pasa el resto.
  const pasar = async (sinLocal: string[] = []) => {
    await page.locator('[data-prueba="volcado-pasar"]').click()
    if (sinLocal.length > 0) {
      const antes = page.locator('[data-prueba="volcado-aviso-antes"]')
      for (const n of sinLocal) await expect(antes).toContainText(`«${n}»`)
      await expect(hecho).toHaveCount(0)
      await page.locator('[data-prueba="volcado-pasar"]').click()
    }
    await expect(page.locator('[data-prueba="volcado-hecho"], [data-prueba="volcado-error"]')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-prueba="volcado-error"]')).toHaveCount(0)
  }
  await pasar(conLa2248 ? [centro, 'Sin centro en Cegid'] : [centro])
  await expect(hecho).toContainText('0 personas y 0 contratos al día desde Cegid. De las 4 de Cegid, 4 no han entrado')
  await expect(page.locator('[data-prueba="volcado-avisos"]')).toContainText('no tiene local confirmado')
  if (conLa2248) await expect(page.locator('[data-prueba="volcado-avisos"]')).toContainText(`Baja Inventada Cuatro ${marca}: no está en Folvy y Cegid no trae su centro`)

  // Confirmado el propuesto (el que se llama igual): las dos bajas entran; la de alta no se crea.
  await expect(filaCentro.locator('select')).toHaveValue(local.datos[0].id)
  await expect(filaCentro.locator('[data-prueba="volcado-confirmar"]')).toHaveText('Confirmar el propuesto')
  await filaCentro.locator('[data-prueba="volcado-confirmar"]').click()
  await expect(filaCentro).toContainText('Confirmado')
  await pasar(conLa2248 ? ['Sin centro en Cegid'] : [])
  await expect(hecho).toContainText('2 personas y 2 contratos al día desde Cegid (2 entran como bajas). De las 4 de Cegid, 2 no han entrado')
  await expect(page.locator('[data-prueba="volcado-avisos"]')).toContainText(`Alta Inventada Tres ${marca}: en Cegid está de alta y no está en Folvy`)

  // «Sin centro en Cegid»: elegir el local ya lo confirma (N1 · PR 2) y entra la baja que faltaba.
  if (conLa2248) {
    await expect(filaSinCentro).toContainText('Sin elegir')
    await filaSinCentro.locator('select').selectOption(local.datos[0].id)
    await expect(filaSinCentro).toContainText('Confirmado')
    await pasar()
    await expect(hecho).toContainText('3 personas y 3 contratos al día desde Cegid (2 ya estaban en el equipo · 1 entra como baja). De las 4 de Cegid, 1 no ha entrado')
    await expect(page.locator('[data-prueba="volcado-para-saber"]')).toContainText(`Baja Inventada Cuatro ${marca}: de baja en Cegid y no estaba en Folvy: entra como baja.`)
  }
  await captura(page, 'n1-volcado-hecho')

  // Otra vez: las mismas, que ya están; ningún contrato de más.
  await pasar()
  await expect(hecho).toContainText(conLa2248
    ? '3 personas y 3 contratos al día desde Cegid (3 ya estaban en el equipo)'
    : '2 personas y 2 contratos al día desde Cegid (2 ya estaban en el equipo)')

  // N1 · PR 2 · La ficha nueva de una de las bajas que acaban de entrar (Resumen,
  // Contrato y salario, IRPF): el código delante, «Falta» donde Cegid no trae nada,
  // y el IBAN (inventado, banco 9999) se guarda y lo dice.
  const persona = await rest<{ id: string }[]>(sola, 'GET', `employees?select=id&name=eq.${encodeURIComponent(`Baja Inventada Uno ${marca}`)}`)
  expect(persona.datos.length, JSON.stringify(persona.datos)).toBe(1)
  await page.goto(`/conta/laboral/persona/${persona.datos[0].id}`)
  const ficha = page.locator('[data-prueba="ficha-persona"]')
  await expect(ficha.locator('h1')).toContainText(`Baja Inventada Uno ${marca}`, { timeout: 30_000 })
  await expect(ficha).toContainText('De baja')
  await expect(ficha.locator('[data-prueba="ficha-estudios"]')).toContainText('Falta')
  await ficha.locator('[data-prueba="ficha-pestana-contrato"]').click()
  await expect(ficha.locator('[data-prueba="ficha-tipo"]')).toContainText('401 · ')
  await expect(ficha.locator('[data-prueba="ficha-categoria"]')).toContainText('Falta la categoría')
  await ficha.locator('[data-prueba="ficha-iban-cambiar"]').click()
  await ficha.locator('[data-prueba="ficha-iban-campo"]').fill('ES49 9999 0000 0000 0000 0000')
  await ficha.locator('[data-prueba="ficha-iban-guardar"]').click()
  await expect(ficha.locator('[data-prueba="ficha-hecho"]')).toContainText('IBAN no es válido')
  await ficha.locator('[data-prueba="ficha-iban-campo"]').fill('ES49 9999 0000 0000 0000 0001')
  await ficha.locator('[data-prueba="ficha-iban-guardar"]').click()
  await expect(ficha.locator('[data-prueba="ficha-hecho"]')).toContainText('Guardado: cobrará en ES49 …0001')
  await expect(ficha.locator('[data-prueba="ficha-iban"]')).toContainText('ES49 9999 0000 0000 0000 0001')
  await captura(page, 'n1-ficha-contrato')
  await ficha.locator('[data-prueba="ficha-pestana-irpf"]').click()
  await expect(ficha.locator('[data-prueba="ficha-145"]')).toContainText('Falta')

  // N1 · PR 3 · Tiempo y turnos (maquetas 10 y 10b): la semana, el mes y lo que falta, dicho.
  await ficha.locator('[data-prueba="ficha-pestana-tiempo"]').click()
  const tiempo = ficha.locator('[data-prueba="ficha-tiempo"]')
  await expect(tiempo.locator('[data-prueba="tiempo-mes"]')).toContainText('fichadas hasta hoy', { timeout: 30_000 })
  // La bolsa acaba de leerse: con su cifra o con «Falta» y el porqué, nunca «…».
  await expect(tiempo.locator('[data-prueba="tiempo-bolsa"]')).not.toContainText('…', { timeout: 30_000 })
  // Sin cuadrante publicado (o sin local), el turno no se inventa: lo dice.
  await expect(tiempo).toContainText(/no está publicado|Sin local en su ficha/)
  const movil = test.info().project.name === 'movil'
  await expect(tiempo.locator(movil ? '[data-prueba="tiempo-semana-movil"]' : '[data-prueba="tiempo-semana"]')).toBeVisible()
  await expect(tiempo.locator(movil ? '[data-prueba="tiempo-semana"]' : '[data-prueba="tiempo-semana-movil"]')).toBeHidden()
  await expect(tiempo.locator('[data-prueba="tiempo-registros"] tbody tr')).toHaveCount(3)
  await tiempo.locator('[data-prueba="tiempo-anterior"]').click()
  await expect(tiempo).toContainText('Esta semana · del ')
  await captura(page, 'n1-ficha-tiempo')

  // N1 · PR 2 · En Equipo, el administrador ve quién tiene el permiso de Laboral (él, siempre).
  await page.goto('/conta/laboral')
  const permisos = page.locator('[data-prueba="permisos-laboral"]')
  await expect(permisos.locator('[data-prueba="permisos-laboral-fila"]').first()).toContainText('Lo tiene siempre, por ser administrador de la cuenta', { timeout: 30_000 })

  expect(errores, errores.join('\n')).toEqual([])
  } finally {
    // Al acabar, en verde o en rojo, lo suyo: sus personas y su local (con su
    // centro y «Sin centro en Cegid», que apuntaban a él). El lote se queda: no se
    // puede borrar desde la aplicación, y es de la cuenta del carril.
    await limpiarVolcado(sola, marca)
  }
})
