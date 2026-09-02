import { describe, it, expect } from 'vitest'
import { agrupaPorLocal } from '@/modules/ventas/home/ventasDelDia'

const NOMBRES = new Map([['a', 'Foodint Alcalá'], ['c', 'Foodint Carabanchel']])

describe('agrupaPorLocal', () => {
  it('suma importes y cuenta pedidos por local, de más a menos', () => {
    const r = agrupaPorLocal([
      { total: 1000, location_id: 'a' },
      { total: 450, location_id: 'a' },
      { total: 1260, location_id: 'c' },
    ], NOMBRES)
    expect(r.total).toBe(2710)
    expect(r.pedidos).toBe(3)
    expect(r.porLocal).toEqual([
      { locationId: 'a', nombre: 'Foodint Alcalá', total: 1450, pedidos: 2 },
      { locationId: 'c', nombre: 'Foodint Carabanchel', total: 1260, pedidos: 1 },
    ])
  })

  // La suma de las filas TIENE que cuadrar con la cifra grande. Descartar una
  // venta sin local haría que no cuadrara y nadie sabría por qué.
  it('una venta sin local no se descarta: se dice que no lo tiene', () => {
    const r = agrupaPorLocal([
      { total: 100, location_id: 'a' }, { total: 50, location_id: null },
    ], NOMBRES)
    expect(r.total).toBe(150)
    expect(r.porLocal.reduce((s, l) => s + l.total, 0)).toBe(r.total)
    expect(r.porLocal.map(l => l.nombre)).toContain('Sin local')
  })

  it('un local que no está en el mapa se marca, no se inventa el nombre', () => {
    const r = agrupaPorLocal([{ total: 10, location_id: 'zzz' }], NOMBRES)
    expect(r.porLocal[0].nombre).toBe('Local no identificado')
  })

  it('un total nulo cuenta como pedido pero suma cero, no rompe', () => {
    const r = agrupaPorLocal([{ total: null, location_id: 'a' }], NOMBRES)
    expect(r.total).toBe(0)
    expect(r.pedidos).toBe(1)
  })

  it('sin ventas: cero de verdad, sin filas inventadas', () => {
    const r = agrupaPorLocal([], NOMBRES)
    expect(r).toEqual({ total: 0, pedidos: 0, porLocal: [] })
  })
})
