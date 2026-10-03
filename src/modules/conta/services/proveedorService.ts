// src/modules/conta/services/proveedorService.ts
//
// Todo lo que la ficha de proveedor (C01) lee y escribe. camelCase hacia la
// pantalla, snake_case hacia la base; las reglas viven en ../lib (puras).
//
// UNA SOLA FUENTE para el email y el teléfono: `supplier_contact`. Este
// servicio no lee ni escribe `supplier.email`, `phone` ni `address`, que
// quedan obsoletas desde la migración 20261002T0100 (deuda a borrar después).
//
// Los nombres de tabla, columna y RPC van entre comillas y `tsc` no los mira
// (regla 40 de CLAUDE.md). Comprobados contra staging-conta el 02/10/2026 con
// la estructura del C01 aplicada.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { rpcSinTipar } from '@/lib/rpcSinTipar'
import { tiposGastoOcultos } from '@/modules/conta/services/fichaTablasService'
import type {
  ContactRole, ContactoProveedor, EntityKind, FacturaParaCifras, FichaProveedor,
  PaymentMethod, TaxIdCheckStatus, TaxIdType, VatRegime,
} from '@/modules/conta/types'

type Fila = Record<string, unknown>

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

/** Tablas del C01 que aún no están en `database.ts`. Mismo desvío que supply. */
function from(tabla: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(tabla)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => !Number.isNaN(n)) : [])

// ═══════════════════════════════════════════════════════════════════════════
// La ficha
// ═══════════════════════════════════════════════════════════════════════════

export function filaAFicha(r: Fila): FichaProveedor {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    name: (r.name as string) ?? '',
    legalName: str(r.legal_name),
    taxId: str(r.tax_id),
    taxIdType: str(r.tax_id_type) as TaxIdType | null,
    countryCode: str(r.country_code) ?? 'ES',
    entityKind: str(r.entity_kind) as EntityKind | null,
    taxIdVerifiedAt: str(r.tax_id_verified_at),
    taxIdCheckStatus: str(r.tax_id_check_status) as TaxIdCheckStatus | null,
    taxIdCheckedAt: str(r.tax_id_checked_at),
    fiscalStreet: str(r.fiscal_street),
    fiscalPostalCode: str(r.fiscal_postal_code),
    fiscalCity: str(r.fiscal_city),
    fiscalProvince: str(r.fiscal_province),
    vatRegime: str(r.vat_regime) as VatRegime | null,
    usualVatRates: nums(r.usual_vat_rates),
    irpfWithholdingPct: num(r.irpf_withholding_pct),
    expenseCategoryId: str(r.expense_category_id),
    defaultLocationId: str(r.default_location_id),
    paymentMethod: str(r.payment_method) as PaymentMethod | null,
    paymentTermsDays: num(r.payment_terms_days),
    paymentFixedDays: nums(r.payment_fixed_days),
    iban: str(r.iban),
    ibanVerifiedAt: str(r.iban_verified_at),
    bankName: str(r.bank_name),
    ledgerAccountCode: str(r.ledger_account_code),
    healthRegistryNo: str(r.health_registry_no),
    isActive: r.is_active !== false,
    notes: str(r.notes),
    website: str(r.website),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    bic: str(r.bic),
    sepaMandateRef: str(r.sepa_mandate_ref),
    sepaMandateDate: str(r.sepa_mandate_date),
    currency: str(r.currency) ?? 'EUR',
    earlyPaymentDiscountPct: num(r.early_payment_discount_pct),
    ivaIncluidoEnLinea: r.iva_incluido_en_linea === true,
    archivedAt: str(r.archived_at),
    createdAt: str(r.created_at),
    createdByName: str(r.created_by_name),
  }
}

