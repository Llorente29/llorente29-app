// supabase/functions/_shared/revolut/servidor.ts
//
// B01 Revolut · PR 1 · LO QUE HACEN LAS FUNCIONES conta-revolut-*, sin Deno: la
// base llega como un cliente mínimo de Supabase (rpc y from) y la red como
// `fetch`. Así se prueba entero con vitest (tests/unit/modules/conta/revolut/
// servidor.test.ts), con una base y un Revolut simulados.
//
//   · `tokenDeAcceso`: renueva el token con el de renovación del Vault (y
//     guarda el nuevo si Revolut lo cambia). Si Revolut ya no acepta el
//     permiso (se quitó el certificado en Revolut), desconecta la empresa
//     como «retirada» y lo dice.
//   · `baseDeRevolut`: la BaseAgregador de siempre (bank_importar,
//     bank_agregador_apuntar) más `conocidos`: qué ids de Revolut ya están.
//   · `leerEmpresa`: una lectura de una empresa, hasta HOY (respuesta 3), y lo
//     apunta en revolut_conexion.
//
// En ningún registro va un secreto, un token, el client_id ni un IBAN entero:
// solo los cuatro últimos y recuentos (T11).

import { sincronizarEmpresa, type BaseAgregador, type ParteCuenta } from '../bancoAgregador.ts'
import { clienteRevolut, dejanPagar, entornoDe, FalloRevolut, pedirToken, type EntornoRevolut } from './cliente.ts'
import { proveedorPagoRevolut } from './pago.ts'
import { diaMadrid, OPCIONES_REVOLUT, proveedorRevolut } from './lectura.ts'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
interface Resultado<T = unknown> { data: T | null; error: { message: string; code?: string } | null }
/** Lo mínimo del cliente de Supabase (con la clave de servicio) que hace falta. */
export interface Srv {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Resultado>
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el constructor de consultas de supabase-js, sin atar su tipo aquí
  from(tabla: string): any
}

export interface ConexionRevolut {
  id: string; account_id: string; company_id: string; entorno: EntornoRevolut; estado: string
  vuelta: string; permisos: string | null; desde_historico: string | null; last_run_at: string | null; webhook_id: string | null
}
export const COLUMNAS_CONEXION = 'id, account_id, company_id, entorno, estado, vuelta, permisos, desde_historico, last_run_at, webhook_id'

/** Un secreto de Revolut de una empresa, del Vault (solo con la clave de servicio). */
export async function secreto(srv: Srv, empresa: string, que: 'privada' | 'client_id' | 'renovacion' | 'aviso'): Promise<string | null> {
  const { data, error } = await srv.rpc('conta_revolut_secreto', { p_company: empresa, p_que: que })
  if (error) throw new Error(`No se ha podido leer un secreto de Revolut del Vault: ${error.message}`)
  return typeof data === 'string' && data ? data : null
}

export async function guardarSecreto(srv: Srv, empresa: string, que: 'privada' | 'client_id' | 'renovacion' | 'aviso', valor: string): Promise<void> {
  const { error } = await srv.rpc('conta_revolut_secreto_poner', { p_company: empresa, p_que: que, p_valor: valor })
  if (error) throw new Error(`No se ha podido guardar un secreto de Revolut en el Vault: ${error.message}`)
}

/** Lo que pasa cuando Revolut ya no acepta el permiso: la conexión queda «retirada» y se dice. */
export class PermisoRetirado extends Error {
  constructor() { super('Revolut ya no acepta el permiso de Sumied: se ha quitado el certificado en Revolut o ha caducado. Vuelve a conectar Revolut.') }
}

/** Un token de acceso nuevo para la empresa, con el de renovación del Vault. */
export async function tokenDeAcceso(srv: Srv, f: Fetch, c: ConexionRevolut, ahora = new Date()): Promise<string> {
  const [privada, clientId, renovacion] = await Promise.all([secreto(srv, c.company_id, 'privada'), secreto(srv, c.company_id, 'client_id'), secreto(srv, c.company_id, 'renovacion')])
  if (!privada || !clientId || !renovacion) throw new Error('Falta la llave, el client_id o el permiso de Revolut en el Vault: vuelve a conectar Revolut.')
  try {
    const t = await pedirToken(f, c.entorno, { privadaPem: privada, clientId, vuelta: c.vuelta, renovacion, ahora })
    if (t.renovacion && t.renovacion !== renovacion) await guardarSecreto(srv, c.company_id, 'renovacion', t.renovacion)
    return t.acceso
  } catch (e) {
    if (e instanceof FalloRevolut && e.permisoRetirado) {
      const { error } = await srv.rpc('conta_revolut_desconectar', { p_company: c.company_id, p_quien: null, p_quien_nombre: null, p_desde_revolut: true })
      if (error) throw new Error(`Revolut ya no acepta el permiso, y no se ha podido apuntar: ${error.message}`, { cause: e })
      throw new PermisoRetirado()
    }
    throw e
  }
}

