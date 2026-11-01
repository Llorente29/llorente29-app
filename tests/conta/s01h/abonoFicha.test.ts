// S01h · La ficha de un abono: sin signo en pantalla, con signo al guardar, y
// lo que dice de lo que anula, el IVA y el pago. Números del 1506416 con
// códigos y números inventados donde no hace falta el real.
import { describe, expect, it } from 'vitest'
import { conSigno, esAbono, estadoPagoAbono, sinSigno, textoAnula, textoIva, textoPago, type LoQueAnula } from '@/modules/conta/documentos/abono'
import type { FacturaRevisar } from '@/modules/conta/services/documentosService'

const fac = (o: Partial<FacturaRevisar> = {}) => ({
  clase: 'credit_note', base: -160.96, cuota: -14.5, recargo: null, retencion: null, total: -175.46,
  tipos: [{ tipo: 10, base: -134.38, cuota: -13.44, recargo: 0 }, { tipo: 4, base: -26.58, cuota: -1.06, recargo: 0 }],
  lineas: [{ texto: 'Producto de prueba', cantidad: -4, importe: -134.38, iva: 10 }],
  ...o,
}) as FacturaRevisar

const ligado: LoQueAnula = {
  anulada: { id: 'f6', codigo: 'FAC-00006', numero: '24056558', fecha: '2026-10-13', total: 175.46, pagada: false, conAlbaran: true },
  sustituta: { id: 'f121', codigo: 'FAC-00121', numero: '24056932', fecha: '2026-10-14' },
  dice: '24056558', compensado: false,
}

describe('S01h · el abono en pantalla, sin signo', () => {
  it('se reconoce por su clase o por el total en negativo', () => {
    expect(esAbono(fac())).toBe(true)
    expect(esAbono(fac({ clase: 'invoice' }))).toBe(true)
    expect(esAbono(fac({ clase: 'invoice', total: 175.46 }))).toBe(false)
  })
  it('todo en positivo: bases, cuotas, líneas y total', () => {
    const f = sinSigno(fac())
    expect([f.base, f.cuota, f.total]).toEqual([160.96, 14.5, 175.46])
    expect(f.tipos.map((t) => [t.base, t.cuota])).toEqual([[134.38, 13.44], [26.58, 1.06]])
    expect(f.lineas[0]).toMatchObject({ cantidad: 4, importe: 134.38 })
  })
  it('una factura de siempre no se toca', () => {
    const f = fac({ clase: 'invoice', total: 10, base: 9, cuota: 1 })
    expect(sinSigno(f)).toBe(f)
  })
  it('al guardar, base, cuota, retención y gasto vuelven en negativo', () => {
    expect(conSigno({
      numero: '1506416',
      iva: [{ tipo: 10, base: 134.38, cuota: 13.44 }],
      retencion: { tipo: 15, base: 100, importe: 15 },
      gasto: [{ cuenta: '60000000', importe: 160.96 }],
    })).toEqual({
      numero: '1506416',
      iva: [{ tipo: 10, base: -134.38, cuota: -13.44 }],
      retencion: { tipo: 15, base: -100, importe: -15 },
      gasto: [{ cuenta: '60000000', importe: -160.96 }],
    })
  })
})

describe('S01h · lo que dice la ficha', () => {
  it('ANULA: el albarán-factura, entero, y lo que lo sustituye', () => {
    expect(textoAnula(ligado, 175.46)).toEqual({
      titulo: 'El albarán-factura 24056558 · FAC-00006',
      detalle: '13/10/2026 · 175,46 € · lo anula entero. Lo sustituye la factura 24056932 (FAC-00121).',
    })
  })
  it('RECTIFICA una que no está en Sumied', () => {
    expect(textoAnula({ anulada: null, sustituta: null, dice: 'F-000099', compensado: false }, 176)).toEqual({
      titulo: 'La factura F-000099, que no está en Sumied',
      detalle: 'El abono se apunta igual. Si la factura llega después, se liga sola.',
    })
    expect(textoAnula({ anulada: null, sustituta: null, dice: null, compensado: false }, 176)).toBeNull()
  })
  it('IVA: resta en el 303 del trimestre del asiento', () => {
    expect(textoIva('2026-10-13', 160.96, 14.5)).toEqual({
      titulo: 'IVA: resta en el 303 del 4.º trimestre',
      detalle: 'Va al libro de recibidas como rectificativa: base −160,96 € y cuota −14,50 €.',
    })
  })
  it('Pago: compensa la que anula si está sin pagar; si no, a tu favor', () => {
    expect(textoPago(ligado, 175.46).titulo).toBe('Pago: compensa la FAC-00006')
    expect(textoPago(ligado, 175.46).detalle).toBe('La FAC-00006 está sin pagar: al validar el asiento, las dos quedan saldadas, sin movimiento de banco. Se paga solo la FAC-00121.')
    expect(textoPago({ ...ligado, compensado: true }, 175.46)).toEqual({ titulo: 'Pago: compensada con la FAC-00006', detalle: 'Las dos quedan saldadas, sin movimiento de banco.' })
    expect(textoPago({ ...ligado, anulada: { ...ligado.anulada!, pagada: true } }, 175.46).detalle).toBe('La FAC-00006 ya está pagada: los 175,46 € quedan como saldo a tu favor con el proveedor.')
    expect(textoPago({ anulada: null, sustituta: null, dice: 'F-000099', compensado: false }, 176).detalle).toBe('Sin la factura que anula, los 176,00 € quedan como saldo a tu favor con el proveedor.')
  })
})

describe('S01h · 1 · «Pago › Estado» de un abono dice lo mismo que su bloque, sin el banco', () => {
  it('ligado a una sin pagar: se compensa al validar', () => {
    expect(estadoPagoAbono(ligado)).toBe('Se compensa con la FAC-00006 al validar.')
  })
  it('ya compensado, a favor, o sin leer todavía', () => {
    expect(estadoPagoAbono({ ...ligado, compensado: true })).toBe('Compensado con la FAC-00006: sin movimiento de banco.')
    expect(estadoPagoAbono({ ...ligado, anulada: { ...ligado.anulada!, pagada: true } })).toBe('Queda a tu favor con el proveedor: no pasa por el banco.')
    expect(estadoPagoAbono({ anulada: null, sustituta: null, dice: null, compensado: false })).toBe('Queda a tu favor con el proveedor: no pasa por el banco.')
    expect(estadoPagoAbono(null)).toBe('')
  })
  it('nunca promete el banco', () => {
    for (const a of [ligado, { ...ligado, compensado: true }, { anulada: null, sustituta: null, dice: 'X', compensado: false }]) {
      expect(estadoPagoAbono(a)).not.toMatch(/casará/)
    }
  })
})
