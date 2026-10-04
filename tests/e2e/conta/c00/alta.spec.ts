/// <reference lib="dom" />
// tests/e2e/conta/c00/alta.spec.ts
//
// El alta conversada, segunda vuelta (respuesta 3 del C00; maquetas N1bAlta y
// N1cAlta), y la base de la IA (origen de cada dato, sugerencia, registro y
// deshacer), de punta a punta y con la RLS de verdad.
//
//   · Cuenta C, SIN empresa (seed_c00_cuenta_c_sin_empresa.sql): el alta a
//     pantalla completa (N1b), volver a un punto tocándolo o diciéndolo, y las
//     tres cosas que no pueden perder nada: salir y seguir luego, el botón
//     atrás del navegador y cerrar la pestaña.
//   · Cuenta A, que ya tiene su empresa: otra empresa en la ventana flotante
//     (N1c), las píldoras, cerrar guarda, y lo que hizo la IA en «Tu empresa».
//   · El móvil: a pantalla completa y «Lo que llevamos» en una hoja.
//
// Cada prueba crea su propia empresa con un NIF inventado y la borra al acabar
// por la API, con la sesión del usuario (lo que cuelga de ella se va en
// cascada). En C se borra toda empresa (la cuenta es de prueba y vive sin
// ninguna); en A, toda empresa sin terminar.
//
// La sugerencia del 115 sale porque la cuenta A tiene un alquiler al 19 % de
// PRUEBA (seed_c00_sugerencia_prueba.sql) y en el alta se contesta que no se
// paga alquiler con retención. La regla es real; el dato, de prueba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, CUENTA_C, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function borrarEmpresas(s: Sesion, cuenta: string, todas: boolean) {
  // En A, toda empresa SIN TERMINAR es de estas pruebas (la de la semilla está
  // terminada); no se filtra por el nombre, porque una prueba rota a mitad
  // puede haber guardado cualquier cosa en él. En C, todas: vive sin ninguna.
  const filtro = todas ? '' : '&setup_completed_at=is.null'
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${cuenta}${filtro}`)
  const r2 = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${cuenta}&legal_name=like.Alta%20e2e*`)
  const ids = new Set([...(r.datos ?? []), ...(r2.datos ?? [])].map((c) => c.id))
  for (const id of ids) {
    // La RLS puede «borrar» cero filas sin dar error: se cuenta lo borrado.
    const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${cuenta}`)
    expect(b.status, `Borrar la empresa de prueba ${id}`).toBeLessThan(300)
    expect((b.datos ?? []).length, `Borrar la empresa de prueba ${id}`).toBe(1)
  }
}

/** Un alta a medias, ya en «Tus cuentas» (4 de 6), preparada por la API. */
async function altaAMedias(s: Sesion, cuenta: string, nombre: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: cuenta, legal_name: nombre, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    fiscal_street: 'Calle del Ensayo', fiscal_number: '7', fiscal_postal_code: '28001', fiscal_city: 'Madrid', fiscal_province: 'Madrid',
    setup_step: 'cuentas',
  })
  expect(r.status, `se prepara el alta a medias: ${JSON.stringify(r.datos)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', {
    account_id: cuenta, company_id: id, tax_territory: 'peninsula_baleares', vat_period: 'quarterly', tax_forms: ['111', '202', '303', '390'],
  })
  expect(p.status, 'y su perfil fiscal').toBe(201)
  const a = await rest(s, 'POST', 'company_activity', {
    account_id: cuenta, company_id: id, kind: 'business', description: 'Comida a domicilio', iae_code: '1_6779', cnae_version: '2025', cnae_code: '5611', is_main: true,
  })
  expect(a.status, 'y su actividad').toBe(201)
  return id
}

async function decir(page: Page, texto: string) {
  const entrada = page.getByRole('textbox', { name: 'Tu respuesta' })
  await expect(entrada).toBeEnabled()
  await entrada.fill(texto)
  await entrada.press('Enter')
}

