/// <reference lib="dom" />
// tests/e2e/conta/e03/de-quien-es.spec.ts
//
// E03 · Sumied pregunta de quién es una recibida, no decide solo. Contra
// staging-conta de verdad, cuenta A, a 1456 × 816 y en móvil:
//
//   1. Una a nombre de la otra sociedad de la cuenta: sale la pregunta arriba en
//      su ficha, en ámbar, con «Pasarla a Prueba Segunda Takeaway» y «Es de esta
//      sociedad»; «Validar» apagado; se pulsa «Pasarla a …», lo confirma con su
//      contenido, y aparece en Prueba Segunda Takeaway con su PDF.
//   2. Una a nombre de alguien de fuera: «Su IVA no se deduce» y «Sí es nuestra,
//      se deduce»; se pulsa la segunda, lo confirma con quién y cuándo, se valida,
//      y su IVA está en la 472.
//   3. En la lista de Facturas recibidas, la fila sale en «Por aclarar» con
//      «¿De quién es?» (regla 7: no se esconde).
//
// Los datos los prepara en su carril e2e_e03_preparar (semilla E03, solo
// staging): la segunda sociedad y dos recibidas con IVA, leídas de su papel, de
// Mayorista Prueba Alfa (semilla D01). Su PDF inventado lo sube la prueba.
// Hasta el real del E03, staging tiene la 1833 (solo añade: va de verdad desde
// la rama); la lista con su etiqueta es de la 1835 (cambia: solo en ROLLBACK
// hasta el real), así que la 3 añade la etiqueta a la respuesta de la lista
// (page.route), como s01g/soporte; la pregunta, contestar, pasarla y validar son
// de verdad. Escribe (pasa y valida): solo corre en un carril, que se borra al
// acabar; sin carril se salta y lo dice. Capturas: docs/conta/capturas/e03/.

import { mkdirSync, readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/e03'
const PDF = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'
const OTRA = 'Prueba Segunda Takeaway, S.L.'
const EMPRESA = 'Taberna de Prueba Norte, S.L.'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1456) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

interface Preparadas {
  cuenta: string; empresa: string; otra_empresa: string
  otra: { id: string; numero: string; ruta: string }
  fuera: { id: string; numero: string; ruta: string }
}

async function ponerElTamano(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) await page.setViewportSize({ width: 1456, height: 816 })
}

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('main').innerText().catch(() => '(sin main)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function preparar(s: Sesion, page: Page): Promise<Preparadas> {
  const r = await rest<Preparadas>(s, 'POST', 'rpc/e2e_e03_preparar', { p_lado: lado(page) })
  expect(r.status, `e2e_e03_preparar: ${JSON.stringify(r.datos).slice(0, 300)}`).toBe(200)
  for (const f of [r.datos.otra, r.datos.fuera]) {
    const sub = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${f.ruta}`, {
      method: 'POST',
      headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' },
      body: readFileSync(PDF),
    })
    const t = await sub.text()
    expect(sub.ok || /exists|duplicate/i.test(t), `subir el PDF de ${f.numero}: ${sub.status} ${t.slice(0, 200)}`).toBe(true)
  }
  return r.datos
}

/**
 * La empresa activa en las páginas que se abran a partir de ahora (la que recuerda
 * «Cambiar de empresa»). Antes de navegar, como en dm1/dos-empresas: en la página
 * en blanco del principio no se puede tocar el almacén (run 1500: SecurityError).
 */
async function conEmpresa(page: Page, cuenta: string, empresa: string) {
  await page.addInitScript(([k, v]) => { try { window.localStorage.setItem(k, v) } catch { /* sin almacén */ } }, [`folvy.conta.empresa.${cuenta}`, empresa] as const)
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page) === 'movil' ? 'movil' : '1456'}.png`, fullPage: lado(page) === 'movil' })
}

