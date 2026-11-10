// supabase/functions/conta-portal/index.ts
//
// GP · Tarea 2b (Code 3, 09/11/2026) · LO QUE HACE EL SERVIDOR DEL PORTAL DEL
// CLIENTE. Con la sesión de la persona (verify_jwt = true). Cada acción
// pregunta PRIMERO a la base con esa sesión (las funciones conta_portal_*, que
// sacan el cliente de auth.uid()) y solo después usa la clave de servicio para
// lo que la persona no puede hacer sola. Nunca se fía de un id que venga del
// navegador sin que la base diga que es suyo.
//
//   · subida_url     una dirección firmada para subir un documento o un adjunto a su
//                    carpeta de conta-portal (la ruta la pone el servidor).
//   · archivo        un fichero suyo (factura, justificante, nómina, documento subido,
//                    adjunto o documento a firmar): un enlace firmado de 5 min.
//   · subir          lo que ha subido a conta-portal, al buzón de documentos de
//                    su cuenta en Sumied (document_inbox, canal portal: el mismo
//                    camino que el correo de entrada) y a leer.
//   · no_de_acuerdo  la incidencia (la base) y parar el recibo (Code 1:
//                    conta_recibo_parar, con la clave de servicio), y apunta
//                    lo que contestó.
//   · invitar        a otra persona del cliente (o la gestoría a su cliente):
//                    el acceso (la base) y el correo con el enlace.
//   · firma_pedir    el código de un solo uso, por correo.
//   · firma_comprobar el código (la base) y el PDF firmado: el documento con una
//                    página más (quién, cuándo, desde dónde y la huella).
//   · banco_pagar    pagar un recibo devuelto ahora, desde la app del banco
//                    (GoCardless, pago al momento): la página de GoCardless.
//   · reintentar     que el banco lo pase de nuevo (GoCardless).
//   · cambiar_cuenta una domiciliación nueva del mismo cliente (GoCardless).
//   · tarjeta        pagar un recibo devuelto con tarjeta o Bizum (Stripe, solo
//                    con la clave de PRUEBAS y solo en las demos: Julio, nº 6).
//   · archivos       los enlaces firmados de las facturas de un año (el ZIP lo
//                    hace la pantalla).
//   · demo_devolver  (T5, solo demos) el sandbox de GoCardless devuelve el cobro
//                    de un recibo (simulador «payment_failed»), para enseñar un
//                    devuelto de verdad. Solo una cuenta demo, solo con la
//                    conexión de pruebas y solo su administrador o encargado.
//   · seguir         en qué ha quedado lo pedido a GoCardless o a Stripe, al volver.
//                    Al quedar hecho (T4), se remata con lo de Code 1 (#534):
//                    un devuelto pagado se apunta (conta_recibo_pagado_portal,
//                    y su frase sale en pantalla tal cual) y una cuenta nueva se
//                    guarda en el cobro (conta-cobro «cambiar_cuenta», que
//                    cancela la vieja). Cada remate queda en la operación
//                    (detalle.apunte / detalle.cambio) y no se repite. En
//                    producción, encendido desde que Code 1 confirmó su
//                    despliegue (nº 11; REMATAR_EN_PRODUCCION).
//
// GoCardless, por la puerta de las demos (_shared/puerta.ts y
// puertaDePruebas.ts) y como conta-cobro: SOLO con una conexión de pruebas
// (sandbox) mientras Julio no encienda otra cosa (ESCRIBIR_EN_REAL). Nunca en
// el GoCardless real de QBO. Lo de GoCardless, con _shared/cobro/gocardless.ts
// sin tocarlo. En el registro, nunca un token ni un correo.
//
// Contesta 200 con { ok, frase, … } en palabras (regla 8); 401 sin sesión.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import { corsHeaders } from '../_shared/cors.ts'
import { cuentaPuedeSalir } from '../_shared/puerta.ts'
import { salirA } from '../_shared/puertaDePruebas.ts'
import { correoValido } from '../_shared/facturaVentaCorreo.ts'
import { BASES, type Entorno } from '../conta-gocardless-leer/lector.ts'
import { VERSION_GOCARDLESS } from '../_shared/cobro/gocardless.ts'
import { errorStripe, v1 } from '../_shared/stripeSumied.ts'
import {
  BYTES_SUBIDA, camposPagoTarjeta, claveStripePruebas, leerSesionStripe, PLANTILLA_CODIGO, PLANTILLA_ENLACE, TIPOS_SUBIDA, correoCodigo, correoEnlace, enmascararCorreo, fraseError, leerFlujo, leerPeticion,
  nombreSeguro, peticionCambiarCuenta, peticionFlujo, peticionLeer, peticionPagarAhora, peticionReintento, type Peticion,
} from '../_shared/portal/portal.ts'
import { enlaceParaEntrar, mandar, marcaDe, portalBase } from '../_shared/portal/enviar.ts'

/** Mientras Julio no lo encienda, el portal solo escribe en GoCardless con una conexión de pruebas. */
const ESCRIBIR_EN_REAL = false
/** Code 1 confirmó el despliegue de su #534 (Julio, nº 11): conta_recibo_pagado_portal y conta-cobro «cambiar_cuenta», también en producción. */
const REMATAR_EN_PRODUCCION = true
const PRODUCCION = 'xzmpnchlguibclvxyynt'
const SOLO_PRUEBAS = 'Por ahora esto solo funciona en la demo: con el banco de cobros de verdad aún no está encendido.'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Fila = Record<string, unknown>
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const mal = (frase: string) => json(200, { ok: false, frase })
const uuid = (x: unknown) => (typeof x === 'string' && UUID.test(x) ? x : null)
const texto = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '')

