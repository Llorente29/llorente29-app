// src/modules/conta/nucleo/recibida/pagoServicio.ts
//
// K06 · Lo que la ficha de la recibida del núcleo lee y hace para «Cómo se
// paga» (la cuenta del pago). Cada lectura filtra por la cuenta (regla 9).
//
//   · Las cuentas que valen para pagar (F4): desde el X21b (Julio, 21/11),
//     cualquier subcuenta del plan que no esté cerrada, con las tesorerías
//     (banco, tarjeta o caja, que van por Bancos) primero, después el resto del
//     grupo 5 y las 430 de las plataformas, y después las demás.
//   · Del proveedor: si es una plataforma (su papel «platform»), con su 430; y
//     las cuentas de sus últimos pagos (los de supplier_invoice_payment con su
//     asiento, y los «Ya la he pagado» que esperan el cargo, con su banco).
//   · De la factura: si tiene liquidación de la que descontarla
//     (conta_comision_de_la_factura: ligada, o la base ya sabe cuál).
//   · Apuntar el pago al validar: el banco, por conta_pago_a_mano (lo de
//     Pagos); otra cuenta, por conta_recibida_pagar_con_cuenta (0840). La 430
//     de la plataforma no se apunta aquí: la forma de pago «compensation» se
//     guarda antes de validar, y al validarla la paga la base con su liquidación.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { pagoAMano } from '@/modules/conta/services/pagosService'
import { leerComision } from '@/modules/conta/services/comisionService'
import { cuentasParaMover } from '@/modules/conta/lib/cuentasParaMover'
import type { CuentaDelPlan } from '../ficha/teclas'
import type { QueHaceElPago } from './pago'

type Fila = Record<string, unknown>
async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}
// K08 · El nombre guardado en el plan, nunca su explicación (Julio, 21/11).
const nombreDe = (c: Fila) => String(c.name ?? '')

export interface CuentasDePago {
  /** Las que salen con F4: todas las subcuentas abiertas; tesorerías, grupo 5 y las 430 de las plataformas primero. */
  lista: CuentaDelPlan[]
  /** El nombre de cada cuenta del plan, por su código. */
  nombres: Map<string, string>
  /** Las tesorerías (banco, tarjeta, caja), por el código de su subcuenta → su id. */
  tesorerias: Map<string, string>
}

/** Las cuentas del pago de la empresa, una vez por empresa. */
export async function cuentasDePago(accountId: string, companyId: string): Promise<CuentasDePago> {
  const [plan, enlaces, roles] = await Promise.all([
    leer(tabla('company_account').select('id, code, name, kind, status').eq('account_id', accountId).eq('company_id', companyId), 'el plan'),
    leer(tabla('company_account_link').select('entity, entity_id, role, company_account_id').eq('account_id', accountId).eq('company_id', companyId).in('entity', ['bank_account', 'customer']).eq('role', 'principal'), 'los enlaces del plan'),
    leer(tabla('party_role').select('party_id').eq('account_id', accountId).eq('role', 'platform'), 'las plataformas'),
  ])
  const porId = new Map(plan.map((c) => [String(c.id), c]))
  const plataformas = new Set(roles.map((r) => String(r.party_id)))
  const de430 = new Set(enlaces.filter((l) => l.entity === 'customer' && plataformas.has(String(l.entity_id))).map((l) => String(l.company_account_id)))
  const tesorerias = new Map<string, string>()
  for (const l of enlaces.filter((x) => x.entity === 'bank_account')) {
    const c = porId.get(String(l.company_account_id))
    if (c) tesorerias.set(String(c.code), String(l.entity_id))
  }
  // X21b · El plan entero (regla 30): «No está» solo si no existe. Primero lo de siempre para pagar (la pieza del cobro, X23).
  const lista = cuentasParaMover(plan, { tesorerias: new Set(tesorerias.keys()), delante: (c) => de430.has(String(c.id)) })
    .map((c) => ({ codigo: String(c.code), nombre: nombreDe(c) }))
  return { lista, nombres: new Map(plan.map((c) => [String(c.code), nombreDe(c)])), tesorerias }
}

export interface PagoDelProveedor {
  /** Si es una plataforma: su nombre y su 430 (null si no la tiene). */
  plataforma: { nombre: string; cuenta430: string | null } | null
  /** Las cuentas de sus últimos pagos, del más nuevo al más viejo (sin las compensaciones). */
  ultimas: string[]
}

