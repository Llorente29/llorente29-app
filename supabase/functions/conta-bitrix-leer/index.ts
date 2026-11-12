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
//   · G01b · { accion: 'ensayo_union', cuenta } — «Ver qué se va a unir (PDF)»:
//     lee Bitrix24 y devuelve al navegador de quien está dentro de la cuenta
//     lo que haría la unión (clientes.ts). No escribe nada ni lo registra.
//
// La cuenta de demostración solo lee el Bitrix24 de pruebas (salida.ts).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { MAPA_QBO, proponerMapa, type MapaBitrix } from './mapa.ts'
import { fraseDeBitrix, fraseDelReparto, leerContactos, leerFichas, leerParaRecuento, medirCampos, portalDe, repartoDe } from './lectura.ts'
import { ensayoDeUnion, nifComoLaBase } from '../_shared/crm/clientes.ts'
import { claveDeFicha } from '../_shared/crm/ficha.ts'
import { fichasDeClientes, guardarLectura, type LecturaDelCrm } from '../_shared/crm/leer.ts'
import type { MapaContactos } from './contactosClientes.ts'

/** G01c · Este adaptador es el de Bitrix24: su CRM en conta_crm. */
const CRM = 'bitrix24'
import { gruposValidos } from './recuento.ts'
import { revisarClave } from './clave.ts'
import { puedeLeer, type Entorno } from './salida.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** G01c · Los clientes de GoCardless ya leídos en Sumied (NIF y correo): una señal de cliente de los contactos. Se usan dentro: no salen. */
async function gocardlessDe(db: SupabaseClient, cuenta: string) {
  const gocardless = { nifs: new Set<string>(), correos: new Set<string>() }
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from('conta_gc_cliente').select('nif, correo').eq('account_id', cuenta).order('gc_id').range(desde, desde + 999)
    if (error) throw new Error(`No se han podido leer los clientes de GoCardless: ${error.message}`)
    for (const g of (data ?? []) as { nif: string | null; correo: string | null }[]) {
      const n = nifComoLaBase(g.nif)
      if (n) gocardless.nifs.add(n)
      if (g.correo?.trim()) gocardless.correos.add(g.correo.trim().toLowerCase())
    }
    if ((data ?? []).length < 1000) break
  }
  return gocardless
}

/**
 * G01c · De la conexión con Bitrix24 en conta_crm: el mapa de contactos
 * guardado (confirmado o no) y la unión aplicada. La unión se lee de su
 * columna, no del mapa: confirmar el mapa la quitaba (07/11, 20:05 UTC).
 */
async function deLaConexion(db: SupabaseClient, cuenta: string): Promise<{ mapaContactos: MapaContactos | null; unionAplicada: boolean }> {
  const { data, error } = await db.from('conta_crm').select('mapa_contactos, union_aplicada').eq('account_id', cuenta).eq('crm', CRM).maybeSingle()
  if (error) throw new Error(`No se ha podido leer la conexión con el CRM: ${error.message}`)
  const d = data as { mapa_contactos?: MapaContactos | null; union_aplicada?: unknown } | null
  return { mapaContactos: d?.mapa_contactos ?? null, unionAplicada: !!d?.union_aplicada }
}

/** G01c · Lo que lee el adaptador de Bitrix24: las empresas y los contactos, a fichas neutras. */
async function leerDeBitrix(db: SupabaseClient, cuenta: string, url: string, mapa: MapaBitrix) {
  const { fichas, bloqueados } = await leerFichas(fetch, url, mapa, esperar)
  const { mapaContactos: guardado, unionAplicada } = await deLaConexion(db, cuenta)
  const c = await leerContactos(fetch, url, guardado, esperar, await gocardlessDe(db, cuenta))
  const lectura: LecturaDelCrm = { crm: CRM, empresas: fichas, unir: unionAplicada,
    contactos: c.mapa ? { contactos: c.contactos, confirmado: !!guardado?.confirmado } : null }
  return { lectura, bloqueados, medidosContactos: c.medidos }
}

