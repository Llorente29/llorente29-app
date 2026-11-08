// supabase/functions/conta-crm-aviso/index.ts
//
// G01d · Los avisos al instante del CRM (la puerta neutra; Bitrix24 es su
// primer adaptador). verify_jwt = false: llama el CRM, sin sesión.
//
//   · POST ?cuenta=<cuenta>&crm=bitrix24, con el formulario del webhook
//     saliente: SOLO si es auténtico (auth[application_token] = el código de
//     esa conexión, con «Al instante» encendido). Si no, 401 y no se hace nada
//     (queda en el registro, sin el código). Se guarda en la cola (cada aviso,
//     una vez), se contesta 200 enseguida y se trabaja después: Bitrix24 no
//     espera por nosotros.
//   · { accion: 'repasar' } con x-cron-secret: el repaso de cada 2 minutos
//     (conta_avisos_despertar): lo que espera y lo que falló y le toca.
//   · { accion: 'probar', cuenta, crm } de una persona administradora o
//     encargada: Sumied se manda a sí mismo un aviso de prueba con el código
//     guardado y dice si ha llegado.
//
// El trabajo, ficha a ficha (_shared/crm/fichaSuelta.ts): se lee esa ficha
// con el acceso de solo lectura de siempre y se aplican las mismas reglas que
// la lectura entera. NUNCA se escribe en el CRM. Una ficha borrada en el CRM no
// borra nada en Sumied: sale en «Pendiente de revisar».

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { avisoBitrixAutentico, FRASE_RECHAZO } from '../_shared/avisos/autenticidad.ts'
import { leerAvisoBitrix, type AvisoCrm } from '../_shared/avisos/leerAviso.ts'
import { siguienteIntento, trabajosDelCrm, type TrabajoCrm } from '../_shared/avisos/cola.ts'
import { planDeFichaSuelta, type FichaGuardada } from '../_shared/crm/fichaSuelta.ts'
import { diferenciasDeLectura, nifComoLaBase, paraGuardar, type ClienteGuardado, type ErrorAlGuardar } from '../_shared/crm/clientes.ts'
import { claveDeFicha, nombreDelCrm, type FichaContactoCrm } from '../_shared/crm/ficha.ts'
import { leerContactoSuelto, leerEmpresaSuelta } from '../conta-bitrix-leer/lectura.ts'
import { MAPA_QBO, type MapaBitrix } from '../conta-bitrix-leer/mapa.ts'
import type { MapaContactos } from '../conta-bitrix-leer/contactosClientes.ts'
import { puedeLeer, type Entorno } from '../conta-bitrix-leer/salida.ts'

/** Los CRM que saben recibir avisos (otro CRM, otro adaptador). */
const CRMS = ['bitrix24']
/** El evento que se manda Sumied a sí mismo con «Probar»: solo se registra. */
const PRUEBA = 'SUMIEDPRUEBA'
/** Cuántos avisos se trabajan en una vuelta (Bitrix24: dos peticiones por segundo). El resto, en la siguiente. */
const POR_VUELTA = 40

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const UUID = /^[0-9a-f-]{36}$/i

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
const despues = (p: Promise<unknown>) => {
  const seguro = p.catch((e) => console.error('[conta-crm-aviso] trabajo:', e instanceof Error ? e.message : String(e)))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(seguro)
}

async function registrarRechazo(db: SupabaseClient, cuenta: string, crm: string, porque: string) {
  await db.from('conta_aviso').insert({ account_id: cuenta, origen: 'crm', crm, estado: 'rechazado', porque })
}

