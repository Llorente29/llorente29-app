// B01 Revolut · PR 1 · Lo que hacen las funciones conta-revolut-*, con un Revolut
// y una base simulados (sin red ni Supabase). Todo inventado (T11).
//
//   · el camino entero de una lectura: token con el de renovación, cuentas por
//     IBAN, lo terminado hasta hoy por bank_importar, y apuntado;
//   · el token de renovación nuevo se guarda; el viejo nunca va a un registro;
//   · si Revolut ya no acepta el permiso, la empresa queda «retirada»;
//   · conocidos pregunta a la base en trozos;
//   · el registro no lleva ni secretos ni el IBAN entero.
import { describe, expect, it } from 'vitest'
import { crearLlave } from '../../../../../supabase/functions/_shared/revolut/certificado.ts'
import { baseDeRevolut, leerEmpresa, paraElRegistro, ponerAlDiaPagos, type ConexionRevolut, type Srv } from '../../../../../supabase/functions/_shared/revolut/servidor.ts'

const EMPRESA = '00000000-0000-4000-8000-0000000000e1'
const IBAN = 'ES0099990000000000005678'

/** Una base simulada: lo justo de supabase-js (rpc y from…select/eq/in/update). */
function baseSimulada(secretos: Record<string, string>) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = []
  const actualizaciones: Record<string, unknown>[] = []
  const movimientos: { treasury_account_id: string; reference_2: string }[] = []
  const consultasIn: number[] = []
  const tablas: Record<string, Record<string, unknown>[]> = {
    treasury_account: [{ id: 'banco-1', name: 'Revolut · Principal', iban: 'ES00 9999 0000 0000 0000 5678', account_id: 'a', company_id: EMPRESA, kind: 'bank', is_active: true }],
    bank_statement: [],
  }
  const srv: Srv = {
    async rpc(fn, args = {}) {
      llamadas.push({ fn, args })
      if (fn === 'conta_revolut_secreto') return { data: secretos[String(args.p_que)] ?? null, error: null }
      if (fn === 'conta_revolut_secreto_poner') { secretos[String(args.p_que)] = String(args.p_valor); return { data: null, error: null } }
      if (fn === 'conta_revolut_desconectar') return { data: { estado: 'retirada' }, error: null }
      if (fn === 'bank_importar') {
        let nuevos = 0
        for (const m of args.p_movs as { ref2: string }[]) { movimientos.push({ treasury_account_id: String(args.p_treasury), reference_2: m.ref2 }); nuevos++ }
        tablas.bank_statement.push({ treasury_account_id: args.p_treasury, source: args.p_fuente, period_from: args.p_desde, period_to: args.p_hasta })
        return { data: { nuevos, repetidos: 0, continuidad: 'primero' }, error: null }
      }
      return { data: null, error: null }
    },
    from(tabla: string) {
      const filtros: [string, unknown][] = []
      let enLista: [string, string[]] | null = null
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return q },
        in: (c: string, v: string[]) => { enLista = [c, v]; consultasIn.push(v.length); return q },
        update: (v: Record<string, unknown>) => { actualizaciones.push({ tabla, ...v }); return { eq: async () => ({ error: null }) } },
        then: (ok: (r: { data: unknown; error: null }) => void) => {
          let filas = tabla === 'bank_movement' ? movimientos as unknown as Record<string, unknown>[] : tablas[tabla] ?? []
          filas = filas.filter((f) => filtros.every(([c, v]) => !(c in f) || f[c] === v || c === 'treasury_account_id' && f.treasury_account_id === v))
          if (enLista) { const [c, v] = enLista; filas = filas.filter((f) => v.includes(String(f[c]))) }
          ok({ data: filas, error: null })
        },
      }
      return q
    },
  }
  return { srv, llamadas, actualizaciones, movimientos, consultasIn, secretos }
}

