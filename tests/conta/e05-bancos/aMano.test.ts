// tests/conta/e05-bancos/aMano.test.ts
//
// E05 · «Escribir uno a mano» (20261118T2248_e05_banco_a_mano): cuando ese
// movimiento llega en el extracto, el motor de hoy lo casa con el asiento escrito
// a mano y no se duplica. La base lo da como asiento sin movimiento de su banco con
// origen «otro» (bank_asientos_sin_movimiento: source_type 'manual'); aquí, el
// motor de verdad (conciliacion.ts, paso 1) con ese asiento delante. No se toca
// el motor. Datos inventados (repositorio público).
import { describe, expect, it } from 'vitest'
import { conciliar, decidir, type AsientoLibre, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'

const BANCO = 'cta-banco', OTRO = 'cta-otro'

function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: BANCO, nombre: 'Banco principal', cuenta: '57200001' }, { id: OTRO, nombre: 'Otro banco', cuenta: '57200002' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [],
    nombres: { '62600000': 'Comisiones del banco', '57000000': 'Caja.' },
    cuentas626: '62600000', cuentaCaja: '57000000',
    ...p,
  }
}
let n = 0
const mov = (p: Partial<Movimiento> & { importeCent: number; concepto: string }): Movimiento =>
  ({ id: `m${++n}`, cuentaId: BANCO, fecha: '2026-10-21', conceptoComun: null, referencias: [], antesDelCorte: false, ...p })
/** Lo que devuelve la base para un asiento escrito a mano en Bancos. */
const aMano = (p: Partial<AsientoLibre> = {}): AsientoLibre =>
  ({ id: 'e-a-mano', cuentaId: BANCO, fecha: '2026-10-21', importeCent: -1_250, concepto: 'Comisión mantenimiento', origen: 'otro', ...p })

describe('E05 · el movimiento que llega en el extracto se casa con el escrito a mano', () => {
  it('misma fecha y mismo importe: seguro, y se enlaza con ese asiento (no se crea otro)', () => {
    const d = decidir(mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO' }), ctx({ asientos: [aMano()] }))
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toEqual({ tipo: 'asiento', entry_id: 'e-a-mano' })
  })

  it('un ingreso escrito a mano, igual', () => {
    const d = decidir(mov({ importeCent: 30_000, concepto: 'INGRESO EFECTIVO' }), ctx({ asientos: [aMano({ importeCent: 30_000, concepto: 'Ingreso de caja' })] }))
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toEqual({ tipo: 'asiento', entry_id: 'e-a-mano' })
  })

  it('con otra fecha, dentro de los 10 días: lo propone con ese asiento, no lo casa solo', () => {
    const d = decidir(mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO', fecha: '2026-10-24' }), ctx({ asientos: [aMano()] }))
    expect(d.confianza).toBe('probable')
    expect(d.destino).toEqual({ tipo: 'asiento', entry_id: 'e-a-mano' })
  })

  it('más allá de los 10 días, otro importe u otro banco: no lo toma por él', () => {
    for (const m of [
      mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO', fecha: '2026-11-05' }),
      mov({ importeCent: -1_251, concepto: 'COMISION MANTENIMIENTO' }),
      mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO', cuentaId: OTRO }),
    ]) {
      const d = decidir(m, ctx({ asientos: [aMano()] }))
      expect(d.destino).not.toEqual({ tipo: 'asiento', entry_id: 'e-a-mano' })
    }
  })

  it('no se duplica: dos movimientos iguales y un solo asiento a mano, solo uno se casa con él', () => {
    const uno = mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO' })
    const dos = mov({ importeCent: -1_250, concepto: 'COMISION MANTENIMIENTO' })
    const ds = conciliar([uno, dos], ctx({ asientos: [aMano()], sinCasar: [uno, dos] }))
    const conEl = ds.filter((d) => (d.destino as { tipo?: string; entry_id?: string } | null)?.entry_id === 'e-a-mano')
    expect(conEl.length).toBe(1)
  })
})
