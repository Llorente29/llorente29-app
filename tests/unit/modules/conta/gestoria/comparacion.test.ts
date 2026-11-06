// G01 · Tarea 2. La comparación del mes: lo que suman las líneas en Sumied
// con sus tarifas frente a lo que cobra hoy GoCardless. Con una tarifa propia
// que manda sobre la general, un empleado de baja a mitad de mes y una anual.
// Todo inventado (T11).
import { describe, expect, it } from 'vitest'
import { afectaA, comparar, euros, tarifaDelMes, type Linea, type Tarifa } from '../../../../../supabase/functions/conta-gocardless-leer/comparacion'

const linea = (id: string, extra: Partial<Linea> = {}): Linea => ({
  id, emisor: 'a', servicio: 'gestion_laboral', nombreServicio: 'Gestión laboral', detalle: null, empleado: `EMPLEADO ${id} PRUEBA`,
  importePropioCent: null, periodo: 'mes', desde: '2026-01', hasta: null, suscripcionId: `SB${id}`, ...extra,
})
const TARIFAS: Tarifa[] = [
  { emisor: 'a', servicio: 'gestion_laboral', clienteId: null, importeCent: 2000, periodo: 'mes', desde: '2026-01', hasta: null },
  { emisor: 'a', servicio: 'gestion_laboral', clienteId: 'c1', importeCent: 2420, periodo: 'mes', desde: '2026-01', hasta: null },
  { emisor: 'a', servicio: 'gestoria_mensual', clienteId: null, importeCent: 9075, periodo: 'mes', desde: '2026-01', hasta: null },
]

describe('G01 · comparación de totales', () => {
  it('la tarifa propia del cliente manda sobre la general; sin propia, la general', () => {
    expect(tarifaDelMes(TARIFAS, 'c1', 'a', 'gestion_laboral', '2026-11')).toMatchObject({ propia: true, tarifa: { importeCent: 2420 } })
    expect(tarifaDelMes(TARIFAS, 'c2', 'a', 'gestion_laboral', '2026-11')).toMatchObject({ propia: false, tarifa: { importeCent: 2000 } })
  })

  it('un cambio de tarifa vale desde su mes: antes, la de antes', () => {
    const t: Tarifa[] = [...TARIFAS, { emisor: 'a', servicio: 'gestion_laboral', clienteId: 'c1', importeCent: 2600, periodo: 'mes', desde: '2026-12', hasta: null }]
    expect(tarifaDelMes(t, 'c1', 'a', 'gestion_laboral', '2026-11')?.tarifa.importeCent).toBe(2420)
    expect(tarifaDelMes(t, 'c1', 'a', 'gestion_laboral', '2026-12')?.tarifa.importeCent).toBe(2600)
  })

  it('cuadra cuando Sumied y GoCardless cobran lo mismo', () => {
    const r = comparar('c1', '2026-11', [linea('1'), linea('2')], TARIFAS, [
      { id: 'SB1', emisor: 'a', nombre: 'GESTION LABORAL EMPLEADO 1 PRUEBA', alMesCent: 2420 },
      { id: 'SB2', emisor: 'a', nombre: 'GESTION LABORAL EMPLEADO 2 PRUEBA', alMesCent: 2420 },
    ])
    expect(r).toMatchObject({ sumiedCent: 4840, gocardlessCent: 4840, diferenciaCent: 0, explicaciones: [] })
    expect(r.lineas.map((l) => l.precio)).toEqual(['tarifa propia', 'tarifa propia'])
  })

  it('un empleado de baja a mitad de octubre cuenta octubre y no noviembre; GoCardless le sigue cobrando', () => {
    const lineas = [linea('1'), linea('2', { hasta: '2026-10' })]
    const gc = [
      { id: 'SB1', emisor: 'a', nombre: 'GESTION LABORAL EMPLEADO 1 PRUEBA', alMesCent: 2420 },
      { id: 'SB2', emisor: 'a', nombre: 'GESTION LABORAL EMPLEADO 2 PRUEBA', alMesCent: 2420 },
    ]
    expect(comparar('c1', '2026-10', lineas, TARIFAS, gc).diferenciaCent).toBe(0)
    const nov = comparar('c1', '2026-11', lineas, TARIFAS, gc)
    expect(nov).toMatchObject({ sumiedCent: 2420, gocardlessCent: 4840, diferenciaCent: -2420 })
    expect(nov.explicaciones).toEqual(['GoCardless cobra a EMPLEADO 2 PRUEBA, que está de baja en Sumied desde noviembre.'])
  })

  it('una anual se compara al mes: su doceava parte', () => {
    const r = comparar('c1', '2026-11', [linea('9', { servicio: 'vigilancia', nombreServicio: 'VIGILANCIA DE PRUEBA', empleado: null, importePropioCent: 60500, periodo: 'anio' })], TARIFAS,
      [{ id: 'SB9', emisor: 'a', nombre: 'VIGILANCIA DE PRUEBA', alMesCent: 5042 }])
    expect(r).toMatchObject({ sumiedCent: 5042, gocardlessCent: 5042, diferenciaCent: 0 })
    expect(r.lineas[0].precio).toBe('propio de la línea')
  })

  it('explica en palabras lo que no cuadra', () => {
    const r = comparar('c1', '2026-11',
      [linea('1', { importePropioCent: 3025 }), linea('3', { servicio: 'otro', nombreServicio: 'SERVICIO SIN TARIFA', empleado: null, suscripcionId: null })],
      TARIFAS,
      [{ id: 'SB1', emisor: 'a', nombre: 'GESTION LABORAL EMPLEADO 1 PRUEBA', alMesCent: 2420 }, { id: 'SB8', emisor: 'a', nombre: 'GESTORIA MENSUAL', alMesCent: 9075 }])
    expect(r.explicaciones).toEqual([
      'SERVICIO SIN TARIFA no tiene tarifa en noviembre: no suma nada.',
      'Gestión laboral · EMPLEADO 1 PRUEBA: Sumied 30,25 € y GoCardless 24,20 € al mes.',
      'GoCardless cobra «GESTORIA MENSUAL» (90,75 € al mes), que no es ninguna línea en Sumied.',
    ])
  })

  it('cambiar la tarifa laboral de un cliente afecta a sus empleados de alta sin importe propio', () => {
    const lineas = [linea('1'), linea('2'), linea('3'), linea('4', { importePropioCent: 3025 }), linea('5', { hasta: '2026-10' })]
    expect(afectaA(lineas, 'a', 'gestion_laboral', '2026-12')).toBe(3)
  })

  it('los euros, a la española', () => {
    expect(euros(2420)).toBe('24,20 €')
    expect(euros(2412400)).toBe('24.124,00 €')
    expect(euros(-2420)).toBe('−24,20 €')
  })
})
