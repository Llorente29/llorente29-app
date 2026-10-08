// src/modules/conta/services/tercerosService.ts
//
// C03 · Lo que leen y escriben la lista «Clientes y proveedores» y la ficha
// del tercero. Lecturas con la RLS del usuario (todas filtran por la cuenta:
// regla 9); escrituras por las funciones de la 0140, que comprueban quién
// llama y devuelven lo que ha pasado para que la pantalla lo diga.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Papel, Tercero } from '@/modules/conta/lib/terceros'
import type { LiquidacionPlataforma } from '@/modules/conta/lib/liquidaciones'
import type { FilaLiquidacion } from '@/modules/conta/lib/lectorLiquidaciones'
import type { ModeloPlataforma } from '@/modules/conta/lib/plataforma347'

type Fila = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

async function leer<T = Fila>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as T[]
}

// ── La lista ────────────────────────────────────────────────────────────────

export interface TerceroLista extends Tercero {
  supplierId: string | null
  /** Te debe (lo que la plataforma aún no ha pagado; lo que la liquidación del socio sale a tu favor). */
  teDebe: number
  /** Le debes (facturas de proveedor aprobadas sin pagar; liquidación del socio a su favor sin saldar). */
  leDebes: number
  ultima: { fecha: string; texto: string } | null
}

export interface PapelGuardado {
  role: Papel
  supplierId: string | null
  channelId: string | null
  settlementEvery: 'weekly' | 'fortnightly' | 'monthly' | null
  commissionPct: number | null
  contributionKinds: string[] | null
  /** Plataforma: cómo vende según su contrato (C03 R2). null = sin decir. */
  platformModel: ModeloPlataforma | null
}

export async function listarTercerosBase(accountId: string): Promise<{ terceros: (Tercero & { supplierId: string | null })[]; papeles: Map<string, PapelGuardado[]> }> {
  const [parties, roles] = await Promise.all([
    leer(tabla('party').select('id, name, tax_id, archived_at, archived_note').eq('account_id', accountId).order('name'), 'los terceros'),
    leer(tabla('party_role').select('party_id, role, supplier_id, channel_id, settlement_every, commission_pct, contribution_kinds, platform_model').eq('account_id', accountId), 'sus papeles'),
  ])
  const papeles = new Map<string, PapelGuardado[]>()
  for (const r of roles) {
    const k = String(r.party_id)
    papeles.set(k, [...(papeles.get(k) ?? []), {
      role: r.role as Papel, supplierId: str(r.supplier_id), channelId: str(r.channel_id),
      settlementEvery: str(r.settlement_every) as PapelGuardado['settlementEvery'], commissionPct: num(r.commission_pct),
      contributionKinds: (r.contribution_kinds as string[] | null) ?? null,
      platformModel: str(r.platform_model) as ModeloPlataforma | null,
    }])
  }
  const terceros = parties.map((p) => {
    const ps = papeles.get(String(p.id)) ?? []
    return {
      id: String(p.id), nombre: String(p.name), nif: str(p.tax_id), archivadoEn: str(p.archived_at), notaArchivado: str(p.archived_note),
      papeles: ps.map((x) => x.role), supplierId: ps.find((x) => x.role === 'supplier')?.supplierId ?? null,
    }
  })
  return { terceros, papeles }
}

// ── Liquidaciones de plataforma ─────────────────────────────────────────────

const COSTES = ['delivery_transport', 'promo_product', 'promo_flash', 'offer_flash_credit', 'access_fee', 'prime_fee',
  'recurring_fee', 'incidents_cost', 'incidents_refund', 'min_order_fee', 'other_cost'] as const

export function filaALiquidacion(r: Fila): LiquidacionPlataforma & { partyId: string | null; source: string } {
  return {
    id: String(r.id), ref: str(r.settlement_ref), desde: str(r.period_from), hasta: str(r.period_to),
    propuestoDesde: str(r.proposed_period_from), propuestoHasta: str(r.proposed_period_to),
    fecha: str(r.settlement_date), pedidos: num(r.orders_count), ventas: num(r.gross_sales), comision: num(r.commission),
    otros: COSTES.map((k) => num(r[k]) ?? 0).filter((x) => x !== 0), neto: num(r.net_payout),
    cobradoEn: str(r.collected_on), cobrado: num(r.collected_amount),
    paraRevisar: r.needs_review === true, motivoRevisar: str(r.review_note),
    partyId: str(r.party_id), source: String(r.source ?? ''),
  }
}

