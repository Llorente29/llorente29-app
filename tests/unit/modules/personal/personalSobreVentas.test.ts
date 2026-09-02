import { describe, it, expect } from 'vitest'
import { costePorHora } from '@/modules/personal/home/personalSobreVentas'

describe('costePorHora · coste de EMPRESA, no bruto', () => {
  // Salario real de convenio de Foodint: 22.589,76 € al año, 40 h/semana.
  it('suma la seguridad social al salario, y los dos son ANUALES', () => {
    const c = costePorHora(22589.76, 7000, 40)!
    expect(c).toBeCloseTo((22589.76 + 7000) / (40 * 52), 4)
    // Y con el bruto solo saldría MÁS BARATO, que es la dirección que engaña.
    expect(c).toBeGreaterThan(costePorHora(22589.76, 0, 40)!)
  })

  // La decisión de Julio: «el bruto es engañar en silencio». Sin seguridad
  // social no hay coste de empresa, así que no hay número.
  it('sin seguridad social devuelve null, NO el bruto', () => {
    expect(costePorHora(22589.76, null, 40)).toBeNull()
  })

  // Keilymar tiene salary = 0 en la base. Cero no es un salario, es un hueco.
  it('un salario a cero es un hueco, no un coste de cero', () => {
    expect(costePorHora(0, 7000, 40)).toBeNull()
  })

  it('sin horas de contrato no se puede repartir el coste', () => {
    expect(costePorHora(22589.76, 7000, 0)).toBeNull()
    expect(costePorHora(22589.76, 7000, null)).toBeNull()
  })

  // Media jornada cuesta el doble por hora que la jornada completa con el mismo
  // salario anual: el reparto entre horas de contrato es lo que lo hace justo.
  it('reparte entre las horas de contrato', () => {
    expect(costePorHora(20000, 6000, 20)!).toBeCloseTo(costePorHora(20000, 6000, 40)! * 2, 6)
  })
})