/** Lo que dice la base cuando algo no es de esa persona (o falta), en su frase. */
function fraseBase(error: { message?: string } | null): string {
  return error?.message && !/^(permission denied|function|column|relation)/i.test(error.message) ? error.message : 'No se ha podido hacer ahora. Prueba en unos minutos.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'usa POST' })
  const yo = createClient(URL_BASE, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  const { data: u } = await yo.auth.getUser()
  if (!u?.user) return json(401, { error: 'no autenticado' })
  const srv = createClient(URL_BASE, SERVICIO, { auth: { persistSession: false } })
  let b: Fila = {}
  try { b = await req.json() as Fila } catch { /* vacío */ }
  const accion = String(b.accion ?? '')
  const origen = b.origen ?? req.headers.get('origin')

  try {
    switch (accion) {
      case 'subida_url': return await subidaUrl(yo, srv, b)
      case 'archivo': return await archivo(yo, srv, b)
      case 'subir': return await subir(yo, srv, b)
      case 'no_de_acuerdo': return await noDeAcuerdo(yo, srv, b)
      case 'invitar': return await invitar(yo, srv, b, origen)
      case 'firma_pedir': return await firmaPedir(srv, u.user.id, b)
      case 'firma_comprobar': return await firmaComprobar(yo, srv, b, req)
      case 'banco_pagar': return await banco(yo, srv, b, 'pagar_banco', origen)
      case 'reintentar': return await banco(yo, srv, b, 'reintentar', origen)
      case 'cambiar_cuenta': return await banco(yo, srv, b, 'cambiar_cuenta', origen)
      case 'tarjeta': return await tarjeta(yo, srv, b, origen)
      case 'archivos': return await archivos(yo, srv, b)
      case 'seguir': return await seguir(yo, srv, b)
      case 'demo_devolver': return await demoDevolver(yo, srv, b)
      default: return json(400, { ok: false, frase: 'Esa acción no existe.' })
    }
  } catch (x) {
    console.error(`[conta-portal] ${accion}`, x instanceof Error ? x.message : String(x))
    return mal('No se ha podido hacer ahora. Prueba en unos minutos.')
  }
})

// deno-lint-ignore no-explicit-any
type Sb = any

// ── Ficheros ─────────────────────────────────────────────────────────────────

async function archivo(yo: Sb, srv: Sb, b: Fila) {
  const id = uuid(b.id); const cliente = uuid(b.cliente)
  if (!id || !cliente) return json(400, { ok: false, frase: 'Falta qué documento.' })
  const { data, error } = await yo.rpc('conta_portal_archivo', { p_party: cliente, p_tipo: String(b.tipo ?? ''), p_id: id, p_indice: Number(b.indice ?? 0) || 0 })
  if (error || !data) return mal(fraseBase(error))
  const f = data as { almacen: string; ruta: string; nombre: string }
  const { data: s, error: e2 } = await srv.storage.from(f.almacen).createSignedUrl(f.ruta, 300, { download: nombreSeguro(f.nombre) })
  if (e2 || !s?.signedUrl) return mal('Ese documento no se puede abrir ahora.')
  return json(200, { ok: true, url: s.signedUrl, nombre: f.nombre })
}

async function subidaUrl(yo: Sb, srv: Sb, b: Fila) {
  const cliente = uuid(b.cliente); const carpeta = b.carpeta === 'mensajes' ? 'mensajes' : 'subidas'
  const tipo = texto(b.tipo, 60); const bytes = Number(b.bytes ?? 0)
  if (!cliente) return json(400, { ok: false, frase: 'Falta el cliente.' })
  if (!(TIPOS_SUBIDA as readonly string[]).includes(tipo)) return mal('Solo se pueden subir PDF y fotos (JPG, PNG, WEBP o HEIC).')
  if (!(bytes > 0 && bytes <= BYTES_SUBIDA)) return mal('El fichero pasa de 15 MB.')
  const { data: acc } = await srv.from('conta_portal_acceso').select('account_id, permiso').eq('party_id', cliente).eq('user_id', (await yo.auth.getUser()).data.user.id).is('revocado_at', null).maybeSingle()
  if (!acc || (carpeta === 'mensajes' && acc.permiso !== 'todo')) return mal('No tienes acceso a este cliente.')
  const ruta = `${acc.account_id}/${cliente}/${carpeta}/${crypto.randomUUID()}-${nombreSeguro(texto(b.nombre, 200) || 'documento')}`
  const { data, error } = await srv.storage.from('conta-portal').createSignedUploadUrl(ruta)
  if (error || !data?.token) return mal('No se puede subir ahora. Prueba en unos minutos.')
  return json(200, { ok: true, ruta, token: data.token })
}