/** Qué columna escribe cada campo editable. Lo que no está aquí no se escribe. */
const COLUMNA: Partial<Record<keyof FichaProveedor, string>> = {
  name: 'name', legalName: 'legal_name', taxId: 'tax_id', taxIdType: 'tax_id_type',
  countryCode: 'country_code', entityKind: 'entity_kind', taxIdVerifiedAt: 'tax_id_verified_at',
  taxIdCheckStatus: 'tax_id_check_status', taxIdCheckedAt: 'tax_id_checked_at',
  fiscalStreet: 'fiscal_street', fiscalPostalCode: 'fiscal_postal_code', fiscalCity: 'fiscal_city',
  fiscalProvince: 'fiscal_province', vatRegime: 'vat_regime', usualVatRates: 'usual_vat_rates',
  irpfWithholdingPct: 'irpf_withholding_pct', expenseCategoryId: 'expense_category_id',
  defaultLocationId: 'default_location_id', paymentMethod: 'payment_method',
  paymentTermsDays: 'payment_terms_days', paymentFixedDays: 'payment_fixed_days', iban: 'iban',
  ibanVerifiedAt: 'iban_verified_at', bankName: 'bank_name', healthRegistryNo: 'health_registry_no',
  isActive: 'is_active', notes: 'notes', website: 'website', tags: 'tags', bic: 'bic',
  sepaMandateRef: 'sepa_mandate_ref', sepaMandateDate: 'sepa_mandate_date', currency: 'currency',
  earlyPaymentDiscountPct: 'early_payment_discount_pct', ivaIncluidoEnLinea: 'iva_incluido_en_linea',
  archivedAt: 'archived_at',
}

export function cambiosAFila(cambios: Partial<FichaProveedor>): Fila {
  const fila: Fila = {}
  for (const [campo, valor] of Object.entries(cambios)) {
    const col = COLUMNA[campo as keyof FichaProveedor]
    if (col) fila[col] = valor
  }
  return fila
}

export async function obtenerFicha(supplierId: string): Promise<FichaProveedor | null> {
  requireSupabase()
  const { data, error } = await from('supplier').select('*').eq('id', supplierId).maybeSingle()
  if (error) throw new Error(`No se pudo abrir el proveedor: ${error.message}`)
  return data ? filaAFicha(data as Fila) : null
}

export async function guardarFicha(supplierId: string, cambios: Partial<FichaProveedor>): Promise<FichaProveedor> {
  requireSupabase()
  const fila = cambiosAFila(cambios)
  if (Object.keys(fila).length === 0) {
    const f = await obtenerFicha(supplierId)
    if (!f) throw new Error('Ese proveedor ya no existe.')
    return f
  }
  const { data, error } = await from('supplier').update(fila).eq('id', supplierId).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('Ese NIF ya lo tiene otro proveedor de tu cuenta.')
    throw new Error(`No se pudo guardar: ${error.message}`)
  }
  return filaAFicha(data as Fila)
}

export interface ProveedorEnLista {
  id: string
  name: string
  legalName: string | null
  taxId: string | null
  isActive: boolean
}

/** Los proveedores activos de la cuenta (para la lista y el NIF repetido). */
export async function listarProveedores(accountId: string): Promise<FichaProveedor[]> {
  requireSupabase()
  const { data, error } = await from('supplier')
    .select('*')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`No se pudo cargar la lista de proveedores: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map(filaAFicha)
}

export interface NuevoProveedor {
  accountId: string
  name: string
  taxId: string | null
  taxIdType: TaxIdType | null
  /** El NIF ya ha pasado el algoritmo oficial: nace «NIF comprobado». */
  nifComprobado: boolean
  entityKind: EntityKind | null
  createdBy: string | null
  createdByName: string | null
}

export async function crearProveedor(n: NuevoProveedor): Promise<FichaProveedor> {
  requireSupabase()
  const { data, error } = await from('supplier')
    .insert({
      account_id: n.accountId,
      name: n.name.trim(),
      tax_id: n.taxId,
      tax_id_type: n.taxIdType,
      entity_kind: n.entityKind,
      ...(n.nifComprobado && n.taxId ? {
        tax_id_check_status: 'valid', tax_id_verified_at: new Date().toISOString(), tax_id_checked_at: new Date().toISOString(),
      } : {}),
      created_by: n.createdBy,
      created_by_name: n.createdByName,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Ese NIF ya lo tiene otro proveedor de tu cuenta.')
    throw new Error(`No se pudo crear el proveedor: ${error.message}`)
  }
  return filaAFicha(data as Fila)
}

// ═══════════════════════════════════════════════════════════════════════════
// Contactos
// ═══════════════════════════════════════════════════════════════════════════

function filaAContacto(r: Fila): ContactoProveedor {
  return {
    id: r.id as string,
    supplierId: r.supplier_id as string,
    name: (r.name as string) ?? '',
    role: (str(r.role) ?? 'other') as ContactRole,
    phone: str(r.phone),
    email: str(r.email),
    isPrimary: r.is_primary === true,
    notes: str(r.notes),
  }
}

export async function listarContactos(supplierId: string): Promise<ContactoProveedor[]> {
  requireSupabase()
  const { data, error } = await from('supplier_contact')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron cargar los contactos: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map(filaAContacto)
}

/** Contactos de TODA la cuenta, para el % de la lista sin una consulta por proveedor. */
export async function listarContactosDeLaCuenta(accountId: string): Promise<ContactoProveedor[]> {
  requireSupabase()
  const { data, error } = await from('supplier_contact').select('*').eq('account_id', accountId)
  if (error) throw new Error(`No se pudieron cargar los contactos: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map(filaAContacto)
}

