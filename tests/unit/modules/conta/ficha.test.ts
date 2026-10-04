// Completitud, cifras, vencimiento, dirección y validaciones al guardar — C01 §4.3, §4.4, §5.5–5.7.
import { describe, it, expect } from 'vitest'
import { calcularCompletitud } from '@/modules/conta/lib/completitud'
import { calcularCifras, calcularVencimiento } from '@/modules/conta/lib/cifras'
import { proponerDireccion } from '@/modules/conta/lib/direccion'
import { validarFicha } from '@/modules/conta/lib/validacionesFicha'
import type { ContactoProveedor, FacturaParaCifras, FichaProveedor } from '@/modules/conta/types'

const vacia: FichaProveedor = {
  id: 's1', accountId: 'a1', name: 'Hermanos Ruiz', legalName: null, taxId: null, taxIdType: null,
  countryCode: 'ES', entityKind: null, taxIdVerifiedAt: null, taxIdCheckStatus: null,
  fiscalStreet: null, fiscalPostalCode: null, fiscalCity: null, fiscalProvince: null,
  vatRegime: null, usualTaxRateIds: [], irpfWithholdingPct: null, expenseCategoryId: null,
  defaultLocationId: null, paymentMethod: null, paymentTermsDays: null, paymentFixedDays: [],
  iban: null, ibanVerifiedAt: null, bankName: null, ledgerAccountCode: null,
  healthRegistryNo: null, isActive: true, notes: null,
  website: null, tags: [], bic: null, sepaMandateRef: null, sepaMandateDate: null,
  currency: 'EUR', earlyPaymentDiscountPct: null,
  ivaIncluidoEnLinea: false, invoicingFrequency: null, taxIdCheckedAt: null, archivedAt: null, createdAt: null, createdByName: null,
}
const completa: FichaProveedor = {
  ...vacia, legalName: 'Hermanos Ruiz Distribución, S.L.', taxId: 'B87123790', taxIdType: 'nif_es',
  entityKind: 'company', taxIdVerifiedAt: '2026-10-01T10:00:00Z', taxIdCheckStatus: 'valid',
  fiscalStreet: 'C/ Ejemplo 12', fiscalPostalCode: '28021', fiscalCity: 'Madrid', fiscalProvince: 'Madrid',
  vatRegime: 'general', usualTaxRateIds: ['t10', 't21'], expenseCategoryId: 'cat-600',
  paymentMethod: 'transfer', paymentTermsDays: 30, iban: 'ES9121000418450200051332',
  ibanVerifiedAt: '2026-10-01T10:00:00Z',
}
const contacto = (role: ContactoProveedor['role']): ContactoProveedor =>
  ({ id: role, supplierId: 's1', name: 'Ana', role, phone: '600000000', email: null, isPrimary: role === 'orders', notes: null })

describe('completitud (§5.5)', () => {
  it('una ficha vacía pagada por transferencia está al 0 % y dice todo lo que falta', () => {
    const r = calcularCompletitud({ ficha: { ...vacia, paymentMethod: 'transfer' }, contactos: [], tieneCertificadoBanco: false })
    expect(r.pct).toBe(0)
    expect(r.faltan.map((f) => f.clave)).toContain('iban')
  })

  it('la maqueta: todo menos certificado del banco y contacto de administración → 90 de 100', () => {
    const r = calcularCompletitud({ ficha: completa, contactos: [contacto('orders'), contacto('sales')], tieneCertificadoBanco: false })
    expect(r.pct).toBe(90)
    expect(r.faltan.map((f) => f.texto)).toEqual(['contacto de administración', 'certificado del banco'])
  })

  it('todo hecho → 100 %, sin nada que falte', () => {
    const r = calcularCompletitud({ ficha: completa, contactos: [contacto('orders'), contacto('admin')], tieneCertificadoBanco: true })
    expect(r).toEqual({ pct: 100, faltan: [] })
  })

  it('en efectivo no pide IBAN ni certificado: su peso se reparte y se llega al 100 %', () => {
    const r = calcularCompletitud({
      ficha: { ...completa, paymentMethod: 'cash', iban: null, ibanVerifiedAt: null },
      contactos: [contacto('orders'), contacto('admin')], tieneCertificadoBanco: false,
    })
    expect(r).toEqual({ pct: 100, faltan: [] })
  })

  it('cada cosa que falta lleva adónde ir', () => {
    const r = calcularCompletitud({ ficha: vacia, contactos: [], tieneCertificadoBanco: false })
    const nif = r.faltan.find((f) => f.clave === 'nif')
    expect(nif?.destino).toEqual({ pestana: 'fiscal', campo: 'taxId' })
  })

  it('un NIF escrito pero sin comprobar no cuenta', () => {
    const r = calcularCompletitud({ ficha: { ...completa, taxIdVerifiedAt: null, taxIdCheckStatus: null }, contactos: [], tieneCertificadoBanco: true })
    expect(r.faltan.map((f) => f.clave)).toContain('nif')
  })

  it('un NIF-IVA UE con VIES pendiente no cuenta como comprobado', () => {
    const r = calcularCompletitud({ ficha: { ...completa, taxIdType: 'vat_eu', taxIdCheckStatus: 'pending' }, contactos: [], tieneCertificadoBanco: true })
    expect(r.faltan.map((f) => f.clave)).toContain('nif')
  })
})

