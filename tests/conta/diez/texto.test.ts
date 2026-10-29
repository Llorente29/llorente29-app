// tests/conta/diez/texto.test.ts
//
// D07a · Los textos que van a Diez caben en 40. El caso real: la recibida de
// RIDERS «ES I 34427 26 00014» (asiento 3248), de un rider cuyo «número-nombre»
// medía 44: Diez la rechazó con «factura.Descripcion … maximum length of 40».
// W12 (29/10): el nombre y el NIE del rider eran los de verdad; aquí van
// inventados con las mismas longitudes de palabra (6, 6, 5 y 4), así que la
// prueba mide exactamente lo mismo.

import { describe, expect, it } from 'vitest'
import { MAX_TEXTO_DIEZ, conTextosDiez, descripcionRecibida, textoDiez } from '../../../supabase/functions/_shared/diezTexto'
import { facturaRecibida } from '../../../supabase/functions/_shared/diezRecibida'

describe('D07a · la descripción de una recibida, en 40 y con el número entero', () => {
  it('la de RIDERS ES I 34427 26 00014: el número entero y el nombre recortado', () => {
    const d = descripcionRecibida('ES I 34427 26 00014', 'RIDERS PRUEBA ALFAS BETA')
    expect(`ES I 34427 26 00014-RIDERS PRUEBA ALFAS BETA`.length).toBe(44)
    expect(d.length).toBeLessThanOrEqual(MAX_TEXTO_DIEZ)
    expect(d).toBe('ES I 34427 26 00014-RIDERS PRUEBA ALFAS')
    expect(d.startsWith('ES I 34427 26 00014-')).toBe(true)
  })
  it('la que cabe, igual que antes', () => {
    expect(descripcionRecibida('F-2026-1022', 'Mayorista Prueba Alfa')).toBe('F-2026-1022-Mayorista Prueba Alfa')
  })
  it('un número de más de 40: sus 40 primeros, sin el nombre', () => {
    const n = 'X'.repeat(45)
    expect(descripcionRecibida(n, 'Proveedor')).toBe('X'.repeat(40))
  })
})

describe('D07a · todo lo que se manda a Diez, en 40', () => {
  it('la factura: Descripcion, los conceptos de sus apuntes y la analítica; lo demás, igual', () => {
    const largo = 'A'.repeat(50)
    const f = conTextosDiez({ Serie: '2', Descripcion: largo, Apuntes: [{ Linea: 1, Concepto: largo, Importe: 1 }], Analitica: [{ Subcuenta: '6', Descripcion: largo }] })
    expect(f.Descripcion).toBe('A'.repeat(40))
    expect(f.Apuntes[0]).toEqual({ Linea: 1, Concepto: 'A'.repeat(40), Importe: 1 })
    expect(f.Analitica[0].Descripcion).toBe('A'.repeat(40))
    expect(f.Serie).toBe('2')
  })
  it('el asiento: su descripción y la de cada línea', () => {
    const a = conTextosDiez({ Ejercicio: '2026', Descripcion: 'B'.repeat(41), Detalles: [{ Cuenta: '6', Descripcion: 'C'.repeat(60) }] })
    expect(a.Descripcion).toBe('B'.repeat(40))
    expect(a.Detalles[0].Descripcion).toBe('C'.repeat(40))
  })
  it('un texto corto no cambia; espacios de más, fuera', () => {
    expect(textoDiez('  Hola   mundo ')).toBe('Hola mundo')
  })
})

describe('D07a · la factura de RIDERS sale con su Descripcion en 40', () => {
  it('facturaRecibida: Descripcion y Concepto de los apuntes, en 40', () => {
    const { factura } = facturaRecibida({
      fecha: '2026-10-23', fechaFactura: '2026-10-20', numero: 'ES I 34427 26 00014',
      proveedor: { nombre: 'RIDERS PRUEBA ALFAS BETA', nif: 'Z0000001Y' },
      lineas: [
        { cuenta: '62400000', debe: 4.82, haber: 0 },
        { cuenta: '47200000', debe: 1.01, haber: 0, tipoIva: 21, baseIva: 4.82 },
        { cuenta: '41000001', debe: 0, haber: 5.83 },
      ],
    }, { hoy: '2026-10-23' })
    expect(factura.Descripcion).toBe('ES I 34427 26 00014-RIDERS PRUEBA ALFAS')
    for (const a of factura.Apuntes ?? []) expect(String(a.Concepto).length).toBeLessThanOrEqual(40)
    expect(factura.CifCliente).toBe('Z0000001Y')
    expect(factura.NumeroFactura).toBe('ES I 34427 26 00014')
  })
})
