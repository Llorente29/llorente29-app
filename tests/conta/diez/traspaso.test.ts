// C12 (24/10) · El traspaso del mes a Diez: qué va en cada tanda, el cuadre
// cuenta a cuenta contra getSumasYsaldos (una fila por apunte, como la da
// Diez) y el rango del mes. Cuentas y nombres con la forma del plan de Sumied;
// importes inventados.
import { describe, expect, it } from 'vitest'
import { cuadrar, rangoDelMes, siguientes, subcuenta, sumarDiez } from '../../../supabase/functions/_shared/diezTraspaso'

// Lo que Diez devuelve: una fila por apunte, con la subcuenta como número o texto.
const apunte = (Subcuenta: string | number, Debe: number, Haber: number) => ({ Subcuenta, Debe, Haber, Concepto: 'x' })

describe('sumarDiez', () => {
  it('suma los apuntes por subcuenta, al céntimo (sin el error de coma flotante)', () => {
    const m = sumarDiez([apunte('57200001', 0.1, 0), apunte(57200001, 0.2, 0), apunte('43000002', 0, 10.5)])
    expect(m.get('57200001')).toEqual({ debe: 30, haber: 0 })
    expect(m.get('43000002')).toEqual({ debe: 0, haber: 1050 })
  })
  it('limpia la subcuenta (puntos y espacios) y salta las filas sin ella', () => {
    expect(subcuenta('4300.0002 ')).toBe('43000002')
    expect(sumarDiez([{ Debe: 5, Haber: 0 }]).size).toBe(0)
  })
})

describe('cuadrar', () => {
  const sumied = [
    { cuenta: '43000002', nombre: 'Clientes Uber', debe: 110, haber: 0 },
    { cuenta: '70000002', nombre: 'Ventas', debe: 0, haber: 100 },
    { cuenta: '47700010', nombre: 'IVA repercutido 10 %', debe: 0, haber: 10 },
  ]
  it('«Cuadra» cuando cada cuenta de Sumied tiene en Diez el mismo debe y haber', () => {
    const r = cuadrar(sumied, [apunte('43000002', 60, 0), apunte('43000002', 50, 0), apunte('70000002', 0, 100), apunte('47700010', 0, 10)])
    expect(r).toEqual({ cuadra: true, cuentas: 3, diferencias: [], solo_en_diez: [] })
  })
  it('dice qué cuenta difiere y por cuánto (lo que falta en Diez)', () => {
    const r = cuadrar(sumied, [apunte('43000002', 60, 0), apunte('70000002', 0, 100), apunte('47700010', 0, 10)])
    expect(r.cuadra).toBe(false)
    expect(r.diferencias).toEqual([{ cuenta: '43000002', nombre: 'Clientes Uber', sumied: { debe: 110, haber: 0 }, diez: { debe: 60, haber: 0 }, falta_debe: 50, falta_haber: 0 }])
  })
  it('una cuenta de Sumied que no está en Diez es una diferencia entera', () => {
    const r = cuadrar(sumied, [apunte('43000002', 110, 0), apunte('70000002', 0, 100)])
    expect(r.diferencias.map((d) => [d.cuenta, d.falta_haber])).toEqual([['47700010', 10]])
  })
  it('lo que solo está en Diez se enseña aparte y no rompe el cuadre (regla 7: no se esconde)', () => {
    const r = cuadrar(sumied, [apunte('43000002', 110, 0), apunte('70000002', 0, 100), apunte('47700010', 0, 10), apunte('62900000', 25, 0), apunte('55500000', 0, 0)])
    expect(r.cuadra).toBe(true)
    expect(r.solo_en_diez).toEqual([{ cuenta: '62900000', debe: 25, haber: 0 }])
  })
  it('lo que Diez tiene de más en una cuenta de Sumied también es diferencia (en negativo)', () => {
    const r = cuadrar(sumied, [apunte('43000002', 120, 0), apunte('70000002', 0, 100), apunte('47700010', 0, 10)])
    expect(r.diferencias[0].falta_debe).toBe(-10)
  })
  it('un mes sin nada en Sumied ni en Diez cuadra', () => {
    expect(cuadrar([], []).cuadra).toBe(true)
  })
})

describe('siguientes', () => {
  const lista = [3, 1, 2, 4, 5].map((o) => ({ entry_id: `e${o}`, orden: o, tipo: 'manuales' }))
  it('en el orden de la lista, de n en n', () => {
    expect(siguientes(lista, new Set(), 2)).toEqual({ tanda: [lista[1], lista[2]], quedan: 3 })
  })
  it('salta lo que ya ha fallado en este traspaso (no se reintenta en bucle)', () => {
    const r = siguientes(lista, new Set(['e1', 'e3']), 10)
    expect(r.tanda.map((x) => x.entry_id)).toEqual(['e2', 'e4', 'e5'])
    expect(r.quedan).toBe(0)
  })
  it('con todo fallado, no queda nada', () => {
    expect(siguientes(lista, new Set(lista.map((x) => x.entry_id)), 5)).toEqual({ tanda: [], quedan: 0 })
  })
})

describe('rangoDelMes', () => {
  it('octubre, febrero bisiesto y diciembre', () => {
    expect(rangoDelMes('2026-10-01')).toEqual({ ejercicio: '2026', desde: 20261001, hasta: 20261031 })
    expect(rangoDelMes('2028-02-01')).toEqual({ ejercicio: '2028', desde: 20280201, hasta: 20280229 })
    expect(rangoDelMes('2026-12-01')).toEqual({ ejercicio: '2026', desde: 20261201, hasta: 20261231 })
  })
  it('un mes que no lo es, parado', () => {
    expect(() => rangoDelMes('2026-13-01')).toThrow()
    expect(() => rangoDelMes('octubre')).toThrow()
  })
})