async function subir(yo: Sb, srv: Sb, b: Fila) {
  const cliente = uuid(b.cliente); const ruta = texto(b.ruta, 400); const tipo = texto(b.tipo, 60); const bytes = Number(b.bytes ?? 0)
  const nombre = nombreSeguro(texto(b.nombre, 200) || 'documento'); const peticion = uuid(b.peticion)
  if (!cliente || !ruta) return json(400, { ok: false, frase: 'Falta el fichero.' })
  if (!(TIPOS_SUBIDA as readonly string[]).includes(tipo)) return mal('Solo se pueden subir PDF y fotos (JPG, PNG, WEBP o HEIC).')
  if (!(bytes > 0 && bytes <= BYTES_SUBIDA)) return mal('El fichero pasa de 15 MB.')
  // Que la ruta sea de su carpeta de subidas: lo dice la base, con su sesión.
  const { data: puede } = await yo.rpc('conta_portal_ruta_puede', { p_ruta: ruta, p_subir: true })
  const partes = ruta.split('/')
  if (puede !== true || partes[1] !== cliente || partes[2] !== 'subidas') return mal('Ese fichero no está en tu carpeta.')
  const cuenta = partes[0]
  const { data: acc } = await srv.from('conta_portal_acceso').select('id').eq('party_id', cliente).eq('user_id', (await yo.auth.getUser()).data.user.id).is('revocado_at', null).maybeSingle()
  const { data: sub, error: e1 } = await srv.from('conta_portal_subida')
    .insert({ account_id: cuenta, party_id: cliente, acceso_id: acc?.id ?? null, peticion_id: peticion, ruta, nombre, tipo_mime: tipo, bytes }).select('id').single()
  if (e1 || !sub) return mal('No se ha podido guardar.')
  if (peticion) await yo.rpc('conta_portal_peticion_contestar', { p_peticion: peticion, p_respuesta: null })

  // Al buzón de su cuenta en Sumied, si la tiene.
  const { data: prop } = await srv.rpc('_conta_portal_cuenta_propia', { p_account: cuenta, p_party: cliente })
  if (!prop) {
    await srv.from('conta_portal_subida').update({ estado: 'sin_buzon' }).eq('id', sub.id)
    return json(200, { ok: true, id: sub.id, frase: `Recibido: ${nombre}. Tu gestoría ya lo tiene.` })
  }
  const { data: emp } = await srv.from('company').select('id').eq('account_id', prop).eq('is_active', true).order('created_at').limit(1).maybeSingle()
  const { data: blob, error: e2 } = await srv.storage.from('conta-portal').download(ruta)
  if (e2 || !blob || !emp) {
    await srv.from('conta_portal_subida').update({ estado: 'error', error: 'No se ha podido pasar al buzón.' }).eq('id', sub.id)
    return json(200, { ok: true, id: sub.id, frase: `Recibido: ${nombre}. Tu gestoría ya lo tiene.` })
  }
  const datos = new Uint8Array(await blob.arrayBuffer())
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', datos))].map((x) => x.toString(16).padStart(2, '0')).join('')
  const destino = `${prop}/portal/${sub.id}-${nombre}`
  const { error: e3 } = await srv.storage.from('receipt-uploads').upload(destino, datos, { contentType: tipo, upsert: false })
  const { data: lleg, error: e4 } = e3 ? { data: null, error: e3 } : await srv.rpc('conta_entrada_llegada', {
    p: { account_id: prop, company_id: emp.id, canal: 'portal', recibido: new Date().toISOString(), ruta: destino, nombre, tipo, bytes: datos.length, sha256: sha },
  })
  if (e4 || !lleg) {
    await srv.from('conta_portal_subida').update({ estado: 'error', error: 'No se ha podido pasar al buzón.' }).eq('id', sub.id)
    return json(200, { ok: true, id: sub.id, frase: `Recibido: ${nombre}. Tu gestoría ya lo tiene.` })
  }
  const inbox = (lleg as { id: string }).id
  await srv.from('conta_portal_subida').update({ estado: 'en_el_buzon', buzon_account_id: prop, document_inbox_id: inbox }).eq('id', sub.id)
  // A leer, como lo que llega por correo. Si falla, el buzón lo enseña con su motivo: lo subido no se pierde.
  try {
    const r = await fetch(`${URL_BASE}/functions/v1/ocr-albaran`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICIO}`, 'x-internal-key': SERVICIO },
      body: JSON.stringify({ account_id: prop, file_paths: [destino], modo: 'factura' }),
    })
    const j = await r.json().catch(() => ({})) as { session_id?: string; error?: string }
    if (r.ok && j.session_id) await srv.rpc('conta_factura_desde_lectura', { p_inbox: inbox, p_session: j.session_id })
    else await srv.from('document_inbox').update({ status: 'error', reason: `No se ha podido leer: ${j.error ?? r.status}`, updated_at: new Date().toISOString() }).eq('id', inbox)
  } catch { /* lo enseña el buzón */ }
  return json(200, { ok: true, id: sub.id, frase: `Recibido: ${nombre}. Tu gestoría ya lo tiene.` })
}

// ── «No estoy de acuerdo» ────────────────────────────────────────────────────

async function noDeAcuerdo(yo: Sb, srv: Sb, b: Fila) {
  const cliente = uuid(b.cliente); const recibo = uuid(b.recibo); const t = texto(b.texto, 3000)
  if (!cliente || !recibo) return json(400, { ok: false, frase: 'Falta el recibo.' })
  const { data, error } = await yo.rpc('conta_portal_incidencia_crear', { p_party: cliente, p_tipo: 'no_de_acuerdo', p_texto: t, p_recibo: recibo })
  if (error || !data) return mal(fraseBase(error))
  const i = data as { id: string; recibo_id: string; motivo: string; quien: string }
  // Parar el recibo: Code 1, con la clave de servicio, después de que la base haya dicho que es suyo.
  const { data: p, error: e2 } = await srv.rpc('conta_recibo_parar', { p_recibo: i.recibo_id, p_motivo: i.motivo, p_quien: i.quien })
  const parado = !e2 && (p as { parado?: boolean } | null)?.parado === true
  await srv.rpc('conta_portal_incidencia_parada', { p_incidencia: i.id, p_parado: parado, p_frase: e2?.message ?? (p as { frase?: string } | null)?.frase ?? null })
  return json(200, { ok: true, id: i.id, parado, frase: parado
    ? 'Enviado. Tu recibo se para hasta que tu gestoría lo revise. Los demás cargos no cambian.'
    : 'Enviado a tu gestoría, que lo revisa antes de cobrarlo.' })
}

// ── Invitar ──────────────────────────────────────────────────────────────────

async function invitar(yo: Sb, srv: Sb, b: Fila, origen: unknown) {
  const cliente = uuid(b.cliente); const correo = correoValido(b.correo)
  if (!cliente || !correo) return json(400, { ok: false, frase: 'Escribe un correo que valga.' })
  const { data, error } = await yo.rpc('conta_portal_invitar', { p_party: cliente, p_correo: correo, p_nombre: texto(b.nombre, 120), p_permiso: b.permiso === 'facturas_documentos' ? 'facturas_documentos' : 'todo' })
  if (error || !data) return mal(fraseBase(error))
  const r0 = data as { id: string; frase: string }
  const { data: a } = await srv.from('conta_portal_acceso').select('id, account_id, party_id, invitado_por_name').eq('id', r0.id).single()
  const e = await enlaceParaEntrar(srv, correo, origen, URL_BASE)
  if ('porque' in e) return json(200, { ok: true, enviado: false, frase: `${r0.frase.split('.')[0]}, pero ${e.porque.toLowerCase()}` })
  await srv.rpc('conta_portal_acceso_usuario', { p_acceso: a.id, p_user: e.usuario })
  const marca = await marcaDe(srv, a.account_id, a.party_id)
  const { data: cli } = await srv.from('party').select('name').eq('id', a.party_id).maybeSingle()
  const env = await mandar(srv, {
    cuenta: a.account_id, cliente: a.party_id, para: correo, plantilla: PLANTILLA_ENLACE, marca,
    correo: correoEnlace({ ...marca, cliente: String(cli?.name ?? 'tu empresa'), enlace: e.enlace, invitacion: true, invita: a.invitado_por_name }),
    aviso: { tipo: 'invitacion', clave: `invitacion:${a.id}:${Date.now()}` },
  })
  const fuera = !URL_BASE.includes('xzmpnchlguibclvxyynt')
  return json(200, { ok: true, id: a.id, enviado: env.enviado, frase: env.enviado
    ? `${r0.frase}${env.demo ? ' En la demo, el correo va al buzón de pruebas.' : ''}`
    : `Acceso preparado para ${correo}, pero el correo no ha salido: ${env.porque}`, ...(fuera ? { enlace: e.enlace } : {}) })
}

// ── La firma por aceptación ──────────────────────────────────────────────────

async function firmaPedir(srv: Sb, usuario: string, b: Fila) {
  const peticion = uuid(b.peticion)
  if (!peticion) return json(400, { ok: false, frase: 'Falta qué firmar.' })
  const { data: q } = await srv.from('conta_portal_peticion').select('id, account_id, party_id, titulo').eq('id', peticion).maybeSingle()
  const { data: a } = q ? await srv.from('conta_portal_acceso').select('correo').eq('party_id', q.party_id).eq('user_id', usuario).is('revocado_at', null).maybeSingle() : { data: null }
  if (!q || !a) return mal('No hay nada que firmar ahí.')
  const { data, error } = await srv.rpc('conta_portal_firma_pedir', { p_user: usuario, p_peticion: peticion, p_canal: 'correo', p_destino: enmascararCorreo(a.correo) })
  if (error || !data) return mal(fraseBase(error))
  const f = data as { firma_id: string; codigo: string }
  const marca = await marcaDe(srv, q.account_id, q.party_id)
  const env = await mandar(srv, {
    cuenta: q.account_id, cliente: q.party_id, para: a.correo, plantilla: PLANTILLA_CODIGO, marca,
    correo: correoCodigo({ ...marca, codigo: f.codigo, titulo: q.titulo, minutos: 10 }),
    aviso: { tipo: 'firma', clave: `firma:${f.firma_id}` },
  })
  if (!env.enviado) return mal(`No se ha podido mandar el código: ${env.porque}`)
  return json(200, { ok: true, firma: f.firma_id, frase: `Te hemos mandado un código a ${enmascararCorreo(a.correo)}${env.demo ? ' (en la demo, al buzón de pruebas)' : ''}. Vale 10 minutos.` })
}

async function firmaComprobar(yo: Sb, srv: Sb, b: Fila, req: Request) {
  const firma = uuid(b.firma)
  if (!firma) return json(400, { ok: false, frase: 'Falta la firma.' })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const navegador = (req.headers.get('user-agent') ?? '').slice(0, 300) || null
  const { data, error } = await yo.rpc('conta_portal_firma_comprobar', { p_firma: firma, p_codigo: texto(b.codigo, 12), p_ip: ip, p_navegador: navegador })
  if (error || !data) return mal(fraseBase(error))
  const r = data as { firmada: boolean; frase: string }
  if (!r.firmada) return json(200, { ok: false, frase: r.frase })
  // El PDF firmado: el documento con una página más. Si no sale, la firma vale igual (quién, cuándo y desde dónde ya están).
  try { await pdfFirmado(srv, firma) } catch (x) { console.error('[conta-portal] pdf firmado', x instanceof Error ? x.message : String(x)) }
  return json(200, { ok: true, frase: r.frase })
}

async function pdfFirmado(srv: Sb, firma: string) {
  const { data: f } = await srv.from('conta_portal_firma').select('id, account_id, party_id, peticion_id, acceso_id, destino, firmada_at, ip, navegador, pdf_ruta').eq('id', firma).single()
  if (!f?.firmada_at || f.pdf_ruta) return
  const [{ data: q }, { data: a }, { data: c }] = await Promise.all([
    srv.from('conta_portal_peticion').select('titulo, documento_ruta').eq('id', f.peticion_id).single(),
    srv.from('conta_portal_acceso').select('nombre, correo').eq('id', f.acceso_id).single(),
    srv.from('party').select('name, tax_id').eq('id', f.party_id).single(),
  ])
  const { data: blob } = await srv.storage.from('conta-portal').download(q.documento_ruta)
  const original = new Uint8Array(await blob.arrayBuffer())
  const huella = async (x: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', x))].map((y) => y.toString(16).padStart(2, '0')).join('')
  const doc = await PDFDocument.load(original)
  const hoja = doc.addPage([595.28, 841.89])
  const letra = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  const cuando = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'medium' }).format(new Date(f.firmada_at))
  const lineas: [string, string][] = [
    ['Documento', q.titulo], ['Cliente', `${c.name}${c.tax_id ? ` · ${c.tax_id}` : ''}`], ['Firmado por', `${a.nombre ? `${a.nombre} · ` : ''}${a.correo}`],
    ['Cuándo', `${cuando} (hora de Madrid)`], ['Desde dónde', f.ip ? `IP ${f.ip}` : 'Sin IP'], ['Navegador', f.navegador ?? '—'],
    ['Cómo', `Aceptación con un código de un solo uso enviado a ${f.destino}`], ['Huella del documento', await huella(original)], ['Firma', f.id],
  ]
  const limpio = (s: string) => s.replace(/[^\x20-\x7E -ÿ€«»·—]/g, '?')
  hoja.drawText('Firma por aceptación', { x: 56, y: 770, size: 18, font: negrita, color: rgb(0.06, 0.11, 0.18) })
  let y = 730
  for (const [k, v] of lineas) {
    hoja.drawText(limpio(k), { x: 56, y, size: 10, font: negrita, color: rgb(0.2, 0.27, 0.37) })
    for (const trozo of (limpio(v).match(/.{1,70}/g) ?? [''])) { hoja.drawText(trozo, { x: 190, y, size: 10, font: letra, color: rgb(0.06, 0.11, 0.18) }); y -= 14 }
    y -= 8
  }
  hoja.drawText('Funciona con Sumied', { x: 56, y: 40, size: 8, font: letra, color: rgb(0.29, 0.36, 0.45) })
  const firmado = await doc.save()
  const ruta = `${f.account_id}/${f.party_id}/firmas/${f.id}.pdf`
  const { error } = await srv.storage.from('conta-portal').upload(ruta, firmado, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`no se ha guardado: ${error.message}`)
  await srv.rpc('conta_portal_firma_pdf', { p_firma: f.id, p_ruta: ruta, p_sha256: await huella(firmado) })
}

// ── GoCardless ───────────────────────────────────────────────────────────────

async function conexion(srv: Sb, cuenta: string, empresa: string): Promise<{ base: string; token: string; entorno: Entorno } | { porque: string }> {
  const { data: sec } = await srv.rpc('conta_gocardless_secreto', { p_company: empresa })
  const s = (sec as { entorno: Entorno; token: string }[] | null)?.[0]
  if (!s?.token) return { porque: 'Tu gestoría aún no tiene conectado su banco de cobros.' }
  const esDemo = !(await cuentaPuedeSalir(srv, cuenta))
  const sale = salirA(esDemo, s.entorno)
  if (!sale.sale) return { porque: sale.porque }
  if (s.entorno === 'real' && !ESCRIBIR_EN_REAL) return { porque: SOLO_PRUEBAS }
  return { base: BASES[s.entorno], token: s.token, entorno: s.entorno }
}

async function gc(c: { base: string; token: string }, p: Peticion): Promise<{ status: number; j: unknown }> {
  const r = await fetch(`${c.base}${p.ruta}`, {
    method: p.metodo,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...p.cabeceras },
    ...(p.cuerpo ? { body: JSON.stringify(p.cuerpo) } : {}),
  })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}

type Tipo = 'pagar_banco' | 'reintentar' | 'cambiar_cuenta'

async function banco(yo: Sb, srv: Sb, b: Fila, tipo: Tipo, origen: unknown) {
  const cliente = uuid(b.cliente)
  if (!cliente) return json(400, { ok: false, frase: 'Falta el cliente.' })
  const que = tipo === 'pagar_banco' ? 'pagar' : tipo === 'reintentar' ? 'reintentar' : 'cambiar'
  let empresa: string; let recibo: Fila | null = null
  if (tipo === 'cambiar_cuenta') {
    const { data, error } = await yo.rpc('conta_portal_cuenta', { p_party: cliente })
    if (error || !data) return mal(fraseBase(error))
    empresa = String((data as Fila).empresa_id ?? '')
  } else {
    const id = uuid(b.recibo)
    const { data, error } = await yo.rpc('conta_portal_pagos', { p_party: cliente })
    if (error || !data) return mal(fraseBase(error))
    if (!id || !((data as { devueltos: Fila[] }).devueltos ?? []).some((d) => d.recibo_id === id)) return mal('Ese recibo no está devuelto o ya está pagado.')
    const { data: r } = await srv.from('conta_recibo').select('id, account_id, company_id, party_id, mes, total_cent, cobrar_cent, gc_cobro_id').eq('id', id).single()
    recibo = r; empresa = String(r.company_id)
  }
  if (!empresa) return mal('Tu gestoría aún no tiene una empresa dada de alta en Sumied.')
  const { data: acc } = await srv.from('conta_portal_acceso').select('id, account_id, nombre, correo').eq('party_id', cliente).eq('user_id', (await yo.auth.getUser()).data.user.id).is('revocado_at', null).maybeSingle()
  if (!acc) return mal('No tienes acceso a este cliente.')
  const c = await conexion(srv, acc.account_id, empresa)
  if ('porque' in c) return mal(c.porque)

  // Lo que ya está en marcha (la misma operación en la última hora): su página, sin pedir otra.
  let q = srv.from('conta_portal_operacion').select('id, externo_url, estado').eq('party_id', cliente).eq('tipo', tipo).in('estado', ['creada', 'esperando'])
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString())
  q = recibo ? q.eq('recibo_id', recibo.id) : q
  const { data: ya } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (ya?.externo_url) return json(200, { ok: true, operacion: ya.id, url: ya.externo_url, frase: 'Sigue donde lo dejaste.' })

  const { data: op } = await srv.from('conta_portal_operacion').insert({
    account_id: acc.account_id, company_id: empresa, party_id: cliente, recibo_id: recibo?.id ?? null, tipo, entorno: c.entorno,
    importe_cent: recibo ? Number(recibo.cobrar_cent ?? recibo.total_cent) : null, acceso_id: acc.id, creada_por_name: acc.nombre ?? acc.correo,
  }).select('id').single()
  const fallo = async (status: number, j: unknown) => {
    const frase = fraseError(status, j, que)
    await srv.from('conta_portal_operacion').update({ estado: 'fallida', error: `${status} ${JSON.stringify((j as Fila)?.error ?? {}).slice(0, 400)}`, updated_at: new Date().toISOString() }).eq('id', op.id)
    return mal(frase)
  }

  if (tipo === 'reintentar') {
    const pago = String(recibo!.gc_cobro_id ?? '')
    if (!pago) return fallo(422, { error: { errors: [{ reason: 'not_retryable' }] } })
    const r = await gc(c, peticionReintento(pago, `portal:reintentar:${op.id}`))
    if (r.status >= 300) return fallo(r.status, r.j)
    const fecha = String((r.j as { payments?: { charge_date?: string } })?.payments?.charge_date ?? '')
    await srv.from('conta_portal_operacion').update({ estado: 'hecha', externo_id: pago, detalle: { cargo_el: fecha || null }, hecha_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', op.id)
    return json(200, { ok: true, operacion: op.id, frase: fecha ? `Hecho. Tu banco lo pasa de nuevo el ${fecha.split('-').reverse().join('/')}.` : 'Hecho. Tu banco lo pasa de nuevo en unos días.' })
  }

  const { data: cc } = await srv.from('conta_cobro_cliente').select('gc_cliente_id').eq('company_id', empresa).eq('party_id', cliente).maybeSingle()
  if (!cc?.gc_cliente_id) return fallo(422, { error: { errors: [{ reason: 'sin_cliente' }] } })
  const pet = tipo === 'pagar_banco'
    ? peticionPagarAhora({ clienteGc: cc.gc_cliente_id, importeCent: Number(recibo!.cobrar_cent ?? recibo!.total_cent), descripcion: `Recibo ${recibo!.mes} devuelto`, clave: `portal:pagar:${op.id}` })
    : peticionCambiarCuenta({ clienteGc: cc.gc_cliente_id, clave: `portal:cuenta:${op.id}` })
  const r1 = await gc(c, pet)
  if (r1.status >= 300) return fallo(r1.status, r1.j)
  const brq = leerPeticion(r1.j).id
  const base = portalBase(origen, URL_BASE)
  const r2 = await gc(c, peticionFlujo({ brq, vuelta: `${base}/portal.html?vuelta=${op.id}`, salida: `${base}/portal.html`, clave: `portal:flujo:${op.id}` }))
  if (r2.status >= 300) return fallo(r2.status, r2.j)
  const url = leerFlujo(r2.j)
  await srv.from('conta_portal_operacion').update({ estado: 'esperando', externo_id: brq, externo_url: url, updated_at: new Date().toISOString() }).eq('id', op.id)
  return json(200, { ok: true, operacion: op.id, url, frase: tipo === 'pagar_banco' ? 'Te llevamos a tu banco para pagarlo.' : 'Te llevamos a firmar la domiciliación de tu cuenta nueva.' })
}

async function seguir(yo: Sb, srv: Sb, b: Fila) {
  const id = uuid(b.operacion)
  if (!id) return json(400, { ok: false, frase: 'Falta qué seguir.' })
  // Con su sesión: la RLS solo le deja ver las de su cliente.
  const { data: op } = await yo.from('conta_portal_operacion').select('id, account_id, company_id, party_id, recibo_id, tipo, estado, externo_id, importe_cent, mandato_nuevo, detalle, creada_por_name').eq('id', id).maybeSingle()
  if (!op) return mal('Eso no es tuyo o ya no está.')
  if (op.estado === 'hecha') {
    const r = await rematar(srv, op)
    return json(200, { ok: true, estado: 'hecha', frase: r ?? (op.tipo === 'cambiar_cuenta' ? 'Listo: tus recibos se cargarán en tu cuenta nueva.' : 'Pagado. Gracias.') })
  }
  if (!op.externo_id || op.tipo === 'reintentar') return json(200, { ok: true, estado: op.estado, frase: 'Aún no ha terminado.' })
  if (op.tipo === 'pagar_tarjeta') return await seguirTarjeta(srv, op)
  const c = await conexion(srv, op.account_id, op.company_id)
  if ('porque' in c) return mal(c.porque)
  const r = await gc(c, peticionLeer(op.externo_id))
  if (r.status >= 300) return mal(fraseError(r.status, r.j, op.tipo === 'cambiar_cuenta' ? 'cambiar' : 'pagar'))
  const l = leerPeticion(r.j)
  const detalle = { ...((op.detalle as Fila) ?? {}), pago: l.pago, mandato: l.mandato }
  await srv.from('conta_portal_operacion').update({
    estado: l.estado, mandato_nuevo: l.mandato, detalle, updated_at: new Date().toISOString(),
    ...(l.estado === 'hecha' ? { hecha_at: new Date().toISOString() } : {}),
  }).eq('id', op.id)
  const remate = l.estado === 'hecha' ? await rematar(srv, { ...op, estado: 'hecha', mandato_nuevo: l.mandato, detalle }) : null
  const frase = l.estado === 'hecha'
    ? remate ?? (op.tipo === 'cambiar_cuenta' ? 'Listo: tus recibos se cargarán en tu cuenta nueva.' : 'Pagado. Tu gestoría ya lo tiene.')
    : l.estado === 'esperando' ? 'Tu banco aún lo está confirmando. Te avisamos cuando termine.'
    : l.estado === 'caducada' ? 'Lo dejaste a medias. Puedes empezar de nuevo.' : 'Tu banco no lo ha aceptado. Prueba de nuevo o escribe a tu gestoría.'
  return json(200, { ok: true, estado: l.estado, frase })
}

// ── Stripe: pagar un devuelto con tarjeta o Bizum (solo pruebas, solo demos) ──

async function tarjeta(yo: Sb, srv: Sb, b: Fila, origen: unknown) {
  const cliente = uuid(b.cliente); const id = uuid(b.recibo)
  if (!cliente || !id) return json(400, { ok: false, frase: 'Falta el recibo.' })
  const { data, error } = await yo.rpc('conta_portal_pagos', { p_party: cliente })
  if (error || !data) return mal(fraseBase(error))
  if (!((data as { devueltos: Fila[] }).devueltos ?? []).some((d) => d.recibo_id === id)) return mal('Ese recibo no está devuelto o ya está pagado.')
  const { data: acc } = await srv.from('conta_portal_acceso').select('id, account_id, nombre, correo').eq('party_id', cliente).eq('user_id', (await yo.auth.getUser()).data.user.id).is('revocado_at', null).maybeSingle()
  if (!acc) return mal('No tienes acceso a este cliente.')
  const { data: aj } = await srv.from('conta_portal_ajustes').select('pagar_devuelto').eq('account_id', acc.account_id).maybeSingle()
  if (!((aj?.pagar_devuelto as string[] | undefined) ?? ['banco']).includes('tarjeta')) return mal('Tu gestoría no tiene puesto el pago con tarjeta.')
  // Solo en las demos, y solo con la clave de pruebas.
  if (await cuentaPuedeSalir(srv, acc.account_id)) return mal(SOLO_PRUEBAS)
  const k = claveStripePruebas(Deno.env.get('STRIPE_SECRET_KEY_PRUEBAS'))
  if ('porque' in k) return mal(k.porque)
  const { data: r } = await srv.from('conta_recibo').select('id, company_id, mes, total_cent, cobrar_cent').eq('id', id).single()

  const { data: ya } = await srv.from('conta_portal_operacion').select('id, externo_url').eq('recibo_id', id).eq('tipo', 'pagar_tarjeta')
    .in('estado', ['creada', 'esperando']).gte('created_at', new Date(Date.now() - 3600_000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (ya?.externo_url) return json(200, { ok: true, operacion: ya.id, url: ya.externo_url, frase: 'Sigue donde lo dejaste.' })

  const importe = Number(r.cobrar_cent ?? r.total_cent)
  const { data: op } = await srv.from('conta_portal_operacion').insert({
    account_id: acc.account_id, company_id: r.company_id, party_id: cliente, recibo_id: id, tipo: 'pagar_tarjeta', entorno: 'pruebas',
    importe_cent: importe, acceso_id: acc.id, creada_por_name: acc.nombre ?? acc.correo,
  }).select('id').single()
  const base = portalBase(origen, URL_BASE)
  const pedir = (bizum: boolean) => v1(k.clave, 'POST', '/v1/checkout/sessions', camposPagoTarjeta({
    importeCent: importe, concepto: `Recibo ${r.mes} devuelto`, operacion: op.id, vuelta: `${base}/portal.html?vuelta=${op.id}`, salida: `${base}/portal.html`,
    correo: correoValido(acc.correo), bizum,
  }))
  let s = await pedir(true)
  if (!s.ok && /bizum/i.test(errorStripe(s))) s = await pedir(false)
  if (!s.ok) {
    await srv.from('conta_portal_operacion').update({ estado: 'fallida', error: `Stripe ${s.status}: ${errorStripe(s)}`.slice(0, 400), updated_at: new Date().toISOString() }).eq('id', op.id)
    return mal('El pago con tarjeta no está disponible ahora. Prueba desde tu banco o escribe a tu gestoría.')
  }
  const l = leerSesionStripe(s.datos)
  await srv.from('conta_portal_operacion').update({ estado: 'esperando', externo_id: l.id, externo_url: l.url, updated_at: new Date().toISOString() }).eq('id', op.id)
  return json(200, { ok: true, operacion: op.id, url: l.url, frase: 'Te llevamos a la página de pago.' })
}

async function seguirTarjeta(srv: Sb, op: Fila) {
  const k = claveStripePruebas(Deno.env.get('STRIPE_SECRET_KEY_PRUEBAS'))
  if ('porque' in k) return mal(k.porque)
  const s = await v1(k.clave, 'GET', `/v1/checkout/sessions/${encodeURIComponent(String(op.externo_id))}`)
  if (!s.ok) return mal('No se ha podido saber cómo ha ido el pago. Prueba en unos minutos.')
  const l = leerSesionStripe(s.datos)
  await srv.from('conta_portal_operacion').update({ estado: l.estado, updated_at: new Date().toISOString(), ...(l.estado === 'hecha' ? { hecha_at: new Date().toISOString() } : {}) }).eq('id', op.id)
  const remate = l.estado === 'hecha' ? await rematar(srv, { ...op, estado: 'hecha' }) : null
  return json(200, { ok: true, estado: l.estado, frase: l.estado === 'hecha' ? remate ?? 'Pagado. Tu gestoría ya lo tiene.'
    : l.estado === 'caducada' ? 'Lo dejaste a medias. Puedes empezar de nuevo.' : 'El pago aún se está confirmando. Te avisamos cuando termine.' })
}

// ── La demo: que el banco devuelva un recibo (sandbox) ────────────────────────

/**
 * El simulador del sandbox de GoCardless («payment_failed»: el cobro pasa a
 * fallido, como si el banco lo devolviera). Después llega el aviso de GoCardless
 * y el cobro de Code 1 pone el recibo «devuelto», como con uno de verdad. Solo
 * cuentas demo, solo la conexión de pruebas y solo quien lleva la cuenta.
 */
async function demoDevolver(yo: Sb, srv: Sb, b: Fila) {
  const id = uuid(b.recibo)
  if (!id) return json(400, { ok: false, frase: 'Falta el recibo.' })
  const { data: r } = await srv.from('conta_recibo').select('id, account_id, company_id, mes, estado, gc_cobro_id').eq('id', id).maybeSingle()
  if (!r) return mal('Ese recibo no está.')
  const { data: puede } = await yo.rpc('current_user_is_admin_or_manager_of', { p_account_id: r.account_id })
  if (puede !== true) return mal('Esto lo hace un administrador o un encargado de la cuenta.')
  const { data: cu } = await srv.from('accounts').select('is_demo').eq('id', r.account_id).maybeSingle()
  if (cu?.is_demo !== true) return mal('Esto solo se hace en una cuenta de demostración.')
  const { data: sec } = await srv.rpc('conta_gocardless_secreto', { p_company: r.company_id })
  const s = (sec as { entorno: Entorno; token: string }[] | null)?.[0]
  if (!s?.token || s.entorno !== 'pruebas') return mal('Solo con la conexión de pruebas de GoCardless (el sandbox).')
  const pago = String(r.gc_cobro_id ?? '')
  if (!/^PM[0-9A-Z]+$/.test(pago)) return mal('Ese recibo aún no se ha mandado al banco: primero «Enviar el cobro».')
  const x = await fetch(`${BASES.pruebas}/scenario_simulators/payment_failed/actions/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'GoCardless-Version': VERSION_GOCARDLESS },
    body: JSON.stringify({ data: { links: { resource: pago } } }),
  })
  if (x.status >= 300) {
    const j = await x.json().catch(() => ({})) as { error?: { message?: string } }
    console.error('[conta-portal] demo_devolver', x.status)
    return mal(`El sandbox no lo ha devuelto (${x.status}): ${String(j.error?.message ?? 'sin motivo').slice(0, 200)}. Solo se puede con un cobro que aún no ha salido al banco.`)
  }
  return json(200, { ok: true, frase: `Hecho: el sandbox devuelve el cobro del recibo de ${r.mes}. En unos minutos llega el aviso de GoCardless y el recibo sale devuelto, en Sumied y en el portal del cliente.` })
}

