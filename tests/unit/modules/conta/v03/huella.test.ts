// tests/unit/modules/conta/v03/huella.test.ts
//
// V03 · E1 · La huella y el QR contra los EJEMPLOS OFICIALES de la AEAT, no
// contra ejemplos inventados (regla 31):
//   · huella: «Detalle de las especificaciones técnicas para generación de la
//     huella o hash», v0.1.2, §6 (casos 1, 2 y 3);
//   · QR: «Detalle de las especificaciones técnicas del código QR», v0.5.0, §4.

import { describe, expect, it } from 'vitest'
import {
  cadenaAlta, cadenaAnulacion, esHuella, fechaAeat, fechaHoraHusoMadrid, huellaAlta, huellaAnulacion, importeAeat,
} from '@/modules/conta/lib/verifactu/huella'
import { QrNoValido, urlQr } from '@/modules/conta/lib/verifactu/qr'

const CASO1 = {
  idEmisorFactura: '89890001K', numSerieFactura: '12345678/G33', fechaExpedicionFactura: '01-01-2024',
  tipoFactura: 'F1' as const, cuotaTotal: '12.35', importeTotal: '123.45', huellaAnterior: '',
  fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
}
const H1 = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'
const H2 = 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97'
const H3 = '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68'

describe('V03 · la huella oficial (ejemplos de la AEAT, v0.1.2 §6)', () => {
  it('caso 1: primer registro de alta, sin anterior («Huella=» vacío)', async () => {
    expect(cadenaAlta(CASO1)).toBe(
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    )
    expect(await huellaAlta(CASO1)).toBe(H1)
  })

  it('caso 2: segundo registro de alta, encadenado con el primero', async () => {
    expect(await huellaAlta({ ...CASO1, numSerieFactura: '12345679/G34', huellaAnterior: H1, fechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00' })).toBe(H2)
  })

  it('caso 3: registro de anulación, encadenado con el segundo', async () => {
    const d = {
      idEmisorFacturaAnulada: '89890001K', numSerieFacturaAnulada: '12345679/G34', fechaExpedicionFacturaAnulada: '01-01-2024',
      huellaAnterior: H2, fechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
    }
    expect(cadenaAnulacion(d)).toBe(
      'IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34&FechaExpedicionFacturaAnulada=01-01-2024&Huella=F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00',
    )
    expect(await huellaAnulacion(d)).toBe(H3)
  })

  it('los valores van sin espacios al principio ni al final (§3: « 12345678 / G33 » → «12345678 / G33»)', async () => {
    expect(await huellaAlta({ ...CASO1, idEmisorFactura: ' 89890001K ', numSerieFactura: ' 12345678/G33 ' })).toBe(H1)
    expect(cadenaAlta({ ...CASO1, numSerieFactura: ' 12345678 / G33 ' })).toContain('NumSerieFactura=12345678 / G33&')
  })

  it('la salida es lo que valida la AEAT: 64 hexadecimales en mayúsculas', () => {
    expect(esHuella(H1)).toBe(true)
    expect(esHuella(H1.toLowerCase())).toBe(false)
    expect(esHuella(H1.slice(1))).toBe(false)
  })

  it('la huella de la V01 no es la oficial: otro formato, sin tipo ni cuota, en minúsculas', async () => {
    // Lo que hacía conta_venta_emitir: sha256(emisor|número|AAAA-MM-DD|total|anterior), en minúsculas.
    const v01 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('89890001K|12345678/G33|2024-01-01|123.45|')))]
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(v01).not.toBe(H1.toLowerCase())
    expect(esHuella(v01)).toBe(false)
  })
})

describe('V03 · los formatos del registro', () => {
  it('fecha: AAAA-MM-DD → DD-MM-AAAA', () => {
    expect(fechaAeat('2026-10-24')).toBe('24-10-2026')
    expect(() => fechaAeat('24/10/2026')).toThrow()
  })

  it('importe: punto y dos decimales, también los negativos', () => {
    expect(importeAeat(123.4)).toBe('123.40')
    expect(importeAeat(12.345)).toBe('12.35')
    expect(importeAeat(-3.9)).toBe('-3.90')
    expect(importeAeat(0)).toBe('0.00')
    expect(importeAeat(-0.001)).toBe('0.00')
  })

  it('fecha y hora con el huso de Madrid, en invierno (+01:00) y en verano (+02:00), sin milisegundos', () => {
    expect(fechaHoraHusoMadrid(new Date('2024-01-01T18:20:30.999Z'))).toBe('2024-01-01T19:20:30+01:00')
    expect(fechaHoraHusoMadrid(new Date('2026-10-24T16:01:12Z'))).toBe('2026-10-24T18:01:12+02:00')
    // El cambio de hora del 25/10/2026: a las 01:00 UTC vuelve a ser las 02:00 de Madrid, ya en invierno.
    expect(fechaHoraHusoMadrid(new Date('2026-10-25T00:59:59Z'))).toBe('2026-10-25T02:59:59+02:00')
    expect(fechaHoraHusoMadrid(new Date('2026-10-25T01:00:00Z'))).toBe('2026-10-25T02:00:00+01:00')
  })
})

describe('V03 · la URL del QR (v0.5.0 §4 y §10)', () => {
  it('el ejemplo oficial de «URL encoding»: un «&» en la serie va como %26', () => {
    expect(urlQr({ nif: '89890001K', numSerie: '12345678&G33', fecha: '01-01-2024', importe: '241.4' }, 'pruebas'))
      .toBe('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4')
  })

  it('en real, el dominio de producción; solo los cuatro parámetros (nunca «formato»)', () => {
    const u = urlQr({ nif: 'B12345678', numSerie: 'F-2027/0001', fecha: '04-01-2027', importe: '1284.60' }, 'real')
    expect(u).toBe('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=F-2027%2F0001&fecha=04-01-2027&importe=1284.60')
    expect([...new URL(u).searchParams.keys()]).toEqual(['nif', 'numserie', 'fecha', 'importe'])
  })

  it('lo que la AEAT rechazaría, se dice antes de imprimir, con su código', () => {
    const base = { nif: 'B12345678', numSerie: 'F-2027/0001', fecha: '04-01-2027', importe: '10.00' }
    const codigo = (f: () => unknown) => { try { f(); return null } catch (e) { return (e as QrNoValido).codigo } }
    expect(codigo(() => urlQr({ ...base, nif: '' }, 'real'))).toBe('1001')
    expect(codigo(() => urlQr({ ...base, nif: 'B1234' }, 'real'))).toBe('2001')
    expect(codigo(() => urlQr({ ...base, numSerie: 'X'.repeat(61) }, 'real'))).toBe('2002')
    expect(codigo(() => urlQr({ ...base, numSerie: 'F-2027/0001ñ' }, 'real'))).toBe('2003')
    expect(codigo(() => urlQr({ ...base, fecha: '2027-01-04' }, 'real'))).toBe('2004')
    expect(codigo(() => urlQr({ ...base, importe: '10,00' }, 'real'))).toBe('2005')
    expect(codigo(() => urlQr({ ...base, importe: '1234567890123.00' }, 'real'))).toBe('2006')
  })
})
