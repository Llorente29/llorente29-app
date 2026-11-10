#!/usr/bin/env node
// scripts/video/gd/sumied.mjs — GD · El vídeo de Sumied para gestorías (nº96, fase 3), con la máquina del V01.
//
//   MODO=ensayo node scripts/video/gd/sumied.mjs <salida>   recorre el guion entero SIN GRABAR y SIN ESCRIBIR:
//        cada frase busca lo que va a señalar; lo que escribiría (preparar, aprobar, «Este mes no», enviar,
//        validar, pagar) solo se señala. Dice en <salida>/registro.txt qué gesto falla. Con alguno, en rojo.
//   MODO=grabar node scripts/video/gd/sumied.mjs <salida>   graba UNA toma (crudo.webm, 1920×1080) con la
//        voz ya hecha (<salida>/voz/frases.json) y deja tramos.json para scripts/video/montar.mjs.
//        Escribe SOLO en la Gestoría Demo y en sus sistemas de pruebas (autorizado por Julio, nº52, nº78 y
//        nº98): prepara, aprueba y envía el cobro al sandbox, valida los asientos del banco de los ingresos
//        de cobros facturados (nº96, punto 7) y paga el devuelto de Electricidad Voltio con la tarjeta de
//        pruebas de Stripe (modo de pruebas). La demo tiene que estar limpia antes: «Volver a empezar».
//
// Como el guion del V01 (scripts/video/guion.mjs): cada frase de scripts/video/gd/locucion.mjs va pegada a un
// gesto (di), el guion espera a que acabe su voz, y lo que se espera (cargas, el sandbox) va en R.sinVer, que el
// montaje corta. El ratón apunta (R.objetivos) lo que se explica: el montaje hace zoom ahí.
//
// Las tomas que no se pueden grabar desde aquí (Bitrix24 y el buzón, en el Chrome de Julio) están en
// video-tomas/gd-qbo, carpeta tomas/ (TOMAS): 05-bitrix.gif, 05-sumied.gif, 05-pestana-{resumen,cuotas,laboral,
// portal}.gif y 07b-buzon.gif. Sin una toma, su escena se salta y se dice.

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CURSOR, raton, reloj, tarjeta } from '../raton.mjs'
import { FRASES, GESTOS, estimada } from './locucion.mjs'