// ── El remate de Code 1 (#534), una vez por operación ─────────────────────────

/**
 * Un devuelto pagado: se apunta con conta_recibo_pagado_portal (su frase, tal
 * cual). Una cuenta nueva: conta-cobro «cambiar_cuenta». Lo hecho queda en
 * detalle.apunte o detalle.cambio y no se repite; si falla, se vuelve a probar
 * en el siguiente «seguir». Devuelve la frase para la pantalla, o null.
 */
async function rematar(srv: Sb, op: Fila): Promise<string | null> {
  const d = ((op.detalle as Fila) ?? {}) as Fila
  if (URL_BASE.includes(PRODUCCION) && !REMATAR_EN_PRODUCCION) return null
  const guardar = (extra: Fila) => srv.from('conta_portal_operacion').update({ detalle: { ...d, ...extra }, updated_at: new Date().toISOString() }).eq('id', op.id)
  try {
    if (op.tipo === 'pagar_banco' || op.tipo === 'pagar_tarjeta') {
      if (d.apunte) return String((d.apunte as Fila).frase ?? '') || null
      const referencia = op.tipo === 'pagar_banco' ? String(d.pago ?? op.externo_id ?? '') : String(op.externo_id ?? '')
      if (!op.recibo_id || !referencia || !op.importe_cent) return null
      const { data, error } = await srv.rpc('conta_recibo_pagado_portal', {
        p_recibo: op.recibo_id, p_via: op.tipo === 'pagar_banco' ? 'banco' : 'tarjeta', p_importe: Number(op.importe_cent) / 100, p_referencia: referencia,
      })
      if (error) { await guardar({ apunte_error: error.message.slice(0, 300) }); console.error('[conta-portal] apunte', error.message); return null }
      const r = (data ?? {}) as Fila
      await guardar({ apunte: r, apunte_error: null })
      return typeof r.frase === 'string' && r.frase ? r.frase : null
    }
    if (op.tipo === 'cambiar_cuenta') {
      if (d.cambio) return 'Listo: tus recibos se cargarán en tu cuenta nueva.'
      const mandato = String(op.mandato_nuevo ?? d.mandato ?? '')
      if (!mandato || !op.company_id) return null
      const r = await fetch(`${URL_BASE}/functions/v1/conta-cobro`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICIO}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'cambiar_cuenta', empresa: op.company_id, cliente: op.party_id, mandato, quien: `${String(op.creada_por_name ?? 'El cliente')}, desde el portal`.slice(0, 120) }),
      })
      const j = await r.json().catch(() => ({})) as Fila
      if (!r.ok || j.ok !== true) {
        await guardar({ cambio_error: `${r.status} ${String(j.error ?? '')}`.slice(0, 300) })
        console.error('[conta-portal] cambiar_cuenta', r.status)
        // 409: la domiciliación nueva aún no está activa en el banco. Se vuelve a mirar después.
        return r.status === 409 ? 'Tu banco aún está activando la cuenta nueva. Mientras, los recibos siguen en la de antes.' : null
      }
      await guardar({ cambio: j, cambio_error: null })
      return 'Listo: tus recibos se cargarán en tu cuenta nueva.'
    }
  } catch (x) {
    console.error('[conta-portal] remate', x instanceof Error ? x.message : String(x))
  }
  return null
}

