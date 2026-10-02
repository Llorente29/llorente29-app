// NIF-IVA europeo — C01 §5.3. Sólo la FORMA (la comprobación de verdad la
// hace VIES en el servidor). Origen de las formas: FAQ de VIES de la
// Comisión Europea, estructura del número de IVA por Estado miembro.
import { describe, it, expect } from 'vitest'
import { validarFormatoVatEu } from '@/modules/conta/lib/vatEu'

describe('formas válidas', () => {
  it.each([
    ['FR40303265045', 'FR'],      // 2 caracteres + 9 dígitos
    ['DE123456789', 'DE'],        // 9 dígitos
    ['PT123456789', 'PT'],        // 9 dígitos
    ['IT12345678901', 'IT'],      // 11 dígitos
    ['NL123456789B01', 'NL'],     // 9 dígitos + B + 2
    ['ATU12345678', 'AT'],        // U + 8
    ['ESB87123790', 'ES'],        // el NIF español con ES delante
  ])('%s', (v, pais) => {
    const r = validarFormatoVatEu(v)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.pais).toBe(pais)
  })
  it('Grecia se escribe EL; si llega GR se corrige', () => {
    const r = validarFormatoVatEu('GR123456789')
    expect(r.ok && r.normalizado).toBe('EL123456789')
  })
})

describe('formas inválidas', () => {
  it('país que no es de la UE', () => expect(validarFormatoVatEu('US123456789').ok).toBe(false))
  it('Alemania con 8 dígitos', () => expect(validarFormatoVatEu('DE12345678').ok).toBe(false))
  it('Austria sin la U', () => expect(validarFormatoVatEu('AT12345678').ok).toBe(false))
  it('vacío', () => expect(validarFormatoVatEu('').ok).toBe(false))
})
