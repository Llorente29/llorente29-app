// supabase/functions/conta-bitrix-pestana/index.ts
//
// GB · La pestaña «Sumied» en la ficha de Bitrix24 (primera parte: solo ver).
// verify_jwt = false: quien llama es Bitrix24 o la página de la pestaña, sin
// sesión de Sumied. La seguridad la da la comprobación con Bitrix24.
//
//   · POST ?paso=pestana (formulario de Bitrix24, al abrir la pestaña): no lee
//     nada; redirige (303) a bitrix-pestana.html con el token y la ficha detrás
//     del «#». Vercel no acepta un POST sobre una página fija.
//   · POST ?paso=instalar (formulario de Bitrix24, al instalar la aplicación,
//     con el token del administrador): engancha la pestaña a la ficha de la
//     empresa y del contacto (placement.bind) y redirige a la página, que
//     termina la instalación (BX24.installFinish).
//   · POST JSON { paso: 'leer', a, p, t, id } (de la página): comprueba con
//     Bitrix24 que el token es de la aplicación de Sumied (app.info) y de quién
//     es (user.current, su correo), y SOLO ENTONCES llama a
//     conta_bitrix_pestana_leer, que busca la persona de Sumied con ese correo
//     en la cuenta de ese portal y lee como ella. Nunca se enseña nada sin eso.
//   · POST JSON { paso: 'hacer', a, p, t, id, accion, datos } (nº 9): la misma
//     comprobación; Sumied hace el cambio con las funciones de la ficha del G04,
//     como la persona (conta_bitrix_pestana_hacer), y después se actualiza la
//     «Cuota mensual» de la ficha en Bitrix24 sin pisar un dato cambiado allí.
//
// La aplicación local necesita los permisos crm, placement y user_basic (con
// user_brief, user.current no trae el correo y nadie pasa: nº 6, 09/11). Cómo
// se instala: docs/conta/encargos/encargo_GB_pestana_sumied_en_bitrix.md.
//
// Lee, y con «hacer» escribe en Sumied (con las funciones de la ficha) y la
// cuota en Bitrix24. Engancha la pestaña al instalar. No guarda ningún token. Solo en los portales de puro.ts · PORTALES.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  direccionDeLaPagina, FRASES, HUECOS, leerLlegada, portalLimpio, portalPermitido, porqueApp, porqueUsuario, TITULO_PESTANA, usuarioDeBitrix,
  type TipoFicha,
} from './puro.ts'
import { choquesDe, estadoDelCobro, mesEnPalabras, mesSiguiente, notaDelCambio, queHacerConElTexto, queHacerConLaCuota, totalDelRecibo, trabajadoresDelRecibo } from './escribir.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const irA = (donde: string) => new Response(null, { status: 303, headers: { Location: donde, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })

const PAGINA = Deno.env.get('BITRIX_PESTANA_PAGINA') ?? 'https://app.sumied.com/bitrix-pestana.html'
/** Se lee en cada llamada: un cambio del secreto vale desde la siguiente, sin depender de que la función arranque de nuevo. */
const clientId = () => (Deno.env.get('BITRIX_PESTANA_CLIENT_ID') ?? '').trim()

