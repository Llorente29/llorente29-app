/// <reference lib="dom" />
// tests/e2e/laboral/l1a-avisos.spec.ts
//
// L1a · PR 3 (28/10/2026): el aviso de olvido en el portal y su contador en
// Equipo, de verdad, en staging-conta (cuenta A del carril), con capturas en
// ordenador y en móvil. Lo que va en la 1800 (solo añade) está en staging
// desde la rama; la detección, los botones de WhatsApp, fuera del radio y el
// vigía los prueba la de staging (20261028_l1a3_avisos_prueba.sql).
//
//   · El administrador deja preparado un olvido: una entrada del trabajador
//     de prueba puesta a mano hace unos minutos (la última de sus marcas, para
//     que siga abierta) y su aviso, como lo dejaría la detección fuera de la
//     franja del WhatsApp (solo portal).
//   · El trabajador abre su portal: «Hoy no fichaste la salida. Tu turno …
//     acababa a las HH:MM.» con [Salí a las HH:MM] y [Otra hora]. Pulsa el
//     primero y la tarjeta dice lo que ha hecho (regla 8): la petición, no el
//     fichaje.
//   · El administrador abre Equipo: el contador de la semana. Y el aviso «no
//     están saliendo» tal como lo pinta la pantalla: ése lo escribe el vigía
//     con la clave de servicio, que la e2e no tiene, así que la captura lleva
//     una fila servida por la propia prueba (page.route), y se dice.
//
// Corre solo en «ordenador» y saca las dos capturas cambiando el tamaño: los
// dos proyectos sobre el mismo trabajador se pisarían la entrada abierta.
// Al acabar lo deja todo como estaba: la petición rechazada, la entrada
// anulada y el aviso borrado (y al empezar, lo de un run que se cortó).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, enCarril, entrarComo, pedirSesion, type Sesion } from '../conta/sesion'
import { rest } from '../conta/api'

const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')
const TRABAJADOR_FICHA = enCarril('c01a0000-0000-4000-8000-0000000000e7') // «Trabajador de Prueba»
const MOTIVO = 'Prueba e2e del aviso de olvido'
const MOVIL = { width: 390, height: 844 }

