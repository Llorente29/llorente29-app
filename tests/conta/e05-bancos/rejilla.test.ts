// tests/conta/e05-bancos/rejilla.test.ts
//
// E05 · Bancos del núcleo: lo que decide la rejilla (src/modules/conta/nucleo/bancos/rejilla.ts)
// y que confirmar y deshacer llaman al motor IGUAL que la pantalla de hoy
// (src/modules/conta/nucleo/bancos/conciliar.ts contra bancos/Movimientos.tsx).
// Importes y nombres inventados (T11).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const motor = vi.hoisted(() => ({ confirmar: vi.fn(), deshacer: vi.fn(), conciliarPendientes: vi.fn() }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: motor }))

import { cuentaDe, etiquetaDe, ingresoPago, mover, porRevisar, segurosMarcados } from '@/modules/conta/nucleo/bancos/rejilla'
import { MOTIVO_DESHACER, confirmarPropuesta, confirmarVarios, deshacerCasado } from '@/modules/conta/nucleo/bancos/conciliar'
import { cuadreDe } from '@/modules/conta/lib/conciliarVista'
import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'
import { PROPUESTA_RECALCULADA, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'

const FACTURA = { tipo: 'factura_recibida', facturas: [{ id: 'f1', importe: 357.44 }], cuenta_tercero: '40000007', tercero_id: null, concepto: 'Pago F-0001' }
function mov(o: Partial<MovimientoBanco> & { id: string }): MovimientoBanco {
  return {
    cuentaId: 'b1', fecha: '2026-07-31', importeCent: -35744, conceptoBanco: 'TRANSFERENCIA A DISTRIBUCIONES EJEMPLO', conceptoLimpio: 'Distribuciones Ejemplo',
    estado: 'propuesto', confianza: 'probable', porque: 'Mismo importe y vencía hoy.', propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...o,
  }
}
const propuesta = (o: Record<string, unknown> = {}) => ({ que: 'Paga F-0001', destino: FACTURA, motor: MOTOR_BANCOS, reglaId: null, ...o }) as MovimientoBanco['propuesta']

describe('ingresoPago: como ERP10, no debe y haber', () => {
  it('lo que entra es ingreso; lo que sale, pago, sin signo', () => {
    expect(ingresoPago({ importeCent: 124050 })).toEqual({ ingresoCent: 124050, pagoCent: null })
    expect(ingresoPago({ importeCent: -35744 })).toEqual({ ingresoCent: null, pagoCent: 35744 })
    expect(ingresoPago({ importeCent: 0 })).toEqual({ ingresoCent: null, pagoCent: null })
  })
})

describe('etiquetaDe: la de la maqueta, y ninguna fila sin la suya (regla 7)', () => {
  it('«Mira esto», «Hecho solo», «Sin saber» y lo seguro en verde', () => {
    expect(etiquetaDe(mov({ id: '1', propuesta: propuesta() }))).toEqual({ texto: 'Mira esto', tono: 'mira' })
    expect(etiquetaDe(mov({ id: '2', estado: 'casado', casado: { id: 'c', tipo: 'factura', porque: '', porQuien: 'folvy', asientoId: 'a', asientoConcepto: null } }))).toEqual({ texto: 'Hecho solo', tono: 'bien' })
    expect(etiquetaDe(mov({ id: '3', estado: 'por_aclarar' }))).toEqual({ texto: 'Sin saber', tono: 'neutro' })
    expect(etiquetaDe(mov({ id: '4', confianza: 'seguro', propuesta: propuesta({ preseleccionar: true }) }))).toEqual({ texto: 'Seguro', tono: 'bien' })
  })
  it('lo demás que existe, con su nombre', () => {
    expect(etiquetaDe(mov({ id: '5', estado: 'casado', casado: { id: 'c', tipo: 'factura', porque: '', porQuien: 'persona', asientoId: 'a', asientoConcepto: null } })).texto).toBe('Hecho')
    expect(etiquetaDe(mov({ id: '6', estado: 'ignorado' })).texto).toBe('Apartado')
    expect(etiquetaDe(mov({ id: '7', estado: 'posible_repetido' })).texto).toBe('¿Repetido?')
    expect(etiquetaDe(mov({ id: '8', estado: 'antes_corte_sin_pareja' })).texto).toBe('Antes del corte')
  })
})

describe('porRevisar y segurosMarcados', () => {
  const movs = [
    mov({ id: 'p', propuesta: propuesta() }),
    mov({ id: 's', confianza: 'seguro', propuesta: propuesta({ preseleccionar: true }) }),
    mov({ id: 'sp', confianza: 'seguro', propuesta: propuesta({ preseleccionar: true, facturaSinAprobar: true }) }),
    mov({ id: 'a', estado: 'por_aclarar' }),
    mov({ id: 'c', estado: 'casado', casado: { id: 'c', tipo: 'factura', porque: '', porQuien: 'folvy', asientoId: 'x', asientoConcepto: null } }),
    mov({ id: 'i', estado: 'ignorado' }),
  ]
  it('«N por revisar»: lo que espera a una persona', () => { expect(porRevisar(movs)).toBe(4) })
  it('los seguros marcados son los mismos que preselecciona la pantalla de hoy (cuadreDe)', () => {
    expect(segurosMarcados(movs)).toEqual(['s'])
    expect(segurosMarcados(movs)).toEqual(cuadreDe(movs, null, null, '2026-07').preseleccionados)
  })
})

describe('mover: ↑ ↓ sin salirse', () => {
  it('baja, sube y se para en los bordes', () => {
    expect(mover(-1, 1, 3)).toBe(0)
    expect(mover(0, 1, 3)).toBe(1)
    expect(mover(2, 1, 3)).toBe(2)
    expect(mover(0, -1, 3)).toBe(0)
    expect(mover(-1, -1, 3)).toBe(2)
    expect(mover(0, 1, 0)).toBe(-1)
  })
})

describe('cuentaDe: «A qué va»', () => {
  it('con propuesta, la cuenta que no es la del banco (la de «El asiento que sale»)', () => {
    expect(cuentaDe(mov({ id: '1', propuesta: propuesta() }), '57200001')).toBe('40000007')
  })
  it('casado, la de su asiento; sin nada, ninguna', () => {
    expect(cuentaDe(mov({ id: '2', estado: 'casado', casado: { id: 'c', tipo: 'x', porque: '', porQuien: 'folvy', asientoId: 'a', asientoConcepto: null } }), '57200001', '62600000')).toBe('62600000')
    expect(cuentaDe(mov({ id: '3', estado: 'por_aclarar' }), '57200001')).toBeNull()
  })
})

describe('confirmar y deshacer: las mismas llamadas al motor que la pantalla de hoy', () => {
  const ctx = { accountId: 'acc', companyId: 'emp', hoy: '2026-07-31' }
  beforeEach(() => { motor.confirmar.mockReset().mockResolvedValue({ asiento: 'a1', creado: true }); motor.deshacer.mockReset().mockResolvedValue('a1'); motor.conciliarPendientes.mockReset().mockResolvedValue({}) })

  it('confirmar: nucleo.confirmar(id, porqué, destino, confianza, regla), como Movimientos.tsx', async () => {
    await confirmarPropuesta(ctx, mov({ id: 'm1', confianza: 'seguro', propuesta: propuesta({ reglaId: 'r1' }) }))
    expect(motor.confirmar).toHaveBeenCalledWith('m1', 'Mismo importe y vencía hoy.', FACTURA, 'seguro', 'r1')
  })
  it('sin porqué ni confianza: el «que» de la propuesta y «probable», como hoy', async () => {
    await confirmarPropuesta(ctx, mov({ id: 'm2', porque: null, confianza: null, propuesta: propuesta() }))
    expect(motor.confirmar).toHaveBeenCalledWith('m2', 'Paga F-0001', FACTURA, 'probable', null)
  })
  it('una propuesta de otro motor no se confirma: se vuelve a calcular y se dice', async () => {
    await expect(confirmarPropuesta(ctx, mov({ id: 'm3', propuesta: propuesta({ motor: 'viejo' }) }))).rejects.toThrow(PROPUESTA_RECALCULADA)
    expect(motor.conciliarPendientes).toHaveBeenCalledWith('acc', 'emp', '2026-07-31')
    expect(motor.confirmar).not.toHaveBeenCalled()
  })
  it('en bloque: uno a uno, y lo que falla se dice uno a uno', async () => {
    motor.confirmar.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('ya estaba casado'))
    const r = await confirmarVarios(ctx, [mov({ id: 'a', propuesta: propuesta() }), mov({ id: 'b', propuesta: propuesta() })], (m) => m.id)
    expect(r).toEqual({ bien: 1, de: 2, importeCent: 35744, mal: ['b: ya estaba casado'], recalculado: false })
  })
  it('deshacer: nucleo.deshacer(casado, motivo)', async () => {
    await deshacerCasado(mov({ id: 'c', estado: 'casado', casado: { id: 'cas1', tipo: 'x', porque: '', porQuien: 'folvy', asientoId: 'a', asientoConcepto: null } }))
    expect(motor.deshacer).toHaveBeenCalledWith('cas1', MOTIVO_DESHACER)
  })
})