test.describe('E03 · ¿de quién es esta factura?', () => {
  test.describe.configure({ timeout: 240_000 })
  test.use({ actionTimeout: 20_000 })
  test.skip(!CARRIL, 'Escribe (pasa y valida facturas): solo en un carril, que se borra al acabar.')

  test('a nombre de la otra sociedad: la pregunta, «Pasarla a …» y aparece en la otra con su PDF', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      await page.goto(`/conta/documentos/recibidas/${p.otra.id}`)
      const pregunta = page.locator('[data-prueba="de-quien"]')
      await expect(pregunta).toContainText(`Esta factura va a nombre de ${OTRA}, no de ${EMPRESA}`)
      await expect(pregunta.getByRole('button', { name: 'Pasarla a Prueba Segunda Takeaway' })).toBeVisible()
      await expect(pregunta.getByRole('button', { name: 'Es de esta sociedad' })).toBeVisible()
      // Los dos del mismo tamaño (en el ordenador, uno al lado del otro; en el móvil, uno debajo del otro).
      const [a, b] = await Promise.all([pregunta.getByRole('button').nth(0).boundingBox(), pregunta.getByRole('button').nth(1).boundingBox()])
      expect(Math.abs((a?.width ?? 0) - (b?.width ?? 0)), 'los dos botones, del mismo ancho').toBeLessThan(2)
      await expect(page.locator('[data-validar-y-siguiente]').first()).toBeDisabled()
      await capturar(page, 'otra-sociedad-pregunta')
      await pregunta.getByRole('button', { name: 'Pasarla a Prueba Segunda Takeaway' }).click()
      await expect(page.getByText(`Pasada a ${OTRA}, con su PDF. Ya no está en esta lista.`).first()).toBeVisible({ timeout: 30_000 })
      await capturar(page, 'otra-sociedad-pasada')
      // En la base: en la otra sociedad, y su llegada con ella.
      const f = await rest<{ company_id: string; raw_document_url: string }[]>(s, 'GET', `supplier_invoice?select=company_id,raw_document_url&account_id=eq.${p.cuenta}&id=eq.${p.otra.id}`)
      expect(f.datos[0]?.company_id).toBe(p.otra_empresa)
      const l = await rest<{ company_id: string }[]>(s, 'GET', `document_inbox?select=company_id&account_id=eq.${p.cuenta}&supplier_invoice_id=eq.${p.otra.id}`)
      expect(l.datos[0]?.company_id).toBe(p.otra_empresa)
      // En la pantalla de la otra sociedad: su ficha, ya sin pregunta, con su PDF.
      await conEmpresa(page, p.cuenta, p.otra_empresa)
      await page.goto(`/conta/documentos/recibidas/${p.otra.id}`)
      await expect(page.getByText(p.otra.numero).first()).toBeVisible()
      await expect(page.locator('[data-prueba="de-quien"]')).toHaveCount(0)
      // Su PDF, el mismo: en la página (en el móvil va en su pestaña).
      await expect(page.locator('[data-prueba="papel-pdf"]').first()).toBeAttached({ timeout: 30_000 })
      await capturar(page, 'otra-sociedad-en-la-otra')
    } catch (e) { await contarPantalla(page, 'otra sociedad'); throw e }
  })

  test('a nombre de alguien de fuera: «Sí es nuestra, se deduce», validar, y su IVA en la 472', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      await conEmpresa(page, p.cuenta, p.empresa)
      await page.goto(`/conta/documentos/recibidas/${p.fuera.id}`)
      const pregunta = page.locator('[data-prueba="de-quien"]')
      await expect(pregunta).toContainText(`Esta factura va a nombre de Cliente Inventado, S.L. (F00000000), no de ${EMPRESA} Si no es vuestra, su IVA no se deduce.`)
      await expect(pregunta.getByRole('button', { name: 'Su IVA no se deduce' })).toBeVisible()
      await expect(page.locator('[data-validar-y-siguiente]').first()).toBeDisabled()
      await capturar(page, 'fuera-pregunta')
      await pregunta.getByRole('button', { name: 'Sí es nuestra, se deduce' }).click()
      await expect(page.getByText(/Apuntado: su IVA se deduce\. Lo decidió .+ el \d{2}\/\d{2}\./).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[data-prueba="de-quien"]')).toHaveCount(0)
      const validar = page.locator('[data-validar-y-siguiente]').first()
      await expect(validar).toBeEnabled({ timeout: 30_000 })
      await capturar(page, 'fuera-contestada')
      await validar.click()
      // Validada: su asiento, con el IVA en la 472.
      await expect.poll(async () => {
        const e = await rest<{ id: string }[]>(s, 'GET', `journal_entry?select=id&account_id=eq.${p.cuenta}&source_type=eq.supplier_invoice&source_id=eq.${p.fuera.id}&status=eq.validado`)
        return e.datos[0]?.id ?? null
      }, { timeout: 60_000, message: 'su asiento validado' }).not.toBeNull()
      const e = await rest<{ id: string }[]>(s, 'GET', `journal_entry?select=id&account_id=eq.${p.cuenta}&source_type=eq.supplier_invoice&source_id=eq.${p.fuera.id}&status=eq.validado`)
      const lineas = await rest<{ debit: number; company_account_id: string }[]>(s, 'GET', `journal_line?select=debit,company_account_id&account_id=eq.${p.cuenta}&entry_id=eq.${e.datos[0].id}`)
      const ids = [...new Set(lineas.datos.map((x) => x.company_account_id))]
      const cuentas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&account_id=eq.${p.cuenta}&id=in.(${ids.join(',')})`)
      const codigo = new Map(cuentas.datos.map((x) => [x.id, x.code]))
      const iva = lineas.datos.filter((x) => (codigo.get(x.company_account_id) ?? '').startsWith('472'))
      expect(iva.map((x) => Number(x.debit)), `su IVA en la 472: ${JSON.stringify(lineas.datos.map((x) => [codigo.get(x.company_account_id), x.debit]))}`).toEqual([21])
      const r = await rest<{ recipient_answer: string; vat_non_deductible: boolean }[]>(s, 'GET', `supplier_invoice?select=recipient_answer,vat_non_deductible&account_id=eq.${p.cuenta}&id=eq.${p.fuera.id}`)
      expect(r.datos[0]).toEqual({ recipient_answer: 'deduce', vat_non_deductible: false })
    } catch (e) { await contarPantalla(page, 'fuera'); throw e }
  })

  test('en la lista: «Por aclarar» con «¿De quién es?»', async ({ page }) => {
    await ponerElTamano(page)
    const s = await entrarComo(page, CUENTA_A.email)
    const p = await preparar(s, page)
    try {
      await conEmpresa(page, p.cuenta, p.empresa)
      // Hasta el real, la lista de staging es la de antes (la 1835 va en ROLLBACK): se le añade lo que la 1835 pone.
      await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos(\?|$)/, async (r) => {
        const real = await r.fetch()
        const d = await real.json() as { filas: Record<string, unknown>[]; cifras: Record<string, number> }
        let nuevas = 0
        const filas = d.filas.map((f) => {
          if (f.id !== p.otra.id || f.de_quien) return f
          nuevas += f.estado === 'por_aclarar' ? 0 : 1
          return { ...f, estado: 'por_aclarar', de_quien: { caso: 'otra_sociedad', sociedad: 'Prueba Segunda Takeaway' }, porque: `Esta factura va a nombre de ${OTRA}, no de ${EMPRESA}` }
        })
        await json(r, { ...d, filas, cifras: { ...d.cifras, por_aclarar: (d.cifras.por_aclarar ?? 0) + nuevas, para_mirar: Math.max(0, (d.cifras.para_mirar ?? 0) - nuevas) } })
      })
      await page.goto(`/conta/documentos?ver=por-aclarar&q=${encodeURIComponent(p.otra.numero)}`)
      await expect(page.getByRole('heading', { name: 'Facturas recibidas', level: 1 })).toBeVisible()
      await expect(page.getByText('¿De quién es?').first()).toBeVisible({ timeout: 30_000 })
      await capturar(page, 'lista-de-quien-es')
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } catch (e) { await contarPantalla(page, 'lista'); throw e }
  })
})
