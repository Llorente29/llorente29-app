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
import { mesSiguiente, queHacerConLaCuota, totalDelRecibo } from './escribir.ts'

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

const ACCIONES = new Set(['alta', 'baja', 'tarifa'])
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

/**
 * GB (nº 9) · Un cambio desde la pestaña: lo hace Sumied (conta_bitrix_pestana_hacer,
 * con las funciones de la ficha del G04, como la persona) y DESPUÉS se
 * actualiza la «Cuota mensual» de la ficha en Bitrix24, con el token de quien
 * mira (sus permisos de Bitrix24), sin pisar un dato cambiado allí.
 */
async function hacer(cuerpo: Record<string, unknown>): Promise<Response> {
  const m = await quienMira(cuerpo)
  if (!m.ok) return m.respuesta
  const accion = typeof cuerpo.accion === 'string' && ACCIONES.has(cuerpo.accion) ? cuerpo.accion : null
  const datos = cuerpo.datos && typeof cuerpo.datos === 'object' && !Array.isArray(cuerpo.datos) ? cuerpo.datos as Record<string, unknown> : null
  if (!accion || !datos) return json(400, { estado: 'no_se_pudo', frase: 'No se sabe qué cambiar.' })

  const db = baseDeDatos()
  const { data, error } = await db.rpc('conta_bitrix_pestana_hacer', { p_portal: m.portal, p_correo: m.correo, p_tipo: m.tipo, p_id: m.id, p_accion: accion, p_datos: datos })
  if (error) return json(500, { estado: 'error', frase: 'No se ha podido guardar en Sumied. No ha cambiado nada.' })
  const r = (data ?? {}) as Record<string, unknown>
  if (r.estado !== 'ok') return json(200, { estado: r.estado ?? 'no_se_pudo', frase: typeof r.frase === 'string' ? r.frase : FRASES[String(r.estado)] ?? 'No se ha podido hacer.' })

  // Lo de Sumied, otra vez (con el cambio): para la pestaña y para la cuota del mes que viene.
  const l = await lectura(db, m)
  const pestana = l.ok ? l.d : null
  const b = (r.bitrix ?? {}) as { campo?: string | null; conocida?: string | null; escrita?: string | null }
  let enBitrix: Record<string, unknown>
  if (m.tipo !== 'empresa') {
    enBitrix = { hecho: 'nada', texto: 'En la ficha de un contacto, Bitrix24 no se toca.' }
  } else if (!pestana) {
    enBitrix = { hecho: 'nada', texto: 'No se ha podido leer el recibo nuevo: Bitrix24 no se ha tocado.' }
  } else {
    const nuevoCent = totalDelRecibo(pestana.clientes, String(r.cliente), String(r.empresa), mesSiguiente(hoyEnMadrid()))
    enBitrix = await cuotaEnLaFicha(m, b, nuevoCent)
  }
  await db.rpc('conta_bitrix_pestana_bitrix', { p_cambio: r.cambio, p_resultado: enBitrix })
  return json(200, { estado: 'ok', frase: r.frase, cambio: r.cambio, id: r.id ?? null, bitrix: enBitrix, pestana })
}

/** La «Cuota mensual» de la ficha de la empresa en Bitrix24: se escribe solo si nadie la ha cambiado allí. */
async function cuotaEnLaFicha(m: Extract<Mira, { ok: true }>, b: { campo?: string | null; conocida?: string | null; escrita?: string | null }, nuevoCent: number): Promise<Record<string, unknown>> {
  try {
    const campo = b.campo ?? null
    const ficha = campo ? (await bitrix(m.portal, 'crm.company.get', m.auth, { id: m.id }) as { result?: Record<string, unknown>; error?: string } | null) : null
    if (campo && !ficha?.result) return { hecho: 'nada', campo, texto: `Bitrix24 no ha dejado leer la ficha${ficha?.error ? ` (${String(ficha.error).slice(0, 40)})` : ''}: no se ha tocado.` }
    const q = queHacerConLaCuota({ campo, actual: ficha?.result?.[campo ?? ''], conocida: b.conocida ?? null, escrita: b.escrita ?? null, nuevoCent })
    if (q.hacer === 'nada') return { hecho: 'nada', campo, texto: `Bitrix24 no se ha tocado: ${q.porque}.` }
    if (q.hacer === 'choque') {
      return { hecho: 'choque', campo, en_bitrix: q.enBitrix, sumied: q.sumied,
        texto: `En Bitrix24 alguien ha cambiado la cuota a ${q.enBitrix}: no se ha pisado. Sumied dice ${q.sumied}; queda en «Pendiente de revisar».` }
    }
    const u = await bitrix(m.portal, 'crm.company.update', m.auth, { id: m.id, fields: { [campo!]: q.valor } }) as { result?: unknown; error?: string } | null
    if (!u?.result) return { hecho: 'nada', campo, texto: `Bitrix24 no ha dejado guardar la cuota${u?.error ? ` (${String(u.error).slice(0, 40)})` : ''}.` }
    return { hecho: 'escrito', campo, escrito: q.valor, texto: `Cuota del mes ${q.valor} €` }
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
    if (cuerpo?.paso === 'hacer') return await hacer(cuerpo)
    return json(400, { estado: 'error', frase: 'No se sabe qué hacer.' })
  } catch (e) {
    console.error('conta-bitrix-pestana', e instanceof Error ? e.message : e)
    return json(500, { estado: 'error', frase: 'No se ha podido abrir la pestaña. Vuelve a intentarlo en un momento.' })
  }
})
