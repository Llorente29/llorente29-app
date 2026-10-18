// supabase/functions/conta-asesoria/index.ts
//
// I01b · P4b · «INVITAR A MI ASESORÍA» (decisión de Julio del 18/10: la
// invitación vincula; las cuentas nuevas las sigue dando de alta la plataforma).
//
//   · «invitar»  { empresa, correo, nombre, base }   con sesión: un administrador de la empresa.
//       Crea (o reenvía) la invitación con sus límites (conta_asesoria_invitar)
//       y manda el correo con la marca de la cuenta que invita. Si el correo no
//       sale, lo dice y devuelve el enlace para mandarlo a mano (regla 8).
//   · «ver»      { token }                            sin sesión: la página de aceptar.
//   · «aceptar»  { token }                            sin sesión: si ese correo ya es
//       administrador de UNA cuenta, vincula; si no, queda esperando el alta.
//   · «aprobar»  { invitacion, cuenta }               con sesión de la plataforma: después de
//       dar el alta con conta-crear-cuenta, vincula esa cuenta.
//
// verify_jwt = false (config.toml): «ver» y «aceptar» las pide quien aún no
// tiene sesión. Su frontera es el token (32 bytes al azar; la base guarda solo
// su huella) y que aceptar no da acceso a nada nuevo a quien acepta: vincula
// la cuenta de ESE correo, o espera a la plataforma. «invitar» y «aprobar»
// miran la sesión aquí dentro.
//
// En el registro: la acción y cómo acabó. Nunca el token, el correo ni el enlace.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { enlaceAceptar, huella, leerInvitar, marcaDeCuenta, tokenNuevo, tokenValido } from '../_shared/asesoria.ts'
import { basePruebas } from '../conta-crear-cuenta/pedido.ts'

