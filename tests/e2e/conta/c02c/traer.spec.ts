/// <reference lib="dom" />
// tests/e2e/conta/c02c/traer.spec.ts
//
// C02c · «Traer tu plan de otro programa» (maqueta N8Importar), con la fixture
// INVENTADA de tests/conta/fixtures/importar/diez/ (misma forma que el Diez
// del primer cliente; nombres y NIF falsos).
//
// Cada prueba crea su propia empresa en la cuenta A (con el plan sin activar)
// y la borra al acabar. El ordenador recorre el asistente entero: Diez →
// soltar los tres ficheros → revisar y decidir → traer → el plan abierto con
// «Tuya · de Diez» → «Deshacer entero» en el historial. El móvil llega a la
// revisión, la guarda, vuelve y la tira: si los dos tamaños trajeran a la vez,
// las fichas que crea uno casarían por NIF en el otro.
// Capturas en docs/conta/capturas/c02c/ (COMPARACION.md, frente a N8Importar).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c02c'
const FIXTURE = 'tests/conta/fixtures/importar/diez'
const FICHEROS = ['plan.csv', 'proveedores.csv', 'clientes.csv'].map((f) => `${FIXTURE}/${f}`)

async function crearEmpresa(s: Sesion, nombre: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: nombre, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, 'se crea la empresa de prueba').toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, 'y su perfil fiscal: pymes, 8 dígitos').toBe(201)
  return id
}

async function limpiar(s: Sesion, id: string | null) {
  if (!id) return
  // Si quedó algo traído, se deshace (borra cuentas y fichas nuevas); si quedó una revisión, se tira.
  const imp = await rest<{ id: string; status: string }[]>(s, 'GET', `company_chart_import?select=id,status&company_id=eq.${id}&status=in.(revision,traida)`)
  for (const i of imp.datos ?? []) {
    await rest(s, 'POST', i.status === 'traida' ? 'rpc/company_chart_import_undo' : 'rpc/company_chart_import_discard', { p_import: i.id })
  }
  const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  expect(b.status, `borrar la empresa de prueba ${id}: ${JSON.stringify(b.datos)}`).toBeLessThan(300)
}

