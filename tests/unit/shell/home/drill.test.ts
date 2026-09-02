// El contrato de drill-through. Se prueba la construcción de la URL porque es
// lo que la comprobación 2 del encargo exige enseñar: la URL de destino, no un
// «debería llevar a Ventas».

import { describe, it, expect } from 'vitest'
import { construyeUrl, fechaISO } from '@/shell/home/drill'

describe('construyeUrl', () => {
  it('sin filtros deja la ruta limpia, sin «?» colgando', () => {
    expect(construyeUrl({ ruta: '/ventas', etiqueta: 'Abrir Ventas →' })).toBe('/ventas')
  })

  it('mete los filtros como query params', () => {
    expect(construyeUrl({
      ruta: '/ventas', etiqueta: 'Abrir Ventas →',
      filtros: { desde: '2026-08-29', hasta: '2026-08-30' },
    })).toBe('/ventas?desde=2026-08-29&hasta=2026-08-30')
  })

  // El caso que ensucia una URL y rompe el destino: un local nulo en consolidado
  // viajando como la cadena «null», que el destino leería como un uuid.
  it('omite los filtros vacíos en vez de mandarlos como «null»', () => {
    const url = construyeUrl({
      ruta: '/kitchen/disponibilidad', etiqueta: 'Abrir Disponibilidad →',
      filtros: { local: null, otro: '' },
    })
    expect(url).toBe('/kitchen/disponibilidad')
    expect(url).not.toContain('null')
  })

  it('escapa lo que haga falta', () => {
    expect(construyeUrl({
      ruta: '/personal/calendario', etiqueta: 'x', filtros: { q: 'a b&c' },
    })).toContain('a+b%26c')
  })
})

describe('fechaISO', () => {
  // toISOString() sobre una fecha local a las 00:00 en Madrid (UTC+2) devuelve
  // el DÍA ANTERIOR. Es la regla 4 del proyecto, aquí en su versión de front.
  it('da el día LOCAL, no el que sale de toISOString()', () => {
    const medianocheMadrid = new Date(2026, 7, 30, 0, 0, 0)
    expect(fechaISO(medianocheMadrid)).toBe('2026-08-30')
  })
  it('rellena mes y día a dos cifras', () => {
    expect(fechaISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