export interface DatosContacto {
  name: string
  role: ContactRole
  phone: string | null
  email: string | null
  notes: string | null
}

export async function crearContacto(
  accountId: string, supplierId: string, d: DatosContacto,
  actor: { id: string | null; name: string | null },
  principal: boolean,
): Promise<ContactoProveedor> {
  requireSupabase()
  // Si va a ser el principal, primero se le quita a quien lo fuera: el índice
  // único admite UNO por proveedor y no se puede tener dos ni un instante.
  if (principal) await quitarPrincipal(supplierId)
  const { data, error } = await from('supplier_contact')
    .insert({
      account_id: accountId, supplier_id: supplierId, name: d.name.trim(), role: d.role,
      phone: d.phone, email: d.email, notes: d.notes, is_primary: principal,
      created_by: actor.id, created_by_name: actor.name,
    })
    .select('*')
    .single()
  if (error) throw new Error(`No se pudo guardar el contacto: ${error.message}`)
  return filaAContacto(data as Fila)
}

export async function actualizarContacto(id: string, d: DatosContacto): Promise<ContactoProveedor> {
  requireSupabase()
  const { data, error } = await from('supplier_contact')
    .update({ name: d.name.trim(), role: d.role, phone: d.phone, email: d.email, notes: d.notes })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`No se pudo guardar el contacto: ${error.message}`)
  return filaAContacto(data as Fila)
}

async function quitarPrincipal(supplierId: string): Promise<void> {
  const { error } = await from('supplier_contact')
    .update({ is_primary: false })
    .eq('supplier_id', supplierId)
    .eq('is_primary', true)
  if (error) throw new Error(`No se pudo cambiar el contacto principal: ${error.message}`)
}

export async function hacerPrincipal(supplierId: string, contactoId: string): Promise<void> {
  requireSupabase()
  await quitarPrincipal(supplierId)
  const { error } = await from('supplier_contact').update({ is_primary: true }).eq('id', contactoId)
  if (error) throw new Error(`No se pudo cambiar el contacto principal: ${error.message}`)
}

