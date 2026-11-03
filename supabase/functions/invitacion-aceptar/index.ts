// supabase/functions/invitacion-aceptar/index.ts
//
// DM1 · Accesos 1 (03/11/2026). El enlace del correo de «Invitar a una
// persona» lleva a /welcome?invitacion=<token>. Esta función es lo que esa
// página necesita, SIN sesión (quien llega aún puede no tener usuario):
//
//   · «ver»    { token }                 qué empresas, con qué permiso, quién
//       invita y si ese correo ya tiene usuario. Nada más.
//   · «crear»  { token, contrasena, acepto }  solo si el correo NO tiene usuario:
//       lo crea con su contraseña (el enlace demuestra que el correo es suyo:
//       llega a su buzón) y le da las empresas de la invitación. Después la
//       página entra con ese correo y esa contraseña.
//
// Quien YA tiene usuario no acepta aquí: entra con el suyo y acepta en el
// selector de empresa (invitacion_aceptar, con su sesión: solo SUS
// invitaciones). Así un enlace reenviado a otra persona no le da nada a nadie.
//
// verify_jwt = false (config.toml). Su frontera es el token: 32 bytes al azar,
// la base guarda solo su huella; pendiente y sin caducar (7 días).
// En el registro: la acción y cómo acabó. Nunca el token, el correo ni el enlace (T11).

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const CONTRASENA = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
const PERMISO: Record<string, string> = { admin: 'Todo', manager: 'Encargado' }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function huella(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

interface Fila { id: string; correo: string; empresa: string; rol: string; invita: string | null; tiene_usuario: boolean }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  try {
    let cuerpo: Record<string, unknown> | null = null
    try { cuerpo = await req.json() } catch { cuerpo = null }
    const token = String(cuerpo?.token ?? '')
    if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: 'Este enlace no es válido.' })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    const { data, error } = await admin.rpc('invitacion_por_token', { p_token_hash: await huella(token) })
    if (error) { console.error('[invitacion-aceptar] ver', error.code); return json(500, { error: 'No se ha podido leer la invitación.' }) }
    const filas = (data ?? []) as Fila[]
    if (filas.length === 0) {
      console.log('[invitacion-aceptar] enlace sin invitación pendiente')
      return json(410, { error: 'Esta invitación ya no vale: ha caducado, la han anulado o ya se aceptó. Pide a quien te invitó que te la reenvíe.' })
    }
    const correo = filas[0].correo
    const tieneUsuario = filas[0].tiene_usuario
    const empresas = filas.map((f) => ({ nombre: f.empresa, permiso: PERMISO[f.rol] ?? f.rol }))

    if (cuerpo?.accion !== 'crear') {
      return json(200, { correo, invita: filas[0].invita, empresas, tieneUsuario })
    }

    if (tieneUsuario) return json(409, { error: 'Ya tienes usuario con este correo: entra con él y acepta la invitación en tu lista de empresas.' })
    const contrasena = String(cuerpo?.contrasena ?? '')
    if (!CONTRASENA.test(contrasena)) return json(400, { error: 'La contraseña necesita 8 caracteres como mínimo, con una minúscula, una mayúscula y un número.' })
    if (cuerpo?.acepto !== true) return json(400, { error: 'Acepta los Términos y Condiciones y la Política de Privacidad para entrar.' })

    const { data: nuevo, error: nuevoErr } = await admin.auth.admin.createUser({ email: correo, password: contrasena, email_confirm: true })
    if (nuevoErr || !nuevo.user) {
      console.error('[invitacion-aceptar] usuario no creado', nuevoErr?.status ?? '')
      return json(409, { error: 'No se ha podido crear tu usuario. Vuelve a intentarlo o pide que te reenvíen la invitación.' })
    }
    const { data: dadas, error: darErr } = await admin.rpc('_invitacion_dar_acceso', { p_ids: filas.map((f) => f.id), p_user_id: nuevo.user.id })
    if (darErr) {
      await admin.auth.admin.deleteUser(nuevo.user.id)
      console.error('[invitacion-aceptar] acceso no dado', darErr.code)
      return json(500, { error: 'No se ha podido darte acceso. Vuelve a intentarlo.' })
    }
    // Ha puesto su contraseña y aceptado los términos aquí: su bienvenida está hecha
    // (como en /welcome); si no, la aplicación le volvería a pedir la contraseña.
    const ahora = new Date().toISOString()
    const { error: bienvErr } = await admin.from('user_profiles')
      .update({ terms_accepted_at: ahora, welcome_completed_at: ahora, last_password_change_at: ahora })
      .eq('user_id', nuevo.user.id)
    if (bienvErr) console.error('[invitacion-aceptar] bienvenida no apuntada', bienvErr.code)
    console.log(`[invitacion-aceptar] usuario creado · ${(dadas as string[] | null)?.length ?? 0} empresa(s)`)
    return json(200, { status: 'ok', correo, empresas: dadas })
  } catch (e) {
    console.error('[invitacion-aceptar]', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'Error interno.' })
  }
})
