// «Liquidaciones CTB»: lo que se prueba es la ARITMÉTICA DEL RETRASO, que es la
// consecuencia de la tarjeta. El importe lo trae la tabla; el retraso lo
// calculamos nosotros, y equivocarlo por uno diría que CTB debe un mes más o
// uno menos de los que debe.

import { describe, it, expect } from 'vitest'
import { mesesSinLiquidar, nombreDePeriodo } from '@/modules/ventas/home/liquidacionesCtb'

describe('mesesSinLiquidar', () => {
  // El caso real del 02/09/2026: la última liquidación cubre junio. Faltan
  // julio y agosto. Septiembre NO cuenta: todavía no ha terminado.
  it('junio liquidado y estamos en septiembre → faltan dos', () => {
    expect(mesesSinLiquidar('2026-06-30', new Date(2026, 8, 2))).toBe(2)
  })

  it('junio liquidado y estamos en julio → no falta ninguno todavía', () => {
    expect(mesesSinLiquidar('2026-06-30', new Date(2026, 6, 20))).toBe(0)
  })

  it('junio liquidado y estamos en agosto → falta uno, julio', () => {
    expect(mesesSinLiquidar('2026-06-30', new Date(2026, 7, 1))).toBe(1)
  })

  it('cruza el año sin descontarse', () => {
    expect(mesesSinLiquidar('2025-11-30', new Date(2026, 1, 15))).toBe(2)
  })

  // Una liquidación adelantada no genera un retraso negativo con un signo raro
  // en pantalla.
  it('nunca es negativo', () => {
    expect(mesesSinLiquidar('2026-09-30', new Date(2026, 8, 2))).toBe(0)
  })
})

describe('nombreDePeriodo', () => {
  it('un mes natural se llama por su nombre', () => {
    expect(nombreDePeriodo('2026-06-01', '2026-06-30')).toBe('junio de 2026')
  })

  it('febrero de un año normal también es un mes natural', () => {
    expect(nombreDePeriodo('2026-02-01', '2026-02-28')).toBe('febrero de 2026')
  })

  it('un periodo que NO es un mes se enseña con sus dos fechas, sin redondear', () => {
    expect(nombreDePeriodo('2026-06-01', '2026-06-15')).toBe('2026-06-01 – 2026-06-15')
    expect(nombreDePeriodo('2026-05-15', '2026-06-14')).toBe('2026-05-15 – 2026-06-14')
  })
})
