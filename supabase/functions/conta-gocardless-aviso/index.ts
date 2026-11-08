// supabase/functions/conta-gocardless-aviso/index.ts
//
// G01d · Los avisos al instante de GoCardless (un endpoint por cuenta: QBO
// INTEGRITY y Anny). verify_jwt = false: llama GoCardless, sin sesión.
//
//   · POST ?empresa=<empresa emisora>, con el JSON de GoCardless: SOLO si la
//     firma Webhook-Signature es la del secreto de esa cuenta, con «Al
//     instante» encendido. Si no, 401 y no se hace nada (queda en el registro,
//     sin la firma). Cada aviso entra una vez en la cola (por su id), se
//     contesta 200 enseguida y se trabaja después.
//   · El trabajo (Julio, 08/11: opción a): los avisos de una empresa se juntan
//     unos 30 s (como mucho 2 min) y entonces se relee la cuenta entera de esa
//     empresa con conta-gocardless-leer, la lectura de siempre: mismas reglas
//     y nada duplicado (también el próximo cobro del G04 y «Te deben»).
//   · { accion: 'repasar' } con x-cron-secret: el repaso de cada 2 minutos.
//   · { accion: 'probar', empresa } de una persona administradora o
//     encargada: Sumied se manda a sí mismo un aviso firmado con el secreto
//     guardado y dice si ha llegado.
//
// NUNCA se escribe en GoCardless: la relectura solo hace GET.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { avisoGoCardlessAutentico, firmaGoCardless, FRASE_RECHAZO } from '../_shared/avisos/autenticidad.ts'
import { leerAvisoGoCardless, type AvisoGc } from '../_shared/avisos/leerAviso.ts'
import { JUNTAR_GC_MS, siguienteIntento, trabajosDeGoCardless, type AvisoGcEnCola } from '../_shared/avisos/cola.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const UUID = /^[0-9a-f-]{36}$/i

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
const despues = (p: Promise<unknown>) => {
  const seguro = p.catch((e) => console.error('[conta-gocardless-aviso] trabajo:', e instanceof Error ? e.message : String(e)))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(seguro)
}

async function deLaEmpresa(db: SupabaseClient, empresa: string) {
  const { data } = await db.from('conta_cobro_gocardless').select('account_id').eq('company_id', empresa).maybeSingle()
  return (data as { account_id: string } | null)?.account_id ?? null
}

/** Recibir un aviso: comprobar la firma con el cuerpo TAL CUAL, guardar en la cola y contestar. */
async function recibir(db: SupabaseClient, supabaseUrl: string, empresa: string, cuerpo: string, firma: string | null): Promise<Response> {
  const cuenta = await deLaEmpresa(db, empresa)
  if (!cuenta) return json(401, { error: 'No.' })
  const { data: sec, error } = await db.rpc('conta_aviso_secreto', { p_origen: 'gocardless', p_account: cuenta, p_crm: null, p_company: empresa })
  if (error) return json(500, { error: 'No se ha podido comprobar el aviso.' })
  const s = (sec as { encendido: boolean; codigo: string | null }[] | null)?.[0]
  const v = await avisoGoCardlessAutentico({ encendido: !!s?.encendido, secreto: s?.codigo ?? null, cuerpo, firma })
  if (!v.ok) {
    await db.from('conta_aviso').insert({ account_id: cuenta, company_id: empresa, origen: 'gocardless', estado: 'rechazado', porque: FRASE_RECHAZO[v.porque] })
    return json(401, { error: 'No.' })
  }
  const ahora = new Date().toISOString()
  await db.from('conta_cobro_gocardless').update({ aviso_ultimo_at: ahora }).eq('company_id', empresa)
  let prueba = false
  try { prueba = (JSON.parse(cuerpo) as { meta?: { sumied_prueba?: boolean } })?.meta?.sumied_prueba === true } catch { /* lo dice leerAvisoGoCardless */ }
  if (prueba) {
    await db.from('conta_aviso').insert({ account_id: cuenta, company_id: empresa, origen: 'gocardless', clave: `prueba:${Date.now()}`, estado: 'prueba',
      hecho_at: ahora, frase: 'Aviso de prueba recibido: la dirección y el secreto funcionan.' })
    return json(200, { ok: true, prueba: true })
  }
  const a = leerAvisoGoCardless(cuerpo)
  if (!a.ok) {
    await db.from('conta_aviso').insert({ account_id: cuenta, company_id: empresa, origen: 'gocardless', estado: 'ignorado', porque: a.porque, hecho_at: ahora })
    return json(200, { ok: true, ignorado: a.porque })
  }
  if (a.avisos.length) {
    const filas = a.avisos.map((x: AvisoGc) => ({ account_id: cuenta, company_id: empresa, origen: 'gocardless', clave: x.clave, estado: 'pendiente',
      recurso: x.recurso, accion: x.accion, enlaces: x.enlaces, causa: x.causa }))
    const { error: eCola } = await db.from('conta_aviso').upsert(filas, { onConflict: 'account_id,clave', ignoreDuplicates: true })
    if (eCola) return json(500, { error: 'No se ha podido guardar el aviso.' })
    // Se juntan unos 30 s; después se mira si ya toca releer (si llegan más, los recoge el último o el repaso).
    despues((async () => { await esperar(JUNTAR_GC_MS + 1_000); await trabajar(db, supabaseUrl) })())
  }
  return json(200, { ok: true, avisos: a.avisos.length, fuera: a.fuera ?? 0 })
}

