/// <reference lib="dom" />
// tests/e2e/conta/k06/pago.spec.ts
//
// K06 · «Cómo se paga» es la cuenta del pago, y la raya del panel del documento,
// contra staging, con la cuenta del núcleo (semilla K02) en su gestoría y las
// semillas K04 y K06, a 1456 × 816 y a 1366 × 768, con el navegador en español:
//   1. pagada por banco: una a mano con la 57200001 en «Cómo se paga» (su
//      nombre, la fecha propuesta, el importe): al validarla, lo mismo que «Ya la
//      he pagado» de Pagos, esperando el cargo;
//   2. vacía: la siguiente del mismo proveedor propone la 57200001 «de la
//      última»; se vacía y queda pendiente de pagar. Y «guarda lo mismo» (regla
//      31): esa misma, pagada después por Pagos (conta_pago_a_mano, lo que hace
//      su «Ya la he pagado»), queda igual que la de la ficha, y Bancos las
//      propone igual para casar;
//   3. por la 430: la de comisión de la plataforma (semilla K06b), ligada a su liquidación,
//      propone su 43000091 «De su ficha» (K10: la 430 de la plataforma pasó a su ficha, como cuenta de pago) y al validarla queda pagada por
//      compensación;
//   4. la raya: se arrastra, se recuerda al volver y no pasa del mínimo del
//      formulario;
//   5. el asiento: «Arrastra aquí el justificante» en el nuevo y «Este asiento
//      no tiene justificante» en uno guardado;
//   y en cada ficha, que no se corta nada (la vara del K05).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k06'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const BANCO = () => enCarril('c0e20000-0000-4000-8000-0000000000b0')
// La de seed_k06b (a nombre de la gestoría: la de seed_k06 no traía el NIF del destinatario y la base no la valida, e2e 44715124011).
const PLATAFORMA = (t: number) => enCarril(`c0e60000-0000-4000-8000-0000000001b${t}`)
const PROVEEDOR = (t: number) => (t === 1 ? 'Proveedor de Prueba Ficha Uno, S.L.' : 'Proveedor de Prueba Ficha Dos, S.L.')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const aviso = (page: Page) => page.locator('[data-prueba="aviso-ficha"]')
// K11b · El nombre de la cuenta del pago, sin casilla propia (como ERP10): en el `title` de la subcuenta del pago.
const nombrePago = (page: Page) => ficha(page).locator('[data-prueba="pago-cuenta"]')

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

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas')
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('folvy.conta.nucleo.reparto.')) window.localStorage.removeItem(k)
  })
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

/**
 * Una a mano de su proveedor, con base 100 al 21 % (la línea del 10 %, quitada con su ×), a su cuenta de gasto y sin
 * documento (con su motivo). El pago, lo que diga la prueba.
 */
async function escribirAMano(page: Page, t: number, numero: string, gasto: { escribir: string; cuenta: string } = { escribir: '600', cuenta: '60000000' }) {
  await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  // K11b · La nueva entra por la primera casilla de la pantalla (la fecha de la factura, la de hoy); Intro pasa al proveedor.
  await expect(page.locator('#kf-fecha')).toBeFocused({ timeout: 30_000 })
  await page.keyboard.press('Enter')
  await expect(page.locator('#kf-proveedor')).toBeFocused({ timeout: 30_000 })
  await page.keyboard.type(t === 1 ? 'Ficha Uno' : 'Ficha Dos')
  await page.keyboard.press('Enter')
  await expect(page.locator('#kf-nombre')).toHaveValue(PROVEEDOR(t))
  await ficha(page).locator('#kf-numero').fill(numero)
  await ficha(page).locator('#kf-fecha').fill('20/10/2026')
  await ficha(page).locator('#kf-fecha').press('Tab')
  await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
  await ficha(page).getByRole('combobox', { name: 'Tipo de IVA 1' }).selectOption('21')
  await ficha(page).getByRole('button', { name: 'Quitar el tipo 10 %' }).click()
  await expect(ficha(page).getByRole('textbox', { name: 'Base 2' })).toHaveCount(0)
  await ficha(page).locator('#kf-cuenta-0').fill(gasto.escribir)
  await page.getByRole('option', { name: new RegExp(`^${gasto.cuenta} · `) }).click()
  // El local, con su lupa (K11b · 4): «Común» e Intro; apagada (sin locales), no se toca.
  const local = ficha(page).getByRole('textbox', { name: 'Local', exact: true })
  if (await local.isEditable()) { await local.fill('Común'); await local.press('Enter') }
  await ficha(page).getByRole('checkbox', { name: 'Guardarla sin documento' }).check()
  await ficha(page).getByRole('textbox', { name: 'Por qué no tiene documento' }).fill('Prueba e2e K06: escrita a mano, sin documento')
}

