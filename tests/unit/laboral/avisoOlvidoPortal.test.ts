// tests/unit/laboral/avisoOlvidoPortal.test.ts
//
// L1a · PR 3: la tarjeta del olvido en el portal (avisoOlvidoTexto) y el
// contador de Equipo (contarAvisos). En hora de Madrid, también el día del
// cambio de hora (25/10/2026, a las 03:00 vuelven a ser las 02:00).
import { describe, expect, it } from 'vitest'
import { cuandoFueElOlvido, salidaDesdeHora } from '@/modules/personal/laboral/avisoOlvidoTexto'
import { contarAvisos } from '@/modules/personal/laboral/avisosOlvidoServicio'

describe('cuándo fue el olvido', () => {
  const ahora = new Date('2026-10-22T08:30:00Z') // jueves 22/10, 10:30 en Madrid
  it('hoy, ayer o el día', () => {
    expect(cuandoFueElOlvido('2026-10-22T06:00:00Z', ahora)).toBe('Hoy')
    expect(cuandoFueElOlvido('2026-10-21T07:58:00Z', ahora)).toBe('Ayer')
    // 23:30 del 20/10 en Madrid es 21:30 UTC del 20/10: «El 20/10», no «Ayer».
    expect(cuandoFueElOlvido('2026-10-20T21:30:00Z', ahora)).toBe('El 20/10')
  })
})

describe('la salida que escribe la persona', () => {
  it('el mismo día de la entrada, en hora de Madrid (verano: +2)', () => {
    // Entrada 21/10 09:58 Madrid = 07:58 UTC; sale a las 17:15 Madrid = 15:15 UTC.
    expect(salidaDesdeHora('2026-10-21T07:58:00Z', '17:15')).toBe('2026-10-21T15:15:00.000Z')
  })
  it('una hora antes que la entrada es del día siguiente (turno de noche)', () => {
    // Entrada 21/10 19:58 Madrid; sale a las 00:20 del 22/10 Madrid = 22:20 UTC del 21/10.
    expect(salidaDesdeHora('2026-10-21T17:58:00Z', '00:20')).toBe('2026-10-21T22:20:00.000Z')
  })
  it('después del cambio de hora (invierno: +1)', () => {
    // Entrada 26/10 09:00 Madrid = 08:00 UTC; sale a las 17:00 = 16:00 UTC.
    expect(salidaDesdeHora('2026-10-26T08:00:00Z', '17:00')).toBe('2026-10-26T16:00:00.000Z')
  })
  it('la noche del cambio: entra el sábado 24 a las 20:00 (+2), sale el domingo a las 04:00 (+1)', () => {
    expect(salidaDesdeHora('2026-10-24T18:00:00Z', '04:00')).toBe('2026-10-25T03:00:00.000Z')
  })
  it('lo que no es una hora, no', () => {
    expect(salidaDesdeHora('2026-10-21T07:58:00Z', '')).toBeNull()
    expect(salidaDesdeHora('2026-10-21T07:58:00Z', '25:00')).toBeNull()
    expect(salidaDesdeHora('2026-10-21T07:58:00Z', 'tarde')).toBeNull()
  })
})

describe('el contador de la semana', () => {
  it('cuenta todos, cada uno en su sitio', () => {
    const c = contarAvisos([
      { status: 'sent', skip_reason: null, canal: 'whatsapp', respondida_at: '2026-10-21T16:00:00Z' },
      { status: 'sent', skip_reason: null, canal: 'whatsapp', respondida_at: null },
      { status: 'failed', skip_reason: null, canal: 'whatsapp', respondida_at: null },
      { status: 'skipped', skip_reason: 'sin_telefono', canal: 'portal', respondida_at: null },
      { status: 'skipped', skip_reason: 'fuera_de_hora', canal: 'portal', respondida_at: '2026-10-22T08:00:00Z' },
      { status: 'skipped', skip_reason: 'no_quiere_whatsapp', canal: 'portal', respondida_at: null },
      { status: 'skipped', skip_reason: 'ya_fichada', canal: 'whatsapp', respondida_at: null },
      { status: 'queued', skip_reason: null, canal: 'whatsapp', respondida_at: null },
    ])
    expect(c).toEqual({ enviados: 2, fallidos: 1, sinTelefono: 1, soloPortal: 2, respondidos: 2, total: 8 })
  })
})
