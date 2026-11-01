// S01d-b · Los tres fallos de la prueba real con Foodint (respuesta 3 de
// Julio, 30/10). Cifras inventadas: nada del PDF de la TGSS real ni del
// Excel de BBVA.
import { describe, expect, it } from 'vitest'
import { propuestaDePago } from '@/modules/conta/lib/pagoDeModelo'

describe('3 · «Es el pago de un modelo» propone el de la cuenta', () => {
  const declaraciones = [
    { modelo: '111', ejercicio: 2026, periodo: '3T', importeCent: 57801 },
    { modelo: '115', ejercicio: 2026, periodo: '3T', importeCent: 106902 },
  ]
  it('la subcuenta del 115 propone el 115, y el periodo de la declaración sin pagar por ese importe', () => {
    expect(propuestaDePago('115', declaraciones, 106902, '2026-10-20')).toMatchObject({ modelo: '115', ejercicio: 2026, periodo: '3T' })
  })
  it('sin declaración por ese importe, el trimestre anterior a la fecha del asiento (y en enero, el 4T del año antes)', () => {
    expect(propuestaDePago('115', declaraciones, 99500, '2026-10-05')).toMatchObject({ modelo: '115', ejercicio: 2026, periodo: '3T', porque: 'el trimestre anterior a la fecha del asiento' })
    expect(propuestaDePago('111', [], 1000, '2027-01-20')).toMatchObject({ modelo: '111', ejercicio: 2026, periodo: '4T' })
  })
  it('una cuenta sin modelo propone el 111; uno que no es de retenciones, también', () => {
    expect(propuestaDePago(null, declaraciones, 57801, '2026-10-20')).toMatchObject({ modelo: '111', periodo: '3T' })
    expect(propuestaDePago('303', [], 1, '2026-05-02').modelo).toBe('111')
  })
})

import { comprobarCuadro, esAcumulada } from '../../../supabase/functions/_shared/lecturaCuadro'
import { avisoDeCuotas, comprobarCuadroLeido, leerCuadro } from '@/modules/conta/lib/contratos'
import { decidir, type Contexto, type Contrato, type Movimiento } from '@/modules/conta/lib/conciliacion'

// La forma de la resolución de la TGSS, con números inventados: 36 cuotas, el cuadro del
// año en curso trae 2, la «Deuda Amortizada» es ACUMULADA y da la deuda pendiente al final.
const RESOLUCION = {
  tipo: 'aplazamiento', organismo: 'Seguridad Social', importe_aplazado: 10000, cuotas_totales: 36, deuda_pendiente: 9476.47,
  filas: [
    { fecha: '2026-11-30', concepto: '(11 2026)', cuota: 294.37, capital: 261.31, intereses: null },
    { fecha: '2026-12-31', concepto: '(12 2026)', cuota: 294.37, capital: 523.53, intereses: null },
  ],
}

