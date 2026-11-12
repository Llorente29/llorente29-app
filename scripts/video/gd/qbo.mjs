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
//   MODO=ensayo  no escribe nada: ni prepara ni envía el cobro. Sirve para
//                ver las pantallas y los rótulos.
//   MODO=grabar  prepara y envía el cobro de diciembre de la demo (autorizado
//                por Julio, nº52: solo la demo y el sandbox). No toca Bitrix24
//                salvo con «00»: entonces, antes de grabar, pulsa «Volver a
//                empezar» como Julio, solo en la Gestoría Demo (nº78).
//
// Las escenas 5 y 7b son tomas que graba Julio desde su Chrome (nº60), en GIF,
// en la rama video-tomas/gd-qbo, carpeta tomas/: 05-bitrix.gif y
// 05-sumied.gif (en pantalla partida) y 07b-buzon.gif. Aquí se les ponen los
// rótulos; sin la toma, queda su hueco y se dice.
//
// La sesión: un enlace de acceso generado en el servidor (generateLink) y
// canjeado aquí (verifyOtp), sin correo. Al acabar, la cuenta abierta de Julio
// vuelve a la que tenía. Ningún secreto se escribe en el registro.
//
// Solo sistemas de pruebas y datos inventados: la cuenta tiene que ser demo
// (is_demo).

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CURSOR, raton } from '../raton.mjs'

const env = (k) => (process.env[k] ?? '').trim()
const SUPABASE_URL = env('SUPABASE_URL'); const SERVICE = env('SERVICE_KEY'); const ANON = env('ANON_KEY')
const APP = env('APP') || 'https://app.sumied.com'
const MODO = env('MODO') === 'grabar' ? 'grabar' : 'ensayo'
const TOMAS = resolve(env('TOMAS') || join(SALIDA, 'tomas'))
const SALIDA = resolve(env('SALIDA') || 'video-salida')
const CUENTA = 'de000000-0000-4000-8000-0000000000a0'
const SOCIEDAD = 'de000000-0000-4000-8000-0000000000a9'
const JULIO = 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a'
const MES = /^\d{4}-\d{2}$/.test(env('MES')) ? env('MES') : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7)
const CLIENTE = 'Talleres Ruiz, S.L.'
const W = 1440; const H = 900

