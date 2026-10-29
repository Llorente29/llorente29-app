// L1a-H (29/10/2026). La firma del registro, solo cuando la empresa la
// encienda: las frases del interruptor (regla 8: dice qué ha hecho, con
// contenido) y el mes que se pide firmar.
import { describe, it, expect } from 'vitest'
import { APOYO_INTERRUPTOR, TITULO_INTERRUPTOR, fraseDelCambio, mesAnterior, nombreDelMes } from '../../../src/modules/personal/laboral/firmaDelMes'

describe('L1a-H · la firma del mes, solo si la empresa la enciende', () => {
  it('el interruptor dice lo que pidió Julio, en palabras de oficina', () => {
    expect(TITULO_INTERRUPTOR).toBe('Pedir a cada persona que firme su registro del mes')
    expect(APOYO_INTERRUPTOR).toBe('Cada mes, cada persona revisa y firma sus horas en su portal. Enciéndelo cuando las horas estén al día.')
  })

  it('el mes que se firma es el anterior, también en enero', () => {
    expect(mesAnterior('2026-10-29')).toBe('2026-09')
    expect(mesAnterior('2027-01-03')).toBe('2026-12')
    expect(nombreDelMes('2026-09')).toBe('septiembre')
  })

  it('al encender dice a cuántas personas y qué verán', () => {
    expect(fraseDelCambio(true, 23, '2026-10-29'))
      .toBe('Encendido: desde ahora, las 23 personas activas de la plantilla ven en su portal «Firma tu registro de septiembre».')
    expect(fraseDelCambio(true, 1, '2026-10-29'))
      .toBe('Encendido: desde ahora, la persona activa de la plantilla ve en su portal «Firma tu registro de septiembre».')
    expect(fraseDelCambio(true, 0, '2026-10-29')).toMatch(/^Encendido, pero no hay ninguna persona activa/)
  })

  it('al apagar dice que nadie lo ve y que lo firmado se conserva', () => {
    expect(fraseDelCambio(false, 23, '2026-10-29'))
      .toBe('Apagado: nadie ve ya en su portal la firma del registro. Las firmas que ya se hicieron se conservan.')
  })
})