const fac = (p: Partial<FacturaParaCifras>): FacturaParaCifras =>
  ({ id: 'f', status: 'aprobada', invoiceNumber: 'F-1', invoiceDate: '2026-09-24', grandTotal: 100, dueDate: '2026-10-24', paidAt: null, ...p })

describe('cifras (§5.6)', () => {
  it('sin facturas: nada es 0 €, todo es «no hay»', () => {
    expect(calcularCifras([], '2026-10-01')).toEqual({
      compradoEsteAnio: null, facturasEsteAnio: 0, leDebes: null, proximoPago: null, hayFacturas: false,
    })
  })

  it('sólo cuentan las aprobadas (y las pagadas); borradores y anuladas no', () => {
    const r = calcularCifras([
      fac({ id: '1', grandTotal: 1283.15 }),
      fac({ id: '2', status: 'borrador', grandTotal: 999 }),
      fac({ id: '3', status: 'anulada', grandTotal: 999 }),
      fac({ id: '4', status: 'pagada', grandTotal: 964.40, paidAt: '2026-09-15' }),
    ], '2026-10-01')
    expect(r.compradoEsteAnio).toBe(2247.55)
    expect(r.facturasEsteAnio).toBe(2)
    expect(r.leDebes).toBe(1283.15)
  })

  it('el año es el natural: una de diciembre pasado no suma a este año, pero sí se debe', () => {
    const r = calcularCifras([fac({ invoiceDate: '2025-12-20', grandTotal: 50 })], '2026-10-01')
    expect(r.compradoEsteAnio).toBeNull()
    expect(r.leDebes).toBe(50)
  })

  it('marcar como pagada cambia «Le debes» y «Próximo pago»', () => {
    const antes = [fac({ id: 'a', dueDate: '2026-10-24', grandTotal: 1283.15 }), fac({ id: 'b', dueDate: '2026-11-10', grandTotal: 200 })]
    expect(calcularCifras(antes, '2026-10-01').proximoPago).toEqual({ fecha: '2026-10-24', importe: 1283.15, facturas: 1 })
    const despues = [{ ...antes[0], paidAt: '2026-10-01' }, antes[1]]
    const r = calcularCifras(despues, '2026-10-01')
    expect(r.leDebes).toBe(200)
    expect(r.proximoPago).toEqual({ fecha: '2026-11-10', importe: 200, facturas: 1 })
  })

  it('todo pagado: le debes 0 € (hay facturas y no se debe nada) y no hay próximo pago', () => {
    const r = calcularCifras([fac({ paidAt: '2026-10-01' })], '2026-10-01')
    expect(r.leDebes).toBe(0)
    expect(r.proximoPago).toBeNull()
  })

  it('dos que vencen el mismo día se suman', () => {
    const r = calcularCifras([fac({ id: 'a', grandTotal: 10.1 }), fac({ id: 'b', grandTotal: 20.2 })], '2026-10-01')
    expect(r.proximoPago).toEqual({ fecha: '2026-10-24', importe: 30.3, facturas: 2 })
  })
})

describe('vencimiento (§4.4)', () => {
  it('30 días desde la fecha de factura', () => expect(calcularVencimiento('2026-09-24', 30)).toBe('2026-10-24'))
  it('cruza de año', () => expect(calcularVencimiento('2026-12-15', 30)).toBe('2027-01-14'))
  it('0 días = al contado, el mismo día', () => expect(calcularVencimiento('2026-09-24', 0)).toBe('2026-09-24'))
  it('sin plazo no se inventa', () => expect(calcularVencimiento('2026-09-24', null)).toBeNull())
  it('días fijos 5 y 20: pasa al primero igual o posterior', () => {
    expect(calcularVencimiento('2026-09-24', 30, [5, 20])).toBe('2026-11-05')
    expect(calcularVencimiento('2026-09-01', 0, [5, 20])).toBe('2026-09-05')
    expect(calcularVencimiento('2026-09-05', 0, [5, 20])).toBe('2026-09-05')
  })
  it('un día fijo 31 en un mes de 30 es el último del mes', () => {
    expect(calcularVencimiento('2026-04-10', 0, [31])).toBe('2026-04-30')
    expect(calcularVencimiento('2026-02-10', 0, [30])).toBe('2026-02-28')
  })
})