/** Una llamada a la API de Bitrix24 del portal, con el token del usuario. Solo a portales permitidos. */
async function bitrix(portal: string, metodo: string, auth: string, cuerpo: Record<string, unknown> = {}): Promise<unknown> {
  if (!portalPermitido(portal)) throw new Error('portal no permitido')
  // El token va en la dirección (?auth=), como lo documenta Bitrix24; el resto, en el cuerpo.
  const r = await fetch(`https://${portal}/rest/${metodo}.json?auth=${encodeURIComponent(auth)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(4000),
  })
  return await r.json().catch(() => null)
}

async function formulario(req: Request): Promise<URLSearchParams> {
  const tipo = req.headers.get('content-type') ?? ''
  if (tipo.includes('application/x-www-form-urlencoded')) return new URLSearchParams(await req.text())
  if (tipo.includes('multipart/form-data')) {
    const f = await req.formData()
    const u = new URLSearchParams()
    f.forEach((v, k) => { if (typeof v === 'string') u.set(k, v) })
    return u
  }
  return new URLSearchParams()
}

/** Al instalar: la pestaña, en la ficha de la empresa y en la del contacto. «Ya estaba» vale. */
async function engancharPestana(portal: string, auth: string, aqui: string): Promise<string[]> {
  const fallos: string[] = []
  for (const hueco of Object.keys(HUECOS)) {
    const r = await bitrix(portal, 'placement.bind', auth, { PLACEMENT: hueco, HANDLER: `${aqui}?paso=pestana`, TITLE: TITULO_PESTANA }) as
      { result?: unknown; error?: string; error_description?: string } | null
    const yaEstaba = /already/i.test(String(r?.error_description ?? '')) || r?.error === 'ERROR_PLACEMENT_HANDLER_ALREADY_BINDED'
    if (!r?.result && !yaEstaba) fallos.push(`${hueco}: ${r?.error_description ?? r?.error ?? 'sin respuesta'}`)
  }
  return fallos
}

type Mira = { ok: false; respuesta: Response } | { ok: true; auth: string; portal: string; tipo: TipoFicha; id: string; correo: string }

/** Quién mira y qué ficha: lo comprueba con Bitrix24 (app.info y user.current). Lo usan leer y hacer: nunca se lee ni se cambia nada sin esto. */
async function quienMira(cuerpo: Record<string, unknown>): Promise<Mira> {
  const auth = typeof cuerpo.a === 'string' && /^[A-Za-z0-9._-]{8,200}$/.test(cuerpo.a) ? cuerpo.a : null
  const portal = portalLimpio(cuerpo.p)
  const tipo = cuerpo.t === 'empresa' || cuerpo.t === 'contacto' ? (cuerpo.t as TipoFicha) : null
  const id = typeof cuerpo.id === 'string' && /^[0-9]{1,18}$/.test(cuerpo.id) ? cuerpo.id : null
  if (!tipo || !id) return { ok: false, respuesta: json(200, { estado: 'ficha_rara', frase: FRASES.ficha_rara }) }
  if (!auth || !portal) return { ok: false, respuesta: json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied }) }
  if (!portalPermitido(portal)) return { ok: false, respuesta: json(200, { estado: 'portal_no_permitido', frase: FRASES.portal_no_permitido }) }

  // Quién mira, y con qué aplicación: las dos preguntas a la vez.
  let app: unknown, yo: unknown
  try {
    ;[app, yo] = await Promise.all([bitrix(portal, 'app.info', auth), bitrix(portal, 'user.current', auth)])
  } catch (e) {
    console.warn(JSON.stringify({ gb: 'no_es_sumied', porque: `Bitrix24 no contesta: ${e instanceof Error ? e.name : 'error'}` }))
    return { ok: false, respuesta: json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied }) }
  }
  const usuario = usuarioDeBitrix(yo)
  const porque = [porqueApp(app, clientId()), porqueUsuario(yo)].filter(Boolean)
  if (porque.length || !usuario) {
    // Sin datos personales ni secretos (puro.ts): solo códigos y nombres de campo.
    console.warn(JSON.stringify({ gb: 'no_es_sumied', porque }))
    return { ok: false, respuesta: json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied }) }
  }
  return { ok: true, auth, portal, tipo, id, correo: usuario.correo }
}

const baseDeDatos = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/** La lectura de la pestaña (conta_bitrix_pestana_leer), ya comprobado quién mira. */
async function lectura(db: ReturnType<typeof baseDeDatos>, m: Extract<Mira, { ok: true }>): Promise<{ ok: true; d: Record<string, unknown> } | { ok: false; respuesta: Response }> {
  const { data, error } = await db.rpc('conta_bitrix_pestana_leer', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id })
  if (error) return { ok: false, respuesta: json(500, { estado: 'error', frase: 'No se ha podido leer Sumied. Vuelve a abrir la pestaña en un momento.' }) }
  const d = (data ?? {}) as Record<string, unknown>
  const estado = String(d.estado ?? 'error')
  if (estado !== 'ok') return { ok: false, respuesta: json(200, { estado, frase: FRASES[estado] ?? 'No se puede enseñar nada.', cuenta_nombre: estado === 'sin_enlazar' ? d.cuenta_nombre ?? null : null }) }
  return { ok: true, d: { ...d, portal: m.portal } }
}

async function leer(cuerpo: Record<string, unknown>): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const l = await lectura(baseDeDatos(), m)
  return l.ok ? json(200, l.d) : l.respuesta
}

/** nº 9, punto 5 · «Su portal»: quién entra, lo que pide el cliente y los mensajes sin leer (conta_portal_ficha, de Code 3, como la persona). */
async function portal(cuerpo: Record<string, unknown>): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const db = baseDeDatos()
  // nº 17, A · Con su portal, en la misma petición, sus recibos devueltos y lo que se puede hacer con cada uno (Code 1).
  const [p, d] = await Promise.all([
    db.rpc('conta_bitrix_pestana_portal', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id }),
    db.rpc('conta_bitrix_pestana_devueltos', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id }),
  ])
  if (p.error) return json(200, { estado: 'error', frase: 'No se ha podido leer su portal.' })
  return json(200, { ...((p.data ?? { estado: 'error' }) as Record<string, unknown>), devueltos: devueltosDe(d.data) })
}

/** nº 17, A · Lo que llega de conta_bitrix_pestana_devueltos, para la pestaña (sin el usuario). */
function devueltosDe(x: unknown): Record<string, unknown> | null {
  const d = (x ?? {}) as Record<string, unknown>
  if (d.estado !== 'ok') return null
  return { puede: d.puede === true, lista: Array.isArray(d.devueltos) ? d.devueltos.map((o: Record<string, unknown>) => ({
    recibo: o.recibo_id, mes: o.mes, importe_cent: o.importe_cent, estado: o.estado, enlace: o.enlace, pasar: o.pasar, veces: o.veces_pasado,
  })) : [] }
}

/**
 * nº 17, A · «Enviarle el enlace para pagar» o «Que lo pasen de nuevo»: lo hace
 * conta-cobro (Code 1), con la clave de servicio y en nombre de la persona, que
 * vuelve a comprobar que puede; después se apunta y Bitrix24 se pone al día.
 */
async function devuelto(cuerpo: Record<string, unknown>, origen: string | null): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const datos = (cuerpo.datos ?? {}) as Record<string, unknown>
  const que = datos.que === 'enlace' || datos.que === 'pasar' ? datos.que : null
  const recibo = typeof datos.recibo === 'string' ? datos.recibo : null
  if (!que || !recibo) return json(400, { estado: 'no_se_pudo', frase: 'No se sabe qué hacer con el recibo.' })
  const db = baseDeDatos()
  const { data: dv } = await db.rpc('conta_bitrix_pestana_devueltos', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id })
  const d = (dv ?? {}) as { estado?: string; usuario?: string; puede?: boolean; devueltos?: Record<string, unknown>[] }
  if (d.estado !== 'ok') return json(200, { estado: d.estado ?? 'error', frase: FRASES[String(d.estado)] ?? 'No se ha podido leer el recibo.' })
  if (!d.puede) return json(200, { estado: 'sin_permiso', frase: 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.' })
  const o = (d.devueltos ?? []).find((x) => x.recibo_id === recibo)
  if (!o) return json(200, { estado: 'no_se_pudo', frase: 'Ese recibo no es de este cliente o ya no está devuelto.' })
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/conta-cobro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${servicio}`, ...(origen ? { origin: origen } : {}) },
    body: JSON.stringify({ accion: que === 'enlace' ? 'enlace_para_pagar' : 'pasar_de_nuevo', empresa: o.empresa_id, recibo, usuario: d.usuario }),
  })
  const c = (await r.json().catch(() => ({}))) as { ok?: boolean; frase?: string; error?: string }
  if (!c.ok) return json(200, { estado: 'no_se_pudo', frase: c.error ?? 'No se ha podido hacer ahora. Prueba en unos minutos.' })
  const { data: h } = await db.rpc('conta_bitrix_pestana_devuelto_hecho', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id,
    p_recibo: recibo, p_que: que, p_frase: c.frase ?? '' })
  const hecho = (h ?? {}) as Record<string, unknown>
  if (hecho.estado !== 'ok') return json(200, { estado: 'ok', frase: c.frase, bitrix: { hecho: 'nada', texto: 'Hecho en Sumied; no se ha podido apuntar para Bitrix24.' } })
  const mes = mesEnPalabras(hecho.mes) ?? 'ese mes'
  const nota = que === 'enlace' ? `Sumied · enviado el enlace para pagar el recibo de ${mes}` : `Sumied · el recibo de ${mes} se pasa de nuevo`
  const { enBitrix, pestana } = await despuesDelCambio(db, m, hecho, nota)
  const { data: dv2 } = await db.rpc('conta_bitrix_pestana_devueltos', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id })
  return json(200, { estado: 'ok', frase: c.frase, bitrix: enBitrix, pestana, devueltos: devueltosDe(dv2) })
}