/** La base del agregador, con «qué ids de Revolut ya están» para mandar solo lo nuevo. */
export function baseDeRevolut(srv: Srv): BaseAgregador {
  const fallo = (que: string, e: { message: string }) => new Error(`${que}: ${e.message}`)
  return {
    async bancos(accountId, companyId) {
      const { data, error } = await srv.from('treasury_account').select('id, name, iban')
        .eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true)
      if (error) throw fallo('No se han podido leer los bancos', error)
      return ((data ?? []) as { id: string; name: string; iban: string | null }[]).map((t) => ({ id: String(t.id), nombre: String(t.name), iban: t.iban ? String(t.iban) : null }))
    },
    async extractos(treasuryId) {
      const { data, error } = await srv.from('bank_statement').select('source, period_from, period_to').eq('treasury_account_id', treasuryId)
      if (error) throw fallo('No se han podido leer los extractos', error)
      return ((data ?? []) as { source: string; period_from: string; period_to: string }[]).map((e) => ({ fuente: String(e.source), desde: String(e.period_from), hasta: String(e.period_to) }))
    },
    async importar(args) {
      const { data, error } = await srv.rpc('bank_importar', args)
      if (error) throw fallo('La base no lo ha dejado entrar', error)
      return (data ?? {}) as Record<string, unknown>
    },
    async apuntar(args) {
      const { error } = await srv.rpc('bank_agregador_apuntar', args)
      if (error) throw fallo('No se ha podido apuntar cómo ha ido', error)
    },
    async conocidos(treasuryId, referencias) {
      const out = new Set<string>()
      for (let i = 0; i < referencias.length; i += 200) {
        const trozo = referencias.slice(i, i + 200)
        const { data, error } = await srv.from('bank_movement').select('reference_2').eq('treasury_account_id', treasuryId).in('reference_2', trozo)
        if (error) throw fallo('No se ha podido mirar qué movimientos ya estaban', error)
        for (const m of (data ?? []) as { reference_2: string | null }[]) if (m.reference_2) out.add(m.reference_2)
      }
      return out
    },
  }
}

export interface ParteEmpresa { empresa: string; error: string | null; retirada: boolean; cuentas: ParteCuenta[]; pagos?: { preguntados: number; cambiados: number; fallos: number } }

/**
 * B01 · PR 2b · Los pagos de la empresa que esperan al banco, al día: se le
 * pregunta por cada uno (por su id en el banco o, si no lo hay, por su
 * request_id) y se apunta lo que dice (conta_pago_banco_dice). Lo usan la
 * lectura de cada hora y el aviso: así un pago pasa a pagado o a rechazado sin
 * que nadie abra la pantalla. Sin la 1614 (o sin pagos), no hace nada.
 */
export async function ponerAlDiaPagos(srv: Srv, f: Fetch, c: ConexionRevolut, acceso: string) {
  const out = { preguntados: 0, cambiados: 0, fallos: 0 }
  const { data, error } = await srv.rpc('conta_pago_por_saber', { p_company: c.company_id })
  if (error || !Array.isArray(data) || data.length === 0) return out
  const banco = proveedorPagoRevolut(f, c.entorno, acceso) as ReturnType<typeof proveedorPagoRevolut> & { estado(id: string, porRequestId?: boolean): ReturnType<ReturnType<typeof proveedorPagoRevolut>['estado']> }
  for (const p of data as { salida: string; request_id: string; banco_id: string | null }[]) {
    out.preguntados++
    try {
      const e = p.banco_id ? await banco.estado(p.banco_id) : await banco.estado(p.request_id, true)
      const r = await srv.rpc('conta_pago_banco_dice', { p_salida: p.salida, p_estado: e.estado, p_banco_id: e.bancoId, p_porque: 'porque' in e ? e.porque : null })
      if (r.error) out.fallos++
      else if (!(r.data as { sin_cambio?: boolean })?.sin_cambio) out.cambiados++
    } catch { out.fallos++ }
  }
  return out
}

/**
 * Una lectura de una empresa: token, cuentas, movimientos hasta hoy, y cómo
 * ha ido en revolut_conexion. No lanza: el fallo va en el parte, con su porqué.
 */
export async function leerEmpresa(srv: Srv, f: Fetch, c: ConexionRevolut, ahora = new Date()): Promise<ParteEmpresa> {
  const hoy = diaMadrid(ahora.toISOString())
  const parte: ParteEmpresa = { empresa: c.company_id, error: null, retirada: false, cuentas: [] }
  try {
    const acceso = await tokenDeAcceso(srv, f, c, ahora)
    const p = proveedorRevolut(clienteRevolut(f, c.entorno, acceso), hoy)
    parte.cuentas = await sincronizarEmpresa(baseDeRevolut(srv), p, { accountId: c.account_id, companyId: c.company_id, banco: 'Revolut', renovar: null }, hoy, hoy,
      { ...OPCIONES_REVOLUT, desdeInicial: c.desde_historico })
    if (dejanPagar(c.permisos)) parte.pagos = await ponerAlDiaPagos(srv, f, c, acceso)
  } catch (e) {
    parte.retirada = e instanceof PermisoRetirado
    parte.error = e instanceof Error ? e.message : String(e)
  }
  const mal = parte.error ?? (parte.cuentas.find((x) => x.estado === 'fallo')?.mensaje ?? null)
  const cambios: Record<string, unknown> = { last_run_at: ahora.toISOString(), last_error: mal }
  if (!mal) cambios.last_ok_at = ahora.toISOString()
  if (!parte.retirada) {
    const { error } = await srv.from('revolut_conexion').update(cambios).eq('id', c.id)
    if (error && !parte.error) parte.error = `Se ha leído, pero no se ha podido apuntar: ${error.message}`
  }
  return parte
}

/** Lo que va al registro de una lectura: nada secreto, solo los cuatro últimos y recuentos. */
export function paraElRegistro(p: ParteEmpresa) {
  return { empresa: p.empresa.slice(0, 8), error: p.error, retirada: p.retirada,
    cuentas: p.cuentas.map((x) => ({ iban4: x.iban4, estado: x.estado, leidos: x.leidos, nuevos: x.nuevos, repetidos: x.repetidos, continuidad: x.continuidad })),
    ...(p.pagos ? { pagos: p.pagos } : {}) }
}

export { entornoDe }