describe('propuesta de dirección (§4.3) — las 4 direcciones REALES de Foodint', () => {
  it('«C/CAMINO POZO TIO RAIMUNDO 11, 28031 MADRID VALLECAS ESPANA»: el barrio no es la población', () => {
    expect(proponerDireccion('C/CAMINO POZO TIO RAIMUNDO 11, 28031 MADRID VALLECAS ESPANA')).toEqual({
      street: 'C/CAMINO POZO TIO RAIMUNDO 11', postalCode: '28031', city: 'Madrid', province: 'Madrid',
    })
  })
  it('«Crisol, 1, 28760 - Tres Cantos (Madrid), España»', () => {
    expect(proponerDireccion('Crisol, 1, 28760 - Tres Cantos (Madrid), España')).toEqual({
      street: 'Crisol, 1', postalCode: '28760', city: 'Tres Cantos', province: 'Madrid',
    })
  })
  it('sin código postal no se adivina: «C/ Urano, 23 Mostoles» va entera a la calle', () => {
    expect(proponerDireccion('C/ Urano, 23 Mostoles')).toEqual({ street: 'C/ Urano, 23 Mostoles', postalCode: null, city: null, province: null })
  })
  it('«PASEO IMPERIAL, 40» igual', () => {
    expect(proponerDireccion('PASEO IMPERIAL, 40')).toEqual({ street: 'PASEO IMPERIAL, 40', postalCode: null, city: null, province: null })
  })
  it('nada → nada', () => expect(proponerDireccion('  ')).toBeNull())
})

describe('validaciones al guardar (§5.7)', () => {
  it('NIF repetido en la misma cuenta: bloquea y dice quién lo tiene', () => {
    const r = validarFicha(completa, [{ id: 'otro', name: 'AMIRSA', taxId: 'B-87123790' }])
    expect(r.errores).toEqual([{ campo: 'taxId', mensaje: 'Ese NIF ya lo tiene otro proveedor: AMIRSA.' }])
  })
  it('el propio proveedor no cuenta como repetido', () => {
    expect(validarFicha(completa, [{ id: 's1', name: 'yo', taxId: 'B87123790' }]).errores).toEqual([])
  })
  it('autónomo sin retención: avisa, no bloquea', () => {
    const r = validarFicha({ ...completa, taxId: '12345678Z', entityKind: 'self_employed' }, [])
    expect(r.errores).toEqual([])
    expect(r.avisos.map((a) => a.campo)).toEqual(['irpfWithholdingPct'])
  })
  it('plazo de más de 60 días: avisa (Ley 3/2004, art. 4.3), no bloquea', () => {
    const r = validarFicha({ ...completa, paymentTermsDays: 90 }, [])
    expect(r.errores).toEqual([])
    expect(r.avisos).toEqual([{ campo: 'paymentTermsDays', mensaje: 'Supera los 60 días que permite la ley de morosidad entre empresas.' }])
    expect(validarFicha({ ...completa, paymentTermsDays: 60 }, []).avisos).toEqual([])
  })
  it('intracomunitario sin NIF-IVA UE: bloquea', () => {
    const r = validarFicha({ ...completa, vatRegime: 'intracomunitario' }, [])
    expect(r.errores.map((e) => e.campo)).toContain('taxId')
  })
  it('intracomunitario con NIF-IVA UE bien formado: pasa', () => {
    const r = validarFicha({ ...completa, vatRegime: 'intracomunitario', taxIdType: 'vat_eu', taxId: 'FR40303265045' }, [])
    expect(r.errores).toEqual([])
  })
  it('NIF e IBAN mal escritos bloquean con su mensaje', () => {
    const r = validarFicha({ ...completa, taxId: 'B87123791', iban: 'ES9121000418450200051333' }, [])
    expect(r.errores.map((e) => e.mensaje)).toEqual([
      'El carácter de control no cuadra: revisa el NIF de la empresa.',
      'Este IBAN no es correcto: revisa los dígitos.',
    ])
  })
  // BIC (comparación con Holded, respuesta 2 de Julio). El IBAN alemán es el
  // ejemplo del registro de IBAN de SWIFT (DE89 3704 0044 0532 0130 00); los BIC
  // son de bancos reales: DEUTDEFF (Deutsche Bank) y CAIXESBBXXX (CaixaBank).
  it('un IBAN de fuera de España pide el BIC', () => {
    const r = validarFicha({ ...completa, iban: 'DE89370400440532013000' }, [])
    expect(r.errores.map((e) => e.campo)).toEqual(['bic'])
  })
  it('con su BIC, el IBAN extranjero pasa', () => {
    expect(validarFicha({ ...completa, iban: 'DE89370400440532013000', bic: 'DEUTDEFF' }, []).errores).toEqual([])
  })
  it('con un IBAN español el BIC es opcional, pero si se escribe tiene que tener forma de BIC', () => {
    expect(validarFicha({ ...completa, bic: null }, []).errores).toEqual([])
    expect(validarFicha({ ...completa, bic: 'CAIXESBBXXX' }, []).errores).toEqual([])
    expect(validarFicha({ ...completa, bic: 'CAIXA' }, []).errores.map((e) => e.campo)).toEqual(['bic'])
  })
})
