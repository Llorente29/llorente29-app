// C04 R4 · «Proponer lo pendiente»: corte, pregunta y orden (lib/proponer.ts).
//
// La población es la forma real medida en producción el 08/10 (solo lectura):
// ejercicio 2026 (01/01–31/12), primera venta en Folvy el 12/06/2026, corte
// fijado por Julio el 30/09/2026, y los días con ventas de dos locales que
// el 08/10 salieron propuestos (21/06–13/08, 60 días × 2 locales = 120).
// Lo que no sale de ahí (un cliente con ventas del año anterior) se dice.

import { describe, expect, it } from 'vitest'
import { rangoAProponer, corteDesdeRespuesta, tandaDeDias, diaSiguiente, diaAnterior } from '@/modules/conta/lib/proponer'
import { ultimoDiaCerrado } from '@/modules/conta/lib/cierreDelDia'

const E2026 = { inicio: '2026-01-01', fin: '2026-12-31', traidoHasta: null as string | null }
const HOY = '2026-10-08'

// Los 120 de producción, tal cual (08/10, solo lectura): MMDD + local
// anonimizado (L1–L3). 29 en junio (10 días), 73 en julio (31), 18 en agosto
// (12 días: el 01/08 no hay ninguno). Tres locales que no abren todos los días.
const REAL = '0621L1 0621L2 0621L3 0622L1 0622L2 0622L3 0623L1 0623L2 0623L3 0624L1 0624L2 0624L3 0625L1 0625L2 0625L3 0626L1 0626L2 0626L3 0627L1 0627L3 0628L1 0628L2 0628L3 0629L1 0629L2 0629L3 0630L1 0630L2 0630L3 0701L1 0701L2 0701L3 0702L1 0702L2 0702L3 0703L1 0703L2 0703L3 0704L1 0704L2 0704L3 0705L1 0705L2 0705L3 0706L1 0706L2 0706L3 0707L1 0707L2 0707L3 0708L1 0708L2 0708L3 0709L1 0709L2 0709L3 0710L1 0710L2 0710L3 0711L1 0711L2 0711L3 0712L1 0712L2 0712L3 0713L1 0713L3 0714L1 0714L3 0715L1 0715L3 0716L1 0716L3 0717L1 0717L3 0718L3 0719L1 0719L3 0720L1 0720L3 0721L1 0721L3 0722L1 0722L3 0723L1 0723L3 0724L1 0724L3 0725L1 0725L3 0726L1 0726L3 0727L1 0727L3 0728L1 0728L3 0729L1 0729L3 0730L1 0730L3 0731L1 0731L3 0802L1 0802L3 0803L1 0804L3 0805L1 0805L3 0806L1 0806L3 0807L1 0808L1 0808L3 0809L1 0809L3 0810L1 0810L3 0811L3 0812L3 0813L1'
const dias120 = REAL.split(' ').map((x) => ({ dia: `2026-${x.slice(0, 2)}-${x.slice(2, 4)}`, local: x.slice(4) }))

describe('con corte (Foodint, 30/09/2026)', () => {
  const conCorte = { ...E2026, traidoHasta: '2026-09-30' }
  it('empieza el día siguiente al corte y acaba hoy', () => {
    expect(rangoAProponer(conCorte, HOY, { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })).toEqual({ tipo: 'rango', desde: '2026-10-01', hasta: HOY })
  })
  it('no propone nada ≤ corte: ninguno de los 120 días de junio–agosto cae en el rango', () => {
    const r = rangoAProponer(conCorte, HOY, { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })
    if (r.tipo !== 'rango') throw new Error('debería ser un rango')
    expect(dias120.length).toBe(120)
    expect(dias120.filter((x) => x.dia >= r.desde && x.dia <= r.hasta)).toEqual([])
  })
  it('con corte no pregunta, aunque haya ventas antes del ejercicio', () => {
    expect(rangoAProponer(conCorte, HOY, { primeraVenta: '2025-03-01', asientosEnEjercicio: 0 }).tipo).toBe('rango')
  })
  it('si hoy aún es día del programa anterior, lo dice y no propone', () => {
    const r = rangoAProponer(conCorte, '2026-09-15', { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })
    expect(r.tipo).toBe('nada')
  })
})

