// src/modules/conta/types.ts
//
// El proveedor tal como lo ve el módulo de contabilidad (C01). camelCase en
// el cliente; el servicio traduce desde/hacia snake_case de la base.

export type TaxIdType = 'nif_es' | 'vat_eu' | 'foreign'
export type EntityKind = 'company' | 'self_employed'
export type VatRegime =
  | 'general' | 'recargo_equivalencia' | 'intracomunitario' | 'exento'
  | 'inversion_sujeto_pasivo' | 'extranjero'
/** D06: 'prepaid', el saldo prepago de Catcher (40700001): Riders se paga de ahí (tanda 0800). */
export type PaymentMethod = 'transfer' | 'direct_debit' | 'card' | 'cash' | 'prepaid'
export type ContactRole = 'orders' | 'sales' | 'admin' | 'billing' | 'delivery' | 'other'
/** Cada cuánto factura (C01b; columna supplier.invoicing_frequency). */
export type InvoicingFrequency = 'per_delivery' | 'weekly' | 'fortnightly' | 'monthly' | 'other'
/** Estado de la comprobación del NIF. 'pending' = VIES no contestó y se reintentará. */
export type TaxIdCheckStatus = 'valid' | 'invalid' | 'pending'

export interface FichaProveedor {
  id: string
  accountId: string
  name: string
  /** C02c: la creó «traer el plan» de otro programa (ese programa, para «Traída de Diez · por completar»); null si no. */
  traidaDe: string | null
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
  /** Los IVA habituales de sus facturas: referencias a `tax_rate` (C01b; antes, porcentajes sueltos). */
  usualTaxRateIds: string[]
  irpfWithholdingPct: number | null
  expenseCategoryId: string | null
  defaultLocationId: string | null
  /** S01o·2 · «Entrega mercancía» (sus facturas esperan albarán). null: lo deduce Sumied. */
  deliversGoods: boolean | null
  paymentMethod: PaymentMethod | null
  paymentTermsDays: number | null
  paymentFixedDays: number[]
  iban: string | null
  ibanVerifiedAt: string | null
  /** C01b R2 · El IBAN de antes y quién lo cambió desde una factura («Es el nuevo IBAN»). Solo lectura. */
  ibanPrevious: string | null
  ibanChangedAt: string | null
  ibanChangedByName: string | null
  bankName: string | null
  healthRegistryNo: string | null
  isActive: boolean
  notes: string | null
  // Comparación con Holded (respuesta 2 de Julio, punto 5). Ninguno cuenta
  // para el % de ficha completa.
  website: string | null
  /** S01b · De qué factura sale cada dato que la ficha tomó de una factura (supplier.data_from_invoice): «de la factura R0672». */
  dataFromInvoice: Record<string, { factura: string | null; facturaId: string; fecha: string; quien: string | null }> | null
  tags: string[]
  /** BIC/SWIFT. Obligatorio si el IBAN no es español. */
  bic: string | null
  /** Mandato de domiciliación: solo se enseña si la forma de pago es domiciliación. */
  sepaMandateRef: string | null
  sepaMandateDate: string | null   // 'YYYY-MM-DD'
  currency: string
  earlyPaymentDiscountPct: number | null
  // Lo que ya traía la ficha anterior y se conserva.
  /** Factura con el IVA dentro del importe de línea (ver Supplier.ivaIncluidoEnLinea). */
  ivaIncluidoEnLinea: boolean
  invoicingFrequency: InvoicingFrequency | null
  taxIdCheckedAt: string | null
  archivedAt: string | null
  createdAt: string | null
  createdByName: string | null
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
  /** PC01 · E2 · Lo pagado con asiento (conta_recibida_pago). Sin él, se cuenta como si nada (lo de antes). */
  pagado?: number
}

export const ROLE_LABEL: Record<ContactRole, string> = {
  orders: 'Pedidos',
  sales: 'Comercial',
  admin: 'Administración',
  // D01: el contacto al que se piden las facturas («Pedírselas»), 0210.
  billing: 'Facturación',
  delivery: 'Reparto',
  other: 'Otro',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: 'Transferencia',
  direct_debit: 'Domiciliación',
  card: 'Tarjeta',
  cash: 'Efectivo',
  prepaid: 'Saldo prepago Catcher (40700001)',
}

export const INVOICING_FREQUENCY_LABEL: Record<InvoicingFrequency, string> = {
  per_delivery: 'Con cada entrega',
  weekly: 'Cada semana',
  fortnightly: 'Cada quince días',
  monthly: 'Una al mes',
  other: 'De otra forma',
}

export const VAT_REGIME_LABEL: Record<VatRegime, string> = {
  general: 'General',
  recargo_equivalencia: 'Recargo de equivalencia',
  intracomunitario: 'Intracomunitario',
  exento: 'Exento',
  inversion_sujeto_pasivo: 'Inversión del sujeto pasivo',
  extranjero: 'Extranjero',
}