/** Recibir un aviso: comprobar, guardar en la cola y contestar. */
async function recibir(db: SupabaseClient, cuenta: string, crm: string, cuerpo: string): Promise<Response> {
  const { data: sec, error } = await db.rpc('conta_aviso_secreto', { p_origen: 'crm', p_account: cuenta, p_crm: crm, p_company: null })
  if (error) return json(500, { error: 'No se ha podido comprobar el aviso.' })
  const s = (sec as { encendido: boolean; codigo: string | null }[] | null)?.[0]
  if (!s) return json(401, { error: 'No.' })
  const recibido = new URLSearchParams(cuerpo).get('auth[application_token]')
  const v = avisoBitrixAutentico({ encendido: s.encendido, guardado: s.codigo, recibido })
  if (!v.ok) { await registrarRechazo(db, cuenta, crm, FRASE_RECHAZO[v.porque]); return json(401, { error: 'No.' }) }
  const ahora = new Date().toISOString()
  await db.from('conta_crm').update({ aviso_ultimo_at: ahora }).eq('account_id', cuenta).eq('crm', crm)

  if ((new URLSearchParams(cuerpo).get('event') ?? '').toUpperCase() === PRUEBA) {
    await db.from('conta_aviso').insert({ account_id: cuenta, origen: 'crm', crm, clave: `prueba:${Date.now()}`, estado: 'prueba',
      hecho_at: ahora, frase: 'Aviso de prueba recibido: la dirección y el código funcionan.' })
    return json(200, { ok: true, prueba: true })
  }
  const a = leerAvisoBitrix(cuerpo)
  if (!a.ok) {
    await db.from('conta_aviso').insert({ account_id: cuenta, origen: 'crm', crm, estado: 'ignorado', porque: a.porque, hecho_at: ahora })
    return json(200, { ok: true, ignorado: a.porque })
  }
  const filas = a.avisos.map((x) => ({ account_id: cuenta, origen: 'crm', crm, clave: x.clave, estado: 'pendiente', tipo_ficha: x.tipoFicha,
    id_externo: x.idExterno, accion: x.accion, enlaces: { ts: x.ts } }))
  const { error: eCola } = await db.from('conta_aviso').upsert(filas, { onConflict: 'account_id,clave', ignoreDuplicates: true })
  if (eCola) return json(500, { error: 'No se ha podido guardar el aviso.' })
  despues(trabajarCuenta(db, cuenta, crm))
  return json(200, { ok: true })
}

/** Los avisos que le tocan a una cuenta, apartados para esta vuelta (dos vueltas a la vez no cogen el mismo). */
async function apartar(db: SupabaseClient, cuenta: string, crm: string): Promise<{ id: string; aviso: AvisoCrm; intentos: number }[]> {
  const ahora = new Date().toISOString()
  const { data: candidatos } = await db.from('conta_aviso').select('id').eq('account_id', cuenta).eq('origen', 'crm').eq('crm', crm)
    .or(`estado.eq.pendiente,and(estado.eq.fallo,proximo_intento_at.lte.${ahora})`).order('recibido_at').limit(POR_VUELTA)
  const ids = ((candidatos ?? []) as { id: string }[]).map((x) => x.id)
  if (!ids.length) return []
  const { data } = await db.from('conta_aviso').update({ estado: 'trabajando', proximo_intento_at: ahora }).in('id', ids).in('estado', ['pendiente', 'fallo'])
    .select('id, clave, tipo_ficha, id_externo, accion, enlaces, intentos')
  return ((data ?? []) as { id: string; clave: string; tipo_ficha: 'empresa' | 'contacto'; id_externo: string; accion: AvisoCrm['accion']; enlaces: { ts?: number } | null; intentos: number }[])
    .map((r) => ({ id: r.id, intentos: r.intentos, aviso: { clave: r.clave, crm, tipoFicha: r.tipo_ficha, accion: r.accion, idExterno: r.id_externo, ts: Number(r.enlaces?.ts ?? 0) } }))
}