const ORDEN = ['01', '02', '03', '04', '05', '05b', '06', '07', '07b', '07c', '08', '09', '10']
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
  localStorage.setItem(${JSON.stringify(`folvy.conta.empresa.${CUENTA}`)}, ${JSON.stringify(SOCIEDAD)});
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
  const t0 = Date.now(); const marca = { desde: 0, cortes: [] }
  const ahora = () => (Date.now() - t0) / 1000
  const E = { page, ctx, R: raton(page), empezar: () => { marca.desde = ahora() }, captura: async () => page.screenshot({ path: join(SALIDA, 'capturas', `${id}.png`) }),
    // nº91 · Lo que pasa dentro de `tapar` (una pantalla cargando) se graba pero no sale en la escena: se corta al montar.
    tapar: async (fn) => { const a = ahora(); try { return await fn() } finally { marca.cortes.push([a, ahora()]) } } }
  try { await fn(E) } catch (e) { fallos.push(`${id}: ${e.message.split('\n')[0]}`); decir(`  ✗ ${e.message.split('\n')[0]}`); await E.captura().catch(() => {}) }
  await page.close(); await ctx.close()
  if (E.sinEscena) { rmSync(join(SALIDA, 'escenas', `${id}.mp4`), { force: true }); rmSync(join(SALIDA, 'capturas', `${id}.png`), { force: true }); decir(`  · sin escena ${id}: queda fuera del montaje`); return }
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))
  if (!webm) { fallos.push(`${id}: sin vídeo`); return }
  renameSync(join(dir, webm), join(dir, 'clip.webm'))
  const cortes = marca.cortes.map(([x, y]) => [Math.max(0, x - marca.desde), y - marca.desde]).filter(([x, y]) => y > x)
  const quitar = cortes.length ? `select='not(${cortes.map(([x, y]) => `between(t,${x.toFixed(2)},${y.toFixed(2)})`).join('+')})',setpts=N/30/TB,` : ''
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, marca.desde)), '-i', join(dir, 'clip.webm'),
    '-vf', `fps=30,${quitar}scale=${ancho}:${alto},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an', join(SALIDA, 'escenas', `${id}.mp4`)])
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

// nº87 · El ingreso del banco que trae el cobro de CLIENTE (Talleres Ruiz): su importe tal como sale en Movimientos
// («+247,25») y si ya está casado. La 07c y la 08 lo enseñan a él, no al primero de la lista (el 10/11 fue uno
// «para confirmar», en amarillo, bajo el rótulo «se casa solo»).
async function ingresoDelCliente() {
  const { data: cli } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).limit(2)
  if ((cli ?? []).length !== 1) return null
  const { data: rec } = await admin.from('conta_recibo').select('gc_cobro_id').eq('account_id', CUENTA).eq('party_id', cli[0].id).eq('mes', MES).maybeSingle()
  if (!rec?.gc_cobro_id) return null
  const { data: cobro } = await admin.from('conta_gc_cobro').select('payout_gc_id').eq('account_id', CUENTA).eq('gc_id', rec.gc_cobro_id).maybeSingle()
  if (!cobro?.payout_gc_id) return null
  const { data: po } = await admin.from('conta_gc_payout').select('importe, match_id').eq('account_id', CUENTA).eq('gc_id', cobro.payout_gc_id).maybeSingle()
  if (!po) return null
  const texto = `+${Number(po.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return { texto, casado: po.match_id !== null }
}

// nº91 · La 57200002 cuadrada. El mayor solo cuenta lo validado, y los asientos del banco de los ingresos de GoCardless
// se quedan «por validar» aunque estén casados: sin validarlos, el mayor enseña el debe de las facturas y ningún haber.
// Se validan, como Julio y con la misma función que «Validar» de Bancos › Movimientos, SOLO los de las liquidaciones
// cuyos cobros son todos recibos facturados por Sumied: así queda la comisión de GoCardless de esos cobros. Los de
// liquidaciones sin factura (pagos de pruebas de otras veces que el sandbox guarda, y cobros devueltos) no se tocan.
async function validarIngresosFacturados() {
  const { data: pos } = await admin.from('conta_gc_payout').select('gc_id, importe, comision, match_id').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).not('match_id', 'is', null)
  const { data: cobros } = await admin.from('conta_gc_cobro').select('gc_id, payout_gc_id').eq('account_id', CUENTA).not('payout_gc_id', 'is', null)
  const { data: recs } = await admin.from('conta_recibo').select('gc_cobro_id, invoice_id').eq('account_id', CUENTA).not('gc_cobro_id', 'is', null)
  const facturado = new Set((recs ?? []).filter((r) => r.invoice_id).map((r) => r.gc_cobro_id))
  const porPayout = new Map()
  for (const c of cobros ?? []) porPayout.set(c.payout_gc_id, [...(porPayout.get(c.payout_gc_id) ?? []), c.gc_id])
  const buenos = (pos ?? []).filter((p) => (porPayout.get(p.gc_id) ?? []).length > 0 && porPayout.get(p.gc_id).every((g) => facturado.has(g)))
  const { data: casados } = await admin.from('bank_match').select('id, journal_entry_id').in('id', buenos.map((p) => p.match_id))
  const asientos = (casados ?? []).map((m) => m.journal_entry_id).filter(Boolean)
  const { data: prop } = await admin.from('journal_entry').select('id').in('id', asientos).eq('status', 'propuesto')
  const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('account_id', CUENTA).eq('user_id', sesion.user.id).maybeSingle()
  const quienValida = perfil?.display_name ?? null
  let bien = 0; const mal = []
  for (const { id } of prop ?? []) {
    const { error } = await comoJulio.rpc('journal_entry_validar', { p_entry: id, p_quien_nombre: quienValida })
    if (error) mal.push(error.message); else bien++
  }
  const com = buenos.reduce((t, p) => t + Number(p.comision), 0)
  decir(`  · 7c: ${buenos.length} ingresos de cobros facturados; validados ahora ${bien} (ya lo estaban ${asientos.length - (prop ?? []).length}). Comisión de GoCardless que debe quedar en la 57200002: ${com.toFixed(2)} €.`)
  if (mal.length) fallos.push(`07c: ${mal.length} asientos del banco no se han podido validar: ${mal[0]}`)
  // El saldo de la 57200002 con lo validado, como lo saca el mayor.
  const { data: cta } = await admin.from('company_account').select('id').eq('company_id', SOCIEDAD).eq('code', '57200002').maybeSingle()
  const { data: lin } = await admin.from('journal_line').select('debit, credit, journal_entry!inner(status, voided_at)').eq('company_account_id', cta?.id ?? '').eq('journal_entry.status', 'validado').is('journal_entry.voided_at', null)
  const saldo = (lin ?? []).reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0)
  decir(`  · 7c: la 57200002 con lo validado: ${saldo.toFixed(2)} € ${saldo >= 0 ? 'deudor' : 'acreedor'}.`)
  if (Math.abs(saldo - com) > 0.005) fallos.push(`07c · 3: la 57200002 queda en ${saldo.toFixed(2)} € y la comisión es ${com.toFixed(2)} €: no cuadra`)
}

