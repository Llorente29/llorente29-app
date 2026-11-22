// src/modules/conta/nucleo/terceros/servicio.ts
//
// X27 · Lo que la ficha de proveedor y la de cliente leen y escriben. Las tablas y las funciones son las de siempre
// (verificadas contra la base el 22/11, regla 40):
//   · proveedor: supplier (su ficha, con lo del X27: vat_deductible_pct, default_brand_id, default_channel_id,
//     exclude_from_347 y pay_on_post) y company_account_link de la empresa (rol «principal», su 400; «gasto»; «pago»,
//     la del K10). Lo de siempre se guarda con guardarFicha (que quita el «de la factura» de un dato cambiado a mano).
//   · cliente: party y customer_fiscal con party_save_customer, y lo del X27 (phone, email, notes, trade_name,
//     usual_tax_rate_ids) con un update de customer_fiscal; su 430, el rol «principal» de entity «customer».
//   · el alta: el proveedor (crearProveedor) o el cliente (party_save_customer), y su subcuenta con
//     company_account_add (la siguiente libre de la 4000, la 4100 o la 4300, enlazada como «principal»). Si la
//     subcuenta no se crea, el tercero ya existe: se abre su ficha y se dice por qué (nunca otro alta al reintentar).

import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { crearProveedor, guardarFicha, obtenerFicha } from '@/modules/conta/services/proveedorService'
import { apuntesDeCuentas } from '@/modules/conta/services/libroService'
import { leerEjercicios, localesDeLaCuenta, type EjercicioLibro } from '@/modules/conta/services/diarioService'
import { marcasDeLaCuenta, plataformasDeLaCuenta, type Opcion } from '@/modules/conta/services/asientoGeneralService'
import { delProveedor } from '@/modules/conta/nucleo/recibida/servicio'
import { textoDeOperacion } from '@/modules/conta/nucleo/recibida/cabecera'
import { borradorVacio, hojaDeAlta, porcentaje, dias as diasDe, retencionQueEncaja, type Borrador, type Movimiento, type TipoTercero } from './fichaTercero'

type Fila = Record<string, unknown>
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const nulo = (t: string): string | null => (t.trim() ? t.trim() : null)

async function leer(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se han podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

export interface Subcuenta { id: string; codigo: string; descripcion: string }
export interface Tasa { id: string; codigo: string; descripcion: string; rate: number }
export interface Cobro { id: string; codigo: string; descripcion: string }

/** Lo que necesitan las lupas de las dos fichas, de la cuenta y de la empresa. */
export interface BaseFicha {
  subcuentas: Subcuenta[]
  tasas: Tasa[]
  retenciones: Tasa[]
  locales: Opcion[]
  marcas: Opcion[]
  plataformas: Opcion[]
  /** Las cuentas donde se cobra (las tesorerías de la empresa, con su subcuenta): la «Subcuenta de cobro» del cliente. */
  cobros: Cobro[]
  ejercicios: EjercicioLibro[]
}

export async function baseDeLaFicha(accountId: string, companyId: string): Promise<BaseFicha> {
  const sistemaOCuenta = `is_system.eq.true,account_id.eq.${accountId}`
  const [cuentas, tasas, retenciones, locales, marcas, plataformas, tesorerias, enlacesBanco, ejercicios] = await Promise.all([
    leer(tabla('company_account').select('id, code, name, status').eq('account_id', accountId).eq('company_id', companyId).order('code'), 'las subcuentas'),
    leer(tabla('tax_rate').select('id, name, rate').or(sistemaOCuenta).order('rate', { ascending: false }), 'los tipos de IVA'),
    leer(tabla('withholding_rate').select('id, name, rate').or(sistemaOCuenta).neq('code', 'trabajo').order('rate'), 'las retenciones'),
    localesDeLaCuenta(accountId), marcasDeLaCuenta(accountId), plataformasDeLaCuenta(accountId),
    leer(tabla('treasury_account').select('id, name, iban, is_active').eq('account_id', accountId).eq('company_id', companyId).order('name'), 'las cuentas de cobro'),
    leer(tabla('company_account_link').select('company_account_id, entity_id').eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'bank_account').eq('role', 'principal'), 'las subcuentas de los bancos'),
    leerEjercicios(accountId, companyId),
  ])
  const subcuentas = cuentas.filter((c) => c.status !== 'cerrada').map((c) => ({ id: s(c.id), codigo: s(c.code), descripcion: s(c.name) }))
  const codigo = new Map(cuentas.map((c) => [s(c.id), s(c.code)]))
  const t = (f: Fila, i: number): Tasa => ({ id: s(f.id), codigo: String(i + 1), descripcion: s(f.name), rate: Number(f.rate) })
  return {
    subcuentas,
    tasas: tasas.map(t), retenciones: retenciones.map(t),
    locales: locales.map((l, i) => ({ id: l.id, codigo: String(i + 1), descripcion: l.nombre })),
    marcas, plataformas,
    cobros: tesorerias.filter((x) => x.is_active !== false).map((x) => {
      const sub = codigo.get(s(enlacesBanco.find((l) => s(l.entity_id) === s(x.id))?.company_account_id)) ?? ''
      return { id: s(x.id), codigo: sub || s(x.name), descripcion: s(x.name) }
    }),
    ejercicios,
  }
}