/** Del proveedor: si es una plataforma (con su 430) y las cuentas de sus últimos pagos en esta empresa. */
export async function pagoDelProveedor(accountId: string, companyId: string, supplierId: string, subcuentaProveedor: string | null): Promise<PagoDelProveedor> {
  const [rolesProv, pagos, remesas] = await Promise.all([
    leer(tabla('party_role').select('party_id').eq('account_id', accountId).eq('supplier_id', supplierId).eq('role', 'supplier'), 'el contacto del proveedor'),
    leer(tabla('supplier_invoice_payment').select('paid_on, created_at, method, entry_id, supplier_invoice!inner(supplier_id)')
      .eq('account_id', accountId).eq('company_id', companyId).eq('supplier_invoice.supplier_id', supplierId)
      .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(10), 'sus pagos'),
    leer(tabla('conta_pago_remesa_linea_estado').select('created_at, estado, remesa_id')
      .eq('account_id', accountId).eq('company_id', companyId).eq('supplier_id', supplierId).in('estado', ['pendiente', 'por_confirmar'])
      .order('created_at', { ascending: false }).limit(5), 'sus pagos que esperan el cargo'),
  ])
  // ¿Es una plataforma? El mismo contacto con el papel «platform» (como cargarContexto), y su 430.
  let plataforma: PagoDelProveedor['plataforma'] = null
  const party = rolesProv[0] ? String(rolesProv[0].party_id) : null
  if (party) {
    const [plat, enl] = await Promise.all([
      leer(tabla('party_role').select('party_id, party:party_id(name)').eq('account_id', accountId).eq('party_id', party).eq('role', 'platform').limit(1), 'si es una plataforma'),
      leer(tabla('company_account_link').select('company_account:company_account_id(code)').eq('account_id', accountId).eq('company_id', companyId)
        .eq('entity', 'customer').eq('entity_id', party).eq('role', 'principal').limit(1), 'la 430 de la plataforma'),
    ])
    if (plat.length) {
      const c = (enl[0]?.company_account as Fila | null | undefined) ?? null
      plataforma = { nombre: String((plat[0].party as Fila | null)?.name ?? 'la plataforma'), cuenta430: c ? String(c.code) : null }
    }
  }
  // La cuenta de cada pago: la del haber de su asiento que no es la del proveedor.
  const conAsiento = pagos.filter((p) => p.entry_id && p.method !== 'compensation')
  const ids = [...new Set(conAsiento.map((p) => String(p.entry_id)))]
  const haberDe = new Map<string, string>()
  if (ids.length) {
    const lineas = await leer(tabla('journal_line').select('entry_id, credit, company_account(code)').eq('account_id', accountId).in('entry_id', ids).gt('credit', 0), 'los asientos de sus pagos')
    for (const l of lineas) {
      const code = String((l.company_account as Fila | null)?.code ?? '')
      if (!code || code === subcuentaProveedor || /^4[01]/.test(code)) continue
      if (!haberDe.has(String(l.entry_id))) haberDe.set(String(l.entry_id), code)
    }
  }
  const fechadas: { fecha: string; cuenta: string }[] = conAsiento
    .map((p) => ({ fecha: String(p.paid_on), cuenta: haberDe.get(String(p.entry_id)) ?? '' }))
    .filter((x) => x.cuenta)
  // Los «Ya la he pagado» que esperan el cargo: la subcuenta de su banco (la remesa, leída aparte: la lista es una vista).
  const idsRemesa = [...new Set(remesas.map((r) => String(r.remesa_id)))]
  const remesaDe = new Map((idsRemesa.length ? await leer(tabla('conta_pago_remesa').select('id, pay_date, treasury_account_id').eq('account_id', accountId).in('id', idsRemesa), 'sus remesas') : [])
    .map((r) => [String(r.id), r]))
  const tesos = [...new Set([...remesaDe.values()].map((r) => String(r.treasury_account_id ?? '')).filter(Boolean))]
  if (tesos.length) {
    const enl = await leer(tabla('company_account_link').select('entity_id, company_account:company_account_id(code)').eq('account_id', accountId).eq('company_id', companyId)
      .eq('entity', 'bank_account').eq('role', 'principal').in('entity_id', tesos), 'el banco de sus pagos')
    const codigo = new Map(enl.map((e) => [String(e.entity_id), String((e.company_account as Fila | null)?.code ?? '')]))
    for (const r of remesas) {
      const rem = remesaDe.get(String(r.remesa_id))
      if (!rem) continue
      const c = codigo.get(String(rem.treasury_account_id ?? ''))
      if (c) fechadas.push({ fecha: String(rem.pay_date ?? r.created_at ?? ''), cuenta: c })
    }
  }
  const ultimas = fechadas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map((x) => x.cuenta)
  return { plataforma, ultimas }
}

/** ¿Tiene la factura liquidación de la que descontarla? Ligada, o la base ya sabe cuál («una»). */
export async function hayLiquidacion(invoiceId: string): Promise<boolean> {
  const e = await leerComision(invoiceId)
  return e.estado === 'ligada' || e.estado === 'una'
}

/** Apunta el pago de una recibida ya validada. Siempre una frase (regla 8). */
export async function apuntarPago(o: { companyId: string; facturaId: string; pago: Extract<QueHaceElPago, { que: 'banco' | 'otra' }>; quien: string | null }): Promise<string> {
  if (o.pago.que === 'banco') {
    const r = await pagoAMano(o.companyId, o.facturaId, o.pago.tesoreriaId, o.pago.fecha, o.pago.importe)
    return r.frase
  }
  const r = await rpc<{ frase?: string }>('conta_recibida_pagar_con_cuenta', { p_company: o.companyId, p_invoice: o.facturaId, p_cuenta: o.pago.cuenta, p_fecha: o.pago.fecha, p_quien_nombre: o.quien })
  return r?.frase ?? `Pago apuntado con la ${o.pago.cuenta}.`
}
