// supabase/functions/invitar-persona/index.ts
//
// DM1 · PR 1 (30/10/2026). Ajustes › Usuarios › Invitar (tablero 4 de «Sumied ·
// DM1 · Demos y varias empresas»): un correo y, por cada empresa de quien
// invita, el permiso. Con sesión.
//
//   1. Quien invita tiene que ser administrador activo de CADA empresa que
//      nombra (se mira en user_profiles con el servidor: no basta con la
//      empresa abierta).
//   2. Si el correo ya tiene usuario, se le añaden las empresas (una fila de
//      user_profiles por cada una): no se crea otro. Si ya entraba en alguna,
//      no se cambia nada ahí.
//   3. Si no tiene, se crea con una contraseña al azar que nadie conoce, y le
//      llega el correo para poner la suya (/welcome, como el alta de cuenta),
//      con la marca de quien invita (send-email, plantilla invitacion_conta).
//      Si ya tenía usuario pero nunca terminó la bienvenida, se le vuelve a
//      mandar el enlace.
//   4. Dice lo que ha pasado, con contenido (regla 8). Fuera de producción, el
//      enlace va en la respuesta para poder probar la entrada; en producción,
//      nunca.
//
// En el registro: la acción y cómo acabó. Nunca el correo ni el enlace (T11).

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { MARCAS, enlaceDeMarca } from '../_shared/marcas.ts'
import { fraseDelResultado, leerInvitacion } from './pedido.ts'

const PRODUCCION = 'xzmpnchlguibclvxyynt'
const DIAS_ENLACE = 7

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function contrasenaAlAzar(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)) + 'aA1!'
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
    const leido = leerInvitacion(cuerpo)
    if (!leido.ok) return json(400, { error: leido.error })
    const p = leido.pedido

    // 1. Administrador activo de cada empresa nombrada.
    const ids = p.cuentas.map((c) => c.accountId)
    const { data: mias, error: miasErr } = await admin.from('user_profiles').select('account_id')
      .eq('user_id', quien.user.id).eq('role', 'admin').eq('active', true).in('account_id', ids)
    if (miasErr) return json(500, { error: 'No se ha podido comprobar tu permiso.' })
    const puedo = new Set((mias ?? []).map((m: { account_id: string }) => m.account_id))
    if (ids.some((id) => !puedo.has(id))) return json(403, { error: 'Solo puedes invitar a las empresas de las que eres administrador.' })
    const { data: cuentas } = await admin.from('accounts').select('id, name').in('id', ids)
    const nombre = new Map((cuentas ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))

    // 2 y 3. El usuario: el que ya hay o uno nuevo.
    const { data: existente } = await admin.rpc('_usuario_por_correo', { p_correo: p.correo })
    let usuario = (existente as string | null) ?? null
    let creado = false
    if (!usuario) {
      const { data: nuevo, error: nuevoErr } = await admin.auth.admin.createUser({ email: p.correo, password: contrasenaAlAzar(), email_confirm: true })
      if (nuevoErr || !nuevo.user) return json(409, { error: `No se ha podido crear el usuario: ${nuevoErr?.message ?? 'sin detalle'}` })
      usuario = nuevo.user.id
      creado = true
    }
    const { data: perfiles } = await admin.from('user_profiles').select('account_id, active, welcome_completed_at, terms_accepted_at').eq('user_id', usuario)
    const previos = (perfiles ?? []) as { account_id: string; active: boolean; welcome_completed_at: string | null; terms_accepted_at: string | null }[]
    const bienvenida = previos.find((x) => x.welcome_completed_at) ?? null
    const anadidas: string[] = []
    const yaEstaba: string[] = []
    for (const c of p.cuentas) {
      const previo = previos.find((x) => x.account_id === c.accountId)
      if (previo?.active) { yaEstaba.push(nombre.get(c.accountId) ?? 'una empresa'); continue }
      const fila = {
        role: c.rol, active: true, updated_at: new Date().toISOString(),
        // Quien ya terminó su bienvenida en otra empresa no la repite aquí.
        welcome_completed_at: bienvenida?.welcome_completed_at ?? null,
        terms_accepted_at: bienvenida?.terms_accepted_at ?? null,
      }
      const r = previo
        ? await admin.from('user_profiles').update(fila).eq('user_id', usuario).eq('account_id', c.accountId)
        : await admin.from('user_profiles').insert({ ...fila, user_id: usuario, account_id: c.accountId })
      if (r.error) {
        if (creado && anadidas.length === 0) await admin.auth.admin.deleteUser(usuario)
        console.error('[invitar-persona] perfil no guardado', r.error.code)
        return json(500, { error: `No se ha podido dar acceso a ${nombre.get(c.accountId) ?? 'una empresa'}.` })
      }
      anadidas.push(nombre.get(c.accountId) ?? 'una empresa')
    }

    // 3. El enlace, a quien nunca terminó la bienvenida.
    const pendiente = !bienvenida && anadidas.length > 0
    let enviada = false
    let motivo: string | null = null
    let enlace: string | null = null
    const esProduccion = supabaseUrl.includes(PRODUCCION)
    if (pendiente) {
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: p.correo })
      if (linkErr || !link?.properties?.hashed_token) {
        motivo = 'no se ha podido preparar el enlace'
      } else {
        const marca = MARCAS[p.marca]
        enlace = enlaceDeMarca(marca, '/welcome', { token_hash: link.properties.hashed_token, type: 'recovery' }, esProduccion ? null : (req.headers.get('origin') ?? null))
        if (!enlace) {
          motivo = 'la marca no tiene dirección para el enlace'
        } else {
          const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader, 'x-internal-key': serviceKey },
            body: JSON.stringify({
              to: p.correo, template: 'invitacion_conta', marca: marca.id,
              data: { nombre: '', empresa: anadidas.join(' y '), enlace, diasCaducidad: DIAS_ENLACE },
            }),
          })
          if (r.ok) enviada = true
          else motivo = r.status === 423 ? 'los correos de invitación están cerrados' : `el envío respondió ${r.status}`
        }
      }
    }
    const resultado = { nuevo: pendiente, anadidas, yaEstaba, enviada, motivo }
    console.log(`[invitar-persona] ${creado ? 'creado' : 'existente'} · ${anadidas.length} añadidas · ${yaEstaba.length} ya · enviada=${enviada}`)
    return json(200, { status: 'ok', ...resultado, frase: fraseDelResultado(p.correo, resultado), enlace: esProduccion ? null : enlace })
  } catch (e) {
    console.error('[invitar-persona]', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'Error interno.' })
  }
})
