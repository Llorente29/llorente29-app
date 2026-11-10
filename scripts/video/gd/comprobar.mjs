#!/usr/bin/env node
// scripts/video/gd/comprobar.mjs — GD · comprobar la demo en vivo (nº92, nº93).
//
// Recorre la Gestoría Demo de PRODUCCIÓN (app.sumied.com) como el guion del vídeo
// (scripts/video/gd/qbo.mjs), pero SIN GRABAR y SOLO LEYENDO, y dice en el registro,
// paso a paso, qué está bien (✓), qué falla (✗, con su porqué y una captura), qué no toca
// todavía por el punto en que está la demo (—) y qué es un aviso (!). Con algún ✗, sale
// en rojo. Lo lanza Julio después de cada fusión: «GD · vídeo para QBO» con modo
// «comprobar».
//
// SOLO LEE. No pulsa «Volver a empezar», «Preparar», «Aprobar», «Este mes no», «Enviar»,
// «Validar» ni «Deshacer»: cada pulsación pasa por `pulsar`, que solo deja los nombres de
// PULSABLES (lo vigila tests/unit/modules/conta/gd/comprobarDemo.test.ts). A la base, solo
// consultas (select). Lo único que toca es entrar: la sesión de Julio (y su cuenta abierta,
// que se le devuelve al acabar, como el guion del vídeo) y, si el cliente de la demo ya ha
// entrado alguna vez en su portal, la suya.
//
// Lo que no se comprueba aquí: la pestaña de Sumied dentro de Bitrix24. El servidor
// pregunta a Bitrix24 quién mira, con el token que Bitrix24 da al abrir la ficha, y eso no
// existe fuera de Bitrix24: la mira Julio en su Chrome.

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const env = (k) => (process.env[k] ?? '').trim()
const SUPABASE_URL = env('SUPABASE_URL'); const SERVICE = env('SERVICE_KEY'); const ANON = env('ANON_KEY')
const APP = env('APP') || 'https://app.sumied.com'
const SALIDA = resolve(env('SALIDA') || 'comprobar-salida')
const CUENTA = 'de000000-0000-4000-8000-0000000000a0'
const SOCIEDAD = 'de000000-0000-4000-8000-0000000000a9'
const JULIO = 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a'
// nº100 · El mes del cobro: el mes en curso (Madrid), salvo que se pida otro (AAAA-MM).
const MES = /^\d{4}-\d{2}$/.test(env('MES')) ? env('MES') : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7)
const CLIENTE = 'Talleres Ruiz, S.L.'
const REF = new URL(SUPABASE_URL || 'https://x.supabase.co').hostname.split('.')[0]

mkdirSync(join(SALIDA, 'capturas'), { recursive: true })
const decir = (t) => console.log(t)
// nº94 · El resumen del run: cada paso con su marca, por secciones. Pasa por la puerta de la DEMO
// (scripts/conta/salida-demo.mjs), que solo deja líneas con esta forma y solo en el job «comprobar».
const resumen = []
const corta = (t) => (t.length > 230 ? `${t.slice(0, 229)}…` : t)
const seccion = (t) => { decir(`\n── ${t}`); resumen.push(`### ${t}`) }
const cuenta = { bien: 0, mal: 0, notoca: 0, avisos: 0 }
const malos = []; const avisos = []
const euros = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// ── La base: SOLO consultas ──────────────────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
const leer = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data }

// ── Lo que se puede pulsar: navegar y abrir, nada que cambie la demo ─────────
export const PULSABLES = ['cliente de la lista', 'Ver trabajadores', 'pestaña Cobros', 'pestaña Contacto', 'pestaña Datos de Bitrix24',
  'servicio de la tarifa', 'Casados solos', 'Descargar PDF']
async function pulsar(loc, nombre) {
  if (!PULSABLES.includes(nombre)) throw new Error(`comprobar no pulsa «${nombre}»: solo lee`)
  await loc.first().click({ timeout: 10_000 })
}

