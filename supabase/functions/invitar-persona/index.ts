// supabase/functions/invitar-persona/index.ts
//
// DM1 · Accesos 1 (03/11/2026; era el PR 1 del 30/10). Ajustes › Usuarios ›
// «Invitar a una persona» (tablero 4) y «Reenviar» (tablero 5). Con sesión.
//
// Desde el 03/11 la invitación SE ACEPTA (decisión de Julio): ya no da el
// acceso en el acto. Crea una invitación por empresa (invitacion_crear) y le
// manda a la persona un correo con un enlace a /welcome?invitacion=…:
//   · si no tiene usuario, ahí pone su contraseña (invitacion-aceptar);
//   · si ya lo tiene, entra y acepta en el selector de empresa.
// Hasta entonces sale en «Pendientes», con reenviar y anular.
//
//   · «invitar»   { correo, cuentas: [{ account_id, rol }], marca }
//   · «reenviar»  { id, marca }  otro enlace y otros 7 días
//
// Quien invita o reenvía tiene que ser administrador activo de CADA empresa
// (lo mira la base: invitacion_crear / invitacion_reenviar). El token del
// enlace son 32 bytes al azar; la base guarda solo su huella (sha256). Fuera de
// producción, el enlace va en la respuesta para poder probar la entrada; en
// producción, nunca. Dice lo que ha pasado, con contenido (regla 8).
//
// En el registro: la acción y cómo acabó. Nunca el correo ni el enlace (T11).

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { MARCAS, enlaceDeMarca } from '../_shared/marcas.ts'
import { fraseDelEnvio, leerInvitacion, leerReenvio, NOMBRE_PERMISO } from './pedido.ts'

const PRODUCCION = 'xzmpnchlguibclvxyynt'
const DIAS_ENLACE = 7

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function tokenAlAzar(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

async function huella(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Hay que entrar para invitar.' })
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: quien, error: quienErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (quienErr || !quien.user) return json(401, { error: 'Sesión no válida.' })

    let cuerpo: Record<string, unknown> | null = null
    try { cuerpo = await req.json() } catch { cuerpo = null }
    const esProduccion = supabaseUrl.includes(PRODUCCION)
    const origen = esProduccion ? null : (req.headers.get('origin') ?? null)

    // El nombre de quien invita, como lo verá la persona en el correo.
    const { data: perfil } = await admin.from('user_profiles').select('display_name')
      .eq('user_id', quien.user.id).not('display_name', 'is', null).limit(1).maybeSingle()
    const invita = (perfil as { display_name: string | null } | null)?.display_name?.trim()
      || (quien.user.email ?? '').split('@')[0]

    const token = tokenAlAzar()
    const hash = await huella(token)
    let correo: string
    let marcaId: 'folvy' | 'sumied'
    let empresas: { nombre: string; permiso: string }[]

    if (cuerpo?.accion === 'reenviar') {
      const leido = leerReenvio(cuerpo)
      if (!leido.ok) return json(400, { error: leido.error })
      const { data, error } = await admin.rpc('invitacion_reenviar', { p_id: leido.pedido.id, p_token_hash: hash, p_invita: quien.user.id })
      if (error) return json(403, { error: error.message })
      const fila = (data as { correo: string; empresa: string; rol: string }[] | null)?.[0]
      if (!fila) return json(404, { error: 'Esa invitación ya no está pendiente.' })
      correo = fila.correo
      marcaId = leido.pedido.marca
      empresas = [{ nombre: fila.empresa, permiso: NOMBRE_PERMISO[fila.rol as 'admin' | 'manager'] ?? fila.rol }]
    } else {
      const leido = leerInvitacion(cuerpo)
      if (!leido.ok) return json(400, { error: leido.error })
      const p = leido.pedido
      const { error } = await admin.rpc('invitacion_crear', {
        p_correo: p.correo,
        p_cuentas: p.cuentas.map((c) => ({ account_id: c.accountId, rol: c.rol })),
        p_token_hash: hash, p_invita: quien.user.id, p_invita_nombre: invita,
      })
      if (error) return json(403, { error: error.message })
      const { data: cuentas } = await admin.from('accounts').select('id, name').in('id', p.cuentas.map((c) => c.accountId))
      const nombre = new Map((cuentas ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))
      correo = p.correo
      marcaId = p.marca
      empresas = p.cuentas.map((c) => ({ nombre: nombre.get(c.accountId) ?? 'una empresa', permiso: NOMBRE_PERMISO[c.rol] }))
    }

    // El correo, con la marca de donde se invita.
    const marca = MARCAS[marcaId]
    const enlace = enlaceDeMarca(marca, '/welcome', { invitacion: token }, origen)
    let enviada = false
    let motivo: string | null = null
    if (!enlace) {
      motivo = 'la marca no tiene dirección para el enlace'
    } else {
      const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader, 'x-internal-key': serviceKey },
        body: JSON.stringify({
          to: correo, template: 'invitacion_persona', marca: marca.id,
          data: { invita, empresas, enlace, diasCaducidad: DIAS_ENLACE },
        }),
      })
      if (r.ok) enviada = true
      else motivo = r.status === 423 ? 'los correos de invitación están cerrados' : `el envío respondió ${r.status}`
    }
    console.log(`[invitar-persona] ${cuerpo?.accion === 'reenviar' ? 'reenviada' : 'creada'} · ${empresas.length} empresa(s) · enviada=${enviada}`)
    return json(200, {
      status: 'ok', enviada, motivo,
      frase: fraseDelEnvio(correo, empresas, enviada, motivo, cuerpo?.accion === 'reenviar'),
      enlace: esProduccion ? null : enlace,
    })
  } catch (e) {
    console.error('[invitar-persona]', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'Error interno.' })
  }
})
