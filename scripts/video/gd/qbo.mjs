// scripts/video/gd/qbo.mjs
//
// GD · El vídeo para QBO (Julio, nº52 y nº56): Sumied para gestorías, grabado
// en la «Gestoría Demo» de PRODUCCIÓN (app.sumied.com) con el usuario de Julio,
// en el escritorio (1440×900), ritmo pausado, ratón visible, rótulos en español
// y sin voz. Lo lanza .github/workflows/gd-video-qbo.yml, desde main.
//
// POR ESCENAS (nº56): cada escena se graba aparte y deja su clip
// (escenas/<id>.mp4) y su captura (capturas/<id>.png). El montaje une los
// clips que haya, en su orden: para cambiar una escena se regraba solo ella
// (ESCENAS=05b) y las demás se reutilizan de la grabación anterior.
//
//   MODO=ensayo  no escribe nada: ni prepara ni envía el cobro, ni cambia
//                Bitrix24. Sirve para ver las pantallas y los rótulos.
//   MODO=grabar  prepara y envía el cobro de diciembre de la demo (autorizado
//                por Julio, nº52: solo la demo y el sandbox) y cambia la
//                situación de una empresa en el Bitrix24 de pruebas (y la deja
//                como estaba al acabar).
//
// La sesión: un enlace de acceso generado en el servidor (generateLink) y
// canjeado aquí (verifyOtp), sin correo. Al acabar, la cuenta abierta de Julio
// vuelve a la que tenía. Ningún secreto se escribe en el registro.
//
// Solo sistemas de pruebas y datos inventados: la cuenta tiene que ser demo
// (is_demo) y el webhook, del portal b24-s3mr2y.

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CURSOR, raton } from '../raton.mjs'

const env = (k) => (process.env[k] ?? '').trim()
const SUPABASE_URL = env('SUPABASE_URL'); const SERVICE = env('SERVICE_KEY'); const ANON = env('ANON_KEY')
const APP = env('APP') || 'https://app.sumied.com'
const MODO = env('MODO') === 'grabar' ? 'grabar' : 'ensayo'
const B24 = env('B24_URL')
const SALIDA = resolve(env('SALIDA') || 'video-salida')
const CUENTA = 'de000000-0000-4000-8000-0000000000a0'
const SOCIEDAD = 'de000000-0000-4000-8000-0000000000a9'
const JULIO = 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a'
const MES = env('MES') || '2026-12'
const CLIENTE = 'Talleres Ruiz, S.L.'
const EMPRESA_INSTANTE = 'Librería El Faro, S.L.'
const PORTAL = 'b24-s3mr2y.bitrix24.es'
const W = 1440; const H = 900

const ORDEN = ['01', '02', '03', '04', '05', '05b', '06', '07', '08', '09', '10']
const pedidas = env('ESCENAS') && env('ESCENAS') !== 'todas' ? env('ESCENAS').split(/[\s,]+/).filter(Boolean) : ORDEN
const fallos = []
let enviado = false
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))
const decir = (t) => console.log(t)

for (const d of ['escenas', 'capturas', 'crudo']) mkdirSync(join(SALIDA, d), { recursive: true })

// ── Rótulos: una franja abajo, grande, que se lee sin voz ────────────────────
const ROTULO = `
(() => {
  window.__rotulo = (t, arriba) => {
    const id = arriba ? '__rotulo_arriba' : '__rotulo'
    let d = document.getElementById(id)
    if (!t) { d && d.remove(); return }
    if (!d) {
      d = document.createElement('div'); d.id = id
      Object.assign(d.style, { position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483645, pointerEvents: 'none',
        maxWidth: '1180px', padding: arriba ? '10px 22px' : '16px 30px', borderRadius: '14px', textAlign: 'center',
        font: arriba ? '600 22px Inter, "DejaVu Sans", Arial, sans-serif' : '600 30px Inter, "DejaVu Sans", Arial, sans-serif', lineHeight: '1.3',
        color: '#fff', background: arriba ? 'rgba(161,27,18,.92)' : 'rgba(15,27,45,.9)', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
        [arriba ? 'top' : 'bottom']: arriba ? '14px' : '34px', transition: 'opacity .4s', opacity: '0' })
      document.documentElement.appendChild(d)
      requestAnimationFrame(() => { d.style.opacity = '1' })
    }
    d.textContent = t
  }
})()
`

