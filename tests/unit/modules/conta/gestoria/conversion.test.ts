// G01 · Tarea 2. De las suscripciones de GoCardless de hoy a servicios,
// líneas y tarifas, con los casos de verdad (inventados, T11): un cliente con
// 7 líneas, una gestión laboral con su empleado y otra sin él, una anual y un
// concepto que no es ni gestoría ni laboral.
import { describe, expect, it } from 'vitest'
import { clasificar, convertir, alMesDeLasLineas } from '../../../../../supabase/functions/conta-gocardless-leer/conversion'
import type { SuscripcionGc } from '../../../../../supabase/functions/conta-gocardless-leer/lector'

const sus = (id: string, nombre: string, importeCent: number, extra: Partial<SuscripcionGc> = {}): SuscripcionGc => ({
  id, nombre, importeCent, moneda: 'EUR', intervalo: 'monthly', cada: 1, estado: 'active', mandatoId: 'MD1', inicio: '2026-01-05', fin: null, ...extra,
})
const MANDATOS = new Map([['MD1', 'CU1'], ['MD2', 'CU2']])

describe('G01 · conversión de suscripciones', () => {
  it('sabe qué es cada una por su nombre, sin tildes ni mayúsculas', () => {
    expect(clasificar('GESTORIA MENSUAL')).toEqual({ tipo: 'gestoria', detalle: null })
    expect(clasificar('Gestoría mensual  SOCIEDAD PRUEBA DOS, S.L.')).toEqual({ tipo: 'gestoria', detalle: 'SOCIEDAD PRUEBA DOS, S.L.' })
    expect(clasificar('GESTIÓN LABORAL - Empleado Uno Prueba')).toEqual({ tipo: 'laboral', detalle: 'Empleado Uno Prueba' })
    expect(clasificar('SERVICIOS MENSUALES DE PRUEBA')).toEqual({ tipo: 'otro', detalle: null })
  })

  it('un cliente con 7 líneas: gestoría de dos sociedades, 4 empleados y un concepto suelto', () => {
    const r = convertir('empresa-a', [
      sus('SB1', 'GESTORIA MENSUAL', 9075),
      sus('SB2', 'GESTORIA MENSUAL SOCIEDAD PRUEBA DOS, S.L.', 6050),
      sus('SB3', 'GESTION LABORAL EMPLEADO UNO PRUEBA', 2420),
      sus('SB4', 'GESTION LABORAL EMPLEADO DOS PRUEBA', 2420),
      sus('SB5', 'GESTION LABORAL EMPLEADO TRES PRUEBA', 2420),
      sus('SB6', 'GESTION LABORAL EMPLEADO CUATRO PRUEBA', 3025),
      sus('SB7', 'SERVICIOS MENSUALES DE PRUEBA', 1500),
    ], MANDATOS)
    expect(r.lineas).toHaveLength(7)
    expect(r.noConvertidas).toEqual([])
    expect(r.servicios.map((s) => s.clave).sort()).toEqual(['gestion_laboral', 'gestoria_mensual', 'servicios mensuales de prueba'])
    // La tarifa laboral es la que más se repite; el empleado con otra lleva la suya.
    expect(r.tarifas.find((t) => t.servicio === 'gestion_laboral')).toMatchObject({ clienteGcId: 'CU1', importeCent: 2420, periodo: 'mes' })
    expect(r.lineas.find((l) => l.suscripcionId === 'SB6')).toMatchObject({ empleado: 'EMPLEADO CUATRO PRUEBA', importePropioCent: 3025, origen: 'gocardless' })
    expect(r.lineas.filter((l) => l.servicio === 'gestion_laboral' && l.importePropioCent === null)).toHaveLength(3)
    // Lo convertido suma lo mismo que cobra hoy GoCardless.
    expect(alMesDeLasLineas(r.lineas)).toBe(9075 + 6050 + 2420 * 3 + 3025 + 1500)
  })

  it('una gestión laboral con su empleado es una línea; sin el nombre, no se convierte y dice por qué', () => {
    const r = convertir('empresa-a', [sus('SB1', 'GESTION LABORAL EMPLEADO UNO PRUEBA', 2420), sus('SB2', 'GESTION LABORAL', 2420)], MANDATOS)
    expect(r.lineas.map((l) => [l.suscripcionId, l.empleado])).toEqual([['SB1', 'EMPLEADO UNO PRUEBA']])
    expect(r.noConvertidas).toEqual([{ suscripcionId: 'SB2', clienteGcId: 'CU1', emisor: 'empresa-a', nombre: 'GESTION LABORAL',
      porque: 'Es gestión laboral sin el nombre del empleado: no se sabe de quién es la línea.' }])
  })

  it('un concepto que no es ni gestoría ni laboral es un servicio con su nombre, fijo al mes y por confirmar', () => {
    const r = convertir('empresa-b', [sus('SB1', 'SERVICIOS MENSUALES DE PRUEBA', 1500, { mandatoId: 'MD2' })], MANDATOS)
    expect(r.servicios).toEqual([{ clave: 'servicios mensuales de prueba', nombre: 'SERVICIOS MENSUALES DE PRUEBA', forma: 'fijo_mes', porConfirmar: true }])
    expect(r.lineas[0]).toMatchObject({ clienteGcId: 'CU2', emisor: 'empresa-b', detalle: null, empleado: null })
  })

  it('una anual queda al año, y al mes cuenta la doceava parte', () => {
    const r = convertir('empresa-b', [sus('SB1', 'VIGILANCIA DE PRUEBA', 60500, { intervalo: 'yearly' })], MANDATOS)
    expect(r.servicios[0]).toMatchObject({ forma: 'fijo_anio' })
    expect(r.tarifas[0]).toMatchObject({ importeCent: 60500, periodo: 'anio' })
    expect(alMesDeLasLineas(r.lineas)).toBe(5042)
  })

  it('lo que no se puede convertir sale con su porqué; lo cancelado no se importa', () => {
    const r = convertir('empresa-a', [
      sus('SB1', 'GESTORIA MENSUAL', 9075, { mandatoId: 'MD9' }),
      sus('SB2', 'GESTORIA MENSUAL', 9075, { intervalo: 'weekly' }),
      sus('SB3', 'GESTORIA MENSUAL', 9075, { moneda: 'GBP' }),
      sus('SB4', 'GESTORIA MENSUAL', 9075, { estado: 'cancelled' }),
      sus('SB5', 'GESTORIA MENSUAL', 9075, { cada: 3 }),
    ], MANDATOS)
    expect(r.lineas).toEqual([])
    expect(r.noConvertidas.map((n) => [n.suscripcionId, n.porque])).toEqual([
      ['SB1', 'Su mandato no es de ningún cliente leído de esta cuenta.'],
      ['SB2', 'Se cobra cada semana: la gestoría dice cómo se pasa a una tarifa.'],
      ['SB3', 'Cobra en GBP, no en euros.'],
      ['SB5', 'Se cobra cada 3 meses: la gestoría dice cómo se pasa a una tarifa.'],
    ])
  })
})
