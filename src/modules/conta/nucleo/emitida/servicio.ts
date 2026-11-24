// src/modules/conta/nucleo/emitida/servicio.ts
//
// K05 · Lo que lee y escribe la ficha de la factura emitida del núcleo. Lee
// con las tablas de siempre, por cuenta y empresa (regla 9). Escribe con las
// funciones de la base de hoy, sin ninguna nueva:
//
//   · el asiento: journal_entry_proponer + journal_entry_validar (el de
//     conta_venta_emitir, armado en asiento.ts); la 430 de un cliente que aún
//     no la tiene, crearCuentaCliente (company_account_add 4300, la de hoy); la
//     473, company_account_add 4730, como la emisión;
//   · la rellenada: cambiarCuenta (lo único que hoy se cambia de un propuesto)
//     y validar;
//   · el cobro: conta_banco_a_mano (E05) a un banco; a otra cuenta, el asiento
//     del cobro en efectivo de conta_venta_cobrar (serie 4);
//   · el PDF: guardarExpedidaPdf (conta_documento_expedida_guardar).
//
// Regla 40: los nombres entre comillas, comprobados contra las migraciones
// (journal_entry, journal_line, company_account, company_account_link,
// party, party_role, customer_fiscal, tax_rate, withholding_rate,
// treasury_account, vat_book_entry, customer_invoice).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { apuntesDeCuentas } from '@/modules/conta/services/libroService'
import { crearCuentaCliente } from '@/modules/conta/services/tercerosService'
import { validar } from '@/modules/conta/services/diarioService'
import { leerExpedidaPdf } from '@/modules/conta/services/documentosService'
import { urlDelPdf } from '@/modules/conta/services/ventasService'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'
import { cuentasParaMover } from '@/modules/conta/lib/cuentasParaMover'
import { lineasParaLaBase, type BorradorEmitida, type CuentasEmitida, type QueHaceElCobro } from './asiento'

type Fila = Record<string, unknown>
const s = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null)
const n = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x))

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

export interface ClienteEmitida {
  id: string
  nombre: string
  nif: string | null
  /** Su 430 (company_account_link customer · principal), o null si aún no tiene. */
  subcuenta: { id: string; codigo: string; nombre: string } | null
  operacion: string | null
  recargo: boolean
  /** La retención de su ficha (withholding_rate), por su %. */
  retencion: number | null
  /** Los días de cobro de su ficha. */
  dias: number | null
  /** La cuenta del cobro de su ficha: la 57x de su tesorería (collection_treasury_id). */
  cobro: string | null
}

export interface DeLaEmpresa {
  clientes: ClienteEmitida[]
  /** Los tipos de IVA repercutido con su 477 (el enlace tax_rate → repercutido, o la 477 de su % por el nombre, como conta_venta_emitir). */
  tipos: Map<number, { tipoId: string; codigo: string | null; nombre: string }>
  ventas: { id: string; codigo: string; nombre: string }[]
  /** Las cuentas a las que se puede cobrar (X23: todas las subcuentas abiertas, bancos y caja primero), con el id del banco si es la de una tesorería. */
  cobros: { codigo: string; nombre: string; bancoId: string | null }[]
  retencion: { codigo: string; nombre: string } | null
  retenciones: { id: string; tipo: number; nombre: string }[]
  nombres: Map<string, string>
}