// ── La sesión de Julio, solo para la demo ────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
let sesion = null; let cuentaAntes = null; let comoJulio = null
async function entrar() {
  const { data: cu } = await admin.from('accounts').select('is_demo').eq('id', CUENTA).maybeSingle()
  if (cu?.is_demo !== true) throw new Error('La cuenta del vídeo no es de demostración: no se graba.')
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(JULIO)
  if (e1 || !u?.user?.email) throw new Error('No se encuentra el usuario del vídeo.')
  const { data: l, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (e2 || !l?.properties?.hashed_token) throw new Error(`No se ha podido generar el enlace de acceso: ${e2?.message ?? 'sin token'}`)
  comoJulio = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: e3 } = await comoJulio.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (e3 || !v?.session) throw new Error(`No se ha podido canjear el enlace: ${e3?.message ?? 'sin sesión'}`)
  sesion = v.session
  const { data: antes } = await comoJulio.rpc('_cuenta_activa')
  cuentaAntes = antes ?? null
  const { error: e4 } = await comoJulio.rpc('cambiar_empresa', { p_account_id: CUENTA })
  if (e4) throw new Error(`No se ha podido abrir la Gestoría Demo: ${e4.message}`)
  decir(`Sesión abierta en la Gestoría Demo (la cuenta de antes se devuelve al acabar: ${cuentaAntes ? 'sí' : 'no había'}).`)
}
async function salir() {
  if (comoJulio && cuentaAntes && cuentaAntes !== CUENTA) {
    const { error } = await comoJulio.rpc('cambiar_empresa', { p_account_id: cuentaAntes })
    decir(error ? `OJO: no se ha podido devolver la cuenta abierta de Julio: ${error.message}` : 'La cuenta abierta de Julio vuelve a la de antes.')
  }
}
const REF = new URL(SUPABASE_URL || 'https://x.supabase.co').hostname.split('.')[0]
const iniciarSesion = () => `(() => { try {
  localStorage.setItem(${JSON.stringify(`sb-${REF}-auth-token`)}, ${JSON.stringify(JSON.stringify(sesion))});
  localStorage.setItem('andy-app-active-account', ${JSON.stringify(CUENTA)});
} catch (e) {} })()`

