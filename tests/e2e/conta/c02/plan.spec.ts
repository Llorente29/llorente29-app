/// <reference lib="dom" />
// tests/e2e/conta/c02/plan.spec.ts
//
// C02, tarea 4: Ajustes como índice (N6Ajustes) y la pantalla «Plan contable»
// (N5Plan dentro del marco de N6), en ordenador y móvil, cuentas A y B. Con
// las capturas junto a las maquetas (docs/conta/capturas/c02/, COMPARACION.md).
//
// El plan se activa la primera vez y se queda activado (las pruebas de la
// ficha de proveedor de la tarea 6 lo usan). Lo que se añade en la prueba se
// deshace en la misma prueba («Deshacer», ocultar y volver a enseñar).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c02'

/** Abre el plan y, si aún no está activado, lo activa (una subcuenta por proveedor) y comprueba que lo dice. */
async function planActivado(page: Page) {
  await page.goto('/conta/ajustes/plan')
  const activar = page.getByRole('button', { name: 'Activar el plan' })
  const tabla = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await expect(activar.or(tabla)).toBeVisible()
  if (await activar.count()) {
    await activar.click()
    await expect(page.getByRole('status').getByText(/^Plan activado: \d+ cuentas de serie, \d+ subcuentas y \d+ enlaces\./)).toBeVisible()
  }
  await expect(tabla).toBeVisible()
}

/** Una fila del árbol por su número (la fila lleva delante la flecha y, al buscar, la ruta). */
const fila = (page: Page, numero: string) => page.getByRole('treegrid', { name: 'Plan contable' }).locator(`[role="row"][data-numero="${numero}"]`)