const PRODUCCION = 'xzmpnchlguibclvxyynt'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { ok: false, mensaje: 'Esto solo se pide con POST.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, servicio, { auth: { persistSession: false } })
  const esProduccion = url.includes(PRODUCCION)

  let b: Record<string, unknown> | null = null
  try { b = await req.json() } catch { b = null }
  const accion = String(b?.accion ?? '')
  const fin = (r: Response, resultado: string) => { console.log(JSON.stringify({ asesoria: accion, resultado })); return r }

  try {
    // ── Sin sesión: ver y aceptar ────────────────────────────────────────────
    if (accion === 'ver' || accion === 'aceptar') {
      if (!tokenValido(b?.token)) return fin(json(400, { ok: false, mensaje: 'Ese enlace no está completo: ábrelo desde el correo.' }), 'token')
      const h = await huella(b!.token as string)
      if (accion === 'ver') {
        const { data, error } = await admin.rpc('conta_asesoria_ver', { p_token_hash: h })
        if (error) throw error
        const v = data as Record<string, unknown>
        if (v.estado === 'no_esta') return fin(json(404, { ok: false, mensaje: 'Esa invitación no existe: pide a la empresa que te mande otra.' }), 'no_esta')
        // El correo, a medias: quien abre el enlace ya lo sabe; quien lo encuentre, no entero.
        const correo = String(v.correo ?? '')
        return fin(json(200, { ok: true, ...v, correo: correo.replace(/^(.).*(@.*)$/, '$1…$2') }), 'ok')
      }
      const { data: v } = await admin.rpc('conta_asesoria_ver', { p_token_hash: h })
      const correo = String((v as Record<string, unknown> | null)?.correo ?? '')
      const { data: cuenta } = correo ? await admin.rpc('conta_asesoria_cuenta_de', { p_email: correo }) : { data: null }
      const { data, error } = await admin.rpc('conta_asesoria_aceptar', { p_token_hash: h, p_advisor_account: cuenta ?? null })
      if (error) return fin(json(422, { ok: false, mensaje: error.message }), 'no_vale')
      return fin(json(200, { ok: true, ...(data as Record<string, unknown>) }), String((data as Record<string, unknown>).estado))
    }

    // ── Con sesión ───────────────────────────────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: sesion } = await admin.auth.getUser(jwt)
    const usuario = sesion?.user?.id
    if (!usuario) return fin(json(401, { ok: false, mensaje: 'Tienes que entrar con tu usuario.' }), 'sin_sesion')

    if (accion === 'invitar') {
      const leido = leerInvitar(b)
      if (!leido.ok) return fin(json(400, { ok: false, mensaje: leido.mensaje }), 'pedido')
      const p = leido.p
      const token = tokenNuevo()
      const { data, error } = await admin.rpc('conta_asesoria_invitar', {
        p_user: usuario, p_company: p.empresa, p_email: p.correo, p_nombre: p.nombre, p_basis: p.base, p_token_hash: await huella(token),
      })
      if (error) return fin(json(error.code === '42501' ? 403 : 422, { ok: false, mensaje: error.message }), 'no_deja')
      const inv = data as { id: string; reenvio: boolean; expira: string; empresa: string; invita: string }
      const { data: emp } = await admin.from('company').select('account_id').eq('id', p.empresa).maybeSingle()
      const { data: cta } = await admin.from('accounts').select('product_brand').eq('id', emp?.account_id ?? '').maybeSingle()
      const marca = marcaDeCuenta(cta?.product_brand)
      const enlace = enlaceAceptar(marca, token, esProduccion, basePruebas(Deno.env.get('APP_BASE_URL_PRUEBAS'), req.headers.get('origin')))
      const caduca = inv.expira.slice(0, 10).split('-').reverse().slice(0, 2).join('/')
      let enviado = false
      let motivo: string | null = null
      if (!enlace) {
        motivo = 'no hay dirección para el enlace en este entorno'
      } else {
        const r = await fetch(`${url}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, 'x-internal-key': servicio },
          body: JSON.stringify({
            to: p.correo, template: 'invitacion_asesoria', marca: marca.id,
            data: { asesoria: p.nombre, empresa: inv.empresa, invita: inv.invita, base: p.base, enlace, caduca },
          }),
        })
        if (r.ok) enviado = true
        else motivo = (await r.text().catch(() => '')).slice(0, 300) || `el correo ha contestado ${r.status}`
      }
      const mensaje = enviado
        ? `${inv.reenvio ? 'Reenviada' : 'Enviada'} la invitación a ${p.correo}. Caduca el ${caduca}.`
        : `La invitación está creada, pero el correo NO ha salido (${motivo}). Mándale tú este enlace; caduca el ${caduca}.`
      // El enlace solo vuelve si el correo no ha salido (para mandarlo a mano) o fuera de producción.
      return fin(json(200, { ok: true, enviado, mensaje, enlace: !enviado || !esProduccion ? enlace : null }), enviado ? 'enviada' : 'sin_correo')
    }

    if (accion === 'aprobar') {
      const inv = String(b?.invitacion ?? '')
      const cuenta = String(b?.cuenta ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(inv) || !/^[0-9a-f-]{36}$/i.test(cuenta)) return fin(json(400, { ok: false, mensaje: 'Falta la invitación o la cuenta.' }), 'pedido')
      const { data, error } = await admin.rpc('conta_asesoria_aprobar', { p_invitation: inv, p_platform_user: usuario, p_advisor_account: cuenta })
      if (error) return fin(json(error.code === '42501' ? 403 : 422, { ok: false, mensaje: error.message }), 'no_deja')
      return fin(json(200, data), 'aprobada')
    }

    return fin(json(400, { ok: false, mensaje: 'Esa acción no existe.' }), 'accion')
  } catch {
    return fin(json(500, { ok: false, mensaje: 'No se ha podido terminar. No se ha cambiado nada; vuelve a intentarlo.' }), 'fallo')
  }
})