const ACCIONES = new Set(['alta', 'baja', 'tarifa', 'solicitud'])
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

/**
 * GB (nº 9) · Un cambio desde la pestaña: lo hace Sumied (conta_bitrix_pestana_hacer,
 * con las funciones de la ficha del G04, como la persona) y DESPUÉS se
 * actualiza la ficha en Bitrix24 (la «Cuota mensual» y, desde el nº 13,
 * «Trabajadores» y «Estado del cobro»), con el token de quien
 * mira (sus permisos de Bitrix24), sin pisar un dato cambiado allí.
 */
async function hacer(cuerpo: Record<string, unknown>): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const accion = typeof cuerpo.accion === 'string' && ACCIONES.has(cuerpo.accion) ? cuerpo.accion : null
  const datos = cuerpo.datos && typeof cuerpo.datos === 'object' && !Array.isArray(cuerpo.datos) ? cuerpo.datos as Record<string, unknown> : null
  if (!accion || !datos) return json(400, { estado: 'no_se_pudo', frase: 'No se sabe qué cambiar.' })

  const db = baseDeDatos()
  // nº 9, punto 5 · «Hacerla» (lo que pide el cliente en su portal): con la función de Code 3.
  const { data, error } = accion === 'solicitud'
    ? await db.rpc('conta_bitrix_pestana_portal', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id,
        p_solicitud: typeof datos.solicitud === 'string' ? datos.solicitud : null, p_servicio: typeof datos.servicio === 'string' ? datos.servicio : null })
    : await db.rpc('conta_bitrix_pestana_hacer', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id, p_accion: accion, p_datos: datos })
  if (error) return json(500, { estado: 'error', frase: 'No se ha podido guardar en Sumied. No ha cambiado nada.' })
  const r = (data ?? {}) as Record<string, unknown>
  if (r.estado !== 'ok') return json(200, { estado: r.estado ?? 'no_se_pudo', frase: typeof r.frase === 'string' ? r.frase : FRASES[String(r.estado)] ?? 'No se ha podido hacer.' })

  const inicio = Date.now()
  const { enBitrix, pestana } = await despuesDelCambio(db, m, r, notaDelCambio(accion, accion === 'solicitud' ? { ...datos, nombre: r.nombre, tipo: r.tipo } : datos, String(r.frase ?? '')))
  // nº 13 · «Deshacer»: si lo último de hoy con las líneas del cliente es justo este cambio (Code 1, #562).
  const deshacer = await loQueSePuedeDeshacer(db, m, r, OPERACION_DE[accion === 'solicitud' ? String(r.tipo ?? 'alta') : accion], inicio)
  return json(200, { estado: 'ok', frase: r.frase, cambio: r.cambio, id: r.id ?? null, bitrix: enBitrix, pestana, deshacer })
}

