import { describe, expect, it } from 'vitest'
import { rutaConta, rutaMayor } from '@/config/navegacion'
import { atajoMayor, opciones } from '@/modules/conta/marco/nuevo/buscar'
import { ORDENES, ordenDisponible } from '@/modules/conta/esqueleto/ordenes'
import type { Contexto } from '@/modules/conta/esqueleto/productos'

const CON_TODO: Contexto = { hosteleria: true, diez: true, interruptores: new Set() }
const SIN_HOSTELERIA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }

describe('S01 · Ctrl K como paleta de órdenes (el catálogo de la cinta)', () => {
  it('encuentra una orden por su nombre y por sus sinónimos, con dónde vive', () => {
    const cobro = opciones('cobro', false, CON_TODO).find((r) => r.titulo === 'Tesorería')
    expect(cobro).toMatchObject({ apoyo: 'Contabilidad › Asientos', ruta: rutaConta('libros/diario/nuevo?tipo=tesoreria') })
    expect(opciones('plantilla', false, CON_TODO).map((r) => r.titulo)).toContain('Predefinidos')
    expect(opciones('predefinidos', false, CON_TODO).map((r) => r.titulo)).toContain('Predefinidos')
  })

  it('«mayor 43000012» abre el mayor de esa subcuenta, el primero', () => {
    expect(atajoMayor('Mayor 43000012')).toMatchObject({ titulo: 'Mayor de la 43000012', ruta: rutaMayor('43000012') })
    expect(atajoMayor('mayor de la 572')?.ruta).toBe(rutaMayor('572'))
    expect(atajoMayor('mayor')).toBeNull()
    expect(atajoMayor('mayor abc')).toBeNull()
    expect(opciones('mayor 43000012', false, CON_TODO)[0]).toMatchObject({ titulo: 'Mayor de la 43000012', ruta: rutaMayor('43000012') })
  })

  it('una orden que no sale en esta empresa tampoco sale en la paleta', () => {
    const soloHosteleria = ORDENES.filter((o) => 'ruta' in o.a && ordenDisponible(o, CON_TODO) && !ordenDisponible(o, SIN_HOSTELERIA))
    for (const o of soloHosteleria) {
      expect(opciones(o.etiqueta, false, SIN_HOSTELERIA).filter((r) => r.titulo === o.etiqueta && r.ruta === rutaConta('ruta' in o.a ? o.a.ruta : '')), o.id).toEqual([])
    }
  })

  it('cada dirección sale una vez', () => {
    for (const q of ['factura', 'banco', 'asiento', 'iva']) {
      const r = opciones(q, false, CON_TODO)
      expect(new Set(r.map((x) => x.ruta)).size, q).toBe(r.length)
    }
  })
})