const COLUMNAS_LIQ = `id, party_id, source, settlement_ref, period_from, period_to, proposed_period_from, proposed_period_to, proposed_period_note,
  settlement_date, orders_count, gross_sales, commission, ${COSTES.join(', ')}, net_payout, collected_on, collected_amount,
  needs_review, review_note, location_id`

export async function liquidacionesDeLaCuenta(accountId: string): Promise<ReturnType<typeof filaALiquidacion>[]> {
  const filas = await leer(tabla('channel_settlement').select(COLUMNAS_LIQ).eq('account_id', accountId).not('party_id', 'is', null)
    .order('settlement_date', { ascending: false }), 'las liquidaciones')
  return filas.map(filaALiquidacion)
}

export async function liquidacionesDe(accountId: string, partyId: string): Promise<(ReturnType<typeof filaALiquidacion> & { notaPeriodo: string | null })[]> {
  const filas = await leer(tabla('channel_settlement').select(COLUMNAS_LIQ).eq('account_id', accountId).eq('party_id', partyId)
    .order('settlement_date', { ascending: false, nullsFirst: false }), 'sus liquidaciones')
  return filas.map((r) => ({ ...filaALiquidacion(r), notaPeriodo: str(r.proposed_period_note) }))
}

// ── Liquidaciones del socio ─────────────────────────────────────────────────

export interface LiquidacionSocioGuardada {
  id: string
  localId: string | null
  desde: string
  hasta: string
  formula: 'anterior' | 'compras_aportaciones_comision'
  estado: 'borrador' | 'confirmada' | 'saldada' | null
  compras: number | null
  aportaciones: number | null
  baseVentas: number | null
  comisionPct: number | null
  comision: number | null
  importe: number | null
  /** La de antes («fórmula anterior»): lo que traía. */
  netoAnterior: number | null
  confirmadaPor: string | null
  partyId: string | null
}

export async function liquidacionesSocioDe(accountId: string, partyId: string | null): Promise<LiquidacionSocioGuardada[]> {
  let q = tabla('licensed_settlement').select('id, location_id, period_from, period_to, formula, status, purchases_amount, contributions_amount, brand_sales_base, commission_pct, commission_amount, amount, net_settlement, confirmed_by_name, party_id')
    .eq('account_id', accountId)
  q = partyId ? q.eq('party_id', partyId) : q.not('party_id', 'is', null)
  const filas = await leer(q.order('period_from', { ascending: false }), 'las liquidaciones del socio')
  return filas.map((r) => ({
    id: String(r.id), localId: str(r.location_id), desde: String(r.period_from), hasta: String(r.period_to),
    formula: r.formula as LiquidacionSocioGuardada['formula'], estado: str(r.status) as LiquidacionSocioGuardada['estado'],
    compras: num(r.purchases_amount), aportaciones: num(r.contributions_amount), baseVentas: num(r.brand_sales_base),
    comisionPct: num(r.commission_pct), comision: num(r.commission_amount), importe: num(r.amount), netoAnterior: num(r.net_settlement),
    confirmadaPor: str(r.confirmed_by_name), partyId: str(r.party_id),
  }))
}

/** Lo que devuelve brand_partner_settlement_compute / _prepare / _confirm. */
export interface CalculoSocio {
  id?: string
  estado?: string
  location_id: string
  desde: string
  hasta: string
  compras: number
  albaranes: number
  aportaciones: number
  aportaciones_n: number
  base_ventas: number
  ventas: number
  comision_pct: number
  comision: number
  marcas: { brand_id: string; marca: string; pct: number; ventas: number; base: number; comision: number }[]
  importe: number
  faltan: { fuente: string; texto: string }[]
}

const numerico = (c: CalculoSocio): CalculoSocio => ({
  ...c, compras: Number(c.compras), aportaciones: Number(c.aportaciones), base_ventas: Number(c.base_ventas), comision_pct: Number(c.comision_pct),
  comision: Number(c.comision), importe: Number(c.importe),
  marcas: (c.marcas ?? []).map((m) => ({ ...m, pct: Number(m.pct), base: Number(m.base), comision: Number(m.comision) })),
})

export const calcularLiquidacionSocio = async (partyId: string, localId: string, desde: string, hasta: string) =>
  numerico(await rpc<CalculoSocio>('brand_partner_settlement_compute', { p_party: partyId, p_location: localId, p_desde: desde, p_hasta: hasta }))
