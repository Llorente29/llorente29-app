/// <reference lib="dom" />
// tests/e2e/conta/k10b/cabecera.spec.ts
//
// K10b · La cabecera de la recibida, como ERP10, contra staging, con la cuenta del núcleo (semilla K02) en su
// gestoría y la semilla K10b, a 1456 × 816 y a 1366 × 768:
//   1. una de septiembre, con el 3T presentado, propone el 4T y lo dice en la franja ámbar;
//   1b. una sin propuesta (su proveedor no tiene NIF): la ficha lo dice («Sin propuesta» y el porqué), nunca «Se forma
//      al escribir» en silencio (regla 8; e2e 44960214725);
//   2. una de octubre sin IVA, de un proveedor con NIF (como llega una intracomunitaria de servicios): el tipo de operación «De su ficha»
//      se cambia a «Intracom. servicios» («Cambiado», y «Cambiado en esta factura» al pasar el ratón); el concepto
//      se escribe, las observaciones se ponen (la marca, desde el K11b, solo en hostelería: no sale), y la base lo guarda;
//   3. al pulsar Intro, su asiento sale con la inversión (el 472 con «Compra en otro país de la UE» y la 477),
//      con el concepto escrito. Desde la rama, staging tiene la regla 11 de antes (la
//      2151 solo pasa en ROLLBACK), así que se queda propuesto: lo que mira la prueba es el asiento que sale. Que
//      la regla 11 lea el tipo de la factura lo prueba staging en ROLLBACK (20261121_k10b_cabecera_recibida_prueba).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k10b'
const factura = (t: number, n: number) => enCarril(`c0eb0000-0000-4000-8000-000000000d${t}${n}`)
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const aviso = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="aviso-ficha"]')
const laDeAntes = (page: Page) => page.locator('.k-zona[data-activa="si"] .s-pagina')

async function rest<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

