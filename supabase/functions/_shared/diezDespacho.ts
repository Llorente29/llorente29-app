// supabase/functions/_shared/diezDespacho.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · MANDAR UN ASIENTO A DIEZ,
// SEA DEL TIPO QUE SEA, desde una edge function. Lo usan:
//   · conta-diez-enviar: la pantalla, con la sesión de quien pulsa («Reintentar»,
//     o al validar);
//   · conta-diez-cola: el servidor, sin sesión, con lo que conta_diez_reclamar
//     le da (lo validado que no está en Diez).
// Aquí se pone el mundo (Supabase, el Vault, el bucket y el cliente de Diez) y
// se elige el camino; lo que decide está en diezEnviar.ts, probado freno a
// freno.
//
//   · «Enviar a Diez» apagado en la empresa (conta_diez_envio_empresa): no se
//     manda nada ni se escribe nada.
//   · Lo que no va a Diez (lo traído de Diez, apertura, cierre, plantillas) lo
//     dice y no se reintenta.
//   · Después de cada intento, la fila del envío dice cuándo se vuelve a
//     intentar (next_try_at): a los 15 minutos si se puede, nunca si no.
//
// El asiento se lee con `lector`: el cliente con la sesión de quien llama (si
// no es de su cuenta, no está) o el de servicio (el servidor; las lecturas lo
// admiten desde la 0450). Lo que solo escribe el servidor (external_send, la
// conexión, el Vault, el bucket), siempre con `srv`.
//
// C12 (Julio, 24/10) · El traspaso del mes (conta-diez-traspaso) pasa
// `traspaso`: los asientos de la lista del mes que un administrador ha
// confirmado después de ver su resumen. Para esos, confirmar vale como la
// autorización escrita de Julio para escribir en Diez real (banco, manuales y
// liquidaciones incluidos); queda quién y cuándo en conta_diez_traspaso. Lo que
// no está en la lista sigue con la autorización de siempre (conta_diez_autorizo).

import { cuentaPuedeSalir, EN_LA_DEMO } from './puerta.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ClienteDiez, type AlmacenToken } from './diezCliente.ts'
import { correspondenciaDeEmpresa } from './diezAnalitica.ts'
import { comoVa, porQueNoVa, type AsientoBD } from './diezApunte.ts'
import {
  autorizacionCubre, enviarApunteADiez, enviarAsientoADiez, enviarContraasientoADiez, enviarContraasientoRecibidaADiez, enviarRecibidaADiez,
  type Autorizacion, type ConexionDiez, type ContraasientoBD, type EnvioFila, type PuertoApunte, type PuertoEnvio, type RecibidaBD, type ResultadoEnvio,
} from './diezEnviar.ts'
import type { ResumenBD } from './resumenDeAsiento.ts'

const BUCKET = 'conta-documentos'
/** Cuánto espera el servidor para volver a intentar lo que se puede reintentar. */
export const REINTENTO_MIN = 15
export const APAGADO = 'el envío a Diez está apagado en esta empresa (Ajustes › Ejercicio › Enviar a Diez)'
/** C12: en una empresa que traspasa una vez al mes, nada sale suelto (ni al validar, ni con «Reintentar», ni de una pantalla vieja). */
export const MENSUAL = 'esta empresa traspasa a Diez una vez al mes: va en el traspaso del mes (Contabilidad › Cierre)'

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
/** DM1 · PR 2a: el motivo de una cuenta de demo. */
export const EN_LA_DEMO_DIEZ = `${EN_LA_DEMO.replace(/\.$/, '')}: una empresa de demostración no manda nada a Diez`
const noLlega = (motivo: string, reintentar: boolean): ResultadoEnvio => ({ estado: 'no_llega', motivo, reintentar, texto: `No ha llegado a Diez: ${motivo}.` })

type Cabecera = { id: string; account_id: string; company_id: string; status: string; entry_date: string; source_type: string; reverses_entry_id: string | null; number: number | null }

/** ¿Está encendido «Enviar a Diez» en la empresa? Sin fila, no. */
export async function enviarEncendido(srv: SupabaseClient, accountId: string, companyId: string): Promise<boolean> {
  return (await comoEnviaLaEmpresa(srv, accountId, companyId)).encendido
}

/** Encendido y, desde el C12, si traspasa una vez al mes (modo 'mensual'). Sin la columna (una base sin la 1250), al validar. */
export async function comoEnviaLaEmpresa(srv: SupabaseClient, accountId: string, companyId: string): Promise<{ encendido: boolean; mensual: boolean }> {
  const leer = (campos: string) => srv.from('conta_diez_envio_empresa').select(campos).eq('company_id', companyId).eq('account_id', accountId).maybeSingle()
  let { data, error } = await leer('enviar, modo')
  if (error && (error.code === '42703' || /modo/.test(error.message))) ({ data, error } = await leer('enviar'))
  if (error) throw new Error(`no se ha podido leer si el envío a Diez está encendido: ${error.message}`)
  const f = data as { enviar?: boolean; modo?: string | null } | null
  return { encendido: f?.enviar === true, mensual: f?.modo === 'mensual' }
}