export const prepararLiquidacionSocio = async (partyId: string, localId: string, desde: string, hasta: string, quien: string | null) =>
  numerico(await rpc<CalculoSocio>('brand_partner_settlement_prepare', { p_party: partyId, p_location: localId, p_desde: desde, p_hasta: hasta, p_quien_nombre: quien }))
export const confirmarLiquidacionSocio = async (id: string, importeVisto: number, quien: string | null) =>
  numerico(await rpc<CalculoSocio>('brand_partner_settlement_confirm', { p_id: id, p_importe_visto: importeVisto, p_quien_nombre: quien }))

// ── La ficha ────────────────────────────────────────────────────────────────

export interface DatosFiscalesCliente {
  legalName: string | null
  taxIdType: 'nif_es' | 'vat_eu' | 'foreign' | null
  countryCode: string
  entityKind: 'company' | 'self_employed' | 'person' | null
  taxIdCheckStatus: 'valid' | 'invalid' | 'pending' | null
  taxIdVerifiedAt: string | null
  fiscalStreet: string | null
  fiscalPostalCode: string | null
  fiscalCity: string | null
  fiscalProvince: string | null
  equivalenceSurcharge: boolean
  withholdingRateId: string | null
  operationScope: 'domestic' | 'eu' | 'export'
  exclude347: boolean
  exclude347Reason: string | null
  paymentMethod: 'transfer' | 'direct_debit' | 'card' | 'cash' | null
  paymentTermsDays: number | null
  paymentFixedDays: number[] | null
  collectionTreasuryId: string | null
  iban: string | null
  sepaMandateRef: string | null
  sepaMandateDate: string | null
}

export function filaAFiscal(r: Fila | null): DatosFiscalesCliente | null {
  if (!r) return null
  return {
    legalName: str(r.legal_name), taxIdType: str(r.tax_id_type) as DatosFiscalesCliente['taxIdType'], countryCode: str(r.country_code) ?? 'ES',
    entityKind: str(r.entity_kind) as DatosFiscalesCliente['entityKind'], taxIdCheckStatus: str(r.tax_id_check_status) as DatosFiscalesCliente['taxIdCheckStatus'],
    taxIdVerifiedAt: str(r.tax_id_verified_at), fiscalStreet: str(r.fiscal_street), fiscalPostalCode: str(r.fiscal_postal_code),
    fiscalCity: str(r.fiscal_city), fiscalProvince: str(r.fiscal_province), equivalenceSurcharge: r.equivalence_surcharge === true,
    withholdingRateId: str(r.withholding_rate_id), operationScope: (str(r.operation_scope) ?? 'domestic') as DatosFiscalesCliente['operationScope'],
    exclude347: r.exclude_347 === true, exclude347Reason: str(r.exclude_347_reason),
    paymentMethod: str(r.payment_method) as DatosFiscalesCliente['paymentMethod'], paymentTermsDays: num(r.payment_terms_days),
    paymentFixedDays: (r.payment_fixed_days as number[] | null) ?? null, collectionTreasuryId: str(r.collection_treasury_id),
    iban: str(r.iban), sepaMandateRef: str(r.sepa_mandate_ref), sepaMandateDate: str(r.sepa_mandate_date),
  }
}

export interface CuentaDeTercero { id: string; code: string; name: string; papel: 'cliente' | 'proveedor' | 'pago' | 'liquidacion'; templateCode: string }

export interface FichaTercero {
  tercero: Tercero & { supplierId: string | null }
  papeles: PapelGuardado[]
  fiscal: DatosFiscalesCliente | null
  proveedor: { id: string; name: string; legalName: string | null; taxIdCheckStatus: string | null } | null
  contactos: { id: string; name: string; role: string; phone: string | null; email: string | null; isPrimary: boolean }[]
  liquidaciones: Awaited<ReturnType<typeof liquidacionesDe>>
  liquidacionesSocio: LiquidacionSocioGuardada[]
  acuerdos: { id: string; brandId: string; marca: string; pct: number; desde: string | null; hasta: string | null }[]
  aportaciones: { id: string; localId: string; fecha: string; tipo: string; importe: number; nota: string | null }[]
  locales: { id: string; name: string }[]
  bancos: { id: string; name: string; iban: string | null }[]
  canales: { id: string; name: string }[]
  retenciones: { id: string; name: string; rate: number }[]
  cuentas: CuentaDeTercero[]
  /** Las 430 de la empresa sin dueño: para proponer cuál es la suya (traídas de Diez). */
  cuentas430SinDueno: { id: string; code: string; name: string; traida: boolean }[]
  planActivo: boolean
}

