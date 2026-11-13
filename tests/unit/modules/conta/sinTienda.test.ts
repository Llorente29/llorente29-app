// tests/unit/modules/conta/sinTienda.test.ts
//
// S01p·18 · punto 6 · Antes de decir «No ha llegado su liquidación», se mira si está en
// los libros sin tienda asignada. Regla 31: las liquidaciones son las 8 de Uber de Foodint
// sin local ni marca (producción, solo lectura, 13/11), con su tienda, sus fechas y su neto.

import { describe, expect, it } from 'vitest'
import { fraseHaySinTienda, lineaSinTienda, sinTiendaDeLaSemana, tituloSinTienda } from '@/modules/conta/lib/sinTienda'
import type { SinTienda } from '@/modules/conta/services/liquidacionesMotorService'

const liq = (tienda: string, desde: string, hasta: string, neto: number): SinTienda =>
  ({ id: `${tienda}:${desde}`, canal: 'Uber', tienda, storeId: tienda, desde, hasta, neto, marca: 'Marca', local: 'Local', porque: null })
const OCHO = [
  liq('Scandal Burgers', '2026-09-07', '2026-10-18', 18.09),
  liq('Bendito Burrito', '2026-10-05', '2026-10-11', 110),
  liq('Milanesa House (Calle de Camichi 4)', '2026-10-12', '2026-10-18', 66.94),
  liq('Bendito Burrito', '2026-10-12', '2026-10-18', 66.78),
  liq('Meraki Pita', '2026-10-12', '2026-10-18', 782.16),
  liq("Mila's Sandwiches", '2026-10-12', '2026-10-18', 49.3),
  liq('The Urban Kebab', '2026-10-12', '2026-10-18', 29.07),
  liq('Milanesa House', '2026-10-12', '2026-10-18', 216.92),
]

describe('las sin tienda de una semana', () => {
  it('la semana del 12/10 al 18/10 de Uber: las 6 de esa semana y la del 07/09 al 18/10, que la pisa', () => {
    expect(sinTiendaDeLaSemana('Uber', '2026-10-12', '2026-10-18', OCHO)).toHaveLength(7)
  })
  it('la del 05/10 al 11/10: Bendito Burrito y la larga', () => {
    expect(sinTiendaDeLaSemana('Uber', '2026-10-05', '2026-10-11', OCHO).map((x) => x.tienda)).toEqual(['Scandal Burgers', 'Bendito Burrito'])
  })
  it('otra plataforma, o una semana que no pisan, nada; «Uber Eats» es Uber', () => {
    expect(sinTiendaDeLaSemana('Glovo', '2026-10-12', '2026-10-18', OCHO)).toEqual([])
    expect(sinTiendaDeLaSemana('Uber', '2026-10-26', '2026-11-01', OCHO)).toEqual([])
    expect(sinTiendaDeLaSemana('Uber Eats', '2026-10-05', '2026-10-11', OCHO)).toHaveLength(2)
    expect(sinTiendaDeLaSemana('Uber', null, '2026-10-11', OCHO)).toEqual([])
  })
})

describe('las frases', () => {
  it('el título y la línea', () => {
    expect(tituloSinTienda(OCHO)).toBe('8 liquidaciones de Uber sin tienda asignada')
    expect(tituloSinTienda(OCHO.slice(0, 1))).toBe('1 liquidación de Uber sin tienda asignada')
    expect(lineaSinTienda(OCHO[4])).toMatch(/^Uber · «Meraki Pita» · 12\/10–18\/10 · 782,16\s€$/)
  })
  it('la fila que diría «no ha llegado» dice que puede que sí, cuál, y que la asigne antes de pedirla', () => {
    const f = fraseHaySinTienda('Uber', [OCHO[1]])
    expect(f).toMatch(/^Puede que sí haya llegado: en los libros hay 1 liquidación de Uber de estas fechas sin tienda asignada \(«Bendito Burrito», 05\/10–11\/10, 110,00\s€\)\. Asígnala arriba antes de pedirla\.$/)
    expect(fraseHaySinTienda('Uber', OCHO.slice(0, 2))).toMatch(/hay 2 liquidaciones de Uber/)
  })
})