test('cuenta A: el árbol, «qué se apunta aquí», buscar, añadir y deshacer, ocultar y volver a enseñar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await planActivado(page)

  // El índice dice la cifra real (D2), no la de la maqueta.
  const indice = page.getByRole('navigation', { name: 'Ajustes' })
  await expect(indice.getByRole('link', { name: /^Plan contable\s*Pymes · 8 dígitos · \d+ cuentas$/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Plan de pymes · subcuentas de 8 dígitos · la longitud queda fija con el primer asiento')).toBeVisible()
  // Nada de Cocina en los Ajustes de contabilidad.
  for (const cocina of ['Quién reparte', 'Locales', 'Marcas']) await expect(indice.getByText(cocina)).toHaveCount(0)

  // Respuesta 5: el árbol. Con «Las que usas», el grupo 4 abierto hasta el nivel
  // de cuenta, y abiertas las que tienen subcuentas o enlaces (400, 410, 472).
  await expect(fila(page, '400')).toHaveAttribute('aria-expanded', 'true')
  await expect(fila(page, '40000000')).toHaveAttribute('aria-expanded', 'true')
  await expect(fila(page, '40000002')).toContainText('Proveedores · Hermanos Ruiz')
  await expect(fila(page, '41000001')).toContainText('Acreedores · Locales del Norte (alquiler)')
  await expect(fila(page, '47200021')).toContainText('1 tipo de IVA')
  // Lo que no tiene uso, plegado y con lo que lleva dentro: la 403 (ordena, no esconde).
  await expect(fila(page, '403')).toHaveAttribute('aria-expanded', 'false')
  await expect(fila(page, '403')).toContainText(/Proveedores, empresas del grupo · \d+ cuentas/)
  await expect(fila(page, '40300000')).toHaveCount(0)
  // Respuesta 3 y 4: «qué se apunta aquí» heredado, el del C00 en el IVA y la definición del BOE con «(PGC)».
  await expect(fila(page, '40000000')).toContainText('Lo que debes a quienes te venden género')
  await expect(fila(page, '40000000').locator('.cx-plan-pgc')).toHaveCount(0)
  await expect(fila(page, '47200010')).toContainText('Hostelería, alimentos, transporte')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-ordenador.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

  // Abrir y cerrar: la 403 se abre pinchando en su fila; la 400 se cierra con su flecha y la 40000000 deja de verse.
  await fila(page, '403').click()
  await expect(fila(page, '403')).toHaveAttribute('aria-expanded', 'true')
  await expect(fila(page, '40300000')).toContainText('Deudas con las empresas del grupo en su calidad de proveedores')
  await expect(fila(page, '40300000').locator('.cx-plan-pgc')).toHaveText('(PGC)')
  await page.getByRole('button', { name: 'Cerrar 400 · Proveedores' }).click()
  await expect(fila(page, '400')).toHaveAttribute('aria-expanded', 'false')
  await expect(fila(page, '40000000')).toHaveCount(0)
  await expect(fila(page, '400')).toContainText(/Proveedores · \d+ cuentas · \d+ subcuentas tuyas/)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-ordenador-400-cerrada.png`, fullPage: true })
  // Teclado: → abre la 400 (aria-expanded) y ↓ baja a su primera hija.
  await fila(page, '400').focus()
  await page.keyboard.press('ArrowRight')
  await expect(fila(page, '400')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(fila(page, '40000000')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(fila(page, '40000000')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowLeft')
  await expect(fila(page, '400')).toBeFocused()

  // «Todas»: el estado inicial cambia (todo cerrado hasta el nivel de cuenta) pero lo que has tocado se respeta.
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await expect(fila(page, '410')).toHaveAttribute('aria-expanded', 'false')
  await expect(fila(page, '403')).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Las que usas' }).click()

  // Buscar aplana: solo lo que casa, con su ruta; al borrar, el árbol vuelve como estaba.
  const buscar = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await buscar.fill('alquiler')
  await expect(fila(page, '62100000')).toContainText('El alquiler del local')
  await expect(fila(page, '62100000').locator('.cx-plan-ruta')).toHaveText('6 › 62')
  await expect(fila(page, '400')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-ordenador-busqueda.png`, fullPage: true })
  await buscar.fill('')
  await expect(fila(page, '403')).toHaveAttribute('aria-expanded', 'true')
  await expect(fila(page, '62100000')).toHaveCount(0)

  // Añadir una subcuenta: la siguiente libre, y «Deshacer».
  await page.getByRole('button', { name: 'Añadir subcuenta' }).click()
  const form = page.getByRole('form', { name: 'Añadir subcuenta' })
  await form.getByLabel('De qué cuenta cuelga (busca por nombre o número)').fill('629')
  await form.getByLabel('Cuenta', { exact: true }).selectOption('629')
  await expect(form.getByText(/^Será la 629\d{5}: el siguiente número libre\.$/)).toBeVisible()
  const nombre = `Prueba e2e ${Date.now()}`
  await form.getByLabel('Nombre', { exact: true }).fill(nombre)
  await form.getByRole('button', { name: 'Añadir', exact: true }).click()
  await expect(form.getByRole('status').getByText(new RegExp(`^Creada 629\\d{5} · ${nombre}, bajo la 629\\.$`))).toBeVisible()
  await form.getByRole('button', { name: 'Deshacer' }).click()
  await expect(form.getByRole('status').getByText(/^Deshecho: ya no está la 629\d{5}\.$/)).toBeVisible()
  await form.getByRole('button', { name: 'Cerrar' }).click()

  // Ocultar una sin enlaces desde su «···», y volver a enseñarla (grupo 6).
  await page.getByRole('button', { name: /^6 · Compras y gastos/ }).click()
  await page.getByRole('button', { name: /^Más de 68100000/ }).click()
  await page.getByRole('menuitem', { name: 'Ocultar' }).click()
  await expect(page.getByRole('status').getByText('68100000 oculta: no sale en listas ni en sugerencias.')).toBeVisible()
  await page.getByRole('button', { name: /^Más de 68100000/ }).click()
  await page.getByRole('menuitem', { name: 'Volver a enseñar' }).click()
  await expect(page.getByRole('status').getByText('68100000 vuelve a verse.')).toBeVisible()
  // Una enlazada no se deja ocultar: lo dice la base, y la pantalla lo enseña.
  await page.getByRole('button', { name: /^Más de 62100000/ }).click()
  await page.getByRole('menuitem', { name: 'Ocultar' }).click()
  await expect(page.getByText(/Tiene un enlace activo: cambia antes ese enlace a otra cuenta\./)).toBeVisible()

  // El historial lo cuenta (el de esta vez es el primero: va de lo último a lo primero).
  await expect(page.getByRole('list', { name: 'Historial de cambios' }).getByText(/^Ocultada 68100000/).first()).toBeVisible()
})

