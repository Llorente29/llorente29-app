// PC01 · Cuándo paga una plataforma: la misma cuenta que la base
// (conta_vence_por_plataforma). Los casos son los de la prueba de staging
// (supabase/staging/sql/20261025_pc01_motor_prueba.sql, paso 1) y los plazos
// que dio Julio el 25/10 para Uber, Just Eat y Glovo.
import { describe, expect, it } from 'vitest'
import { ejemploDePlazo, pagoYVencimiento, periodoDe, textoGuardado } from '@/modules/conta/lib/plazoPlataforma'

describe('el periodo', () => {
  it('la semana va de lunes a domingo', () => {
    expect(periodoDe('weekly', '2026-10-07')).toEqual({ desde: '2026-10-05', hasta: '2026-10-11' })
    expect(periodoDe('weekly', '2026-10-11')).toEqual({ desde: '2026-10-05', hasta: '2026-10-11' })
    expect(periodoDe('weekly', '2026-10-12')).toEqual({ desde: '2026-10-12', hasta: '2026-10-18' })
  })
  it('la quincena, del 1 al 15 y del 16 a fin de mes (también en febrero)', () => {
    expect(periodoDe('fortnightly', '2026-10-15')).toEqual({ desde: '2026-10-01', hasta: '2026-10-15' })
    expect(periodoDe('fortnightly', '2026-10-16')).toEqual({ desde: '2026-10-16', hasta: '2026-10-31' })
    expect(periodoDe('fortnightly', '2026-02-20')).toEqual({ desde: '2026-02-16', hasta: '2026-02-28' })
  })
})

describe('el vencimiento, como la base', () => {
  it('los casos de la prueba de staging', () => {
    expect(pagoYVencimiento('weekly', 1, null, '2026-10-07').vence).toBe('2026-10-17')
    expect(pagoYVencimiento('fortnightly', 4, 2, '2026-10-10').vence).toBe('2026-10-21')
    expect(pagoYVencimiento('fortnightly', 4, 2, '2026-10-20').vence).toBe('2026-11-06')
    expect(pagoYVencimiento('monthly', 10, null, '2026-02-03').vence).toBe('2026-03-15')
    expect(pagoYVencimiento('weekly', 2, 0, '2026-10-05').vence).toBe('2026-10-13')
  })
  it('los plazos de Julio: Uber paga el lunes; Just Eat hacia el 19 y el 4; Glovo hacia el 4 y el 20 del mes siguiente', () => {
    expect(pagoYVencimiento('weekly', 1, null, '2026-10-14').pago).toBe('2026-10-19')
    expect(pagoYVencimiento('fortnightly', 4, null, '2026-10-03').pago).toBe('2026-10-19')
    expect(pagoYVencimiento('fortnightly', 4, null, '2026-10-20').pago).toBe('2026-11-04')
    expect(pagoYVencimiento('fortnightly', 20, null, '2026-10-03').pago).toBe('2026-11-04')
    expect(pagoYVencimiento('fortnightly', 20, null, '2026-10-20').pago).toBe('2026-11-20')
  })
})

describe('lo que dice la ficha', () => {
  it('con fechas de verdad', () => {
    expect(ejemploDePlazo('weekly', 1, null, '2026-10-14')).toBe('La semana del 12/10 al 18/10 la paga hacia el lunes 19/10; si el 24/10 no ha llegado, sus facturas salen «Falta su liquidación». Margen: 5 días.')
    expect(ejemploDePlazo('fortnightly', 4, null, '2026-10-03')).toContain('La quincena del 16/10 al 31/10 la paga hacia el miércoles 04/11')
  })
  it('al guardar, con contenido', () => {
    expect(textoGuardado('Uber', 'weekly', 1, null, 37)).toBe('Guardado: Uber paga cada semana, hacia 1 día después de cerrarlo, con 5 de margen. 37 facturas por cobrar cambian de vencimiento.')
    expect(textoGuardado('Glovo', 'fortnightly', 20, 3, 1)).toBe('Guardado: Glovo paga cada quincena, hacia 20 días después de cerrarlo, con 3 de margen. 1 factura por cobrar cambia de vencimiento.')
    expect(textoGuardado('X', null, null, null, 0)).toContain('Ninguna factura por cobrar cambia de vencimiento.')
  })
})
