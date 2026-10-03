/// <reference lib="dom" />
// tests/e2e/conta/c00/alta.spec.ts
//
// Tarea 6 del C00: el alta conversada (maquetas N1Alta y M1Alta) y la base de
// la IA (origen de cada dato, sugerencia, registro y deshacer), de punta a
// punta y con la RLS de verdad.
//
// Cada prueba crea su propia empresa en la cuenta A, con un NIF inventado y un
// nombre que empieza por «Alta e2e», y la borra al acabar por la API, con la
// sesión del usuario (lo que cuelga de ella se va en cascada). Si una prueba
// anterior se quedó a medias, su empresa se borra antes de empezar: toda
// empresa sin terminar de la cuenta A.
//
// La sugerencia del 115 sale porque la cuenta A tiene un alquiler al 19 % de
// PRUEBA (seed_c00_sugerencia_prueba.sql) y en el alta se contesta que no se
// paga alquiler con retención. La regla es real; el dato, de prueba.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'

async function borrarEmpresasDePrueba(s: Sesion) {
  // Toda empresa SIN TERMINAR de la cuenta A es de estas pruebas: la única de
  // verdad (la de la semilla) está terminada. No se filtra por el nombre,
  // porque una prueba que se rompe a mitad puede haber guardado cualquier cosa
  // en él (le pasó a una: guardó la actividad como razón social).
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&setup_completed_at=is.null`)
  const r2 = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&legal_name=like.Alta%20e2e*`)
  const ids = new Set([...(r.datos ?? []), ...(r2.datos ?? [])].map((c) => c.id))
  for (const id of ids) {
    // La RLS puede «borrar» cero filas sin dar error: se cuenta lo borrado.
    const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${id}`)
    expect(b.status, `Borrar la empresa de prueba ${id}`).toBeLessThan(300)
    expect((b.datos ?? []).length, `Borrar la empresa de prueba ${id}`).toBe(1)
  }
}

async function decir(page: Page, texto: string) {
  const entrada = page.getByRole('textbox', { name: 'Tu respuesta' })
  await expect(entrada).toBeEnabled()
  await entrada.fill(texto)
  await entrada.press('Enter')
}

async function empezarAlta(page: Page, s: Sesion, nombre: string) {
  await page.goto('/conta/alta')
  const log = page.getByRole('log', { name: 'Conversación del alta' })
  await expect(log.getByText(/NIF/).last()).toBeVisible()
  await decir(page, cifInventado())
  await expect(log.getByText('Apuntado. Ahora, el nombre.')).toBeVisible()
  await expect(log.getByText('¿Cómo se llama la empresa? El nombre que sale en el NIF.')).toBeVisible()
  await decir(page, nombre)
  await expect(log.getByText(`Apuntado: ${nombre}.`)).toBeVisible()
  // La dirección: se escribe (la de la cuenta, si la hay, también se podría confirmar).
  await page.getByLabel('Calle').fill('Calle del Ensayo')
  await page.getByLabel('Número').fill('7')
  await page.getByLabel('Código postal').fill('28001')
  await page.getByLabel('Población').fill('Madrid')
  await page.getByRole('button', { name: 'Es esta' }).click()
  await expect(log.getByText('Apuntada la dirección.')).toBeVisible()
  // A qué os dedicáis: lo propone del catálogo oficial y la persona marca.
  await decir(page, 'Restaurante, y también repartimos a domicilio')
  await expect(page.getByText('Epígrafe 671 · Servicios en restaurantes · CNAE 5611 · Restaurantes')).toBeVisible()
  await expect(page.getByText('Epígrafe 677.9 · Otros servicios de alimentación propios de la restauración · CNAE 5611 · Restaurantes')).toBeVisible()
  await page.getByRole('button', { name: 'Añadir las marcadas' }).click()
  await expect(log.getByText('Hecho: 2 actividades. Ahora, tus impuestos.')).toBeVisible()
  await expect(log.getByText('¿Presentas el IVA cada tres meses? Es lo normal en tu caso.')).toBeVisible()
  void s
}

test('cuenta A: el alta conversada entera, y lo que hizo la IA se ve, se explica y se deshace', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: el móvil tiene su prueba')
  const s = await entrarComo(page, CUENTA_A.email)
  await borrarEmpresasDePrueba(s)
  const nombre = `Alta e2e ${Date.now()}`
  try {
    await empezarAlta(page, s, nombre)
    const panel = page.getByRole('complementary', { name: 'Tu empresa' })
    await expect(panel.getByText('Restaurante · Comida a domicilio')).toBeVisible()
    await expect(panel.getByText('Epígrafes 671 y 677.9')).toBeVisible()
    await expect(panel.getByText('Te lo estoy preguntando')).toBeVisible()
    await expect(panel.getByText('3 de 5')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/alta-ordenador.png`, fullPage: true })

    const log = page.getByRole('log', { name: 'Conversación del alta' })
    await page.getByRole('button', { name: 'Sí, cada tres meses' }).click()
    await page.getByRole('button', { name: 'Sí', exact: true }).click() // nóminas o profesionales
    await expect(log.getByText('¿Pagas el alquiler de un local con retención?')).toBeVisible()
    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(log.getByText('Con eso, presentas los modelos 111, 202, 303, 390. El porqué de cada uno está en «Tu empresa».')).toBeVisible()
    // «No lo sé»: deja la normal y lo apunta.
    await page.getByRole('button', { name: 'No lo sé, que lo mire mi asesor' }).click()
    await expect(log.getByText('Lo dejo en «Sí, déjalo así», que es lo normal, y se lo apunto a tu asesor como duda.')).toBeVisible()
    await page.getByRole('button', { name: 'Lo pongo luego' }).click()
    await expect(log.getByText(/^Listo: tu empresa está montada\./)).toBeVisible()

    // En «Tu empresa»: la marca, la sugerencia real y el registro.
    await log.getByRole('link', { name: 'Tu empresa' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tu empresa' })).toBeVisible()
    await expect(page.getByText(nombre).first()).toBeVisible()
    const marcas = page.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })
    await expect(marcas.first()).toBeVisible()
    await marcas.first().click()
    await expect(page.getByRole('note').first()).toBeVisible()

    const sugerencia = page.getByRole('region', { name: 'Lo que propone Folvy' })
    await expect(sugerencia.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toBeVisible()
    await expect(sugerencia.getByText(/Lo veo en Locales del Norte \(alquiler\)/)).toBeVisible()
    await page.screenshot({ path: `${DIR}/ia-sugerencia.png`, fullPage: true })
    await sugerencia.getByRole('button', { name: 'Sí, añádelo' }).click()
    await expect(page.getByText('Añadido el modelo 115 a lo que presentas. Si no era así, lo deshaces en «Lo que ha hecho Folvy».')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Lo que propone Folvy' })).toHaveCount(0)

    const registro = page.getByRole('list', { name: 'Lo que ha hecho Folvy' })
    await expect(registro.getByText('Puso los modelos que presentas: 111, 115, 202, 303, 390').or(registro.getByText('Cambió los modelos que presentas: 111, 115, 202, 303, 390'))).toBeVisible()
    await registro.getByRole('button', { name: /^Deshacer: (Puso|Cambió) los modelos que presentas: 111, 115/ }).click()
    await expect(page.getByText(/^Deshecho: (puso|cambió) los modelos que presentas: 111, 115, 202, 303, 390\./)).toBeVisible()
    await expect(registro.getByText('Deshecho por Admin Norte').first()).toBeVisible()
    // Deshecha, la sugerencia NO vuelve: ya se contestó.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Tu empresa' })).toBeVisible()
    await expect(page.getByText('Pagas un alquiler con retención y no tienes el modelo 115. ¿Lo añado?')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/ia-registro.png`, fullPage: true })
    expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
  } finally {
    await borrarEmpresasDePrueba(s)
  }
})

test('cuenta A en el móvil: el alta, como M1', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La forma del móvil')
  const s = await entrarComo(page, CUENTA_A.email)
  await borrarEmpresasDePrueba(s)
  try {
    await empezarAlta(page, s, `Alta e2e móvil ${Date.now()}`)
    await expect(page.getByText('3 de 5')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ver todo' })).toBeVisible()
    // La tarjeta de arriba dice lo ÚLTIMO que apuntó: la segunda actividad.
    const tarjeta = page.getByRole('region', { name: 'Tu empresa' })
    await expect(tarjeta.getByText('Añadió la actividad «Comida a domicilio»')).toBeVisible()
    await expect(tarjeta.getByRole('button', { name: 'Lo puso Folvy. Ver por qué' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/alta-movil.png`, fullPage: true })
    // Se sigue desde otro dispositivo: al volver a entrar, sigue donde lo dejó.
    await page.goto('/conta/alta')
    await expect(page.getByText(/^Seguimos donde lo dejaste/)).toBeVisible()
    await expect(page.getByText('¿Presentas el IVA cada tres meses? Es lo normal en tu caso.')).toBeVisible()
  } finally {
    await borrarEmpresasDePrueba(s)
  }
})