/** Qué operación de las líneas (conta_linea_operaciones_hoy) es cada acción de la pestaña; un precio especial no toca líneas. */
const OPERACION_DE: Record<string, string | undefined> = { alta: 'alta', baja: 'baja', tarifa: 'nivel' }

/** nº 13 · Lo último de hoy, si es este cambio y se puede deshacer; si no, null. */
async function loQueSePuedeDeshacer(db: ReturnType<typeof baseDeDatos>, m: Extract<Mira, { ok: true }>, r: Record<string, unknown>, tipo: string | undefined, inicio: number) {
  if (!tipo || !r.empresa) return null
  const { data } = await db.rpc('conta_bitrix_pestana_deshacer', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id, p_empresa: r.empresa, p_cuando: null })
  const d = (data ?? {}) as { estado?: string; operaciones?: { cuando: string; tipo: string; frase: string; puede: boolean }[] }
  const ultima = d.estado === 'ok' ? d.operaciones?.[0] : undefined
  if (!ultima || !ultima.puede || ultima.tipo !== tipo || Date.parse(ultima.cuando) < inicio - 60_000) return null
  return { cuando: ultima.cuando, frase: ultima.frase }
}

/** nº 13 · «Deshacer» desde la pestaña: lo deshace Sumied (con la función de Code 1, como la persona) y Bitrix24 se pone al día, igual que al guardar. */
async function deshacer(cuerpo: Record<string, unknown>): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const empresa = typeof cuerpo.empresa === 'string' ? cuerpo.empresa : null
  const cuando = typeof cuerpo.cuando === 'string' && !Number.isNaN(Date.parse(cuerpo.cuando)) ? cuerpo.cuando : null
  if (!empresa || !cuando) return json(400, { estado: 'no_se_pudo', frase: 'No se sabe qué deshacer.' })
  const db = baseDeDatos()
  const { data, error } = await db.rpc('conta_bitrix_pestana_deshacer', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id, p_empresa: empresa, p_cuando: cuando })
  if (error) return json(500, { estado: 'error', frase: 'No se ha podido deshacer en Sumied. No ha cambiado nada.' })
  const r = (data ?? {}) as Record<string, unknown>
  if (r.estado !== 'ok') return json(200, { estado: r.estado ?? 'no_se_pudo', frase: typeof r.frase === 'string' ? r.frase : FRASES[String(r.estado)] ?? 'No se ha podido deshacer.' })
  const { enBitrix, pestana } = await despuesDelCambio(db, m, r, notaDelCambio('deshacer', {}, String(r.frase ?? '')))
  return json(200, { estado: 'ok', frase: r.frase, cambio: r.cambio, bitrix: enBitrix, pestana })
}

