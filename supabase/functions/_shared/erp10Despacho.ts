// supabase/functions/_shared/erp10Despacho.ts
//
// X10 (19/11) · El cliente de ERP10 de una sociedad, armado desde la base con la
// clave de servicio. Las claves están una vez, en la conexión de la CUENTA con el
// conector «erp10» (scope account, en el Vault: connector_secret_read). Cada
// sociedad tiene la suya (scope company): su código de empresa en
// external_account_id y su token en el Vault (connector_token_*).
//
// La lista cerrada son esas conexiones de sociedad de la cuenta, con el NIF de
// cada sociedad (company.tax_id). Nada más: Sumied no pide a Cegid la lista de
// empresas del despacho.
//
// No es la conexión de Diez: aquí todo filtra por connector.code = 'erp10', y
// diezDespacho.ts por 'diez' (tests/conta/erp10/conexiones.test.ts).

import { ClienteErp10, FRASES, FrenoErp10, type AlmacenToken, type EmpresaDeLaLista } from './erp10Cliente.ts'

export const CODIGO_CONECTOR = 'erp10'
export const BASE_POR_DEFECTO = 'https://apicon.diezsoftware.com'

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Srv = any

export type ConexionErp10 = { id: string; companyId: string; codEmpresa: string; status: string }

/** La conexión de la cuenta (las claves). */
export async function conexionDeLaCuenta(srv: Srv, accountId: string): Promise<{ id: string; config: Record<string, unknown> } | null> {
  const { data, error } = await srv.from('account_connector')
    .select('id, config, status, connector!inner(code)')
    .eq('account_id', accountId).eq('scope', 'account').eq('connector.code', CODIGO_CONECTOR).maybeSingle()
  if (error) throw new Error(`no se ha podido leer la conexión con ERP10: ${error.message}`)
  return data ? { id: String(data.id), config: (data.config as Record<string, unknown> | null) ?? {} } : null
}

/** Las sociedades conectadas de la cuenta, con su código y su NIF: la lista cerrada. */
export async function sociedadesConectadas(srv: Srv, accountId: string): Promise<(ConexionErp10 & { nif: string | null })[]> {
  const { data, error } = await srv.from('account_connector')
    .select('id, company_id, external_account_id, status, connector!inner(code)')
    .eq('account_id', accountId).eq('scope', 'company').eq('connector.code', CODIGO_CONECTOR)
  if (error) throw new Error(`no se han podido leer las sociedades conectadas con ERP10: ${error.message}`)
  const filas = (data ?? []) as { id: string; company_id: string; external_account_id: string | null; status: string }[]
  if (!filas.length) return []
  const { data: cs, error: e2 } = await srv.from('company').select('id, tax_id').eq('account_id', accountId).in('id', filas.map((f) => f.company_id))
  if (e2) throw new Error(`no se han podido leer las sociedades: ${e2.message}`)
  const nif = new Map(((cs ?? []) as { id: string; tax_id: string | null }[]).map((c) => [c.id, c.tax_id]))
  // Una conexión cuya sociedad no es de la cuenta no entra en la lista.
  return filas.filter((f) => nif.has(f.company_id)).map((f) => ({
    id: String(f.id), companyId: String(f.company_id), codEmpresa: String(f.external_account_id ?? '').trim(), status: String(f.status), nif: nif.get(f.company_id) ?? null,
  }))
}

/** El cliente de ERP10 de una sociedad: solo para leer, salvo `escribir` (X10b). Sin conexión, null. */
export async function clienteErp10(srv: Srv, accountId: string, companyId: string, o: { fetch?: typeof fetch; escribir?: boolean } = {}): Promise<{ cliente: ClienteErp10; conexion: ConexionErp10 } | null> {
  const cuenta = await conexionDeLaCuenta(srv, accountId)
  if (!cuenta) return null
  const lista = await sociedadesConectadas(srv, accountId)
  const esta = lista.find((x) => x.companyId === companyId)
  if (!esta) return null
  if (!esta.codEmpresa) throw new FrenoErp10(FRASES.sinCodigo)
  const { data: s, error } = await srv.rpc('connector_secret_read', { p_account_connector_id: cuenta.id })
  if (error || !s) throw new FrenoErp10('Faltan las claves de ERP10: escríbelas en la pantalla del conector')
  const sec = ((s as { secrets?: Record<string, string> }).secrets ?? {}) as Record<string, string>
  const cfg = { ...cuenta.config, ...((s as { config?: Record<string, unknown> }).config ?? {}) }
  if (!sec.client_id || !sec.client_secret || !sec.username || !sec.password) throw new FrenoErp10('Faltan las claves de ERP10: escríbelas en la pantalla del conector')
  const almacen: AlmacenToken = {
    leer: async () => {
      const { data } = await srv.rpc('connector_token_read', { p_account_connector_id: esta.id })
      const t = data as { token: string; expires_at: string } | null
      return t ? { token: t.token, expiresAt: t.expires_at } : null
    },
    guardar: async (token, expiresAt) => { await srv.rpc('connector_token_save', { p_account_connector_id: esta.id, p_token: token, p_expires_at: expiresAt }) },
    caida: async (motivo) => { await srv.rpc('connector_mark_down', { p_account_connector_id: esta.id, p_error: motivo }) },
  }
  const deLaLista: EmpresaDeLaLista[] = lista.map((x) => ({ companyId: x.companyId, codEmpresa: x.codEmpresa, nif: x.nif }))
  const cliente = new ClienteErp10({
    base: String(cfg.base_url ?? BASE_POR_DEFECTO), nombreBd: String(cfg.nombre_bd ?? ''),
    claves: { client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password, grant_type: sec.grant_type },
    lista: deLaLista, codEmpresa: esta.codEmpresa, almacen, fetch: o.fetch, pausaMs: 100, escribir: o.escribir === true,
  })
  return { cliente, conexion: esta }
}