/** Después de un intento: el motivo y cuándo se vuelve a intentar, en la fila que haya (si no está ya en Diez). */
async function apuntarSiguiente(srv: SupabaseClient, j: Cabecera, r: ResultadoEnvio): Promise<void> {
  const { data: e } = await srv.from('external_send').select('id, status').eq('entry_id', j.id).eq('account_id', j.account_id).neq('status', 'rechazado').maybeSingle()
  if (!e || e.status === 'enviado' || e.status === 'enlazado') {
    if (e) await srv.from('external_send').update({ next_try_at: null }).eq('id', e.id).eq('account_id', j.account_id)
    return
  }
  if (r.estado === 'en_diez') return
  const cuando = r.reintentar ? new Date(Date.now() + REINTENTO_MIN * 60_000).toISOString() : null
  const { error } = await srv.from('external_send').update({ last_error: r.motivo, next_try_at: cuando, updated_at: new Date().toISOString() }).eq('id', e.id).eq('account_id', j.account_id)
  if (error) console.error(`diezDespacho · ${j.id} · no se ha podido apuntar el siguiente intento`)
}

/**
 * Manda a Diez el asiento `entryId` por el camino que le toca. Nunca lanza: lo
 * que se rompe vuelve como «no ha llegado» con su motivo (y queda en su fila).
 */
export async function despacharADiez(o: { lector: SupabaseClient; srv: SupabaseClient; entryId: string; traspaso?: ReadonlySet<string> }): Promise<ResultadoEnvio & { cabecera?: Cabecera }> {
  const { lector, srv, entryId, traspaso } = o
  const { data: je, error: e0 } = await lector.from('journal_entry')
    .select('id, account_id, company_id, status, entry_date, source_type, reverses_entry_id, number').eq('id', entryId).maybeSingle()
  if (e0) return noLlega(e0.message, true)
  if (!je) return noLlega('ese asiento no está', false)
  const j = je as Cabecera
  const r = await despachar(lector, srv, j, traspaso).catch((x: unknown) => noLlega(`se cortó: ${x instanceof Error ? x.message : String(x)}`, true))
  await apuntarSiguiente(srv, j, r).catch(() => console.error(`diezDespacho · ${j.id} · sin apuntar el siguiente intento`))
  return { ...r, cabecera: j }
}