describe('1 · El aplazamiento de la Seguridad Social: cuadro parcial y amortizada acumulada', () => {
  it('la amortizada acumulada se pasa a capital por cuota, y los intereses son la cuota menos el capital', () => {
    const r = comprobarCuadro(RESOLUCION)
    expect(r).toMatchObject({ cuotasTotales: 36, parcial: true, acumulada: true, deudaPendiente: 9476.47, sumaCapital: 523.53, cuadra: true,
      filas: [{ fecha: '2026-11-30', cuota: 294.37, capital: 261.31, intereses: 33.06 }, { fecha: '2026-12-31', cuota: 294.37, capital: 262.22, intereses: 32.15 }] })
  })
  it('si lo pendiente no sale, no cuadra; y un capital por cuota que sube no se toma por acumulado', () => {
    expect(comprobarCuadro({ ...RESOLUCION, deuda_pendiente: 9000 })).toMatchObject({ acumulada: false, cuadra: false })
    expect(esAcumulada([100, 101, 102], 303, null)).toBe(false)
    expect(esAcumulada([100, 201, 303], 303, null)).toBe(true)
  })
  it('una fila de formalización nunca es una cuota', () => {
    const r = comprobarCuadro({ importe_aplazado: 1000, filas: [{ fecha: '2026-01-03', concepto: 'Formalización', cuota: 990, capital: 1000, intereses: 0 }, { fecha: '2026-02-03', cuota: 1000, capital: 1000, intereses: 0 }] })
    expect('filas' in r && r.filas.map((f) => f.fecha)).toEqual(['2026-02-03'])
  })
  it('en la pantalla: el parcial se comprueba con lo pendiente, y avisa de las cuotas del año que viene', () => {
    const filas = [{ fecha: '2026-11-30', cuotaCent: 29437, capitalCent: 26131, interesesCent: 3306 }, { fecha: '2026-12-31', cuotaCent: 29437, capitalCent: 26222, interesesCent: 3215 }]
    expect(comprobarCuadroLeido(filas, 1_000_000, 36, 947_647)).toEqual({ cuadra: true, parcial: true, sumaCent: 52353,
      texto: 'Lo aplazado menos el capital de las 2 cuotas del cuadro da 9.476,47 €: es la deuda pendiente del cuadro.' })
    expect(comprobarCuadroLeido(filas, 1_000_000, 36, null).cuadra).toBe(false)
    expect(comprobarCuadroLeido(filas, 52353, 2, null)).toMatchObject({ cuadra: true, parcial: false })
    expect(avisoDeCuotas({ tipo: 'aplazamiento', cuotas: 36, cuadro: filas })).toBe('Faltan las cuotas de 2027: sube el cuadro de ese año cuando llegue.')
    expect(avisoDeCuotas({ tipo: 'aplazamiento', cuotas: 2, cuadro: filas })).toBeNull()
  })
  it('el cargo del 30/11 se casa solo con su fila, repartido en capital a corto e intereses', () => {
    const tgss: Contrato = { id: 't', tipo: 'aplazamiento', nombre: 'Aplazamiento Seguridad Social', contiene: 'TGSS APLAZAMIENTO', importeCent: 29437, confirmaciones: 0,
      terceroId: null, cuentaGasto: null, cuentaCapital: '52100002', cuentaIntereses: '66900000',
      cuadro: [{ fecha: '2026-11-30', cuotaCent: 29437, capitalCent: 26131, interesesCent: 3306 }, { fecha: '2026-12-31', cuotaCent: 29437, capitalCent: 26222, interesesCent: 3215 }] }
    const ctx = { cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
      nominas: [], reglas: [], aprendido: [], asientos: [], impuestos: [], cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
      nombres: {}, contratos: [tgss] } as unknown as Contexto
    const m: Movimiento = { id: 'm', cuentaId: 'cta', fecha: '2026-11-30', conceptoComun: null, referencias: [], antesDelCorte: false, importeCent: -29437, concepto: 'ADEUDO TGSS APLAZAMIENTO CUOTA 1' }
    const d = decidir(m, ctx)
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toMatchObject({ lineas: [{ cuenta: '52100002', importe: 261.31 }, { cuenta: '66900000', importe: 33.06 }] })
  })
})

describe('2 · El Excel de «Amortizaciones y movimientos» no es un cuadro', () => {
  it('lo reconoce por su título o por sus columnas, y lo dice', () => {
    const MSG = { error: 'Este Excel es el historial de lo ya pagado. Sube el de «Próximas cuotas».' }
    expect(leerCuadro([['AMORTIZACIONES Y MOVIMIENTOS'], [], ['Fecha', 'Cuota', 'Capital', 'Intereses']])).toEqual(MSG)
    expect(leerCuadro([['Fecha de operación', 'Tipo de movimiento', 'Importe', 'Capital', 'Intereses']])).toEqual(MSG)
  })
  it('en un cuadro, la fila de la formalización no cuenta como cuota', () => {
    const r = leerCuadro([['Fecha', 'Concepto', 'Cuota', 'Capital', 'Intereses'], ['03/01/2026', 'FORMALIZACION', '39.900,00', '40.000,00', '0,00'], ['03/02/2026', 'CUOTA', '700,00', '600,00', '100,00']])
    expect('cuadro' in r && r.cuadro.map((f) => f.fecha)).toEqual(['2026-02-03'])
  })
})