async function captura(page: Page, nombre: string) {
  const fichero = `${test.info().project.name}-${nombre}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

const horaMadrid = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

interface Fila { id: string; clock_entry_id?: string; correction_request_id?: string | null }

/**
 * Lo de un run anterior que se cortó, o lo de éste: fuera. Cada entrada que
 * pone la prueba tiene su aviso (se crean seguidos), así que el aviso dice qué
 * entrada anular y qué petición rechazar.
 */
async function limpiar(s: Sesion) {
  const avisos = await rest<Fila[]>(s, 'GET', `clockout_reminder_log?employee_id=eq.${TRABAJADOR_FICHA}&entrada_at=not.is.null&select=id,clock_entry_id,correction_request_id`)
  for (const a of Array.isArray(avisos.datos) ? avisos.datos : []) {
    await rest(s, 'DELETE', `clockout_reminder_log?id=eq.${a.id}`)
    if (a.correction_request_id) {
      await rest(s, 'POST', 'rpc/resolve_clock_correction', { p_request_id: a.correction_request_id, p_approve: false, p_note: 'Limpieza de la e2e del aviso de olvido', p_actor_label: 'e2e' })
    }
    if (a.clock_entry_id) {
      await rest(s, 'POST', 'rpc/void_clock_entry', { p_entry_id: a.clock_entry_id, p_reason: 'Limpieza de la e2e del aviso de olvido', p_actor_label: 'e2e' })
    }
  }
}

test('el olvido de salida: la tarjeta del portal contesta en un toque, y Equipo lo cuenta', async ({ page }) => {
  test.skip(test.info().project.name !== 'ordenador', 'Una sola vez: los dos tamaños salen de este test.')
  test.setTimeout(3 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))

  const s = await pedirSesion(CUENTA_A.email)
  const hay = await rest(s, 'POST', 'rpc/mis_avisos_olvido', {})
  expect(hay.status, `La 1800 no está en staging (mis_avisos_olvido): ${JSON.stringify(hay.datos)}`).toBe(200)
  await limpiar(s)

  try {
    // El olvido: la entrada, la última de sus marcas, y su aviso (solo portal).
    const ficha = await rest<Array<{ location_id: string; account_id: string }>>(s, 'GET', `employees?id=eq.${TRABAJADOR_FICHA}&select=location_id,account_id`)
    const { location_id, account_id } = ficha.datos[0]
    const entradaAt = new Date(Date.now() - 3 * 60_000).toISOString()
    const finTurno = new Date(Date.now() - 60_000).toISOString()
    const e = await rest<{ id: string }>(s, 'POST', 'rpc/add_manual_clock_entry', {
      p_employee_id: TRABAJADOR_FICHA, p_type: 'entrada', p_datetime: entradaAt, p_reason: MOTIVO, p_actor_label: 'e2e', p_force: true,
    })
    expect(e.status, `add_manual_clock_entry: ${JSON.stringify(e.datos)}`).toBe(200)
    const aviso = await rest<Fila[]>(s, 'POST', 'clockout_reminder_log', {
      account_id, employee_id: TRABAJADOR_FICHA, clock_entry_id: e.datos.id, location_id,
      entrada_at: entradaAt, fin_turno: finTurno, salta_at: finTurno, scheduled_end: horaMadrid(finTurno),
      canal: 'portal', status: 'skipped', skip_reason: 'fuera_de_hora',
    })
    expect(aviso.status, `el aviso: ${JSON.stringify(aviso.datos)}`).toBe(201)
    const fin = horaMadrid(finTurno)

    // El portal del trabajador.
    await entrarComo(page, TRABAJADOR)
    await page.goto('/')
    const tarjeta = page.locator('[data-prueba="olvido-de-salida"]')
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta).toContainText('Hoy no fichaste la salida.')
    await expect(tarjeta).toContainText(`acababa a las ${fin}`)
    await expect(tarjeta.getByRole('button', { name: `Salí a las ${fin}` })).toBeVisible()
    await expect(tarjeta.getByRole('button', { name: 'Otra hora' })).toBeVisible()
    await expect(tarjeta).toContainText('La propuesta la aprueba tu encargado')
    await captura(page, 'l1a3-portal-olvido')
    await page.setViewportSize(MOVIL)
    await captura(page, 'l1a3-portal-olvido-movil')

    // «Otra hora» pide la hora; y «Salí a las …» crea la petición.
    await tarjeta.getByRole('button', { name: 'Otra hora' }).click()
    await expect(tarjeta.getByLabel('Hora de salida')).toBeVisible()
    await captura(page, 'l1a3-portal-otra-hora-movil')
    // Con la hora a la vista, «Salí a las …» (enlace) vuelve a los dos botones; y el de verdad contesta.
    await tarjeta.getByRole('button', { name: `Salí a las ${fin}` }).click()
    await expect(tarjeta.getByLabel('Hora de salida')).toBeHidden()
    await tarjeta.getByRole('button', { name: `Salí a las ${fin}` }).click()
    await expect(tarjeta.getByRole('status')).toContainText(`Hecho: le hemos pedido a tu encargado que apunte tu salida a las ${fin}`, { timeout: 15_000 })
    await captura(page, 'l1a3-portal-olvido-hecho-movil')
    const despues = await rest<Fila[]>(s, 'GET', `clockout_reminder_log?id=eq.${aviso.datos[0].id}&select=id,correction_request_id`)
    expect(despues.datos[0]?.correction_request_id, 'la respuesta no dejó la petición').toBeTruthy()
    const marcas = await rest<Array<{ id: string }>>(s, 'GET', `clock_entries?employee_id=eq.${TRABAJADOR_FICHA}&datetime=gt.${encodeURIComponent(entradaAt)}&voided=eq.false&select=id`)
    expect(marcas.datos, 'la respuesta escribió un fichaje').toEqual([])

    // Equipo, como administrador: el contador; y el aviso «no salen» servido por la prueba.
    await page.setViewportSize({ width: 1440, height: 900 })
    await entrarComo(page, CUENTA_A.email)
    await page.goto('/personal')
    const contador = page.locator('[data-prueba="contador-avisos"]')
    await expect(contador).toBeVisible({ timeout: 30_000 })
    await expect(contador).toContainText('solo en el portal')
    await expect(contador).toContainText(/\d+ respondidos?/)
    await page.locator('[data-prueba="avisos-de-olvido"]').scrollIntoViewIfNeeded()
    await captura(page, 'l1a3-equipo-contador')

    await page.route('**/rest/v1/aviso_empresa*', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: '00000000-0000-4000-8000-00000000a1a3', tipo: 'avisos_olvido_fallan', titulo: 'Los avisos de olvido de fichaje no están saliendo',
        texto: 'Hoy no ha salido 1 aviso de olvido por WhatsApp. El motivo: La plantilla de WhatsApp no existe en Meta (o no está aprobada en español). Hasta que se arregle, nadie recibe el WhatsApp: cada persona lo ve al abrir su portal.',
        creado_at: new Date().toISOString(), correo_estado: 'enviado' }]),
    }))
    await page.reload()
    await expect(page.locator('[data-prueba="avisos-no-salen"]')).toContainText('no están saliendo', { timeout: 30_000 })
    await captura(page, 'l1a3-equipo-no-salen')
    await page.setViewportSize(MOVIL)
    await page.locator('[data-prueba="avisos-de-olvido"]').scrollIntoViewIfNeeded()
    await captura(page, 'l1a3-equipo-no-salen-movil')
    await page.unroute('**/rest/v1/aviso_empresa*')

    expect(errores, `errores de la página: ${errores.join(' | ')}`).toEqual([])
  } finally {
    await limpiar(s)
  }
})

// L1a · PR 3 (28/10, Julio): el móvil de Natacha daba la «ubicación
// aproximada» del navegador (670 m siempre, con sus compañeras a 4–6 m). Con
// una precisión de más de 100 m, la pantalla de fichar lo dice en el momento,
// con los pasos para Android y para iPhone, y no lo trata como «fuera del
// radio». No llega a fichar: solo abre la pantalla y vuelve.
test('una ubicación aproximada: la pantalla de fichar lo dice en el momento, con los pasos', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'ordenador', 'Una sola vez: los dos tamaños salen de este test.')
  test.setTimeout(2 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 40.4228, longitude: -3.7038, accuracy: 1500 })

  await entrarComo(page, TRABAJADOR)
  await page.goto('/')
  await page.getByRole('button', { name: /^Fichar (entrada|salida)/ }).click()
  const aviso = page.locator('[data-prueba="ubicacion-aproximada"]')
  await expect(aviso).toBeVisible({ timeout: 30_000 })
  await expect(aviso).toContainText('Tu móvil está dando una ubicación aproximada: activa la ubicación precisa')
  await expect(aviso).toContainText('± 1,5 km')
  await expect(aviso).toContainText('no como fuera del radio')
  await aviso.getByText('Cómo activarla en Android').click()
  await expect(aviso).toContainText('Usar ubicación precisa')
  await aviso.getByText('Cómo activarla en iPhone').click()
  await expect(aviso).toContainText('Ubicación exacta')
  // No es «fuera del radio»: no sale «Estás a … del local».
  await expect(page.getByText(/^Estás a \d+ ?m del local/)).toHaveCount(0)
  await captura(page, 'l1a3-ubicacion-aproximada')
  await page.setViewportSize(MOVIL)
  await captura(page, 'l1a3-ubicacion-aproximada-movil')
  expect(errores, `errores de la página: ${errores.join(' | ')}`).toEqual([])
})