async function despachar(lector: SupabaseClient, srv: SupabaseClient, j: Cabecera, traspaso?: ReadonlySet<string>): Promise<ResultadoEnvio> {
  // DM1 · PR 2a · La puerta: una cuenta de demo no manda nada a Diez. Como el
  // interruptor apagado: no llega y no se reintenta, y lo dice.
  if (!(await cuentaPuedeSalir(srv, j.account_id))) return noLlega(EN_LA_DEMO_DIEZ, false)
  const como_ = await comoEnviaLaEmpresa(srv, j.account_id, j.company_id)
  if (!como_.encendido) return noLlega(APAGADO, false)
  // C12: en mensual, solo lo que va dentro del traspaso confirmado del mes.
  if (como_.mensual && !traspaso?.has(j.id)) return noLlega(MENSUAL, false)

  let anulaOrigen: string | null = null
  if (j.reverses_entry_id) {
    const { data: an, error } = await lector.from('journal_entry').select('source_type').eq('id', j.reverses_entry_id).eq('account_id', j.account_id).maybeSingle()
    if (error) return noLlega(error.message, true)
    anulaOrigen = an?.source_type ?? null
  }
  const como = comoVa(j.source_type, anulaOrigen)
  if (como === 'no_va') return noLlega(porQueNoVa(j.source_type === 'reversal' ? String(anulaOrigen) : j.source_type), false)

  const comun = puertoComun(srv, j.account_id, traspaso)

  if (como === 'apunte' || como === 'contra_apunte') {
    const { data, error } = await lector.rpc('conta_asiento_envio', { p_entry: j.id })
    if (error) return noLlega(`no se ha podido leer el asiento: ${error.message}`, error.code !== 'P0002')
    const a = data as AsientoBD
    const asiento: AsientoBD = { ...a, serie: Number(a.serie), fecha: String(a.fecha), lineas: (a.lineas ?? []).map((l) => ({ cuenta: String(l.cuenta), debe: Number(l.debe), haber: Number(l.haber), concepto: l.concepto == null ? null : String(l.concepto) })) }
    const p: PuertoApunte = {
      ...comun, clienteApuntes: (c, op) => clienteDiez(srv, c, op),
      enlazados: (companyId, menosEntry) => enlazadosEnDiez(srv, j.account_id, companyId, menosEntry),
    }
    return enviarApunteADiez(asiento, p)
  }

  // Las facturas: la venta del día o la recibida (o, para un contraasiento, lo que anula).
  const esRecibida = como === 'recibida' || como === 'contra_recibida'
  const contra: ContraasientoBD | null = j.source_type === 'reversal'
    ? { id: j.id, account_id: j.account_id, company_id: j.company_id, estado: j.status, fecha: String(j.entry_date), origen: j.source_type, anula: j.reverses_entry_id, numero: j.number }
    : null
  const { data: leido, error: e1 } = await lector.rpc(esRecibida ? 'conta_recibida_envio' : 'conta_resumen_ventas', { p_entry: contra?.anula ?? j.id })
  if (e1) return noLlega(`no se ha podido leer el asiento: ${e1.message}`, false)
  const r = leido as ResumenBD
  const rec = leido as unknown as RecibidaBD
  const puerto: PuertoEnvio & { recibida(id: string): Promise<RecibidaBD> } = {
    ...comun,
    resumen: async (id) => {
      if (id === r.id) return r
      const { data, error } = await lector.rpc('conta_resumen_ventas', { p_entry: id })
      if (error) throw new Error(error.message)
      return data as ResumenBD
    },
    // Los números de la base llegan como texto o número: se pasan a número.
    recibida: async () => ({ ...rec, lineas: (rec.lineas ?? []).map((l) => ({ cuenta: String(l.cuenta), debe: Number(l.debe), haber: Number(l.haber), tipoIva: l.tipoIva == null ? null : Number(l.tipoIva), baseIva: l.baseIva == null ? null : Number(l.baseIva), tratamiento: l.tratamiento == null ? null : String(l.tratamiento) })) }),
    cliente: (c, op) => clienteDiez(srv, c, op),
    documento: async (ruta) => {
      if (!ruta.startsWith(`${r.account_id}/${r.id}/`)) throw new Error('la ruta del documento no es la de este asiento')
      const { data, error } = await srv.storage.from(BUCKET).download(ruta)
      if (error || !data) throw new Error(`no se ha podido leer el documento guardado: ${error?.message ?? 'vacío'}`)
      return new Uint8Array(await data.arrayBuffer())
    },
    correspondencia: (companyId) => correspondenciaDeEmpresa(companyId),
    // C11c (24/10): el rehecho de un asiento anulado ni enlaza la factura del anulado ni repite su número.
    enlazados: (companyId, menosEntry) => enlazadosEnDiez(srv, j.account_id, companyId, menosEntry),
    vezDelNumero: async (entryId, base) => {
      const { data, error } = await srv.rpc('conta_diez_numero_vez', { p_entry: entryId, p_base: base })
      if (error) throw new Error(`no se ha podido saber la vez del número ${base}: ${error.message}`)
      return Number(data ?? 1)
    },
  }
  if (contra) return como === 'contra_recibida' ? enviarContraasientoRecibidaADiez(contra, puerto) : enviarContraasientoADiez(contra, puerto)
  return esRecibida ? enviarRecibidaADiez(j.id, puerto) : enviarAsientoADiez(j.id, puerto)
}

/**
 * Los documentos de Diez («serie/documento») que ya son de OTRO asiento de la
 * empresa (cualquier envío no rechazado con documento). Los usan los apuntes
 * (bancos gemelos, 22/10) y, desde el C11c (24/10), las facturas y sus
 * contraasientos: el rehecho de un asiento anulado no enlaza la del anulado.
 */
async function enlazadosEnDiez(srv: SupabaseClient, accountId: string, companyId: string, menosEntry: string): Promise<Set<string>> {
  const { data, error } = await srv.from('external_send').select('ext_series, ext_number')
    .eq('account_id', accountId).eq('company_id', companyId).neq('entry_id', menosEntry)
    .neq('status', 'rechazado').not('ext_number', 'is', null)
  if (error) throw new Error(`no se ha podido leer lo enviado a Diez: ${error.message}`)
  return new Set((data ?? []).map((x) => `${x.ext_series}/${x.ext_number}`))
}

