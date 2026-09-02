// La ventana de «Food cost medio». Se prueba porque de ella depende que haya
// delta: si la ventana incluyera hoy, el periodo estaría EN CURSO y la regla 2
// del espejo obligaría a no comparar. Un fallo aquí no rompe nada visible — se
// lleva el delta por delante en silencio, que es peor.

import { describe, it, expect } from 'vitest'
import { ventanaCerrada, VENTANA_DIAS } from '@/modules/ventas/home/foodCostMedio'

describe('ventanaCerrada', () => {
  // Miércoles 2 de septiembre de 2026, a las nueve y media de la noche de
  // Madrid: bien dentro del servicio, para que se note si la ventana arrastra
  // la hora en vez de cortar a medianoche.
  const AHORA = new Date('2026-09-02T19:30:00Z')

  it('termina a medianoche de hoy: el día en curso queda FUERA', () => {
    const { hasta } = ventanaCerrada(AHORA, VENTANA_DIAS)
    expect(hasta.toISOString()).toBe('2026-09-01T22:00:00.000Z')   // 02/09 00:00 en Madrid
  })

  it('cubre exactamente 30 días', () => {
    const { desde, hasta } = ventanaCerrada(AHORA, 30)
    const dias = (hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000)
    expect(dias).toBe(30)
  })

  // El corte es la medianoche DE MADRID, no la de UTC. A las 00:30 del 3 de
  // septiembre en Madrid todavía son las 22:30 del 2 en UTC: cortar por UTC
  // dejaría el día 2 entero fuera de una ventana que dice terminar el 2.
  it('el corte es la medianoche de Madrid, no la de UTC', () => {
    const madrugadaDelTres = new Date('2026-09-02T22:30:00Z')
    expect(ventanaCerrada(madrugadaDelTres, 30).hasta.toISOString())
      .toBe('2026-09-02T22:00:00.000Z')   // 03/09 00:00 en Madrid
  })

  // La ventana no puede depender del huso de la máquina que la calcula: el
  // servidor de Vercel está en UTC y el negocio, en Madrid.
  it('en enero, con Madrid en UTC+1, sigue cortando a medianoche de Madrid', () => {
    const invierno = new Date('2026-01-15T12:00:00Z')
    expect(ventanaCerrada(invierno, 30).hasta.toISOString())
      .toBe('2026-01-14T23:00:00.000Z')   // 15/01 00:00 en Madrid
  })
})
