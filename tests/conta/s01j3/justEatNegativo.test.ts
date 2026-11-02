// tests/conta/s01j3/justEatNegativo.test.ts
//
// S01j·3 · La liquidación de Just Eat con saldo negativo: «El importe que debes
// abonar a Just Eat es -4,33€». Antes no se reconocía como liquidación (pedía
// «Recibirás de Just Eat») y el correo entraba «sin facturas». Ahora se lee
// igual que las demás, con su factura, y el neto es negativo.
//
// La forma es la de los correos reales de Just Eat de saldo negativo (leídos en
// solo lectura, regla 31), con todo inventado (T11): el restaurante, la
// dirección, los NIF y los números. Sin la línea del IBAN de Just Eat.

import { describe, expect, it } from 'vitest'
import { leerLiquidacionJustEat, paraRegistrarJustEat } from '../../../supabase/functions/_shared/liquidacionJustEat'
import { readFileSync } from 'node:fs'

// Como llega en texto: celdas con «|», el importe en la misma celda que su etiqueta.
const TEXTO = `| Tu factura 1 octubre 2026 - 15 octubre 2026 |
| Restaurante Inventado~ 28000 Madrid |
| Tus datos en Just Eat... |
| El importe que debes abonar a Just Eat es -4,33€ |
| Número de pedidos | 0 | 0 Pedidos a domicilio 0 Pedidos a recoger |
| Total de ventas | 0,00€ | 0 Total ventas en tarjeta 0,00€ |
| Tu factura de Just Eat | Volver al inicio |
| Nº Factura 9000001 | Just Eat Spain SL |
| Restaurante Inventado~ SOCIEDAD INVENTADA S.L. Calle Inventada, 4 Madrid 28000 Madrid | B00000001 |
| Calle Ancora 40 Entrada por Vara Del Rey I 28045 Madrid | B00000002 | Fecha de factura 15 octubre 2026 |
| 1 octubre 2026 - 15 octubre 2026 |
| Gastos de usuario 16-30 septiembre (Sujeto a IVA @ 21%) | 3,58€ |
| | Subtotal | 3,58€ |
| | IVA 21% | 0,75€ |
| | Total incluido IVA | 4,33€ |
| El importe de tu factura se descontará del balance |
| Estado de tu cuenta Just Eat |
| Balance en Cuenta | 01/10/26 | 14,69€ |
| Pago | 02/10/26 | -14,69€ |
| Factura 9000001 | 15/10/26 | -4,33€ |
| Tu balance en cuenta | | -4,33€ |`

const DE = { from: 'noreplyes@justeat-int.com', subject: 'Just-eat invoice: 9000001' }

describe('Just Eat con saldo negativo', () => {
  it('se lee como liquidación, con su factura, y el neto es lo que debes (negativo)', () => {
    const l = leerLiquidacionJustEat({ ...DE, text: TEXTO })
    expect(l.desde).toBe('2026-10-01')
    expect(l.hasta).toBe('2026-10-15')
    expect(l.neto).toBe(-4.33)
    expect(l.ventas).toBe(0)
    expect(l.pedidos).toBe(0)
    expect(l.factura).toEqual({ numero: '9000001', base: 3.58, iva: 0.75, total: 4.33 })
    expect(l.pagoEl).toBeNull()
    expect(l.avisos).toEqual([])
    // Suma: ventas 0 − factura 4,33 + otros 0 = −4,33.
    expect(l.otros).toBe(0)
  })

  it('lo que va a la base: el neto negativo, la comisión (su factura) y otros 0', () => {
    const p = paraRegistrarJustEat(leerLiquidacionJustEat({ ...DE, text: TEXTO }), { emailId: 'correo-inventado' })
    expect(p).toMatchObject({ proveedor: 'justeat', neto: -4.33, comision: 4.33, otros: 0, ventas: { total: 0 }, referencia: '9000001', email_id: 'correo-inventado' })
  })

  it('en HTML, con el importe en el trozo siguiente (la forma de 2026)', () => {
    // El correo real de 2026 (fixture del V02), cambiado a saldo negativo: sin «Recibirás» ni «Será abonado».
    const html = readFileSync('tests/unit/modules/conta/v02/fixtures/liquidaciones/justeat-4126424.html', 'utf8')
      .replace(/Recibirás de Just Eat/, 'El importe que debes abonar a Just Eat es')
      .replace(/90,30/g, '12,50')
      .replace(/Será abonado antes del/, 'Por favor ingresa el importe pendiente')
    const l = leerLiquidacionJustEat({ ...DE, subject: 'Just-eat invoice: 4126424', html })
    expect(l.neto).toBe(-12.5)
    expect(l.factura.total).toBe(32.79)
    expect(l.pagoEl).toBeNull()
  })

  it('el de siempre, con «Recibirás de Just Eat», no cambia', () => {
    const html = readFileSync('tests/unit/modules/conta/v02/fixtures/liquidaciones/justeat-4126424.html', 'utf8')
    const l = leerLiquidacionJustEat({ ...DE, subject: 'Just-eat invoice: 4126424', html })
    expect(l.neto).toBe(90.3)
    expect(l.factura).toEqual({ numero: '4126424', base: 27.1, iva: 5.69, total: 32.79 })
    expect(l.otros).toBe(-20.93)
  })
})