/** Un Revolut simulado: el token, una cuenta en euros con su IBAN y dos movimientos terminados. */
function revolut(o: { tokenFalla?: number; renovacionNueva?: string } = {}) {
  const pedidas: string[] = []
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    pedidas.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
    const r = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/auth/token')) {
      if (o.tokenFalla) return r({ error: 'invalid_grant', error_description: 'refresh token revoked' }, o.tokenFalla)
      return r({ access_token: 'acceso-inventado', expires_in: 2400, ...(o.renovacionNueva ? { refresh_token: o.renovacionNueva } : {}) })
    }
    if (url.endsWith('/accounts')) return r([{ id: 'cta-1', name: 'Principal', balance: 980, currency: 'EUR', state: 'active' }])
    if (url.includes('/bank-details')) return r([{ iban: IBAN, bic: 'REVOLT21' }])
    if (url.includes('/transactions')) return r([
      { id: 't1', type: 'transfer', state: 'completed', created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z', completed_at: '2026-10-30T10:00:00Z', legs: [{ leg_id: 'l1', account_id: 'cta-1', amount: 1000, currency: 'EUR', description: 'From Cliente Prueba', balance: 1000 }] },
      { id: 't2', type: 'transfer', state: 'completed', created_at: '2026-10-31T08:00:00Z', updated_at: '2026-10-31T08:00:00Z', completed_at: '2026-10-31T08:00:00Z', legs: [{ leg_id: 'l1', account_id: 'cta-1', amount: -20, currency: 'EUR', description: 'To Proveedor Prueba', balance: 980 }] },
    ])
    return r({ message: 'no' }, 404)
  }
  return { f, pedidas }
}

async function conexion(): Promise<{ c: ConexionRevolut; secretos: Record<string, string> }> {
  const llave = await crearLlave('Prueba')
  return {
    c: { id: 'cx-1', account_id: 'a', company_id: EMPRESA, entorno: 'sandbox', estado: 'conectada', vuelta: 'https://app.sumied.com/bancos/revolut/vuelta', permisos: 'READ', desde_historico: '2026-10-25', last_run_at: null, webhook_id: null },
    secretos: { privada: llave.privadaPem, client_id: 'client-id-inventado', renovacion: 'renovacion-vieja-inventada' },
  }
}

describe('leerEmpresa', () => {
  it('el camino entero: token, cuentas por IBAN, lo de hoy por bank_importar y apuntado', async () => {
    const { c, secretos } = await conexion()
    const b = baseSimulada(secretos)
    const r = revolut()
    const p = await leerEmpresa(b.srv, r.f, c, new Date('2026-10-31T12:00:00Z'))
    expect(p.error).toBeNull()
    expect(p.cuentas[0]).toMatchObject({ estado: 'al_dia', nuevos: 2, desde: '2026-10-25', hasta: '2026-10-31', saldoFinalCent: 98000 })
    // Solo el sandbox (staging no habla con producción).
    expect(r.pedidas).toContain('POST /api/1.0/auth/token')
    const imp = b.llamadas.find((x) => x.fn === 'bank_importar')!.args
    expect(imp).toMatchObject({ p_fuente: 'agregador:revolut', p_desde: '2026-10-25', p_hasta: '2026-10-31', p_saldo_inicial: 0, p_saldo_final: 980 })
    expect(b.actualizaciones.at(-1)).toMatchObject({ tabla: 'revolut_conexion', last_error: null })
  })

  it('una segunda lectura no manda nada: ya estaban (conocidos)', async () => {
    const { c, secretos } = await conexion()
    const b = baseSimulada(secretos)
    await leerEmpresa(b.srv, revolut().f, c, new Date('2026-10-31T12:00:00Z'))
    const otra = await leerEmpresa(b.srv, revolut().f, c, new Date('2026-10-31T13:00:00Z'))
    expect(otra.cuentas[0]).toMatchObject({ estado: 'sin_movimientos', nuevos: 0, repetidos: 1 })
    expect(b.movimientos).toHaveLength(2)
    expect(b.llamadas.filter((x) => x.fn === 'bank_importar')).toHaveLength(1)
  })

  it('si Revolut da otro token de renovación, se guarda el nuevo', async () => {
    const { c, secretos } = await conexion()
    const b = baseSimulada(secretos)
    await leerEmpresa(b.srv, revolut({ renovacionNueva: 'renovacion-nueva-inventada' }).f, c, new Date('2026-10-31T12:00:00Z'))
    expect(b.secretos.renovacion).toBe('renovacion-nueva-inventada')
  })

  it('si Revolut ya no acepta el permiso, la empresa queda «retirada» y se dice', async () => {
    const { c, secretos } = await conexion()
    const b = baseSimulada(secretos)
    const p = await leerEmpresa(b.srv, revolut({ tokenFalla: 400 }).f, c, new Date('2026-10-31T12:00:00Z'))
    expect(p.retirada).toBe(true)
    expect(p.error).toMatch(/ya no acepta el permiso/)
    expect(b.llamadas.find((x) => x.fn === 'conta_revolut_desconectar')?.args).toMatchObject({ p_company: EMPRESA, p_desde_revolut: true })
    expect(b.llamadas.some((x) => x.fn === 'bank_importar')).toBe(false)
    // 2c-1: sin conexión no se paga, y se deja de pagar ANTES de apuntar la retirada.
    const i = b.llamadas.findIndex((x) => x.fn === 'conta_pago_dejar')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(b.llamadas[i].args).toMatchObject({ p_company: EMPRESA, p_quien: null })
    expect(i).toBeLessThan(b.llamadas.findIndex((x) => x.fn === 'conta_revolut_desconectar'))
  })

  it('el registro no lleva secretos, tokens, client_id ni el IBAN entero', async () => {
    const { c, secretos } = await conexion()
    const b = baseSimulada(secretos)
    const p = await leerEmpresa(b.srv, revolut().f, c, new Date('2026-10-31T12:00:00Z'))
    const texto = JSON.stringify(paraElRegistro(p))
    for (const prohibido of [IBAN, 'client-id-inventado', 'renovacion-vieja-inventada', 'acceso-inventado', 'PRIVATE KEY', EMPRESA]) expect(texto).not.toContain(prohibido)
    expect(texto).toContain('5678')
  })
})

