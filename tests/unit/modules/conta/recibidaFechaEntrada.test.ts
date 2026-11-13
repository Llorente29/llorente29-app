// tests/unit/modules/conta/recibidaFechaEntrada.test.ts
//
// V04 · Respuesta 6, punto 2 · Una recibida nunca se asienta antes del día en
// que entró (regla de Julio, 27/10). Contra la población real (regla 31): las
// recibidas de Foodint tal como están en producción (solo lectura, 27/10). De
// las 95 validadas, 90 tienen el asiento en la fecha de la factura y antes del
// día en que entraron, y su libro de IVA las registra el día que entraron. Con
// la regla, el asiento cae ese mismo día: el del libro.

import { describe, expect, it } from 'vitest'
import { diaDeEntrada, fechaDeLaRecibida } from '@/modules/conta/lib/libro'

// invoice_date, created_at, entry_date y la received_date de su libro, de producción.
const FOODINT = [
  { factura: '2026-10-05', creada: '2026-10-19 10:31:06.755899+00', asiento: '2026-10-05', libro: '2026-10-19' },
  { factura: '2026-10-06', creada: '2026-10-11 10:02:46.565591+00', asiento: '2026-10-06', libro: '2026-10-11' },
  { factura: '2026-10-07', creada: '2026-10-11 10:02:46.565591+00', asiento: '2026-10-07', libro: '2026-10-11' },
  // Las que entraron el día de su fecha.
  { factura: '2026-10-13', creada: '2026-10-13 12:40:05.499628+00', asiento: '2026-10-13', libro: '2026-10-13' },
  { factura: '2026-10-23', creada: '2026-10-23 11:37:32.963765+00', asiento: '2026-10-23', libro: '2026-10-23' },
]

describe('la recibida, no antes del día en que entró', () => {
  it('con la regla, el asiento cae el día que su libro la registra', () => {
    for (const f of FOODINT) {
      const r = fechaDeLaRecibida(f.factura, diaDeEntrada(f.creada.replace(' ', 'T').replace(/\+00$/, 'Z')))
      expect(r.fecha, `${f.factura} creada ${f.creada}`).toBe(f.libro)
    }
  })

  it('el aviso: «Esta factura entró el 19/10: se contabiliza el 19/10.»; la del día, sin aviso', () => {
    expect(fechaDeLaRecibida('2026-10-05', '2026-10-19')).toEqual({ fecha: '2026-10-19', aviso: 'Esta factura entró el 19/10: se contabiliza el 19/10.' })
    expect(fechaDeLaRecibida('2026-10-13', '2026-10-13')).toEqual({ fecha: '2026-10-13', aviso: null })
    // Sin el día de entrada (una propuesta sin factura leída), como antes.
    expect(fechaDeLaRecibida('2026-10-13', null)).toEqual({ fecha: '2026-10-13', aviso: null })
  })

  it('el día de entrada es el de Madrid: las 23:30 UTC del 30/09 ya son el 01/10', () => {
    expect(diaDeEntrada('2026-09-30T23:30:00Z')).toBe('2026-10-01')
    expect(diaDeEntrada('2026-09-30T21:30:00Z')).toBe('2026-09-30')
    // En invierno (desde el 25/10), una hora: las 23:30 UTC del 27/10 son el 28/10.
    expect(diaDeEntrada('2026-10-27T23:30:00Z')).toBe('2026-10-28')
    expect(diaDeEntrada(null)).toBeNull()
    expect(diaDeEntrada('no es una fecha')).toBeNull()
  })

  it('F-2026-0915 (staging, antes de arreglar su semilla): factura del 24/09 creada a las 22:40 UTC del 01/10 (00:40 del 02/10 en Madrid) → el 02/10, en el 4T, como su IVA', () => {
    expect(fechaDeLaRecibida('2026-09-24', diaDeEntrada('2026-10-01T22:40:56Z')).fecha).toBe('2026-10-02')
    expect(fechaDeLaRecibida('2026-09-24', '2026-10-01')).toEqual({ fecha: '2026-10-01', aviso: 'Esta factura entró el 01/10: se contabiliza el 01/10.' })
  })
})
