// tests/unit/modules/conta/agenteBancosServidor.test.ts
//
// B01·21 · La pasada del motor de Bancos desde la lectura de cada noche
// (supabase/functions/_shared/bancos/agente.ts), sin que nadie abra Bancos.
// Con una base falsa: cada tabla devuelve lo que se le dé y cada llamada a una
// función queda apuntada.

import { describe, expect, it } from 'vitest'
import { pasarElMotor, textoAviso, type ClienteBase } from '../../../../supabase/functions/_shared/bancos/agente'

type Llamada = { nombre: string; args: Record<string, unknown> }

/** Una base falsa: `from(tabla)` encadena cualquier filtro y da las filas de esa tabla; `rpc` apunta y contesta. */
function baseFalsa(filas: Record<string, unknown[]>, rpc: (nombre: string) => { data: unknown; error: { message: string } | null } = () => ({ data: [], error: null })) {
  const llamadas: Llamada[] = []
  const consultas: { tabla: string; filtros: string[] }[] = []
  const cliente: ClienteBase = {
    from(tabla: string) {
      const q = { tabla, filtros: [] as string[] }
      consultas.push(q)
      const resultado = { data: filas[tabla] ?? [], error: null }
      const cadena: Record<string, unknown> = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok)
          return (...args: unknown[]) => { q.filtros.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(',')})`); return cadena }
        },
      })
      return cadena
    },
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args })
      return Promise.resolve(rpc(nombre))
    },
  }
  return { cliente, llamadas, consultas }
}

const AHORA = new Date('2026-11-12T02:05:00Z')

describe('B01·21 · el motor de Bancos en la lectura de cada noche', () => {
  it('sin nada pendiente: pasa el motor, registra la pasada del día y no avisa', async () => {
    const { cliente, llamadas } = baseFalsa({})
    const p = await pasarElMotor(cliente, 'cuenta', 'empresa', '2026-11-12', AHORA)
    expect(p.error).toBeNull()
    expect(p.resultado).toEqual({ casadosSolos: 0, propuestos: 0, porAclarar: 0, antesDelCorte: 0, fallos: 0 })
    const registro = llamadas.find((l) => l.nombre === 'bank_agente_registrar')
    expect(registro?.args).toMatchObject({ p_company: 'empresa', p_disparo: 'diario' })
    expect(llamadas.some((l) => l.nombre === 'encolar_alerta')).toBe(false)
    expect(p.sinProponer).toBe(0)
  })

  it('con movimientos de hace más de un día sin proponer: avisa a la cuenta, con el banco, la fecha y el importe del más antiguo', async () => {
    const { cliente, llamadas, consultas } = baseFalsa({ bank_movement: [
      { op_date: '2026-11-07', amount: -457.49, treasury_account: { name: 'Cuenta principal' } },
      { op_date: '2026-11-08', amount: 11.83, treasury_account: { name: 'Cuenta principal' } },
    ] })
    const p = await pasarElMotor(cliente, 'cuenta', 'empresa', '2026-11-12', AHORA)
    expect(p.sinProponer).toBe(2)
    const aviso = llamadas.find((l) => l.nombre === 'encolar_alerta')
    expect(aviso?.args).toMatchObject({ p_kind: 'bancos_sin_proponer', p_account_id: 'cuenta', p_severity: 'aviso', p_debounce_kind: 'bancos_sin_proponer:empresa',
      p_subject: 'Bancos: 2 movimientos llevan más de un día sin proponer' })
    expect(String(aviso?.args.p_message)).toContain('El más antiguo: Cuenta principal, 07/11, -457,49 €.')
    // Solo lo de hace más de un día: corte en created_at, 24 h antes de ahora.
    const pendiente = consultas.filter((q) => q.tabla === 'bank_movement').at(-1)
    expect(pendiente?.filtros).toContain('eq("status","pendiente")')
    expect(pendiente?.filtros).toContain('lt("created_at","2026-11-11T02:05:00.000Z")')
  })

  it('si el motor falla, lo dice y mira lo pendiente igual (no falla en silencio)', async () => {
    const { cliente, llamadas } = baseFalsa({ bank_movement: [{ op_date: '2026-11-07', amount: -30, treasury_account: { name: 'BBVA ···4525' } }] },
      (nombre) => (nombre === 'bank_agente_registrar' ? { data: null, error: { message: 'la base no deja' } } : { data: [], error: null }))
    const p = await pasarElMotor(cliente, 'cuenta', 'empresa', '2026-11-12', AHORA)
    expect(p.error).toContain('la base no deja')
    expect(llamadas.some((l) => l.nombre === 'encolar_alerta')).toBe(true)
  })

  it('el texto del aviso, en palabras de quien lo lee', () => {
    expect(textoAviso(1, { banco: 'Cuenta principal', fecha: '2026-11-07', importe: -457.49 })).toEqual({
      asunto: 'Bancos: 1 movimiento lleva más de un día sin proponer',
      mensaje: 'Hay 1 movimiento en «pendiente» desde hace más de un día: la pasada de esta noche no ha podido proponerlos. El más antiguo: Cuenta principal, 07/11, -457,49 €. Abre Bancos › Movimientos para verlos; si sigue mañana, hay que mirar el motor.',
    })
  })
})
