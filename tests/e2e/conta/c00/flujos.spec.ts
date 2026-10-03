/// <reference lib="dom" />
// tests/e2e/conta/c00/flujos.spec.ts
//
// Tarea 8 del C00 (encargo §9.3): los flujos que faltaban, en ordenador Y en
// móvil (390 px):
//   · cambiar de empresa;
//   · rechazar una sugerencia (y que no vuelva);
//   · cambiar un dato puesto por la IA (y que se le quite la marca);
//   · añadir un impuesto propio (y borrarlo).
//
// Cada prueba crea lo suyo y lo borra al acabar, por la API y con la sesión
// del usuario. La segunda empresa se crea TERMINADA y sin el modelo 115: con el
// alquiler de prueba de la cuenta A (seed_c00_sugerencia_prueba.sql), la regla
// del 115 la propone. La regla es real; el dato, de prueba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function crearSegundaEmpresa(s: Sesion, nombre: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: nombre, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, 'se crea la segunda empresa').toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', tax_forms: ['303'] })
  expect(p.status, 'y su perfil fiscal, sin el 115').toBe(201)
  // La forma jurídica la pone «la IA», con su porqué: así sale la marca.
  const ia = await rest(s, 'POST', 'rpc/conta_ia_poner', {
    p_company: id, p_tabla: 'company', p_campo: 'legal_form_code', p_valor: 'nif_b',
    p_motivo: 'La letra B del NIF es la de una sociedad limitada (prueba e2e).',
  })
  expect(ia.status, 'la IA pone el tipo').toBe(200)
  return id
}

async function borrarEmpresa(s: Sesion, id: string | null) {
  if (id) await rest(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
}

async function cambiarA(page: Page, nombre: RegExp) {
  await page.getByRole('button', { name: /Cambiar de empresa/ }).click()
  await page.getByRole('list', { name: 'Tus empresas' }).getByRole('button', { name: nombre }).click()
}

test('cambiar de empresa, rechazar una sugerencia y cambiar un dato que puso la IA', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  const s = await entrarComo(page, CUENTA_A.email)
  const nombre = `Flujos e2e ${info.project.name} ${Date.now()}`
  let id: string | null = null
  try {
    id = await crearSegundaEmpresa(s, nombre)
    await page.goto('/conta/ajustes')
    await expect(page.getByRole('heading', { level: 1, name: 'Tu empresa' })).toBeVisible()

    // Cambiar de empresa (en el móvil, la cabecera sale arriba de «Tu empresa» porque hay dos).
    await cambiarA(page, new RegExp(escapar(nombre)))
    const sugerencia = page.getByRole('region', { name: 'Lo que propone Folvy' })
    await expect(sugerencia.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toBeVisible()
    await expect(sugerencia.getByText(/Lo veo en Locales del Norte \(alquiler\)/)).toBeVisible()

    // Rechazarla: lo dice, y no vuelve al recargar.
    await sugerencia.getByRole('button', { name: 'No, gracias' }).click()
    await expect(page.getByText('Vale, no lo añado. No te lo vuelvo a proponer por lo mismo.')).toBeVisible()
    await page.reload()
    await expect(page.getByText(nombre).first()).toBeVisible()
    await expect(page.getByText(movil ? 'Quién eres' : 'Razón social').first()).toBeVisible() // ya ha cargado
    await expect(page.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toHaveCount(0)

    // Cambiar el tipo, que puso la IA: la marca se va del dato.
    if (movil) await page.getByRole('link', { name: /^Quién eres/ }).click()
    const tipo = page.locator('.cx-dato').filter({ has: page.getByText('Tipo', { exact: true }) })
    await expect(tipo.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })).toBeVisible()
    await page.getByRole('button', { name: 'Cambiar quién eres' }).click()
    await page.getByLabel('Tipo').selectOption({ label: 'Sociedades anónimas' })
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(tipo.getByText('Sociedades anónimas')).toBeVisible()
    await expect(tipo.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })).toHaveCount(0)

    // Y de vuelta a la de siempre.
    if (movil) await page.goto('/conta/ajustes')
    await cambiarA(page, /Taberna de Prueba Norte/)
    await expect(page.getByText(/Taberna de Prueba Norte/).first()).toBeVisible()
  } finally {
    await borrarEmpresa(s, id)
  }
})

test('añadir un impuesto propio y borrarlo', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  const s = await entrarComo(page, CUENTA_A.email)
  const nombre = `Impuesto e2e ${info.project.name} ${Date.now()}`
  try {
    await page.goto('/conta/ajustes/tablas/impuestos')
    await page.getByRole('button', { name: /Añadir impuesto$/ }).click()
    await page.getByLabel('Nombre', { exact: true }).fill(nombre)
    await page.getByLabel('Porcentaje', { exact: true }).fill('7')
    await page.getByLabel('Vale desde').fill('2026-01-01')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status').getByText(`Añadido «${nombre}». Ya sale en tus desplegables.`)).toBeVisible()

    const fila = movil ? page.getByRole('button', { name: new RegExp(escapar(nombre)) }) : page.getByRole('button', { name: `Abrir ${nombre}` })
    await fila.click()
    await page.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('button', { name: 'Sí, borrar' }).click()
    await expect(page.getByRole('status').getByText(`Borrado «${nombre}».`)).toBeVisible()
    await expect(page.getByText(nombre)).toHaveCount(0)
  } finally {
    // Si se quedó a medias, fuera por la API.
    await rest(s, 'DELETE', `tax_rate?account_id=eq.${CUENTA_A.id}&is_system=eq.false&name=like.Impuesto%20e2e*`)
  }
})