async function borrarRestos(s: Sesion) {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&legal_name=like.Traer%20e2e*`)
  for (const c of r.datos ?? []) await limpiar(s, c.id)
}

/** Abre el plan contable de ESA empresa (la elegida se guarda por cuenta en el navegador). */
async function abrirPlan(page: Page, empresa: string) {
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
  await page.goto('/conta/ajustes/plan')
}

async function hastaLaRevision(page: Page) {
  await expect(page.getByRole('heading', { name: '¿Vienes de otro programa?' })).toBeVisible()
  await page.getByRole('button', { name: /^Cegid Diez/ }).click()
  await expect(page.getByRole('heading', { name: 'Traer tu plan de Cegid Diez' })).toBeVisible()
  await page.getByLabel('Elegir los ficheros').setInputFiles(FICHEROS)
  await expect(page.getByRole('status').filter({ hasText: /cuentas, 96 tuyas · plan de pymes · 8 dígitos, igual que aquí/ })).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente: revisar →' }).click()
  await expect(page.getByRole('table', { name: 'Cuentas que se traen' })).toBeVisible()
}

const fila = (page: Page, code: string) => page.getByRole('table', { name: 'Cuentas que se traen' }).getByRole('row').filter({ hasText: code }).first()

test('ordenador: traer el plan de Diez, verlo con su número y deshacerlo entero', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Trae y deshace: solo en un tamaño (ver la cabecera)')
  const s = await entrarComo(page, CUENTA_A.email)
  // Si la pantalla se cae, que el log lo diga (el informe de Playwright no siempre se puede bajar).
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[consola ${m.type()}] ${m.text().slice(0, 300)}`) })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`[navega] ${f.url()}`) })
  await borrarRestos(s)
  let id: string | null = null
  try {
    id = await crearEmpresa(s, `Traer e2e ${Date.now()}`)
    await abrirPlan(page, id)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/paso1-ordenador.png`, fullPage: true })
    await hastaLaRevision(page)

    // Las cuatro cifras y lo que manda la regla (encargo §4, respuesta 1).
    await expect(page.getByText('Entran tal cual')).toBeVisible()
    await expect(page.getByText('472 y 477: aquí van por tipo de IVA; el 303 suma igual')).toBeVisible()
    await page.getByRole('button', { name: /^Todas · 98$/ }).click()
    await expect(fila(page, '41000001')).toContainText('GLOVOAPP SPAIN PLATFORM · ficha nueva, por completar')
    await expect(fila(page, '43000001')).toContainText('mismo nombre que el 41000001')
    await expect(fila(page, '43000005')).toContainText('Seguro')
    await expect(fila(page, '57200002')).toContainText('Cuenta tuya, sin ficha')
    await page.getByRole('button', { name: /^Para revisar · \d+$/ }).click()
    await expect(fila(page, '47510015')).toContainText('hay 2 iguales: 47510015 y 47510019')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/revisar-ordenador.png`, fullPage: true })
    console.log(`[tras la captura] tabla: ${await page.getByRole('table', { name: 'Cuentas que se traen' }).count()}`)
    expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
    console.log(`[tras medir] tabla: ${await page.getByRole('table', { name: 'Cuentas que se traen' }).count()}`)

    // Sin decidir lo dudoso, no se sigue.
    const siguiente = page.getByRole('button', { name: 'Siguiente: traer el plan →' })
    if (!(await siguiente.count())) console.log(`[sin «Siguiente»] ${page.url()}\n${(await page.locator('body').innerText()).slice(0, 3000)}`)
    await expect(siguiente).toBeDisabled()
    // «Decide tú»: 111 a la 47510015, ninguno a la 47510019; lo demás, cuenta suya sin ficha o solo cliente.
    await fila(page, '47510015').getByRole('button', { name: '111' }).click()
    await fila(page, '47510019').getByRole('button', { name: 'Ninguno' }).click()
    for (let i = 0; i < 40; i++) {
      const dudosa = page.locator('.cx-traer-fila-decide').first()
      if (!(await dudosa.count())) break
      const sinFicha = dudosa.getByRole('button', { name: 'Cuenta mía sin ficha' })
      await (await sinFicha.count() ? sinFicha : dudosa.getByRole('button', { name: 'Solo es cliente' })).click()
    }
    // Buscar: «Glovo».
    await page.getByRole('button', { name: /^Todas · 98$/ }).click()
    await page.getByRole('searchbox', { name: 'Buscar en la revisión' }).fill('Glovo')
    await expect(page.getByRole('table', { name: 'Cuentas que se traen' }).getByRole('row')).toHaveCount(5)
    await page.getByRole('searchbox', { name: 'Buscar en la revisión' }).fill('')

    // Paso 3: lo que va a pasar, en palabras; traer.
    await page.getByRole('button', { name: 'Siguiente: traer el plan →' }).click()
    await expect(page.getByText(/^96 cuentas tuyas con su número de Diez · \d+ enlazadas · \d+ fichas nuevas · el IVA pasa a ir por tipo\.$/)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/paso3-ordenador.png`, fullPage: true })
    await page.getByRole('button', { name: 'Traer el plan' }).click()
    await expect(page.getByText(/^Plan traído de Cegid Diez: 96 cuentas con su número de Diez, \d+ fichas nuevas por completar y \d+ cuentas del BOE; el IVA ya va por tipo\./)).toBeVisible()

    // El plan, abierto, con las de Diez marcadas.
    const buscar = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
    await expect(buscar).toBeVisible()
    await buscar.fill('40000001')
    const arbol = page.getByRole('treegrid', { name: 'Plan contable' })
    await expect(arbol.locator('[role="row"][data-numero="40000001"]')).toContainText('Tuya · de Diez')
    await buscar.fill('47200021')
    await expect(arbol.locator('[role="row"][data-numero="47200021"]')).toBeVisible()
    await buscar.fill('')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/plan-traido-ordenador.png`, fullPage: true })

    // «Deshacer entero» en el historial: vuelve a «sin activar» y lo dice.
    const historial = page.getByRole('list', { name: 'Historial de cambios' })
    await expect(historial.getByText(/^Plan traído de Cegid Diez · 96 cuentas · \d+ enlaces · \d+ fichas nuevas$/)).toBeVisible()
    page.once('dialog', (d) => void d.accept())
    await historial.getByRole('button', { name: 'Deshacer entero' }).click()
    await expect(page.getByText(/^Deshecho el plan traído: se han quitado 96 cuentas y \d+ fichas nuevas\./)).toBeVisible()
    await expect(page.getByRole('heading', { name: '¿Vienes de otro programa?' })).toBeVisible()
    const quedan = await rest<unknown[]>(s, 'GET', `supplier?select=id&account_id=eq.${CUENTA_A.id}&import_id=not.is.null`)
    expect(quedan.datos, 'deshacer no deja fichas nuevas').toHaveLength(0)
  } finally {
    await limpiar(s, id)
  }
})

test('móvil: la revisión se guarda para seguir luego, y se tira', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'Ordenador: la prueba de arriba')
  const s = await entrarComo(page, CUENTA_A.email)
  let id: string | null = null
  try {
    id = await crearEmpresa(s, `Traer e2e movil ${Date.now()}`)
    await abrirPlan(page, id)
    await expect(page.getByRole('heading', { name: '¿Vienes de otro programa?' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/paso1-movil.png`, fullPage: true })
    await hastaLaRevision(page)
    await expect(page.getByText('Si te es más cómodo, guarda y decídelas en el ordenador.')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/revisar-movil.png`, fullPage: true })
    expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

    await page.getByRole('button', { name: 'Guardar y seguir luego' }).click()
    await expect(page.getByText(/^Guardado\. Te quedan \d+ por decidir/)).toBeVisible()
    // Vuelve donde lo dejó.
    await page.reload()
    await expect(page.getByRole('table', { name: 'Cuentas que se traen' })).toBeVisible()
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Tirar y empezar de nuevo' }).click()
    await expect(page.getByText('Revisión tirada: elige otra vez el fichero.')).toBeVisible()
  } finally {
    await limpiar(s, id)
  }
})