test('cuenta A: pinchar en una cuenta lleva a su Mayor; en una con hijas, abre el árbol y «Abrir» da Sumas y saldos', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El móvil va en su prueba')
  const sesion = await entrarComo(page, CUENTA_A.email)
  await planActivado(page)

  // 40000002 (la de un proveedor): toda la fila es el enlace al Mayor.
  await fila(page, '40000002').click()
  await expect(page).toHaveURL(/\/conta\/plan\/40000002$/)
  const mayor = page.getByRole('region', { name: 'Mayor de la cuenta' })
  await expect(mayor.getByRole('heading', { name: '40000002 · Proveedores · Hermanos Ruiz' })).toBeVisible()
  await expect(mayor.locator('.cx-dato').filter({ hasText: 'Saldo' })).toContainText('Sin apuntes todavía')
  await expect(mayor.locator('.cx-dato').filter({ hasText: 'Ejercicio' })).toContainText(/\d{4}/)
  await expect(page.getByRole('region', { name: 'Extracto' }).getByText('Aún no hay apuntes en esta cuenta.')).toBeVisible()
  // Es una subcuenta tuya (la creó el plan para él): se le cambia el nombre; con enlaces no se oculta.
  await expect(mayor.getByRole('button', { name: 'Cambiar nombre' })).toBeVisible()
  await expect(mayor.getByRole('button', { name: 'Ocultar' })).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/mayor-ordenador.png`, fullPage: true })
  await mayor.getByRole('link', { name: /^Ficha del proveedor/ }).click()
  await expect(page).toHaveURL(/\/kitchen\/proveedores\/[^/]+\/contabilidad$/)
  await page.getByRole('region', { name: 'Sus cuentas' }).getByRole('link', { name: /^Mayor de la cuenta 40000002/ }).click()
  await expect(page).toHaveURL(/\/conta\/plan\/40000002$/)
  // Una de serie: nada que editar, y lo dice.
  await page.goto('/conta/plan/62900000')
  await expect(mayor.getByText('Es de serie: su título es el oficial y no se cambia.')).toBeVisible()
  await expect(mayor.getByRole('button', { name: 'Cambiar nombre' })).toHaveCount(0)
  await mayor.getByRole('link', { name: '‹ Plan contable' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan$/)

  // 400: pinchar abre o cierra el árbol; su «Abrir», Sumas y saldos de ese nivel.
  const antes = await fila(page, '400').getAttribute('aria-expanded')
  await fila(page, '400').locator('.cx-plan-cuenta').click()
  await expect(fila(page, '400')).toHaveAttribute('aria-expanded', antes === 'true' ? 'false' : 'true')
  await page.getByRole('link', { name: 'Sumas y saldos de 400 · Proveedores' }).click()
  await expect(page).toHaveURL(/\/conta\/plan\/400$/)
  const sumas = page.getByRole('region', { name: 'Sumas y saldos' })
  await expect(sumas.getByRole('heading', { name: '400 · Proveedores' })).toBeVisible()
  await expect(sumas.getByText('Aún no hay apuntes en este nivel.')).toBeVisible()
  await expect(sumas.getByRole('table', { name: 'Sumas y saldos de 400' }).getByRole('link', { name: /^40000000 · / })).toBeVisible()

  // Una subcuenta tuya: Cambiar nombre (y se deja como estaba).
  await page.goto('/conta/ajustes/plan')
  await page.getByRole('button', { name: 'Añadir subcuenta' }).click()
  const form = page.getByRole('form', { name: 'Añadir subcuenta' })
  await form.getByLabel('De qué cuenta cuelga (busca por nombre o número)').fill('629')
  await form.getByLabel('Cuenta', { exact: true }).selectOption('629')
  const nombre = `Mayor e2e ${Date.now()}`
  await form.getByLabel('Nombre', { exact: true }).fill(nombre)
  await form.getByRole('button', { name: 'Añadir', exact: true }).click()
  await expect(form.getByRole('status')).toContainText(/^Creada 629\d{5}/)
  const creada = (await form.getByRole('status').textContent())!.match(/629\d{5}/)![0]
  const id = (await rest<{ id: string }[]>(sesion, 'GET', `company_account?select=id&code=eq.${creada}&kind=eq.own`)).datos[0].id
  try {
    await page.goto(`/conta/plan/${creada}`)
    await expect(mayor.getByRole('button', { name: 'Ocultar' })).toBeVisible()
    await mayor.getByRole('button', { name: 'Cambiar nombre' }).click()
    await mayor.getByLabel('Nombre', { exact: true }).fill(`${nombre} bis`)
    await mayor.getByRole('button', { name: 'Guardar el nombre' }).click()
    await expect(mayor.getByRole('status').getByText(`${creada} se llama ahora ${nombre} bis. Queda en el historial del plan.`)).toBeVisible()
    await expect(mayor.getByRole('heading', { name: `${creada} · ${nombre} bis` })).toBeVisible()
  } finally {
    // Lo que se crea en la prueba se quita en la prueba: recién creada y sin enlaces, se deshace.
    await rest(sesion, 'POST', 'rpc/company_account_undo_add', { p_id: id, p_quien_nombre: null })
  }
})

test('cuenta A: «Qué va a cada sitio» responde con sus palabras', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Solo lee: basta un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await planActivado(page)
  await page.getByRole('link', { name: 'Qué va a cada sitio' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan\/que-va-a-cada-sitio$/)
  await page.getByRole('searchbox', { name: '¿Dónde va…?' }).fill('¿Dónde va la luz?')
  const res = page.getByRole('list', { name: 'Dónde va cada cosa' })
  await expect(res.getByText('Luz, agua, gas, teléfono e internet.')).toBeVisible()
  await expect(res.getByText(/62800000 · Suministros/)).toBeVisible()
  await page.screenshot({ path: `${DIR}/que-va-a-cada-sitio.png`, fullPage: true })
})

test('cuenta A: el índice de Ajustes (N6), con «aún no» donde aún no hay pantalla', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'El móvil va en su prueba')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/certificados')
  const indice = page.getByRole('navigation', { name: 'Ajustes' })
  for (const g of ['Empresa', 'Contabilidad', 'Acceso y avisos']) await expect(indice.getByRole('heading', { name: g })).toBeVisible()
  await expect(indice.getByRole('link', { name: /^Certificados y accesos\s*Aún no$/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Aún no.')).toBeVisible()
  // Con sus líneas de resumen ya cargadas (como N6), no el esqueleto.
  await expect(indice.getByRole('link', { name: /^Plan contable\s*Pymes · 8 dígitos · \d+ cuentas$/ })).toBeVisible()
  await expect(indice.getByRole('link', { name: /^Ejercicio\s*\d{4} · / })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ajustes-ordenador.png`, fullPage: true })
})