/** Como lo hace una persona (respuesta 4): toca la caja, teclea letra a letra y pulsa Intro en el teclado. */
async function teclear(page: Page, texto: string) {
  const entrada = page.getByRole('textbox', { name: 'Tu respuesta' })
  await expect(entrada).toBeEnabled()
  await entrada.click()
  await page.keyboard.type(texto)
  await page.keyboard.press('Enter')
}

/** Lo que guardó la IA en un campo de la empresa, con su motivo (ai_data_origin). */
async function origen(s: Sesion, cuenta: string, empresa: string, campo: string) {
  const r = await rest<{ source: string; reason: string }[]>(s, 'GET',
    `ai_data_origin?select=source,reason&account_id=eq.${cuenta}&company_id=eq.${empresa}&table_key=eq.company&field=eq.${campo}`)
  return r.datos ?? []
}

const log = (page: Page) => page.getByRole('log', { name: 'Conversación del alta' })
const PREGUNTA_CUENTAS = '¿Prefieres el plan de pymes o el general? Para una empresa de tu tamaño, lo normal es el de pymes.'

/** Del NIF a «A qué os dedicáis», escribiendo como lo haría la persona. */
async function hastaLaActividad(page: Page, nombre: string) {
  await expect(log(page).getByText(/NIF/).last()).toBeVisible()
  const nif = cifInventado()
  await decir(page, nif)
  await expect(log(page).getByText(`Entendido: NIF ${nif}. Con él empiezo la ficha de tu empresa.`)).toBeVisible()
  await expect(log(page).getByText('¿Cómo se llama la empresa? El nombre que sale en el NIF.')).toBeVisible()
  await decir(page, nombre)
  await expect(log(page).getByText(`Entendido: ${nombre}. Lo he puesto como razón social.`)).toBeVisible()
  await page.getByLabel('Calle').fill('Calle del Ensayo')
  await page.getByLabel('Número').fill('7')
  await page.getByLabel('Código postal').fill('28001')
  await page.getByLabel('Población').fill('Madrid')
  await page.getByRole('button', { name: 'Es esta' }).click()
  await expect(log(page).getByText('Apuntada la dirección: Calle del Ensayo 7, 28001 Madrid.')).toBeVisible()
}

/** Las preguntas de impuestos, con lo normal, hasta la de las cuentas. */
async function hastaLasCuentas(page: Page) {
  await page.getByRole('button', { name: 'Sí, cada tres meses' }).click()
  await expect(log(page).getByText('Entendido: el IVA cada tres meses.')).toBeVisible()
  await page.getByRole('button', { name: 'Sí', exact: true }).click() // nóminas o profesionales
  await expect(log(page).getByText('¿Pagas el alquiler de un local con retención?')).toBeVisible()
  await page.getByRole('button', { name: 'No', exact: true }).click()
  await expect(log(page).getByText(/^Con eso, presentas los modelos /)).toBeVisible()
  await expect(log(page).getByText(PREGUNTA_CUENTAS)).toBeVisible()
}

// ── Cuenta C: pantalla completa (N1b) ───────────────────────────────────────

