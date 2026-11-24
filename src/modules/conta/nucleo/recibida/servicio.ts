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
import { claseIva, type FichaIva } from '@/modules/conta/lib/ivaProveedor'
import { esOperacion, operacionDeLaClase, presentadosDe, type Operacion } from './cabecera'

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
  /** K10b · El tipo de operación que le da su ficha (país, NIF-IVA, VIES y régimen): con el que nace cada factura suya. */
  operacion: Operacion | null
  /** Su subcuenta (la 400/410 de su ficha), o null. */
  subcuenta: { id: string; codigo: string; nombre: string } | null
  /** X27 · La «Subcuenta de gasto» de su ficha en esta empresa (papel «gasto»), o null: la propone la recibida a mano. */
  gasto: string | null
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
  const [{ data: p, error: ep }, { data: l, error: el }, { data: g }] = await Promise.all([
    tabla('supplier').select('vat_regime, country_code, tax_id_type, tax_id, tax_id_check_status').eq('account_id', accountId).eq('id', supplierId).maybeSingle(),
    tabla('company_account_link').select('company_account:company_account_id(id, code, name)')
      .eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'supplier').eq('entity_id', supplierId).eq('role', 'principal').maybeSingle(),
    tabla('company_account_link').select('company_account:company_account_id(code)')
      .eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'supplier').eq('entity_id', supplierId).eq('role', 'gasto').limit(1),
  ])
  if (ep) throw new Error(`No se ha podido leer la ficha del proveedor: ${ep.message}`)
  if (el) throw new Error(`No se ha podido leer la subcuenta del proveedor: ${el.message}`)
  const c = (l as Fila | null)?.company_account as Fila | null | undefined
  const pf = (p as Fila | null) ?? {}
  return {
    regimen: s(pf.vat_regime),
    operacion: p ? operacionDeLaClase(claseIva({ pais: s(pf.country_code), tipoNif: s(pf.tax_id_type) as FichaIva['tipoNif'], nif: s(pf.tax_id),
      vies: s(pf.tax_id_check_status) as FichaIva['vies'], regimen: s(pf.vat_regime) as FichaIva['regimen'] })) : null,
    subcuenta: c ? { id: String(c.id), codigo: String(c.code), nombre: String(c.name) } : null,
    gasto: s(((g as Fila[] | null)?.[0]?.company_account as Fila | null | undefined)?.code) || null,
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

/**
 * K09 · Las otras recibidas del mismo proveedor, con su asiento si está validado: para decir cuál es la
 * repetida (laRepetida) y abrirla. Y si en esta ya se dijo «No es la misma» o «No es repetida».
 */
export async function otrasDelProveedor(accountId: string, invoiceId: string, supplierId: string): Promise<{ otras: { id: string; numero: string; proveedor: string; asiento: string; validada: boolean }[]; confirmada: boolean }> {
  const [o, yo] = await Promise.all([
    tabla('supplier_invoice').select('id, invoice_number, status, supplier:supplier_id(name)').eq('account_id', accountId).eq('supplier_id', supplierId).not('status', 'in', '(anulada,descartada)').neq('id', invoiceId),
    tabla('supplier_invoice').select('not_duplicate_confirmed_at').eq('account_id', accountId).eq('id', invoiceId).maybeSingle(),
  ])
  if (o.error) throw new Error(`No se ha podido mirar si está repetida: ${o.error.message}`)
  const filas = (o.data ?? []) as Fila[]
  const ids = filas.map((f) => String(f.id))
  const asientos = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await tabla('journal_entry').select('source_id, series, number').eq('account_id', accountId).eq('source_type', 'supplier_invoice').eq('status', 'validado').in('source_id', ids)
    if (error) throw new Error(`No se ha podido mirar si está repetida: ${error.message}`)
    for (const e of (data ?? []) as Fila[]) asientos.set(String(e.source_id), `${e.series}/${e.number ?? '—'}`)
  }
  const confirmada = !!(yo.data as Fila | null)?.not_duplicate_confirmed_at
  return {
    otras: filas.map((f) => ({ id: String(f.id), numero: String(f.invoice_number ?? ''), proveedor: String((f.supplier as Fila | null)?.name ?? 'su proveedor'), asiento: asientos.get(String(f.id)) ?? '', validada: asientos.has(String(f.id)) })),
    confirmada,
  }
}

/** K09 · «No es la misma: …»: lo guarda la base, con su motivo, y queda en el historial (conta_recibida_no_es_la_misma). */
export async function noEsLaMisma(invoiceId: string, otraId: string, motivo: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto?: string }>('conta_recibida_no_es_la_misma', { p_invoice: invoiceId, p_otra: otraId, p_motivo: motivo, p_quien_nombre: quien })
  return r?.texto ?? 'Anotado: no es la misma. Ya se puede validar.'
}

/**
 * K10 · La contrapartida de una recibida, con cualquier subcuenta del plan (como en ERP10): primero las del 6
 * (lo de siempre), después el resto (el inmovilizado 21x, la 480…). Sin grupos ni cerradas.
 */