/** Releer las empresas a las que ya les toca (los avisos juntados, o los que fallaron y les toca repetir). */
async function trabajar(db: SupabaseClient, supabaseUrl: string): Promise<number> {
  const ahora = Date.now()
  const { data } = await db.from('conta_aviso').select('id, clave, company_id, recibido_at, estado, intentos, proximo_intento_at, recurso, accion')
    .eq('origen', 'gocardless').or(`estado.eq.pendiente,and(estado.eq.fallo,proximo_intento_at.lte.${new Date(ahora).toISOString()})`).limit(2000)
  const filas = (data ?? []) as { id: string; clave: string; company_id: string; recibido_at: string; estado: string; intentos: number }[]
  // Un aviso que falló y le toca cuenta como recién llegado hace rato: se relee ya.
  const enCola: AvisoGcEnCola[] = filas.map((f) => ({ empresa: f.company_id, llegada: f.estado === 'fallo' ? 0 : Date.parse(f.recibido_at),
    aviso: { clave: f.clave, id: f.clave, recurso: '', accion: '', creado: null, enlaces: {}, causa: null } }))
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  let releidas = 0
  for (const t of trabajosDeGoCardless(enCola, ahora)) {
    const ids = filas.filter((f) => t.claves.includes(f.clave) && f.company_id === t.empresa).map((f) => f.id)
    // Apartar: dos vueltas a la vez no releen la misma empresa con los mismos avisos.
    const { data: apartados } = await db.from('conta_aviso').update({ estado: 'trabajando', proximo_intento_at: new Date().toISOString() })
      .in('id', ids).in('estado', ['pendiente', 'fallo']).select('id, intentos')
    const mios = (apartados ?? []) as { id: string; intentos: number }[]
    if (!mios.length) continue
    try {
      if (!secreto) throw new Error('Falta CRON_SECRET: no se puede releer GoCardless.')
      const r = await fetch(`${supabaseUrl}/functions/v1/conta-gocardless-leer`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': secreto }, body: JSON.stringify({ accion: 'leer', empresa: t.empresa, por: 'aviso' }) })
      const res = await r.json().catch(() => null) as { ok?: boolean; frase?: string; error?: string } | null
      if (!r.ok || !res?.ok) throw new Error(res?.error ?? `La relectura de GoCardless ha contestado ${r.status}.`)
      await db.from('conta_aviso').update({ estado: 'hecho', hecho_at: new Date().toISOString(), porque: null,
        frase: `Releída la cuenta de GoCardless por ${mios.length === 1 ? 'un aviso' : `${mios.length} avisos`}. ${res.frase ?? ''}`.trim().slice(0, 1000) }).in('id', mios.map((m) => m.id))
      releidas++
    } catch (e) {
      const porque = e instanceof Error ? e.message : String(e)
      for (const m of mios) {
        const prox = siguienteIntento(m.intentos + 1, Date.now())
        await db.from('conta_aviso').update({ estado: 'fallo', intentos: m.intentos + 1, proximo_intento_at: prox ? new Date(prox).toISOString() : null,
          porque: prox ? porque : `${porque} No se vuelve a intentar: lo recoge la lectura de la noche.` }).eq('id', m.id)
      }
    }
  }
  return releidas
}

async function repasar(db: SupabaseClient, supabaseUrl: string) {
  const hace10 = new Date(Date.now() - 10 * 60_000).toISOString()
  await db.from('conta_aviso').update({ estado: 'fallo', porque: 'Se quedó a medias: se vuelve a intentar.', proximo_intento_at: new Date().toISOString() })
    .eq('origen', 'gocardless').eq('estado', 'trabajando').lt('proximo_intento_at', hace10)
  return trabajar(db, supabaseUrl)
}

/** «Probar»: un aviso firmado con el secreto guardado, a la propia dirección. */
async function probar(db: SupabaseClient, supabaseUrl: string, empresa: string): Promise<{ ok: boolean; frase: string }> {
  const cuenta = await deLaEmpresa(db, empresa)
  if (!cuenta) return { ok: false, frase: 'Esa empresa no tiene conectado GoCardless.' }
  const { data: sec } = await db.rpc('conta_aviso_secreto', { p_origen: 'gocardless', p_account: cuenta, p_crm: null, p_company: empresa })
  const s = (sec as { encendido: boolean; codigo: string | null }[] | null)?.[0]
  if (!s?.codigo) return { ok: false, frase: 'Aún no se ha pegado el secreto de GoCardless: pégalo en «Cómo activarlo».' }
  if (!s.encendido) return { ok: false, frase: '«Al instante» está apagado: enciéndelo y vuelve a probar.' }
  const desde = new Date().toISOString()
  const cuerpo = JSON.stringify({ events: [], meta: { sumied_prueba: true } })
  const r = await fetch(`${supabaseUrl}/functions/v1/conta-gocardless-aviso?${new URLSearchParams({ empresa })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Webhook-Signature': await firmaGoCardless(cuerpo, s.codigo) }, body: cuerpo })
  const { data } = await db.from('conta_aviso').select('id').eq('company_id', empresa).eq('origen', 'gocardless').eq('estado', 'prueba').gte('recibido_at', desde).limit(1)
  return r.ok && (data ?? []).length
    ? { ok: true, frase: 'Probado: Sumied ha recibido un aviso de prueba firmado con el secreto de GoCardless. La dirección y el secreto funcionan; falta que GoCardless mande los suyos.' }
    : { ok: false, frase: `El aviso de prueba no ha llegado (respuesta ${r.status}). Mira que el secreto pegado sea el de este endpoint de GoCardless.` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const u = new URL(req.url)
  try {
    // El aviso de GoCardless: con su firma, y la empresa en la dirección.
    const firma = req.headers.get('webhook-signature')
    const empresaAviso = u.searchParams.get('empresa')
    if (empresaAviso !== null) {
      if (!UUID.test(empresaAviso)) return json(401, { error: 'No.' })
      return await recibir(admin, supabaseUrl, empresaAviso, await req.text(), firma)
    }
    let cuerpo: Record<string, unknown> = {}
    try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
    const secreto = Deno.env.get('CRON_SECRET') ?? ''
    if (cuerpo.accion === 'repasar') {
      if (!secreto || req.headers.get('x-cron-secret') !== secreto) return json(401, { error: 'No.' })
      return json(200, { ok: true, releidas: await repasar(admin, supabaseUrl) })
    }
    if (cuerpo.accion === 'probar') {
      const empresa = String(cuerpo.empresa ?? '')
      if (!UUID.test(empresa)) return json(400, { error: 'Falta la empresa.' })
      const cuenta = await deLaEmpresa(admin, empresa)
      if (!cuenta) return json(400, { error: 'Esa empresa no tiene conectado GoCardless.' })
      const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
      const { data: quien } = await persona.auth.getUser()
      if (!quien?.user) return json(401, { error: 'Entra en Sumied para probarlo.' })
      const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: cuenta })
      if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta lo prueba.' })
      return json(200, await probar(admin, supabaseUrl, empresa))
    }
    return json(400, { error: 'Acción: repasar o probar.' })
  } catch (e) {
    console.error('[conta-gocardless-aviso]', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'No se ha podido atender el aviso.' })
  }
})
