// tests/conta/erp10/conexiones.test.ts — X10 · La conexión «erp10» no es la de Diez.
//
// diezDespacho.ts busca UNA conexión por sociedad (maybeSingle) con connector.code = 'diez'.
// Con la de ERP10 en la misma cuenta y la misma sociedad, el traspaso de Diez tiene que seguir
// cogiendo la suya, y el cliente de ERP10 la suya. Un Supabase de mentira que aplica los
// filtros de verdad (también el de la relación embebida) y, como PostgREST, falla en
// maybeSingle si encuentra más de una fila. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { clienteDiezParaLeer } from '../../../supabase/functions/_shared/diezDespacho'
import { clienteErp10, sociedadesConectadas } from '../../../supabase/functions/_shared/erp10Despacho'

const CUENTA = 'cuenta-inventada'
const SOC = 'sociedad-a'
type Fila = Record<string, unknown>

function supabaseDeMentira(tablas: Record<string, Fila[]>, rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const vale = (f: Fila, campo: string, v: unknown) => {
    const [a, b] = campo.split('.')
    return b ? (f[a] as Fila | undefined)?.[b] === v : f[a] === v
  }
  const desde = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = []
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push((f) => vale(f, c, v)); return q },
      in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
      filas: () => (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))),
      maybeSingle: async () => {
        const r = q.filas()
        return r.length > 1 ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } } : { data: r[0] ?? null, error: null }
      },
      then: (ok: (x: { data: Fila[]; error: null }) => unknown) => Promise.resolve({ data: q.filas(), error: null }).then(ok),
    }
    return q
  }
  return {
    from: desde,
    rpc: async (fn: string, a: Record<string, unknown>) => ({ data: rpcs[fn]?.(a) ?? null, error: null }),
  }
}

const diez = { code: 'diez' }
const erp10 = { code: 'erp10' }
const TABLAS = {
  account_connector: [
    { id: 'con-diez', account_id: CUENTA, company_id: SOC, scope: 'company', status: 'connected', external_account_id: 'C0009', config: {}, connector: diez },
    { id: 'con-erp10-cuenta', account_id: CUENTA, company_id: null, scope: 'account', status: 'connected', external_account_id: null, config: { nombre_bd: 'DESPACHO_INVENTADO' }, connector: erp10 },
    { id: 'con-erp10-a', account_id: CUENTA, company_id: SOC, scope: 'company', status: 'connected', external_account_id: '101', config: {}, connector: erp10 },
    // De otra cuenta: no entra en la lista de esta.
    { id: 'con-erp10-otra', account_id: 'otra-cuenta', company_id: 'sociedad-z', scope: 'company', status: 'connected', external_account_id: '555', config: {}, connector: erp10 },
  ],
  company: [
    { id: SOC, account_id: CUENTA, tax_id: 'B00000000' },
    { id: 'sociedad-z', account_id: 'otra-cuenta', tax_id: 'B99999999' },
  ],
}
const SECRETOS = { secrets: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' }, config: {} }

describe('Diez y ERP10 en la misma sociedad', () => {
  it('el traspaso de Diez sigue cogiendo la suya (C0009), no la de ERP10', async () => {
    const pedidas: unknown[] = []
    const srv = supabaseDeMentira(TABLAS, { connector_secret_read: (a) => { pedidas.push(a.p_account_connector_id); return SECRETOS } })
    const r = await clienteDiezParaLeer(srv as unknown as Parameters<typeof clienteDiezParaLeer>[0], CUENTA, SOC)
    expect(r?.nombreBd).toBe('C0009')
    expect(pedidas).toEqual(['con-diez'])
  })
  it('sin el filtro por conector, maybeSingle encontraría dos (por eso no se reutiliza la conexión «diez»)', async () => {
    const srv = supabaseDeMentira(TABLAS)
    const r = await srv.from('account_connector').select().eq('account_id', CUENTA).eq('company_id', SOC).eq('scope', 'company').maybeSingle()
    expect(r.error).not.toBeNull()
  })
  it('el cliente de ERP10 coge la suya: las claves de la cuenta y el código de la sociedad', async () => {
    const pedidas: unknown[] = []
    const srv = supabaseDeMentira(TABLAS, { connector_secret_read: (a) => { pedidas.push(a.p_account_connector_id); return SECRETOS } })
    const r = await clienteErp10(srv, CUENTA, SOC)
    expect(r?.conexion.id).toBe('con-erp10-a')
    expect(r?.cliente.codEmpresa).toBe('101')
    expect(pedidas).toEqual(['con-erp10-cuenta'])
  })
  it('la lista cerrada es solo la de la cuenta: la sociedad de otra cuenta no entra', async () => {
    const srv = supabaseDeMentira(TABLAS)
    expect((await sociedadesConectadas(srv, CUENTA)).map((x) => x.codEmpresa)).toEqual(['101'])
    expect(await clienteErp10(srv, CUENTA, 'sociedad-z')).toBeNull()
  })
})
