import { describe, expect, it } from 'vitest'
import { etiquetaPago, lineaApartado, type DatosResumen } from '@/modules/conta/lib/resumenFicha'
import { calcularCompletitud } from '@/modules/conta/lib/completitud'
import type { ContactoProveedor, FichaProveedor } from '@/modules/conta/types'

// Los textos esperados son los de la maqueta móvil aprobada
// (docs/conta/maquetas/ProveedorMovil.dc.html): Hermanos Ruiz con régimen
// general, IVA 10 y 21, transferencia a 30 días, Comida y bebida (600), sin
// contacto de administración ni certificado del banco, y última factura
// F-2026-0915 del 24/09 por 1.283,15 €.
const ficha: FichaProveedor = {
  id: 's1', accountId: 'a1', name: 'Hermanos Ruiz', legalName: 'Hermanos Ruiz Distribución, S.L.',
  taxId: 'B87123790', taxIdType: 'nif_es', countryCode: 'ES', entityKind: 'company',
  taxIdVerifiedAt: '2026-10-01T10:00:00Z', taxIdCheckStatus: 'valid', taxIdCheckedAt: null,
  fiscalStreet: 'C/ Ejemplo 12', fiscalPostalCode: '28021', fiscalCity: 'Madrid', fiscalProvince: 'Madrid',
  vatRegime: 'general', usualVatRates: [10, 21], irpfWithholdingPct: null, expenseCategoryId: 'cat-600',
  defaultLocationId: null, paymentMethod: 'transfer', paymentTermsDays: 30, paymentFixedDays: [],
  iban: 'ES9121000418450200051332', ibanVerifiedAt: '2026-10-01T10:00:00Z', bankName: null,
  ledgerAccountCode: null, healthRegistryNo: 'RGSEAA', isActive: true, notes: null,
  website: null, tags: [], bic: null, sepaMandateRef: null, sepaMandateDate: null, currency: 'EUR',
  earlyPaymentDiscountPct: null, ivaIncluidoEnLinea: false, archivedAt: null, createdAt: null, createdByName: null,
}
const pedidos: ContactoProveedor = { id: 'c1', supplierId: 's1', name: 'Ana Ruiz', role: 'orders', phone: '600000000', email: null, isPrimary: true, notes: null }
const comercial: ContactoProveedor = { id: 'c2', supplierId: 's1', name: 'Luis Martín', role: 'sales', phone: null, email: 'luis@ejemplo.es', isPrimary: false, notes: null }

function datos(): DatosResumen {
  const contactos = [pedidos, comercial]
  return {
    ficha, contactos,
    faltan: calcularCompletitud({ ficha, contactos, tieneCertificadoBanco: false }).faltan,
    tipoGasto: { name: 'Comida y bebida', pgcAccountHint: '600' },
    ultimaFactura: { invoiceDate: '2026-09-24', grandTotal: 1283.15 },
    numDocumentos: 0,
  }
}

describe('resumen de cada apartado (lista del móvil)', () => {
  it('sale igual que la maqueta', () => {
    const d = datos()
    expect(lineaApartado('datos-fiscales', d)).toEqual({ detalle: 'General · 10 % y 21 %', falta: false })
    expect(lineaApartado('contactos', d)).toEqual({ detalle: 'Falta el de administración', falta: true })
    expect(lineaApartado('pago', d)).toEqual({ detalle: 'Transferencia a 30 días', falta: false })
    expect(lineaApartado('contabilidad', d)).toEqual({ detalle: 'Comida y bebida · 600', falta: false })
    expect(lineaApartado('documentos', d)).toEqual({ detalle: 'Falta el certificado del banco', falta: true })
    expect(lineaApartado('facturas', d)).toEqual({ detalle: 'Última: 24/09 · 1.283,15 €', falta: false })
  })
  it('sin facturas no dice 0 €', () => {
    expect(lineaApartado('facturas', { ...datos(), ultimaFactura: null }).detalle).toBe('Aún no hay facturas suyas')
  })
})

describe('etiqueta de pago', () => {
  it('forma, plazo y días fijos', () => {
    expect(etiquetaPago(ficha)).toBe('Transferencia a 30 días')
    expect(etiquetaPago({ ...ficha, paymentMethod: 'direct_debit', paymentFixedDays: [20, 5] })).toBe('Domiciliación a 30 días, días 5 y 20')
    expect(etiquetaPago({ ...ficha, paymentMethod: 'cash', paymentTermsDays: 0 })).toBe('Efectivo al contado')
    expect(etiquetaPago({ ...ficha, paymentMethod: null })).toBeNull()
  })
})