// ── Un paso: ✓, ✗ (con captura), — (no toca) o ! (aviso) ────────────────────
class NoToca extends Error {}
class Aviso extends Error {}
const noToca = (porque) => { throw new NoToca(porque) }
const aviso = (porque) => { throw new Aviso(porque) }
let pagina = null
async function paso(id, que, fn) {
  try {
    const dicho = await fn()
    cuenta.bien++; decir(`  ✓ ${id} · ${que}${dicho ? `: ${dicho}` : ''}`); resumen.push(corta(`✓ ${id} · ${que}${dicho ? `: ${dicho}` : ''}`))
  } catch (e) {
    const t = String(e?.message ?? e).split('\n')[0]
    if (e instanceof NoToca) { cuenta.notoca++; decir(`  — ${id} · ${que}: no toca (${t})`); resumen.push(corta(`— ${id} · ${que}: no toca (${t})`)); return }
    if (e instanceof Aviso) { cuenta.avisos++; avisos.push(`${id} · ${que}: ${t}`); decir(`  ! ${id} · ${que}: ${t}`); resumen.push(corta(`! ${id} · ${que}: ${t}`)); return }
    cuenta.mal++; malos.push(`${id} · ${que}: ${t}`); decir(`  ✗ ${id} · ${que}: ${t}`); resumen.push(corta(`✗ ${id} · ${que}: ${t}`))
    if (pagina) await pagina.screenshot({ path: join(SALIDA, 'capturas', `${id.replace(/[^\w.-]+/g, '_')}.png`) }).catch(() => {})
  }
}
/** Que se vea un texto (o un localizador) en 15 s; si no, falla con lo que faltaba. */
async function ver(page, que, { exacto = false, timeout = 15_000 } = {}) {
  const loc = typeof que === 'string' ? page.getByText(que, { exact: exacto }) : que
  await loc.first().waitFor({ state: 'visible', timeout }).catch(() => { throw new Error(`no sale «${typeof que === 'string' ? que : 'lo que se esperaba'}»`) })
}
async function ir(page, ruta) {
  const r = await page.goto(`${APP}${ruta}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  if (r && r.status() >= 400) throw new Error(`la página contesta ${r.status()}`)
  await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}

// ── Las sesiones: Julio (la gestoría) y, si ya ha entrado, el cliente de la demo ──
let comoJulio = null; let cuentaAntes = null
async function sesionDe(userId) {
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId)
  if (e1 || !u?.user?.email) throw new Error('no se encuentra el usuario')
  const { data: l, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (e2 || !l?.properties?.hashed_token) throw new Error(`no se ha podido generar el enlace: ${e2?.message ?? 'sin token'}`)
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: e3 } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (e3 || !v?.session) throw new Error(`no se ha podido canjear el enlace: ${e3?.message ?? 'sin sesión'}`)
  return { cliente: c, sesion: v.session }
}

const errores = []
const navegador = await chromium.launch()
async function contexto(initScript) {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid', acceptDownloads: true })
  await ctx.addInitScript(initScript)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errores.push(String(e?.message ?? e).split('\n')[0]))
  return { ctx, page }
}

decir(`Comprobar la Gestoría Demo · ${new Date().toISOString()} · mes del cobro ${MES} · solo lectura`)
try {
  // ── 0 · La demo y la sesión ────────────────────────────────────────────────
  seccion('0 · La demo')
  let julio = null
  await paso('0.1', 'la cuenta es de demostración', async () => {
    const cu = await leer(admin.from('accounts').select('is_demo').eq('id', CUENTA).maybeSingle())
    if (cu?.is_demo !== true) throw new Error('la cuenta no es de demostración: no se sigue')
  })
  if (cuenta.mal) throw new Error('la cuenta no es de demostración')
  await paso('0.2', 'entrar como Julio en la Gestoría Demo', async () => {
    julio = await sesionDe(JULIO); comoJulio = julio.cliente
    cuentaAntes = (await comoJulio.rpc('_cuenta_activa')).data ?? null
    const { error } = await comoJulio.rpc('cambiar_empresa', { p_account_id: CUENTA })
    if (error) throw new Error(error.message)
  })
  if (!julio) throw new Error('sin la sesión de Julio no se puede seguir')

  // Lo de Talleres Ruiz en la base, para cruzarlo con las pantallas.
  const cli = (await leer(admin.from('party').select('id').eq('account_id', CUENTA).eq('name', CLIENTE).limit(2))) ?? []
  const clienteId = cli.length === 1 ? cli[0].id : null
  const recibos = clienteId ? (await leer(admin.from('conta_recibo').select('mes, estado, gc_estado, total_cent, invoice_id, factura, gc_cobro_id').eq('account_id', CUENTA).eq('party_id', clienteId).order('mes', { ascending: false }))) ?? [] : []
  const recibo = recibos.find((r) => r.mes === MES) ?? null
  const trabajadores = [...new Set((recibo?.factura?.lineas ?? []).flatMap((l) => (l.trabajadores ?? []).map((t) => t.nombre)))]
  const factura = recibo?.invoice_id ? await leer(admin.from('customer_invoice').select('id, number, total').eq('id', recibo.invoice_id).maybeSingle()).catch(() => null) : null
  await paso('0.3', `${CLIENTE} en la demo`, async () => {
    if (!clienteId) throw new Error(`está ${cli.length} veces`)
    return `recibo de ${MES}: ${recibo ? `${recibo.estado}, ${euros(recibo.total_cent / 100)}${factura ? `, factura nº ${factura.number ?? 'sin número'}` : ''}` : 'ninguno'} · ${trabajadores.length} trabajadores en el recibo`
  })

  const { ctx: ctxG, page } = await contexto(`(() => { try {
    localStorage.setItem(${JSON.stringify(`sb-${REF}-auth-token`)}, ${JSON.stringify(JSON.stringify(julio.sesion))});
    localStorage.setItem('andy-app-active-account', ${JSON.stringify(CUENTA)});
    localStorage.setItem(${JSON.stringify(`folvy.conta.empresa.${CUENTA}`)}, ${JSON.stringify(SOCIEDAD)});
  } catch (e) {} })()`)
  pagina = page

  // ── 02 · Clientes y cuotas ─────────────────────────────────────────────────
  seccion('02 · Clientes y cuotas')
  await paso('02.1', 'la pantalla carga', async () => { await ir(page, '/conta/ventas/clientes-y-cuotas'); await ver(page, 'Cuotas al mes') })
  await paso('02.2', 'las cuatro cifras', async () => { for (const t of ['Cuotas al mes', 'Te deben', 'Dejas de cobrar', 'Precio sin revisar']) await ver(page, t) })
  await paso('02.3', '«Lo que tienes que hacer»', async () => ver(page, 'Lo que tienes que hacer'))
  await paso('02.4', `${CLIENTE} en la lista, con su panel`, async () => {
    await ver(page, CLIENTE, { exacto: true }); await pulsar(page.getByText(CLIENTE, { exact: true }), 'cliente de la lista'); await ver(page, 'Este mes')
  })

  // ── 03 · La ficha ──────────────────────────────────────────────────────────
  seccion('03 · La ficha del cliente')
  let fichaTexto = ''
  await paso('03.1', 'la ficha carga', async () => {
    if (!clienteId) noToca(`${CLIENTE} no está una sola vez`)
    await ir(page, `/conta/ventas/clientes-y-cuotas/cliente/${clienteId}`); await ver(page, CLIENTE)
    fichaTexto = await page.locator('main').innerText().catch(() => '')
  })
  await paso('03.2', 'el recibo del mes cuadra con la base', async () => {
    if (!recibo) noToca(`sin recibo de ${MES} todavía`)
    const t = euros(recibo.total_cent / 100); if (!fichaTexto.includes(t)) throw new Error(`la ficha no dice ${t}`)
    return t
  })
  await paso('03.3', 'sus trabajadores, con nombre', async () => {
    if (!trabajadores.length) noToca('el recibo no tiene trabajadores')
    await pulsar(page.getByRole('button', { name: 'Ver trabajadores' }), 'Ver trabajadores')
    for (const n of trabajadores) await ver(page, n)
    return trabajadores.length
  })
  for (const [t, nombre] of [['Cobros', 'pestaña Cobros'], ['Contacto', 'pestaña Contacto']]) {
    await paso(`03.${t}`, `pestaña ${t}`, async () => { await pulsar(page.getByRole('tab', { name: t, exact: true }), nombre); await page.waitForTimeout(800) })
  }
  await paso('03.CRM', 'pestaña Datos de Bitrix24', async () => { await pulsar(page.getByRole('tab', { name: /^Datos de / }), 'pestaña Datos de Bitrix24'); await page.waitForTimeout(800) })

  // ── 04 · Tarifa y paquetes ─────────────────────────────────────────────────
  seccion('04 · Tarifa y paquetes')
  await paso('04.1', 'la pantalla carga', async () => { await ir(page, '/conta/ventas/clientes-y-cuotas/tarifas'); await ver(page, 'Tarifa y paquetes') })
  await paso('04.2', 'Gestoría mensual, con sus tres niveles', async () => {
    await pulsar(page.getByText('Gestoría mensual', { exact: false }), 'servicio de la tarifa')
    for (const t of ['Básica', 'Estándar', 'Premium']) await ver(page, t, { exacto: true })
  })
  for (const s of ['Gestión laboral', 'Nóminas']) await paso(`04.${s}`, s, async () => ver(page, s))
  await paso('04.Pack', 'Pack Empresa', async () => ver(page, page.getByText(/^Pack Empresa/)))

  // ── 06 · El cobro del mes ──────────────────────────────────────────────────
  seccion(`06 · El cobro de ${MES}`)
  const mes = await leer(admin.from('conta_cobro_mes').select('preparado_at, enviado_at').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).eq('mes', MES).maybeSingle())
  const todos = (await leer(admin.from('conta_recibo').select('estado, gc_estado, invoice_id').eq('account_id', CUENTA).eq('company_id', SOCIEDAD).eq('mes', MES))) ?? []
  const porEstado = Object.entries(todos.reduce((t, r) => ({ ...t, [r.estado]: (t[r.estado] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ')
  await paso('06.1', 'la pantalla carga', async () => {
    await ir(page, `/conta/ventas/clientes-y-cuotas/cobro?empresa=${SOCIEDAD}&mes=${MES}`); await ver(page, page.locator('main'))
    return !mes?.preparado_at ? 'sin preparar' : !mes.enviado_at ? `preparado, sin enviar · ${porEstado}` : `enviado · ${porEstado} · ${todos.filter((r) => r.invoice_id).length} con factura`
  })
  await paso('06.2', '«Preparar el cobro»', async () => {
    if (mes?.preparado_at) noToca('ya está preparado')
    await ver(page, page.getByRole('button', { name: 'Preparar el cobro' }))
  })
  await paso('06.3', 'los cambios, cada uno con su porqué', async () => {
    if (!mes?.preparado_at || mes.enviado_at) noToca(!mes?.preparado_at ? 'sin preparar' : 'ya enviado')
    const n = await page.locator('li.g5-cambio').count(); if (!n) throw new Error('ningún cambio en la lista')
    const sinPorque = await page.locator('li.g5-cambio:not(:has(.g5-cambio-porque))').count()
    if (sinPorque) throw new Error(`${sinPorque} cambios sin su porqué`)
    return `${n} cambios`
  })
  await paso('06.4', 'el que cambia más de un 30 % pide mirarlo', async () => {
    if (!mes?.preparado_at || mes.enviado_at) noToca(!mes?.preparado_at ? 'sin preparar' : 'ya enviado')
    if (!(await page.locator('li.g5-cambio[data-fuerte="si"]').count())) noToca('ninguno cambia más de un 30 % (o ya está aprobado)')
  })
  await paso('06.5', '«No entran»', async () => {
    if (!mes?.preparado_at || mes.enviado_at) noToca(!mes?.preparado_at ? 'sin preparar' : 'ya enviado')
    await ver(page, 'No entran')
  })
  await paso('06.6', '«Cómo va cada recibo»', async () => {
    if (!mes?.enviado_at) noToca('aún no se ha enviado')
    await ver(page, 'Cómo va cada recibo')
  })

  // ── 07 · La factura ────────────────────────────────────────────────────────
  seccion(`07 · La factura de ${CLIENTE}`)
  await paso('07.1', 'la factura carga, con lo que ha pasado y su contabilidad', async () => {
    if (!recibo?.invoice_id) noToca(`${CLIENTE} aún no tiene factura de ${MES}`)
    await ir(page, `/conta/ventas/facturas/${recibo.invoice_id}`)
    for (const t of ['Lo que ha pasado', 'En la contabilidad']) await ver(page, t)
    return factura?.number ? `nº ${factura.number}` : ''
  })
  await paso('07.2', 'su PDF se descarga', async () => {
    if (!recibo?.invoice_id) noToca('sin factura')
    const b = page.getByText('Descargar PDF').first()
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), pulsar(b, 'Descargar PDF')])
    const f = join(SALIDA, 'factura.pdf'); await d.saveAs(f)
    const { statSync } = await import('node:fs'); const kb = Math.round(statSync(f).size / 1024)
    if (kb < 2) throw new Error(`el PDF pesa ${kb} KB`)
    return `${kb} KB`
  })

  // ── 07c · En la contabilidad ───────────────────────────────────────────────
  seccion('07c · En la contabilidad')
  await paso('07c.1', `${CLIENTE} en el libro de IVA repercutido`, async () => {
    if (!recibo?.invoice_id) noToca('sin factura')
    await ir(page, '/conta/libros/registro/expedidas'); await ver(page, page.getByText(/Talleres Ruiz/))
  })
  const c430 = await leer(admin.from('company_account').select('id, code').eq('company_id', SOCIEDAD).like('code', '430%').ilike('name', 'Talleres Ruiz%').limit(1).maybeSingle())
  await paso('07c.2', 'el mayor de su 430', async () => {
    if (!c430) noToca('aún no tiene su subcuenta 430')
    await ir(page, `/conta/plan/${c430.code}`); await ver(page, page.getByText(/Saldo/))
    return c430.code
  })
  await paso('07c.3', 'la 57200002 queda con solo la comisión', async () => {
    const cta = await leer(admin.from('company_account').select('id').eq('company_id', SOCIEDAD).eq('code', '57200002').maybeSingle())
    if (!cta) noToca('sin la 57200002')
    await ir(page, '/conta/plan/57200002'); await ver(page, page.getByText(/Saldo/))
    const lin = (await leer(admin.from('journal_line').select('debit, credit, journal_entry!inner(status, voided_at)').eq('company_account_id', cta.id).eq('journal_entry.status', 'validado').is('journal_entry.voided_at', null))) ?? []
    const saldo = lin.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0)
    const pos = (await leer(admin.from('conta_gc_payout').select('comision, match_id').eq('account_id', CUENTA).eq('company_id', SOCIEDAD))) ?? []
    const porValidar = (await leer(admin.from('journal_line').select('id, journal_entry!inner(status, source_type)').eq('company_account_id', cta.id).eq('journal_entry.status', 'propuesto').eq('journal_entry.source_type', 'bank'))) ?? []
    const com = pos.reduce((t, p) => t + Number(p.comision), 0)
    if (Math.abs(saldo - com) > 0.005) aviso(`saldo validado ${euros(saldo)}; la comisión de las ${pos.length} liquidaciones es ${euros(com)}; ${porValidar.length} asientos del banco por validar`)
    return euros(saldo)
  })
  const casados = (await leer(admin.from('conta_gc_payout').select('gc_id, importe, match_id').eq('account_id', CUENTA).eq('company_id', SOCIEDAD))) ?? []
  const cobroT = recibo?.gc_cobro_id ? await leer(admin.from('conta_gc_cobro').select('payout_gc_id').eq('account_id', CUENTA).eq('gc_id', recibo.gc_cobro_id).maybeSingle()) : null
  const poT = casados.find((p) => p.gc_id === cobroT?.payout_gc_id) ?? null
  const textoT = poT ? euros(poT.importe).replace(' €', '') : null
  await paso('07c.4', `el ingreso de ${CLIENTE} en el banco`, async () => {
    if (!poT) noToca('su cobro aún no ha llegado al banco')
    await ir(page, '/conta/bancos'); await ver(page, page.getByText(`+${textoT}`, { exact: true }), { timeout: 30_000 })
    return `+${textoT}${poT.match_id ? ', casado' : ', sin casar'}`
  })

  // ── 08 · El banco ──────────────────────────────────────────────────────────
  seccion('08 · El banco')
  await paso('08.1', 'los ingresos de GoCardless, casados', async () => {
    if (!casados.length) noToca('aún no ha llegado ningún ingreso')
    const sin = casados.filter((p) => !p.match_id).length
    if (sin) aviso(`${sin} de ${casados.length} sin casar`)
    return `${casados.length} de ${casados.length}`
  })
  await paso('08.2', `«Casados solos», con el de ${CLIENTE}`, async () => {
    if (!poT?.match_id) noToca('su ingreso aún no está casado')
    await pulsar(page.getByRole('button', { name: /Casados solos/ }), 'Casados solos')
    await ver(page, page.getByRole('listitem').filter({ hasText: textoT }))
  })
  await paso('08.3', 'liquidaciones sin factura en Sumied', async () => {
    const cob = (await leer(admin.from('conta_gc_cobro').select('gc_id, payout_gc_id').eq('account_id', CUENTA).not('payout_gc_id', 'is', null))) ?? []
    const fact = new Set(((await leer(admin.from('conta_recibo').select('gc_cobro_id, invoice_id').eq('account_id', CUENTA).not('invoice_id', 'is', null))) ?? []).map((r) => r.gc_cobro_id))
    const sinFactura = casados.filter((p) => !cob.some((c) => c.payout_gc_id === p.gc_id && fact.has(c.gc_id)))
    if (sinFactura.length) aviso(`${sinFactura.length} de ${casados.length} (${euros(sinFactura.reduce((t, p) => t + Number(p.importe), 0))} netos)`)
  })

  // ── P · El portal, como lo ve la gestoría ──────────────────────────────────
  seccion('P · El portal, desde la gestoría')
  const accesos = clienteId ? (await leer(admin.from('conta_portal_acceso').select('nombre, correo, user_id, revocado_at').eq('account_id', CUENTA).eq('party_id', clienteId))) ?? [] : []
  const acceso = accesos.find((a) => !a.revocado_at) ?? null
  await paso('P.1', 'el portal de la demo está preparado', async () => {
    if (!acceso) throw new Error(`${CLIENTE} no tiene a nadie con acceso: «Volver a empezar» vacía el portal; pulsa «Preparar el portal de la demo» en la pestaña Portal de su ficha`)
    return `${acceso.nombre}${acceso.user_id ? ', ya ha entrado alguna vez' : ', aún no ha entrado nunca'}`
  })
  await paso('P.2', 'la pestaña Portal de su ficha', async () => {
    if (!clienteId) noToca(`${CLIENTE} no está una sola vez`)
    await ir(page, `/conta/ventas/clientes-y-cuotas/cliente/${clienteId}?pestana=portal`)
    if (acceso) await ver(page, acceso.nombre)
    else await ver(page, page.getByRole('button', { name: /Preparar el portal de la demo/ }))
  })
  await ctxG.close()

  // ── C · El portal, como lo ve el cliente ───────────────────────────────────
  seccion(`C · El portal, como lo ve ${CLIENTE}`)
  let tomas = null
  await paso('C.0', 'entrar como el cliente de la demo', async () => {
    if (!acceso) noToca('el portal no está preparado')
    if (!acceso.user_id) noToca(`${acceso.nombre} aún no ha entrado nunca: entra una vez con su enlace y desde entonces se comprueba`)
    tomas = await sesionDe(acceso.user_id)
  })
  if (tomas) {
    const { ctx: ctxC, page: pc } = await contexto(`(() => { try {
      localStorage.setItem('sumied-portal', ${JSON.stringify(JSON.stringify(tomas.sesion))});
      localStorage.setItem('sumied-portal-cliente', ${JSON.stringify(clienteId)});
    } catch (e) {} })()`)
    pagina = pc
    const pantallas = [['inicio', 'Hola'], ['facturas', 'Tus facturas'], ['pagos', 'Tus pagos'], ['documentos', 'Documentos'],
      ['trabajadores', 'Tus trabajadores'], ['mensajes', 'Mensajes con tu gestoría'], ['cuenta', 'Tu cuenta']]
    for (const [p, titulo] of pantallas) {
      await paso(`C.${p}`, `«${titulo}»`, async () => {
        const r = await pc.goto(`${APP}/portal.html#${p}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        if (r && r.status() >= 400) throw new Error(`la página contesta ${r.status()}`)
        await ver(pc, pc.locator('h1.pt-h1').filter({ hasText: titulo }), { timeout: 30_000 })
        const texto = await pc.locator('body').innerText()
        if (p === 'facturas' && factura?.number && !texto.includes(`/${factura.number}`)) throw new Error(`no sale su factura nº ${factura.number} (${euros(factura.total)}), que sí está en Sumied`)
        if (p === 'trabajadores') { const faltan = trabajadores.filter((n) => !texto.toUpperCase().includes(n.toUpperCase())); if (faltan.length) throw new Error(`faltan ${faltan.join(', ')}, que sí están en su ficha`) }
        if (p === 'pagos' && recibo && ['enviado', 'cobrado', 'facturado'].includes(recibo.estado) && !texto.includes(euros(recibo.total_cent / 100))) throw new Error(`no sale su recibo de ${euros(recibo.total_cent / 100)}`)
      })
    }
    await ctxC.close()
  }
} catch (e) {
  cuenta.mal++; malos.push(`general: ${String(e?.message ?? e).split('\n')[0]}`); decir(`\n✗ general: ${String(e?.message ?? e).split('\n')[0]}`)
} finally {
  if (comoJulio && cuentaAntes && cuentaAntes !== CUENTA) {
    const { error } = await comoJulio.rpc('cambiar_empresa', { p_account_id: cuentaAntes })
    decir(error ? `\nOJO: no se ha podido devolver la cuenta abierta de Julio: ${error.message}` : '\nLa cuenta abierta de Julio vuelve a la de antes.')
  }
  await navegador.close()
}