/** Lo que la ficha necesita de la empresa, una vez por empresa. */
export async function deLaEmpresa(accountId: string, companyId: string, hoy: string): Promise<DeLaEmpresa> {
  const [roles, partes, fiscales, enlaces, plan, tasas, rets, tesos] = await Promise.all([
    leer(tabla('party_role').select('party_id').eq('account_id', accountId).eq('role', 'customer'), 'los clientes'),
    leer(tabla('party').select('id, name, tax_id').eq('account_id', accountId).is('archived_at', null), 'los contactos'),
    leer(tabla('customer_fiscal').select('party_id, legal_name, operation_scope, equivalence_surcharge, withholding_rate_id, payment_terms_days, collection_treasury_id').eq('account_id', accountId), 'los datos fiscales'),
    leer(tabla('company_account_link').select('entity, entity_id, role, company_account_id').eq('account_id', accountId).eq('company_id', companyId).in('entity', ['customer', 'tax_rate', 'bank_account']), 'los enlaces del plan'),
    leer(tabla('company_account').select('id, code, name, plain_name, kind, template_code, status').eq('account_id', accountId).eq('company_id', companyId), 'el plan'),
    leer(tabla('tax_rate').select('id, rate, treatment, valid_to, tax_system, company_id').eq('treatment', 'taxed').or(`company_id.is.null,company_id.eq.${companyId}`), 'los tipos de IVA'),
    leer(tabla('withholding_rate').select('id, name, rate, code, company_id').or(`company_id.is.null,company_id.eq.${companyId}`).neq('code', 'trabajo').order('rate', { ascending: false }), 'las retenciones'),
    leer(tabla('treasury_account').select('id, name, kind').eq('account_id', accountId).eq('company_id', companyId), 'las cuentas de tesorería'),
  ])
  const porId = new Map(plan.map((c) => [String(c.id), c]))
  // K08 · El nombre guardado en el plan, nunca su explicación (Julio, 21/11).
  const nombreDe = (c: Fila) => String(c.name ?? '')
  const nombres = new Map(plan.map((c) => [String(c.code), nombreDe(c)]))
  const enlace = (entity: string, id: string, role: string) => {
    const l = enlaces.find((x) => x.entity === entity && String(x.entity_id) === id && x.role === role)
    return l ? porId.get(String(l.company_account_id)) ?? null : null
  }
  const deTeso = new Map(tesos.map((t) => [String(t.id), enlace('bank_account', String(t.id), 'principal')]))
  const esCliente = new Set(roles.map((r) => String(r.party_id)))
  const fiscal = new Map(fiscales.map((f) => [String(f.party_id), f]))
  const tasaRet = new Map(rets.map((r) => [String(r.id), n(r.rate)]))
  const clientes = partes.filter((p) => esCliente.has(String(p.id))).map((p): ClienteEmitida => {
    const f = fiscal.get(String(p.id))
    const sub = enlace('customer', String(p.id), 'principal')
    const teso = f?.collection_treasury_id ? deTeso.get(String(f.collection_treasury_id)) ?? null : null
    return {
      id: String(p.id), nombre: s(f?.legal_name) ?? String(p.name ?? ''), nif: s(p.tax_id),
      subcuenta: sub ? { id: String(sub.id), codigo: String(sub.code), nombre: nombreDe(sub) } : null,
      operacion: s(f?.operation_scope), recargo: f?.equivalence_surcharge === true,
      retencion: f?.withholding_rate_id ? tasaRet.get(String(f.withholding_rate_id)) ?? null : null,
      dias: f?.payment_terms_days === null || f?.payment_terms_days === undefined ? null : n(f.payment_terms_days),
      cobro: teso ? String(teso.code) : null,
    }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  // La 477 de cada tipo: su enlace «repercutido»; si no, la 477 de su % por el nombre (la misma regla que conta_venta_emitir).
  const tipos = new Map<number, { tipoId: string; codigo: string | null; nombre: string }>()
  for (const t of tasas.filter((x) => (x.tax_system ?? 'iva') === 'iva' && (!x.valid_to || String(x.valid_to) >= hoy) && n(x.rate) > 0).sort((a, b) => n(b.rate) - n(a.rate))) {
    const pct = n(t.rate)
    if (tipos.has(pct) && tipos.get(pct)!.codigo) continue
    let c = enlace('tax_rate', String(t.id), 'repercutido')
    if (!c) c = plan.filter((x) => /^477/.test(String(x.code)) && String(x.code) !== '47700000' && new RegExp(`(^|\\D)${pct}( |%|$)`).test(String(x.name))).sort((a, b) => String(a.code).localeCompare(String(b.code)))[0] ?? null
    tipos.set(pct, { tipoId: String(t.id), codigo: c ? String(c.code) : null, nombre: c ? nombreDe(c) : `IVA repercutido ${pct} %` })
  }
  const hojas = plan.filter((c) => c.kind !== 'group')
  const ventas = hojas.filter((c) => /^70/.test(String(c.code)) && String(c.code).length >= 8).map((c) => ({ id: String(c.id), codigo: String(c.code), nombre: nombreDe(c) })).sort((a, b) => a.codigo.localeCompare(b.codigo))
  const bancoDe = new Map([...deTeso.entries()].filter(([, c]) => c).map(([id, c]) => [String(c!.code), id]))
  // X23 (Julio, 19/11) · Se cobra con cualquier subcuenta del plan, como se paga (X21b, la misma pieza): bancos y caja primero.
  const cobros = cuentasParaMover(hojas, { tesorerias: new Set(bancoDe.keys()), delante: (c) => /^57/.test(String(c.code)) })
    .map((c) => ({ codigo: String(c.code), nombre: nombreDe(c), bancoId: bancoDe.get(String(c.code)) ?? null }))
  const r473 = plan.filter((c) => /^473/.test(String(c.template_code ?? c.code))).sort((a, b) => String(a.code).localeCompare(String(b.code)))[0] ?? null
  return {
    clientes, tipos, ventas, cobros, nombres,
    retencion: r473 ? { codigo: String(r473.code), nombre: nombreDe(r473) } : null,
    retenciones: rets.map((r) => ({ id: String(r.id), tipo: n(r.rate), nombre: String(r.name ?? '') })),
  }
}

/** El mayor del cliente (su 430): los apuntes validados, y lo que nos debe a hoy (debe − haber). */
export async function mayorDelCliente(accountId: string, companyId: string, subcuentaId: string, hoy: string): Promise<{ apuntes: Apunte[]; saldo: number }> {
  const todos = await apuntesDeCuentas(accountId, companyId, [subcuentaId])
  const apuntes = todos.filter((a) => a.fecha <= hoy && !a.asiento?.anulado)
  const saldo = apuntes.reduce((t, a) => t + Math.round(a.debe * 100) - Math.round(a.haber * 100), 0) / 100
  return { apuntes, saldo }
}

/**
 * A qué cuentas de venta fueron sus facturas anteriores: las 70x de sus
 * asientos validados de la serie 1, por cuenta, con cuántas facturas y la
 * última; la más reciente primero (la duda de la cuenta, como 0250 en la
 * recibida, leída de los asientos: para clientes la base no tiene función).
 */
export async function repartoDeVentas(accountId: string, companyId: string, partyId: string, sin: string | null): Promise<{ cuenta: string; nombre: string; facturas: number; ultima: string }[]> {
  const filas = await leer(tabla('journal_line')
    .select('entry_id, credit, company_account!inner(code, name, plain_name), journal_entry!inner(party_id, series, status, entry_date)')
    .eq('account_id', accountId).eq('company_id', companyId)
    .eq('journal_entry.party_id', partyId).eq('journal_entry.series', 1).eq('journal_entry.status', 'validado')
    .like('company_account.code', '70%').gt('credit', 0).limit(500), 'sus facturas anteriores')
  const por = new Map<string, { cuenta: string; nombre: string; asientos: Set<string>; ultima: string }>()
  for (const f of filas) {
    if (sin && String(f.entry_id) === sin) continue
    const c = f.company_account as Fila; const e = f.journal_entry as Fila
    const k = String(c.code)
    const x = por.get(k) ?? { cuenta: k, nombre: String(c.name ?? ''), asientos: new Set<string>(), ultima: '' }
    x.asientos.add(String(f.entry_id))
    if (String(e.entry_date) > x.ultima) x.ultima = String(e.entry_date)
    por.set(k, x)
  }
  return [...por.values()].map((x) => ({ cuenta: x.cuenta, nombre: x.nombre, facturas: x.asientos.size, ultima: x.ultima })).sort((a, b) => b.ultima.localeCompare(a.ultima))
}

/** La cuenta contra la que se cobró su última factura: el debe del asiento donde su 430 está al haber (un cobro). */
export async function ultimaCuentaDeCobro(accountId: string, companyId: string, subcuentaId: string): Promise<string | null> {
  const haber = await leer(tabla('journal_line').select('entry_id, journal_entry!inner(entry_date, status, series)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('company_account_id', subcuentaId).gt('credit', 0)
    .eq('journal_entry.status', 'validado').in('journal_entry.series', [3, 4]).limit(200), 'sus cobros')
  const ultimo = haber.sort((a, b) => String((b.journal_entry as Fila).entry_date).localeCompare(String((a.journal_entry as Fila).entry_date)))[0]
  if (!ultimo) return null
  const debe = await leer(tabla('journal_line').select('company_account(code)').eq('account_id', accountId).eq('entry_id', String(ultimo.entry_id)).gt('debit', 0), 'su último cobro')
  const c = debe.map((x) => String((x.company_account as Fila | null)?.code ?? '')).find((x) => /^57/.test(x))
  return c ?? null
}

/** ¿Hay otra emitida con este número y este NIF en el libro de expedidas? La frase, o null. */
export async function emitidaRepetida(accountId: string, companyId: string, numero: string, nif: string | null, sin: string | null): Promise<string | null> {
  if (!numero.trim()) return null
  let q = tabla('vat_book_entry').select('entry_id, issue_date, counterpart_name').eq('account_id', accountId).eq('company_id', companyId)
    .eq('book', 'issued').eq('number', numero.trim()).is('voided_at', null)
  if (nif) q = q.eq('counterpart_tax_id', nif)
  const filas = (await leer(q.limit(5), 'el libro de expedidas')).filter((f) => !sin || String(f.entry_id) !== sin)
  if (!filas.length) return null
  const f = filas[0]
  const fecha = String(f.issue_date ?? '')
  return `Puede estar repetida: la ${numero.trim()}${f.counterpart_name ? ` de ${String(f.counterpart_name)}` : ''} ya está en el libro de expedidas${/^\d{4}-\d{2}-\d{2}/.test(fecha) ? ` (${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)})` : ''}`
}

/** La emitida de Facturación: su asiento, si está emitida; null si es borrador, rectificativa o no tiene asiento (sigue con la de Facturación). */
export async function asientoDeFacturacion(accountId: string, facturaId: string): Promise<{ entryId: string; numero: string } | null> {
  const [f] = await leer(tabla('customer_invoice').select('id, entry_id, status, doc_type, number_text').eq('account_id', accountId).eq('id', facturaId), 'la factura')
  if (!f || f.status !== 'emitida' || f.doc_type === 'rectificativa' || !f.entry_id) return null
  return { entryId: String(f.entry_id), numero: String(f.number_text ?? '') }
}

/** La cola de por revisar: los asientos de expedida (serie 1, con IVA en el libro de expedidas) propuestos o en borrador, menos los del TPV. */
export async function colaEmitidas(accountId: string, companyId: string): Promise<string[]> {
  const filas = await leer(tabla('journal_entry').select('id, entry_date, source_type, journal_line!inner(vat_book)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('series', 1).in('status', ['propuesto', 'borrador'])
    .neq('source_type', 'sales_day').eq('journal_line.vat_book', 'issued').order('entry_date').order('id').limit(500), 'las emitidas por revisar')
  return [...new Set(filas.map((f) => String(f.id)))]
}

export interface Guardada { entryId: string; serie: number; numero: number; frases: string[] }

/**
 * Guarda y valida una emitida escrita a mano: la 430 del cliente (si no la
 * tiene, la de hoy: crearCuentaCliente), la 473 si hace falta, el asiento de
 * conta_venta_emitir con journal_entry_proponer, y validar. Si validar no deja,
 * el asiento queda propuesto y se dice por qué (no se pierde lo escrito).
 */
export async function guardarEmitida(o: {
  companyId: string; b: BorradorEmitida; cliente: ClienteEmitida; cuentas: CuentasEmitida; local: string | null; quien: string | null
}): Promise<{ entryId: string; validada: { serie: number; numero: number } | null; porque: string | null; frases: string[] }> {
  const frases: string[] = []
  let c430 = o.cliente.subcuenta?.codigo ?? null
  if (!c430) {
    const r = await crearCuentaCliente(o.companyId, o.cliente.id, o.cliente.nombre, o.quien)
    c430 = r.code
    frases.push(`Le he dado su subcuenta, la ${r.code}.`)
  }
  let c473 = o.cuentas.retencion?.codigo ?? null
  if (o.b.retencion && !c473) {
    const r = await rpc<{ id: string; code: string }>('company_account_add', { p_company: o.companyId, p_hoja: '4730', p_nombre: 'Retenciones que te hacen tus clientes', p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: o.quien, p_source: 'manual' })
    c473 = r.code
    frases.push(`La retención va a la ${r.code}, nueva.`)
  }
  const lineas = lineasParaLaBase(o.b, { ...o.cuentas, cuenta430: c430, cuenta473: c473 }, o.cliente.id, o.local)
  const numero = o.b.numero.trim()
  const r = await rpc<Fila>('journal_entry_proponer', {
    p_company: o.companyId,
    p_entry: {
      series: 1, fecha: o.b.fecha, source_type: 'manual', concepto: `Factura ${numero} · ${o.cliente.nombre}`, party_id: o.cliente.id,
      documento: numero, fecha_documento: o.b.fecha, confianza: 'seguro', porque: 'Factura emitida escrita a mano en la ficha.',
    },
    p_lines: lineas, p_summary: null, p_quien_nombre: o.quien,
  })
  const entryId = String(r.id)
  try {
    const v = await validar(entryId, o.quien)
    return { entryId, validada: v, porque: null, frases }
  } catch (e) {
    return { entryId, validada: null, porque: e instanceof Error ? e.message : String(e), frases }
  }
}

/** El cobro, como hoy: a un banco, conta_banco_a_mano; a otra cuenta, el del cobro en efectivo (serie 4). Devuelve la frase. */
export async function apuntarCobro(o: { companyId: string; cobro: Exclude<QueHaceElCobro, { que: 'pendiente' }>; cuenta430: string; partyId: string; numero: string; fechaFactura: string; quien: string | null }): Promise<string> {
  const concepto = `Cobro factura ${o.numero}`
  if (o.cobro.que === 'banco') {
    const r = await rpc<Fila>('conta_banco_a_mano', { p_banco: o.cobro.bancoId, p_fecha: o.cobro.fecha, p_cuenta: o.cuenta430, p_concepto: concepto, p_importe: o.cobro.importe, p_quien_nombre: o.quien })
    return `Cobro apuntado en la ${o.cobro.cuenta}${r.numero ? `: 3 / ${String(r.numero)}` : ''}. Cuando llegue en el extracto, Bancos lo casa.`
  }
  const lado = { comun: true }
  const r = await rpc<Fila>('journal_entry_proponer', {
    p_company: o.companyId,
    p_entry: { series: 4, fecha: o.cobro.fecha, source_type: 'manual', concepto, party_id: o.partyId, documento: o.numero, fecha_documento: o.fechaFactura, confianza: 'seguro', porque: 'Cobro de la factura, desde su ficha.' },
    p_lines: [
      { cuenta: o.cobro.cuenta, documento: o.numero, concepto, debe: o.cobro.importe, haber: 0, ...lado },
      { cuenta: o.cuenta430, tercero_id: o.partyId, documento: o.numero, concepto, debe: 0, haber: o.cobro.importe, ...lado },
    ],
    p_summary: null, p_quien_nombre: o.quien,
  })
  const v = await validar(String(r.id), o.quien)
  return `Cobro apuntado en la ${o.cobro.cuenta}: 4 / ${v.numero}.`
}

/** El PDF de la emitida: el adjunto a su asiento (journal_entry_document, la de hoy) o, si es de Facturación, el suyo. Su dirección firmada, o null. */
export async function documentoDeLaEmitida(accountId: string, entryId: string): Promise<{ url: string; titulo: string } | null> {
  const doc = await leerExpedidaPdf(accountId, entryId)
  if (doc) { const url = await urlDelPdf(doc.ruta); return url ? { url, titulo: doc.nombre } : null }
  const [f] = await leer(tabla('customer_invoice').select('pdf_path, number_text').eq('account_id', accountId).eq('entry_id', entryId).neq('status', 'borrador').limit(1), 'el PDF de la factura')
  if (!f?.pdf_path) return null
  const url = await urlDelPdf(String(f.pdf_path))
  return url ? { url, titulo: `La factura ${String(f.number_text ?? '')}` } : null
}

/**
 * El cobro APUNTADO de una emitida (la hecha sola): el apunte al haber de su 430
 * con el número de la factura en un asiento validado, y la cuenta de su debe
 * (desde el X23, cualquiera que no sea la del propio cliente). null si no hay ninguno: está pendiente de cobrar (Julio, 19/11:
 * «vacío quiere decir pendiente de cobrar»; nunca la propuesta de su ficha).
 */
export async function cobroDeLaFactura(accountId: string, companyId: string, subcuentaId: string, numero: string): Promise<{ cuenta: string; nombre: string; fecha: string; importe: number } | null> {
  if (!numero.trim()) return null
  const haber = await leer(tabla('journal_line').select('entry_id, credit, journal_entry!inner(entry_date, status)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('company_account_id', subcuentaId).gt('credit', 0)
    // El número en el documento (el cobro en efectivo, el de Facturación) o en el concepto (conta_banco_a_mano no pone documento).
    .or(`document_ref.eq."${numero.trim()}",concept.eq."Cobro factura ${numero.trim()}"`)
    .eq('journal_entry.status', 'validado').limit(20), 'su cobro')
  const ultimo = haber.sort((a, b) => String((b.journal_entry as Fila).entry_date).localeCompare(String((a.journal_entry as Fila).entry_date)))[0]
  if (!ultimo) return null
  const debe = await leer(tabla('journal_line').select('company_account_id, company_account(code, name, plain_name)').eq('account_id', accountId).eq('entry_id', String(ultimo.entry_id)).gt('debit', 0), 'la cuenta de su cobro')
  // X23 · Se cobra con cualquier cuenta (no solo las 57): la del debe que no es la del propio cliente.
  const c = debe.filter((x) => String(x.company_account_id) !== subcuentaId).map((x) => x.company_account as Fila | null).find((x) => x && String(x.code))
  if (!c) return null
  return { cuenta: String(c.code), nombre: String(c.name ?? ''), fecha: String((ultimo.journal_entry as Fila).entry_date), importe: n(ultimo.credit) }
}