describe('baseDeRevolut.conocidos', () => {
  it('pregunta a la base en trozos de 200', async () => {
    const b = baseSimulada({})
    await baseDeRevolut(b.srv).conocidos!('banco-1', Array.from({ length: 450 }, (_, i) => `t${i}:l1`))
    expect(b.consultasIn).toEqual([200, 200, 50])
  })
})

// B01 · PR 2b · Los pagos que esperan al banco se ponen al día en cada lectura.
describe('ponerAlDiaPagos', () => {
  it('pregunta por cada pago (por su id o, sin él, por su request_id) y apunta lo que dice el banco', async () => {
    const dice: Record<string, unknown>[] = []
    const srv = {
      async rpc(fn: string, args: Record<string, unknown> = {}) {
        if (fn === 'conta_pago_por_saber') return { data: [
          { salida: 's1', request_id: 'rq-1', banco_id: 'tx-1' },
          { salida: 's2', request_id: 'rq-2', banco_id: null },
          { salida: 's3', request_id: 'rq-3', banco_id: 'tx-3' },
        ], error: null }
        if (fn === 'conta_pago_banco_dice') { dice.push(args); return { data: { estado: args.p_estado, sin_cambio: args.p_salida === 's3' }, error: null } }
        return { data: null, error: null }
      },
    } as unknown as Srv
    const urls: string[] = []
    const f = async (u: string) => {
      urls.push(u.replace('https://sandbox-b2b.revolut.com/api/1.0', ''))
      const json = u.includes('tx-1') ? { id: 'tx-1', state: 'completed', completed_at: '2026-11-01T10:00:00Z' }
        : u.includes('rq-2') ? { id: 'tx-2', state: 'declined', reason_code: 'algo' } : { id: 'tx-3', state: 'pending' }
      return new Response(JSON.stringify(json), { status: 200 })
    }
    const r = await ponerAlDiaPagos(srv, f, { company_id: EMPRESA, entorno: 'sandbox' } as ConexionRevolut, 'tok')
    expect(r).toEqual({ preguntados: 3, cambiados: 2, fallos: 0 })
    expect(urls).toEqual(['/transaction/tx-1', '/transaction/rq-2?id_type=request_id', '/transaction/tx-3'])
    expect(dice.map((d) => [d.p_salida, d.p_estado, d.p_banco_id])).toEqual([['s1', 'pagada', 'tx-1'], ['s2', 'rechazada', 'tx-2'], ['s3', 'esperando_banco', 'tx-3']])
  })

  it('sin la 1614 (o sin pagos que esperen), no hace nada', async () => {
    const srv = { async rpc() { return { data: null, error: { message: 'function conta_pago_por_saber does not exist' } } } } as unknown as Srv
    expect(await ponerAlDiaPagos(srv, async () => { throw new Error('no tenía que llamar') }, { company_id: EMPRESA, entorno: 'sandbox' } as ConexionRevolut, 'tok'))
      .toEqual({ preguntados: 0, cambiados: 0, fallos: 0 })
  })
})