test('cuenta C, sin empresa: el alta a pantalla completa, con «Lo que llevamos», el porqué y volver a un punto', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: el móvil tiene su prueba')
  const s = await entrarComo(page, CUENTA_C.email)
  await borrarEmpresas(s, CUENTA_C.id, true)
  const nombre = `Alta e2e C ${Date.now()}`
  try {
    await page.goto('/conta/alta')
    await expect(page.getByRole('heading', { level: 1, name: 'Cuéntame tu negocio y lo dejo montado.' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0) // sin empresa: no es la ventana
    const carril = page.getByRole('complementary', { name: 'Lo que llevamos' })
    await expect(carril.getByText('0 de 6')).toBeVisible()
    await hastaLaActividad(page, nombre)

    // Lo dice con sus palabras; la IA repite lo entendido y lo que ha hecho.
    await decir(page, 'somos dark kitchen, solo reparto de comida a domicilio por plataformas')
    await expect(page.getByText(/^Epígrafe 677\.9 · Otros servicios de alimentación propios de la restauración/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Añadir las marcadas' }).click()
    const entendido = log(page).getByText(/^Entendido: somos dark kitchen, solo reparto de comida a domicilio por plataformas\. Lo he apuntado como comida a domicilio \(epígrafe 677\.9\).*, y el IVA de tus ventas al 10 %\./)
    await expect(entendido).toBeVisible()
    // Y en la MISMA burbuja, la pregunta siguiente (el texto es de la burbuja entera).
    await expect(entendido).toContainText('Ahora, tus impuestos. ¿Presentas el IVA cada tres meses?')
    await expect(log(page).getByText(/^Apuntad[oa]\.$/)).toHaveCount(0)
    await hastaLasCuentas(page)

    // N1b: 4 de 6, las cuentas preguntándose y el banco al final.
    await expect(carril.getByText('4 de 6')).toBeVisible()
    await expect(carril.getByText('Te lo estoy preguntando')).toBeVisible()
    await expect(carril.getByText('Al final, si quieres')).toBeVisible()
    await expect(carril.getByText(/^Comida a domicilio · 677\.9/)).toBeVisible()
    // El porqué, plegado, y se abre al tocarlo.
    const porque = page.getByRole('button', { name: '¿Por qué lo pregunto?' })
    await expect(porque).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(/El de pymes es más corto y vale si facturas menos de 8 M€/)).toHaveCount(0)
    await porque.click()
    await expect(page.getByText(/El de pymes es más corto y vale si facturas menos de 8 M€ y sois menos de 50/)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/alta-ordenador.png` })

    // Volver a un punto TOCÁNDOLO: «Dónde». Al contestarlo, sigue donde iba.
    await carril.getByRole('button', { name: /^Dónde: Calle del Ensayo 7, Madrid\. Cambiar$/ }).click()
    await expect(log(page).getByText(/Volvemos a «Dónde»\. Cuando lo cambies, sigo donde íbamos\./)).toBeVisible()
    await expect(log(page).getByText('¿Cuál es la dirección fiscal?').last()).toBeVisible()
    await page.getByLabel('Calle').fill('Calle de la Vuelta')
    await page.getByLabel('Número').fill('9')
    await page.getByLabel('Código postal').fill('28002')
    await page.getByLabel('Población').fill('Madrid')
    await page.getByRole('button', { name: 'Es esta' }).click()
    await expect(log(page).getByText('Apuntada la dirección: Calle de la Vuelta 9, 28002 Madrid.')).toBeVisible()
    await expect(log(page).getByText(PREGUNTA_CUENTAS).last()).toBeVisible()
    await expect(carril.getByText('Calle de la Vuelta 9, Madrid')).toBeVisible()
    // …y DICIÉNDOLO: «cambia el nombre».
    await decir(page, 'cambia el nombre')
    await expect(log(page).getByText(/Volvemos a «Quién eres»\./)).toBeVisible()
    await decir(page, `${nombre} bis`)
    await expect(log(page).getByText(`Entendido: ${nombre} bis. Lo he puesto como razón social.`)).toBeVisible()
    await expect(log(page).getByText(PREGUNTA_CUENTAS).last()).toBeVisible()
    await expect(carril.getByText('4 de 6')).toBeVisible()

    // Escrito con sus palabras también vale para los botones.
    await decir(page, 'el de pymes')
    await expect(log(page).getByText(/^Entendido: plan de pymes\. Te dejo cuentas de 8 dígitos y el ejercicio \d{4} abierto/)).toBeVisible()
    await decir(page, 'ni idea')
    await expect(log(page).getByText(/^Listo: .* está montada\./)).toBeVisible()
    await expect(carril.getByText('6 de 6')).toBeVisible()
  } finally {
    await borrarEmpresas(s, CUENTA_C.id, true)
  }
})

test.describe('cuenta C: salir, atrás y cerrar no pierden nada', () => {
  test.beforeEach(({ browserName }, info) => { void browserName; test.skip(info.project.name === 'movil', 'Basta un tamaño') })

  test('«Salir y seguir luego»: en «Tu empresa» queda «Alta a medias · 4 de 6 · Seguir», y sigue donde estaba', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_C.email)
    await borrarEmpresas(s, CUENTA_C.id, true)
    const nombre = `Alta e2e salir ${Date.now()}`
    try {
      await altaAMedias(s, CUENTA_C.id, nombre)
      await page.goto('/conta/alta')
      await expect(log(page).getByText(new RegExp(`^Seguimos donde lo dejaste con ${escapar(nombre)}\\.$`))).toBeVisible()
      await expect(log(page).getByText(PREGUNTA_CUENTAS)).toBeVisible()
      await page.getByRole('button', { name: 'Salir y seguir luego' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
      const aviso = page.getByRole('status', { name: 'Alta a medias' })
      await expect(aviso).toContainText(`Alta a medias · ${nombre} · 4 de 6`)
      await aviso.getByRole('link', { name: 'Seguir' }).click()
      await expect(log(page).getByText(PREGUNTA_CUENTAS)).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Lo que llevamos' }).getByText('4 de 6')).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_C.id, true)
    }
  })

  test('el botón atrás del navegador: se va, y adelante vuelve a la misma pregunta', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_C.email)
    await borrarEmpresas(s, CUENTA_C.id, true)
    try {
      await altaAMedias(s, CUENTA_C.id, `Alta e2e atrás ${Date.now()}`)
      await page.goto('/conta/ajustes')
      await page.getByRole('status', { name: 'Alta a medias' }).getByRole('link', { name: 'Seguir' }).click()
      await expect(log(page).getByText(PREGUNTA_CUENTAS)).toBeVisible()
      await page.getByRole('button', { name: 'El de pymes, el normal' }).click() // contesta una más antes de irse
      await expect(log(page).getByText('¿Cuál es el IBAN de la cuenta del banco de la empresa?')).toBeVisible()
      await page.goBack()
      await expect(page.getByRole('status', { name: 'Alta a medias' })).toContainText('5 de 6')
      await page.goForward()
      await expect(log(page).getByText('¿Cuál es el IBAN de la cuenta del banco de la empresa?')).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_C.id, true)
    }
  })

  test('cerrar la pestaña: al abrir otra, sigue donde estaba', async ({ page, context }) => {
    const s = await entrarComo(page, CUENTA_C.email)
    await borrarEmpresas(s, CUENTA_C.id, true)
    try {
      await altaAMedias(s, CUENTA_C.id, `Alta e2e cerrar ${Date.now()}`)
      await page.goto('/conta/alta')
      await page.getByRole('button', { name: 'El general' }).click()
      await expect(log(page).getByText(/^Entendido: plan general\./)).toBeVisible()
      await page.close()
      const otra = await context.newPage()
      await entrarComo(otra, CUENTA_C.email)
      await otra.goto('/conta/alta')
      await expect(log(otra).getByText('¿Cuál es el IBAN de la cuenta del banco de la empresa?')).toBeVisible()
      await expect(otra.getByRole('complementary', { name: 'Lo que llevamos' }).getByText(/^Plan general · 8 dígitos/)).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_C.id, true)
    }
  })
})

// ── Intro envía, en los tres marcos (respuesta 4) ───────────────────────────
//
// Julio escribió el NIF en la ventana, pulsó Intro y no pasó nada; la etiqueta
// «Intro» quedó seleccionada como texto. Aquí se teclea como él: tocar la caja,
// letra a letra, e Intro en el teclado; nunca `fill` ni un clic en un botón.

test.describe('Intro envía (respuesta 4)', () => {
  test('pantalla completa (cuenta C): Intro envía, la etiqueta «Intro» no se selecciona, el botón de enviar va con el texto, y la dirección de Julio trae la población', async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El móvil tiene la suya')
    const s = await entrarComo(page, CUENTA_C.email)
    await borrarEmpresas(s, CUENTA_C.id, true)
    try {
      await page.goto('/conta/alta')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(log(page).getByText(/NIF/).last()).toBeVisible()
      const enviar = page.getByRole('button', { name: 'Enviar' })
      await expect(enviar).toBeDisabled() // sin texto, apagado
      // Vacía la caja: solo la flecha gris y el micro; «↵ Intro» sale al escribir (respuesta 5).
      const tecla = page.locator('kbd.cx-alta-tecla')
      await expect(tecla).toHaveCount(0)

      const nif = cifInventado()
      await page.getByRole('textbox', { name: 'Tu respuesta' }).click()
      await page.keyboard.type(nif)
      await expect(enviar).toBeEnabled()
      await expect(tecla).toHaveText('↵ Intro')
      expect(await tecla.evaluate((k) => {
        const c = getComputedStyle(k)
        return { seleccion: c.userSelect, color: c.color, fondo: c.backgroundColor }
      })).toEqual({ seleccion: 'none', color: 'rgb(47, 91, 255)', fondo: 'rgb(234, 240, 255)' })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `${DIR}/alta-intro.png` })
      await page.keyboard.press('Enter')
      await expect(log(page).getByText(`Entendido: NIF ${nif}. Con él empiezo la ficha de tu empresa.`)).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Tu respuesta' })).toHaveValue('')

      // Lo que hizo Julio: escribir y tocar la etiqueta «Intro». Envía, y no deja nada seleccionado.
      const nombre = `Alta e2e Intro ${Date.now()}`
      await page.getByRole('textbox', { name: 'Tu respuesta' }).click()
      await page.keyboard.type(nombre)
      await tecla.dblclick()
      await expect(log(page).getByText(`Entendido: ${nombre}. Lo he puesto como razón social.`)).toBeVisible()
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

      // La dirección de Julio, dicha en una frase: calle, número y código postal de la frase; la población, de la tabla.
      await teclear(page, 'Avda Ensanche de Vallecas 106, 28051')
      await expect(page.getByLabel('Calle')).toHaveValue('Avda Ensanche de Vallecas')
      await expect(page.getByLabel('Número')).toHaveValue('106')
      await expect(page.getByLabel('Código postal')).toHaveValue('28051')
      await expect(page.getByLabel('Población')).toHaveValue('Madrid')
      const formulario = page.getByRole('form', { name: 'Dirección fiscal' })
      const marca = formulario.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })
      await expect(marca).toBeVisible()
      await marca.click()
      await expect(formulario.getByRole('note')).toContainText('Por el código postal 28051')
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `${DIR}/alta-direccion-cp.png` })
      await formulario.getByRole('button', { name: 'Es esta' }).click()
      await expect(log(page).getByText('Apuntada la dirección: Avda Ensanche de Vallecas 106, 28051 Madrid.')).toBeVisible()

      // En la base: la población y la provincia, puestas por la IA con su porqué; la calle, de la persona.
      const empresa = (await rest<{ id: string; fiscal_city: string; fiscal_province: string }[]>(s, 'GET',
        `company?select=id,fiscal_city,fiscal_province&account_id=eq.${CUENTA_C.id}`)).datos[0]
      expect(empresa).toMatchObject({ fiscal_city: 'Madrid', fiscal_province: 'Madrid' })
      expect(await origen(s, CUENTA_C.id, empresa.id, 'fiscal_city')).toEqual([expect.objectContaining({ source: 'ai', reason: expect.stringContaining('28051') })])
      expect(await origen(s, CUENTA_C.id, empresa.id, 'fiscal_province')).toEqual([expect.objectContaining({ source: 'ai' })])
      expect(await origen(s, CUENTA_C.id, empresa.id, 'fiscal_street')).toEqual([])

      // Y el botón de enviar, con el ratón.
      await page.getByRole('textbox', { name: 'Tu respuesta' }).click()
      await page.keyboard.type('somos dark kitchen, solo reparto de comida a domicilio por plataformas')
      await enviar.click()
      await expect(page.getByRole('button', { name: 'Añadir las marcadas' })).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_C.id, true)
    }
  })

  test('ventana (cuenta A): Intro envía, y un código postal de otra provincia trae su población', async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El móvil tiene la suya')
    const s = await entrarComo(page, CUENTA_A.email)
    await borrarEmpresas(s, CUENTA_A.id, false)
    try {
      await page.goto('/conta/alta')
      const ventana = page.getByRole('dialog', { name: 'Cuéntame la empresa y la dejo montada' })
      await expect(ventana).toBeVisible()
      await expect(log(page).getByText(/NIF/).last()).toBeVisible()
      const nif = cifInventado()
      await teclear(page, nif)
      await expect(log(page).getByText(`Entendido: NIF ${nif}. Con él empiezo la ficha de tu empresa.`)).toBeVisible()
      const nombre = `Alta e2e Intro ventana ${Date.now()}`
      await teclear(page, nombre)
      await expect(log(page).getByText(`Entendido: ${nombre}. Lo he puesto como razón social.`)).toBeVisible()

      // Otra provincia, en los campos: el código postal basta para la población.
      await page.getByLabel('Calle').fill('Carrer de Pelai')
      await page.getByLabel('Número').fill('12')
      await page.getByLabel('Código postal').fill('08001')
      await expect(page.getByLabel('Población')).toHaveValue('Barcelona')
      await expect(page.getByRole('form', { name: 'Dirección fiscal' }).getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })).toBeVisible()
      await page.getByRole('button', { name: 'Es esta' }).click()
      await expect(log(page).getByText('Apuntada la dirección: Carrer de Pelai 12, 08001 Barcelona.')).toBeVisible()
      await expect(ventana).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_A.id, false)
    }
  })

  test('móvil (cuenta C): Intro del teclado envía', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'La forma del móvil')
    const s = await entrarComo(page, CUENTA_C.email)
    await borrarEmpresas(s, CUENTA_C.id, true)
    try {
      await page.goto('/conta/alta')
      await expect(log(page).getByText(/NIF/).last()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Enviar' })).toBeDisabled()
      const nif = cifInventado()
      await teclear(page, nif)
      await expect(log(page).getByText(`Entendido: NIF ${nif}. Con él empiezo la ficha de tu empresa.`)).toBeVisible()
      const nombre = `Alta e2e Intro móvil ${Date.now()}`
      await teclear(page, nombre)
      await expect(log(page).getByText(`Entendido: ${nombre}. Lo he puesto como razón social.`)).toBeVisible()
    } finally {
      await borrarEmpresas(s, CUENTA_C.id, true)
    }
  })
})

// ── Cuenta A: otra empresa, en la ventana (N1c) ─────────────────────────────

test('cuenta A: otra empresa en la ventana, con píldoras; cerrar guarda; y lo que hizo la IA se ve, se explica y se deshace', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: el móvil tiene su prueba')
  const s = await entrarComo(page, CUENTA_A.email)
  await borrarEmpresas(s, CUENTA_A.id, false)
  const nombre = `Alta e2e ${Date.now()}`
  try {
    await page.goto('/conta/alta')
    const ventana = page.getByRole('dialog', { name: 'Cuéntame la empresa y la dejo montada' })
    await expect(ventana).toBeVisible()
    await hastaLaActividad(page, nombre)
    await decir(page, 'Restaurante, y también repartimos a domicilio')
    await expect(page.getByText('Epígrafe 671 · Servicios en restaurantes · CNAE 5611 · Restaurantes')).toBeVisible()
    await page.getByRole('button', { name: 'Añadir las marcadas' }).click()
    await expect(log(page).getByText(/Lo he apuntado como restaurante \(epígrafe 671\) y comida a domicilio \(epígrafe 677\.9\), y el IVA de tus ventas al 10 %\./)).toBeVisible()
    const pildoras = ventana.getByRole('list', { name: 'Lo que llevamos' })
    await expect(pildoras.getByRole('button', { name: /^Quién eres: / })).toBeVisible()
    await expect(pildoras.getByText('● Tus impuestos')).toBeVisible()
    await expect(ventana.getByRole('img', { name: '3 de 6' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/alta-ventana.png` })

    // La píldora vuelve a su punto.
    await pildoras.getByRole('button', { name: /^Dónde: / }).click()
    await expect(log(page).getByText(/Volvemos a «Dónde»\./)).toBeVisible()
    await page.getByLabel('Calle').fill('Calle del Ensayo')
    await page.getByLabel('Número').fill('8')
    await page.getByLabel('Código postal').fill('28001')
    await page.getByLabel('Población').fill('Madrid')
    await page.getByRole('button', { name: 'Es esta' }).click()
    await expect(log(page).getByText(/¿Presentas el IVA cada tres meses\?/).last()).toBeVisible()

    // Cerrar guarda: «Tu empresa» lo dice, y «Seguir» abre la ventana donde estaba.
    await ventana.getByRole('button', { name: 'Cerrar: se guarda solo' }).click()
    await expect(page.getByRole('status', { name: 'Alta a medias' })).toContainText(`Alta a medias · ${nombre} · 3 de 6`)
    await page.getByRole('status', { name: 'Alta a medias' }).getByRole('link', { name: 'Seguir' }).click()
    await expect(ventana).toBeVisible()
    await hastaLasCuentas(page)
    // «No lo sé»: deja la normal y lo apunta.
    await page.getByRole('button', { name: 'Que lo decida mi asesor' }).click()
    await expect(log(page).getByText('Lo dejo en «El de pymes, el normal», que es lo normal, y se lo apunto a tu asesor como duda.')).toBeVisible()
    await page.getByRole('button', { name: 'Lo pongo luego' }).click()
    await expect(log(page).getByText(/^Listo: .* está montada\./)).toBeVisible()

    // En «Tu empresa»: la marca, la sugerencia real y el registro.
    await log(page).getByRole('link', { name: 'Tu empresa' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Tu empresa' })).toBeVisible()
    await expect(page.getByText(nombre).first()).toBeVisible()
    await expect(page.getByRole('status', { name: 'Alta a medias' })).toHaveCount(0)
    const marcas = page.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })
    await expect(marcas.first()).toBeVisible()
    await marcas.first().click()
    await expect(page.getByRole('note').first()).toBeVisible()

    const sugerencia = page.getByRole('region', { name: 'Lo que propone Folvy' })
    await expect(sugerencia.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toBeVisible()
    await expect(sugerencia.getByText(/Lo veo en Locales del Norte \(alquiler\)/)).toBeVisible()
    await page.screenshot({ path: `${DIR}/ia-sugerencia.png`, fullPage: true })
    await sugerencia.getByRole('button', { name: 'Sí, añádelo' }).click()
    // Respuesta 3: con el 115 entra su resumen anual, el 180 (la regla de la tabla de modelos).
    await expect(page.getByText('Añadidos el modelo 115 y su resumen anual, el 180, a lo que presentas. Si no era así, lo deshaces en «Lo que ha hecho Folvy».')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Lo que propone Folvy' })).toHaveCount(0)
    // C02 §5a: el IVA de tus ventas está en «Tus impuestos», y el registro en «Lo que ha hecho Folvy».
    await page.goto('/conta/ajustes/impuestos')
    await expect(page.locator('.cx-dato').filter({ hasText: 'IVA de tus ventas' })).toContainText('10 %')
    await page.goto('/conta/ajustes/folvy')

    const registro = page.getByRole('list', { name: 'Lo que ha hecho Folvy' })
    await expect(registro.getByText('Puso el IVA de tus ventas: 10 %')).toBeVisible()
    // Los anuales y el 347 salen de la regla de la tabla (respuesta 3, punto 2).
    await expect(registro.getByText('Puso los modelos que presentas: 111, 190, 200, 202, 303, 347, 390')).toBeVisible()
    const conEl115 = registro.getByText(/^(Puso|Cambió) los modelos que presentas: .*115, 180/)
    await expect(conEl115).toBeVisible()
    await registro.getByRole('button', { name: /^Deshacer: (Puso|Cambió) los modelos que presentas: .*115/ }).click()
    await expect(page.getByText(/^Deshecho: (puso|cambió) los modelos que presentas: /)).toBeVisible()
    await expect(registro.getByText('Deshecho por Admin Norte').first()).toBeVisible()
    // Deshecha, la sugerencia NO vuelve: ya se contestó.
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'Lo que ha hecho Folvy' })).toBeVisible()
    // Primero que haya cargado: un «no está» mirado con el esqueleto delante siempre se cumple.
    await expect(registro.getByText('Deshecho por Admin Norte').first()).toBeVisible()
    await expect(registro.getByText('Puso el tipo de empresa: Sociedades de responsabilidad limitada')).toBeVisible()
    await page.goto('/conta/ajustes')
    await expect(page.getByText(nombre).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Tu empresa' })).toBeVisible()
    await expect(page.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toHaveCount(0)
    await page.goto('/conta/ajustes/folvy')
    await expect(registro.getByText('Deshecho por Admin Norte').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/ia-registro.png`, fullPage: true })
    expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
  } finally {
    await borrarEmpresas(s, CUENTA_A.id, false)
  }
})

// ── El móvil ────────────────────────────────────────────────────────────────

test('cuenta C en el móvil: a pantalla completa, y «Lo que llevamos» es una hoja que sube al tocar «N de 6»', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  const s = await entrarComo(page, CUENTA_C.email)
  await borrarEmpresas(s, CUENTA_C.id, true)
  try {
    await altaAMedias(s, CUENTA_C.id, `Alta e2e móvil ${Date.now()}`)
    await page.goto('/conta/alta')
    await expect(log(page).getByText(PREGUNTA_CUENTAS)).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Lo que llevamos' })).toHaveCount(0)
    await page.getByRole('button', { name: '¿Por qué lo pregunto?' }).click()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/alta-movil.png` })
    await page.getByRole('button', { name: 'Lo que llevamos: 4 de 6' }).click()
    const hoja = page.getByRole('dialog', { name: 'Lo que llevamos' })
    await expect(hoja).toBeVisible()
    await expect(hoja.getByText('Te lo estoy preguntando')).toBeVisible()
    await page.screenshot({ path: `${DIR}/alta-movil-hoja.png` })
    // Desde la hoja también se vuelve a un punto.
    await hoja.getByRole('button', { name: /^A qué te dedicas: Comida a domicilio · 677\.9\. Cambiar$/ }).click()
    await expect(hoja).toHaveCount(0)
    await expect(log(page).getByText(/Volvemos a «A qué te dedicas»\./)).toBeVisible()
    await expect(log(page).getByText(/^¿A qué os dedicáis\?/).last()).toBeVisible()
  } finally {
    await borrarEmpresas(s, CUENTA_C.id, true)
  }
})

// ── Cuenta B ────────────────────────────────────────────────────────────────

test('cuenta B (Canarias, sin interruptor ni Cocina): su sugerencia, con sus datos, y nada de A', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Solo lee: basta un tamaño')
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta/ajustes')
  await expect(page.getByRole('heading', { level: 2, name: 'Tu empresa' })).toBeVisible()
  await expect(page.getByText('Cocina de Prueba Sur, S.L.').first()).toBeVisible()
  // La regla es la misma; el dato que la fundamenta, el de B. No se contesta:
  // contestarla la cerraría para siempre y la prueba no se podría repetir.
  const sugerencia = page.getByRole('region', { name: 'Lo que propone Folvy' })
  await expect(sugerencia.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toBeVisible()
  await expect(sugerencia.getByText(/Lo veo en Locales del Sur \(alquiler\)/)).toBeVisible()
  await expect(page.getByText(/Locales del Norte/)).toHaveCount(0)
  await expect(page.getByText(/Admin Norte/)).toHaveCount(0)
  // Y sin alta a medias de nadie.
  await expect(page.getByRole('status', { name: 'Alta a medias' })).toHaveCount(0)
})