export async function cargarFichaTercero(accountId: string, companyId: string | null, partyId: string): Promise<FichaTercero | null> {
  const { terceros, papeles } = await listarTercerosBase(accountId)
  const t = terceros.find((x) => x.id === partyId)
  if (!t) return null
  const ps = papeles.get(partyId) ?? []
  const supplierId = t.supplierId
  const [fiscal, prov, contactos, liqs, liqsSocio, acuerdos, aportaciones, locales, bancos, canales, retenciones, cuentas] = await Promise.all([
    leer(tabla('customer_fiscal').select('*').eq('account_id', accountId).eq('party_id', partyId), 'sus datos fiscales'),
    supplierId ? leer(tabla('supplier').select('id, name, legal_name, tax_id_check_status').eq('account_id', accountId).eq('id', supplierId), 'su ficha de proveedor') : Promise.resolve([]),
    supplierId ? leer(tabla('supplier_contact').select('id, name, role, phone, email, is_primary').eq('account_id', accountId).eq('supplier_id', supplierId).order('is_primary', { ascending: false }), 'sus contactos') : Promise.resolve([]),
    liquidacionesDe(accountId, partyId),
    liquidacionesSocioDe(accountId, partyId),
    leer(tabla('brand_licensing_agreement').select('id, brand_id, revenue_share_pct, starts_on, ends_on, brand(name)').eq('account_id', accountId).eq('party_id', partyId), 'sus marcas'),
    leer(tabla('brand_partner_contribution').select('id, location_id, contributed_on, kind, amount, note').eq('account_id', accountId).eq('party_id', partyId).order('contributed_on', { ascending: false }), 'sus aportaciones'),
    leer(tabla('locations').select('id, name').eq('account_id', accountId).order('name'), 'los locales'),
    companyId ? leer(tabla('treasury_account').select('id, name, iban').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true).order('name'), 'los bancos') : Promise.resolve([]),
    leer(tabla('sales_channel').select('id, name').eq('account_id', accountId).order('name'), 'los canales de venta'),
    leer(tabla('withholding_rate').select('id, name, rate').or(`is_system.eq.true,account_id.eq.${accountId}`).order('rate'), 'las retenciones'),
    companyId ? cuentasDeTercero(accountId, companyId, partyId, supplierId) : Promise.resolve({ suyas: [], sinDueno: [], activo: false }),
  ])
  return {
    tercero: t, papeles: ps, fiscal: filaAFiscal(fiscal[0] ?? null),
    proveedor: prov[0] ? { id: String(prov[0].id), name: String(prov[0].name), legalName: str(prov[0].legal_name), taxIdCheckStatus: str(prov[0].tax_id_check_status) } : null,
    contactos: contactos.map((c) => ({ id: String(c.id), name: String(c.name), role: String(c.role), phone: str(c.phone), email: str(c.email), isPrimary: c.is_primary === true })),
    liquidaciones: liqs, liquidacionesSocio: liqsSocio,
    acuerdos: acuerdos.map((a) => ({ id: String(a.id), brandId: String(a.brand_id), marca: str((a.brand as Fila | null)?.name) ?? 'Marca', pct: Number(a.revenue_share_pct), desde: str(a.starts_on), hasta: str(a.ends_on) })),
    aportaciones: aportaciones.map((a) => ({ id: String(a.id), localId: String(a.location_id), fecha: String(a.contributed_on), tipo: String(a.kind), importe: Number(a.amount), nota: str(a.note) })),
    locales: locales.map((l) => ({ id: String(l.id), name: String(l.name) })),
    bancos: bancos.map((b) => ({ id: String(b.id), name: String(b.name), iban: str(b.iban) })),
    canales: canales.map((c) => ({ id: String(c.id), name: String(c.name) })),
    retenciones: retenciones.map((r) => ({ id: String(r.id), name: String(r.name), rate: Number(r.rate) })),
    cuentas: cuentas.suyas, cuentas430SinDueno: cuentas.sinDueno, planActivo: cuentas.activo,
  }
}

