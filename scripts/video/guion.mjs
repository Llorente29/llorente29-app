// scripts/video/guion.mjs — V01 · el guion del vídeo «De la factura al pago».
//
// Lo llama factura-al-pago.mjs (modo «grabar»). Tres partes:
//
//   1. PREPARAR (sin grabar), en el carril:
//      · sembrar.sql: nombres creíbles, los tres proveedores y dos facturas
//        aprobadas (Cárnicas del Centro y Bebidas Sierra Norte);
//      · la factura de La Huerta, como la deja la lectura: por la API, con la
//        sesión de la persona (su RLS), su lectura, sus líneas y su PDF;
//      · y se apunta con el botón de la pantalla («Validar y siguiente»),
//        fuera de cámara. En producción lo hace solo «Apuntar solo lo seguro».
//   2. GRABAR (Playwright, 1920×1080), con el ratón a la vista:
//      pasos 1-2 la ficha de la factura, ya contabilizada, con su PDF;
//      pasos 3-6 Pagos › marcar las 3 › Pagar con Revolut › PIN › enviado;
//      paso 7    Bancos › Movimientos › Casados solos.
//      Lo del pago (titular, aprobar, PIN, enviar) va INTERCEPTADO en el
//      navegador, como en la e2e del B01 (revolutPagarVarias.spec.ts): en el
//      sandbox de Revolut la comprobación del titular siempre dice «no se puede
//      comprobar», y el PIN se crea con un correo que staging no manda. No sale
//      ningún pago a ningún banco, tampoco al sandbox.
//   3. EL CARGO QUE VUELVE: cuando la pantalla dice «Enviado», cargos.sql
//      escribe los tres cargos de Revolut en el carril (como los traería la
//      lectura) y los casa el núcleo de verdad (_bank_casar_nucleo, «folvy»),
//      que hace su asiento y marca pagadas las facturas.
//
// Deja en <salida>: crudo.webm, tramos.json, portada.png, cierre.png y
// capturas/ (una por paso, del navegador, por si el montaje falla).

import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { CURSOR, raton, reloj, tarjeta } from './raton.mjs'
import { FACTURAS, facturaHtml, totales } from './datos.mjs'
import { FRASES, estimada } from './locucion.mjs'
import { existsSync, readFileSync } from 'node:fs'

const URL_SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const LOTE = 'e2e0b01c-0000-4000-8000-0000000000d4'
const HUERTA = FACTURAS[0]

/** Oculta la franja «BUILD LOCAL · NO ES PRODUCCIÓN» (solo en la grabación: es de staging, no del producto). */
const SIN_FRANJA = `
(() => { const st = document.createElement('style'); st.textContent = 'div[role=status].bg-warning{display:none!important}';
  const poner = () => document.head && document.head.appendChild(st); if (document.head) poner(); else document.addEventListener('DOMContentLoaded', poner) })()
`

function psql(sql, vars) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', sql]
  return execFileSync('psql', [process.env.DB_URL, ...args], { encoding: 'utf8' })
}

