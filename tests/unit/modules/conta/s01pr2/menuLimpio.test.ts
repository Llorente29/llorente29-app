// tests/unit/modules/conta/s01pr2/menuLimpio.test.ts
//
// S01 · PR 2 · El menú limpio: nada en el menú sin pantalla.
//   · Ninguna pestaña de un apartado que se pinta lleva `ruta: null` (Tickets y
//     Series salieron; vuelven con el S07 y el S05). Laboral, de L, no se pinta:
//     sus pestañas no cuentan.
//   · La prueba caza una pestaña sin pantalla (una lista inventada con una).
//   · Lo que se ve, con y sin hostelería, es el menú del encargo.
//   · La barra «Pregunta o pide algo» y la voz, apagadas (BARRA_PREGUNTAR) hasta el S09.

import { describe, expect, it } from 'vitest'
import { BARRA_PREGUNTAR } from '@/modules/conta/marco/muyPronto'
import { PRODUCTOS, pestanasSinPantalla, pestanasVisibles, type Contexto, type Producto } from '@/modules/conta/esqueleto/productos'

const SIN: Contexto = { hosteleria: false, diez: false, interruptores: new Set(['conta_facturacion']) }
const CON: Contexto = { hosteleria: true, diez: false, interruptores: new Set(['conta_facturacion']) }
const de = (id: string) => PRODUCTOS.find((p) => p.id === id)!

describe('el menú limpio', () => {
  it('ninguna pestaña de un apartado que se pinta está sin pantalla', () => {
    expect(pestanasSinPantalla()).toEqual([])
  })

  it('y si alguien vuelve a poner una, la prueba lo dice con su nombre', () => {
    const conUna: Producto[] = [{ ...de('compras'), pestanas: [...de('compras').pestanas, { id: 'tickets', etiqueta: 'Tickets', icono: 'documento', ruta: null, prefijos: [] }] }]
    expect(pestanasSinPantalla(conUna)).toEqual(['Compras y gastos › Tickets'])
  })

  it('Laboral (de L) no se pinta, y sus pestañas sin pantalla no cuentan', () => {
    expect(de('laboral').ruta).toBeNull()
    expect(de('laboral').pestanas.every((t) => t.ruta === null)).toBe(true)
  })

  it('Compras › Facturas recibidas · Pagos · Repartidores (solo hostelería); Ventas › Facturas · Cobros · Liquidaciones · Cierres del día (solo hostelería)', () => {
    expect(pestanasVisibles(de('compras'), CON).map((t) => t.etiqueta)).toEqual(['Facturas recibidas', 'Pagos', 'Repartidores'])
    expect(pestanasVisibles(de('compras'), SIN).map((t) => t.etiqueta)).toEqual(['Facturas recibidas', 'Pagos'])
    expect(pestanasVisibles(de('facturacion'), CON).map((t) => t.etiqueta)).toEqual(['Facturas', 'Cobros', 'Liquidaciones', 'Cierres del día'])
    expect(pestanasVisibles(de('facturacion'), SIN).map((t) => t.etiqueta)).toEqual(['Facturas', 'Cobros', 'Liquidaciones'])
  })

  it('la barra «Pregunta o pide algo» y la voz, apagadas hasta el S09 (solo dirían «Muy pronto»)', () => {
    expect(BARRA_PREGUNTAR).toBe(false)
  })
})
