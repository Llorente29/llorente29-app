import { describe, expect, it } from 'vitest'
import { baseDeDatos, textoDeLosDatos } from '@/services/versionApp'

// La franja de «NO ES PRODUCCIÓN» tiene que decir la verdad sobre los datos
// (02/10): una preview contra staging-conta NO enseña datos reales.
describe('qué base de datos hay detrás del build', () => {
  it('producción: los datos son reales', () => {
    const b = baseDeDatos('https://xzmpnchlguibclvxyynt.supabase.co')
    expect(b).toEqual({ tipo: 'produccion' })
    expect(textoDeLosDatos(b)).toBe('los datos que ves SÍ son reales')
  })
  it('staging-conta: datos inventados', () => {
    const b = baseDeDatos('https://oseymswjlzplqoxrfjzi.supabase.co')
    expect(b).toEqual({ tipo: 'pruebas', nombre: 'staging-conta' })
    expect(textoDeLosDatos(b)).toBe('base de pruebas staging-conta: los datos son inventados')
  })
  it('otra base: se dice cuál, sin presumir', () => {
    expect(textoDeLosDatos(baseDeDatos('http://127.0.0.1:54321'))).toBe('base de datos: 127.0.0.1')
    expect(textoDeLosDatos(baseDeDatos(undefined))).toBe('sin base de datos configurada')
    expect(baseDeDatos('no es una url')).toEqual({ tipo: 'desconocida', host: null })
  })
})