// ── Una escena: su contexto, su vídeo, su captura ────────────────────────────
const navegador = await chromium.launch()
async function escena(id, fn, { ancho = W, alto = H, conSesion = true } = {}) {
  if (!pedidas.includes(id)) return
  decir(`\n── Escena ${id}`)
  const dir = join(SALIDA, 'crudo', id); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid',
    recordVideo: { dir, size: { width: ancho, height: alto } }, acceptDownloads: true })
  if (conSesion) await ctx.addInitScript(iniciarSesion())
  await ctx.addInitScript(CURSOR); await ctx.addInitScript(ROTULO)
  const page = await ctx.newPage()
  const t0 = Date.now(); const marca = { desde: 0 }
  const E = { page, ctx, R: raton(page), empezar: () => { marca.desde = (Date.now() - t0) / 1000 }, captura: async () => page.screenshot({ path: join(SALIDA, 'capturas', `${id}.png`) }) }
  try { await fn(E) } catch (e) { fallos.push(`${id}: ${e.message.split('\n')[0]}`); decir(`  ✗ ${e.message.split('\n')[0]}`); await E.captura().catch(() => {}) }
  await page.close(); await ctx.close()
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))
  if (!webm) { fallos.push(`${id}: sin vídeo`); return }
  renameSync(join(dir, webm), join(dir, 'clip.webm'))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, marca.desde)), '-i', join(dir, 'clip.webm'),
    '-vf', `fps=30,scale=${ancho}:${alto},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an', join(SALIDA, 'escenas', `${id}.mp4`)])
  decir(`  ✓ escenas/${id}.mp4`)
}
/** Lo mismo para dos páginas a la vez, una al lado de la otra (escena 5). */
async function dosLados(id, izq, der, fn) {
  if (!pedidas.includes(id)) return
  decir(`\n── Escena ${id} (dos lados)`)
  const hechos = []
  const abrir = async (lado, conSesion) => {
    const dir = join(SALIDA, 'crudo', `${id}-${lado}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const ctx = await navegador.newContext({ viewport: { width: W / 2, height: H }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid', recordVideo: { dir, size: { width: W / 2, height: H } } })
    if (conSesion) await ctx.addInitScript(iniciarSesion())
    await ctx.addInitScript(CURSOR); await ctx.addInitScript(ROTULO)
    const page = await ctx.newPage(); hechos.push({ dir, ctx, page, t0: Date.now() })
    return page
  }
  const a = await abrir('izq', false); const b = await abrir('der', true)
  const marca = { desde: 0 }; const tA = hechos[0].t0; const tB = hechos[1].t0
  try { await fn({ a, b, Ra: raton(a), Rb: raton(b), empezar: () => { marca.desde = Date.now() } }) } catch (e) { fallos.push(`${id}: ${e.message.split('\n')[0]}`); decir(`  ✗ ${e.message.split('\n')[0]}`) }
  await a.screenshot({ path: join(SALIDA, 'crudo', `${id}-a.png`) }).catch(() => {}); await b.screenshot({ path: join(SALIDA, 'crudo', `${id}-b.png`) }).catch(() => {})
  for (const h of hechos) { await h.page.close(); await h.ctx.close() }
  const clip = (h) => join(h.dir, readdirSync(h.dir).find((f) => f.endsWith('.webm')))
  const dA = Math.max(0, (marca.desde - tA) / 1000); const dB = Math.max(0, (marca.desde - tB) / 1000)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(dA), '-i', clip(hechos[0]), '-ss', String(dB), '-i', clip(hechos[1]),
    '-filter_complex', `[0:v]fps=30,scale=${W / 2}:${H}[l];[1:v]fps=30,scale=${W / 2}:${H}[r];[l][r]hstack=inputs=2,format=yuv420p[v]`,
    '-map', '[v]', '-shortest', '-c:v', 'libx264', '-crf', '20', '-an', join(SALIDA, 'escenas', `${id}.mp4`)])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(SALIDA, 'crudo', `${id}-a.png`), '-i', join(SALIDA, 'crudo', `${id}-b.png`), '-filter_complex', 'hstack=inputs=2', join(SALIDA, 'capturas', `${id}.png`)])
  decir(`  ✓ escenas/${id}.mp4`)
}

// ── Piezas de las escenas ────────────────────────────────────────────────────
const rotulo = (page, t, arriba = false) => page.evaluate(([x, y]) => window.__rotulo?.(x, y), [t, arriba])
async function ir(page, ruta) {
  await page.goto(`${APP}${ruta}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(800)
}
/** Si está, el ratón va y (si se pide) pulsa; si no, se apunta y se sigue: la escena no se pierde. */
async function a(E, loc, { clic = false, que = '', pausa = 900 } = {}) {
  const l = loc.first()
  if (!(await l.isVisible({ timeout: 6000 }).catch(() => false))) { fallos.push(`${E.id ?? ''} no está: ${que}`); decir(`  · no está: ${que}`); return false }
  await (clic ? E.R.clic(l) : E.R.a(l)); await E.page.waitForTimeout(pausa); return true
}
async function rodar(page, px, pasos = 12) { for (let i = 0; i < pasos; i++) { await page.mouse.wheel(0, px / pasos); await page.waitForTimeout(70) } await page.waitForTimeout(500) }
async function tarjeta(E, html) {
  await E.page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>
    html,body{margin:0;height:100%;background:#0F1B2D;color:#fff;font-family:Inter,'DejaVu Sans',Arial,sans-serif}
    .c{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;padding:0 80px}
    .g{font-size:64px;font-weight:700;line-height:1.15}.m{font-size:34px;color:#C9D6EA}.p{font-size:22px;color:#8FA3C0;border:1px solid #3B4F70;border-radius:999px;padding:8px 22px}
    img{max-width:100%;max-height:100%;display:block}</style></head><body>${html}</body></html>`)
  await E.page.waitForTimeout(700)
}
async function still(E, png, texto, arriba, segundos = 5) {
  const b64 = readFileSync(png).toString('base64')
  await E.page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#E8EDF4}img{width:${W}px;height:${H}px;display:block}</style></head><body><img src="data:image/png;base64,${b64}"></body></html>`)
  await E.page.evaluate(([t, x]) => { window.__rotulo?.(x, true); window.__rotulo?.(t) }, [texto, arriba])
  await E.page.waitForTimeout(segundos * 1000)
}