// ── Las facturas de un año, para el ZIP ──────────────────────────────────────

async function archivos(yo: Sb, srv: Sb, b: Fila) {
  const cliente = uuid(b.cliente); const anio = Number(b.anio)
  if (!cliente || !(anio > 2000 && anio < 2100)) return json(400, { ok: false, frase: 'Falta el año.' })
  const { data, error } = await yo.rpc('conta_portal_facturas', { p_party: cliente })
  if (error || !data) return mal(fraseBase(error))
  const del = ((data as { facturas: Fila[] }).facturas ?? []).filter((f) => Number(f.anio) === anio && f.tiene_pdf).slice(0, 60)
  const urls: { nombre: string; url: string }[] = []
  for (const f of del) {
    const { data: a } = await yo.rpc('conta_portal_archivo', { p_party: cliente, p_tipo: 'factura', p_id: f.id, p_indice: 0 })
    if (!a) continue
    const x = a as { almacen: string; ruta: string; nombre: string }
    const { data: s } = await srv.storage.from(x.almacen).createSignedUrl(x.ruta, 300)
    if (s?.signedUrl) urls.push({ nombre: nombreSeguro(x.nombre), url: s.signedUrl })
  }
  return json(200, { ok: true, anio, archivos: urls, frase: urls.length ? `${urls.length} facturas de ${anio}.` : `No hay facturas de ${anio} con PDF.` })
}
