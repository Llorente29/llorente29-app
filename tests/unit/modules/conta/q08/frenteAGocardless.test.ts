// tests/unit/modules/conta/q08/frenteAGocardless.test.ts
//
// Q08 · Paso 3 · «Revisar el cobro» frente a GoCardless: cada tipo de
// diferencia, con su motivo en palabras de la calle, y el Excel con lo mismo.
// Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { CABECERA_EXCEL, filasExcel, frenteAGocardless, motivoEnPalabras } from '@/modules/conta/gestoria/g05/frenteAGocardless'

const MES = '2026-12'
const susc = (gcClienteId: string, importe: number, fecha = '2026-12-04', nombre = 'GESTORIA MENSUAL', estado = 'active') => ({ gcClienteId, nombre, importe, fecha, estado })
const CLIENTES = [
  { gcId: 'CU-IGUAL', nombre: 'Cliente Igual SL', partyId: 'p-igual' },
  { gcId: 'CU-DISTINTO', nombre: 'Cliente Distinto SL', partyId: 'p-distinto' },
  { gcId: 'CU-NUEVO', nombre: 'Cliente Nuevo SL', partyId: null },
  { gcId: 'CU-SUELTO', nombre: 'Cliente Sin Ficha SL', partyId: null },
]
// El nuevo se ató por el Excel de QBO (enlace de una persona); el suelto no tiene ficha.
const ENLACES = [{ gcClienteId: 'CU-NUEVO', partyId: 'p-nuevo', estado: 'atado' }, { gcClienteId: 'CU-SUELTO', partyId: null, estado: 'propuesto' }]
const RECIBOS = [
  { partyId: 'p-igual', cliente: 'Cliente Igual SL', totalCent: 12100 },
  { partyId: 'p-distinto', cliente: 'Cliente Distinto SL', totalCent: 15000 },
  { partyId: 'p-baja', cliente: 'Cliente De Baja SL', totalCent: 9000 },
  { partyId: 'p-fuera', cliente: 'Cliente Este Mes No SL', totalCent: 5000, decision: 'este_mes_no' },
]
const SUSC = [
  susc('CU-IGUAL', 121), susc('CU-DISTINTO', 121), susc('CU-DISTINTO', 40, '2026-12-07', 'Vigilancia de notificaciones'),
  susc('CU-NUEVO', 106), susc('CU-SUELTO', 60.5),
  susc('CU-IGUAL', 99, '2027-01-04'), // de enero: no entra
  susc('CU-IGUAL', 99, '2026-12-04', 'Pausada', 'paused'), // pausada: no entra
]

describe('Q08 · frente a GoCardless: cada diferencia con su motivo', () => {
  const f = frenteAGocardless(MES, RECIBOS, SUSC, CLIENTES, ENLACES)
  const de = (cliente: string) => f.filas.find((x) => x.cliente === cliente)!
  it('igual: el mismo importe los dos', () => {
    expect(de('Cliente Igual SL')).toMatchObject({ sumiedCent: 12100, gcCent: 12100, motivo: null, fechas: ['04/12'] })
  })
  it('importe distinto: suma todas sus suscripciones del mes, con sus días de cargo', () => {
    expect(de('Cliente Distinto SL')).toMatchObject({ sumiedCent: 15000, gcCent: 16100, motivo: 'importe_distinto', fechas: ['04/12', '07/12'] })
  })
  it('nueva en diciembre: GoCardless la cobra y Sumied no tiene recibo (atado por el enlace de una persona)', () => {
    expect(de('Cliente Nuevo SL')).toMatchObject({ partyId: 'p-nuevo', sumiedCent: 0, gcCent: 10600, motivo: 'nueva' })
  })
  it('no se cobra en diciembre: Sumied tiene recibo y GoCardless no cobra; «este mes no» no cuenta', () => {
    expect(de('Cliente De Baja SL')).toMatchObject({ sumiedCent: 9000, gcCent: 0, motivo: 'no_se_cobra' })
    expect(f.filas.find((x) => x.cliente === 'Cliente Este Mes No SL')).toBeUndefined()
  })
  it('sin atar a su ficha: lo que cobra GoCardless a un cliente sin ficha', () => {
    expect(de('Cliente Sin Ficha SL')).toMatchObject({ partyId: null, gcCent: 6050, motivo: 'sin_atar' })
  })
  it('las diferencias arriba (sin atar, nuevas, no se cobran, importe distinto), las iguales debajo; los totales', () => {
    expect(f.diferencias.map((x) => x.motivo)).toEqual(['sin_atar', 'nueva', 'no_se_cobra', 'importe_distinto'])
    expect(f.iguales.map((x) => x.cliente)).toEqual(['Cliente Igual SL'])
    expect(f.cuantas).toEqual({ sin_atar: 1, nueva: 1, no_se_cobra: 1, importe_distinto: 1 })
    expect([f.totalSumiedCent, f.totalGcCent]).toEqual([12100 + 15000 + 9000, 12100 + 16100 + 10600 + 6050])
  })
  it('el motivo, en palabras de la calle', () => {
    expect(['nueva', 'no_se_cobra', 'importe_distinto', 'sin_atar'].map((m) => motivoEnPalabras(m as 'nueva', MES)))
      .toEqual(['Nueva en diciembre', 'No se cobra en diciembre', 'Importe distinto', 'Sin atar a su ficha'])
  })
  it('el Excel, con lo mismo que la pantalla', () => {
    const x = filasExcel(f)
    expect(x).toHaveLength(f.filas.length)
    expect(x[3]).toEqual(['Cliente Distinto SL', 'Importe distinto', 150, 161, 11, '04/12, 07/12', 'GESTORIA MENSUAL | Vigilancia de notificaciones'])
    expect(CABECERA_EXCEL).toHaveLength(x[0].length)
  })
})