async function leer(db: SupabaseClient, cuenta: string, por: 'persona' | 'cada_noche' | 'conexion', quien: string | null) {
  const { data: sec, error: secErr } = await db.rpc('conta_crm_secreto', { p_account: cuenta, p_crm: CRM })
  if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
  const s = (sec as { entorno: Entorno; url: string; mapa: MapaBitrix | null }[] | null)?.[0]
  if (!s?.url) throw new Error('Esta cuenta no tiene conectado Bitrix24.')
  const mapa = s.mapa ?? MAPA_QBO

  const { data: lect, error: lectErr } = await db.from('conta_gestoria_lectura')
    .insert({ account_id: cuenta, origen: 'crm', entorno: s.entorno, por, quien_name: quien }).select('id').single()
  if (lectErr) throw new Error(`No se ha podido apuntar la lectura: ${lectErr.message}`)
  const lectura = (lect as { id: string }).id
  const acabar = (campos: Record<string, unknown>) => db.from('conta_gestoria_lectura').update({ acabada_at: new Date().toISOString(), ...campos }).eq('id', lectura)

  const puerta = await puedeLeer(db, cuenta, s.entorno)
  if (!puerta.lee) { await acabar({ estado: 'no_lee', mensaje: puerta.porque }); return { frase: puerta.porque, lee: false } }
  try {
    // Lo propio de Bitrix24 (adaptador), y lo demás en el núcleo neutro (_shared/crm/leer.ts).
    const { lectura: leido, bloqueados, medidosContactos } = await leerDeBitrix(db, cuenta, s.url, mapa)
    const fichas = leido.empresas
    const g = await guardarLectura(db, cuenta, lectura, leido)
    const ahora = new Date().toISOString()
    const { error: eCrm } = await db.from('conta_crm').update({ ultima_lectura_at: ahora, empresas_leidas: fichas.length, campos_medidos_contactos: medidosContactos,
      ...(g.contactosLeidos ? { contactos_leidos: g.contactosLeidos } : {}), updated_at: ahora }).eq('account_id', cuenta).eq('crm', CRM)
    if (eCrm) throw new Error(`No se ha podido guardar lo leído de los contactos: ${eCrm.message}`)
    // G01b · Y cuántas quedan en cada situación, con NIF y con dirección (regla 8: la confirmación lleva contenido).
    const reparto = repartoDe(fichas)
    const partes = [fraseDeBitrix(fichas.length, g.suma, por === 'conexion'), fraseDelReparto(reparto, !!mapa.confirmado), ...g.frases]
    if (bloqueados.length) partes.push(`No se leen nunca (contraseñas, certificados o datos bancarios): ${bloqueados.join(', ')}.`)
    const frase = partes.join(' ')
    await acabar({ estado: 'bien', ...g.suma, mensaje: frase })
    const avisos = fichas.flatMap((f) => f.avisos.map((a) => `${f.idExterno}: ${a}`)).slice(0, 50)
    return { frase, lee: true, empresas: fichas.length, ...g.suma, juntados: g.juntados, activas: reparto.activo, reparto, union: leido.unir ? g.union : null,
      noGuardados: g.errores.length, confirmado: !!mapa.confirmado, contactos: g.contactosLeidos?.resumen ?? null, avisos }
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
    // La clave de servicio, en cualquiera de sus dos formatos (la antigua o la nueva sb_secret_…).
    const clave = revisarClave(req.headers.get('x-internal-key'), {
      antigua: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', nuevas: Deno.env.get('SUPABASE_SECRET_KEYS') ?? '',
    })
    if (!clave.vale) {
      console.error('[conta-bitrix-leer] recuento sin la clave de servicio:', clave.porque)
      return json(403, { error: `El recuento solo se lanza desde su workflow, con la clave de servicio: ${clave.porque}.` })
    }
    const grupos = gruposValidos(cuerpo.grupos)
    if (!grupos) return json(400, { error: 'Faltan los campos a contar: texto (por grupo), situacion y cuotas, con sus códigos de Bitrix24.' })
    try {
      const { data: sec, error: secErr } = await admin.rpc('conta_crm_secreto', { p_account: cuenta, p_crm: CRM })
      if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
      const s = (sec as { entorno: Entorno; url: string; mapa: MapaBitrix | null }[] | null)?.[0]
      if (!s?.url) return json(400, { error: 'Esta cuenta no tiene conectado Bitrix24.' })
      const puerta = await puedeLeer(admin, cuenta, s.entorno)
      if (!puerta.lee) return json(400, { error: puerta.porque })
      // G01b · Para los repetidos, la situación como la dice el mapa confirmado (si lo está y es el mismo campo).
      const sit = s.mapa?.confirmado ? s.mapa.campos.find((c) => c.campo === 'situacion' && c.codigo === grupos.situacion)?.opciones ?? null : null
      // G01c · Los clientes de GoCardless ya leídos en Sumied (NIF y correo), para contar los contactos casados con uno. No salen del recuento.
      const gocardless = grupos.contactos ? await gocardlessDe(admin, cuenta) : { nifs: new Set<string>(), correos: new Set<string>() }
      const { mapaContactos } = grupos.contactos ? await deLaConexion(admin, cuenta) : { mapaContactos: null }
      return json(200, { ok: true, entorno: s.entorno, portal: portalDe(s.url), ...(await leerParaRecuento(fetch, s.url, grupos, esperar, sit, gocardless, mapaContactos)) })
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
      const { error } = await admin.rpc('conta_crm_guardar_conexion', { p_account: cuenta, p_crm: CRM, p_entorno: entorno, p_url: url, p_portal: portal, p_quien: quien })
      if (error) return json(400, { error: error.message })
      // G01b · Lo medido y el mapa (con sus dudas) se guardan de verdad: si no se puede, se dice.
      const { error: eMapa } = await admin.from('conta_crm').update({ mapa: propuesta.mapa, campos_medidos: medidos, updated_at: new Date().toISOString() }).eq('account_id', cuenta).eq('crm', CRM)
      if (eMapa) return json(500, { error: `Conectado, pero no se ha podido guardar el mapa de los campos: ${eMapa.message}` })
      const res = await leer(admin, cuenta, 'conexion', quien)
      await leerGocardlessDeLaCuenta(admin, cuenta, supabaseUrl)
      return json(200, { ok: true, ...res, portal, queEsCadaUno: propuesta.queEsCadaUno, sinUsar: propuesta.sinUsar })
    }
    if (cuerpo.accion === 'ensayo_union') {
      // G01b · Lo que haría la unión, para el PDF que descarga quien está dentro de la cuenta. No escribe nada ni lo registra.
      if (esCron) return json(403, { error: 'El ensayo lo pide una persona.' })
      const { data: sec, error: secErr } = await admin.rpc('conta_crm_secreto', { p_account: cuenta, p_crm: CRM })
      if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
      const s = (sec as { entorno: Entorno; url: string; mapa: MapaBitrix | null }[] | null)?.[0]
      if (!s?.url || !s.mapa) return json(400, { error: 'Esta cuenta no tiene conectado Bitrix24.' })
      if (!s.mapa.confirmado) return json(400, { error: 'Primero hay que confirmar el mapa en «Qué es cada campo»: sin él no se sabe la situación de cada ficha.' })
      const puerta = await puedeLeer(admin, cuenta, s.entorno)
      if (!puerta.lee) return json(400, { error: puerta.porque })
      // G01c · Con los contactos que entran como clientes (con su mapa confirmado): un contacto con el NIF de una empresa se une a ella.
      const { lectura: leido } = await leerDeBitrix(admin, cuenta, s.url, s.mapa)
      const { fichas } = fichasDeClientes(leido)
      // Qué cliente de Sumied es hoy cada ficha: para decir cuántos clientes ya creados se juntan.
      const clienteDeFicha = new Map<string, string>()
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await admin.from('conta_gestoria_ficha').select('tipo_ficha, id_externo, party_id').eq('account_id', cuenta).eq('crm', CRM).eq('de_empresa', '')
          .order('id_externo').range(desde, desde + 999)
        if (error) throw new Error(`No se han podido leer las fichas de Sumied: ${error.message}`)
        for (const x of (data ?? []) as { tipo_ficha: 'empresa' | 'contacto'; id_externo: string; party_id: string }[]) clienteDeFicha.set(claveDeFicha({ tipoFicha: x.tipo_ficha, idExterno: x.id_externo }), x.party_id)
        if ((data ?? []).length < 1000) break
      }
      const { data: acc } = await admin.from('accounts').select('name').eq('id', cuenta).single()
      return json(200, { ok: true, empresa: (acc as { name?: string } | null)?.name ?? 'La cuenta', portal: portalDe(s.url), leido: new Date().toISOString(),
        aplicada: leido.unir, ...ensayoDeUnion(fichas, clienteDeFicha) })
    }
    if (cuerpo.accion === 'leer') {
      const res = await leer(admin, cuenta, esCron ? 'cada_noche' : 'persona', quien)
      await leerGocardlessDeLaCuenta(admin, cuenta, supabaseUrl)
      return json(200, { ok: true, ...res })
    }
    return json(400, { error: 'Acción: conectar, leer o ensayo_union.' })
  } catch (e) {
    // En el registro, el qué y nunca la dirección con su clave (T11).
    console.error('[conta-bitrix-leer]', e instanceof Error ? e.message : String(e))
    return json(500, { error: e instanceof Error ? e.message : 'No se ha podido leer Bitrix24.' })
  }
})
