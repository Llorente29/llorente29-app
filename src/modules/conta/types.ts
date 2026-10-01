// src/modules/conta/types.ts
//
// El proveedor tal como lo ve el módulo de contabilidad (C01). camelCase en
// el cliente; el servicio traduce desde/hacia snake_case de la base.

export type TaxIdType = 'nif_es' | 'vat_eu' | 'foreign'
export type EntityKind = 'company' | 'self_employed'
export type VatRegime =
  | 'general' | 'recargo_equivalencia' | 'intracomunitario' | 'exento'
  | 'inversion_sujeto_pasivo' | 'extranjero'
export type PaymentMethod = 'transfer' | 'direct_debit' | 'card' | 'cash'
export type ContactRole = 'orders' | 'sales' | 'admin' | 'delivery' | 'other'
/** Estado de la comprobación del NIF. 'pending' = VIES no contestó y se reintentará. */
export type TaxIdCheckStatus = 'valid' | 'invalid' | 'pending'

export interface FichaProveedor {
  id: string
  accountId: string
  name: string
  legalName: string | null
  taxId: string | null
  taxIdType: TaxIdType | null
  countryCode: string
  entityKind: EntityKind | null
  taxIdVerifiedAt: string | null
  taxIdCheckStatus: TaxIdCheckStatus | null
  fiscalStreet: string | null
  fiscalPostalCode: string | null
  fiscalCity: string | null
  fiscalProvince: string | null
  vatRegime: VatRegime | null
  usualVatRates: number[]
  irpfWithholdingPct: number | null
  expenseCategoryId: string | null
  defaultLocationId: string | null
  paymentMethod: PaymentMethod | null
  paymentTermsDays: number | null
  paymentFixedDays: number[]
  iban: string | null
  ibanVerifiedAt: string | null
  bankName: string | null
  ledgerAccountCode: string | null
  healthRegistryNo: string | null
  isActive: boolean
  notes: string | null
}

export interface ContactoProveedor {
  id: string
  supplierId: string
  name: string
  role: ContactRole
  phone: string | null
  email: string | null
  isPrimary: boolean
  notes: string | null
}

/** Lo mínimo de una factura de proveedor que necesitan las cifras de la ficha. */
export interface FacturaParaCifras {
  id: string
  status: string
  invoiceNumber: string | null
  invoiceDate: string | null   // 'YYYY-MM-DD'
  grandTotal: number | null
  dueDate: string | null       // 'YYYY-MM-DD'
  paidAt: string | null        // 'YYYY-MM-DD'
}

export const ROLE_LABEL: Record<ContactRole, string> = {
  orders: 'Pedidos',
  sales: 'Comercial',
  admin: 'Administración',
  delivery: 'Reparto',
  other: 'Otro',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: 'Transferencia',
  direct_debit: 'Domiciliación',
  card: 'Tarjeta',
  cash: 'Efectivo',
}

export const VAT_REGIME_LABEL: Record<VatRegime, string> = {
  general: 'General',
  recargo_equivalencia: 'Recargo de equivalencia',
  intracomunitario: 'Intracomunitario',
  exento: 'Exento',
  inversion_sujeto_pasivo: 'Inversión del sujeto pasivo',
  extranjero: 'Extranjero',
}