/** Sus cuentas: como cliente (entity customer), como proveedor (su supplier) y la de pago (una 43 para compensar). */
async function cuentasDeTercero(accountId: string, companyId: string, partyId: string, supplierId: string | null) {
  const [cuentas, enlaces] = await Promise.all([
    leer(tabla('company_account').select('id, code, name, template_code, source, status').eq('account_id', accountId).eq('company_id', companyId).order('code'), 'las cuentas'),
    leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
  ])
  const porId = new Map(cuentas.map((c) => [String(c.id), c]))
  const suyas: CuentaDeTercero[] = []
  for (const l of enlaces) {
    const c = porId.get(String(l.company_account_id))
    if (!c) continue
    const base = { id: String(c.id), code: String(c.code), name: String(c.name), templateCode: String(c.template_code) }
    if (l.entity === 'customer' && l.entity_id === partyId && l.role === 'principal') suyas.push({ ...base, papel: 'cliente' })
    else if (l.entity === 'customer' && l.entity_id === partyId && l.role === 'liquidacion') suyas.push({ ...base, papel: 'liquidacion' })
    else if (supplierId && l.entity === 'supplier' && l.entity_id === supplierId && l.role === 'principal') suyas.push({ ...base, papel: 'proveedor' })
    else if (supplierId && l.entity === 'supplier' && l.entity_id === supplierId && l.role === 'pago' && String(c.template_code).startsWith('43')) suyas.push({ ...base, papel: 'pago' })
  }
  const conDueno = new Set(enlaces.filter((l) => ['customer', 'supplier'].includes(String(l.entity)) && ['principal', 'pago'].includes(String(l.role))).map((l) => String(l.company_account_id)))
  const sinDueno = cuentas
    .filter((c) => String(c.template_code).startsWith('430') && c.source !== 'serie' && !conDueno.has(String(c.id)) && c.status === 'activa')
    .map((c) => ({ id: String(c.id), code: String(c.code), name: String(c.name), traida: c.source === 'migrated' }))
  return { suyas, sinDueno, activo: cuentas.length > 0 }
}

// ── Escrituras ──────────────────────────────────────────────────────────────

/** Alta o edición de un cliente. Si el NIF ya es de otro tercero, la base para con MISMO_NIF <id>. */
export async function guardarCliente(accountId: string, partyId: string | null, nombre: string, nif: string | null, datos: Partial<DatosFiscalesCliente>, quien: string | null): Promise<{ party_id: string; nuevo: boolean }> {
  return rpc('party_save_customer', { p_account: accountId, p_party: partyId, p_nombre: nombre, p_nif: nif, p_datos: datos, p_quien_nombre: quien })
}

/** El id del tercero que ya tiene ese NIF, si la base ha parado por eso. */
export function terceroDelMismoNif(e: unknown): string | null {
  const m = e instanceof Error ? e.message.match(/MISMO_NIF ([0-9a-f-]{36})/) : null
  return m ? m[1] : null
}

export const anadirPapel = (partyId: string, papel: 'customer' | 'platform' | 'brand_partner', config: Record<string, unknown> = {}) =>
  rpc<{ party_id: string; role: string; liquidaciones_enlazadas: number }>('party_add_role', { p_party: partyId, p_role: papel, p_config: config })

/** Cómo vende la plataforma (comisionista o revendedor), o null para dejarlo sin decir. */
export async function guardarModeloPlataforma(partyId: string, modelo: ModeloPlataforma | null): Promise<void> {
  const { data, error } = await tabla('party_role').update({ platform_model: modelo }).eq('party_id', partyId).eq('role', 'platform').select('party_id')
  if (error) throw new Error(mensaje('No se ha podido guardar cómo vende la plataforma', error))
  if (!data?.length) throw new Error('Este tercero no tiene el papel de plataforma.')
}

export const archivarTercero = (partyId: string, archivar: boolean, nota?: string | null) =>
  rpc<{ party_id: string; archivado: boolean }>('party_set_archived', { p_party: partyId, p_archivar: archivar, p_nota: nota ?? null })

// ── C04 R4 · Fusionar dos terceros (con rastro y deshacer) ──────────────────
export interface Fusion { id: string; quedaId: string; seVaId: string; resumen: string; cuando: string; quien: string | null }

