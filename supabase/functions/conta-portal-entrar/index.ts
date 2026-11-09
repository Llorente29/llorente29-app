// supabase/functions/conta-portal-entrar/index.ts
//
// GP · Tarea 2b (Code 3, 09/11/2026) · ENTRAR EN EL PORTAL DEL CLIENTE con un
// enlace que llega por correo, sin contraseña. La llama la entrada del portal
// (portal.html) cuando la persona escribe su correo. Sin sesión
// (verify_jwt = false): todavía no la tiene.
//
//   · Contesta SIEMPRE lo mismo (FRASE_ENTRAR), tenga o no acceso ese correo:
//     no se puede averiguar quién es cliente de quién.
//   · Si el correo tiene acceso a algún cliente (conta_portal_acceso, sin
//     quitar), el servidor prepara su usuario (el que hay o uno nuevo), lo
//     apunta en cada acceso de ese correo y le manda el enlace con la marca de
//     su gestoría. Con más de un cliente, el enlace es el mismo: dentro elige.
//   · Como mucho ENLACES_POR_HORA enlaces por correo y hora (los cuenta
//     conta_portal_aviso): más, y no sale nada (y se contesta lo mismo).
//   · En una demo, al buzón de pruebas; cerrado por CORREO_MARCA_ABIERTOS
//     («portal_enlace»). Fuera de producción, el enlace va en la respuesta.
//
// Contesta 200 con { ok: true, frase } (y { enlace } fuera de producción).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { correoValido } from '../_shared/facturaVentaCorreo.ts'
import { ENLACES_POR_HORA, FRASE_ENTRAR, PLANTILLA_ENLACE, correoEnlace } from '../_shared/portal/portal.ts'
import { PRODUCCION, enlaceParaEntrar, mandar, marcaDe } from '../_shared/portal/enviar.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'usa POST' })
  let correo: string | null = null
  let origen: unknown = null
  try {
    const b = await req.json() as { correo?: unknown; origen?: unknown }
    correo = correoValido(b.correo)
    origen = b.origen ?? req.headers.get('origin')
  } catch { /* vacío */ }
  if (!correo) return json(400, { ok: false, frase: 'Escribe tu correo.' })
  const fuera = !URL_BASE.includes(PRODUCCION)

  try {
    const srv = createClient(URL_BASE, SERVICIO, { auth: { persistSession: false } })
    const { data: accesos } = await srv.from('conta_portal_acceso').select('id, account_id, party_id, user_id')
      .ilike('correo', correo).is('revocado_at', null).order('invitado_at')
    const lista = (accesos ?? []) as { id: string; account_id: string; party_id: string; user_id: string | null }[]
    if (!lista.length) { console.log('[conta-portal-entrar] sin acceso'); return json(200, { ok: true, frase: FRASE_ENTRAR }) }

    // Como mucho ENLACES_POR_HORA por correo y hora.
    const hace = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await srv.from('conta_portal_aviso').select('id', { count: 'exact', head: true })
      .in('tipo', ['enlace', 'invitacion']).ilike('para', correo).gte('created_at', hace)
    if ((count ?? 0) >= ENLACES_POR_HORA) { console.log('[conta-portal-entrar] demasiados'); return json(200, { ok: true, frase: FRASE_ENTRAR }) }

    const e = await enlaceParaEntrar(srv, correo, origen, URL_BASE)
    if ('porque' in e) { console.error('[conta-portal-entrar]', e.porque); return json(200, { ok: true, frase: FRASE_ENTRAR }) }
    for (const a of lista) if (a.user_id !== e.usuario) await srv.rpc('conta_portal_acceso_usuario', { p_acceso: a.id, p_user: e.usuario })

    const primero = lista[0]
    const marca = await marcaDe(srv, primero.account_id, primero.party_id)
    const { data: cli } = await srv.from('party').select('name').eq('id', primero.party_id).maybeSingle()
    const r = await mandar(srv, {
      cuenta: primero.account_id, cliente: primero.party_id, para: correo, plantilla: PLANTILLA_ENLACE, marca,
      correo: correoEnlace({ ...marca, cliente: String(cli?.name ?? 'tu empresa'), enlace: e.enlace, invitacion: false }),
      aviso: { tipo: 'enlace', clave: `enlace:${primero.id}:${Date.now()}` },
    })
    console.log(`[conta-portal-entrar] ${r.enviado ? 'enviado' : 'no enviado'} demo=${r.demo}`)
    return json(200, { ok: true, frase: FRASE_ENTRAR, ...(fuera ? { enlace: e.enlace, envio: r } : {}) })
  } catch (x) {
    console.error('[conta-portal-entrar]', x instanceof Error ? x.message : String(x))
    return json(200, { ok: true, frase: FRASE_ENTRAR })
  }
})
