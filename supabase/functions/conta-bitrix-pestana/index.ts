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
//
// Solo lee: no escribe en Sumied ni en Bitrix24 (salvo enganchar la pestaña al
// instalar). No guarda ningún token. Solo en los portales de puro.ts · PORTALES.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  direccionDeLaPagina, FRASES, HUECOS, leerLlegada, portalLimpio, portalPermitido, porqueApp, porqueUsuario, TITULO_PESTANA, usuarioDeBitrix,
  type TipoFicha,
} from './puro.ts'

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

async function leer(cuerpo: Record<string, unknown>): Promise<Response> {
  const auth = typeof cuerpo.a === 'string' && /^[A-Za-z0-9._-]{8,200}$/.test(cuerpo.a) ? cuerpo.a : null
  const portal = portalLimpio(cuerpo.p)
  const tipo = cuerpo.t === 'empresa' || cuerpo.t === 'contacto' ? (cuerpo.t as TipoFicha) : null
  const id = typeof cuerpo.id === 'string' && /^[0-9]{1,18}$/.test(cuerpo.id) ? cuerpo.id : null
  if (!tipo || !id) return json(200, { estado: 'ficha_rara', frase: FRASES.ficha_rara })
  if (!auth || !portal) return json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied })
  if (!portalPermitido(portal)) return json(200, { estado: 'portal_no_permitido', frase: FRASES.portal_no_permitido })

  // Quién mira, y con qué aplicación: las dos preguntas a la vez.
  let app: unknown, yo: unknown
  try {
    ;[app, yo] = await Promise.all([bitrix(portal, 'app.info', auth), bitrix(portal, 'user.current', auth)])
  } catch (e) {
    console.warn(JSON.stringify({ gb: 'no_es_sumied', porque: `Bitrix24 no contesta: ${e instanceof Error ? e.name : 'error'}` }))
    return json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied })
  }
  const usuario = usuarioDeBitrix(yo)
  const porque = [porqueApp(app, clientId()), porqueUsuario(yo)].filter(Boolean)
  if (porque.length || !usuario) {
    // Sin datos personales ni secretos (puro.ts): solo códigos y nombres de campo.
    console.warn(JSON.stringify({ gb: 'no_es_sumied', porque }))
    return json(200, { estado: 'no_es_sumied', frase: FRASES.no_es_sumied })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('conta_bitrix_pestana_leer', { p_portal: portal, p_correo: usuario.correo, p_tipo: tipo, p_id: id })
  if (error) return json(500, { estado: 'error', frase: 'No se ha podido leer Sumied. Vuelve a abrir la pestaña en un momento.' })
  const d = (data ?? {}) as Record<string, unknown>
  const estado = String(d.estado ?? 'error')
  if (estado !== 'ok') return json(200, { estado, frase: FRASES[estado] ?? 'No se puede enseñar nada.', cuenta_nombre: estado === 'sin_enlazar' ? d.cuenta_nombre ?? null : null })
  return json(200, { ...d, portal })
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
    return json(400, { estado: 'error', frase: 'No se sabe qué hacer.' })
  } catch (e) {
    console.error('conta-bitrix-pestana', e instanceof Error ? e.message : e)
    return json(500, { estado: 'error', frase: 'No se ha podido abrir la pestaña. Vuelve a intentarlo en un momento.' })
  }
})
