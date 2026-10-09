import { describe, expect, it } from 'vitest'
import { comoAcabo, lineaNoConfirmados, textoDiaEnCurso, diaCerrado, enLaZona, horaParaLeer, normalizarHora, OTRO_ESTADO, ultimoDiaCerrado } from '@/modules/conta/lib/cierreDelDia'

// Los instantes van en UTC (como `sold_at` y `created_at` en la base). La
// pared es Madrid: UTC+2 en verano, UTC+1 en invierno.
const t = (iso: string) => new Date(iso)

describe('qué días están cerrados a una hora dada', () => {
  it('el caso que lo destapó: el asiento del 09/10 propuesto a las 17:16 de Madrid', () => {
    // created_at del asiento b4eb11ca en producción: 2026-10-09 15:15:56 UTC.
    const propuesto = t('2026-10-09T15:15:56Z')
    expect(enLaZona(propuesto, 'Europe/Madrid')).toEqual({ dia: '2026-10-09', hora: '17:15' })
    expect(diaCerrado('2026-10-09', propuesto, '06:00')).toBe(false)
    // El del 08/10 que se propuso un segundo después sí estaba cerrado.
    expect(diaCerrado('2026-10-08', t('2026-10-09T15:15:57Z'), '06:00')).toBe(true)
  })

  it('ayer no está cerrado hasta las 6:00 de hoy', () => {
    expect(ultimoDiaCerrado(t('2026-10-09T03:59:00Z'), '06:00')).toBe('2026-10-07') // 5:59 de Madrid
    expect(ultimoDiaCerrado(t('2026-10-09T04:00:00Z'), '06:00')).toBe('2026-10-08') // 6:00 en punto
  })

  it('la hora es un ajuste de la empresa, no un número del código', () => {
    expect(ultimoDiaCerrado(t('2026-10-09T02:30:00Z'), '04:00')).toBe('2026-10-08') // 4:30 de Madrid con cierre a las 4:00
    expect(ultimoDiaCerrado(t('2026-10-09T02:30:00Z'), '05:00')).toBe('2026-10-07')
    expect(ultimoDiaCerrado(t('2026-10-09T03:00:00Z'), '05:00')).toBe('2026-10-08')
  })

  it('el cambio de hora de octubre (25/10, de UTC+2 a UTC+1) no mueve las 6:00', () => {
    // 24/10: aún verano, las 6:00 son las 4:00 UTC.
    expect(ultimoDiaCerrado(t('2026-10-24T03:59:00Z'), '06:00')).toBe('2026-10-22')
    expect(ultimoDiaCerrado(t('2026-10-24T04:00:00Z'), '06:00')).toBe('2026-10-23')
    // 25/10, el día del cambio (a las 3:00 vuelven a ser las 2:00): las 6:00 ya son las 5:00 UTC.
    expect(ultimoDiaCerrado(t('2026-10-25T04:30:00Z'), '06:00')).toBe('2026-10-23') // 5:30 de Madrid
    expect(ultimoDiaCerrado(t('2026-10-25T05:00:00Z'), '06:00')).toBe('2026-10-24')
    // 26/10, invierno.
    expect(ultimoDiaCerrado(t('2026-10-26T04:59:00Z'), '06:00')).toBe('2026-10-24')
    expect(ultimoDiaCerrado(t('2026-10-26T05:00:00Z'), '06:00')).toBe('2026-10-25')
  })

  it('el cambio de hora de marzo (29/03, de UTC+1 a UTC+2) tampoco', () => {
    expect(ultimoDiaCerrado(t('2026-03-28T04:59:00Z'), '06:00')).toBe('2026-03-26') // invierno: 5:59
    expect(ultimoDiaCerrado(t('2026-03-28T05:00:00Z'), '06:00')).toBe('2026-03-27')
    // 29/03: a las 2:00 pasan a ser las 3:00. Las 6:00 de ese día son las 4:00 UTC.
    expect(ultimoDiaCerrado(t('2026-03-29T03:59:00Z'), '06:00')).toBe('2026-03-27')
    expect(ultimoDiaCerrado(t('2026-03-29T04:00:00Z'), '06:00')).toBe('2026-03-28')
  })

  it('un día cerrado lo sigue estando; el de hoy nunca lo está', () => {
    const ahora = t('2026-10-09T15:00:00Z')
    expect(diaCerrado('2026-08-23', ahora, '06:00')).toBe(true)
    expect(diaCerrado('2026-10-09', ahora, '00:00')).toBe(false)
    expect(diaCerrado('2026-10-10', ahora, '06:00')).toBe(false)
  })

  it('la hora que viene de la base («06:00:00») y la que se enseña («6:00»)', () => {
    expect(normalizarHora('06:00:00')).toBe('06:00')
    expect(normalizarHora('6:30')).toBe('06:30')
    expect(normalizarHora(null)).toBe('06:00')
    expect(normalizarHora('25:00')).toBe('06:00')
    expect(horaParaLeer('06:00:00')).toBe('6:00')
    expect(horaParaLeer('05:30')).toBe('5:30')
  })
})

