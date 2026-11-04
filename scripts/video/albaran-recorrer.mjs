// scripts/video/albaran-recorrer.mjs — V02 · el recorrido de verdad, para ver cada pantalla (aún sin vídeo).
//
// En el móvil (390×844), con la persona administradora de A del carril:
// Recepciones › Recibir pedido › Escanear albarán › la foto › Leer albarán ›
// Crear recepción › el asistente, pantalla a pantalla › Recibido. Después, en el
// ordenador, la lista de recepciones y la revisión de oficina de la que acaba de
// entrar. Una captura (y su texto) en cada paso, en <salida>/recorrer.
//
// LA LECTURA, SIMULADA (decisión de Julio, 03/11): la foto se sube de verdad;
// la función ocr-albaran se intercepta en el navegador. La sesión de lectura se
// crea de verdad en el carril (como la crearía la función) y solo lo leído se
// inventa. Todo lo demás, de verdad.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL_SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY

/** El albarán inventado (T11: NIF de ceros; nombres de proveedor sin personas). */
export const ALBARAN = {
  proveedor: 'Frutas y Verduras La Huerta', nif: 'B00000018', numero: 'FV-26-4418',
  lineas: [
    { codigo: 'TOM-10', texto: 'Tomate pera, caja 10 kg', cantidad: 4, precio: 14.9, iva: 4 },
    { codigo: 'LEC-12', texto: 'Lechuga romana, caja 12 ud', cantidad: 3, precio: 11.4, iva: 4 },
    { codigo: 'PAT-25', texto: 'Patata agria, saco 25 kg', cantidad: 2, precio: 18.75, iva: 4 },
    { codigo: 'ACE-05', texto: 'Aceite de oliva virgen extra, garrafa 5 l', cantidad: 2, precio: 34.5, iva: 10 },
  ],
}

const r2 = (x) => Math.round(x * 100) / 100