/** Lo que todos los caminos leen y escriben con la clave de servicio. */
function puertoComun(srv: SupabaseClient, accountId: string, traspaso?: ReadonlySet<string>): Pick<PuertoEnvio, 'envio' | 'guardar' | 'conexion' | 'autorizado' | 'sha256' | 'ahora'> {
  return {
    envio: async (id) => {
      const { data, error } = await srv.from('external_send').select('*').eq('entry_id', id).eq('account_id', accountId).neq('status', 'rechazado').maybeSingle()
      if (error) throw new Error(`no se ha podido leer el envío: ${error.message}`)
      return data as EnvioFila | null
    },
    guardar: async (f) => {
      const { id, ...resto } = f as EnvioFila & { created_at?: string; updated_at?: string }
      delete (resto as Record<string, unknown>).created_at
      const fila = { ...resto, updated_at: new Date().toISOString() }
      const q = id ? srv.from('external_send').update(fila).eq('id', id).eq('account_id', accountId) : srv.from('external_send').insert(fila)
      const { data, error } = await q.select('*').single()
      if (error) throw new Error(`no se ha podido apuntar el envío: ${error.message}`)
      return data as EnvioFila
    },
    conexion: async (companyId) => {
      const { data, error } = await srv.from('account_connector')
        .select('id, external_account_id, config, status, connector!inner(code)')
        .eq('account_id', accountId).eq('company_id', companyId).eq('scope', 'company').eq('connector.code', 'diez').eq('status', 'connected').maybeSingle()
      if (error) throw new Error(`no se ha podido leer la conexión con Diez: ${error.message}`)
      if (!data) return null
      const config = (data.config as Record<string, unknown> | null) ?? {}
      const bd = String(data.external_account_id ?? config.nombre_bd ?? '')
      return bd ? { id: String(data.id), nombreBd: bd, adjuntar: config.adjuntar_documentos === true } : null
    },
    autorizado: async (id, companyId, nombreBd, fecha, tipo) => {
      // C12: lo que está en el traspaso confirmado del mes, autorizado (véase la cabecera).
      if (traspaso?.has(id)) return true
      // R8: «desde» limita la de empresa; incluye_recibidas (0740) e incluye_asientos (0450) abren cada tipo.
      const { data, error } = await srv.from('conta_diez_autorizo').select('id, alcance, entry_id, desde, incluye_recibidas, incluye_asientos')
        .eq('account_id', accountId).eq('company_id', companyId).ilike('nombre_bd', nombreBd)
      if (error) throw new Error(`no se ha podido leer lo autorizado en Diez: ${error.message}`)
      return autorizacionCubre((data ?? []) as Autorizacion[], id, fecha, tipo)
    },
    sha256: async (b) => hex(await crypto.subtle.digest('SHA-256', b as BufferSource)),
    ahora: () => new Date(),
  }
}

/**
 * C12 · El cliente de Diez de una empresa SOLO PARA LEER (la comprobación del
 * traspaso: los apuntes del mes). Sin conexión, null. Con escribir apagado: el
 * propio cliente para cualquier escritura (FrenoDiez).
 */
export async function clienteDiezParaLeer(srv: SupabaseClient, accountId: string, companyId: string): Promise<{ cliente: ClienteDiez; nombreBd: string } | null> {
  const c = await puertoComun(srv, accountId).conexion(companyId)
  if (!c) return null
  return { cliente: await clienteDiez(srv, c, { real: false, escribir: false }), nombreBd: c.nombreBd }
}

/** El cliente de Diez de una conexión (escribir: sí; escribirEnReal solo con autorización, que el núcleo ya ha mirado). */
async function clienteDiez(srv: SupabaseClient, c: ConexionDiez, o: { real: boolean; escribir?: boolean }): Promise<ClienteDiez> {
  const { data: s, error } = await srv.rpc('connector_secret_read', { p_account_connector_id: c.id })
  if (error || !s) throw new Error('la conexión con Diez no tiene credenciales guardadas')
  const sec = (s as { secrets: Record<string, string>; config: Record<string, unknown> }).secrets
  const cfg = (s as { config: Record<string, unknown> }).config ?? {}
  const almacen: AlmacenToken = {
    leer: async () => {
      const { data } = await srv.rpc('connector_token_read', { p_account_connector_id: c.id })
      const t = data as { token: string; expires_at: string } | null
      return t ? { token: t.token, expiresAt: t.expires_at } : null
    },
    guardar: async (token, expiresAt) => { await srv.rpc('connector_token_save', { p_account_connector_id: c.id, p_token: token, p_expires_at: expiresAt }) },
    caida: async (motivo) => { await srv.rpc('connector_mark_down', { p_account_connector_id: c.id, p_error: motivo }) },
  }
  return new ClienteDiez({
    base: String(cfg.base_url ?? 'https://apicon.diezsoftware.com'), nombreBd: c.nombreBd,
    credenciales: { grant_type: sec.grant_type, client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password },
    almacen, escribir: o.escribir ?? true, escribirEnReal: o.real, pausaMs: 150,
  })
}
