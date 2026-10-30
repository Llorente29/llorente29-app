// S01e · La ficha de cada préstamo o aplazamiento (tablero 5). Cifras
// inventadas: nada de los contratos reales de Foodint.
import { describe, expect, it } from 'vitest'
import { cambioDeCuadro, cifrasDeLaFicha, filasDeLaFicha, filtrarFilas, masMeses, quedaDespues, type PagoDeFila } from '@/modules/conta/lib/fichaContrato'
import { decidir, type Contexto, type Contrato, type Movimiento } from '@/modules/conta/lib/conciliacion'
import type { FilaCuadro } from '@/modules/conta/lib/contratos'

// Un préstamo de 1.200,00 en 4 cuotas: noviembre, diciembre, y dos en 2027 (una a más de 12 meses).
const CUADRO: FilaCuadro[] = [
  { fecha: '2026-11-03', cuotaCent: 33000, capitalCent: 30000, interesesCent: 3000 },
  { fecha: '2026-12-03', cuotaCent: 33000, capitalCent: 30500, interesesCent: 2500 },
  { fecha: '2027-06-03', cuotaCent: 33000, capitalCent: 31000, interesesCent: 2000 },
  { fecha: '2027-12-03', cuotaCent: 30000, capitalCent: 28500, interesesCent: 1500 },
]
const PRESTAMO = { tipo: 'prestamo' as const, cuadro: CUADRO, principalCent: 120000, cuotas: 4 }
const pago = (fecha: string, asiento: number): PagoDeFila => ({ fecha, asiento, asientoId: `a${asiento}`, movimientoId: `m${asiento}`, mesMovimiento: fecha.slice(0, 7), bancoId: 'b' })

describe('S01e · el estado de cada fila', () => {
  it('sin pagos: la primera desde hoy es la próxima y las demás, pendientes', () => {
    const f = filasDeLaFicha(CUADRO, [], [], '2026-10-30')
    expect(f.map((x) => x.estado.tipo)).toEqual(['proxima', 'pendiente', 'pendiente', 'pendiente'])
  })
  it('una pagada dice su asiento; un cargo del mes que no cuadra queda «por aclarar»', () => {
    const f = filasDeLaFicha(CUADRO, [pago('2026-11-03', 3310)], [{ movimientoId: 'x', fechaCargo: '2026-12-04', importeCent: 34000, bancoId: 'b' }], '2026-11-10')
    expect(f[0].estado).toMatchObject({ tipo: 'pagada', pago: { asiento: 3310 } })
    expect(f[1].estado).toMatchObject({ tipo: 'aclarar', cargo: { importeCent: 34000 } })
    expect(f[2].estado.tipo).toBe('proxima')
    expect(filtrarFilas(f, 'pagadas')).toHaveLength(1)
    expect(filtrarFilas(f, 'pendientes')).toHaveLength(3)
  })
})

describe('S01e · las cuatro cifras', () => {
  it('lo que queda, con el corto (los próximos 12 meses) y el largo', () => {
    const f = filasDeLaFicha(CUADRO, [], [], '2026-10-30')
    const c = cifrasDeLaFicha(PRESTAMO, f, '2026-10-30')
    expect(c).toMatchObject({ quedaCent: 120000, cortoCent: 91500, largoCent: 28500, parcial: false, pagadas: 0, filas: 4, ultimaFecha: '2027-12-03',
      interesesQuedanCent: 9000, interesesEsteAnioCent: 5500 })
    expect(c.proxima?.fecha).toBe('2026-11-03')
  })
  it('después de pagar la primera, lo que queda baja su capital', () => {
    const f = filasDeLaFicha(CUADRO, [pago('2026-11-03', 3310)], [], '2026-11-05')
    expect(cifrasDeLaFicha(PRESTAMO, f, '2026-11-05')).toMatchObject({ quedaCent: 90000, pagadas: 1, cortoCent: 61500 })
  })
  it('un aplazamiento con el cuadro de un solo año: «al menos» a corto, sin largo, y falta el año siguiente', () => {
    const aplazamiento = { tipo: 'aplazamiento' as const, cuadro: CUADRO.slice(0, 2), principalCent: 500000, cuotas: 36 }
    const f = filasDeLaFicha(aplazamiento.cuadro, [], [], '2026-10-30')
    expect(cifrasDeLaFicha(aplazamiento, f, '2026-10-30')).toMatchObject({ quedaCent: 500000, cortoCent: 60500, largoCent: null, parcial: true, anioQueFalta: 2027, cuotas: 36 })
  })
  it('lo que queda después de cada fila, y los meses que se suman', () => {
    expect(quedaDespues(PRESTAMO, CUADRO)).toEqual([90000, 59500, 28500, 0])
    expect(masMeses('2026-10-30', 12)).toBe('2027-10-30')
    expect(masMeses('2026-01-31', 1)).toBe('2026-02-28')
  })
})

describe('S01e · «Subir un cuadro nuevo»: lo que cambia', () => {
  it('en un préstamo se van las pendientes desde la primera del cuadro nuevo, y lo amortizado de golpe es lo que falta', () => {
    const nuevo: FilaCuadro[] = [{ fecha: '2026-12-03', cuotaCent: 26000, capitalCent: 25000, interesesCent: 1000 }, { fecha: '2027-01-03', cuotaCent: 25500, capitalCent: 25000, interesesCent: 500 }]
    const r = cambioDeCuadro(PRESTAMO, nuevo, [pago('2026-11-03', 3310)])
    expect(r).toMatchObject({ modo: 'sustituir', pagadaQueSeIria: null, amortizadoCent: 40000 })
    expect(r.seVan.map((f) => f.fecha)).toEqual(['2026-12-03', '2027-06-03', '2027-12-03'])
    expect(r.entran).toHaveLength(2)
  })
  it('no se sustituye desde una cuota ya pagada', () => {
    expect(cambioDeCuadro(PRESTAMO, CUADRO, [pago('2026-11-03', 3310)]).pagadaQueSeIria).toBe('2026-11-03')
  })
  it('en un aplazamiento entran solo las filas de después de la última', () => {
    const r = cambioDeCuadro({ tipo: 'aplazamiento', cuadro: CUADRO.slice(0, 2), principalCent: 500000 }, CUADRO.slice(1), [])
    expect(r).toMatchObject({ modo: 'anadir', seVan: [] })
    expect(r.entran.map((f) => f.fecha)).toEqual(['2027-06-03', '2027-12-03'])
  })
})

describe('S01e · casar la cuota dice qué fila paga', () => {
  it('el destino de la cuota de un contrato con cuadro lleva la fecha de su fila', () => {
    const c: Contrato = { id: 'p', tipo: 'prestamo', nombre: 'Préstamo inventado', contiene: 'PRESTAMO INVENTADO', importeCent: 33000, confirmaciones: 0,
      terceroId: null, cuentaGasto: null, cuentaCapital: '52000001', cuentaIntereses: '66230000', cuadro: CUADRO }
    const ctx = { cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
      nominas: [], reglas: [], aprendido: [], asientos: [], impuestos: [], cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
      nombres: {}, contratos: [c] } as unknown as Contexto
    const m: Movimiento = { id: 'm', cuentaId: 'cta', fecha: '2026-11-03', conceptoComun: null, referencias: [], antesDelCorte: false, importeCent: -33000, concepto: 'ADEUDO PRESTAMO INVENTADO' }
    expect(decidir(m, ctx).destino).toMatchObject({ tipo: 'contrato', contrato_id: 'p', fila: '2026-11-03' })
  })
})
