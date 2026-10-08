/// <reference lib="dom" />
// tests/e2e/conta/c03/revision430.spec.ts
//
// C03 · Respuesta 3, contra staging-conta: una 430 traída de Diez que la
// importación dejó como cuenta de PAGO de su proveedor (enlace de pago, sin
// papel) tiene que salir en la revisión y, al confirmar, aparecer en
// «Plataformas». Lo que vio Julio en producción: «Clientes» vacío y la revisión
// con 4 de las 7.
//
// La empresa de prueba es nueva (cuenta A) y su plan se trae por la API con
// tests/e2e/conta/c03/diez-traido.json, generado desde la fixture INVENTADA de
// Diez con el mismo núcleo del asistente (tests/conta/fixtures/importar/diez/traer-por-api.ts).
// Al acabar se quita el papel puesto, se deshace la importación y se borra la empresa.

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c03'
const TRAIDO = JSON.parse(readFileSync('tests/e2e/conta/c03/diez-traido.json', 'utf8')) as { ficheros: string[]; review: unknown; plan: unknown }
const NOMBRE = 'Revision 430 e2e'

async function crearEmpresa(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `${NOMBRE} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, 'se crea la empresa de prueba').toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, 'y su perfil fiscal: pymes, 8 dígitos').toBe(201)
  return id
}

async function limpiar(s: Sesion, id: string) {
  const imp = await rest<{ id: string; status: string }[]>(s, 'GET', `company_chart_import?select=id,status&company_id=eq.${id}&status=in.(revision,traida)`)
  for (const i of imp.datos ?? []) {
    if (i.status === 'traida') {
      // Los papeles que puso la prueba (plataforma, cliente, socio) a las fichas traídas: sin ellos, deshacer no para.
      const fichas = await rest<{ id: string }[]>(s, 'GET', `supplier?select=id&account_id=eq.${CUENTA_A.id}&import_id=eq.${i.id}`)
      const ids = (fichas.datos ?? []).map((f) => f.id)
      if (ids.length) {
        const roles = await rest<{ party_id: string }[]>(s, 'GET', `party_role?select=party_id&account_id=eq.${CUENTA_A.id}&supplier_id=in.(${ids.join(',')})`)
        const partes = [...new Set((roles.datos ?? []).map((r) => r.party_id))]
        if (partes.length) await rest(s, 'DELETE', `party_role?account_id=eq.${CUENTA_A.id}&party_id=in.(${partes.join(',')})&role=neq.supplier`)
        // Lo que archivó la prueba (el socio histórico) se recupera: la ficha es de la cuenta A, no de la empresa.
        for (const pid of partes) await rest(s, 'POST', 'rpc/party_set_archived', { p_party: pid, p_archivar: false, p_nota: null })
      }
    }
    const d = await rest(s, 'POST', i.status === 'traida' ? 'rpc/company_chart_import_undo' : 'rpc/company_chart_import_discard', { p_import: i.id })
    expect(d.status, `deshacer la importación de prueba: ${JSON.stringify(d.datos)}`).toBeLessThan(300)
  }
  const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  expect(b.status, `borrar la empresa de prueba ${id}: ${JSON.stringify(b.datos)}`).toBeLessThan(300)
}

async function abrir(page: Page, empresa: string, ruta: string) {
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
  await page.goto(ruta)
}

test('una 430 con enlace de pago y sin papel sale en la revisión y, al confirmar, en «Plataformas»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Trae, escribe y deshace: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  const restos = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&legal_name=like.${encodeURIComponent(NOMBRE)}*`)
  for (const c of restos.datos ?? []) await limpiar(s, c.id)
  let id: string | null = null
  try {
    id = await crearEmpresa(s)
    // Traer el plan por la API, como lo manda el asistente.
    const imp = await rest<string>(s, 'POST', 'rpc/company_chart_import_save', {
      p_company: id, p_program: 'diez', p_file_names: TRAIDO.ficheros, p_sha: 'c0330000'.padEnd(64, '0'), p_review: TRAIDO.review, p_quien_nombre: 'e2e C03 R3',
    })
    expect(imp.status, `guardar la importación: ${JSON.stringify(imp.datos)}`).toBe(200)
    const traer = await rest<{ cuentas: number }>(s, 'POST', 'rpc/company_chart_import_apply', { p_import: imp.datos, p_plan: TRAIDO.plan, p_quien_nombre: 'e2e C03 R3' })
    expect(traer.status, `traer el plan: ${JSON.stringify(traer.datos)}`).toBe(200)
    // Lo que deja la importación: la 43000001 es cuenta de PAGO de la ficha de su proveedor, y esa ficha no tiene más papel que el de proveedor.
    const pago = await rest<{ entity_id: string; company_account: { code: string } }[]>(s, 'GET',
      `company_account_link?select=entity_id,company_account!inner(code)&company_id=eq.${id}&role=eq.pago&company_account.code=eq.43000001`)
    expect(pago.datos, 'la 43000001 llega como cuenta de pago de un proveedor').toHaveLength(1)
    const tercero = await rest<{ party_id: string; party: { name: string } }[]>(s, 'GET',
      `party_role?select=party_id,party!inner(name)&account_id=eq.${CUENTA_A.id}&supplier_id=eq.${pago.datos[0].entity_id}`)
    const glovo = tercero.datos[0]
    expect(glovo.party.name).toBe('GLOVOAPP SPAIN PLATFORM')
    const papeles = async () => (await rest<{ role: string }[]>(s, 'GET', `party_role?select=role&party_id=eq.${glovo.party_id}`)).datos.map((r) => r.role).sort()
    expect(await papeles(), 'sin papel: solo proveedor').toEqual(['supplier'])

    // «Plataformas»: GLOVOAPP no está. Si el filtro está vacío, la tarjeta lleva a la revisión;
    // en la cuenta A de staging hay otras plataformas (la semilla del C03), y entonces la
    // tarjeta no sale (no tapa filas) y se abre la revisión desde su botón.
    await abrir(page, id, '/conta/clientes-y-proveedores?ver=plataformas')
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes y proveedores' })).toBeVisible()
    await expect(page.getByRole('link', { name: /GLOVOAPP SPAIN PLATFORM/ })).toHaveCount(0)
    const filtroPlataformas = page.getByRole('button', { name: /^Plataformas · \d+$/ })
    await expect(filtroPlataformas).toBeVisible()
    const antes = Number((await filtroPlataformas.textContent())!.match(/(\d+)$/)![1])
    const tarjeta = page.getByRole('status').filter({ hasText: /^Tienes 7 cuentas de clientes traídas de Diez por revisar/ })
    const revision = page.getByRole('region', { name: 'Cuentas de clientes traídas por revisar' })
    if (antes === 0) {
      await expect(tarjeta).toBeVisible()
      await tarjeta.getByRole('button', { name: 'Revisar ahora' }).click()
    } else {
      await expect(tarjeta).toHaveCount(0)
      await revision.getByRole('button', { name: 'Revisar', exact: true }).click()
    }

    // Las siete, también las tres que la importación dejó como cuenta de pago.
    await expect(revision.getByText('7 cuentas de clientes traídas de Diez por revisar')).toBeVisible()
    for (const code of ['43000001', '43000002', '43000003', '43000004', '43000005', '43000006', '43000101']) {
      await expect(revision.getByRole('group', { name: `Cuenta ${code}` })).toBeVisible()
    }
    const fila = revision.getByRole('group', { name: 'Cuenta 43000001' })
    await expect(fila).toContainText('Plataforma de reparto')
    await expect(fila).toContainText('GLOVOAPP SPAIN PLATFORM')
    await expect(fila).toContainText('Seguro')
    await expect(fila).toContainText('Es Glovo y ya está enlazada a 41000001 · GLOVOAPP SPAIN PLATFORM para compensar sus pagos.')
    await expect(revision.getByRole('group', { name: 'Cuenta 43000005' })).toContainText('Socio de marca')
    await expect(revision.getByRole('group', { name: 'Cuenta 43000101' })).toContainText('Cuenta tuya sin ficha')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/revision-430-ordenador.png`, fullPage: true })
    expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])

    // Confirmar: lo dice en pantalla con lo que ha hecho (regla 8).
    await fila.getByRole('button', { name: 'Confirmar 43000001' }).click()
    await expect(page.getByText(/^GLOVOAPP SPAIN PLATFORM pasa a ser plataforma de reparto( \(canal [^)]+\))? y 43000001 su cuenta de cliente\.$/)).toBeVisible()
    await expect(revision.getByText('6 cuentas de clientes traídas de Diez por revisar')).toBeVisible()

    // La base: papel de plataforma y la 430 como su cuenta de cliente.
    expect(await papeles()).toEqual(['platform', 'supplier'])
    const cliente = await rest<unknown[]>(s, 'GET',
      `company_account_link?select=entity_id,company_account!inner(code)&company_id=eq.${id}&entity=eq.customer&role=eq.principal&entity_id=eq.${glovo.party_id}&company_account.code=eq.43000001`)
    expect(cliente.datos, 'la 43000001 es su cuenta de cliente').toHaveLength(1)

    // Y sale en «Plataformas».
    await expect(filtroPlataformas).toHaveText(`Plataformas · ${antes + 1}`)
    await expect(page.getByRole('link', { name: /GLOVOAPP SPAIN PLATFORM/ })).toBeVisible()

    // Respuesta 4 · 6: «Archivarlo (histórico)» archiva de verdad. Como en
    // producción el 06/10: se marca la casilla del socio, se confirma ANTES
    // otra fila (la lista se recarga) y luego el socio. Allí la ficha quedó
    // activa: party_set_archived no llegó a correr (su updated_at no se movió).
    const socio = revision.getByRole('group', { name: 'Cuenta 43000005' })
    await socio.getByRole('checkbox', { name: /Archivarlo/ }).check()
    await expect(socio).toContainText('queda archivado (histórico)')
    await revision.getByRole('group', { name: 'Cuenta 43000101' }).getByRole('button', { name: 'Confirmar 43000101' }).click()
    await expect(revision.getByText('5 cuentas de clientes traídas de Diez por revisar')).toBeVisible()
    await expect(socio.getByRole('checkbox', { name: /Archivarlo/ }), 'la casilla sigue marcada después de recargar').toBeChecked()
    await socio.getByRole('button', { name: 'Confirmar 43000005' }).click()
    // Se espera a que esté hecha (baja el contador), no al texto: «Al confirmar: …» ya lo decía antes de pulsar.
    await expect(revision.getByText('4 cuentas de clientes traídas de Diez por revisar')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/^.+ pasa a ser socio de marca y cliente, con 43000005 como su cuenta de cliente; queda archivado \(histórico\)\.$/)).toBeVisible()
    const enlace5 = await rest<{ entity_id: string }[]>(s, 'GET',
      `company_account_link?select=entity_id,company_account!inner(code)&company_id=eq.${id}&entity=eq.customer&role=eq.principal&company_account.code=eq.43000005`)
    expect(enlace5.datos, 'la 43000005 es la cuenta de cliente del socio').toHaveLength(1)
    const ficha = await rest<{ archived_at: string | null; archived_note: string | null }[]>(s, 'GET', `party?select=archived_at,archived_note&id=eq.${enlace5.datos[0].entity_id}`)
    expect(ficha.datos[0].archived_at, 'la ficha del socio queda archivada').not.toBeNull()
    expect(ficha.datos[0].archived_note).toBe('Histórico: socio de marca traído de Diez')
  } finally {
    if (id) await limpiar(s, id)
  }
})
