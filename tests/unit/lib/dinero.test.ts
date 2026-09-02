import { describe, it, expect } from 'vitest'
import { eur, eurEntero } from '@/lib/dinero'

// Intl separa la cifra del € con un espacio INSEPARABLE (U+00A0), no con uno
// normal. Se normaliza aquí para que la prueba hable de lo que importa —la
// agrupación de miles— y no del carácter invisible que Intl elija.
const normal = (s: string) => s.replace(/\u00A0/g, ' ')

describe('el euro', () => {
  // El fallo real: `maximumFractionDigits: 0` desactiva la agrupación en es-ES
  // salvo que se pida `useGrouping` explícito. Daba «1614 €».
  it('separa los miles, que es por lo que existe este fichero', () => {
    expect(normal(eurEntero(1614))).toBe('1.614 €')
    expect(normal(eurEntero(3327))).toBe('3.327 €')
    expect(normal(eurEntero(12577))).toBe('12.577 €')
  })
  it('por debajo de mil, con céntimos; por encima, sin ellos', () => {
    expect(normal(eur(999.5))).toBe('999,50 €')
    expect(normal(eur(1614))).toBe('1.614 €')
  })
  it('el cero es un cero, no un hueco', () => {
    expect(normal(eurEntero(0))).toBe('0 €')
  })
  it('los negativos se separan igual', () => {
    expect(normal(eurEntero(-2663))).toBe('-2.663 €')
  })
})
