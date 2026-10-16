// D01 · Liquidaciones por correo · La regla de casado por tienda (plan de Uber
// aprobado el 15/10): misma cuenta del banco que su marca × local, neto exacto
// al céntimo y fecha del día siguiente al fin del periodo a cuatro días
// después. Una → propuesta; varias → por aclarar, enseñando cuáles; un neto
// negativo no se busca en el banco. Datos inventados.
import { describe, expect, it } from 'vitest'
import { conciliar, cuentaDeTienda, decidir, referenciaDeLiquidacion, ventanaDeCobro, type Contexto, type Liquidacion, type Movimiento } from '@/modules/conta/lib/conciliacion'

const NORTE = 'cta-norte', SUR = 'cta-sur'
const PLAT = { nombre: 'Uber Eats', alias: ['UBER'], cuenta430: '43000003', terceroId: 't-uber', comisionHabitual: null, pendiente: [] }
function ctx(liquidaciones: Liquidacion[]): Contexto {
  return {
    cuentas: [{ id: NORTE, nombre: 'Cuenta Norte', cuenta: '57200001' }, { id: SUR, nombre: 'Cuenta Sur', cuenta: '57200002' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones, plataformas: [PLAT],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [], nombres: {}, cuentas626: '62600000', cuentas476: '47600000',
  }
}
const liq = (id: string, tienda: string, netoCent: number, cuentaId: string | null, hasta = '2026-10-04', desde = '2026-09-28'): Liquidacion => ({
  id, plataforma: 'Uber Eats', fecha: hasta, desde, hasta, netoCent, cuenta430: '43000003', terceroId: 't-uber',
  porTienda: { tienda, cuentaId, ventana: ventanaDeCobro(hasta) },
})
let n = 0
const mov = (p: Partial<Movimiento> & { importeCent: number }): Movimiento => ({
  id: `m${++n}`, cuentaId: NORTE, fecha: '2026-10-05', concepto: 'ABONO POR TRANSFERENCIA STICHTING CUSTODIAN UBER PAYMENTS LIQ. OP. N 000000000000123',
  conceptoComun: null, referencias: ['ES0000000000000000000000'], antesDelCorte: false, ...p,
})

describe('la ventana y la referencia', () => {
  it('del día siguiente al fin del periodo a cuatro días después', () => {
    expect(ventanaDeCobro('2026-10-04')).toEqual({ desde: '2026-10-05', hasta: '2026-10-09' })
    expect(ventanaDeCobro('2026-12-28')).toEqual({ desde: '2026-12-29', hasta: '2027-01-02' })
  })
  it('la referencia del banco («LIQ. OP. N» y sus 15 cifras)', () => {
    expect(referenciaDeLiquidacion('ABONO … LIQ. OP. N 000000000000123')).toBe('LIQ. OP. N 000000000000123')
    expect(referenciaDeLiquidacion('LIQ OP N 123')).toBeNull()
  })
})

describe('casar por tienda', () => {
  it('una sola: propuesta (nunca sola), con la tienda, el periodo y la referencia en el concepto', () => {
    const d = decidir(mov({ importeCent: 10_817 }), ctx([liq('l1', 'Marca Uno (Calle Inventada 1)', 10_817, NORTE)]))
    expect(d.confianza).toBe('probable')
    expect(d.que).toBe('Cobro de Uber Eats · Marca Uno (Calle Inventada 1) 28/09–04/10')
    expect(d.porque).toBe('Cuadra con su liquidación 28/09–04/10 de Marca Uno (Calle Inventada 1): neto 108,17 € exacto, en la cuenta de esa tienda y llegado 05/10.')
    expect(d.destino).toEqual({ tipo: 'liquidacion', liquidacion_id: 'l1', cuenta_cliente: '43000003', tercero_id: 't-uber',
      concepto: 'Cobro de Uber Eats · Marca Uno (Calle Inventada 1) 28/09–04/10 · LIQ. OP. N 000000000000123' })
  })
  it('otra cuenta del banco que la de su tienda: no es suya', () => {
    const d = decidir(mov({ importeCent: 10_817, cuentaId: SUR }), ctx([liq('l1', 'Marca Uno', 10_817, NORTE)]))
    expect(d.destino).toBeNull()
  })
  it('sin la cuenta de su tienda: casa por importe y fecha, y lo dice', () => {
    const d = decidir(mov({ importeCent: 10_817, cuentaId: SUR }), ctx([liq('l1', 'Marca Uno', 10_817, null)]))
    expect(d.confianza).toBe('probable')
    expect(d.porque).toMatch(/La tienda no tiene su cuenta del banco: casa por importe y fecha\.$/)
  })
  it('fuera de la ventana (antes del fin del periodo, o seis días después): no', () => {
    expect(decidir(mov({ importeCent: 10_817, fecha: '2026-10-04' }), ctx([liq('l1', 'Marca Uno', 10_817, NORTE)])).destino).toBeNull()
    expect(decidir(mov({ importeCent: 10_817, fecha: '2026-10-10' }), ctx([liq('l1', 'Marca Uno', 10_817, NORTE)])).destino).toBeNull()
    expect(decidir(mov({ importeCent: 10_817, fecha: '2026-10-09' }), ctx([liq('l1', 'Marca Uno', 10_817, NORTE)])).destino).toMatchObject({ liquidacion_id: 'l1' })
  })
  it('un céntimo de diferencia: no', () => {
    expect(decidir(mov({ importeCent: 10_818 }), ctx([liq('l1', 'Marca Uno', 10_817, NORTE)])).destino).toBeNull()
  })
  it('dos con el mismo neto la misma semana: por aclarar, enseñando las dos', () => {
    const d = decidir(mov({ importeCent: 2_000 }), ctx([liq('l1', 'Marca Uno', 2_000, null), liq('l2', 'Marca Dos', 2_000, null)]))
    expect(d.confianza).toBe('duda')
    expect(d.falta).toBe('cuál de las 2 liquidaciones es')
    expect(d.porque).toBe('Por aclarar: 2 liquidaciones con el mismo neto (20,00 €) esos días: Marca Uno 28/09–04/10; Marca Dos 28/09–04/10. Elige la suya.')
    expect(d.destino).toBeNull()
  })
  it('con su cuenta cada una, el mismo neto deja de ser un empate', () => {
    const c = ctx([liq('l1', 'Marca Uno', 2_000, NORTE), liq('l2', 'Marca Dos', 2_000, SUR)])
    expect(decidir(mov({ importeCent: 2_000, cuentaId: SUR }), c).destino).toMatchObject({ liquidacion_id: 'l2' })
  })
  it('nada se casa dos veces: dos ingresos iguales, dos liquidaciones de cuentas distintas', () => {
    const c = ctx([liq('l1', 'Marca Uno', 2_000, NORTE), liq('l2', 'Marca Dos', 2_000, SUR)])
    const ds = conciliar([mov({ importeCent: 2_000 }), mov({ importeCent: 2_000, cuentaId: SUR })], c)
    expect(ds.map((d) => (d.destino as { liquidacion_id?: string } | null)?.liquidacion_id)).toEqual(['l1', 'l2'])
    const otra = conciliar([mov({ importeCent: 2_000 }), mov({ importeCent: 2_000 })], ctx([liq('l1', 'Marca Uno', 2_000, NORTE)]))
    expect(otra.map((d) => d.destino?.tipo ?? null)).toEqual(['liquidacion', null])
  })
  it('las de siempre (sin tienda) siguen con su regla', () => {
    const l: Liquidacion = { id: 'g1', plataforma: 'Uber Eats', fecha: '2026-10-08', desde: '2026-10-01', hasta: '2026-10-07', netoCent: 5_000, cuenta430: '43000003', terceroId: 't-uber' }
    const d = decidir(mov({ importeCent: 5_000, fecha: '2026-10-20' }), ctx([l]))
    expect([d.confianza, d.destino?.tipo]).toEqual(['seguro', 'liquidacion'])
  })
})

describe('la cuenta de la tienda (Julio, 16/10: una por local, otra si la marca cobra aparte)', () => {
  const bancos = [{ id: 'b-alcala', localId: 'alcala' }, { id: 'b-camichi', localId: 'camichi' }, { id: 'b-otra', localId: null }]
  it('la de la marca × local manda; si no, la de su local; con dos o ninguna en el local, ninguna', () => {
    expect(cuentaDeTienda({ cuentaId: 'b-otra', localId: 'camichi' }, bancos)).toBe('b-otra')
    expect(cuentaDeTienda({ cuentaId: null, localId: 'camichi' }, bancos)).toBe('b-camichi')
    expect(cuentaDeTienda({ cuentaId: null, localId: 'alcala' }, [...bancos, { id: 'b-alcala-2', localId: 'alcala' }])).toBeNull()
    expect(cuentaDeTienda({ cuentaId: null, localId: null }, bancos)).toBeNull()
  })
})