// ── Las escenas ──────────────────────────────────────────────────────────────
// nº84 · Si «Volver a empezar» falla, el run sale en ROJO (antes salía verde con el fallo escondido en el
// registro): el workflow mira este fichero en su último paso, después de publicar lo que haya.
let volverFallo = false
const ROJO = join(process.env.RUNNER_TEMP ?? SALIDA, 'gd-qbo-rojo.txt')
rmSync(ROJO, { force: true })
try {
  if (pedidas.some((id) => ['00', '02', '03', '04', '06', '07', '07c', '08'].includes(id))) await entrar()

  // 00 · «Volver a empezar», pulsado por el guion (Julio, nº78): los mismos pasos que el botón de Ajustes › Tu cuenta,
  // con la sesión de Julio y solo en la Gestoría Demo (la función se niega fuera de una demo, y sus guardas solo
  // dejan el portal b24-s3mr2y y el sandbox). Los pasos por tandas se repiten mientras digan «sigue». No es una escena.
  if (pedidas.includes('00')) {
    if (MODO !== 'grabar') decir('\n── 00 · «Volver a empezar»: solo en modo grabar; en ensayo no se pulsa.')
    else {
      decir('\n── 00 · «Volver a empezar»')
      const PASOS_VOLVER = ['comprobar', 'portal_borrar', 'portal_sembrar', 'sandbox_borrar', 'sandbox_sembrar', 'sumied', 'leer', 'tarifa', 'historia', 'cambios', 'portal']
      for (const paso of PASOS_VOLVER) {
        for (let tanda = 1; ; tanda++) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/conta-gd-volver-a-empezar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${sesion.access_token}` },
            body: JSON.stringify({ cuenta: CUENTA, paso }),
          })
          const d = await r.json().catch(() => ({}))
          if (!r.ok || !d.ok) { volverFallo = true; throw new Error(`«Volver a empezar» · ${paso}: ${d.error ?? r.status}`) }
          if (!d.sigue) { decir(`  ✓ ${paso}: ${String(d.frase ?? '').slice(0, 300)}`); break }
          if (tanda >= 8) { volverFallo = true; throw new Error(`«Volver a empezar» · ${paso}: después de 8 tandas aún queda trabajo`) }
          decir(`  · ${paso}: tanda ${tanda}, sigue`)
        }
      }
      decir('  Hecho: la demo está como el primer día.')
    }
  }

  await escena('01', async (E) => {
    await tarjeta(E, `<div class="c"><div class="g">Sumied para gestorías</div><div class="m">Asesoría QBO</div><div class="p">Datos de demostración</div></div>`)
    E.empezar(); await E.page.waitForTimeout(5000); await E.captura()
  }, { conSesion: false })

  await escena('02', async (E) => {
    E.id = '02'
    await ir(E.page, '/conta/ventas/clientes-y-cuotas'); E.empezar()
    await rotulo(E.page, 'Todos tus clientes y lo que cobras a cada uno, en una pantalla'); await E.page.waitForTimeout(3500)
    for (const t of ['Cuotas al mes', 'Te deben', 'Dejas de cobrar', 'Precio sin revisar']) await a(E, E.page.getByText(t, { exact: false }), { que: t, pausa: 1300 })
    await a(E, E.page.getByText('Lo que tienes que hacer'), { que: 'Lo que tienes que hacer', pausa: 2500 })
    await E.captura()
    await a(E, E.page.getByText(CLIENTE, { exact: true }), { clic: true, que: CLIENTE, pausa: 3500 })
    await E.captura()
  })

  await escena('03', async (E) => {
    E.id = '03'
    const { data: cli } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).maybeSingle()
    if (!cli) throw new Error(`No está «${CLIENTE}» en la demo.`)
    await ir(E.page, `/conta/ventas/clientes-y-cuotas/cliente/${cli.id}`); E.empezar()
    await rotulo(E.page, 'Cada cliente, con su recibo explicado línea a línea'); await E.page.waitForTimeout(3500)
    await a(E, E.page.getByRole('button', { name: 'Ver trabajadores' }), { clic: true, que: 'Ver trabajadores', pausa: 3000 })
    await E.captura()
    for (const t of ['Cobros', 'Contacto']) await a(E, E.page.getByRole('tab', { name: t, exact: true }), { clic: true, que: `pestaña ${t}`, pausa: 3200 })
    await a(E, E.page.getByRole('tab', { name: /^Datos de / }), { clic: true, que: 'pestaña Datos del CRM', pausa: 3500 })
  })

  await escena('04', async (E) => {
    E.id = '04'
    await ir(E.page, '/conta/ventas/clientes-y-cuotas/tarifas'); E.empezar()
    await rotulo(E.page, 'Tu tarifa, tal como la cobras hoy'); await E.page.waitForTimeout(3500)
    // Cada servicio de la lista de la izquierda, por su nombre; dentro, lo que lo hace distinto.
    const servicio = (n) => E.page.getByText(n, { exact: true }).first()
    if (await a(E, servicio('Gestoría mensual'), { clic: true, que: 'Gestoría mensual', pausa: 1800 })) {
      for (const t of ['Básica', 'Estándar', 'Premium']) await a(E, E.page.getByText(t, { exact: true }), { que: t, pausa: 1200 })
      await E.captura()
      await a(E, E.page.getByText(/precio especial|su propio precio/i), { que: 'precio especial', pausa: 2500 })
    }
    await a(E, servicio('Gestión laboral'), { clic: true, que: 'Gestión laboral', pausa: 3000 })
    await a(E, servicio('Nóminas'), { clic: true, que: 'Nóminas', pausa: 3000 })
    await a(E, E.page.getByText(/^Pack Empresa/).first(), { clic: true, que: 'Pack Empresa', pausa: 3500 })
  })

  // 5 y 7b · Las tomas que graba Julio desde su Chrome (nº60), en GIF, con los rótulos del vídeo.
  //   tomas/05-bitrix.gif y tomas/05-sumied.gif: en pantalla partida. tomas/07b-buzon.gif: entera.
  //   Sin la toma, la escena no se monta y se dice (queda su hueco).
  // Cada toma: { f: fichero, desde: segundos en que aparece (0 = al empezar), titulo: lo que se ve mientras espera }.
  // Busca primero en scripts/video/gd/tomas (las que van en el repositorio) y después en TOMAS (video-tomas/gd-qbo).
  const dondeToma = (f) => [join('scripts/video/gd/tomas', f), join(TOMAS, f)].find((x) => existsSync(x)) ?? null
  const duraGif = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()) || 0 } catch { return 0 } }
  async function toma(id, tomas, rotulos) {
    if (!pedidas.includes(id)) return
    const faltan = tomas.filter((t) => !dondeToma(t.f)).map((t) => t.f)
    if (faltan.length) { fallos.push(`${id}: falta la toma (${faltan.join(', ')}): queda su hueco`); decir(`\n── Escena ${id}: falta ${faltan.join(', ')}`); return }
    const fin = Math.min(45, Math.max(8, ...tomas.map((t) => (t.desde ?? 0) + duraGif(dondeToma(t.f))))) + 4
    await escena(id, async (E) => {
      const celdas = tomas.map((t, k) => `<div class="c"><div class="espera">${t.titulo ?? ''}</div><img id="t${k}" style="display:none"></div>`).join('')
      await E.page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@600&display=swap" rel="stylesheet"><style>
        html,body{margin:0;height:100%;background:#33435E}.f{display:flex;height:${H}px;gap:${tomas.length > 1 ? 6 : 0}px}
        .c{flex:1;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#2A3A56}
        .espera{position:absolute;color:#8FA3C0;font:600 26px Inter,'DejaVu Sans',sans-serif}
        img{max-width:100%;max-height:100%;object-fit:contain;display:block;position:relative;z-index:1;animation:entra .5s ease-out}
        @keyframes entra{from{opacity:0}to{opacity:1}}</style></head><body><div class="f">${celdas}</div></body></html>`)
      await E.page.waitForTimeout(600); E.empezar()
      const t0 = Date.now()
      const poner = (k) => E.page.evaluate(([k, src]) => { const im = document.getElementById(`t${k}`); im.src = src; im.style.display = 'block' }, [k, `data:image/gif;base64,${readFileSync(dondeToma(tomas[k].f)).toString('base64')}`])
      const eventos = [
        ...tomas.map((t, k) => ({ en: t.desde ?? 0, hacer: () => poner(k) })),
        ...rotulos.map((r) => ({ en: r.en, hacer: () => rotulo(E.page, r.t) })),
      ].sort((x, y) => x.en - y.en)
      for (const ev of eventos) { const falta = ev.en * 1000 - (Date.now() - t0); if (falta > 0) await E.page.waitForTimeout(falta); await ev.hacer() }
      const falta = fin * 1000 - (Date.now() - t0); if (falta > 0) await E.page.waitForTimeout(falta)
      await E.captura()
    }, { conSesion: false })
  }
  // 5 · Julio cambia la situación de Librería El Faro en el Bitrix24 de pruebas (de Activo a Moroso) y Sumied
  // lo recibe en segundos (leído a las 18:25:49 UTC del 09/11). Sumied entra cuando Bitrix24 ya ha guardado.
  await toma('05', [
    { f: '05-bitrix.gif', desde: 0, titulo: 'Bitrix24' },
    { f: '05-sumied.gif', desde: 15, titulo: 'Sumied' },
  ], [{ t: 'Lo que cambias en Bitrix24, Sumied lo sabe en segundos', en: 0 }, { t: 'Sin tocar tu forma de trabajar', en: 15.5 }])

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
      // La barra de «Enviar el cobro» solo está con el cobro ya preparado («Lo que cambia» también sale en los pasos de arriba).
      await E.R.clic(preparar); await E.page.locator('section.g5-barra').waitFor({ timeout: 180_000 }).catch(() => {}); await E.page.waitForTimeout(2000)
    }
    if (!(await E.page.locator('section.g5-barra').isVisible().catch(() => false))) fallos.push('06: el cobro no está preparado (sin la barra de «Enviar el cobro»)')
    await E.captura()
    const cambios = E.page.locator('li.g5-cambio')
    const n = await cambios.count(); decir(`  · ${n} cambios`)
    // Primero el del 30 %, si lo hay: el que pide mirarlo.
    const fuerte = E.page.locator('li.g5-cambio[data-fuerte="si"]').first()
    if (await fuerte.isVisible().catch(() => false)) { await E.R.a(fuerte.locator('.g5-cambio-porque')); await E.page.waitForTimeout(3000) }
    for (let i = 0; i < Math.min(n, 2); i++) { await E.R.a(cambios.nth(i).locator('.g5-cambio-porque')).catch(() => {}); await E.page.waitForTimeout(1800) }
    if (MODO === 'grabar') {
      // Cada aprobación se guarda antes de la siguiente: mientras se guarda, los botones están desactivados.
      const libre = () => E.page.waitForFunction(() => !document.querySelector('.g5-cambio .g4-boton[disabled], .g4-boton[data-tipo="primario"][disabled]'), null, { timeout: 30_000 }).catch(() => {})
      // «Este mes no»: la baja de Reformas Atalaya se deja fuera de este cobro (nº68).
      await libre()
      const fuera = E.page.locator('li.g5-cambio').filter({ hasText: 'Reformas Atalaya' }).getByRole('button', { name: 'Este mes no' })
      if (await fuera.first().isVisible().catch(() => false)) { await E.R.clic(fuera.first()); await E.page.waitForTimeout(2500); await libre() }
      else decir('  · no está: «Este mes no» de Reformas Atalaya')
      // Se aprueba hasta que no quede ningún «Aprobar» en los cambios: si uno no se ve un momento (la lista se vuelve a
      // pintar después de cada aprobación), se espera y se vuelve a mirar antes de darlo por acabado (nº74).
      const pendiente = () => E.page.locator('li.g5-cambio .g4-boton[data-tipo="primario"]:not([disabled])').first()
      for (let i = 0, vacios = 0; i < 80 && vacios < 3; i++) {
        await libre()
        const b = pendiente()
        if (!(await b.isVisible().catch(() => false))) { vacios++; await E.page.waitForTimeout(1000); continue }
        vacios = 0
        await b.scrollIntoViewIfNeeded().catch(() => {})
        if (i < 2) { await E.R.clic(b); await E.page.waitForTimeout(1500) } else { await b.click(); await E.page.waitForTimeout(600) }
      }
      await libre()
      const iguales = E.page.getByRole('button', { name: /^Aprobar (el que no cambia|los \d+)/ })
      if (await iguales.isVisible().catch(() => false)) {
        await iguales.scrollIntoViewIfNeeded(); await E.page.waitForFunction((el) => !el.disabled, await iguales.elementHandle(), { timeout: 30_000 }).catch(() => {})
        await E.R.clic(iguales); await E.page.waitForTimeout(1500); await libre(); await E.page.waitForTimeout(1500)
      }
    } else await a(E, E.page.getByRole('button', { name: /^Aprobar/ }), { que: 'Aprobar los iguales', pausa: 2000 })
    const verLista = E.page.getByRole('button', { name: 'Ver la lista' })
    if (await a(E, E.page.getByText('No entran'), { que: 'No entran', pausa: 1200 }) && await verLista.isVisible().catch(() => false)) { await E.R.clic(verLista); await E.page.waitForTimeout(3000) }
    const enviar = E.page.locator('button.g5-enviar')
    if (await a(E, enviar, { que: 'Enviar el cobro', pausa: 800 })) {
      if (MODO === 'grabar') await E.page.waitForFunction((el) => !el.disabled, await enviar.elementHandle(), { timeout: 30_000 }).catch(() => {})
      if (MODO === 'grabar' && await enviar.isEnabled()) {
        await E.R.clic(enviar); await E.page.waitForTimeout(3500); await E.captura()
        const si = E.page.getByRole('dialog').getByRole('button', { name: /^Sí, enviar/ })
        await E.R.clic(si)
        // Enviado de verdad: lo dice la base (conta_cobro_mes.enviado_at), no la pantalla.
        const desdeEnvio = Date.now()
        while (Date.now() - desdeEnvio < 180_000) {
          const { data } = await admin.from('conta_cobro_mes').select('enviado_at').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).eq('mes', MES).maybeSingle()
          if (data?.enviado_at) { enviado = true; break }
          await E.page.waitForTimeout(3000)
        }
        await E.page.waitForTimeout(3500)
        decir(enviado ? '  · COBRO ENVIADO al sandbox.' : '  · OJO: pulsado «Sí, enviar» y la base no dice enviado en 3 minutos.')
        if (!enviado) fallos.push('06: la base no dice enviado tras «Sí, enviar»')
      } else if (MODO === 'grabar') fallos.push('06: «Enviar el cobro» no se deja pulsar (falta revisar algo)')
    }
    await E.captura()
  })

  // 7 · Cobrado y facturado: se espera a los avisos del sandbox fuera de cámara.
  if (pedidas.includes('07') && MODO === 'grabar' && !enviado) decir('\nSin cobro enviado en esta grabación: no se espera a las facturas.')
  if (pedidas.includes('07') && MODO === 'grabar' && enviado) {
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
    // nº86 · La factura de CLIENTE (Talleres Ruiz), la que lleva los trabajadores y la que llega al buzón en la 7b; no
    // la última que salió, que el 10/11 fue una de una sola línea (Floristería Las Camelias) bajo «con sus trabajadores».
    const { data: cli } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).limit(2)
    if ((cli ?? []).length !== 1) { fallos.push(`07: ${CLIENTE} no está una sola vez en la demo (${(cli ?? []).length})`); if (MODO === 'grabar') E.sinEscena = true; return }
    const { data: rec } = await admin.from('conta_recibo').select('invoice_id').eq('account_id', CUENTA).eq('party_id', cli[0].id).eq('mes', MES)
      .not('invoice_id', 'is', null).limit(1)
    const factura = rec?.[0]?.invoice_id
    if (!factura) { fallos.push(`07: ${CLIENTE} aún no tiene factura de ${MES}`); if (MODO === 'grabar') E.sinEscena = true; return }
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

  await toma('07b', [{ f: '07b-buzon.gif', desde: 0 }], [{ t: 'Y le llega a tu cliente por correo, sin que nadie la mande', en: 0 }])

  // 7c · La contabilidad de punta a punta de UN cliente, Talleres Ruiz, en Gestoría Demo, S.L. (Julio, nº75):
  //   su factura en el libro de IVA repercutido; el mayor de su 430 (factura al debe, cobro al haber, saldo 0); el
  //   mayor de la 57200002 (entra el cobro, sale el ingreso al banco; queda la comisión, sin taparla ni rotularla); y
  //   el banco 57200000 con el ingreso de GoCardless casado con sus cobros. Rótulo solo al final. Lo que aún no se
  //   puede enseñar se graba igual y se apunta, con su captura (capturas/07c-N.png), para decidir antes de montar.
  await escena('07c', async (E) => {
    E.id = '07c'
    const paso = async (n, que) => { await E.page.screenshot({ path: join(SALIDA, 'capturas', `07c-${n}.png`) }); decir(`  · 7c · ${n}: ${que}`) }
    const { data: cli } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).maybeSingle()
    if (!cli) throw new Error(`No está «${CLIENTE}» en la demo.`)
    // Lo que tiene que haber para cada paso, medido antes (solo lectura).
    const { data: rec } = await admin.from('conta_recibo').select('invoice_id, estado').eq('account_id', CUENTA).eq('party_id', cli.id).eq('mes', MES).maybeSingle()
    if (!rec?.invoice_id) fallos.push(`07c · 1-2: ${CLIENTE} aún no tiene factura de ${MES} (recibo: ${rec?.estado ?? 'ninguno'})`)
    const { data: c430 } = await admin.from('company_account').select('code').eq('company_id', SOCIEDAD).like('code', '430%').ilike('name', 'Talleres Ruiz%').limit(1).maybeSingle()
    if (!c430) fallos.push(`07c · 2: ${CLIENTE} aún no tiene su subcuenta 430`)
    const ingreso = await ingresoDelCliente()
    if (!ingreso) fallos.push(`07c · 4: el cobro de ${CLIENTE} aún no ha llegado al banco (sin liquidación de GoCardless)`)
    else if (!ingreso.casado) fallos.push(`07c · 4: el ingreso de ${CLIENTE} (${ingreso.texto}) aún no está casado`)
    if (MODO === 'grabar') await validarIngresosFacturados()

    // 1 · Su factura en el libro de IVA repercutido (expedidas).
    await ir(E.page, '/conta/libros/registro/expedidas'); E.empezar(); await E.page.waitForTimeout(1500)
    if (!(await a(E, E.page.getByText(/Talleres Ruiz/).first(), { que: '7c · 1: Talleres Ruiz en el libro de IVA repercutido', pausa: 5000 }))) await rodar(E.page, 400)
    await paso(1, 'libro de IVA repercutido')
    // 2 · El mayor de su 430.
    if (c430) {
      await ir(E.page, `/conta/plan/${c430.code}`); await E.page.waitForTimeout(1500)
      await a(E, E.page.getByText(/Saldo/).first(), { que: '7c · 2: el saldo del mayor de su 430', pausa: 5500 })
      await paso(2, `mayor de la ${c430.code}`)
    }
    // 3 · El mayor de la 57200002 (Plataforma GoCardless). La comisión que queda, tal cual.
    await ir(E.page, '/conta/plan/57200002'); await E.page.waitForTimeout(1500)
    await a(E, E.page.getByText(/Talleres Ruiz|GoCardless/).first(), { que: '7c · 3: el mayor de la 57200002', pausa: 5500 })
    await paso(3, 'mayor de la 57200002')
    // 4 · El banco 57200000: el ingreso de GoCardless, casado con sus cobros.
    await E.tapar(async () => {
      await ir(E.page, '/conta/bancos')
      await E.page.getByText(ingreso?.texto ?? /GOCARDLESS/, { exact: !!ingreso }).first().waitFor({ timeout: 30_000 }).catch(() => fallos.push('07c · 4: los movimientos no han salido en 30 s'))
    })
    await E.page.waitForTimeout(800)
    await a(E, ingreso ? E.page.getByText(ingreso.texto, { exact: true }).first() : E.page.getByText(/GOCARDLESS/).first(),
      { clic: true, que: `7c · 4: el ingreso de GoCardless de ${CLIENTE} en el banco`, pausa: 5000 })
    await paso(4, 'banco 57200000')
    await rotulo(E.page, 'De la cuota al banco, contabilizado solo. Sin teclear un asiento'); await E.page.waitForTimeout(4500)
    await E.captura()
  })

  await escena('08', async (E) => {
    E.id = '08'
    // Lo mismo que hace el cron de cada 30 minutos (solo cuentas demo), por si aún no ha pasado.
    if (MODO === 'grabar') await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: CUENTA }).then(({ data }) => decir(`  · ${data?.frase ?? ''}`))
    const { count } = await admin.from('bank_movement').select('id', { count: 'exact', head: true }).eq('account_id', CUENTA).eq('company_id', SOCIEDAD)
    if (!count) { fallos.push('08: aún no hay ningún ingreso de GoCardless en el banco de la demo: escena fuera'); E.sinEscena = true; return }
    const ingreso = await ingresoDelCliente()
    if (!ingreso?.casado) { fallos.push(`08: el ingreso de ${CLIENTE} aún no está casado (${ingreso?.texto ?? 'sin liquidación'}): escena fuera`); E.sinEscena = true; return }
    await ir(E.page, '/conta/bancos'); E.empezar()
    await rotulo(E.page, 'El ingreso de GoCardless se casa solo en el banco'); await E.page.waitForTimeout(2500)
    // nº91 · Primero la pestaña «Casados solos»: solo los verdes, sin ninguno «para confirmar».
    await a(E, E.page.getByRole('button', { name: /Casados solos/ }).first(), { clic: true, que: 'la pestaña «Casados solos»', pausa: 2500 })
    // En «Casados solos» cada línea lleva su importe sin el «+» y su botón «Abrir».
    await a(E, E.page.getByRole('listitem').filter({ hasText: ingreso.texto.replace(/^\+/, '') }).getByRole('button', { name: 'Abrir' }).first(), { clic: true, que: `el ingreso de GoCardless de ${CLIENTE} (${ingreso.texto})`, pausa: 4000 })
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
if (volverFallo) {
  const porque = fallos.find((f) => f.includes('«Volver a empezar»')) ?? '«Volver a empezar» ha fallado'
  writeFileSync(ROJO, `${porque}\n`)
  decir('\nEN ROJO: «Volver a empezar» no ha acabado; no se ha grabado ninguna escena. Las que se ven son de la grabación anterior.')
}
