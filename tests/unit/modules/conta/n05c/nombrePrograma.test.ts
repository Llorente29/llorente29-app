// N05c · El programa de antes, como en el N03: «ERP10», «Diez» o «el programa de antes»;
// el texto del corte deja de decir «erp10» en minúsculas.

import { describe, expect, it } from 'vitest'
import { nombrePrograma } from '@/modules/conta/services/corteService'

describe('N05c · el nombre del programa de antes', () => {
  it('erp10 y diez, como se escriben; da igual cómo vengan', () => {
    expect(nombrePrograma('erp10')).toBe('ERP10')
    expect(nombrePrograma(' ERP10 ')).toBe('ERP10')
    expect(nombrePrograma('diez')).toBe('Diez')
    expect(nombrePrograma('Diez')).toBe('Diez')
  })
  it('otro o ninguno: nulo, y la pantalla dice «el programa de antes»', () => {
    expect(nombrePrograma('otro')).toBeNull()
    expect(nombrePrograma('A3')).toBeNull()
    expect(nombrePrograma(null)).toBeNull()
  })
})