/**
 * Después de un cambio en Sumied (hacer o deshacer): la ficha de Bitrix24 al
 * día (cuota, Trabajadores, Estado del cobro), la nota en el historial, los
 * choques a «Pendiente de revisar» y lo apuntado.
 */
async function despuesDelCambio(db: ReturnType<typeof baseDeDatos>, m: Extract<Mira, { ok: true }>, r: Record<string, unknown>, nota: string) {
  // Lo de Sumied, otra vez (con el cambio): para la pestaña y para la cuota del mes que viene.
  const l = await lectura(db, m)
  const pestana = l.ok ? l.d : null
  const b = (r.bitrix ?? {}) as { campo?: string | null; conocida?: string | null; escrita?: string | null }
  let enBitrix: Record<string, unknown>
  if (m.tipo !== 'empresa') {
    enBitrix = { hecho: 'nada', texto: 'En la ficha de un contacto no se tocan los campos de la empresa.' }
  } else if (!pestana) {
    enBitrix = { hecho: 'nada', texto: 'No se ha podido leer el recibo nuevo: Bitrix24 no se ha tocado.' }
  } else {
    const mes = mesSiguiente(hoyEnMadrid())
    // nº 13 · Los campos que rellena Sumied (Trabajadores, Estado del cobro): cuáles son en el mapa y lo último escrito.
    const { data: campos } = await db.rpc('conta_bitrix_pestana_campos', { p_cambio: r.cambio })
    enBitrix = await fichaEnBitrix(m, b, (campos ?? {}) as Campos, {
      cuotaCent: totalDelRecibo(pestana.clientes, String(r.cliente), String(r.empresa), mes),
      trabajadores: trabajadoresDelRecibo(pestana.clientes, String(r.cliente), String(r.empresa), mes),
      estado: estadoDelCobro(pestana.ficha, String(r.empresa)),
    })
  }
  // nº 13, punto 3 · Una nota corta en el historial de la ficha de Bitrix24 (empresa o contacto), con el token de quien mira.
  enBitrix.nota = await notaEnLaFicha(m, nota)
  if ((enBitrix.nota as { hecho?: string }).hecho === 'escrita') enBitrix.texto = `${enBitrix.texto} · Nota en el historial de la ficha.`

  // nº 13, punto 2 · Un choque con Bitrix24 (un dato cambiado allí, que no se pisa) va a «Pendiente de revisar» del cliente.
  const { choques, escritos } = choquesDe(enBitrix)
  if ((choques.length || escritos.length) && r.empresa) {
    const { data: pend } = await db.rpc('conta_bitrix_pestana_choque', { p_cambio: r.cambio, p_empresa: r.empresa, p_choques: choques, p_escritos: escritos })
    const p = (pend ?? {}) as { apuntadas?: number; porque?: string }
    if (choques.length && !p.apuntadas) enBitrix.texto = `${enBitrix.texto} (No se ha podido llevar a «Pendiente de revisar»${p.porque ? `: ${p.porque}` : ''}.)`
  }
  await db.rpc('conta_bitrix_pestana_bitrix', { p_cambio: r.cambio, p_resultado: enBitrix })
  return { enBitrix, pestana }
}