async function api(s, metodo, ruta, cuerpo, extra = {}) {
  const r = await fetch(`${URL_SUPA}/rest/v1/${ruta}`, {
    method: metodo,
    headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 300)}`)
  return d
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const dia = (n) => { const x = new Date(`${hoy()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/** La factura de La Huerta, como la deja la lectura de un PDF que llega por correo. */
async function facturaLeida(navegador, s, CUENTA, EMPRESA) {
  const [prov] = await api(s, 'GET', `supplier?select=id&account_id=eq.${CUENTA}&name=eq.${encodeURIComponent('Frutas y Verduras La Huerta')}`)
  if (!prov) throw new Error('No está el proveedor de La Huerta: ¿ha corrido sembrar.sql?')
  const [local] = await api(s, 'GET', `locations?select=id&account_id=eq.${CUENTA}&order=name&limit=1`)
  const t = totales(HUERTA)
  const fecha = dia(-12)
  const comprobaciones = [
    ['numero', 'Número de factura (art. 6.1.a).'], ['fecha', 'Fecha de expedición (art. 6.1.b).'],
    ['emisor', 'Nombre de quien la expide (art. 6.1.c).'], ['emisor_nif', 'NIF de quien la expide, con forma válida (art. 6.1.d).'],
    ['destinatario', 'Nombre y NIF del destinatario (art. 6.1.c y d).'], ['es_a_la_empresa', 'Está a nombre de esta empresa (su NIF).'],
    ['tipo', 'Tipos de IVA aplicados (art. 6.1.h): el 4 % y el 10 %.'], ['cuota', 'Cuotas de IVA: las de cada base (art. 6.1.i).'],
    ['total', 'Base + IVA = total.'],
  ].map(([id, texto]) => ({ id, ok: true, texto }))
  const [f] = await api(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA, company_id: EMPRESA, supplier_id: prov.id, location_id: local?.id ?? null, doc_kind: 'invoice',
    invoice_number: HUERTA.numero, invoice_date: fecha, due_date: dia(3), status: 'en_revision', source: 'ocr', arrival_channel: 'correo',
    tax_base_total: t.base, tax_total: t.iva, grand_total: t.total, payment_method: 'transfer', created_by_name: 'Sumied',
    issuer_name: 'Frutas y Verduras La Huerta, S.L.', issuer_tax_id: HUERTA.nif, read_iban: HUERTA.iban,
    needs_review: false, reading_confidence: 'seguro',
    reading: {
      confianza: 'seguro', comprobaciones, porque: ['Las líneas suman la base y el total cuadra.'],
      factura: { numero: HUERTA.numero, fecha, base: t.base, cuota: t.iva, total: t.total,
        tipos: t.tramos.map((x) => ({ tipo: x.iva, base: x.base, cuota: x.cuota })),
        proveedor: { nombre: 'Frutas y Verduras La Huerta, S.L.', nif: HUERTA.nif } },
    },
  })
  await api(s, 'POST', 'supplier_invoice_line', HUERTA.lineas.map((l, i) => ({
    supplier_invoice_id: f.id, raw_text: l.texto, qty: l.cantidad, unit_price: l.precio,
    line_amount: Math.round(l.cantidad * l.precio * 100) / 100, vat_pct: l.iva, position: i,
  })))
  // El PDF, hecho por Chromium con la factura inventada, al almacén de la cuenta.
  const p = await navegador.newPage()
  await p.setContent(facturaHtml(HUERTA, fecha, 'Taberna del Mercado, S.L. · NIF B00000042'))
  const pdf = await p.pdf({ format: 'A4', printBackground: true })
  await p.close()
  const ruta = `${CUENTA}/${f.id}/FV-2026-1187.pdf`
  const up = await fetch(`${URL_SUPA}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf,
  })
  if (!up.ok) throw new Error(`El PDF no se ha subido: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`)
  await api(s, 'PATCH', `supplier_invoice?id=eq.${f.id}&account_id=eq.${CUENTA}`, { raw_document_url: ruta })
  return f.id
}

/** Lo del pago, interceptado en el navegador (como la e2e del B01). Ningún pago sale a ningún banco. */
async function interceptarPago(page, m) {
  const json = (r, c) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) })
  const quien = { yo_puedo: true, soy_admin: true, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Administración', yo: true }] }
  const de = (id) => m.facturas.find((x) => x.id === id)
  await page.route('**/rest/v1/rpc/conta_pago_quien', (r) => json(r, quien))
  await page.route('**/rest/v1/rpc/conta_pago_para_mi', (r) => json(r, []))
  await page.route('**/rest/v1/rpc/conta_pago_preparar', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}')
    const f = de(b.p_invoice)
    if (!f) return r.continue()
    await json(r, { se_puede: true, porque: null, numero: f.numero, beneficiario: f.proveedor, iban4: f.iban.slice(-4),
      iban_check: f.ibanNuevo ? 'primer_pago' : 'comprobado', importe: f.total, concepto: f.numero,
      motivos: f.ibanNuevo ? ['iban_nuevo'] : [], motivos_texto: f.ibanNuevo ? ['IBAN nuevo'] : [],
      salida: { proveedor: 'revolut', banco: 'Revolut', puede: true, porque: null }, quien })
  })
  await page.route('**/rest/v1/rpc/conta_pago_aprobar', async (r) => {
    m.aprobaciones++
    await json(r, { lote: LOTE, huella: 'b'.repeat(64), pagos: m.facturas.length, total: m.total, estado: 'esperando_segunda',
      segunda: { quien: 'la_misma', motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'], personas: [] },
      frase: 'Aprobado por ti. Confírmalo con tu PIN (IBAN nuevo). Hasta entonces no sale nada.' })
  })
  await page.route('**/rest/v1/rpc/conta_pago_lote_ver', (r) => json(r, {
    lote: LOTE, estado: m.enviado ? 'enviado' : 'esperando_segunda', huella: 'b'.repeat(64), creado: new Date().toISOString(), aprobado_por: 'Administración',
    desde: { nombre: 'Revolut Business', iban4: '4781', banco: 'Revolut' }, motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'],
    puedo_dar: true, no_puedo_porque: null, segunda: null, total: m.total,
    pagos: m.facturas.map((f, i) => ({ id: `s-${i}`, factura: f.id, concepto: f.numero, beneficiario: f.proveedor, iban4: f.iban.slice(-4),
      iban_check: f.ibanNuevo ? 'primer_pago' : 'comprobado', importe: f.total, estado: m.enviado ? 'enviado' : 'esperando_segunda',
      motivos_texto: f.ibanNuevo ? ['IBAN nuevo'] : [] })),
    historial: [] }))
  await page.route('**/functions/v1/conta-pagar', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}')
    if (b.accion === 'titular') { await new Promise((ok) => setTimeout(ok, 500)); return json(r, { ok: true, titular: { resultado: 'coincide' } }) }
    if (b.accion === 'pin_confirmar') return json(r, { ok: true, lote: LOTE, pagos: m.facturas.length, texto: `Confirmado con tu PIN de pago: ${m.facturas.length} pagos para mandar.` })
    if (b.accion === 'mandar') {
      m.enviado = true
      await m.alEnviar()
      return json(r, { ok: true, texto: `Enviado a Revolut: ${m.facturas.length} pagos. Te avisamos cuando lo confirme.`, bien: m.facturas.length, rechazados: 0, sin_saber: 0 })
    }
    return json(r, { ok: false, texto: 'No interceptado.' })
  })
}

export async function grabar({ salida, sesion, contexto, APP, EMPRESA_A, CUENTA_A }) {
  mkdirSync(join(salida, 'capturas'), { recursive: true })
  const navegador = await chromium.launch({ args: ['--lang=es-ES'], env: { ...process.env, LANG: 'es_ES.UTF-8', LANGUAGE: 'es_ES:es' } })
  await tarjeta(navegador, join(salida, 'portada.png'), 'De la factura al pago, sin teclear nada')
  await tarjeta(navegador, join(salida, 'cierre.png'), 'Sumied · contabilidad que se hace sola', 'app.sumied.com')

  // ── 1 · Preparar ───────────────────────────────────────────────────────────
  console.log(psql('scripts/video/sembrar.sql', { cuenta: CUENTA_A, empresa: EMPRESA_A,
    iban1: FACTURAS[0].iban, iban2: FACTURAS[1].iban, iban3: FACTURAS[2].iban }))
  const s = await sesion()
  const idHuerta = await facturaLeida(navegador, s, CUENTA_A, EMPRESA_A)
  console.log(`· factura de La Huerta: ${idHuerta}`)
  {
    const ctx = await contexto(navegador, s, null)
    const p = await ctx.newPage()
    p.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
    await p.goto(`${APP}/conta/documentos/recibidas/${idHuerta}?ver=por-revisar&marca=sumied`)
    const b = p.locator('[data-validar-y-siguiente]').first()
    await b.waitFor({ timeout: 45_000 })
    await p.waitForFunction(() => { const x = document.querySelector('[data-validar-y-siguiente]'); return x && !x.hasAttribute('disabled') }, null, { timeout: 45_000 })
      .catch(async () => { await p.screenshot({ path: join(salida, 'capturas', 'x-no-se-puede-validar.png') }); throw new Error('La factura de La Huerta no se puede validar: ver capturas/x-no-se-puede-validar.png') })
    await b.click()
    await p.waitForTimeout(6000)
    await p.screenshot({ path: join(salida, 'capturas', 'x-despues-de-validar.png') })
    await ctx.close()
  }
  const [hu] = await api(s, 'GET', `supplier_invoice?select=id,status,journal_entry_id&id=eq.${idHuerta}&account_id=eq.${CUENTA_A}`)
  console.log(`· después de apuntarla: ${JSON.stringify(hu)}`)

  // Las tres facturas del pago, como las ve Pagos.
  const lista = await api(s, 'POST', 'rpc/conta_pagos_lista', { p_company: EMPRESA_A, p_mes: hoy() })
  const facturas = FACTURAS.map((d) => {
    const f = (lista.filas ?? []).find((x) => x.numero === d.numero)
    if (!f) throw new Error(`La factura ${d.numero} no sale en Pagos: ${JSON.stringify((lista.filas ?? []).map((x) => [x.numero, x.estado]))}`)
    return { id: f.id, numero: d.numero, proveedor: f.proveedor, iban: d.iban, ibanNuevo: d.ibanNuevo, total: Number(f.pendiente) }
  })
  const total = Math.round(facturas.reduce((a, f) => a + f.total, 0) * 100) / 100

  // ── 2 · Grabar ─────────────────────────────────────────────────────────────
  const dirVideo = join(salida, 'video-tmp')
  const ctx = await contexto(navegador, s, dirVideo)
  await ctx.addInitScript(CURSOR)
  await ctx.addInitScript(SIN_FRANJA)
  const m = {
    facturas, total, enviado: false, aprobaciones: 0,
    alEnviar: async () => {
      console.log(psql('scripts/video/cargos.sql', { cuenta: CUENTA_A, empresa: EMPRESA_A, numeros: facturas.map((f) => f.numero).join(',') }))
    },
  }
  const page = await ctx.newPage()
  const R = reloj()
  const ra = raton(page, R)
  const errores = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  await interceptarPago(page, m)
  const foto = async (n) => {
    await page.screenshot({ path: join(salida, 'capturas', `${n}.png`), scale: 'css', style: '#__cursor,.__onda{display:none!important}' })
    writeFileSync(join(salida, 'capturas', `${n}.txt`), await page.locator('body').innerText().catch(() => ''))
  }
  const quieto = (ms) => page.waitForTimeout(ms)
  const red = () => page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

  // Lo que dura cada frase: la voz ya hecha (voz/frases.json, la deja voz.py antes de grabar) o, sin voz, estimada.
  const rutaVoz = join(salida, 'voz', 'frases.json')
  const hechas = existsSync(rutaVoz) ? JSON.parse(readFileSync(rutaVoz, 'utf8')) : []
  const durasVoz = new Map(hechas.filter((f) => f.dura).map((f) => [f.id, f.dura]))
  console.log(durasVoz.size ? `· voz hecha: ${durasVoz.size} frases` : '· sin voz: el ritmo va con duraciones estimadas')
  const di = (id, gesto) => R.di(id, FRASES[id], durasVoz.get(id) ?? estimada(FRASES[id]), gesto)

  let inicio = 0
  try {
    // Pasos 1 y 2 · la factura que llegó por correo, leída y apuntada.
    await R.sinVer(async () => {
      await page.goto(`${APP}/conta/documentos/recibidas/${idHuerta}?marca=sumied`)
      await page.getByText('Ya está contabilizada').first().waitFor({ timeout: 45_000 })
      await page.locator('[data-prueba="papel-pdf"] canvas').first().waitFor({ timeout: 30_000 }).catch(() => {})
      await red(); await quieto(800)
      await page.evaluate(() => window.scrollTo(0, 0))
    })
    inicio = R.t()
    R.marca(1)
    await di('llega', async () => {
      await ra.ir(700, 400, 500)
      const cab = page.getByText(/^Llegó por correo/).first()
      if (await cab.isVisible().catch(() => false)) await ra.a(cab, 900)
    })
    const pdf = await page.locator('[data-prueba="papel-pdf"]').first().boundingBox()
    await di('lee', async () => {
      if (!pdf) return
      ra.mira(pdf)
      const x = pdf.x; const y = pdf.y; const w = pdf.width
      await ra.ir(x + w * 0.3, y + 70, 900); await quieto(500)
      await ra.ir(x + w * 0.85, y + 120, 700); await quieto(300)
      await ra.ir(x + w * 0.25, y + 345, 800); await quieto(300)
      await ra.ir(x + w * 0.25, y + 480, 900); await quieto(300)
      await ra.ir(x + w * 0.75, y + 480, 700)
    })
    const igual = page.locator('[data-prueba="contra-pdf"]').first()
    await di('igual', async () => {
      if (await igual.isVisible().catch(() => false)) await ra.a(igual, 1000)
      else await ra.ir(560, 520, 900)
    })
    await foto('1-factura')

    R.marca(2)
    await di('apunta', () => ra.a(page.getByText('Ya está contabilizada').first(), 1000))
    const porQue = page.getByRole('button', { name: 'Por qué' }).or(page.getByRole('link', { name: 'Por qué' })).first()
    await di('porque', async () => {
      if (await porQue.isVisible().catch(() => false)) {
        await ra.clic(porQue, 800)
        await quieto(500)
        await ra.ir(420, 250, 700)
        await ra.ir(420, 420, 2200)
      }
    })
    await foto('2-contabilizada')

    // Paso 3 · Pagos: lo que vence esta semana, y marcar las tres.
    R.marca(3)
    const menuPagos = page.getByRole('link', { name: 'Pagos', exact: true }).first()
    if (await menuPagos.isVisible().catch(() => false)) await ra.clic(menuPagos, 1000)
    else await page.goto(`${APP}/conta/compras/pagos`)
    await R.sinVer(async () => {
      await page.getByRole('heading', { level: 1, name: 'Pagos' }).waitFor({ timeout: 30_000 })
      await page.getByRole('checkbox', { name: new RegExp(`^Marcar ${facturas[0].proveedor}`) }).waitFor({ timeout: 30_000 })
      await red(); await quieto(500)
    })
    const semana = page.getByText('Vence esta semana').first()
    await di('pagos', async () => {
      await ra.a(page.getByText('Por pagar').first(), 900); await quieto(400)
      if (await semana.isVisible().catch(() => false)) await ra.a(semana, 900)
    })
    await di('marcar', async () => {
      for (const f of facturas) { await ra.clic(page.getByRole('checkbox', { name: new RegExp(`^Marcar ${f.proveedor}`) }), 650); await quieto(350) }
    })
    const barra = page.getByRole('region', { name: 'Pagar las seleccionadas' })
    const desde = barra.getByLabel('Desde qué banco se paga')
    const revolut = await desde.locator('option', { hasText: 'Revolut' }).first().getAttribute('value')
    await di('desde', async () => {
      await ra.a(desde, 900)
      if ((await desde.inputValue()) !== revolut) {
        await page.mouse.down(); await page.mouse.up()
        await desde.selectOption(revolut)
        await page.keyboard.press('Escape').catch(() => {})
      }
    })
    const pagar = barra.locator('[data-prueba="pagar-con-banco"]')
    await R.sinVer(() => pagar.filter({ hasText: /Pagar las 3 con Revolut/ }).waitFor({ timeout: 30_000 }))
    await di('boton', () => ra.a(pagar, 800))
    await foto('3-marcadas')

    // Paso 4 · la ventana: Revolut dice que el titular coincide; un IBAN nuevo pide la segunda.
    await ra.clic(pagar, 300)
    const dialogo = page.getByRole('dialog', { name: 'Pagar con Revolut' })
    const filas = dialogo.locator('[data-prueba="fila-varias"]')
    await R.sinVer(async () => {
      for (let i = 0; i < facturas.length; i++) await filas.nth(i).getByText('Revolut dice que coincide').waitFor({ timeout: 30_000 })
      await quieto(300)
    })
    R.marca(4)
    await di('titular', async () => {
      for (let i = 0; i < facturas.length; i++) { await ra.a(filas.nth(i), 800); await quieto(700) }
    })
    const pide = dialogo.locator('[data-prueba="pide-segunda-varias"]')
    await di('segunda', async () => {
      await ra.a(filas.nth(1), 700); await quieto(900)
      if (await pide.isVisible().catch(() => false)) await ra.a(pide, 900)
    })
    await foto('4-titular')

    // Paso 5 · una sola aprobación para las tres, con el PIN de pago.
    R.marca(5)
    const aprobar = dialogo.locator('[data-prueba="aprobar-y-pagar-varias"]')
    await di('una', async () => {
      const resumen = dialogo.locator('[data-prueba="resumen-varias"]')
      if (await resumen.isVisible().catch(() => false)) { await ra.a(resumen, 800); await quieto(500) }
      await ra.a(aprobar, 800)
    })
    await ra.clic(aprobar, 200)
    const segunda = page.getByRole('dialog', { name: /Confirma con tu llave los 3 pagos/ })
    await R.sinVer(() => segunda.waitFor({ timeout: 30_000 }))
    await quieto(500)
    await ra.clic(segunda.getByRole('button', { name: 'Usar mi PIN de pago' }), 800)
    const conPin = page.getByRole('dialog', { name: /Confirma con tu PIN de pago los 3 pagos/ })
    await R.sinVer(() => conPin.waitFor({ timeout: 30_000 }))
    const pin = conPin.locator('[data-prueba="pin-pago"]')
    await di('pin', async () => {
      await ra.clic(pin, 700)
      await pin.pressSequentially('407219', { delay: 160 })
      await ra.a(conPin.locator('[data-prueba="confirmar-pin"]'), 600)
    })
    await foto('5-pin')

    // Paso 6 · enviado: Pagos lo dice y las tres pasan a pagadas.
    R.marca(6)
    await ra.clic(conPin.locator('[data-prueba="confirmar-pin"]'), 300)
    const aviso = page.locator('[data-prueba="aviso-pagos"]')
    await R.sinVer(async () => { await aviso.filter({ hasText: 'Enviado a Revolut' }).waitFor({ timeout: 60_000 }); await red() })
    await di('enviado', () => ra.a(aviso, 900))
    const pagado = page.getByText(/Pagado en /).first()
    await di('pagado', async () => { if (await pagado.isVisible().catch(() => false)) await ra.a(pagado, 900) })
    await foto('6-enviado')

    // Paso 7 · Bancos › Movimientos: los tres cargos, casados solos.
    R.marca(7)
    const bancos = page.getByRole('link', { name: /^Bancos/ }).first()
    await ra.clic(bancos, 900)
    await R.sinVer(async () => {
      await page.getByRole('heading', { level: 1, name: 'Movimientos' }).waitFor({ timeout: 30_000 })
      await red(); await quieto(500)
    })
    const solos = page.getByRole('button', { name: /Casados solos/ }).or(page.getByRole('tab', { name: /Casados solos/ })).first()
    await di('vuelve', async () => {
      await ra.a(page.getByText(/casados solos/).first(), 900); await quieto(300)
      await ra.a(solos, 700)
    })
    await ra.clic(solos, 200)
    await R.sinVer(async () => { await red(); await quieto(400) })
    const casados = page.getByText(/^Casado con Pago /)
    await di('casado', async () => {
      const n = await casados.count()
      for (let i = 0; i < n; i++) { await ra.a(casados.nth(i), 800); await quieto(600) }
    })
    await di('resumen', () => ra.ir(1100, 330, 1200))
    await foto('7-casados')
  } catch (e) {
    await foto('x-error').catch(() => {})
    writeFileSync(join(salida, 'error.txt'), `${e.stack ?? e}\n\nErrores de la página:\n${errores.join('\n')}`)
    console.log(`EL GUION HA PARADO: ${e.message}`)
  }
  const fin = R.t()
  const video = page.video()
  await ctx.close()
  if (video) renameSync(await video.path(), join(salida, 'crudo.webm'))
  writeFileSync(join(salida, 'tramos.json'), JSON.stringify({ inicio, fin, pasos: R.pasos, dichos: R.dichos, objetivos: R.objetivos, cortes: R.cortes, aprobaciones: m.aprobaciones, errores }, null, 2))
  await navegador.close()
  console.log(`Grabado: ${fin.toFixed(1)} s, ${R.pasos.length} pasos, ${R.cortes.length} cortes, ${m.aprobaciones} aprobación(es).`)
  if (R.pasos.length < 7 || R.dichos.length < Object.keys(FRASES).length - 2) process.exitCode = 1
}