export async function borrarContacto(id: string): Promise<void> {
  requireSupabase()
  const { error } = await from('supplier_contact').delete().eq('id', id)
  if (error) throw new Error(`No se pudo borrar el contacto: ${error.message}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// Propuestas (datos leídos que esperan confirmación)
// ═══════════════════════════════════════════════════════════════════════════

export type CampoPropuesta = 'tax_id' | 'legal_name' | 'fiscal_address'

export interface Propuesta {
  id: string
  field: CampoPropuesta
  /** tax_id y legal_name: texto. fiscal_address: { line }. */
  value: unknown
  source: 'legacy_address' | 'supplier_invoice' | 'goods_receipt'
  sourceLabel: string | null
}

export async function listarPropuestas(supplierId: string): Promise<Propuesta[]> {
  requireSupabase()
  const { data, error } = await from('supplier_proposal')
    .select('id, field, value, source, source_label')
    .eq('supplier_id', supplierId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron cargar las propuestas: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map((r) => ({
    id: r.id as string,
    field: r.field as CampoPropuesta,
    value: r.value,
    source: r.source as Propuesta['source'],
    sourceLabel: str(r.source_label),
  }))
}

/** Busca en las lecturas automáticas datos que la ficha no tenga. Nunca escribe en la ficha. */
export async function refrescarPropuestas(supplierId: string): Promise<number> {
  return rpcSinTipar<number>('refresh_supplier_proposals', { p_supplier_id: supplierId })
}

/**
 * Decide una propuesta. Al CONFIRMAR, lo que se escribe en la ficha es lo que
 * la persona ha visto y quizá corregido (`cambios`), no el valor leído.
 */
export async function decidirPropuesta(
  supplierId: string, propuestaId: string, decision: 'confirmed' | 'rejected',
  cambios: Partial<FichaProveedor>, actor: { id: string | null; name: string | null },
): Promise<void> {
  requireSupabase()
  if (decision === 'confirmed' && Object.keys(cambios).length > 0) {
    await guardarFicha(supplierId, cambios)
  }
  const { error } = await from('supplier_proposal')
    .update({ status: decision, decided_at: new Date().toISOString(), decided_by: actor.id, decided_by_name: actor.name })
    .eq('id', propuestaId)
  if (error) throw new Error(`No se pudo apuntar la decisión: ${error.message}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// Catálogos: tipos de gasto y locales
// ═══════════════════════════════════════════════════════════════════════════

export interface TipoGasto {
  id: string
  code: string
  name: string
  pgcAccountHint: string
  oculto: boolean
}

/**
 * El catálogo global, con la marca de los que esta cuenta ha ocultado.
 *
 * Desde el C00 el nombre de cada tipo es el título oficial de su cuenta
 * («Compras de mercaderías») y lo coloquial de antes («Comida y bebida») está
 * en `example`. La ficha del C01 no cambia de aspecto hasta la tarea 7: sigue
 * enseñando lo coloquial, y solo las filas de serie (las propias de cada
 * empresa llegan con esa tarea).
 */
/** Los tipos de gasto de serie, con si la empresa los ha ocultado (general_row_setting, C00). */
export async function listarTiposGasto(accountId: string, companyId: string | null): Promise<TipoGasto[]> {
  requireSupabase()
  const { data, error } = await from('expense_category').select('id, code, name, example, pgc_account_hint')
    .eq('is_active', true).eq('is_system', true).order('sort_order')
  if (error) throw new Error(`No se pudieron cargar los tipos de gasto: ${error.message}`)
  const filas = (data as Fila[] | null) ?? []
  const ocultos = await tiposGastoOcultos(accountId, companyId)
  return filas.map((r) => ({
    id: r.id as string, code: r.code as string, name: ((r.example as string | null) ?? r.name) as string,
    pgcAccountHint: r.pgc_account_hint as string, oculto: ocultos.has(r.id as string),
  }))
}

export interface Local { id: string; name: string }

export async function listarLocales(accountId: string): Promise<Local[]> {
  requireSupabase()
  const { data, error } = await from('locations')
    .select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  if (error) throw new Error(`No se pudieron cargar los locales: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map((r) => ({ id: r.id as string, name: r.name as string }))
}

// ═══════════════════════════════════════════════════════════════════════════
// Facturas, pagos y vencimientos
// ═══════════════════════════════════════════════════════════════════════════

export interface FacturaDeProveedor extends FacturaParaCifras {
  code: string | null
  paidMethod: PaymentMethod | null
  paidByName: string | null
}

/** Facturas del proveedor, sin las anuladas, de la más reciente a la más antigua. */
export async function listarFacturas(accountId: string, supplierId: string): Promise<FacturaDeProveedor[]> {
  requireSupabase()
  const { data, error } = await from('supplier_invoice')
    .select('id, code, status, invoice_number, invoice_date, grand_total, due_date, paid_at, paid_method, paid_by_name')
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .neq('status', 'anulada')
    .order('invoice_date', { ascending: false, nullsFirst: false })
  if (error) throw new Error(`No se pudieron cargar sus facturas: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map((r) => ({
    id: r.id as string,
    code: str(r.code),
    status: r.status as string,
    invoiceNumber: str(r.invoice_number),
    invoiceDate: str(r.invoice_date),
    grandTotal: num(r.grand_total),
    dueDate: str(r.due_date),
    paidAt: str(r.paid_at),
    paidMethod: str(r.paid_method) as PaymentMethod | null,
    paidByName: str(r.paid_by_name),
  }))
}

/** Facturas de toda la cuenta, para el «le debes» de la lista sin N consultas. */
export async function listarFacturasDeLaCuenta(accountId: string): Promise<(FacturaParaCifras & { supplierId: string | null })[]> {
  requireSupabase()
  const { data, error } = await from('supplier_invoice')
    .select('id, supplier_id, status, invoice_number, invoice_date, grand_total, due_date, paid_at')
    .eq('account_id', accountId)
    .in('status', ['aprobada', 'pagada'])
  if (error) throw new Error(`No se pudieron cargar las facturas: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map((r) => ({
    id: r.id as string,
    supplierId: str(r.supplier_id),
    status: r.status as string,
    invoiceNumber: str(r.invoice_number),
    invoiceDate: str(r.invoice_date),
    grandTotal: num(r.grand_total),
    dueDate: str(r.due_date),
    paidAt: str(r.paid_at),
  }))
}

export async function marcarPagada(invoiceId: string, fecha: string, forma: PaymentMethod | null): Promise<void> {
  await rpcSinTipar<null>('mark_supplier_invoice_paid', { p_invoice_id: invoiceId, p_paid_at: fecha, p_method: forma })
}

export async function deshacerPago(invoiceId: string): Promise<void> {
  await rpcSinTipar<null>('unmark_supplier_invoice_paid', { p_invoice_id: invoiceId })
}

export async function cambiarVencimiento(invoiceId: string, fecha: string | null): Promise<void> {
  await rpcSinTipar<null>('set_supplier_invoice_due_date', { p_invoice_id: invoiceId, p_due_date: fecha })
}

// ═══════════════════════════════════════════════════════════════════════════
// Documentos (compliance_document, la tabla que ya existía)
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentoProveedor {
  id: string
  docFamily: string
  title: string
  expiresAt: string | null
  status: string
  createdAt: string
}

export async function listarDocumentos(accountId: string, supplierId: string): Promise<DocumentoProveedor[]> {
  requireSupabase()
  const { data, error } = await from('compliance_document')
    .select('id, doc_family, title, expires_at, status, created_at')
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar sus documentos: ${error.message}`)
  return ((data as Fila[] | null) ?? []).map((r) => ({
    id: r.id as string, docFamily: r.doc_family as string, title: r.title as string,
    expiresAt: str(r.expires_at), status: r.status as string, createdAt: r.created_at as string,
  }))
}

/** ¿Tiene un certificado de titularidad bancaria vigente? (no sustituido) */
export function tieneCertificadoBanco(docs: DocumentoProveedor[]): boolean {
  return docs.some((d) => d.docFamily === 'bank_ownership_certificate' && d.status !== 'superseded' && d.status !== 'expired')
}

/** Proveedores de la cuenta con certificado del banco, para el % de la lista. */
export async function proveedoresConCertificadoBanco(accountId: string): Promise<Set<string>> {
  requireSupabase()
  const { data, error } = await from('compliance_document')
    .select('supplier_id, status')
    .eq('account_id', accountId)
    .eq('doc_family', 'bank_ownership_certificate')
  if (error) throw new Error(`No se pudieron cargar los documentos: ${error.message}`)
  return new Set(((data as Fila[] | null) ?? [])
    .filter((r) => r.status !== 'superseded' && r.status !== 'expired' && r.supplier_id)
    .map((r) => r.supplier_id as string))
}

// ═══════════════════════════════════════════════════════════════════════════
// Historial
// ═══════════════════════════════════════════════════════════════════════════

export interface Suceso {
  cuando: string
  quien: string | null
  que: string
}

/**
 * Lo que ha pasado con este proveedor, de lo más nuevo a lo más viejo: el
 * alta, los contactos, los datos confirmados o descartados y los pagos.
 * Cada pieza sale de la tabla que la guarda; no hay una tabla de historial.
 */
export async function listarHistorial(
  accountId: string, ficha: FichaProveedor, facturas: FacturaDeProveedor[],
): Promise<Suceso[]> {
  requireSupabase()
  const ids = facturas.map((f) => f.id)
  const [contactos, propuestas, pagos] = await Promise.all([
    from('supplier_contact').select('name, role, created_at, created_by_name').eq('supplier_id', ficha.id),
    from('supplier_proposal').select('field, status, decided_at, decided_by_name')
      .eq('supplier_id', ficha.id).neq('status', 'pending'),
    ids.length > 0
      ? from('supplier_invoice_payment_log')
          .select('invoice_id, action, paid_at, due_date, actor_name, created_at')
          .eq('account_id', accountId).in('invoice_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [contactos, propuestas, pagos]) {
    if (r.error) throw new Error(`No se pudo cargar el historial: ${r.error.message}`)
  }
  const num_ = new Map(facturas.map((f) => [f.id, f.invoiceNumber ?? f.code ?? 'sin número']))
  const CAMPO: Record<string, string> = { tax_id: 'el NIF', legal_name: 'la razón social', fiscal_address: 'la dirección fiscal' }
  const sucesos: Suceso[] = []
  if (ficha.createdAt) sucesos.push({ cuando: ficha.createdAt, quien: ficha.createdByName, que: 'Dio de alta al proveedor' })
  for (const c of (contactos.data as Fila[] | null) ?? []) {
    sucesos.push({ cuando: c.created_at as string, quien: str(c.created_by_name), que: `Añadió el contacto ${c.name as string}` })
  }
  for (const p of (propuestas.data as Fila[] | null) ?? []) {
    if (!p.decided_at) continue
    const verbo = p.status === 'confirmed' ? 'Confirmó' : 'Descartó'
    sucesos.push({ cuando: p.decided_at as string, quien: str(p.decided_by_name), que: `${verbo} ${CAMPO[p.field as string] ?? 'un dato'} propuesto` })
  }
  for (const l of (pagos.data as Fila[] | null) ?? []) {
    const n = num_.get(l.invoice_id as string) ?? ''
    const que = l.action === 'paid' ? `Marcó pagada la factura ${n}`
      : l.action === 'unpaid' ? `Deshizo el pago de la factura ${n}`
      : `Cambió el vencimiento de la factura ${n}`
    sucesos.push({ cuando: l.created_at as string, quien: str(l.actor_name), que })
  }
  return sucesos.sort((a, b) => b.cuando.localeCompare(a.cuando))
}

// ═══════════════════════════════════════════════════════════════════════════
// Interruptor del módulo de contabilidad
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ¿Tiene la cuenta activo el módulo de contabilidad? Se pregunta por la cuenta
 * ACTIVA (la del selector), no por la del perfil: un usuario con dos cuentas
 * vería la de la otra. Sin fila = no.
 */
export async function contaActiva(accountId: string): Promise<boolean> {
  requireSupabase()
  const { data, error } = await from('feature_flags')
    .select('enabled, expires_at')
    .eq('account_id', accountId)
    .eq('feature_key', 'conta')
    .maybeSingle()
  if (error) return false
  const fila = data as Fila | null
  if (!fila || fila.enabled !== true) return false
  const caduca = str(fila.expires_at)
  return !caduca || new Date(caduca).getTime() > Date.now()
}

// ═══════════════════════════════════════════════════════════════════════════
// Comprobación del NIF-IVA europeo (VIES), siempre en el servidor
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoVies {
  estado: TaxIdCheckStatus
  nombre: string | null
  direccion: string | null
}

/**
 * Pide a la edge function `conta-vies-check` que compruebe el NIF-IVA en VIES.
 * Nunca desde el navegador (§5.3). Si VIES no contesta, la función guarda
 * 'pending' y devuelve eso: la ficha dice «Comprobando con la UE…» y no
 * bloquea nada.
 */
export async function comprobarVies(supplierId: string): Promise<ResultadoVies> {
  requireSupabase()
  const { data, error } = await supabase!.functions.invoke('conta-vies-check', { body: { supplier_id: supplierId } })
  if (error) return { estado: 'pending', nombre: null, direccion: null }
  const r = (data ?? {}) as Fila
  return {
    estado: (str(r.status) ?? 'pending') as TaxIdCheckStatus,
    nombre: str(r.name),
    direccion: str(r.address),
  }
}