const env = (k) => (process.env[k] ?? '').trim()
const SUPABASE_URL = env('SUPABASE_URL'); const SERVICE = env('SERVICE_KEY'); const ANON = env('ANON_KEY')
const APP = env('APP') || 'https://app.sumied.com'
const MODO = env('MODO') === 'grabar' ? 'grabar' : 'ensayo'
const GRABA = MODO === 'grabar'
const salida = resolve(process.argv[2] || env('SALIDA') || 'video-salida')
const TOMAS = resolve(env('TOMAS') || join(salida, 'tomas'))
// nº100 · El mes del cobro: el mes en curso (Madrid), salvo que se pida otro (AAAA-MM).
const MES = /^\d{4}-\d{2}$/.test(env('MES')) ? env('MES') : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7)
// nº99 · Las escenas que se graban: «todas», o una lista (p. ej. «01,02,03» para la prueba de la voz y el zoom).
const ESCENAS = env('ESCENAS') && env('ESCENAS') !== 'todas' ? env('ESCENAS').split(/[\s,]+/).filter(Boolean) : null
const pide = (e) => !ESCENAS || ESCENAS.includes(e)
/** El mes siguiente (AAAA-MM): el del recibo que queda preparado, sin enviar (nº100; como mesSiguiente de pasos.ts). */
const mesSiguiente = (mes) => { const [a, m] = mes.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}` }
const CUENTA = 'de000000-0000-4000-8000-0000000000a0'
const SOCIEDAD = 'de000000-0000-4000-8000-0000000000a9'
const JULIO = 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a'
const CLIENTE = 'Talleres Ruiz, S.L.'
const DEVUELTO = { cliente: 'Electricidad Voltio, S.L.', correo: 'felipe.herrera@electricidadvoltio.example', nombre: 'Felipe' }
const PORTAL = { cliente: CLIENTE, correo: 'tomas.ruiz@talleresruiz.example', nombre: 'Tomás' }
// El alta del mes (la deja «Volver a empezar», CAMBIOS_DEL_MES en pasos.ts).
const TRABAJADOR_NUEVO = 'Lucas Ferrer Gil'
const W = 1920; const H = 1080
const REF = new URL(SUPABASE_URL || 'https://x.supabase.co').hostname.split('.')[0]

mkdirSync(join(salida, 'capturas'), { recursive: true })
const registro = []
const decir = (t) => { console.log(t); registro.push(t) }
const fallos = []
const fallo = (t) => { fallos.push(t); decir(`  ✗ ${t}`) }
// Para el resumen del «comprobar» (puerta de la demo): una línea por frase, con la forma «✓ v06.3 · <gesto>».
const resumen = ['### Vídeo · el guion, frase a frase (ensayo, sin grabar)']
const linea = (marca, id, extra = '') => { const t = `${marca} v${id} · ${GESTOS[id] ?? id}${extra ? `: ${extra}` : ''}`; resumen.push(t.length > 230 ? `${t.slice(0, 229)}…` : t) }
const noToca = (ids, porque) => { for (const id of ids) linea('—', id, `no toca (${porque})`); decir(`  — ${ids.join(', ')}: no toca (${porque})`) }
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

// ── La base: lecturas con la clave de servicio; lo que escribe, como Julio ───────
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
async function sesionDe(userId) {
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId)
  if (e1 || !u?.user?.email) throw new Error('No se encuentra el usuario.')
  const { data: l, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (e2 || !l?.properties?.hashed_token) throw new Error(`Sin enlace de acceso: ${e2?.message ?? 'sin token'}`)
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: e3 } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (e3 || !v?.session) throw new Error(`Sin sesión: ${e3?.message ?? 'sin sesión'}`)
  return { cliente: c, sesion: v.session }
}
async function usuarioDelPortal(a) {
  const { data: cli } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', a.cliente).maybeSingle()
  if (!cli) return null
  const { data: acc } = await admin.from('conta_portal_acceso').select('user_id').eq('account_id', CUENTA).eq('party_id', cli.id).ilike('correo', a.correo).is('revocado_at', null).maybeSingle()
  return acc?.user_id ? { party: cli.id, user: acc.user_id, nombre: a.nombre } : null
}
const reciboDe = async (party) => (await admin.from('conta_recibo').select('id, estado, gc_estado, invoice_id, gc_cobro_id').eq('account_id', CUENTA).eq('party_id', party).eq('mes', MES).maybeSingle()).data

/** El ingreso del banco que trae el cobro de CLIENTE: su importe como sale en Movimientos y si está casado. */
async function ingresoDe(party) {
  const rec = await reciboDe(party)
  if (!rec?.gc_cobro_id) return null
  const { data: c } = await admin.from('conta_gc_cobro').select('payout_gc_id').eq('account_id', CUENTA).eq('gc_id', rec.gc_cobro_id).maybeSingle()
  if (!c?.payout_gc_id) return null
  const { data: po } = await admin.from('conta_gc_payout').select('importe, match_id').eq('account_id', CUENTA).eq('gc_id', c.payout_gc_id).maybeSingle()
  if (!po) return null
  return { texto: Number(po.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), casado: po.match_id !== null }
}

/**
 * nº96, punto 7 · La 57200002 cuadrada: el mayor solo cuenta lo validado. Se validan, como Julio y con la misma
 * función que «Validar» de Bancos, SOLO los asientos del banco de las liquidaciones cuyos cobros son todos recibos
 * facturados por Sumied: queda la comisión de GoCardless de esos cobros. Lo demás no se toca.
 */
async function validarIngresosFacturados(comoJulio, quien) {
  const { data: pos } = await admin.from('conta_gc_payout').select('gc_id, comision, match_id').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).not('match_id', 'is', null)
  const { data: cobros } = await admin.from('conta_gc_cobro').select('gc_id, payout_gc_id').eq('account_id', CUENTA).not('payout_gc_id', 'is', null)
  const { data: recs } = await admin.from('conta_recibo').select('gc_cobro_id, invoice_id').eq('account_id', CUENTA).not('gc_cobro_id', 'is', null)
  const facturado = new Set((recs ?? []).filter((r) => r.invoice_id).map((r) => r.gc_cobro_id))
  const porPayout = new Map()
  for (const c of cobros ?? []) porPayout.set(c.payout_gc_id, [...(porPayout.get(c.payout_gc_id) ?? []), c.gc_id])
  const buenos = (pos ?? []).filter((p) => (porPayout.get(p.gc_id) ?? []).length > 0 && porPayout.get(p.gc_id).every((g) => facturado.has(g)))
  const { data: casados } = await admin.from('bank_match').select('journal_entry_id').in('id', buenos.map((p) => p.match_id))
  const asientos = (casados ?? []).map((m) => m.journal_entry_id).filter(Boolean)
  const { data: prop } = await admin.from('journal_entry').select('id').in('id', asientos).eq('status', 'propuesto')
  let bien = 0
  for (const { id } of prop ?? []) {
    const { error } = await comoJulio.rpc('journal_entry_validar', { p_entry: id, p_quien_nombre: quien })
    if (error) fallo(`08: un asiento del banco no se ha validado: ${error.message}`); else bien++
  }
  const com = buenos.reduce((t, p) => t + Number(p.comision), 0)
  decir(`  · ${buenos.length} ingresos de cobros facturados; validados ahora ${bien}. Comisión que queda en la 57200002: ${com.toFixed(2)} €.`)
}

// ── La grabación ─────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ args: ['--lang=es-ES'] })
await tarjeta(navegador, join(salida, 'portada.png'), 'Sumied para gestorías')
await tarjeta(navegador, join(salida, 'cierre.png'), 'Sumied para gestorías')

const rutaVoz = join(salida, 'voz', 'frases.json')
const durasVoz = new Map((existsSync(rutaVoz) ? JSON.parse(readFileSync(rutaVoz, 'utf8')) : []).filter((f) => f.dura).map((f) => [f.id, f.dura]))
decir(`Modo ${MODO} · ${durasVoz.size ? `voz hecha: ${durasVoz.size} frases` : 'sin voz: duraciones estimadas'} · mes ${MES}`)

const { data: cu } = await admin.from('accounts').select('is_demo').eq('id', CUENTA).maybeSingle()
if (cu?.is_demo !== true) { decir('La cuenta no es de demostración: no se sigue.'); process.exit(1) }
const julio = await sesionDe(JULIO)
const cuentaAntes = (await julio.cliente.rpc('_cuenta_activa')).data ?? null
await julio.cliente.rpc('cambiar_empresa', { p_account_id: CUENTA })
const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('account_id', CUENTA).eq('user_id', JULIO).maybeSingle()

const dirVideo = join(salida, 'video-tmp')
const ctx = await navegador.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid', acceptDownloads: true,
  ...(GRABA ? { recordVideo: { dir: dirVideo, size: { width: W, height: H } } } : {}) })
await ctx.addInitScript(`(() => { try {
  localStorage.setItem(${JSON.stringify(`sb-${REF}-auth-token`)}, ${JSON.stringify(JSON.stringify(julio.sesion))});
  localStorage.setItem('andy-app-active-account', ${JSON.stringify(CUENTA)});
  localStorage.setItem(${JSON.stringify(`folvy.conta.empresa.${CUENTA}`)}, ${JSON.stringify(SOCIEDAD)});
} catch (e) {} })()`)
await ctx.addInitScript(CURSOR)
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push(String(e.message).split('\n')[0]))
const R = reloj()
const ra = raton(page, R)
const quieto = (ms) => page.waitForTimeout(ms)

/** Una frase con su gesto. En ensayo no espera la voz: solo comprueba que el gesto se puede hacer. */
async function di(id, gesto) {
  if (!FRASES[id]) throw new Error(`No hay frase ${id} en locucion.mjs`)
  const dura = GRABA ? (durasVoz.get(id) ?? estimada(FRASES[id])) : 0.1
  try { await R.di(id, FRASES[id], dura, gesto); linea('✓', id) } catch (e) {
    const t = String(e.message).split('\n')[0]; linea('✗', id, t); fallo(`${id} (${GESTOS[id]}): ${t}`)
  }
}
/** Señala sin mover el ratón: el montaje mira la unión de estas cajas. */
async function mirar(...locs) {
  let alguna = false
  for (const l of locs) {
    const c = await l.first().boundingBox().catch(() => null)
    if (c) { ra.mira(c); alguna = true }
  }
  if (!alguna) throw new Error('no se ve lo que hay que señalar')
}
/** Va al elemento con el ratón (y el montaje mira su caja). Tiene que estar en 10 s. */
async function a(loc, ms = 800) {
  const l = loc.first()
  await l.waitFor({ state: 'visible', timeout: 10_000 })
  await ra.a(l, ms)
}
/** Pulsa, o en ensayo solo señala, lo que ESCRIBE en la demo. */
async function pulsaQueEscribe(loc, ms = 800, efecto = null) {
  const l = loc.first()
  await l.waitFor({ state: 'visible', timeout: 15_000 })
  if (!GRABA) { await ra.a(l, ms); return }
  await ra.clic(l, ms)
  // nº120 · El ratón va hasta donde ESTABA el botón y pulsa allí: si la página se mueve mientras va (la franja verde
  // «Aprobado el recibo de…» empuja todo hacia abajo), el clic cae fuera y no pasa nada (run 21: «Aprobar los 23» no
  // aprobó y el cobro no se envió). Se comprueba lo que tiene que pasar; si no pasa, se pulsa el botón de verdad, fuera
  // del montaje, y si aun así no, se dice.
  if (!efecto) return
  const paso = () => efecto.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
  if (await paso()) return
  let ok = false
  await R.sinVer(async () => { await l.click({ timeout: 15_000 }).catch(() => {}); ok = await paso() })
  if (!ok) throw new Error('el clic no ha hecho lo que tenía que hacer')
}
/** Pulsa lo que solo navega o abre (también en ensayo). */
async function pulsa(loc, ms = 800) { const l = loc.first(); await l.waitFor({ state: 'visible', timeout: 15_000 }); await ra.clic(l, ms) }
/**
 * nº118 · Ir a una pantalla y no seguir hasta que se vea lo que se espera. La primera pantalla del run 19 no salió a
 * tiempo y fallaron las cinco escenas de la 01 una detrás de otra. Ahora: hasta 3 intentos, recargando, dentro del
 * corte (no se graba). Si no sale, lo dice el RESUMEN (antes solo el registro, y se veían los «timeout» de las
 * escenas) con lo que se ve; y grabando, si aún no se ha enviado el cobro, para: la grabación no se repite a medias.
 */
async function ir(ruta, espera) {
  const url = ruta.startsWith('http') ? ruta : `${APP}${ruta}`
  const loc = espera ? (typeof espera === 'string' ? page.getByText(espera).first() : espera.first()) : null
  let salio = false
  await R.sinVer(async () => {
    for (let intento = 1; intento <= 3 && !salio; intento++) {
      if (intento === 1) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
      else { decir(`  · ${ruta}: no ha salido a tiempo; se recarga (intento ${intento} de 3)`); await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}) }
      await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      salio = loc ? await loc.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false) : true
    }
    if (salio) await sinCargar()
  })
  if (salio) return
  const seVe = await page.evaluate(() => `${location.pathname}${location.hash} · ${(document.querySelector('h1')?.textContent ?? document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}`).catch(() => '')
  const t = `${ruta}: no ha salido lo que se esperaba en 3 intentos (se ve: ${seVe})`
  resumen.push(`✗ v0 · la pantalla no ha salido: ${t}`.slice(0, 230))
  await foto(`x-pantalla-${Date.now()}`)
  // Grabando y antes de enviar el cobro, se para (no queda nada a medias en la demo); después, se sigue y se dice.
  if (GRABA && !enviado) throw new Error(t)
  fallo(t)
}
/**
 * La prueba del nº99 grabó «Sumied · Cargando…» al volver de un corte: la app vuelve a pintar su pantalla de carga
 * después de que la página ya parecía lista. Nunca se graba una pantalla cargando: dentro del corte se espera a que
 * no haya ningún «Cargando…» ni esqueleto, y a que siga así un segundo entero.
 */
async function sinCargar() {
  const cargando = () => page.evaluate(() => /Cargando(\.\.\.|…)|Entrando…/.test(document.body?.innerText ?? '') || !!document.querySelector('.cx-hueso, .pt-cargando'))
  const hasta = Date.now() + 30_000
  let quietos = 0
  while (Date.now() < hasta && quietos < 3) {
    await quieto(400)
    quietos = (await cargando().catch(() => true)) ? 0 : quietos + 1
  }
  if (quietos < 3) fallo('una pantalla se ha quedado «Cargando…» más de 30 s')
  await quieto(300)
}
async function foto(n) { await page.screenshot({ path: join(salida, 'capturas', `${n}.png`), style: '#__cursor,.__onda{display:none!important}' }).catch(() => {}) }
const escena = (t) => { decir(`\n── ${t}`); R.marca(t.split(' ')[0], t) }

// Las tomas, en la misma página: las GIF de video-tomas/gd-qbo, encajadas sin deformar.
const toma = (f) => [join('scripts/video/gd/tomas', f), join(TOMAS, f)].find((x) => existsSync(x)) ?? null
const duraGif = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()) || 0 } catch { return 0 } }
async function ponerTomas(fs) {
  const celdas = fs.map((f, k) => `<div class="c"><img id="t${k}" src="data:image/gif;base64,${readFileSync(f).toString('base64')}"></div>`).join('')
  await R.sinVer(async () => {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1f2a3c}
      .f{display:flex;height:${H}px;gap:${fs.length > 1 ? 8 : 0}px}.c{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}
      img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><div class="f">${celdas}</div></body></html>`)
    await quieto(400)
  })
}