describe('cómo acabó un pedido no confirmado, en palabras', () => {
  // La población: TODAS las parejas (order_status, delivery_state) de Foodint
  // en producción el 09/10 (19), la de staging (in_preparation) y los estados
  // que maneja el código (ready, picked_up, on_the_way, awaiting_shipment…).
  const PRODUCCION: [string | null, string | null][] = [
    ['completed', null], ['completed', 'delivered'], [null, null], ['completed', 'canceled'], ['cancelled', null],
    ['awaiting_collection', null], ['delivery_failed', 'failed'], ['accepted', null], ['cancelled', 'delivered'],
    ['cancelled', 'failed'], ['cancelled', 'canceled'], ['completed', 'finish'], ['rejected', null], ['completed', 'in_delivery'],
    ['delivery_failed', 'canceled'], ['completed', 'matched'], ['completed', 'failed'], ['delivery_failed', null], ['accepted', 'matched'],
  ]
  const OTROS = ['in_preparation', 'ready', 'picked_up', 'on_the_way', 'awaiting_shipment', 'in_delivery', 'new', 'received']

  it('ninguno de la población real cae en la frase de reserva, y ninguno sale en inglés', () => {
    const frases = [...PRODUCCION.map(([o, d]) => comoAcabo(o, d)), ...OTROS.map((o) => comoAcabo(o, null))]
    expect(frases.filter((f) => f === OTRO_ESTADO)).toEqual([])
    expect(frases.filter((f) => /_|\b(delivery|cancell?ed|awaiting|failed|rejected|completed|accepted|received|ready)\b/i.test(f))).toEqual([])
  })

  it('los 20 del atraso de producción: las tres frases del encargo', () => {
    expect(comoAcabo('awaiting_collection', null)).toBe('Esperando recogida')
    expect(comoAcabo('delivery_failed', 'failed')).toBe('Entrega fallida')
    expect(comoAcabo('cancelled', 'delivered')).toBe('Cancelado')
    expect(comoAcabo('rejected', null)).toBe('Rechazado')
  })

  it('un estado que no existe hoy sí cae en la reserva (y la prueba lo distingue)', () => {
    expect(comoAcabo('teleported', null)).toBe(OTRO_ESTADO)
  })
})

describe('las frases de la pantalla', () => {
  it('la línea bajo las cifras del asiento (los tres del 02/10 de Alcalá)', () => {
    expect(lineaNoConfirmados(3, 71.7)).toBe('3 pedidos no confirmados · 71,70 € · no están en estas ventas')
    expect(lineaNoConfirmados(1, 20.4)).toBe('1 pedido no confirmado · 20,40 € · no está en estas ventas')
  })
  it('el día en curso, con la hora de la empresa', () => {
    expect(textoDiaEnCurso('06:00:00')).toBe('Hoy se cierra mañana a las 6:00. Sus ventas se proponen entonces.')
    expect(textoDiaEnCurso('05:30')).toBe('Hoy se cierra mañana a las 5:30. Sus ventas se proponen entonces.')
  })
})
