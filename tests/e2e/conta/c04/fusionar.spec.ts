/// <reference lib="dom" />
// tests/e2e/conta/c04/fusionar.spec.ts
//
// C04 R4 · «Fusionar con…» desde la ficha, contra staging-conta (cuenta A).
// El caso de producción con nombres inventados: la ficha que trajo el
// programa anterior (proveedor + cliente, sin NIF, activa) y el proveedor
// viejo de Cocina (archivado, con NIF y además socio de marca). Se fusiona la
// vieja en la nueva y se deshace. Al acabar se borran los dos proveedores de
// prueba (y con ellos sus terceros y el rastro de la fusión).

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { borrarProveedor, cifInventado, rest } from '../api'

const DIR = 'docs/conta/capturas/c04'
const PREFIJO = 'Fusion e2e'

test('A · fusionar dos fichas del mismo tercero, con rastro y deshacer', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe y deshace: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  // Restos de una ejecución anterior que no acabó.
  const restos = await rest<{ id: string }[]>(s, 'GET', `supplier?select=id&account_id=eq.${CUENTA_A.id}&name=like.${encodeURIComponent(PREFIJO)}*`)
  for (const r of restos.datos ?? []) await borrarProveedor(s, r.id)

  const sello = String(Date.now()).slice(-6)
  const nuevo = `${PREFIJO} Marcas ${sello}`
  const viejo = `${PREFIJO} MARCAS VIEJO ${sello}`
  const nif = cifInventado()
  const ids: string[] = []
  try {
    const a = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: nuevo })
    const b = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: viejo, tax_id: nif, tax_id_type: 'nif_es', country_code: 'ES' })
    expect(a.status).toBe(201); expect(b.status).toBe(201)
    ids.push(a.datos[0].id, b.datos[0].id)
    const partyDe = async (sup: string) => (await rest<{ party_id: string }[]>(s, 'GET', `party_role?select=party_id&supplier_id=eq.${sup}`)).datos[0].party_id
    const queda = await partyDe(ids[0]); const seVa = await partyDe(ids[1])
    expect(queda).not.toBe(seVa)
    // La nueva: también cliente (así abre su ficha de tercero). La vieja: socio de marca y archivada.
    expect((await rest(s, 'POST', 'rpc/party_add_role', { p_party: queda, p_role: 'customer', p_config: {} })).status).toBe(200)
    expect((await rest(s, 'POST', 'rpc/party_add_role', { p_party: seVa, p_role: 'brand_partner', p_config: {} })).status).toBe(200)
    expect((await rest(s, 'POST', 'rpc/party_set_archived', { p_party: seVa, p_archivar: true, p_nota: 'proveedor viejo' })).status).toBe(200)
    const papeles = async (p: string) => (await rest<{ role: string }[]>(s, 'GET', `party_role?select=role&party_id=eq.${p}`)).datos.map((r) => r.role).sort()
    const ficha = async (p: string) => (await rest<{ tax_id: string | null; archived_at: string | null; archived_note: string | null }[]>(s, 'GET', `party?select=tax_id,archived_at,archived_note&id=eq.${p}`)).datos[0]
    const antes = { queda: { papeles: await papeles(queda), ficha: await ficha(queda) }, seVa: { papeles: await papeles(seVa), ficha: await ficha(seVa) } }
    expect(antes.queda.papeles).toEqual(['customer', 'supplier'])
    expect(antes.seVa.papeles).toEqual(['brand_partner', 'supplier'])

    // La ficha que queda: «···» → «Fusionar con…» → buscar la vieja (archivada: también sale) → Fusionar.
    await page.goto(`/conta/clientes-y-proveedores/${queda}`)
    await expect(page.getByRole('heading', { level: 1, name: nuevo })).toBeVisible()
    await page.getByRole('button', { name: 'Más acciones' }).click()
    await page.getByRole('menuitem', { name: 'Fusionar con…' }).click()
    const dialogo = page.getByRole('dialog', { name: `Fusionar con ${nuevo}` })
    await dialogo.getByLabel('Buscar por nombre o NIF').fill(`VIEJO ${sello}`)
    await dialogo.getByRole('option', { name: new RegExp(`${viejo} · ${nif} · archivada`) }).click()
    await expect(dialogo.getByText(`pasa a archivada con «Fusionado con ${nuevo}»`)).toBeVisible()
    await page.screenshot({ path: `${DIR}/fusionar-dialogo-ordenador.png` })
    await dialogo.getByRole('button', { name: 'Fusionar' }).click()

    // Regla 8: lo dice con contenido.
    const resumen = `${viejo} fusionado en ${nuevo}: 1 dato movido, con su NIF ${nif}; se queda en ${viejo} (archivada) lo que ${nuevo} ya tenía: su papel de proveedor.`
    await expect(page.getByText(`${resumen} Se puede deshacer arriba.`)).toBeVisible()
    // Y el rastro, con «Deshacer», en la ficha.
    const franja = page.getByRole('status', { name: 'Fusión' })
    await expect(franja).toContainText(resumen)
    await page.screenshot({ path: `${DIR}/fusionar-hecho-ordenador.png` })

    // La base: el papel de socio y el NIF pasan a la que queda; la vieja, archivada con su nota y solo con su proveedor de Cocina.
    expect(await papeles(queda)).toEqual(['brand_partner', 'customer', 'supplier'])
    expect(await papeles(seVa)).toEqual(['supplier'])
    expect((await ficha(queda)).tax_id).toBe(nif)
    const fueraVieja = await ficha(seVa)
    expect(fueraVieja.tax_id).toBeNull()
    expect(fueraVieja.archived_note).toBe(`Fusionado con ${nuevo}`)
    const rastro = await rest<{ summary: string; done_by_name: string | null; undone_at: string | null }[]>(s, 'GET', `party_merge?select=summary,done_by_name,undone_at&kept_party_id=eq.${queda}`)
    expect(rastro.datos).toHaveLength(1)
    expect(rastro.datos[0].summary).toBe(resumen)
    expect(rastro.datos[0].undone_at).toBeNull()

    // Deshacer: todo como estaba.
    await franja.getByRole('button', { name: 'Deshacer' }).click()
    await expect(page.getByText('Fusión deshecha: las dos fichas vuelven a estar como antes.')).toBeVisible()
    await expect(page.getByRole('status', { name: 'Fusión' })).toHaveCount(0)
    expect({ queda: { papeles: await papeles(queda), ficha: await ficha(queda) }, seVa: { papeles: await papeles(seVa), ficha: await ficha(seVa) } }).toEqual(antes)
    const deshecha = await rest<{ undone_at: string | null; undone_by_name: string | null }[]>(s, 'GET', `party_merge?select=undone_at,undone_by_name&kept_party_id=eq.${queda}`)
    expect(deshecha.datos[0].undone_at).not.toBeNull()
  } finally {
    for (const id of ids) await borrarProveedor(s, id)
  }
})