/** Funde «seVa» en «queda»: lo que se puede mover pasa a la que queda; lo que choca se queda en la otra, archivada. */
export const fusionarTerceros = (quedaId: string, seVaId: string, quien: string | null) =>
  rpc<{ fusion: string; resumen: string; movidos: number }>('party_merge_do', { p_queda: quedaId, p_se_va: seVaId, p_quien_nombre: quien })

export const deshacerFusion = (id: string, quien: string | null) =>
  rpc<{ fusion: string; deshecha: boolean }>('party_merge_undo', { p_merge: id, p_quien_nombre: quien })

/** Las fusiones vivas (sin deshacer) en las que está este tercero, como el que queda o el que se fue. */
export async function fusionesDe(accountId: string, partyId: string): Promise<Fusion[]> {
  const filas = await leer(tabla('party_merge').select('id, kept_party_id, gone_party_id, summary, done_at, done_by_name')
    .eq('account_id', accountId).is('undone_at', null).or(`kept_party_id.eq.${partyId},gone_party_id.eq.${partyId}`).order('done_at', { ascending: false }), 'las fusiones')
  return filas.map((f) => ({ id: String(f.id), quedaId: String(f.kept_party_id), seVaId: String(f.gone_party_id), resumen: String(f.summary), cuando: String(f.done_at), quien: f.done_by_name ? String(f.done_by_name) : null }))
}

export const apuntarCobro = (id: string, fecha: string, importe: number, nota: string | null, quien: string | null) =>
  rpc<{ id: string; neto: number | null; cobrado: number; diferencia: number | null }>('channel_settlement_collect', { p_id: id, p_fecha: fecha, p_importe: importe, p_nota: nota, p_quien_nombre: quien })

export const quitarCobro = (id: string) => rpc<void>('channel_settlement_uncollect', { p_id: id })

export const confirmarPeriodo = (id: string) => rpc<{ id: string; desde: string; hasta: string }>('channel_settlement_confirm_period', { p_id: id })

export const enlazarAcuerdo = (acuerdoId: string, partyId: string) => rpc<void>('brand_licensing_agreement_set_party', { p_agreement: acuerdoId, p_party: partyId })

/**
 * Respuesta 3, punto 4. La subcuenta de lo que la empresa cobra POR CUENTA del
 * socio (sus ventas de una marca cedida): «Liquidación pendiente con <socio>»,
 * bajo la 410, enlazada con el papel «liquidacion». No es su 400 (lo que le
 * compras) ni su 430 (lo que le facturas). Se crea al confirmar el papel de
 * socio; si ya la tiene, no hace nada. Sin plan activado, no hay dónde: null.
 * La 419 se descartó: es de cuentas en participación (CCom 239) y aquí no se
 * comparten resultados (docs/conta/contraste.md).
 */
export async function asegurarCuentaLiquidacion(companyId: string, partyId: string, nombre: string, quien: string | null): Promise<{ code: string; nueva: boolean } | null> {
  const ya = await leer(tabla('company_account_link').select('company_account(code)').eq('company_id', companyId)
    .eq('entity', 'customer').eq('entity_id', partyId).eq('role', 'liquidacion'), 'su cuenta de liquidación')
  const code = (ya[0]?.company_account as { code?: string } | null)?.code
  if (code) return { code, nueva: false }
  const plan = await leer(tabla('company_account').select('id').eq('company_id', companyId).limit(1), 'el plan')
  if (!plan.length) return null
  const r = await rpc<{ id: string; code: string }>('company_account_add', {
    p_company: companyId, p_hoja: '4100', p_nombre: `Liquidación pendiente con ${nombre}`,
    p_plain_name: 'Lo que cobras por cuenta del socio (las ventas de sus marcas): se compensa en su liquidación mensual y el resto se le paga.',
    p_entity: null, p_entity_id: null, p_quien_nombre: quien, p_source: 'manual',
  })
  await rpc<void>('company_account_link_set', { p_company: companyId, p_entity: 'customer', p_entity_id: partyId, p_role: 'liquidacion', p_account_id: r.id, p_quien_nombre: quien, p_source: 'manual' })
  return { code: r.code, nueva: true }
}

/** Esta 430 es la suya: el enlace de cliente (company_account_link_set, el del C02). */
export const enlazarCuentaCliente = (companyId: string, partyId: string, cuentaId: string, quien: string | null) =>
  rpc<void>('company_account_link_set', { p_company: companyId, p_entity: 'customer', p_entity_id: partyId, p_role: 'principal', p_account_id: cuentaId, p_quien_nombre: quien, p_source: 'manual' })

