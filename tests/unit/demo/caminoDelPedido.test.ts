// tests/unit/demo/caminoDelPedido.test.ts
//
// DM1 · PR 2a (31/10/2026) · El camino del pedido no nota la puerta (Julio,
// 31/10: «para una cuenta que no es demo, la puerta no hace nada; misma
// respuesta antes y después, con order-advance, HubRise y Last»).
//
//   · siPuedeSalir, para una cuenta normal, devuelve EL MISMO objeto que la
//     llamada de siempre, una vez; igual que «antes» (la base sin la 0907) y
//     si la base no contesta (camino del pedido: sale). Para una demo, no la
//     llama.
//   · El token de HubRise de una cuenta normal es el mismo antes y después;
//     el de una demo, ninguno; en la lista de conexiones activas solo falta la
//     de la demo. Si la base no contesta, el token sale como antes.
//   · order-advance, HubRise (webhook, estado, disponibilidades), Last y
//     Catcher pasan por siPuedeSalir con «sale» (no por cuentaPuedeSalir, que
//     lanza si la base no contesta): el código lo dice, y aquí se comprueba.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { siPuedeSalir, EN_LA_DEMO } from '../../../supabase/functions/_shared/puerta'
import { resolveHubriseToken, listActiveHubriseConnections, resolveWriterToken } from '../../../supabase/functions/_shared/hubriseToken'
import { RAIZ } from './salidas'

const NORMAL = '00000000-0000-0000-0000-00000000000a'
const DEMO = '00000000-0000-0000-0000-00000000000d'

type Modo = 'con_puerta' | 'antes' | 'no_contesta'
/** La base: con la 0907 (DEMO es de demo), sin ella (antes), o sin contestar. */
function base(modo: Modo, filas: Record<string, unknown>[] = []) {
  const consulta = () => {
    const q: Record<string, unknown> = {}
    const yo = () => q
    Object.assign(q, { select: yo, eq: yo, is: yo, not: yo, order: yo, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok) })
    return q
  }
  return {
    from: () => consulta(),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'cuenta_puede_salir') {
        if (modo === 'antes') return { data: null, error: { message: 'no existe', code: 'PGRST202' } }
        if (modo === 'no_contesta') return { data: null, error: { message: 'tiempo agotado', code: '57014' } }
        return { data: args?.p_account_id !== DEMO, error: null }
      }
      if (fn === 'hubrise_writer_token_read') return { data: `escritor-${String(args?.p_account_id)}`, error: null }
      return { data: null, error: null }
    },
  }
}

describe('siPuedeSalir: para una cuenta normal, la misma respuesta', () => {
  for (const modo of ['con_puerta', 'antes', 'no_contesta'] as const) {
    it(`cuenta normal (${modo}): devuelve el mismo objeto que la llamada de siempre, llamada una vez`, async () => {
      const respuesta = { ok: false, reason: 'Last 500: algo' }
      let veces = 0
      const r = await siPuedeSalir(base(modo), NORMAL, async () => { veces++; return respuesta }, () => ({ ok: true, reason: EN_LA_DEMO }), 'sale')
      expect(r).toBe(respuesta)
      expect(veces).toBe(1)
    })
  }
  it('cuenta de demo: no llama, y da lo de la demo', async () => {
    let veces = 0
    const r = await siPuedeSalir(base('con_puerta'), DEMO, async () => { veces++; return { ok: true } }, () => ({ ok: true, reason: EN_LA_DEMO }), 'sale')
    expect(veces).toBe(0)
    expect(r).toEqual({ ok: true, reason: EN_LA_DEMO })
  })
  it('fuera del camino del pedido, si la base no contesta, no sale: lanza', async () => {
    await expect(siPuedeSalir(base('no_contesta'), NORMAL, async () => 1, () => 0, 'no_sale')).rejects.toThrow()
  })
})

describe('HubRise: el token de una cuenta normal, el mismo antes y después', () => {
  const fila = { id: 'i1', connection_name: 'Folvy', access_token: 'tok-normal', push_status_enabled: true, is_active: true }
  const q = { externalLocationId: 'loc-1', connectionName: 'Folvy' }
  it('resolveHubriseToken: normal igual en los tres casos; demo, ninguno', async () => {
    const antes = await resolveHubriseToken(base('antes', [fila]), { accountId: NORMAL, ...q })
    expect(antes).toBe('tok-normal')
    expect(await resolveHubriseToken(base('con_puerta', [fila]), { accountId: NORMAL, ...q })).toBe(antes)
    expect(await resolveHubriseToken(base('no_contesta', [fila]), { accountId: NORMAL, ...q })).toBe(antes)
    expect(await resolveHubriseToken(base('con_puerta', [fila]), { accountId: DEMO, ...q })).toBeNull()
  })
  it('resolveWriterToken: normal igual; demo, ninguno', async () => {
    expect(await resolveWriterToken(base('con_puerta'), NORMAL)).toBe(await resolveWriterToken(base('antes'), NORMAL))
    expect(await resolveWriterToken(base('con_puerta'), DEMO)).toBeNull()
  })
  it('listActiveHubriseConnections: solo falta la de la demo', async () => {
    const filas = [
      { id: 'n', account_id: NORMAL, external_location_id: 'l1', connection_name: 'A', access_token: 't1', push_status_enabled: true, is_active: true },
      { id: 'd', account_id: DEMO, external_location_id: 'l2', connection_name: 'B', access_token: 't2', push_status_enabled: true, is_active: true },
    ]
    const antes = await listActiveHubriseConnections(base('antes', filas))
    const despues = await listActiveHubriseConnections(base('con_puerta', filas))
    expect(antes.map((c) => c.id)).toEqual(['n', 'd'])
    expect(despues).toEqual(antes.filter((c) => c.id !== 'd'))
  })
})

describe('el camino del pedido usa la puerta que no lo para si la base no contesta', () => {
  const CAMINO = ['order-advance', 'hubrise-webhook', 'hubrise-order-status', 'availability-dispatch', 'catcher-dispatch',
    'last-catalog-probe', 'last-catalog-sync', 'lastapp-backfill-sales', 'lastapp-catalog-import', 'lastapp-set-price']
  for (const f of CAMINO) {
    it(f, () => {
      const t = readFileSync(join(RAIZ, 'supabase/functions', f, 'index.ts'), 'utf8')
      expect(t, `${f}: tiene que pasar por siPuedeSalir`).toMatch(/siPuedeSalir\(/)
      expect(t, `${f}: con «sale»`).toMatch(/siPuedeSalir\([\s\S]*?"sale"\)/)
      expect(t, `${f}: no por cuentaPuedeSalir (lanza si la base no contesta)`).not.toMatch(/cuentaPuedeSalir\(/)
    })
  }
})
