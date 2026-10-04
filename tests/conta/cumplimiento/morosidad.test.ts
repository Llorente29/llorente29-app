// tests/conta/cumplimiento/morosidad.test.ts
//
// Ley 3/2004, de lucha contra la morosidad en las operaciones comerciales,
// art. 4.3 (BOE-A-2004-21794, texto vigente descargado en
// docs/conta/fuentes/textos/ley-3-2004.txt): «Los plazos de pago indicados en
// los apartados anteriores podrán ser ampliados mediante pacto de las partes
// sin que, en ningún caso, se pueda acordar un plazo superior a 60 días
// naturales.»
//
// Respuesta 2 de Julio (C00): más de 60 días se deja guardar, pero se avisa,
// en Tablas generales y en la ficha de proveedor.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AVISO_PLAZO_MOROSIDAD, PLAZO_MAXIMO_ENTRE_EMPRESAS, avisoPlazo } from '@/modules/conta/lib/morosidad'
import { TABLAS_GENERALES } from '@/modules/conta/tablas/registro'

const LEY = readFileSync(resolve(__dirname, '../../../docs/conta/fuentes/textos/ley-3-2004.txt'), 'utf8')

describe('Ley 3/2004, art. 4.3 · plazo máximo de pago entre empresas', () => {
  it('el tope de 60 días sigue en el texto vigente descargado', () => {
    expect(LEY).toContain('sin que, en ningún caso, se pueda acordar un plazo superior a 60 días naturales')
    expect(PLAZO_MAXIMO_ENTRE_EMPRESAS).toBe(60)
  })

  it('60 días, sin aviso; 61, con aviso; con varios vencimientos, manda el último', () => {
    expect(avisoPlazo([0])).toBeNull()
    expect(avisoPlazo([30, 60])).toBeNull()
    expect(avisoPlazo([61])).toBe(AVISO_PLAZO_MOROSIDAD)
    expect(avisoPlazo([30, 60, 90])).toBe('Supera los 60 días que permite la ley de morosidad entre empresas')
  })

  it('en Tablas generales, un plazo propio de 90 días avisa pero se puede guardar', () => {
    const plazos = TABLAS_GENERALES.find((t) => t.id === 'plazos-de-pago')!
    const v = { name: 'Noventa días', days: '30, 60, 90', fixed_days: '' }
    expect(plazos.validar(v)).toEqual({})
    expect(plazos.avisos?.(v)).toEqual({ days: AVISO_PLAZO_MOROSIDAD })
    expect(plazos.avisos?.({ ...v, days: '30, 60' })).toEqual({})
  })

  it('ningún plazo de serie pasa de 60 días', () => {
    const serie = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/conta/referencia/serie.json'), 'utf8'))
    for (const p of serie.tablas.payment_term.filas as { code: string; days: number[] }[]) expect(avisoPlazo(p.days), p.code).toBeNull()
  })
})