const idDe = async (s: Sesion, numero: string) => {
  const [f] = await rest<{ id: string; status: string; paid_method: string | null }[]>(s, `supplier_invoice?select=id,status,paid_method&account_id=eq.${NUCLEO.id}&invoice_number=eq.${numero}`)
  expect(f, `la factura ${numero}`).toBeTruthy()
  return f
}

/** La vara de la regla 31, la misma a los dos lados: el pago apuntado (su remesa a mano y su línea) y cómo la propone Bancos para casar. */
async function vara(s: Sesion, facturaId: string) {
  const lineas = await rest<{ remesa_id: string; amount: number; estado: string; iban_check: string }[]>(s,
    `conta_pago_remesa_linea_estado?select=remesa_id,amount,estado,iban_check&account_id=eq.${NUCLEO.id}&invoice_id=eq.${facturaId}`)
  const remesas = lineas.length ? await rest<{ kind: string; treasury_account_id: string; pay_date: string }[]>(s,
    `conta_pago_remesa?select=kind,treasury_account_id,pay_date&account_id=eq.${NUCLEO.id}&id=in.(${lineas.map((l) => l.remesa_id).join(',')})`) : []
  const casar = await rest<{ id: string; total: number; pagado: number; estado: string; cuenta_tercero: string }[]>(s, 'rpc/bank_facturas_para_casar', { p_company: EMPRESA() })
  const suya = casar.find((x) => x.id === facturaId) ?? null
  const pagado = await rest<number>(s, 'rpc/_bank_recibida_pagado', { p_invoice: facturaId }).catch((e) => `sin permiso (${String(e).slice(0, 60)})`)
  const pagos = await rest<{ amount: number; entry_id: string | null }[]>(s, `supplier_invoice_payment?select=amount,entry_id&account_id=eq.${NUCLEO.id}&invoice_id=eq.${facturaId}`)
  return {
    pago: lineas.map((l, i) => ({ importe: Number(l.amount), estado: l.estado, iban: l.iban_check, clase: remesas[i]?.kind, banco: remesas[i]?.treasury_account_id, dia: remesas[i]?.pay_date })),
    bancos: suya ? { total: Number(suya.total), pagado: Number(suya.pagado), estado: suya.estado, cuenta: suya.cuenta_tercero } : null,
    pagadoParaBancos: pagado,
    asientosDePago: pagos.length,
  }
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`la cuenta del pago a ${ancho} × ${alto}: por banco, vacía, por la 430, la raya y el asiento`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(480_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const grande = ancho === 1456
    if (!grande) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }
    const sello = Date.now().toString(36).slice(-5).toUpperCase()

    // ── 1 · Pagada por banco: la 57200001, con su nombre, la fecha propuesta (la de la factura, sin vencimiento) y el importe. ──
    const nBanco = `K06B-${t}-${sello}`
    // Con la 60200000, «Compras de otros aprovisionamientos» (de serie, en cualquier plan): el nombre largo, en dos líneas, entero.
    await escribirAMano(page, t, nBanco, { escribir: '602', cuenta: '60200000' })
    await expect(ficha(page).getByRole('textbox', { name: 'Nombre de la cuenta 1' })).toHaveValue('Compras de otros aprovisionamientos')
    await ficha(page).locator('#kf-pago').fill('5720')
    await page.getByRole('option', { name: /^57200001 · / }).click()
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('57200001')
    await expect(nombrePago(page)).toHaveAttribute('title', /^Bancos · Cuenta principal/)
    await expect(ficha(page).locator('#kf-pago-fecha')).toHaveValue('20/10/2026')
    await expect(ficha(page).getByRole('textbox', { name: 'Importe del pago' })).toHaveValue('121,00')
    await cargada(page, 'a mano, por banco')
    expect(await loQueSeCorta(page, FICHA), 'lo que se corta, por banco').toEqual([])
    await page.screenshot({ path: `${DIR}/por-banco-${ancho}.png` })
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText(`Guardada la ${nBanco}`, { timeout: 60_000 })
    await expect(aviso(page)).toContainText('Queda esperando el cargo')
    const banco = await idDe(s, nBanco)
    expect(banco.status).toBe('aprobada')

    // ── 2 · Vacía (K11b, Julio, 23/11): la siguiente del mismo proveedor NO trae la 57200001 escrita (una factura no queda
    //    pagada por haber pagado otra antes): la casilla, vacía; la del último pago, la primera al abrir la lupa. Elegida y
    //    vaciada otra vez, pendiente de pagar (vaciarla es un cambio de verdad: no vuelve a la propuesta). ──
    const nVacia = `K06V-${t}-${sello}`
    await escribirAMano(page, t, nVacia)
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('')
    await expect(ficha(page).locator('[data-prueba="origen-pago"]')).toHaveCount(0)
    await ficha(page).getByRole('button', { name: 'Buscar la cuenta del pago' }).click()
    const primera = page.locator('#kf-pago-lista [role="option"]').first()
    await expect(primera).toContainText('57200001', { timeout: 30_000 })
    await primera.click()
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('57200001')
    await ficha(page).locator('#kf-pago').fill('')
    // Vacía: pendiente de pagar (en ERP10, la fila del pago en blanco).
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('')
    expect(await loQueSeCorta(page, FICHA), 'lo que se corta, vacía').toEqual([])
    if (grande) await page.screenshot({ path: `${DIR}/vacia-${ancho}.png` })
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText(`Guardada la ${nVacia}`, { timeout: 60_000 })
    await expect(aviso(page)).toContainText('Queda pendiente de pagar (sin cuenta de pago).')
    const vacia = await idDe(s, nVacia)
    expect(vacia.status).toBe('aprobada')
    const vaciaAntes = await vara(s, vacia.id)
    expect(vaciaAntes.pago, 'la vacía no tiene ningún pago').toEqual([])

    // «Guarda lo mismo» (regla 31): la vacía, pagada ahora por Pagos («Ya la he pagado»: conta_pago_a_mano), contra la de la ficha.
    await rest(s, 'rpc/conta_pago_a_mano', { p_company: EMPRESA(), p_invoice: vacia.id, p_treasury: BANCO(), p_fecha: '2026-10-20', p_importe: 121 })
    const deLaFicha = await vara(s, banco.id)
    const dePagos = await vara(s, vacia.id)
    console.log(`[K06 regla 31 ${ancho}] con la ficha: ${JSON.stringify(deLaFicha)}`)
    console.log(`[K06 regla 31 ${ancho}] con Pagos:    ${JSON.stringify(dePagos)}`)
    expect(dePagos).toEqual(deLaFicha)
    expect(deLaFicha.pago).toEqual([{ importe: 121, estado: deLaFicha.pago[0]?.estado, iban: deLaFicha.pago[0]?.iban, clase: 'a_mano', banco: BANCO(), dia: '2026-10-20' }])

    // ── 3 · Por la 430: la de comisión de la plataforma, ligada a su liquidación. ──
    await rest(s, 'rpc/conta_recibida_sin_papel', { p_invoice: PLATAFORMA(t), p_sin: true, p_motivo: 'Prueba e2e K06: la semilla no trae PDF', p_quien_nombre: 'Prueba e2e K06' })
    await page.goto(`/conta/documentos/recibidas/${PLATAFORMA(t)}?ver=por-revisar`, { timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('43000091', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="origen-pago"]')).toHaveText('De su ficha')
    await expect(nombrePago(page)).toHaveAttribute('title', /^Plataforma de Prueba K06/)
    await expect(ficha(page)).not.toContainText('Compensación con la liquidación')
    await cargada(page, 'la de plataforma')
    expect(await loQueSeCorta(page, FICHA), 'lo que se corta, por la 430').toEqual([])
    await page.screenshot({ path: `${DIR}/por-la-430-${ancho}.png` })

    // ── 4 · La raya: se arrastra, se recuerda al volver y no pasa del mínimo del formulario. ──
    const panel = ficha(page).locator('.kf-panel')
    const formulario = ficha(page).locator('.kf-izquierda')
    const raya = ficha(page).locator('[data-prueba="raya-panel"]')
    const antes = (await panel.boundingBox())!.width
    const r = (await raya.boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + 200)
    await page.mouse.down()
    // A la derecha: más sitio para el formulario (a 1366 el formulario ya va casi en su mínimo, y a la izquierda no habría sitio).
    // K13 (17b): con la ficha de 860 px, a 1366 al panel le quedan unos 116 px hasta su mínimo de 240: se arrastra lo que cabe.
    const tramo = Math.min(120, Math.floor(antes - 240 - 8))
    await page.mouse.move(r.x + r.width / 2 + tramo / 2, r.y + 200, { steps: 4 })
    await page.mouse.move(r.x + r.width / 2 + tramo, r.y + 200, { steps: 4 })
    await page.mouse.up()
    const movida = (await panel.boundingBox())!.width
    expect(Math.abs(movida - (antes - tramo)), `el panel, de ${antes} a ${movida} (arrastrado ${tramo})`).toBeLessThan(4)
    await page.reload({ timeout: 30_000 })
    await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width), { timeout: 15_000 }).toBeLessThan(Math.round(movida) + 4)
    expect(Math.abs((await panel.boundingBox())!.width - movida), 'al volver, el mismo reparto').toBeLessThan(4)
    const r2 = (await raya.boundingBox())!
    await page.mouse.move(r2.x + r2.width / 2, r2.y + 200)
    await page.mouse.down()
    await page.mouse.move(r2.x - 1200, r2.y + 200, { steps: 6 })
    await page.mouse.up()
    const minimo = await ficha(page).evaluate((x) => parseFloat(getComputedStyle(x).getPropertyValue('--kf-min-form')))
    expect((await formulario.boundingBox())!.width, `el formulario no baja de su mínimo (${minimo})`).toBeGreaterThan(minimo - 2)
    expect(await loQueSeCorta(page, FICHA), 'lo que se corta, con el formulario en su mínimo').toEqual([])
    if (grande) await page.screenshot({ path: `${DIR}/raya-al-minimo-${ancho}.png` })
    // La raya vuelve a su sitio con el teclado (y se recuerda así para lo que sigue).
    await raya.focus()
    for (let i = 0; i < 60 && (await panel.boundingBox())!.width > antes + 12; i++) await page.keyboard.press('ArrowRight')
    expect(Math.abs((await panel.boundingBox())!.width - antes), 'con las flechas, de vuelta').toBeLessThan(26)
    await page.evaluate(() => { for (const k of Object.keys(window.localStorage)) if (k.startsWith('folvy.conta.nucleo.reparto.')) window.localStorage.removeItem(k) })

    // Validada: pagada por compensación con su liquidación. Después de recargar, la propuesta del pago tiene que
    // haber llegado antes de validar (la e2e #1641 validó con la casilla aún vacía: la ficha ya no se deja).
    await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('43000091', { timeout: 30_000 })
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(page.getByText(/Se paga con su liquidación: la 43000091 de Plataforma de Prueba K06, S\.L\. la descuenta/).first()).toBeVisible({ timeout: 60_000 })
    const plat = await idDe(s, `K06P-${t}-2`)
    expect([plat.status, plat.paid_method]).toEqual(['pagada', 'compensation'])

    // ── 5 · El asiento: lo suyo, sin documento. ──
    // K11b · Desde el K12 el asiento es el general como ERP10, con el documento a la derecha (la pieza 8, DocumentoDerecha,
    // que sustituyó al «.kf-soltar»): el nuevo deja adjuntar el justificante; el de la factura, sin documento, no lleva
    // ninguno y no deja adjuntarlo aquí (viene de su ficha: se cambia allí).
    const documento = page.locator('.k-zona[data-activa="si"] [data-pieza="documento"]')
    await page.goto('/conta/libros/diario/nuevo', { timeout: 30_000 })
    await expect(documento.getByRole('button', { name: 'Adjuntar el documento' })).toBeVisible({ timeout: 30_000 })
    const [e] = await rest<{ id: string }[]>(s, `journal_entry?select=id&account_id=eq.${NUCLEO.id}&source_type=eq.supplier_invoice&source_id=eq.${banco.id}&status=eq.validado`)
    await page.goto(`/conta/libros/diario/${e.id}`, { timeout: 30_000 })
    await expect(page.locator('.k-zona[data-activa="si"] .kp-barra-aviso')).toContainText('Viene de su ficha: se cambia allí.', { timeout: 30_000 })
    await expect(documento).toBeVisible()
    await expect(documento.locator('.kp-hoja'), 'el asiento de la factura, sin justificante').toHaveCount(0)
    await expect(documento.getByRole('button', { name: 'Adjuntar el documento' })).toHaveCount(0)
    if (grande) { await cargada(page, 'el asiento guardado'); await page.screenshot({ path: `${DIR}/asiento-sin-justificante-${ancho}.png` }) }

    expect(errores, 'errores de la página').toEqual([])
  })
}