let inicio = 0
let enviado = false
const esperaHasta = async (que, fn, min) => {
  const desde = Date.now()
  while (Date.now() - desde < min * 60_000) { if (await fn()) { decir(`  · ${que}: a los ${Math.round((Date.now() - desde) / 60000)} min`); return true } await esperar(60_000) }
  fallo(`${que}: no ha llegado en ${min} min`); return false
}

try {
  const { data: tr } = await admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).maybeSingle()
  if (!tr) throw new Error(`No está «${CLIENTE}» en la demo.`)
  let ing = null
  // ── 01 · Clientes y cuotas ─────────────────────────────────────────────────
  if (pide('01')) {
    await ir('/conta/ventas/clientes-y-cuotas', page.locator('.g4-cifra').filter({ hasText: 'Cuotas al mes' }))
    inicio = R.t()
    escena('01 Clientes y cuotas')
    const cifra = (t) => page.locator('.g4-cifra').filter({ hasText: t })
    await di('01.1', () => ra.ir(980, 620, 1200))
    await di('01.2', () => a(cifra('Cuotas al mes')))
    await di('01.3', () => a(cifra('Te deben')))
    await di('01.4', () => a(cifra('Dejas de cobrar')))
    await di('01.5', () => a(page.locator('section[aria-labelledby="g4-hacer"]')))
    await di('01.6', async () => { await pulsa(page.getByText(CLIENTE, { exact: true })); await quieto(1200); await mirar(page.getByText('Este mes', { exact: true }), page.getByText('Último cobro')) })
    await foto('01')
  }
  // ── 02 · La ficha ──────────────────────────────────────────────────────────
  if (pide('02')) {
    await ir(`/conta/ventas/clientes-y-cuotas/cliente/${tr.id}`, CLIENTE)
    escena('02 La ficha')
    await di('02.1', () => mirar(page.getByText('Se le cobra al mes'), page.getByText(/Sumied calcula/)))
    await di('02.2', () => a(page.getByText(/Así le llegará el recibo/)))
    await di('02.3', () => pulsa(page.getByRole('button', { name: 'Ver trabajadores' })))
    // nº116 · El trabajador nuevo, en la lista de «Ver trabajadores» con su «desde…»: sale siempre (el «Alta en…» del
    // recibo solo sale con el cobro del mes preparado).
    await di('02.4', () => a(page.locator('.g4-cliente-textos').filter({ hasText: TRABAJADOR_NUEVO })))
    await di('02.5', async () => { await pulsa(page.getByRole('tab', { name: 'Cobros', exact: true })); await quieto(1500); await pulsa(page.getByRole('tab', { name: 'Contacto', exact: true })) })
    await di('02.6', () => pulsa(page.getByRole('tab', { name: /^Datos de / })))
    await foto('02')
  }
  // ── 03 · Tarifa y paquetes ─────────────────────────────────────────────────
  if (pide('03')) {
    await ir('/conta/ventas/clientes-y-cuotas/tarifas', 'Tarifa y paquetes')
    escena('03 Tarifa y paquetes')
    const servicio = (n) => page.getByText(n, { exact: true }).first()
    await di('03.1', () => ra.ir(900, 500, 1000))
    await di('03.2', async () => { await pulsa(servicio('Gestoría mensual')); await quieto(800); await mirar(page.getByText('Básica', { exact: true }), page.getByText('Premium', { exact: true })) })
    await di('03.3', () => a(page.getByText(/precio especial|su propio precio/i)))
    await di('03.4', () => pulsa(servicio('Gestión laboral')))
    await di('03.5', async () => { await pulsa(servicio('Nóminas')); await quieto(1500); await pulsa(page.getByText(/^Pack Empresa/)) })
    await foto('03')
  }
  // ── 04 · Bitrix24 y Sumied, al momento (tomas) ─────────────────────────────
  if (pide('04')) {
    {
      const b = toma('05-bitrix.gif'); const s = toma('05-sumied.gif')
      if (!b || !s) { if (GRABA) fallo('04: faltan las tomas 05-bitrix.gif y 05-sumied.gif'); noToca(['04.1', '04.2'], 'faltan sus tomas') }
      else {
        await ponerTomas([b, s]); escena('04 Bitrix24 y Sumied')
        await di('04.1', () => ra.ir(480, 540, 900))
        await di('04.2', () => ra.ir(1440, 540, 900))
        if (GRABA) await quieto(Math.max(0, Math.max(duraGif(b), duraGif(s)) * 1000 - 9000))
      }
    }
  }
  // ── 05 · La pestaña Sumied dentro de Bitrix24 (tomas) ──────────────────────
  if (pide('05')) {
    {
      const fs = ['resumen', 'cuotas', 'laboral', 'portal'].map((n) => toma(`05-pestana-${n}.gif`))
      if (fs.some((f) => !f)) { if (GRABA) fallo('05: faltan tomas 05-pestana-*.gif (resumen, cuotas, laboral, portal)'); noToca(['05.1', '05.2', '05.3', '05.4', '05.5'], 'faltan sus tomas') }
      else {
        escena('05 La pestaña Sumied')
        for (const [k, id] of [['0', '05.1'], ['0', '05.2'], ['1', '05.3'], ['2', '05.4'], ['3', '05.5']]) {
          if (id !== '05.2') await ponerTomas([fs[Number(k)]])
          await di(id, () => ra.ir(960, 540, 600))
          if (GRABA && id !== '05.1') await quieto(Math.max(0, duraGif(fs[Number(k)]) * 1000 - 6000))
        }
      }
    }
  }
  // ── 06 · El cobro del mes ──────────────────────────────────────────────────
  if (pide('06')) {
    await ir(`/conta/ventas/clientes-y-cuotas/cobro?empresa=${SOCIEDAD}&mes=${MES}`, page.locator('main'))
    escena('06 El cobro')
    const { data: mes0 } = await admin.from('conta_cobro_mes').select('preparado_at, enviado_at').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).eq('mes', MES).maybeSingle()
    if (mes0?.enviado_at) fallo('06: el cobro ya está enviado: la demo no está limpia («Volver a empezar» antes de grabar)')
    if (!GRABA && mes0?.preparado_at) noToca(['06.1'], 'el cobro ya está preparado')
    else await di('06.1', () => pulsaQueEscribe(page.getByRole('button', { name: 'Preparar el cobro' })))
    if (GRABA) await R.sinVer(() => page.locator('section.g5-barra').waitFor({ timeout: 180_000 }).catch(() => fallo('06: el cobro no se ha preparado en 3 minutos')))
    const cambio = (t) => page.locator('li.g5-cambio').filter({ hasText: t })
    const libre = () => page.waitForFunction(() => !document.querySelector('.g5-cambio .g4-boton[disabled], .g4-boton[data-tipo="primario"][disabled]'), null, { timeout: 30_000 }).catch(() => {})
    if (GRABA || (mes0?.preparado_at && !mes0?.enviado_at)) {
      await di('06.2', () => mirar(page.getByText('Lo que cambia').first(), page.locator('li.g5-cambio').first()))
      await di('06.3', () => a(cambio('Imprenta Rápida Sol').locator('.g5-cambio-porque')))
      await di('06.4', () => a(cambio('Talleres Ruiz').locator('.g5-cambio-porque')))
      await di('06.5', async () => { await libre(); await pulsaQueEscribe(cambio('Reformas Atalaya').getByRole('button', { name: 'Este mes no' }), 800, cambio('Reformas Atalaya').getByText('Fuera de este cobro')) })
      await di('06.6', async () => {
        const pendiente = () => page.locator('li.g5-cambio .g4-boton[data-tipo="primario"]:not([disabled])').first()
        if (!GRABA) { await a(pendiente()); return }
        for (let i = 0, vacios = 0; i < 80 && vacios < 3; i++) {
          await libre()
          const b = pendiente()
          if (!(await b.isVisible().catch(() => false))) { vacios++; await quieto(1000); continue }
          vacios = 0; await b.scrollIntoViewIfNeeded().catch(() => {})
          if (i < 2) { await ra.clic(b, 700); await quieto(1200) } else { await b.click(); await quieto(500) }
        }
      })
      await di('06.7', async () => { await libre(); await pulsaQueEscribe(page.getByRole('button', { name: /^Aprobar (el que no cambia|los \d+)/ }), 800, page.locator('.g5-hecho').filter({ hasText: 'Aprobados' })) })
      await di('06.8', () => a(page.getByText('No entran')))
      const enviar = page.locator('button.g5-enviar')
      await di('06.9', async () => {
        if (GRABA) await page.waitForFunction((el) => el && !el.disabled, await enviar.elementHandle(), { timeout: 30_000 }).catch(() => {})
        await pulsaQueEscribe(enviar, 800, page.getByRole('dialog'))
      })
      await di('06.10', async () => {
        if (!GRABA) return
        const dlg = page.getByRole('dialog')
        await dlg.first().waitFor({ timeout: 10_000 }); await mirar(dlg)
        await quieto(2500)
        const si = dlg.getByRole('button', { name: /^Sí, enviar/ })
        await ra.clic(si, 700)
        // nº120 · Y si el clic no ha caído en el botón, el diálogo sigue abierto: se pulsa de verdad, fuera del montaje.
        const cerrado = () => dlg.first().waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false)
        if (!(await cerrado())) await R.sinVer(async () => { await si.first().click({ timeout: 15_000 }).catch(() => {}); if (!(await cerrado())) throw new Error('el diálogo de enviar sigue abierto') })
      })
      await foto('06')
    } else noToca(['06.2', '06.3', '06.4', '06.5', '06.6', '06.7', '06.8', '06.9', '06.10'], mes0?.enviado_at ? 'el cobro ya está enviado' : 'sin preparar; en ensayo no se prepara')

    // Lo enviado, de verdad (la base), y la espera de GoCardless: fuera del montaje.
    if (GRABA) {
      await R.sinVer(async () => {
        for (let i = 0; i < 60 && !enviado; i++) {
          const { data } = await admin.from('conta_cobro_mes').select('enviado_at').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).eq('mes', MES).maybeSingle()
          if (data?.enviado_at) enviado = true; else await esperar(3000)
        }
      })
      decir(enviado ? '  · COBRO ENVIADO al sandbox.' : '  ✗ la base no dice enviado')
      if (!enviado) fallo('06: el cobro no se ha enviado')
      // nº100 · Cobrado el mes, queda PREPARADO (sin enviar) el recibo del mes siguiente: el portal enseña «Tu próximo
      // recibo» con su porqué. Como Julio, con la misma llamada que «Preparar el cobro» (conta-cobro, «preparar»).
      if (enviado) await R.sinVer(async () => {
        const siguiente = mesSiguiente(MES)
        const r = await fetch(`${SUPABASE_URL}/functions/v1/conta-cobro`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${julio.sesion.access_token}` },
          body: JSON.stringify({ accion: 'preparar', empresa: SOCIEDAD, mes: siguiente }) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) fallo(`06: no se ha preparado el recibo de ${siguiente}: ${d.error ?? r.status}`)
        else decir(`  · Preparado, sin enviar, el cobro de ${siguiente}: ${String(d.frase ?? '').slice(0, 160)}`)
      })
    }
  }
  // ── 07 · Cobrado y facturado ───────────────────────────────────────────────
  if (pide('07')) {
    if (GRABA && enviado) await R.sinVer(() => esperaHasta(`factura de ${CLIENTE}`, async () => !!(await reciboDe(tr.id))?.invoice_id, 30))
    const rec = await reciboDe(tr.id)
    await ir(`/conta/ventas/clientes-y-cuotas/cobro?empresa=${SOCIEDAD}&mes=${MES}`, page.locator('main'))
    escena('07 Cobrado y facturado')
    await di('07.1', () => a(page.getByText('Cómo va cada recibo')))
    if (!rec?.invoice_id) noToca(['07.2', '07.3', '07.4', '07.5'], `${CLIENTE} aún no tiene factura`)
    else {
      await ir(`/conta/ventas/facturas/${rec.invoice_id}`, 'Lo que ha pasado')
      await di('07.2', () => mirar(page.locator('h1').first(), page.getByText(/2026\/\d+\/\d+|Factura/).first()))
      await di('07.3', () => a(page.getByText('Lo que ha pasado')))
      await di('07.4', () => a(page.getByText('En la contabilidad')))
      let png = null
      await R.sinVer(async () => {
        const b = page.getByText('Descargar PDF').first()
        const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), b.click()]).catch(() => [null])
        if (!d) { fallo('07.5: el PDF no se ha bajado'); return }
        const f = join(salida, 'factura.pdf'); await d.saveAs(f)
        execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', f, join(salida, 'factura')])
        png = readdirSync(salida).find((x) => x.startsWith('factura') && x.endsWith('.png'))
        if (png) await page.setContent(`<!doctype html><html><body style="margin:0;background:#525659;display:flex;justify-content:center"><img id="pdf" src="data:image/png;base64,${readFileSync(join(salida, png)).toString('base64')}" style="height:${H}px;box-shadow:0 4px 20px rgba(0,0,0,.4)"></body></html>`)
        await quieto(500)
      })
      await di('07.5', async () => {
        const c = await page.locator('#pdf').boundingBox().catch(() => null)
        if (!c) throw new Error('no está el PDF')
        ra.mira({ x: c.x, y: c.y + c.height * 0.32, width: c.width, height: c.height * 0.3 })
        await ra.ir(c.x + c.width * 0.3, c.y + c.height * 0.45, 900)
      })
      await foto('07')
    }
  }
  // ── 07b · El buzón (toma) ──────────────────────────────────────────────────
  if (pide('07b')) {
    {
      const b = toma('07b-buzon.gif')
      if (!b) { if (GRABA) fallo('07b: falta la toma 07b-buzon.gif'); noToca(['07b.1'], 'falta su toma') }
      else { await ponerTomas([b]); escena('07b El buzón'); await di('07b.1', () => ra.ir(960, 420, 800)); if (GRABA) await quieto(Math.max(0, duraGif(b) * 1000 - 6000)) }
    }
  }
  // ── 08 · En la contabilidad ────────────────────────────────────────────────
  if (pide('08')) {
    ing = await ingresoDe(tr.id)
    if (GRABA && enviado) {
      await R.sinVer(async () => {
        await esperaHasta(`ingreso de ${CLIENTE} casado en el banco`, async () => {
          await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: CUENTA }).then(() => {}, () => {})
          ing = await ingresoDe(tr.id); return !!ing?.casado
        }, 45)
        await validarIngresosFacturados(julio.cliente, perfil?.display_name ?? null)
      })
    }
    const c430 = (await admin.from('company_account').select('code').eq('company_id', SOCIEDAD).like('code', '430%').ilike('name', 'Talleres Ruiz%').limit(1).maybeSingle()).data
    await ir('/conta/libros/registro/expedidas', page.getByText(/Talleres Ruiz/))
    escena('08 En la contabilidad')
    await di('08.1', () => a(page.locator('tr').filter({ hasText: /Talleres Ruiz/ })))
    if (c430) { await ir(`/conta/plan/${c430.code}`, 'Saldo'); await di('08.2', () => mirar(page.getByText(/Saldo/).first(), page.getByText(/Saldada/).first())) } else fallo('08.2: sin la 430 de Talleres Ruiz')
    await ir('/conta/plan/57200002', 'Saldo')
    await di('08.3', () => mirar(page.getByText(/Saldo/).first(), page.getByText(/deudor|acreedor|Saldada/).first()))
    await foto('08-57200002')
    await ir('/conta/bancos', ing ? page.getByText(`+${ing.texto}`, { exact: true }) : page.getByText(/GOCARDLESS/))
    await di('08.4', () => a(ing ? page.getByText(`+${ing.texto}`, { exact: true }) : page.getByText(/GOCARDLESS/)))
    await di('08.5', () => ra.ir(960, 300, 1000))
  }
  // ── 09 · El banco ──────────────────────────────────────────────────────────
  if (pide('09')) {
    escena('09 El banco')
    await di('09.1', () => a(page.getByText(/^He casado yo/)))
    await di('09.2', () => pulsa(page.getByRole('button', { name: /Casados solos/ })))
    await di('09.3', () => pulsa(page.getByRole('listitem').filter({ hasText: ing?.texto ?? '—' }).getByRole('button', { name: 'Abrir' })))
    await di('09.4', () => a(page.getByRole('button', { name: 'Deshacer' })))
    await foto('09')
  }
  // ── 10 · El portal, desde la gestoría ──────────────────────────────────────
  if (pide('10')) {
    await ir(`/conta/ventas/clientes-y-cuotas/cliente/${tr.id}?pestana=portal`, 'Tomás Ruiz')
    escena('10 El portal, desde la gestoría')
    await di('10.1', () => a(page.getByText('Tomás Ruiz')))
    await di('10.2', () => mirar(page.getByText(/facturas de gasto/i), page.getByText(/Mensajes|mensaje/).first()))
    await foto('10')
  }
  // ── 11 · El portal, como lo ve el cliente ──────────────────────────────────
  if (pide('11')) {
    const tomas = await usuarioDelPortal(PORTAL)
    const felipe = await usuarioDelPortal(DEVUELTO)
    const comoEnElPortal = async (u, pestana) => {
      const s = await sesionDe(u.user)
      await R.sinVer(async () => {
        await page.goto(`${APP}/portal.html`, { waitUntil: 'domcontentloaded' })
        await page.evaluate(([ses, cli]) => { localStorage.setItem('sumied-portal', ses); localStorage.setItem('sumied-portal-cliente', cli) }, [JSON.stringify(s.sesion), u.party])
        // nº116 · Ir a «portal.html#…» desde «portal.html» solo cambia el «#»: no recarga, y el portal se quedaba con lo
        // que leyó al abrirse, sin esta sesión. Se recarga, para que entre con la sesión que se acaba de guardar.
        await page.goto(`${APP}/portal.html#${pestana}`, { waitUntil: 'domcontentloaded' })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('h1.pt-h1').first().waitFor({ timeout: 30_000 }).catch(() => fallo(`11: el portal no ha cargado (${pestana})`))
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}); await sinCargar()
        // Y se dice si no es quien tenía que entrar (en vez de un «timeout» en la escena siguiente).
        const hola = (await page.locator('h1.pt-h1').first().textContent().catch(() => '')) ?? ''
        if (pestana === 'inicio' && !hola.includes(u.nombre)) fallo(`11: el portal no ha entrado como ${u.nombre} (dice «${hola.trim().slice(0, 60)}»)`)
      })
    }
    const pestanaPortal = async (p) => { await R.sinVer(async () => { await page.goto(`${APP}/portal.html#${p}`); await page.locator('h1.pt-h1').first().waitFor({ timeout: 30_000 }).catch(() => {}); await sinCargar() }) }
    if (!tomas) { fallo('11: Tomás Ruiz no tiene usuario en el portal («Volver a empezar» lo deja listo)'); noToca(['11.1', '11.2', '11.4', '11.5', '11.6', '11.7'], 'Tomás Ruiz sin acceso') }
    else {
      await comoEnElPortal(tomas, 'inicio')
      escena('11 El portal del cliente')
      await di('11.1', () => a(page.locator('section[aria-labelledby="pt-piden"]')))
      await pestanaPortal('facturas')
      await di('11.2', () => a(page.locator('h1.pt-h1').filter({ hasText: 'Tus facturas' }).locator('xpath=following::b[1]')))
      await foto('11-tomas')
    }
    if (!felipe) { if (GRABA) fallo('11.3: Felipe Herrera no tiene usuario en el portal («Volver a empezar» lo deja listo)'); noToca(['11.3'], 'Felipe Herrera aún no tiene acceso: lo deja «Volver a empezar»') }
    else {
      if (GRABA && enviado) await R.sinVer(() => esperaHasta(`devuelto de ${DEVUELTO.cliente}`, async () => ['devuelto', 'retrocedido'].includes((await reciboDe(felipe.party))?.estado), 20))
      const devuelto = ['devuelto', 'retrocedido'].includes((await reciboDe(felipe.party))?.estado)
      if (!GRABA && !devuelto) noToca(['11.3'], `${DEVUELTO.cliente} aún no tiene su recibo devuelto`)
      else await comoEnElPortal(felipe, 'inicio')
      const pagar = page.getByRole('button', { name: 'Pagar con tarjeta o Bizum' })
      if (GRABA || devuelto) await di('11.3', async () => { await mirar(page.getByText('Tienes un recibo devuelto')); await a(pagar) })
      if (GRABA) {
        // Julio (nº98): se paga con la tarjeta de pruebas de Stripe. Escribe en la demo y en Stripe en modo de pruebas.
        await ra.clic(pagar, 600)
        await R.sinVer(async () => { await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 }).catch(() => fallo('11.3: no se ha abierto la página de pago de Stripe')); await page.waitForLoadState('networkidle').catch(() => {}); await quieto(800) })
        try {
          const tarjetaBtn = page.locator('[data-testid="card-accordion-item-button"]')
          if (await tarjetaBtn.isVisible().catch(() => false)) await ra.clic(tarjetaBtn, 600)
          for (const [sel, v] of [['#cardNumber', '4242 4242 4242 4242'], ['#cardExpiry', '12 / 34'], ['#cardCvc', '123'], ['#billingName', 'Felipe Herrera']]) {
            const c = page.locator(sel)
            if (await c.isVisible().catch(() => false)) { await ra.clic(c, 500); await c.pressSequentially(v, { delay: 45 }) }
          }
          await ra.clic(page.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first(), 700)
          await R.sinVer(async () => { await page.waitForURL(/portal\.html/, { timeout: 90_000 }); await page.waitForLoadState('networkidle').catch(() => {}); await quieto(2500) })
          await foto('11-pagado')
        } catch (e) { fallo(`11.3: el pago de pruebas en Stripe: ${String(e.message).split('\n')[0]}`); await foto('11-stripe-error') }
      }
    }
    if (tomas) {
      await comoEnElPortal(tomas, 'trabajadores')
      await di('11.4', () => mirar(page.locator('h1.pt-h1'), page.getByText('Pedir un alta')))
      await pestanaPortal('documentos')
      await di('11.5', () => a(page.getByText(/Sube una factura, un ticket/)))
      await pestanaPortal('mensajes')
      await di('11.6', () => a(page.locator('h1.pt-h1')))
      await pestanaPortal('cuenta')
      await di('11.7', () => a(page.getByText('Cuenta donde se cargan tus recibos')))
      await foto('11-cuenta')
    }
  }
} catch (e) {
  fallo(`general: ${String(e.message).split('\n')[0]}`)
  await foto('x-error')
}
if (!inicio) inicio = R.pasos[0]?.desde ?? 0
const fin = R.t()
const video = GRABA ? page.video() : null
await ctx.close()
if (video) renameSync(await video.path(), join(salida, 'crudo.webm'))
if (cuentaAntes && cuentaAntes !== CUENTA) await julio.cliente.rpc('cambiar_empresa', { p_account_id: cuentaAntes })
await navegador.close()
// La tarjeta de la cuenta abierta de la portada y del cierre van sin frase propia en el crudo: las pone montar.mjs.
const dichos = R.dichos.filter((d) => d.texto)
writeFileSync(join(salida, 'tramos.json'), JSON.stringify({ inicio, fin, pasos: R.pasos, dichos, objetivos: R.objetivos, cortes: R.cortes, errores }, null, 2))
const esperadas = Object.keys(FRASES).filter((id) => id !== 'portada' && id !== 'cierre' && pide(id.split('.')[0]))
const dichas = new Set(dichos.map((d) => d.id))
const faltan = esperadas.filter((id) => !dichas.has(id))
decir(`\nModo ${MODO}: ${dichas.size} de ${esperadas.length} frases con su gesto${faltan.length ? ` (faltan ${faltan.join(', ')})` : ''}; ${fallos.length} fallos; ${errores.length} errores de la página.${GRABA ? ` Cobro ${enviado ? 'enviado' : 'NO enviado'}.` : ''}`)
for (const f of fallos) decir(`  - ${f}`)
writeFileSync(join(salida, 'registro.txt'), registro.join('\n') + '\n')
const generales = fallos.filter((f) => f.startsWith('general:')).map((f) => `✗ v0 · el guion ha parado: ${f.slice(9, 200)}`)
writeFileSync(join(salida, 'resumen.txt'), [...resumen, ...generales].join('\n') + '\n')
process.exitCode = fallos.length ? 1 : 0
