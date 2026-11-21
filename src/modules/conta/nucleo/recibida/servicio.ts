// src/modules/conta/nucleo/recibida/servicio.ts
//
// K04 · Lo que la ficha de la recibida del núcleo lee de más, además de lo que
// ya lee la pantalla de hoy (documentosService, que no se toca: lo lleva la
// sesión R). Todo es lectura, con las tablas y funciones que ya usa la
// contabilidad; nada escribe aquí. Cada lectura filtra por la cuenta (regla 9).
//
//   · Del proveedor: su régimen de IVA («Tipo de operación», de su ficha), su
//     subcuenta y su mayor (los apuntes validados de esa subcuenta), y con él,
//     el saldo a hoy.
//   · La duda de la cuenta de gasto: conta_gasto_aprendido (0250), con su
//     reparto por cuenta.
//   · Las cuentas de una recibida escrita a mano, antes de existir (no hay
//     propuesta que leer): la 472 de cada tipo y la 4751, con los mismos
//     enlaces que la propuesta (cargarContexto), una vez por empresa. La
//     subcuenta del proveedor sale de delProveedor.
//   · La marca que tiene la factura (no se puede cambiar desde aquí: 0790 no
//     la guarda).

import { rpc, tabla } from '@/modules/conta/services/bd'
import { apuntesDeCuentas } from '@/modules/conta/services/libroService'
import { cargarContexto } from '@/modules/conta/services/propuestasLibroService'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'
import type { CuentasFicha } from '@/modules/conta/documentos/fichaRecibida'

type Fila = Record<string, unknown>
const s = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null)

/**
 * Cómo se dice el régimen de IVA de la ficha del proveedor, en la casilla «Tipo de operación».
 * Los valores son los de supplier_vat_regime_check (20261002T0100), comprobados contra el esquema.
 */
export const OPERACION: Readonly<Record<string, string>> = {
  general: 'Operaciones interiores',
  recargo_equivalencia: 'Recargo de equivalencia',
  intracomunitario: 'Adquisición intracomunitaria',
  exento: 'Exenta',
  inversion_sujeto_pasivo: 'Inversión del sujeto pasivo',
  extranjero: 'Fuera de la UE',
}
export const textoOperacion = (regimen: string | null): string | null => (regimen ? OPERACION[regimen] ?? regimen : null)

export interface DelProveedor {
  regimen: string | null
  /** Su subcuenta (la 400/410 de su ficha), o null. */
  subcuenta: { id: string; codigo: string; nombre: string } | null
}

/** K08 · Las subcuentas de proveedores y acreedores de la empresa (400/410) y sus cifras: para decir cuál le tocará a uno nuevo. */
export async function subcuentasDeProveedores(accountId: string, companyId: string): Promise<{ ocupados: Set<string>; digitos: number }> {
  const { data, error } = await tabla('company_account').select('code').eq('account_id', accountId).eq('company_id', companyId).or('code.like.400%,code.like.410%')
  if (error) throw new Error(`No se han podido leer las cuentas de proveedores: ${error.message}`)
  const ocupados = new Set(((data ?? []) as Fila[]).map((x) => String(x.code)))
  const digitos = [...ocupados].find((c) => /^\d+$/.test(c))?.length ?? 8
  return { ocupados, digitos }
}

/** El régimen de IVA y la subcuenta del proveedor. */
export async function delProveedor(accountId: string, companyId: string, supplierId: string): Promise<DelProveedor> {
  const [{ data: p, error: ep }, { data: l, error: el }] = await Promise.all([
    tabla('supplier').select('vat_regime').eq('account_id', accountId).eq('id', supplierId).maybeSingle(),
    tabla('company_account_link').select('company_account:company_account_id(id, code, name)')
      .eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'supplier').eq('entity_id', supplierId).eq('role', 'principal').maybeSingle(),
  ])
  if (ep) throw new Error(`No se ha podido leer la ficha del proveedor: ${ep.message}`)
  if (el) throw new Error(`No se ha podido leer la subcuenta del proveedor: ${el.message}`)
  const c = (l as Fila | null)?.company_account as Fila | null | undefined
  return {
    regimen: s((p as Fila | null)?.vat_regime),
    subcuenta: c ? { id: String(c.id), codigo: String(c.code), nombre: String(c.name) } : null,
  }
}