function pdfDe(texto: string): Uint8Array<ArrayBuffer> {
  const flujo = `BT /F1 18 Tf 60 760 Td (${texto}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const sitios: number[] = []
  objetos.forEach((o, i) => { sitios.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${sitios.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

async function ponerDocumento(s: Sesion, facturaId: string, nombre: string) {
  const ruta = `${NUCLEO.id}/k10b-e2e/${Date.now()}-${nombre}`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: pdfDe(`K10b - ${nombre}`),
  })
  expect(r.status, `subir ${nombre}: ${(await r.text()).slice(0, 200)}`).toBeLessThan(300)
  await rest(s, 'rpc/conta_recibida_papel_poner', { p_invoice: facturaId, p_ruta: ruta, p_nombre: nombre, p_quien_nombre: 'Prueba e2e K10b' })
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

async function fichaLista(page: Page) {
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(ficha(page).locator('[data-prueba="cuadra"]')).toBeVisible({ timeout: 30_000 })
  await expect(laDeAntes(page)).toHaveCount(0)
}

async function introFuera(page: Page) {
  // Como una persona: si la ficha aún lee o guarda algo, lo dice y no valida; se espera y se vuelve a pulsar.
  for (let i = 0; i < 10; i++) {
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    const dice = (await aviso(page).textContent().catch(() => null)) ?? ''
    if (!/Aún estoy (leyendo|guardando)/.test(dice)) return
    await page.waitForTimeout(1500)
  }
}

async function sinDudaDeGasto(page: Page) {
  const dejar = ficha(page).locator('.kf-duda').getByRole('button', { name: /^Dejar / })
  if (await dejar.count()) await dejar.first().click()
}

interface Linea { debit: number; credit: number; brand_id: string | null; tax_rate: { code: string } | null; company_account: { code: string } }

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`la cabecera como ERP10 a ${ancho} × ${alto}: el 4T, el tipo cambiado, el concepto, las observaciones y la marca`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    await ponerDocumento(s, factura(t, 4), 'k10b.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · La de septiembre, con el 3T presentado: el 4T, y la franja lo dice. ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 2)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(ficha(page).locator('#kf-deduce')).toHaveValue('2026-10-01', { timeout: 30_000 })
    // K11b · Sin frases: la casilla del periodo, en ámbar, con el motivo al pasar el ratón.
    await expect(ficha(page).locator('[data-comprobacion="periodo"]')).toHaveAttribute('title', /El 3T ya está presentado: va al 4T/)
    await expect(ficha(page).locator('#kf-deduce option[value="2026-07-01"]')).toBeDisabled()

    // ── 1b · Sin propuesta (su proveedor no tiene NIF): la ficha lo dice. ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 3)}?ver=por-revisar`, { timeout: 30_000 })
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toHaveText('Sin propuesta', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="sin-propuesta"]')).toContainText('le falta el NIF')

    // ── 2 · La de octubre sin IVA, de un proveedor con NIF: el tipo, el concepto, las observaciones y la marca. Con
    //    IVA español la autoliquidación no se propone (e2e 44953178165), y sin NIF no hay propuesta (e2e 44960214725). ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 4)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    const origen = ficha(page).locator('[data-prueba="origen-operacion"]')
    await expect(ficha(page).locator('#kf-operacion')).toHaveValue('interior', { timeout: 30_000 })
    await expect(origen).toHaveText('De su ficha')
    await ficha(page).locator('#kf-operacion').selectOption('intra_servicios')
    await expect(aviso(page)).toContainText('Tipo de operación: Adquisición intracomunitaria de servicios', { timeout: 30_000 })
    await expect(origen).toHaveText('Cambiado', { timeout: 30_000 })
    await expect(origen).toHaveAttribute('title', 'Cambiado en esta factura')
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })

    const concepto = `Concepto de prueba K10b ${t}`
    await expect(ficha(page).locator('#kf-concepto')).toBeEditable({ timeout: 30_000 })
    await ficha(page).locator('#kf-concepto').fill(concepto)
    await ficha(page).locator('#kf-concepto').press('Enter')
    await expect(aviso(page)).toContainText(`Concepto: «${concepto}»`, { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-concepto')).toHaveValue(concepto, { timeout: 30_000 })

    // K11b · Las observaciones, en su bloque como ERP10 (una casilla siempre a la vista, sin botón que la abra).
    await ficha(page).locator('#kf-observaciones').fill(`Observación de prueba K10b ${t}`)
    await ficha(page).locator('#kf-observaciones').press('Tab')
    await expect(aviso(page)).toContainText('Observaciones', { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-observaciones')).toHaveValue(`Observación de prueba K10b ${t}`, { timeout: 30_000 })

    // K11b · La marca y la plataforma, por línea y solo en una empresa de hostelería (la gestoría del núcleo no lo es):
    // aquí no salen. La marca por línea, con su asiento, la prueba k11b/recibida.spec.ts en una de hostelería.
    await expect(ficha(page).locator('#kf-marca')).toHaveCount(0)

    const [f] = await rest<{ vat_operation: string | null; entry_concept: string | null; notes: string | null; brand_id: string | null }[]>(s,
      `supplier_invoice?select=vat_operation,entry_concept,notes,brand_id&account_id=eq.${NUCLEO.id}&id=eq.${factura(t, 4)}`)
    expect(f.vat_operation).toBe('intra_servicios')
    expect(f.entry_concept).toBe(concepto)
    expect(f.notes).toBe(`Observación de prueba K10b ${t}`)
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, la cabecera, a ${ancho}`).toEqual([])
    await cargada(page, 'la cabecera')
    await page.screenshot({ path: `${DIR}/cabecera-${ancho}.png` })

    // ── 3 · Intro: el asiento sale con la inversión, el concepto escrito y la marca. ──
    await sinDudaDeGasto(page)
    await introFuera(page)
    await expect(aviso(page)).toContainText(/Apuntada y validada|sin validar/i, { timeout: 60_000 })
    const asientos = await rest<{ id: string; concept: string; status: string }[]>(s,
      `journal_entry?select=id,concept,status&account_id=eq.${NUCLEO.id}&source_type=eq.supplier_invoice&source_id=eq.${factura(t, 4)}`)
    expect(asientos.length, 'su asiento').toBe(1)
    expect(asientos[0].concept).toBe(concepto)
    const lineas = await rest<Linea[]>(s, `journal_line?select=debit,credit,brand_id,tax_rate:tax_rate_id(code),company_account:company_account_id(code)&entry_id=eq.${asientos[0].id}`)
    expect(lineas.some((l) => l.tax_rate?.code === 'ue_compra' && l.company_account.code.startsWith('472')), 'el 472 con «Compra en otro país de la UE»').toBe(true)
    expect(lineas.some((l) => l.company_account.code.startsWith('477') && Number(l.credit) > 0), 'la 477 de la inversión').toBe(true)
    expect(lineas.every((l) => l.brand_id === f.brand_id), 'la marca en cada apunte').toBe(true)
    info.annotations.push({ type: 'K10b', description: `asiento ${asientos[0].status} (desde la rama, staging tiene la regla 11 de antes): «${(await aviso(page).textContent())?.slice(0, 200)}»` })

    expect(errores, 'errores de la página').toEqual([])
  })
}