/** nº 13, punto 3 · La nota en el historial de la ficha (crm.timeline.comment.add): si Bitrix24 no la deja, se dice y no pasa nada más. */
async function notaEnLaFicha(m: Extract<Mira, { ok: true }>, texto: string): Promise<{ hecho: 'escrita' | 'no'; texto: string; id?: unknown; porque?: string }> {
  try {
    const r = await bitrix(m.portal, 'crm.timeline.comment.add', m.auth, {
      fields: { ENTITY_ID: Number(m.id), ENTITY_TYPE: m.tipo === 'empresa' ? 'company' : 'contact', COMMENT: texto },
    }) as { result?: unknown; error?: string } | null
    return r?.result ? { hecho: 'escrita', texto, id: r.result } : { hecho: 'no', texto, porque: String(r?.error ?? 'sin respuesta').slice(0, 40) }
  } catch (e) {
    return { hecho: 'no', texto, porque: e instanceof Error ? e.name : 'error' }
  }
}

type Campos = Record<string, { campo?: string | null; escrita?: string | null }>
const NOMBRE_DEL_CAMPO: Record<string, string> = { trabajadores: 'Trabajadores', estado_cobro: 'Estado del cobro' }

/**
 * La ficha de la empresa en Bitrix24 después de un cambio: la «Cuota mensual»
 * (nº 9) y, desde el nº 13, «Trabajadores» y «Estado del cobro». Una lectura
 * (crm.company.get) y una escritura (crm.company.update) con los que tocan.
 * Cada campo se decide solo: nunca se pisa un dato cambiado en Bitrix24.
 */