/** El mayor del proveedor: sus apuntes validados, y el saldo a hoy (lo que le debes: haber − debe). */
export async function mayorDelProveedor(accountId: string, companyId: string, subcuentaId: string, hoy: string): Promise<{ apuntes: Apunte[]; saldo: number }> {
  const todos = await apuntesDeCuentas(accountId, companyId, [subcuentaId])
  const apuntes = todos.filter((a) => a.fecha <= hoy && !a.asiento?.anulado)
  const saldo = apuntes.reduce((t, a) => t + Math.round(a.haber * 100) - Math.round(a.debe * 100), 0) / 100
  return { apuntes, saldo }
}

export interface Aprendido {
  cuenta: string | null
  confianza: 'seguro' | 'probable' | null
  facturas: number
  reparto: { cuenta: string; nombre: string; facturas: number; ultima: string }[]
}

/** La cuenta de gasto aprendida de sus facturas anteriores, con el reparto por cuenta (0250). */
export async function gastoAprendido(companyId: string, supplierId: string): Promise<Aprendido> {
  const r = await rpc<Fila | null>('conta_gasto_aprendido', { p_company: companyId, p_supplier: supplierId })
  const reparto = Array.isArray(r?.reparto) ? (r!.reparto as Fila[]).map((x) => ({
    cuenta: String(x.cuenta), nombre: String(x.nombre ?? ''), facturas: Number(x.facturas ?? 0), ultima: String(x.ultima ?? ''),
  })) : []
  const conf = r?.confianza === 'seguro' || r?.confianza === 'probable' ? r.confianza : null
  return { cuenta: s(r?.cuenta), confianza: conf, facturas: Number(r?.facturas ?? 0), reparto }
}

/**
 * R14 · Lo que Sumied hizo con el proveedor de esta recibida al leerla (conta_proveedor_solo):
 * lo dio de alta (alta), era uno que ya estaba (existente) o una plataforma; o por qué no.
 * null si no hizo nada (una a mano, o leída antes del R14).
 */
export interface ProveedorSolo { que: 'alta' | 'existente' | 'plataforma' | 'no'; supplierId: string | null; motivo: string | null; deshecho: boolean }

export async function proveedorSolo(invoiceId: string): Promise<ProveedorSolo | null> {
  const { data, error } = await tabla('conta_proveedor_solo').select('que, supplier_id, motivo, deshecho_at').eq('invoice_id', invoiceId).maybeSingle()
  if (error) throw new Error(`No se ha podido leer quién le puso el proveedor: ${error.message}`)
  if (!data) return null
  const r = data as Fila
  return { que: String(r.que) as ProveedorSolo['que'], supplierId: s(r.supplier_id), motivo: s(r.motivo), deshecho: r.deshecho_at != null }
}

/** R14 · «Deshacer»: la factura vuelve a no tener proveedor; lo que Sumied dio de alta sin nada más, se va. Devuelve lo que dice la base. */
export async function deshacerProveedorSolo(invoiceId: string, quien: string | null): Promise<string> {
  const r = await rpc<Fila>('conta_proveedor_solo_deshacer', { p_invoice: invoiceId, p_quien_nombre: quien })
  return String(r?.texto ?? 'Deshecho.')
}

/** R14 · La cuenta de gasto propuesta para un proveedor sin historial en esta empresa, con su porqué (en ámbar). */
export interface GastoPropuesto { cuenta: string | null; nombre: string | null; porque: string; de: 'plataforma' | 'otra_sociedad' | 'lo_que_vende' | null }