/** Su subcuenta de cliente, la siguiente libre de la 4300 (company_account_add, el del C02). */
export const crearCuentaCliente = (companyId: string, partyId: string, nombre: string, quien: string | null) =>
  rpc<{ id: string; code: string }>('company_account_add', { p_company: companyId, p_hoja: '4300', p_nombre: `Clientes · ${nombre}`, p_plain_name: null, p_entity: 'customer', p_entity_id: partyId, p_quien_nombre: quien, p_source: 'manual' })

/**
 * «Subir liquidación»: las filas del CSV, al canal de esta plataforma y a este
 * tercero. Mismas claves que el importador de siempre: lo que ya estaba se
 * actualiza, no se duplica. Devuelve cuántas eran nuevas y cuántas ya estaban.
 */
export async function subirLiquidaciones(accountId: string, partyId: string, channelId: string | null, filas: FilaLiquidacion[]): Promise<{ nuevas: number; yaEstaban: number }> {
  if (filas.length === 0) return { nuevas: 0, yaEstaban: 0 }
  const claves = filas.map((f) => f.import_key)
  const antes = await leer(tabla('channel_settlement').select('id, import_key').eq('account_id', accountId).in('import_key', claves), 'las liquidaciones que ya estaban')
  const idDe = new Map(antes.map((r) => [String(r.import_key), String(r.id)]))
  const ya = new Set(idDe.keys())
  // El índice de import_key es parcial (where import_key is not null): «upsert»
  // no lo encuentra. Las que ya estaban se actualizan; las nuevas se insertan.
  const comun = { account_id: accountId, channel_id: channelId, party_id: partyId, currency: 'EUR' }
  const nuevas = filas.filter((f) => !ya.has(f.import_key))
  if (nuevas.length) {
    const { error } = await tabla('channel_settlement').insert(nuevas.map((f) => ({ ...f, ...comun, needs_review: false })))
    if (error) throw new Error(mensaje('No se han podido guardar las liquidaciones nuevas', error))
  }
  for (const f of filas.filter((x) => ya.has(x.import_key))) {
    const { error } = await tabla('channel_settlement').update({ ...f, ...comun, updated_at: new Date().toISOString() }).eq('id', idDe.get(f.import_key)!)
    if (error) throw new Error(mensaje(`No se ha podido actualizar la liquidación ${f.settlement_ref ?? f.import_key}`, error))
  }
  return { nuevas: filas.filter((f) => !ya.has(f.import_key)).length, yaEstaban: filas.filter((f) => ya.has(f.import_key)).length }
}

/** Los acuerdos de cesión que aún no apuntan a su socio (owner_name de antes): la revisión de la lista. */
export async function acuerdosSinSocio(accountId: string): Promise<{ id: string; dueno: string; marca: string; pct: number }[]> {
  const filas = await leer(tabla('brand_licensing_agreement').select('id, owner_name, revenue_share_pct, brand(name)')
    .eq('account_id', accountId).is('party_id', null).is('archived_at', null), 'los acuerdos de cesión')
  return filas.map((a) => ({ id: String(a.id), dueno: String(a.owner_name ?? ''), marca: str((a.brand as Fila | null)?.name) ?? 'Marca', pct: Number(a.revenue_share_pct) }))
}

/** Le debes a cada proveedor (facturas aprobadas sin pagar), con la misma regla que su ficha. */
export { listarFacturasDeLaCuenta } from '@/modules/conta/services/proveedorService'

/** Una aportación del socio en un local (resta en su liquidación de ese periodo). */
export async function registrarAportacion(accountId: string, partyId: string, a: { localId: string; fecha: string; tipo: string; importe: number; nota: string | null }, quien: string | null): Promise<void> {
  const { error } = await tabla('brand_partner_contribution').insert({
    account_id: accountId, party_id: partyId, location_id: a.localId, contributed_on: a.fecha, kind: a.tipo, amount: a.importe, note: a.nota, created_by_name: quien,
  })
  if (error) throw new Error(mensaje('No se ha podido apuntar la aportación', error))
}

export async function borrarAportacion(id: string): Promise<void> {
  const { error } = await tabla('brand_partner_contribution').delete().eq('id', id)
  if (error) throw new Error(mensaje('No se ha podido quitar la aportación', error))
}