// ── Bitrix24 de pruebas, por su API (solo b24-s3mr2y) ────────────────────────
function guardaB24() {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/rest\/[0-9]+\/[A-Za-z0-9]+\/?$/.exec(B24)
  if (!m || m[1] !== PORTAL) throw new Error('El webhook de Bitrix24 no es el del portal de pruebas: no se toca.')
  return B24.replace(/\/?$/, '/')
}
async function b24(metodo, params) {
  const r = await fetch(`${guardaB24()}${metodo}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
  const d = await r.json().catch(() => ({})); if (d.error || !r.ok) throw new Error(`Bitrix24 · ${metodo}: ${d.error ?? r.status}`); return d.result
}

// ── Las escenas ──────────────────────────────────────────────────────────────
try {
  if (pedidas.some((id) => ['02', '03', '04', '05', '06', '07', '08'].includes(id))) await entrar()

  await escena('01', async (E) => {
    await tarjeta(E, `<div class="c"><div class="g">Sumied para gestorías</div><div class="m">Asesoría QBO</div><div class="p">Datos de demostración</div></div>`)
    E.empezar(); await E.page.waitForTimeout(5000); await E.captura()
  }, { conSesion: false })

  await escena('02', async (E) => {
    E.id = '02'
    await ir(E.page, '/conta/ventas/clientes-y-cuotas'); E.empezar()
    await rotulo(E.page, 'Todos tus clientes y lo que cobras a cada uno, en una pantalla'); await E.page.waitForTimeout(3500)
    for (const t of ['Cuotas al mes', 'Te deben', 'Dejas de cobrar', 'Último cobro']) await a(E, E.page.getByText(t, { exact: false }), { que: t, pausa: 1300 })
    await a(E, E.page.getByText('Lo que tienes que hacer'), { que: 'Lo que tienes que hacer', pausa: 2500 })
    await E.captura()
    await a(E, E.page.getByText(CLIENTE, { exact: true }), { clic: true, que: CLIENTE, pausa: 3500 })
    await E.captura()
  })

  await escena('03', async (E) => {
    E.id = '03'
    await ir(E.page, '/conta/ventas/clientes-y-cuotas')
    await E.page.getByText(CLIENTE, { exact: true }).first().click().catch(() => {})
    await E.page.getByText('Abrir la ficha completa').first().click({ timeout: 10_000 }).catch(() => {})
    await E.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); await E.page.waitForTimeout(1200); E.empezar()
    await rotulo(E.page, 'Cada cliente, con su recibo explicado línea a línea'); await E.page.waitForTimeout(3500)
    await a(E, E.page.getByRole('button', { name: 'Ver trabajadores' }), { clic: true, que: 'Ver trabajadores', pausa: 2500 })
    await E.captura()
    for (const t of ['Cobros', 'Contacto']) await a(E, E.page.getByRole('tab', { name: t }).or(E.page.getByRole('button', { name: t, exact: true })), { clic: true, que: `pestaña ${t}`, pausa: 3000 })
    await a(E, E.page.getByText('Situación'), { que: 'datos de Bitrix24', pausa: 2500 })
  })

  await escena('04', async (E) => {
    E.id = '04'
    await ir(E.page, '/conta/ventas/clientes-y-cuotas/tarifas'); E.empezar()
    await rotulo(E.page, 'Tu tarifa, tal como la cobras hoy'); await E.page.waitForTimeout(3500)
    for (const t of ['Básica', 'Estándar', 'Premium']) await a(E, E.page.getByText(t, { exact: true }), { que: t, pausa: 1000 })
    await E.captura()
    for (const t of ['Por trabajador', 'Por tramos', 'Pack Empresa', 'Clientes con precio especial']) {
      const l = E.page.getByText(t, { exact: false }).first()
      if (await l.isVisible().catch(() => false)) { await l.scrollIntoViewIfNeeded(); await E.R.a(l); await E.page.waitForTimeout(1800) } else { await rodar(E.page, 500); decir(`  · no está: ${t}`) }
    }
  })

  // 5 · Al instante: a la izquierda, la empresa en el Bitrix24 de pruebas (por su API); a la derecha, Sumied.
  let situacionAntes = null
  await dosLados('05', 'izq', 'der', async ({ a: izq, b: der, Ra, Rb, empezar }) => {
    const [emp] = await b24('crm.company.list', { filter: { TITLE: EMPRESA_INSTANTE }, select: ['ID', 'TITLE', 'UF_CRM_SITUACION', 'UF_CRM_NIF'] })
    if (!emp) throw new Error(`No está «${EMPRESA_INSTANTE}» en el portal de pruebas.`)
    const campos = await b24('crm.company.userfield.list', { filter: { FIELD_NAME: 'UF_CRM_SITUACION' } })
    const lista = campos?.[0]?.LIST ?? []
    const id = (v) => lista.find((x) => x.VALUE === v)?.ID
    situacionAntes = emp.UF_CRM_SITUACION
    const actual = lista.find((x) => String(x.ID) === String(emp.UF_CRM_SITUACION))?.VALUE ?? 'Activo'
    const nueva = actual === 'Moroso' ? 'Activo' : 'Moroso'
    await izq.exposeFunction('__guardar', async () => { if (MODO === 'grabar') await b24('crm.company.update', { id: emp.ID, fields: { UF_CRM_SITUACION: id(nueva) } }) })
    await izq.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>
      body{margin:0;font-family:Inter,'DejaVu Sans',Arial,sans-serif;background:#EEF2F7;color:#0F1B2D}
      .top{background:#0F1B2D;color:#fff;padding:18px 24px;font-weight:700;font-size:20px}.top span{font-weight:400;color:#9FB2CF;font-size:14px;margin-left:8px}
      .c{margin:24px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      h1{font-size:24px;margin:0 0 18px}.f{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #E3E8F0;font-size:16px}
      select{font:600 16px Inter,sans-serif;padding:8px 12px;border-radius:8px;border:1px solid #C3CEDD}
      button{margin-top:22px;background:#1F5BD8;color:#fff;border:0;border-radius:10px;font:600 16px Inter,sans-serif;padding:12px 22px}
      .ok{margin-top:14px;color:#0B6B4F;font-weight:600;min-height:22px}.n{font-size:13px;color:#5B6B82;margin:0 24px}</style></head><body>
      <div class="top">Bitrix24 de pruebas<span>${PORTAL} · compañía</span></div>
      <div class="c"><h1>${EMPRESA_INSTANTE}</h1>
      <div class="f"><span>NIF</span><b>${emp.UF_CRM_NIF ?? ''}</b></div>
      <div class="f"><span>Situación</span><select id="s">${lista.map((x) => `<option ${x.VALUE === actual ? 'selected' : ''}>${x.VALUE}</option>`).join('')}</select></div>
      <button id="g" onclick="window.__guardar().then(()=>{document.getElementById('ok').textContent='Guardado en Bitrix24'})">Guardar</button><div class="ok" id="ok"></div></div>
      <p class="n">La compañía de verdad del portal de pruebas, leída y cambiada por su API.</p></body></html>`)
    await ir(der, '/conta/ventas/clientes-y-cuotas')
    const buscar = der.getByLabel('Buscar cliente, NIF o trabajador')
    if (await buscar.isVisible().catch(() => false)) { await buscar.fill('Librería'); await der.waitForTimeout(1200) }
    empezar()
    await rotulo(izq, 'Lo que cambias en Bitrix24…'); await rotulo(der, '…Sumied lo sabe en segundos'); await izq.waitForTimeout(3500)
    await Rb.a(der.getByText(EMPRESA_INSTANTE).first()).catch(() => {}); await der.waitForTimeout(1500)
    await Ra.clic(izq.locator('#s')); await izq.locator('#s').selectOption(nueva); await izq.waitForTimeout(1200)
    await Ra.clic(izq.locator('#g')); await izq.waitForTimeout(1500)
    const desde = Date.now(); let visto = false
    while (MODO === 'grabar' && Date.now() - desde < 120_000) {
      await der.waitForTimeout(5000)
      await der.reload({ waitUntil: 'domcontentloaded' }); await der.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      if (await buscar.isVisible().catch(() => false)) { await buscar.fill('Librería'); await der.waitForTimeout(900) }
      await rotulo(der, '…Sumied lo sabe en segundos')
      const fila = der.locator('tr, li, [role="row"]').filter({ hasText: EMPRESA_INSTANTE }).filter({ hasText: nueva })
      if (await fila.first().isVisible().catch(() => false)) { visto = true; await Rb.a(fila.first()); break }
    }
    if (MODO === 'grabar' && !visto) fallos.push('05: Sumied no enseñó el cambio de Bitrix24 en 2 minutos')
    decir(`  · ${MODO === 'grabar' ? (visto ? `Sumied ya dice «${nueva}» (${Math.round((Date.now() - desde) / 1000)} s)` : 'Sumied no lo enseñó') : 'ensayo: Bitrix24 no se ha cambiado'}`)
    await rotulo(izq, 'Sin tocar tu forma de trabajar'); await izq.waitForTimeout(4000)
  })
  if (MODO === 'grabar' && situacionAntes) {
    const [emp] = await b24('crm.company.list', { filter: { TITLE: EMPRESA_INSTANTE }, select: ['ID'] }).catch(() => [])
    if (emp) { await b24('crm.company.update', { id: emp.ID, fields: { UF_CRM_SITUACION: situacionAntes } }).catch((e) => fallos.push(`05: no se ha podido dejar la situación como estaba: ${e.message}`)); decir('  · La empresa vuelve a su situación de antes en Bitrix24.') }
  }

  await escena('05b', async (E) => {
    E.empezar(); await still(E, 'scripts/video/gd/maquetas/0-encrm.png', 'Y sin salir de Bitrix24: la ficha de Sumied dentro de cada cliente', 'En construcción', 7); await E.captura()
  }, { conSesion: false })

  // 6 · Revisar el cobro de diciembre: preparar, los cambios, aprobar los iguales, «No entran», enviar.
  await escena('06', async (E) => {
    E.id = '06'
    await ir(E.page, `/conta/ventas/clientes-y-cuotas/cobro?empresa=${SOCIEDAD}&mes=${MES}`); E.empezar()
    await rotulo(E.page, 'Revisas solo lo que cambia. Lo demás, de una vez'); await E.page.waitForTimeout(3500)
    const preparar = E.page.getByRole('button', { name: 'Preparar el cobro' })
    if (MODO === 'grabar' && await preparar.isVisible().catch(() => false)) {
      await E.R.clic(preparar); await E.page.getByText(/Lo que cambia|Con cambios/).first().waitFor({ timeout: 90_000 }).catch(() => {}); await E.page.waitForTimeout(2000)
    }
    await E.captura()
    const cambios = E.page.locator('li.g5-cambio')
    const n = await cambios.count(); decir(`  · ${n} cambios`)
    // Primero el del 30 %, si lo hay: el que pide mirarlo.
    const fuerte = E.page.locator('li.g5-cambio[data-fuerte="si"]').first()
    if (await fuerte.isVisible().catch(() => false)) { await E.R.a(fuerte.locator('.g5-cambio-porque')); await E.page.waitForTimeout(3000) }
    for (let i = 0; i < Math.min(n, 2); i++) { await E.R.a(cambios.nth(i).locator('.g5-cambio-porque')).catch(() => {}); await E.page.waitForTimeout(1800) }
    if (MODO === 'grabar') {
      for (let i = 0; i < 60; i++) {
        const b = E.page.locator('li.g5-cambio .g4-boton[data-tipo="primario"]:not([disabled])').first()
        if (!(await b.isVisible().catch(() => false))) break
        if (i < 2) { await E.R.clic(b); await E.page.waitForTimeout(1500) } else { await b.click(); await E.page.waitForTimeout(500) }
      }
      const iguales = E.page.getByRole('button', { name: /^Aprobar (el que no cambia|los \d+)/ })
      if (await iguales.isVisible().catch(() => false)) { await E.R.clic(iguales); await E.page.waitForTimeout(2500) }
    } else await a(E, E.page.getByRole('button', { name: /^Aprobar/ }), { que: 'Aprobar los iguales', pausa: 2000 })
    const verLista = E.page.getByRole('button', { name: 'Ver la lista' })
    if (await a(E, E.page.getByText('No entran'), { que: 'No entran', pausa: 1200 }) && await verLista.isVisible().catch(() => false)) { await E.R.clic(verLista); await E.page.waitForTimeout(3000) }
    const enviar = E.page.locator('button.g5-enviar')
    if (await a(E, enviar, { que: 'Enviar el cobro', pausa: 800 })) {
      if (MODO === 'grabar' && await enviar.isEnabled()) {
        await E.R.clic(enviar); await E.page.waitForTimeout(3500); await E.captura()
        const si = E.page.getByRole('dialog').getByRole('button', { name: /^Sí, enviar/ })
        await E.R.clic(si); await E.page.getByText(/Enviado|Cómo va cada recibo/).first().waitFor({ timeout: 120_000 }).catch(() => {}); await E.page.waitForTimeout(3500)
        enviado = true; decir('  · COBRO ENVIADO al sandbox.')
      } else if (MODO === 'grabar') fallos.push('06: «Enviar el cobro» no se deja pulsar (falta revisar algo)')
    }
    await E.captura()
  })

  // 7 · Cobrado y facturado: se espera a los avisos del sandbox fuera de cámara.
  if (pedidas.includes('07') && MODO === 'grabar') {
    decir('\nEsperando a que el sandbox confirme cobros y salgan facturas (hasta 25 min)…')
    const desde = Date.now()
    while (Date.now() - desde < 25 * 60_000) {
      const { data } = await admin.from('conta_recibo').select('estado, invoice_id').eq('account_id', CUENTA).eq('mes', MES)
      const conFactura = (data ?? []).filter((r) => r.invoice_id).length
      decir(`  · ${Math.round((Date.now() - desde) / 60000)} min: ${(data ?? []).length} recibos, ${conFactura} con factura`)
      if (conFactura >= 3) break
      await esperar(60_000)
    }
  }
  await escena('07', async (E) => {
    E.id = '07'
    await ir(E.page, `/conta/ventas/clientes-y-cuotas/cobro?empresa=${SOCIEDAD}&mes=${MES}`); E.empezar()
    await rotulo(E.page, 'Cada cobro confirmado sale facturado y contabilizado solo'); await E.page.waitForTimeout(3500)
    await a(E, E.page.getByText('Cómo va cada recibo'), { que: 'Cómo va cada recibo', pausa: 3000 })
    await E.captura()
    const { data: rec } = await admin.from('conta_recibo').select('invoice_id').eq('account_id', CUENTA).not('invoice_id', 'is', null).order('enviado_at', { ascending: false }).limit(1)
    const factura = rec?.[0]?.invoice_id
    if (!factura) { fallos.push('07: ninguna factura todavía'); return }
    await ir(E.page, `/conta/ventas/facturas/${factura}`)
    await rotulo(E.page, 'Con la numeración y las cuentas de tu plan'); await E.page.waitForTimeout(3000)
    await a(E, E.page.getByText('Lo que ha pasado'), { que: 'Lo que ha pasado', pausa: 2500 })
    await a(E, E.page.getByText('En la contabilidad'), { que: 'En la contabilidad', pausa: 3000 })
    await E.captura()
    // El PDF: se baja y se enseña su primera página.
    const pdf = E.page.getByText('Descargar PDF').first()
    if (await pdf.isVisible().catch(() => false)) {
      await E.R.a(pdf); const [d] = await Promise.all([E.page.waitForEvent('download', { timeout: 30_000 }), pdf.click()]).catch(() => [null])
      if (d) {
        const f = join(SALIDA, 'crudo', 'factura.pdf'); await d.saveAs(f)
        execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', f, join(SALIDA, 'crudo', 'factura')])
        const png = readdirSync(join(SALIDA, 'crudo')).find((x) => x.startsWith('factura') && x.endsWith('.png'))
        const b64 = readFileSync(join(SALIDA, 'crudo', png)).toString('base64')
        await E.page.setContent(`<!doctype html><html><body style="margin:0;background:#525659;display:flex;justify-content:center"><img src="data:image/png;base64,${b64}" style="height:${H}px;box-shadow:0 4px 20px rgba(0,0,0,.4)"></body></html>`)
        await rotulo(E.page, 'La factura en PDF, con sus trabajadores'); await E.page.waitForTimeout(5000); await E.captura()
      } else fallos.push('07: el PDF no se ha bajado')
    }
  })

  await escena('08', async (E) => {
    E.id = '08'
    // Lo mismo que hace el cron de cada 30 minutos (solo cuentas demo), por si aún no ha pasado.
    if (MODO === 'grabar') await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: CUENTA }).then(({ data }) => decir(`  · ${data?.frase ?? ''}`))
    const { count } = await admin.from('bank_movement').select('id', { count: 'exact', head: true }).eq('account_id', CUENTA).eq('company_id', SOCIEDAD)
    if (!count) { fallos.push('08: aún no hay ningún ingreso de GoCardless en el banco de la demo'); return }
    await ir(E.page, '/conta/bancos'); E.empezar()
    await rotulo(E.page, 'El ingreso de GoCardless se casa solo en el banco'); await E.page.waitForTimeout(3500)
    await a(E, E.page.getByText(/GOCARDLESS/).first(), { clic: true, que: 'el ingreso de GoCardless', pausa: 4000 })
    await a(E, E.page.getByText(/Ingreso de GoCardless/).first(), { que: 'su casado', pausa: 3500 })
    await E.captura()
  })

  await escena('09', async (E) => {
    await tarjeta(E, `<div class="c"><div class="g">Sin teclear recibos.<br>Sin facturar a mano.<br>Sin descuadres.</div><div class="m">Sumied para gestorías</div></div>`)
    E.empezar(); await E.page.waitForTimeout(6000); await E.captura()
  }, { conSesion: false })

  await escena('10', async (E) => {
    E.empezar()
    const P = 'scripts/video/gd/maquetas'; const arriba = 'En construcción · llega el 17/11 en IFEMA'
    await tarjeta(E, `<div class="c"><div class="g">El portal de tus clientes</div><div class="p">${arriba}</div></div>`); await E.page.waitForTimeout(3500)
    await still(E, `${P}/1-inicio.png`, 'Tu cliente ve su próximo recibo explicado, y puede decir «No estoy de acuerdo» antes del cargo', arriba)
    await E.captura()
    await still(E, `${P}/2-devuelto.png`, 'Si un recibo se devuelve, lo paga en un clic: desde su banco, o con tarjeta o Bizum', arriba)
    await still(E, `${P}/3-facturas.png`, 'Todas sus facturas, en PDF, cuando quiera', arriba)
    await still(E, `${P}/4-documentos.png`, 'Sube sus facturas y tickets con una foto, y ve sus impuestos presentados', arriba)
    await still(E, `${P}/5-trabajadores.png`, 'Pide altas y bajas, y tú las haces', arriba)
    await still(E, `${P}/6-mensajes.png`, 'Y habla contigo sin correos ni llamadas', arriba)
  }, { conSesion: false })
} catch (e) {
  fallos.push(`general: ${e.message.split('\n')[0]}`)
} finally {
  await salir().catch(() => {})
  await navegador.close()
}

// ── Montaje: los clips que haya, en su orden ─────────────────────────────────
const clips = ORDEN.map((id) => join(SALIDA, 'escenas', `${id}.mp4`)).filter((f) => existsSync(f))
if (clips.length) {
  const lista = join(SALIDA, 'crudo', 'lista.txt')
  execFileSync('bash', ['-c', `printf "file '%s'\\n" ${clips.map((c) => `'${c}'`).join(' ')} > '${lista}'`])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(SALIDA, 'gd-qbo.mp4')])
  const dura = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(SALIDA, 'gd-qbo.mp4')]).toString().trim()
  decir(`\nMontado gd-qbo.mp4: ${clips.length} escenas, ${Math.round(Number(dura))} s.`)
}
decir(`\nModo ${MODO}. ${enviado ? 'El cobro de la demo se ha ENVIADO al sandbox.' : 'El cobro no se ha enviado.'}`)
if (fallos.length) { decir(`\nLo que no ha salido (${fallos.length}):`); for (const f of fallos) decir(`  - ${f}`) } else decir('\nTodas las escenas, completas.')