export async function cuentasDeContrapartida(accountId: string, companyId: string): Promise<{ codigo: string; nombre: string }[]> {
  const { data, error } = await tabla('company_account').select('code, name, kind, status').eq('account_id', accountId).eq('company_id', companyId)
  if (error) throw new Error(`No se han podido leer las cuentas: ${error.message}`)
  return ((data ?? []) as Fila[])
    .filter((x) => x.kind !== 'group' && x.status !== 'cerrada' && String(x.code).length >= 8)
    .map((x) => ({ codigo: String(x.code), nombre: String(x.name) }))
    .sort((a, b) => Number(!a.codigo.startsWith('6')) - Number(!b.codigo.startsWith('6')) || a.codigo.localeCompare(b.codigo))
}

/** K10 · El código de cada proveedor en la empresa (su subcuenta: company_account_link, papel «principal»), para buscarlo por él. */
export async function codigosDeProveedores(accountId: string, companyId: string): Promise<Map<string, string>> {
  const { data, error } = await tabla('company_account_link').select('entity_id, company_account:company_account_id(code)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'supplier').eq('role', 'principal')
  if (error) throw new Error(`No se han podido leer los códigos de los proveedores: ${error.message}`)
  return new Map(((data ?? []) as Fila[]).map((x) => [String(x.entity_id), String((x.company_account as Fila | null)?.code ?? '')]))
}

// ── K10b · La cabecera de la recibida ─────────────────────────────────────────

export interface CabeceraFactura {
  /** El tipo de operación cambiado en esta factura (null: el de su ficha). */
  operacion: Operacion | null
  /** El primer día del trimestre elegido (null: el suyo). */
  deduceEn: string | null
  /** El concepto del asiento escrito (null: el propuesto). */
  concepto: string | null
  observaciones: string | null
  marcaId: string | null
  /** ¿La base ya tiene las columnas del K10b (la 2150)? Si no, las casillas no se escriben. */
  disponible: boolean
}

/** Lo que la ficha guarda en la cabecera de la factura (2150). Sin la 2150, lo de antes: la marca y las notas. */
export async function cabeceraDeLaFactura(accountId: string, invoiceId: string): Promise<CabeceraFactura> {
  const r = await tabla('supplier_invoice').select('vat_operation, deduct_from, entry_concept, notes, brand_id').eq('account_id', accountId).eq('id', invoiceId).maybeSingle()
  if (r.error && /does not exist|could not find/i.test(r.error.message)) {
    const v = await tabla('supplier_invoice').select('notes, brand_id').eq('account_id', accountId).eq('id', invoiceId).maybeSingle()
    if (v.error) throw new Error(`No se ha podido leer la cabecera de la factura: ${v.error.message}`)
    const f = (v.data as Fila | null) ?? {}
    return { operacion: null, deduceEn: null, concepto: null, observaciones: s(f.notes), marcaId: s(f.brand_id), disponible: false }
  }
  if (r.error) throw new Error(`No se ha podido leer la cabecera de la factura: ${r.error.message}`)
  const f = (r.data as Fila | null) ?? {}
  return {
    operacion: esOperacion(f.vat_operation) ? f.vat_operation : null, deduceEn: s(f.deduct_from), concepto: s(f.entry_concept),
    observaciones: s(f.notes), marcaId: s(f.brand_id), disponible: true,
  }
}

/** Las marcas de la cuenta que se pueden poner: activas y sin archivar. Sin ninguna, la casilla no sale. */
export async function marcasParaPoner(accountId: string): Promise<{ id: string; nombre: string; codigo: string }[]> {
  const { data, error } = await tabla('brand').select('id, name, slug, is_active, archived_at').eq('account_id', accountId).order('name')
  if (error) throw new Error(`No se han podido leer las marcas: ${error.message}`)
  // K11b · El código corto (su slug, el de la analítica) para cuando el nombre no cabe en la casilla.
  return ((data ?? []) as Fila[]).filter((b) => b.is_active !== false && !b.archived_at).map((b) => ({ id: String(b.id), nombre: String(b.name), codigo: String(b.slug ?? b.name) }))
}

/** Los trimestres con el 303 presentado de la empresa, como «2026-3T» (los mismos estados que conta_iva_presentado). */
export async function trimestresPresentados(accountId: string, companyId: string): Promise<Set<string>> {
  const { data, error } = await tabla('tax_return').select('fiscal_year, period').eq('account_id', accountId).eq('company_id', companyId)
    .eq('form_code', '303').in('status', ['filed', 'booked', 'paid', 'offset', 'refunded'])
  if (error) throw new Error(`No se han podido leer los 303 presentados: ${error.message}`)
  return presentadosDe(((data ?? []) as Fila[]).map((x) => ({ ejercicio: Number(x.fiscal_year), periodo: String(x.period) })))
}

/** Guarda la cabecera (conta_recibida_cabecera, 2150): el tipo de operación, el trimestre, el concepto, las observaciones y la marca. */
export async function guardarCabecera(invoiceId: string, cambios: { operacion?: Operacion | null; deduce_en?: string | null; concepto?: string | null; observaciones?: string | null; marca?: string | null },
  quien: string | null): Promise<{ texto: string; asientoQuitado: boolean }> {
  const r = await rpc<Fila>('conta_recibida_cabecera', { p_invoice: invoiceId, p_cambios: cambios, p_quien_nombre: quien })
  return { texto: String(r.texto ?? 'Guardado.'), asientoQuitado: r.asiento_quitado === true }
}

// ── K11a · «Otros datos» y los datos de cada línea (0839) ─────────────────────

export interface Codigo { codigo: string; nombre: string }

/** Los tipos de factura y las claves de régimen (catálogos globales de la AEAT, 0839), para su lupa. */
export async function catalogosDeLaRecibida(): Promise<{ tiposFactura: Codigo[]; clavesRegimen: Codigo[] }> {
  const [t, r] = await Promise.all([
    tabla('conta_tipo_factura').select('code, nombre').order('orden'),
    tabla('conta_clave_regimen').select('code, nombre').order('orden'),
  ])
  if (t.error) throw new Error(`No se han podido leer los tipos de factura: ${t.error.message}`)
  if (r.error) throw new Error(`No se han podido leer las claves de régimen: ${r.error.message}`)
  const de = (x: unknown) => ((x ?? []) as Fila[]).map((f) => ({ codigo: String(f.code), nombre: String(f.nombre) }))
  return { tiposFactura: de(t.data), clavesRegimen: de(r.data) }
}

export interface OtrosDatos {
  /** El elegido en la factura, o el que da ella (conta_recibida_por_defecto). */
  tipoFactura: string
  claveRegimen: string
  /** ¿Elegidos en la factura? (para la casilla en ámbar o no) */
  tipoElegido: boolean
  claveElegida: boolean
  noIva: boolean
  rectificacion: boolean
  no347: boolean
  /** 0 a 100; 100 si no se dijo. */
  ivaDeducible: number
  /** K11b · Las fechas contable y fiscal escritas en la factura (K11f1: accounting_date y deduct_from); null = las de siempre. */
  fechaContable: string | null
  fechaFiscal: string | null
  lineas: { posicion: number; concepto: string | null; marcaId: string | null; canalId: string | null }[]
}

/** «Otros datos» de una recibida y los datos de sus líneas de gasto. */
export async function otrosDatosDeLaFactura(accountId: string, invoiceId: string): Promise<OtrosDatos> {
  const [f, d, def] = await Promise.all([
    tabla('supplier_invoice').select('invoice_type, regime_key, exclude_from_vat_return, deduction_rectification, exclude_from_347, vat_deductible_pct, accounting_date, deduct_from')
      .eq('account_id', accountId).eq('id', invoiceId).maybeSingle(),
    tabla('supplier_invoice_expense_dato').select('position, concept, brand_id, channel_id').eq('account_id', accountId).eq('supplier_invoice_id', invoiceId).order('position'),
    rpc<Fila | null>('conta_recibida_por_defecto', { p_invoice: invoiceId }),
  ])
  if (f.error) throw new Error(`No se han podido leer los otros datos de la factura: ${f.error.message}`)
  if (d.error) throw new Error(`No se han podido leer los datos de sus líneas: ${d.error.message}`)
  const x = (f.data as Fila | null) ?? {}
  const pct = x.vat_deductible_pct === null || x.vat_deductible_pct === undefined ? 100 : Number(x.vat_deductible_pct)
  return {
    tipoFactura: s(x.invoice_type) ?? s(def?.tipo_factura) ?? 'F1', claveRegimen: s(x.regime_key) ?? s(def?.clave_regimen) ?? '01',
    tipoElegido: !!s(x.invoice_type), claveElegida: !!s(x.regime_key),
    noIva: x.exclude_from_vat_return === true, rectificacion: x.deduction_rectification === true, no347: x.exclude_from_347 === true,
    ivaDeducible: pct, fechaContable: s(x.accounting_date), fechaFiscal: s(x.deduct_from),
    lineas: ((d.data ?? []) as Fila[]).map((l) => ({ posicion: Number(l.position), concepto: s(l.concept), marcaId: s(l.brand_id), canalId: s(l.channel_id) })),
  }
}

/** Guarda «Otros datos» y los datos de las líneas (conta_recibida_otros_datos, 0839; por clave desde la 20261123T1750). */
export async function guardarOtrosDatos(invoiceId: string, cambios: {
  tipo_factura?: string | null; clave_regimen?: string | null; no_iva?: boolean; rectificacion?: boolean; no_347?: boolean; iva_deducible?: number | null
  fecha_contable?: string | null; fecha_fiscal?: string | null
  /** Por línea, solo las claves que cambian: la que no viene se queda; con null, se borra (20261123T1750). */
  lineas?: { posicion: number; concepto?: string | null; marca?: string | null; plataforma?: string | null }[]
}, quien: string | null): Promise<{ texto: string; asientoQuitado: boolean }> {
  const r = await rpc<Fila>('conta_recibida_otros_datos', { p_invoice: invoiceId, p_cambios: cambios, p_quien_nombre: quien })
  return { texto: String(r.texto ?? 'Guardado.'), asientoQuitado: r.asiento_quitado === true }
}
