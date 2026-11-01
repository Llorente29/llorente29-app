// tests/unit/platform/featureGateCuentaAbierta.test.ts
//
// DM1 · PR 1b (30/10/2026). El gate lee los interruptores, las cuotas y la
// ficha de la EMPRESA ABIERTA, no los de «el perfil» del usuario:
//   · una persona en dos empresas: los de la abierta según la base, diga lo
//     que diga el navegador; antes, maybeSingle fallaba con dos perfiles y el
//     gate se quedaba vacío (Folvy sin módulos);
//   · el superadministrador: los de la cuenta que gestiona, no los de su
//     perfil («Folvy Interno»), y al cambiar de cliente, los del nuevo.
// Con la base simulada: en staging-conta el superadministrador no puede abrir
// la aplicación (el hook de los claims no está activado), así que este caso no
// tiene e2e todavía.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// El almacén del navegador, a mano (las unitarias corren en node).
const almacen = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => { almacen.set(k, v) },
  removeItem: (k: string) => { almacen.delete(k) },
  clear: () => { almacen.clear() },
}

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const INTERNO = '00000000-0000-0000-0000-000000000001'

const base = {
  uid: 'u-1',
  abierta: A as string | null,
  esPlataforma: false,
  flags: { [A]: ['conta'], [B]: [], [INTERNO]: ['interno'] } as Record<string, string[]>,
  tablasLeidas: [] as string[],
}

function consulta(tabla: string) {
  base.tablasLeidas.push(tabla)
  let cuenta: string | null = null
  const q = {
    select: () => q,
    gte: () => q,
    eq: (col: string, v: string) => { if (col === 'id' || col === 'account_id') cuenta = v; return q },
    maybeSingle: async () => ({ data: cuenta && cuenta in base.flags ? { id: cuenta, name: `Cuenta ${cuenta.slice(-1)}`, is_internal: cuenta === INTERNO } : null, error: null }),
    single: async () => q.maybeSingle(),
    then: (ok: (r: unknown) => unknown) => {
      const filas = tabla === 'feature_flags' ? (base.flags[cuenta ?? ''] ?? []).map(k => ({ feature_key: k, enabled: true })) : []
      return Promise.resolve({ data: filas, error: null }).then(ok)
    },
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: base.uid }, access_token: 'x' } } }) },
    rpc: async (nombre: string) => {
      if (nombre === '_cuenta_activa') return { data: base.abierta, error: null }
      if (nombre === 'current_user_is_admin') return { data: base.esPlataforma, error: null }
      return { data: null, error: { message: `sin ${nombre}` } }
    },
    from: (t: string) => consulta(t),
  },
}))

const { gate } = await import('@/platform/feature-gate/featureGateService')

beforeEach(() => {
  gate.clear()
  base.tablasLeidas = []
  localStorage.clear()
})

describe('el gate, con la empresa abierta', () => {
  it('una persona en dos empresas ve los módulos de la abierta, aunque el navegador diga la otra', async () => {
    base.abierta = A; base.esPlataforma = false
    localStorage.setItem('andy-app-active-account', B)
    const s = await gate.load(B)
    expect(s?.account.id).toBe(A)
    expect(gate.has('conta')).toBe(true)
    // Ya no pregunta por «su perfil»: con dos, maybeSingle fallaba.
    expect(base.tablasLeidas).not.toContain('user_profiles')
  })

  it('al abrir la otra empresa (la base cambia y la aplicación se recarga), los módulos de la nueva', async () => {
    base.abierta = B; base.esPlataforma = false
    await gate.load()
    expect(gate.account()?.id).toBe(B)
    expect(gate.has('conta')).toBe(false)
  })

  it('el superadministrador ve los interruptores de la cuenta que gestiona, no los de Folvy Interno', async () => {
    base.abierta = INTERNO; base.esPlataforma = true
    await gate.load(A)
    expect(gate.account()?.id).toBe(A)
    expect(gate.has('conta')).toBe(true)
    expect(gate.has('interno')).toBe(false)
  })

  it('el superadministrador, al cambiar de cliente sin recargar, pasa a los del nuevo', async () => {
    base.abierta = INTERNO; base.esPlataforma = true
    await gate.load(A)
    expect(gate.has('conta')).toBe(true)
    await gate.load(B)
    expect(gate.account()?.id).toBe(B)
    expect(gate.has('conta')).toBe(false)
  })

  it('si dos cargas se cruzan, se queda la última pedida', async () => {
    base.abierta = INTERNO; base.esPlataforma = true
    const primera = gate.load(A)
    const segunda = gate.load(B)
    await Promise.all([primera, segunda])
    expect(gate.account()?.id).toBe(B)
  })
})