/** Una ficha abierta: el borrador con lo guardado, su subcuenta y lo que pone el programa (grises). */
export interface FichaLeida {
  id: string
  borrador: Borrador
  subcuenta: Subcuenta | null
  /** Proveedor: el tipo de operación que calcula Sumied (gris). */
  operacion: string
  /** Proveedor: el porcentaje de retención guardado, aunque no encaje con ningún tipo (la lupa lo dice). */
  retencionPct: number | null
  /** Las subcuentas de la pestaña «Subcuentas»: cada rol con la suya. */
  roles: { rol: string; subcuenta: Subcuenta }[]
}

const ROL: Record<string, string> = { principal: 'Su subcuenta', gasto: 'Subcuenta de gasto', pago: 'Subcuenta de pago', suplidos: 'Suplidos', liquidacion: 'Liquidación', publicidad: 'Publicidad' }

async function enlaces(accountId: string, companyId: string, entity: 'supplier' | 'customer', id: string) {
  const ls = await leer(tabla('company_account_link').select('role, company_account:company_account_id(id, code, name)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('entity', entity).eq('entity_id', id), 'sus subcuentas')
  return ls.map((l) => {
    const c = l.company_account as Fila | null
    return { rol: s(l.role), subcuenta: c ? { id: s(c.id), codigo: s(c.code), descripcion: s(c.name) } : null }
  }).filter((x): x is { rol: string; subcuenta: Subcuenta } => !!x.subcuenta)
}

export async function leerProveedor(accountId: string, companyId: string, supplierId: string, retenciones: readonly Tasa[]): Promise<FichaLeida | null> {
  const [f, extra, ls, del] = await Promise.all([
    obtenerFicha(supplierId),
    leer(tabla('supplier').select('vat_deductible_pct, default_brand_id, default_channel_id, exclude_from_347, pay_on_post, phone, email').eq('account_id', accountId).eq('id', supplierId), 'su ficha'),
    enlaces(accountId, companyId, 'supplier', supplierId),
    delProveedor(accountId, companyId, supplierId).catch(() => null),
  ])
  if (!f || f.accountId !== accountId) return null
  const x = extra[0] ?? {}
  const de = (rol: string) => ls.find((l) => l.rol === rol)?.subcuenta ?? null
  const ret = retencionQueEncaja(f.irpfWithholdingPct, retenciones)
  const b: Borrador = {
    ...borradorVacio(),
    nombre: f.legalName ?? f.name, nif: f.taxId ?? '', tipoNif: f.taxIdType ?? 'nif_es', comercial: f.legalName && f.legalName !== f.name ? f.name : '',
    domicilio: f.fiscalStreet ?? '', postal: f.fiscalPostalCode ?? '', poblacion: f.fiscalCity ?? '', provincia: f.fiscalProvince ?? '', pais: f.countryCode ?? 'ES',
    telefono: s(x.phone), correo: s(x.email), observaciones: f.notes ?? '',
    recargo: f.vatRegime === 'recargo_equivalencia', no347: x.exclude_from_347 === true,
    iva1: f.usualTaxRateIds[0] ?? '', iva2: f.usualTaxRateIds[1] ?? '',
    retencion: ret ? ret.id : f.irpfWithholdingPct ? String(f.irpfWithholdingPct).replace('.', ',') : '',
    deducible: x.vat_deductible_pct === null || x.vat_deductible_pct === undefined ? '' : String(Number(x.vat_deductible_pct)).replace('.', ','),
    gasto: de('gasto')?.id ?? '', local: f.defaultLocationId ?? '', marca: s(x.default_brand_id), plataforma: s(x.default_channel_id),
    pagoDirecto: x.pay_on_post === true, pago: de('pago')?.id ?? '',
    forma: f.paymentMethod && f.paymentMethod !== 'prepaid' ? f.paymentMethod : '', dias: f.paymentTermsDays === null ? '' : String(f.paymentTermsDays), iban: f.iban ?? '',
  }
  return {
    id: supplierId, borrador: b, subcuenta: de('principal'), operacion: textoDeOperacion(del?.operacion ?? null), retencionPct: f.irpfWithholdingPct,
    roles: ls.map((l) => ({ rol: ROL[l.rol] ?? l.rol, subcuenta: l.subcuenta })),
  }
}

export async function leerCliente(accountId: string, companyId: string, partyId: string): Promise<FichaLeida | null> {
  const [p, cf, ls] = await Promise.all([
    leer(tabla('party').select('id, name, tax_id, account_id').eq('account_id', accountId).eq('id', partyId), 'el cliente'),
    leer(tabla('customer_fiscal').select('*').eq('account_id', accountId).eq('party_id', partyId), 'sus datos'),
    enlaces(accountId, companyId, 'customer', partyId),
  ])
  const pt = p[0]
  if (!pt) return null
  const c = cf[0] ?? {}
  const ids = Array.isArray(c.usual_tax_rate_ids) ? (c.usual_tax_rate_ids as unknown[]).map(String) : []
  const b: Borrador = {
    ...borradorVacio(),
    nombre: s(c.legal_name) || s(pt.name), nif: s(pt.tax_id), tipoNif: (s(c.tax_id_type) || 'nif_es') as Borrador['tipoNif'], comercial: s(c.trade_name),
    domicilio: s(c.fiscal_street), postal: s(c.fiscal_postal_code), poblacion: s(c.fiscal_city), provincia: s(c.fiscal_province), pais: s(c.country_code) || 'ES',
    telefono: s(c.phone), correo: s(c.email), observaciones: s(c.notes),
    recargo: c.equivalence_surcharge === true, no347: c.exclude_347 === true,
    iva1: ids[0] ?? '', iva2: ids[1] ?? '', retencion: s(c.withholding_rate_id), operacion: s(c.operation_scope),
    pago: s(c.collection_treasury_id), forma: (['transfer', 'direct_debit', 'card', 'cash'].includes(s(c.payment_method)) ? s(c.payment_method) : '') as Borrador['forma'],
    dias: c.payment_terms_days === null || c.payment_terms_days === undefined ? '' : String(c.payment_terms_days), iban: s(c.iban),
  }
  const principal = ls.find((l) => l.rol === 'principal')?.subcuenta ?? null
  return { id: partyId, borrador: b, subcuenta: principal, operacion: '', retencionPct: null, roles: ls.map((l) => ({ rol: ROL[l.rol] ?? l.rol, subcuenta: l.subcuenta })) }
}

/** Los vecinos (← →): las fichas de la empresa por su subcuenta, como ERP10. */
export async function vecinos(accountId: string, companyId: string, tipo: TipoTercero, id: string | null): Promise<{ antes: string | null; despues: string | null }> {
  const ls = await leer(tabla('company_account_link').select('entity_id, company_account:company_account_id(code)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('entity', tipo === 'proveedor' ? 'supplier' : 'customer').eq('role', 'principal'), 'los vecinos')
  const orden = ls.map((l) => ({ id: s(l.entity_id), code: s((l.company_account as Fila | null)?.code) })).sort((a, b) => a.code.localeCompare(b.code))
  const i = id ? orden.findIndex((x) => x.id === id) : orden.length
  return { antes: i > 0 ? orden[i - 1].id : null, despues: i >= 0 && i < orden.length - 1 ? orden[i + 1].id : null }
}

/** Su mayor: los apuntes de su subcuenta (la pestaña «Movimientos» y la de «Saldos»). */
export async function movimientos(accountId: string, companyId: string, subcuentaId: string): Promise<Movimiento[]> {
  const ap = await apuntesDeCuentas(accountId, companyId, [subcuentaId])
  return ap.map((a) => ({ fecha: a.fecha, documento: a.documento, concepto: a.concepto, debe: a.debe, haber: a.haber, asiento: a.enlace?.id ?? null, anulado: !!a.asiento?.anulado }))
}

// ── Guardar ────────────────────────────────────────────────────────────────

const enlazar = async (companyId: string, entity: 'supplier', id: string, rol: 'gasto' | 'pago', antes: string, ahora: string, quien: string | null) => {
  if (antes === ahora) return
  if (ahora) await rpc<void>('company_account_link_set', { p_company: companyId, p_entity: entity, p_entity_id: id, p_role: rol, p_account_id: ahora, p_quien_nombre: quien, p_source: 'manual' })
  else await rpc<void>('company_account_link_unset', { p_company: companyId, p_entity: entity, p_entity_id: id, p_role: rol, p_quien_nombre: quien })
}

function retencionPct(b: Borrador, retenciones: readonly Tasa[]): number | null {
  const r = retenciones.find((x) => x.id === b.retencion)
  if (r) return r.rate
  const n = porcentaje(b.retencion)
  return n === null || Number.isNaN(n) ? null : n
}

/** Guarda la ficha del proveedor; con `nuevo`, primero el alta y su 400. Devuelve su id y lo que ha hecho. */
export async function guardarProveedor(o: {
  accountId: string; companyId: string; id: string | null; antes: Borrador; ahora: Borrador; retenciones: readonly Tasa[]
  quien: string | null; userId: string | null; subcuentas: readonly Subcuenta[]
}): Promise<Guardado> {
  const b = o.ahora
  let id = o.id
  let alta: string | null = null
  let falloSub: string | null = null
  if (!id) {
    const nombre = (b.comercial.trim() || b.nombre.trim())
    const f = await crearProveedor({ accountId: o.accountId, name: nombre, taxId: nulo(b.nif), taxIdType: b.tipoNif || null, nifComprobado: false, entityKind: null, createdBy: o.userId, createdByName: o.quien })
    id = f.id
    const hoja = hojaDeAlta('proveedor', o.subcuentas.find((c) => c.id === b.gasto)?.codigo ?? null)
    const sub = await subcuentaDelAlta(o.companyId, hoja, b.nombre.trim(), 'supplier', id, o.quien)
    if ('fallo' in sub) falloSub = sub.fallo; else alta = sub.code
  }
  const ivas = [b.iva1, b.iva2].filter(Boolean)
  await guardarFicha(id, {
    name: b.comercial.trim() || b.nombre.trim(), legalName: b.nombre.trim(), taxId: nulo(b.nif), taxIdType: b.tipoNif || null,
    fiscalStreet: nulo(b.domicilio), fiscalPostalCode: nulo(b.postal), fiscalCity: nulo(b.poblacion), fiscalProvince: nulo(b.provincia),
    countryCode: (b.pais.trim() || 'ES').toUpperCase(), notes: nulo(b.observaciones),
    ...(b.recargo !== o.antes.recargo ? { vatRegime: b.recargo ? 'recargo_equivalencia' : 'general' } : {}),
    usualTaxRateIds: ivas, irpfWithholdingPct: retencionPct(b, o.retenciones),
    defaultLocationId: b.local || null, paymentMethod: b.forma || null, paymentTermsDays: diasDe(b.dias), iban: nulo(b.iban)?.replace(/\s/g, '').toUpperCase() ?? null,
  })
  const pct = porcentaje(b.deducible)
  const { error } = await tabla('supplier').update({
    phone: nulo(b.telefono), email: nulo(b.correo), vat_deductible_pct: pct, exclude_from_347: b.no347 || null, pay_on_post: b.pagoDirecto || null,
    default_brand_id: b.marca || null, default_channel_id: b.plataforma || null,
  }).eq('account_id', o.accountId).eq('id', id)
  if (error) throw new Error(mensaje('No se ha guardado lo que propone la factura', error))
  await enlazar(o.companyId, 'supplier', id, 'gasto', o.id ? o.antes.gasto : '', b.gasto, o.quien)
  await enlazar(o.companyId, 'supplier', id, 'pago', o.id ? o.antes.pago : '', b.pago, o.quien)
  if (falloSub) return { id, texto: `Dado de alta: ${b.nombre.trim()}, pero sin subcuenta: ${falloSub}`, tono: 'ambar' }
  return { id, texto: alta ? `Dado de alta: ${b.nombre.trim()}, con la subcuenta ${alta}.` : `Guardado: ${b.nombre.trim()}.`, tono: 'bien' }
}

export interface Guardado { id: string; texto: string; tono: 'bien' | 'ambar' }

/** La subcuenta del alta, o por qué no se ha creado (sin lanzar: el tercero ya existe). */
async function subcuentaDelAlta(companyId: string, hoja: string, nombre: string, entity: 'supplier' | 'customer', id: string, quien: string | null): Promise<{ code: string } | { fallo: string }> {
  try {
    return await rpc<{ id: string; code: string }>('company_account_add', { p_company: companyId, p_hoja: hoja, p_nombre: nombre, p_plain_name: null, p_entity: entity, p_entity_id: id, p_quien_nombre: quien, p_source: 'manual' })
  } catch (e) { return { fallo: (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '') } }
}

/** Guarda la ficha del cliente; con `nuevo`, primero el alta y su 430. */
export async function guardarCliente(o: { accountId: string; companyId: string; id: string | null; ahora: Borrador; quien: string | null }): Promise<Guardado> {
  const b = o.ahora
  const r = await rpc<{ party_id: string; nuevo: boolean }>('party_save_customer', {
    p_account: o.accountId, p_party: o.id, p_nombre: b.nombre.trim(), p_nif: nulo(b.nif), p_quien_nombre: o.quien,
    p_datos: {
      legalName: b.nombre.trim(), taxIdType: b.tipoNif || null, countryCode: (b.pais.trim() || 'ES').toUpperCase(),
      fiscalStreet: b.domicilio, fiscalPostalCode: b.postal, fiscalCity: b.poblacion, fiscalProvince: b.provincia,
      equivalenceSurcharge: b.recargo, withholdingRateId: b.retencion, operationScope: b.operacion || 'domestic', exclude347: b.no347,
      paymentMethod: b.forma, paymentTermsDays: b.dias.trim(), collectionTreasuryId: b.pago, iban: b.iban,
    },
  })
  const id = r.party_id
  const { error } = await tabla('customer_fiscal').update({
    phone: nulo(b.telefono), email: nulo(b.correo), notes: nulo(b.observaciones), trade_name: nulo(b.comercial),
    usual_tax_rate_ids: [b.iva1, b.iva2].filter(Boolean),
  }).eq('account_id', o.accountId).eq('party_id', id)
  if (error) throw new Error(mensaje('No se han guardado sus datos', error))
  let alta: string | null = null
  if (!o.id) {
    const ya = await leer(tabla('company_account_link').select('company_account_id').eq('company_id', o.companyId).eq('entity', 'customer').eq('entity_id', id).eq('role', 'principal'), 'su subcuenta')
    if (!ya.length) {
      const sub = await subcuentaDelAlta(o.companyId, hojaDeAlta('cliente', null), b.nombre.trim(), 'customer', id, o.quien)
      if ('fallo' in sub) return { id, texto: `Dado de alta: ${b.nombre.trim()}, pero sin subcuenta: ${sub.fallo}`, tono: 'ambar' }
      alta = sub.code
    }
  }
  return { id, texto: alta ? `Dado de alta: ${b.nombre.trim()}, con la subcuenta ${alta}.` : `Guardado: ${b.nombre.trim()}.`, tono: 'bien' }
}

/** ¿Este tercero es un cliente? (la ficha de cliente del núcleo solo abre los que lo son). */
export async function esCliente(accountId: string, partyId: string): Promise<boolean> {
  const r = await leer(tabla('party_role').select('role').eq('account_id', accountId).eq('party_id', partyId).eq('role', 'customer'), 'si es cliente')
  return r.length > 0
}