function albaranHtml(a, fecha) {
  const filas = a.lineas.map((l) => `<tr><td>${l.codigo}</td><td>${l.texto}</td><td class="n">${l.cantidad}</td><td class="n">${l.precio.toFixed(2).replace('.', ',')} €</td><td class="n">${r2(l.cantidad * l.precio).toFixed(2).replace('.', ',')} €</td></tr>`).join('')
  const base = r2(a.lineas.reduce((s, l) => s + l.cantidad * l.precio, 0))
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'DejaVu Sans',Arial,sans-serif;margin:36px;color:#222;font-size:15px}
    h1{font-size:26px;margin:0 0 4px}.p{color:#555}table{width:100%;border-collapse:collapse;margin-top:18px}
    th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}.n{text-align:right}.t{margin-top:16px;text-align:right;font-size:18px;font-weight:700}
  </style></head><body><h1>${a.proveedor}</h1><div class="p">NIF ${a.nif} · Mercamadrid, nave 12</div>
  <h2 style="margin-top:22px">ALBARÁN Nº ${a.numero}</h2><div class="p">Fecha ${fecha.split('-').reverse().join('/')} · Entregar en: Taberna del Mercado</div>
  <table><tr><th>Código</th><th>Artículo</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>${filas}</table>
  <div class="t">Base ${base.toFixed(2).replace('.', ',')} €</div></body></html>`
}

async function api(s, metodo, ruta, cuerpo) {
  const r = await fetch(`${URL_SUPA}/rest/v1/${ruta}`, {
    method: metodo, headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}

/** La función de lectura, interceptada: la sesión de verdad en el carril, lo leído inventado. */
async function interceptarLectura(page, s, CUENTA_A, a, fecha) {
  await page.route('**/functions/v1/ocr-albaran', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}')
    let sesionId = null
    try {
      const [x] = await api(s, 'POST', 'goods_receipt_ai_session', { account_id: CUENTA_A, kind: 'photo', input_files: b.file_paths ?? [], status: 'parsed' })
      sesionId = x?.id ?? null
    } catch (e) { console.log(`· la sesión de lectura no se ha podido crear: ${e.message}`) }
    const lineas = a.lineas.map((l) => ({
      raw_text: l.texto, supplier_code: l.codigo, quantity: l.cantidad, packages: l.cantidad, unit: 'caja', unit_price_net: l.precio, discount_pct: null,
      line_amount: r2(l.cantidad * l.precio), vat_pct: l.iva, lot_code: null, expiry_date: null, note: null, format_name: null, pack_size: null, pack_unit: null,
    }))
    const base = r2(lineas.reduce((t, l) => t + l.line_amount, 0))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      session_id: sesionId, status: 'ok', ai_model: 'simulado (vídeo V02)', ai_latency_ms: 1800,
      parsed: { confidence: 0.96, lines: lineas, document: {
        supplier_name: a.proveedor, supplier_tax_id: a.nif, supplier_phone: null, supplier_email: null, supplier_address: 'Mercamadrid, nave 12',
        supplier_health_registry: null, doc_number: a.numero, doc_date: fecha, doc_type: 'albaran', ship_to: 'Taberna del Mercado', bill_to_name: null,
        handwritten: false, tax_base_total: base, tax_total: null, grand_total: null } },
      validation: { base_declared: base, lines_sum: base, diff_pct: 0, cuadra: true, needs_review: false, reasons: [] },
    }) })
  })
}

export async function recorrer({ salida, sesion, contexto, APP, CUENTA_A, PERSONAS }) {
  const dir = join(salida, 'recorrer')
  mkdirSync(dir, { recursive: true })
  const navegador = await chromium.launch({ args: ['--lang=es-ES'], env: { ...process.env, LANG: 'es_ES.UTF-8', LANGUAGE: 'es_ES:es' } })
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  // La siembra (albaran-sembrar.sql) y cómo casa cada línea después (albaran-casado.sql).
  const psql = (f, stop) => execFileSync('psql', [process.env.DB_URL, '-X', ...(stop ? ['-1', '-v', 'ON_ERROR_STOP=1'] : []), '-v', `cuenta=${CUENTA_A}`, '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  writeFileSync(join(dir, 'sembrar.txt'), psql('scripts/video/albaran-sembrar.sql', true))
  try { writeFileSync(join(dir, 'casado.txt'), psql('scripts/video/albaran-casado.sql', false)) } catch (e) { writeFileSync(join(dir, 'casado.txt'), String(e.stdout ?? '') + String(e.stderr ?? e.message)) }
  // La foto del albarán.
  const pa = await navegador.newPage({ viewport: { width: 900, height: 1100 } })
  await pa.setContent(albaranHtml(ALBARAN, fecha))
  const fotoAlbaran = join(dir, 'albaran.png')
  await pa.screenshot({ path: fotoAlbaran }); await pa.close()

  let n = 0
  const foto = async (page, nombre) => {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const f = `${String(++n).padStart(2, '0')}-${nombre}`
    // El móvil, a su resolución de pantalla (2x): el zoom de las fotos y del vídeo amplía texto nítido.
    await page.screenshot({ path: join(dir, `${f}.png`), scale: (page.viewportSize()?.width ?? 1920) < 768 ? 'device' : 'css' })
    writeFileSync(join(dir, `${f}.txt`), `${page.url()}\n\n${await page.locator('body').innerText().catch(() => '')}`)
    console.log(`· ${f}`)
  }
  const pulsa = async (page, re, t = 15_000) => { const b = page.getByRole('button', { name: re }).first(); await b.waitFor({ timeout: t }); await b.click() }

  const s = await sesion(PERSONAS.admin)
  const m = await contexto(navegador, s, true)
  const p = await m.newPage()
  p.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  await interceptarLectura(p, s, CUENTA_A, ALBARAN, fecha)
  try {
    await p.goto(`${APP}/supply/recepciones`)
    // El local: sin él, «Recibir y meter al stock» no se enciende (el stock entra en un local).
    const local = p.locator('select').filter({ has: p.locator('option', { hasText: 'Taberna del Mercado' }) }).first()
    if (await local.isVisible().catch(() => false)) { await local.selectOption({ label: 'Taberna del Mercado' }); await p.waitForTimeout(1500) }
    else console.log('· no encuentro el selector del local')
    await foto(p, 'recepciones')
    await pulsa(p, /Recibir pedido/); await foto(p, 'recibir')
    await pulsa(p, /Escanear albarán/); await foto(p, 'escanear')
    await p.locator('input[type=file]').last().setInputFiles(fotoAlbaran)
    await foto(p, 'con-la-foto')
    await pulsa(p, /Leer albarán/)
    await p.getByRole('button', { name: /Crear recepción desde esto/ }).first().waitFor({ timeout: 45_000 })
    await foto(p, 'leido')
    await pulsa(p, /Crear recepción desde esto/)
    await p.waitForTimeout(2500); await foto(p, 'asistente-1')
    for (let i = 2; i <= 14; i++) {
      // En la 2.ª línea (la lechuga), una incidencia: llegan 2 cajas de las 3 del albarán.
      const txt = await p.locator('body').innerText().catch(() => '')
      if (/Lechuga romana/.test(txt) && !/lechuga-2/.test(String(p.__hecho ?? ''))) {
        const menos = p.getByRole('button', { name: 'Uno menos' }).first()
        if (await menos.isVisible().catch(() => false)) { await menos.click(); p.__hecho = 'lechuga-2'; await p.waitForTimeout(900); await foto(p, `asistente-${i}-lechuga-2`) }
        else console.log('· no encuentro el botón «−» de la cantidad')
      }
      const sig = p.getByRole('button', { name: /^Siguiente/ }).first()
      if (!(await sig.isVisible().catch(() => false))) break
      if (await sig.isDisabled().catch(() => false)) { await foto(p, `asistente-${i}-apagado`); break }
      await sig.click(); await p.waitForTimeout(1200); await foto(p, `asistente-${i}`)
    }
    const recibir = p.getByRole('button', { name: /Recibir y meter al stock|Meter al stock y avisar a oficina/ }).first()
    if (await recibir.isVisible().catch(() => false)) { await recibir.click(); await p.waitForTimeout(3000); await foto(p, 'recibido') }
  } catch (e) { console.log(`EL RECORRIDO DEL MÓVIL HA PARADO: ${e.message.split('\n')[0]}`); await foto(p, 'x-movil-parado').catch(() => {}) }
  await m.close()

  const o = await contexto(navegador, s, false)
  const q = await o.newPage()
  try {
    await q.goto(`${APP}/supply/recepciones`); await foto(q, 'oficina-lista')
    await pulsa(q, /Verificar y confirmar/)
    await q.getByText('Verificar, no recontar').first().waitFor({ timeout: 45_000 })
    await q.waitForTimeout(1500)
    await foto(q, 'oficina-revision')
    const cerrar = q.getByRole('button', { name: /Verificado — cerrar albarán/ }).first()
    await cerrar.scrollIntoViewIfNeeded(); await q.waitForTimeout(800)
    await foto(q, 'oficina-revision-abajo')
    await cerrar.click()
    await q.waitForTimeout(2500)
    // Si pide confirmar algo antes de cerrar (un aviso de coste…), se ve en la captura.
    await foto(q, 'oficina-aprobado')
  } catch (e) { console.log(`LA OFICINA HA PARADO: ${e.message.split('\n')[0]}`); await foto(q, 'x-oficina-parado').catch(() => {}) }
  await o.close()
  await navegador.close()
}
