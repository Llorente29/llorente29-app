// supabase/functions/conta-bitrix-leer/index.ts
//
// G01 · Tarea 3 (06/11/2026) · Leer el Bitrix24 de una cuenta (uno para todos
// sus emisores). SOLO LEE Bitrix24: crm.company.fields y crm.company.list.
//
//   · { accion: 'conectar', cuenta, entorno, url } — una persona
//     (administradora o encargada) pega una vez la dirección del webhook
//     entrante (Bitrix24 › Aplicaciones › Webhooks › Webhook entrante, con
//     permiso de CRM). Se miden los campos del portal (crm.company.fields),
//     se propone el mapa con lo medido (mapa.ts · proponerMapa) y se guarda
//     la dirección en Vault. Después, la primera lectura.
//   · { accion: 'leer', cuenta } — «Leer ahora» o la lectura de cada noche
//     (x-cron-secret). Al acabar, lanza la lectura de cada cuenta de
//     GoCardless de la cuenta, que casa con lo recién leído.
//
// La cuenta de demostración solo lee el Bitrix24 de pruebas (salida.ts).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { MAPA_QBO, proponerMapa, type MapaBitrix } from './mapa.ts'
import { fraseDeBitrix, leerFichas, leerParaRecuento, medirCampos, portalDe } from './lectura.ts'
import { gruposValidos } from './recuento.ts'
import { puedeLeer, type Entorno } from './salida.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function leer(db: SupabaseClient, cuenta: string, por: 'persona' | 'cada_noche' | 'conexion', quien: string | null) {
  const { data: sec, error: secErr } = await db.rpc('conta_bitrix_secreto', { p_account: cuenta })
  if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
  const s = (sec as { entorno: Entorno; url: string; mapa: MapaBitrix | null }[] | null)?.[0]
  if (!s?.url) throw new Error('Esta cuenta no tiene conectado Bitrix24.')
  const mapa = s.mapa ?? MAPA_QBO

  const { data: lect, error: lectErr } = await db.from('conta_gestoria_lectura')
    .insert({ account_id: cuenta, origen: 'bitrix', entorno: s.entorno, por, quien_name: quien }).select('id').single()
  if (lectErr) throw new Error(`No se ha podido apuntar la lectura: ${lectErr.message}`)
  const lectura = (lect as { id: string }).id
  const acabar = (campos: Record<string, unknown>) => db.from('conta_gestoria_lectura').update({ acabada_at: new Date().toISOString(), ...campos }).eq('id', lectura)

  const puerta = await puedeLeer(db, cuenta, s.entorno)
  if (!puerta.lee) { await acabar({ estado: 'no_lee', mensaje: puerta.porque }); return { frase: puerta.porque, lee: false } }
  try {
    const { fichas } = await leerFichas(fetch, s.url, mapa, esperar)
    let suma = { nuevos: 0, cambiados: 0, iguales: 0 }
    for (let i = 0; i < fichas.length; i += 200) {
      const { data, error } = await db.rpc('conta_bitrix_guardar_fichas', { p_account: cuenta, p_fichas: fichas.slice(i, i + 200) })
      if (error) throw new Error(`No se han podido guardar las fichas: ${error.message}`)
      const r = data as typeof suma
      suma = { nuevos: suma.nuevos + r.nuevos, cambiados: suma.cambiados + r.cambiados, iguales: suma.iguales + r.iguales }
    }
    await db.from('conta_crm_bitrix').update({ ultima_lectura_at: new Date().toISOString(), empresas_leidas: fichas.length, updated_at: new Date().toISOString() }).eq('account_id', cuenta)
    const frase = fraseDeBitrix(fichas.length, suma, por === 'conexion')
    await acabar({ estado: 'bien', ...suma, mensaje: frase })
    const avisos = fichas.flatMap((f) => f.avisos.map((a) => `${f.bitrixId}: ${a}`)).slice(0, 50)
    return { frase, lee: true, empresas: fichas.length, ...suma, activas: fichas.filter((f) => f.situacion === 'activo').length, avisos }
  } catch (e) {
    await acabar({ estado: 'mal', mensaje: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

/** Después de Bitrix24, cada cuenta de GoCardless de la cuenta (casa con lo recién leído). */
async function leerGocardlessDeLaCuenta(db: SupabaseClient, cuenta: string, supabaseUrl: string) {
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  if (!secreto) return
  const { data } = await db.from('conta_cobro_gocardless').select('company_id').eq('account_id', cuenta).not('token_ref', 'is', null)
  for (const g of (data ?? []) as { company_id: string }[]) {
    await fetch(`${supabaseUrl}/functions/v1/conta-gocardless-leer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secreto },
      body: JSON.stringify({ accion: 'leer', empresa: g.company_id }),
    }).catch((e) => console.error('[conta-bitrix-leer] no se ha podido lanzar la lectura de GoCardless:', e instanceof Error ? e.message : String(e)))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let cuerpo: Record<string, unknown> = {}
  try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
  const cuenta = String(cuerpo.cuenta ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(cuenta)) return json(400, { error: 'Falta la cuenta.' })

  // G01b · El recuento de los campos dudosos (Julio, 07/11): solo con la clave de
  // servicio, desde el workflow «Recuento de campos de Bitrix24» lanzado a mano
  // desde main. Solo lee de Bitrix24 (la dirección sale de Vault aquí dentro y
  // no se devuelve) y no escribe nada: ni la lectura, ni las fichas. Devuelve
  // solo números.
  if (cuerpo.accion === 'recuento') {
    const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!servicio || req.headers.get('x-internal-key') !== servicio) return json(403, { error: 'El recuento solo se lanza desde su workflow, con la clave de servicio.' })
    const grupos = gruposValidos(cuerpo.grupos)
    if (!grupos) return json(400, { error: 'Faltan los campos a contar: texto (por grupo), situacion y cuotas, con sus códigos de Bitrix24.' })
    try {
      const { data: sec, error: secErr } = await admin.rpc('conta_bitrix_secreto', { p_account: cuenta })
      if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
      const s = (sec as { entorno: Entorno; url: string }[] | null)?.[0]
      if (!s?.url) return json(400, { error: 'Esta cuenta no tiene conectado Bitrix24.' })
      const puerta = await puedeLeer(admin, cuenta, s.entorno)
      if (!puerta.lee) return json(400, { error: puerta.porque })
      return json(200, { ok: true, entorno: s.entorno, portal: portalDe(s.url), ...(await leerParaRecuento(fetch, s.url, grupos, esperar)) })
    } catch (e) {
      console.error('[conta-bitrix-leer] recuento', e instanceof Error ? e.message : String(e))
      return json(500, { error: e instanceof Error ? e.message : 'No se ha podido contar.' })
    }
  }

  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  const esCron = secreto !== '' && req.headers.get('x-cron-secret') === secreto
  let quien: string | null = null
  if (!esCron) {
    const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
    const { data: u } = await persona.auth.getUser()
    if (!u?.user) return json(401, { error: 'Hay que entrar para leer Bitrix24.' })
    const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: cuenta })
    if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta conecta o lee Bitrix24.' })
    const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('user_id', u.user.id).eq('account_id', cuenta).maybeSingle()
    quien = (perfil as { display_name?: string } | null)?.display_name ?? 'Una persona de la cuenta'
  }

  try {
    if (cuerpo.accion === 'conectar') {
      if (esCron) return json(403, { error: 'Conectar lo hace una persona.' })
      const entorno: Entorno | null = cuerpo.entorno === 'pruebas' ? 'pruebas' : cuerpo.entorno === 'real' ? 'real' : null
      const url = String(cuerpo.url ?? '').trim()
      const portal = portalDe(url)
      if (!entorno) return json(400, { error: 'Di si es el Bitrix24 real o el de pruebas.' })
      if (!portal) return json(400, { error: 'La dirección es como https://<tu portal>/rest/<número>/<clave>/ (Bitrix24 › Aplicaciones › Webhooks › Webhook entrante).' })
      const puerta = await puedeLeer(admin, cuenta, entorno)
      if (!puerta.lee) return json(400, { error: puerta.porque })
      // Se miden los campos (también comprueba que la dirección vale) y se propone el mapa.
      const medidos = await medirCampos(fetch, url)
      const { data: emp } = await admin.from('company').select('id, legal_name, trade_name').eq('account_id', cuenta)
      const emisores = ((emp ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[]).map((e) => ({ id: e.id, nombre: e.legal_name || e.trade_name || '' }))
      const { data: acc } = await admin.from('accounts').select('name').eq('id', cuenta).single()
      const propuesta = proponerMapa((acc as { name?: string } | null)?.name ?? 'Cuenta', medidos, emisores)
      const { error } = await admin.rpc('conta_bitrix_guardar_conexion', { p_account: cuenta, p_entorno: entorno, p_url: url, p_portal: portal, p_quien: quien })
      if (error) return json(400, { error: error.message })
      // G01b · Lo medido y el mapa (con sus dudas) se guardan de verdad: si no se puede, se dice.
      const { error: eMapa } = await admin.from('conta_crm_bitrix').update({ mapa: propuesta.mapa, campos_medidos: medidos, updated_at: new Date().toISOString() }).eq('account_id', cuenta)
      if (eMapa) return json(500, { error: `Conectado, pero no se ha podido guardar el mapa de los campos: ${eMapa.message}` })
      const res = await leer(admin, cuenta, 'conexion', quien)
      await leerGocardlessDeLaCuenta(admin, cuenta, supabaseUrl)
      return json(200, { ok: true, ...res, portal, queEsCadaUno: propuesta.queEsCadaUno, sinUsar: propuesta.sinUsar })
    }
    if (cuerpo.accion === 'leer') {
      const res = await leer(admin, cuenta, esCron ? 'cada_noche' : 'persona', quien)
      await leerGocardlessDeLaCuenta(admin, cuenta, supabaseUrl)
      return json(200, { ok: true, ...res })
    }
    return json(400, { error: 'Acción: conectar o leer.' })
  } catch (e) {
    // En el registro, el qué y nunca la dirección con su clave (T11).
    console.error('[conta-bitrix-leer]', e instanceof Error ? e.message : String(e))
    return json(500, { error: e instanceof Error ? e.message : 'No se ha podido leer Bitrix24.' })
  }
})