test('cuenta B (Canarias, sin interruptor ni Cocina): su plan con el IGIC, y nada de A', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_B.email)
  await planActivado(page)
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('4720')
  await expect(fila(page, '47200007')).toContainText('IVA soportado 7 %')
  await page.getByRole('searchbox', { name: 'Buscar una cuenta' }).fill('Locales')
  await expect(page.getByRole('treegrid', { name: 'Plan contable' }).getByText('Acreedores · Locales del Sur (alquiler)')).toBeVisible()
  await expect(page.getByText(/Locales del Norte/)).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/plan-b-canarias.png`, fullPage: true })
})

test('cuenta A en el móvil: índice, el plan por niveles y una cuenta en su Mayor', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes')
  await page.getByRole('navigation', { name: 'Ajustes' }).getByRole('link', { name: /^Plan contable/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Plan contable' })).toBeVisible()
  const buscar = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await expect(buscar).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-movil.png`, fullPage: true })
  // Cada nivel es una fila que abre el siguiente, con «atrás».
  await page.getByRole('link', { name: /^40 · PROVEEDORES/ }).click()
  await page.getByRole('link', { name: /^400 · Proveedores/ }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan\?n=400$/)
  await expect(page.getByRole('heading', { level: 1, name: '400 · Proveedores' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^40000000 · Proveedores \(euros\)/ })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-movil-400.png`, fullPage: true })
  await page.getByRole('link', { name: 'Volver a plan contable' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes\/plan\?n=40$/)
  // Buscar también aplana; la fila abre el Mayor en su pantalla.
  await page.goto('/conta/ajustes/plan')
  await buscar.fill('alquiler')
  await page.getByRole('link', { name: /^6 › 62\s*62100000 · Arrendamientos y cánones/ }).click()
  await expect(page).toHaveURL(/\/conta\/plan\/62100000$/)
  await expect(page.getByRole('heading', { level: 1, name: '62100000 · Arrendamientos y cánones' })).toBeVisible()
  await expect(page.getByText('Qué se apunta aquí: El alquiler del local, del datáfono o de máquinas; el canon de la franquicia.')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/plan-movil-cuenta.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})