describe('sin corte', () => {
  it('con la primera venta DENTRO del ejercicio (Foodint antes del corte), propone desde el 01/01 sin preguntar', () => {
    expect(rangoAProponer(E2026, HOY, { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })).toEqual({ tipo: 'rango', desde: '2026-01-01', hasta: HOY })
  })
  it('con ventas ANTERIORES al ejercicio y sin asientos, pregunta antes de proponer', () => {
    const r = rangoAProponer(E2026, HOY, { primeraVenta: '2025-11-20', asientosEnEjercicio: 0 })
    expect(r.tipo).toBe('preguntar')
  })
  it('si el ejercicio ya tiene asientos, la pregunta ya está contestada: no se repite', () => {
    expect(rangoAProponer(E2026, HOY, { primeraVenta: '2025-11-20', asientosEnEjercicio: 3 }).tipo).toBe('rango')
  })
  it('un ejercicio cerrado en el pasado se repasa hasta su último día, no hasta hoy', () => {
    expect(rangoAProponer({ inicio: '2025-01-01', fin: '2025-12-31', traidoHasta: null }, HOY, { primeraVenta: null, asientosEnEjercicio: 0 }))
      .toEqual({ tipo: 'rango', desde: '2025-01-01', hasta: '2025-12-31' })
  })
})

describe('la respuesta a «¿Desde qué día asienta Folvy?»', () => {
  it('el 01/10 → corte el 30/09 (lo de Julio)', () => {
    expect(corteDesdeRespuesta(E2026, '2026-10-01', HOY)).toEqual({ corte: '2026-09-30' })
  })
  it('el primer día del ejercicio → sin corte (todo es de Folvy)', () => {
    expect(corteDesdeRespuesta(E2026, '2026-01-01', HOY)).toEqual({ corte: null })
  })
  it('fuera del ejercicio o en el futuro → error que se enseña', () => {
    expect('error' in corteDesdeRespuesta(E2026, '2025-12-31', HOY)).toBe(true)
    expect('error' in corteDesdeRespuesta(E2026, '2026-10-09', HOY)).toBe(true)
    expect('error' in corteDesdeRespuesta(E2026, '', HOY)).toBe(true)
  })
  it('diaAnterior y diaSiguiente cruzan meses y años', () => {
    expect(diaAnterior('2026-10-01')).toBe('2026-09-30')
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01')
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28')
  })
})

describe('orden: del mes más reciente hacia atrás', () => {
  it('con los 120 de producción, propone primero agosto (18 filas, 12 días) y quedan junio y julio (41 días)', () => {
    // Ordenados por local, no por fecha: el orden lo pone la función, no la consulta.
    const t = tandaDeDias([...dias120].sort((a, b) => a.local.localeCompare(b.local)))
    expect(t.mes).toBe('2026-08')
    expect(t.ahora.length).toBe(18)
    expect(t.ahora[0].dia).toBe('2026-08-13')
    expect(t.ahora.every((d) => d.dia.startsWith('2026-08'))).toBe(true)
    // Quedan junio 21–30 (10 días) y julio (31): agosto entero sale ahora.
    expect(t.quedanDias).toBe(10 + 31)
  })
  it('lo más reciente va antes dentro del mes', () => {
    const t = tandaDeDias([{ dia: '2026-10-02' }, { dia: '2026-10-07' }, { dia: '2026-10-05' }])
    expect(t.ahora.map((d) => d.dia)).toEqual(['2026-10-07', '2026-10-05', '2026-10-02'])
    expect(t.quedanDias).toBe(0)
  })
  it('sin nada pendiente: nada, y 0 días', () => {
    expect(tandaDeDias([])).toEqual({ ahora: [], mes: null, quedanDias: 0 })
  })
})

describe('cierre del día: se propone hasta el último día CERRADO, no hasta hoy', () => {
  it('el 09/10 a las 17:15 de Madrid (el asiento b4eb11ca) el rango acaba el 08/10', () => {
    const cerrado = ultimoDiaCerrado(new Date('2026-10-09T15:15:56Z'), '06:00')
    const r = rangoAProponer(E2026, cerrado, { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })
    expect(r).toEqual({ tipo: 'rango', desde: '2026-01-01', hasta: '2026-10-08' })
  })
  it('a las 5:59 del 09/10 el 08/10 aún no se propone', () => {
    const r = rangoAProponer(E2026, ultimoDiaCerrado(new Date('2026-10-09T03:59:00Z'), '06:00'), { primeraVenta: '2026-06-12', asientosEnEjercicio: 0 })
    expect(r.tipo === 'rango' && r.hasta).toBe('2026-10-07')
  })
})