if (errores.length) { cuenta.avisos++; avisos.push(`errores de la página: ${[...new Set(errores)].slice(0, 3).join(' · ')}`); decir(`\n! errores de la página (${errores.length}): ${[...new Set(errores)].slice(0, 3).join(' · ')}`) }
seccion('Sin comprobar aquí: la pestaña de Sumied en Bitrix24')
resumen.push('— B.1 · la pestaña de Sumied dentro de Bitrix24: no toca (solo se abre desde Bitrix24; la mira Julio en su Chrome)')
decir('  — B.1 · la pestaña de Sumied dentro de Bitrix24: no toca (solo se abre desde Bitrix24; la mira Julio en su Chrome)')
decir(`\n${cuenta.mal ? 'EN ROJO' : 'EN VERDE'}: ${cuenta.bien} bien, ${cuenta.mal} fallan, ${cuenta.notoca} no tocan, ${cuenta.avisos} avisos.`)
for (const m of malos) decir(`  ✗ ${m}`)
for (const a of avisos) decir(`  ! ${a}`)
writeFileSync(join(SALIDA, 'resumen.txt'), [`${cuenta.mal ? 'En rojo' : 'En verde'}: ${cuenta.bien} bien, ${cuenta.mal} fallan, ${cuenta.notoca} no tocan, ${cuenta.avisos} avisos.`, ...resumen].join('\n') + '\n')
process.exit(cuenta.mal ? 1 : 0)