async function leerFilas<T>(q: (desde: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await q(desde)
    if (error) throw new Error(`No se han podido leer ${que}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (((data ?? []) as unknown[]).length < 1000) break
  }
  return out
}

/** Trabajar los avisos de una cuenta: ficha a ficha, con las reglas de la lectura entera. */
async function trabajarCuenta(db: SupabaseClient, cuenta: string, crm: string) {
  const apartados = await apartar(db, cuenta, crm)
  if (!apartados.length) return
  const porClave = new Map(apartados.map((a) => [a.aviso.clave, a]))
  const cerrar = async (claves: string[], campos: Record<string, unknown>) => {
    await db.from('conta_aviso').update(campos).in('id', claves.map((k) => porClave.get(k)!.id))
  }
  const fallar = async (claves: string[], porque: string) => {
    for (const k of claves) {
      const a = porClave.get(k)!
      const prox = siguienteIntento(a.intentos + 1, Date.now())
      await db.from('conta_aviso').update({ estado: 'fallo', intentos: a.intentos + 1, porque: prox ? porque : `${porque} No se vuelve a intentar: lo recoge la lectura de la noche.`,
        proximo_intento_at: prox ? new Date(prox).toISOString() : null }).eq('id', a.id)
    }
  }
  const trabajos = trabajosDelCrm(apartados.map((a) => a.aviso))
  const todas = apartados.map((a) => a.aviso.clave)

  // La conexión: la dirección de lectura (Vault), el mapa, los contactos y la unión.
  const { data: sec, error: eSec } = await db.rpc('conta_crm_secreto', { p_account: cuenta, p_crm: crm })
  const s = (sec as { entorno: Entorno; url: string; mapa: MapaBitrix | null }[] | null)?.[0]
  if (eSec || !s?.url) { await fallar(todas, 'Esta cuenta no tiene conectado su CRM.'); return }
  const puerta = await puedeLeer(db, cuenta, s.entorno)
  if (!puerta.lee) { await cerrar(todas, { estado: 'ignorado', porque: puerta.porque, hecho_at: new Date().toISOString() }); return }
  const { data: con } = await db.from('conta_crm').select('mapa_contactos, union_aplicada').eq('account_id', cuenta).eq('crm', crm).maybeSingle()
  const mapaContactos = ((con as { mapa_contactos?: MapaContactos | null } | null)?.mapa_contactos ?? null)
  const unir = !!(con as { union_aplicada?: unknown } | null)?.union_aplicada
  const mapa = s.mapa ?? MAPA_QBO

  // Lo que Sumied guarda de cada ficha (la última lectura) y los clientes que vinieron del CRM.
  let guardadas = (await leerFilas<{ ficha: FichaGuardada | null }>((d) => db.from('conta_gestoria_ficha').select('ficha')
    .eq('account_id', cuenta).eq('crm', crm).eq('de_empresa', '').order('id_externo').range(d, d + 999), 'las fichas de Sumied'))
    .map((x) => x.ficha).filter((f): f is FichaGuardada => !!f && typeof f === 'object' && !!(f as FichaGuardada).idExterno)
  const principales = new Map((await leerFilas<{ tipo_ficha: 'empresa' | 'contacto'; id_externo: string | null; party: { name: string | null } | null }>((d) =>
    db.from('conta_gestoria_cliente').select('tipo_ficha, id_externo, party!inner(name, archived_at)').eq('account_id', cuenta).eq('crm', crm)
      .is('party.archived_at', null).order('party_id').range(d, d + 999), 'los clientes de Sumied'))
    .filter((x) => x.id_externo).map((x) => [claveDeFicha({ tipoFicha: x.tipo_ficha, idExterno: x.id_externo! }), { tipoFicha: x.tipo_ficha, idExterno: x.id_externo!, nombre: x.party?.name ?? null } as ClienteGuardado]))
  const gocardless = { nifs: new Set<string>(), correos: new Set<string>() }
  for (const g of await leerFilas<{ nif: string | null; correo: string | null }>((d) => db.from('conta_gc_cliente').select('nif, correo').eq('account_id', cuenta).order('gc_id').range(d, d + 999), 'los clientes de GoCardless')) {
    const n = nifComoLaBase(g.nif); if (n) gocardless.nifs.add(n)
    if (g.correo?.trim()) gocardless.correos.add(g.correo.trim().toLowerCase())
  }

  const { data: lect, error: eLect } = await db.from('conta_gestoria_lectura').insert({ account_id: cuenta, origen: 'crm', entorno: s.entorno, por: 'aviso' }).select('id').single()
  if (eLect) { await fallar(todas, `No se ha podido apuntar la lectura: ${eLect.message}`); return }
  const lectura = (lect as { id: string }).id
  let hechos = 0
  const frases: string[] = []

  for (const t of trabajos) {
    try {
      await esperar(500)
      const frase = await trabajarFicha(db, { cuenta, crm, url: s.url, mapa, mapaContactos, unir, guardadas, principales, gocardless, lectura }, t)
      guardadas = frase.guardadas
      await cerrar(t.claves, { estado: 'hecho', hecho_at: new Date().toISOString(), frase: frase.texto, porque: null })
      frases.push(frase.texto); hechos++
    } catch (e) {
      await fallar(t.claves, e instanceof Error ? e.message : String(e))
    }
  }
  await db.from('conta_gestoria_lectura').update({ acabada_at: new Date().toISOString(), estado: hechos === trabajos.length ? 'bien' : 'mal',
    mensaje: frases.join(' ').slice(0, 2000) || 'Ningún aviso se ha podido aplicar.' }).eq('id', lectura)
}

interface Ctx {
  cuenta: string; crm: string; url: string; mapa: MapaBitrix; mapaContactos: MapaContactos | null; unir: boolean
  guardadas: FichaGuardada[]; principales: Map<string, ClienteGuardado>; gocardless: { nifs: Set<string>; correos: Set<string> }; lectura: string
}

/** Una ficha: leerla, decidir con las reglas de la lectura entera y guardar solo lo tocado. */
async function trabajarFicha(db: SupabaseClient, c: Ctx, t: TrabajoCrm): Promise<{ texto: string; guardadas: FichaGuardada[] }> {
  const k = claveDeFicha({ tipoFicha: t.tipoFicha, idExterno: t.idExterno })
  let nueva: FichaGuardada | null = null
  if (t.tipo === 'leer_ficha') {
    if (t.tipoFicha === 'empresa') {
      nueva = (await leerEmpresaSuelta(fetch, c.url, c.mapa, t.idExterno)).ficha
    } else {
      // La negociación, la de la última lectura entera (Julio, 08/11): las nuevas entran con la de la noche.
      const antes = c.guardadas.find((f) => claveDeFicha(f) === k) as FichaContactoCrm | undefined
      nueva = (await leerContactoSuelto(fetch, c.url, c.mapaContactos, t.idExterno, { conNegociacion: !!antes?.senales?.negociacion, gocardless: c.gocardless })).ficha
    }
  }
  const plan = planDeFichaSuelta({ crm: c.crm, unir: c.unir, contactosConfirmados: !!c.mapaContactos?.confirmado, guardadas: c.guardadas,
    tipoFicha: t.tipoFicha, idExterno: t.idExterno, nueva, clienteGuardado: c.principales.get(k) ?? null })

  let diferencias = plan.diferencias
  if (plan.clientes.length) {
    const { data, error } = await db.rpc('conta_crm_guardar_clientes', { p_account: c.cuenta, p_crm: c.crm, p_clientes: plan.clientes.map(paraGuardar) })
    if (error) throw new Error(`No se han podido guardar las fichas: ${error.message}`)
    const errores = ((data as { errores?: ErrorAlGuardar[] } | null)?.errores ?? [])
    if (errores.length) {
      // Como la lectura entera: lo que no se ha guardado sale en «Pendiente de revisar», con su porqué.
      const delGrupo = new Set(['fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada'])
      diferencias = [...diferenciasDeLectura(plan.clientes, errores, c.unir, nombreDelCrm(c.crm)), ...plan.diferencias.filter((d) => !delGrupo.has(d.tipo))]
    }
  }
  if (plan.tocaPersona) {
    const { error } = await db.rpc('conta_crm_guardar_personas_de_contacto', { p_account: c.cuenta, p_crm: c.crm, p_contacto: t.idExterno,
      p_empresas: plan.persona?.empresas ?? [], p_ficha: plan.persona?.contacto ?? { idExterno: t.idExterno } })
    if (error) throw new Error(`No se ha podido guardar la persona de contacto: ${error.message}`)
  }
  const { error: eDif } = await db.rpc('conta_crm_renovar_pendientes', { p_account: c.cuenta, p_crm: c.crm, p_lectura: c.lectura,
    p_fichas: plan.fichasARenovar.length ? plan.fichasARenovar : [{ tipoFicha: t.tipoFicha, idExterno: t.idExterno }], p_difs: diferencias })
  if (eDif) throw new Error(`No se ha podido renovar «Pendiente de revisar»: ${eDif.message}`)

  // Lo guardado de esta ficha, para los avisos siguientes de esta vuelta.
  const esCliente = plan.clientes.some((x) => x.fichas.some((f) => claveDeFicha(f) === k))
  const sin = c.guardadas.filter((f) => claveDeFicha(f) !== k)
  return { texto: plan.frase, guardadas: nueva && esCliente ? [...sin, nueva] : (t.tipo === 'baja' ? c.guardadas : sin) }
}

async function repasar(db: SupabaseClient) {
  // Lo que se quedó a medias (la función se cortó) vuelve a la cola.
  const hace10 = new Date(Date.now() - 10 * 60_000).toISOString()
  await db.from('conta_aviso').update({ estado: 'fallo', porque: 'Se quedó a medias: se vuelve a intentar.', proximo_intento_at: new Date().toISOString() })
    .eq('origen', 'crm').eq('estado', 'trabajando').lt('proximo_intento_at', hace10)
  const ahora = new Date().toISOString()
  const { data } = await db.from('conta_aviso').select('account_id, crm').eq('origen', 'crm')
    .or(`estado.eq.pendiente,and(estado.eq.fallo,proximo_intento_at.lte.${ahora})`).limit(1000)
  const cuentas = new Map<string, string>()
  for (const r of (data ?? []) as { account_id: string; crm: string }[]) cuentas.set(`${r.account_id}|${r.crm}`, r.crm)
  for (const k of cuentas.keys()) { const [cuenta, crm] = k.split('|'); await trabajarCuenta(db, cuenta, crm) }
  return cuentas.size
}

/** «Probar»: Sumied se manda a sí mismo un aviso de prueba con el código guardado y mira si ha llegado. */
async function probar(db: SupabaseClient, supabaseUrl: string, cuenta: string, crm: string): Promise<{ ok: boolean; frase: string }> {
  const { data: sec } = await db.rpc('conta_aviso_secreto', { p_origen: 'crm', p_account: cuenta, p_crm: crm, p_company: null })
  const s = (sec as { encendido: boolean; codigo: string | null }[] | null)?.[0]
  const de = nombreDelCrm(crm)
  if (!s?.codigo) return { ok: false, frase: `Aún no se ha pegado el código de ${de}: pégalo en «Cómo activarlo».` }
  if (!s.encendido) return { ok: false, frase: `«Al instante» está apagado: enciéndelo y vuelve a probar.` }
  const desde = new Date().toISOString()
  const f = new URLSearchParams({ event: PRUEBA, ts: String(Math.floor(Date.now() / 1000)), 'auth[application_token]': s.codigo })
  const r = await fetch(`${supabaseUrl}/functions/v1/conta-crm-aviso?${new URLSearchParams({ cuenta, crm })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() })
  const { data } = await db.from('conta_aviso').select('id').eq('account_id', cuenta).eq('origen', 'crm').eq('estado', 'prueba').gte('recibido_at', desde).limit(1)
  return r.ok && (data ?? []).length
    ? { ok: true, frase: `Probado: Sumied ha recibido un aviso de prueba con el código de ${de}. La dirección y el código funcionan; falta que ${de} mande los suyos.` }
    : { ok: false, frase: `El aviso de prueba no ha llegado (respuesta ${r.status}). Mira que el código pegado sea el de ${de}.` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const u = new URL(req.url)
  try {
    // El aviso del CRM: un formulario, con la cuenta y el CRM en la dirección.
    if ((req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
      const cuenta = u.searchParams.get('cuenta') ?? ''
      const crm = u.searchParams.get('crm') ?? ''
      if (!UUID.test(cuenta) || !CRMS.includes(crm)) return json(401, { error: 'No.' })
      return await recibir(admin, cuenta, crm, await req.text())
    }
    let cuerpo: Record<string, unknown> = {}
    try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
    const secreto = Deno.env.get('CRON_SECRET') ?? ''
    if (cuerpo.accion === 'repasar') {
      if (!secreto || req.headers.get('x-cron-secret') !== secreto) return json(401, { error: 'No.' })
      return json(200, { ok: true, cuentas: await repasar(admin) })
    }
    if (cuerpo.accion === 'probar') {
      const cuenta = String(cuerpo.cuenta ?? ''); const crm = String(cuerpo.crm ?? '')
      if (!UUID.test(cuenta) || !CRMS.includes(crm)) return json(400, { error: 'Falta la cuenta.' })
      const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
      const { data: quien } = await persona.auth.getUser()
      if (!quien?.user) return json(401, { error: 'Entra en Sumied para probarlo.' })
      const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: cuenta })
      if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta lo prueba.' })
      return json(200, await probar(admin, supabaseUrl, cuenta, crm))
    }
    return json(400, { error: 'Acción: repasar o probar.' })
  } catch (e) {
    // En el registro, el qué y nunca el código (T11).
    console.error('[conta-crm-aviso]', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'No se ha podido atender el aviso.' })
  }
})