export async function gastoPropuesto(companyId: string, supplierId: string, invoiceId: string | null): Promise<GastoPropuesto> {
  const r = await rpc<Fila | null>('conta_gasto_propuesto', { p_company: companyId, p_supplier: supplierId, p_invoice: invoiceId })
  return { cuenta: s(r?.cuenta), nombre: s(r?.nombre), porque: String(r?.porque ?? ''), de: (s(r?.de) as GastoPropuesto['de']) ?? null }
}

/** Las cuentas del asiento de una recibida escrita a mano (aún sin propuesta), con los enlaces de la propuesta: la 472 de cada tipo y la 4751. Una vez por empresa. */
export async function cuentasAMano(accountId: string, companyId: string): Promise<{ cuentas: CuentasFicha; nombres: Map<string, string>; mesesCerrados: string[]; ejercicios: { inicio: string; fin: string; abierto: boolean }[] }> {
  const ctx = await cargarContexto(accountId, companyId)
  const iva = new Map<number, { codigo: string; nombre: string }>()
  const codigos: string[] = []
  for (const t of ctx.tipos) {
    const c = ctx.enlace('tax_rate', t.id, 'soportado')
    if (c && !iva.has(t.rate)) { iva.set(t.rate, { codigo: c, nombre: '' }); codigos.push(c) }
  }
  const ret = ctx.hoja('4751')
  if (ret) codigos.push(ret)
  const nombres = new Map<string, string>()
  if (codigos.length) {
    const { data, error } = await tabla('company_account').select('code, name').eq('account_id', accountId).eq('company_id', companyId).in('code', codigos)
    if (error) throw new Error(`No se han podido leer los nombres de las cuentas: ${error.message}`)
    for (const x of (data ?? []) as Fila[]) nombres.set(String(x.code), String(x.name))
  }
  const conNombre = (codigo: string) => ({ codigo, nombre: nombres.get(codigo) ?? 'Cuenta' })
  return {
    cuentas: {
      // La del proveedor la pone la ficha (delProveedor): así esto se lee una vez por empresa.
      proveedor: null,
      iva: new Map([...iva.entries()].map(([k, v]) => [k, conNombre(v.codigo)])),
      retencion: ret ? conNombre(ret) : null,
    },
    nombres,
    mesesCerrados: [...ctx.calendario.mesesCerrados],
    ejercicios: ctx.calendario.ejercicios.map((e) => ({ inicio: e.inicio, fin: e.fin, abierto: e.abierto })),
  }
}

/** Los meses cerrados y los ejercicios de la empresa, para «El 3T está abierto». */
export async function calendarioDe(accountId: string, companyId: string): Promise<{ mesesCerrados: string[]; ejercicios: { inicio: string; fin: string; abierto: boolean }[] }> {
  const [{ data: m, error: em }, { data: e, error: ee }] = await Promise.all([
    tabla('fiscal_period_lock').select('month').eq('account_id', accountId).eq('company_id', companyId).is('reopened_at', null),
    tabla('fiscal_year').select('starts_on, ends_on, status').eq('account_id', accountId).eq('company_id', companyId),
  ])
  if (em) throw new Error(`No se han podido leer los meses cerrados: ${em.message}`)
  if (ee) throw new Error(`No se han podido leer los ejercicios: ${ee.message}`)
  return {
    mesesCerrados: ((m ?? []) as Fila[]).map((x) => String(x.month).slice(0, 7)),
    ejercicios: ((e ?? []) as Fila[]).map((x) => ({ inicio: String(x.starts_on), fin: String(x.ends_on), abierto: x.status === 'open' })),
  }
}

/** La marca de la factura (supplier_invoice.brand_id), por su nombre; null si no tiene. */
export async function marcaDeLaFactura(accountId: string, invoiceId: string): Promise<string | null> {
  const { data, error } = await tabla('supplier_invoice').select('brand:brand_id(name)').eq('account_id', accountId).eq('id', invoiceId).maybeSingle()
  if (error) throw new Error(`No se ha podido leer la marca de la factura: ${error.message}`)
  const b = (data as Fila | null)?.brand as Fila | null | undefined
  return b ? s(b.name) : null
}