async function fichaEnBitrix(m: Extract<Mira, { ok: true }>, b: { campo?: string | null; conocida?: string | null; escrita?: string | null },
  campos: Campos, nuevo: { cuotaCent: number; trabajadores: number | null; estado: string }): Promise<Record<string, unknown>> {
  try {
    const codigos = [b.campo, ...Object.values(campos).map((c) => c.campo)].filter((x): x is string => !!x)
    if (!codigos.length) return { hecho: 'nada', texto: 'Bitrix24 no se ha tocado: el mapa de Bitrix24 no tiene la «Cuota mensual» ni los campos de Sumied.' }
    const ficha = await bitrix(m.portal, 'crm.company.get', m.auth, { id: m.id }) as { result?: Record<string, unknown>; error?: string } | null
    if (!ficha?.result) return { hecho: 'nada', campo: b.campo ?? null, texto: `Bitrix24 no ha dejado leer la ficha${ficha?.error ? ` (${String(ficha.error).slice(0, 40)})` : ''}: no se ha tocado.` }
    const actual = ficha.result
    const escribir: Record<string, string> = {}
    const escritos: string[] = []
    const choques: string[] = []
    const out: Record<string, unknown> = { campo: b.campo ?? null, campos: {} as Record<string, unknown> }

    const q = queHacerConLaCuota({ campo: b.campo ?? null, actual: actual[b.campo ?? ''], conocida: b.conocida ?? null, escrita: b.escrita ?? null, nuevoCent: nuevo.cuotaCent })
    if (q.hacer === 'escribir') { escribir[b.campo!] = q.valor; out.escrito = q.valor; escritos.push(`Cuota del mes ${q.valor} €`) }
    if (q.hacer === 'choque') {
      Object.assign(out, { en_bitrix: q.enBitrix, sumied: q.sumied })
      choques.push(`En Bitrix24 alguien ha cambiado la cuota a ${q.enBitrix}: no se ha pisado. Sumied dice ${q.sumied}; queda en «Pendiente de revisar».`)
    }
    const valores: Record<string, string | null> = { trabajadores: nuevo.trabajadores === null ? null : String(nuevo.trabajadores), estado_cobro: nuevo.estado }
    for (const [clave, c] of Object.entries(campos)) {
      const valor = valores[clave]
      if (!c.campo || valor === null || valor === undefined) continue
      const t = queHacerConElTexto({ campo: c.campo, actual: actual[c.campo], escrita: c.escrita ?? null, nuevo: valor })
      const nombre = NOMBRE_DEL_CAMPO[clave] ?? clave
      if (t.hacer === 'escribir') {
        escribir[c.campo] = t.valor
        ;(out.campos as Record<string, unknown>)[clave] = { hecho: 'escrito', campo: c.campo, escrito: t.valor }
        escritos.push(`${nombre} ${t.valor}`)
      } else if (t.hacer === 'choque') {
        ;(out.campos as Record<string, unknown>)[clave] = { hecho: 'choque', campo: c.campo, en_bitrix: t.enBitrix, sumied: t.sumied }
        choques.push(`En Bitrix24 alguien ha cambiado «${nombre}» a «${t.enBitrix}»: no se ha pisado. Sumied dice «${t.sumied}»; queda en «Pendiente de revisar».`)
      }
    }
    if (Object.keys(escribir).length) {
      const u = await bitrix(m.portal, 'crm.company.update', m.auth, { id: m.id, fields: escribir }) as { result?: unknown; error?: string } | null
      if (!u?.result) {
        return { hecho: choques.length ? 'choque' : 'nada', campo: b.campo ?? null,
          texto: [`Bitrix24 no ha dejado guardar${u?.error ? ` (${String(u.error).slice(0, 40)})` : ''}.`, ...choques].join(' ') }
      }
    }
    const hecho = choques.length ? 'choque' : escritos.length ? 'escrito' : 'nada'
    const texto = [escritos.join(' · '), ...choques].filter(Boolean).join(' ') || `Bitrix24 no se ha tocado: ${q.hacer === 'nada' ? q.porque : 'ya lo tiene'}.`
    return { ...out, hecho, texto }
  } catch (e) {
    return { hecho: 'nada', texto: `Bitrix24 no contesta (${e instanceof Error ? e.name : 'error'}): no se ha tocado.` }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { estado: 'error', frase: 'Solo POST.' })
  const url = new URL(req.url)
  const paso = url.searchParams.get('paso')
  try {
    if (paso === 'pestana' || paso === 'instalar') {
      const l = leerLlegada(await formulario(req), url.searchParams)
      if (paso === 'instalar') {
        if (l.auth && l.portal && portalPermitido(l.portal)) {
          const aqui = `${Deno.env.get('SUPABASE_URL')}/functions/v1/conta-bitrix-pestana`
          const fallos = await engancharPestana(l.portal, l.auth, aqui)
          if (fallos.length) return irA(`${PAGINA}#instalar=fallo&que=${encodeURIComponent(fallos.join(' · '))}`)
        }
        return irA(direccionDeLaPagina(PAGINA, { ...l, tipo: null, id: null }, true))
      }
      return irA(direccionDeLaPagina(PAGINA, l))
    }
    const cuerpo = await req.json().catch(() => null) as Record<string, unknown> | null
    if (cuerpo?.paso === 'leer') return await leer(cuerpo)
    if (cuerpo?.paso === 'hacer' && cuerpo.accion === 'devuelto') return await devuelto(cuerpo, req.headers.get('origin'))
    if (cuerpo?.paso === 'hacer') return await hacer(cuerpo)
    if (cuerpo?.paso === 'portal') return await portal(cuerpo)
    if (cuerpo?.paso === 'deshacer') return await deshacer(cuerpo)
    return json(400, { estado: 'error', frase: 'No se sabe qué hacer.' })
  } catch (e) {
    console.error('conta-bitrix-pestana', e instanceof Error ? e.message : e)
    return json(500, { estado: 'error', frase: 'No se ha podido abrir la pestaña. Vuelve a intentarlo en un momento.' })
  }
})
