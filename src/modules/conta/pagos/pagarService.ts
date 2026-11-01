// src/modules/conta/pagos/pagarService.ts
//
// B01 Revolut · PR 2c-2 · LO QUE LEE Y ESCRIBE «PAGAR CON REVOLUT», sin React.
// Quién puede qué lo decide la base (la 1234 y la 1614); aquí solo se llama:
//   · cuentasParaPagar: las cuentas de la empresa ligadas a un banco con el que
//     se puede pagar desde Sumied (hoy, Revolut).
//   · preparar: el panel (conta_pago_preparar). No escribe nada.
//   · titular: lo que dice el banco del titular del IBAN (conta-pagar).
//   · aprobar, mandar, verLote, cancelar: el pago y su segunda aprobación.
//   · pagoVivo: el pago de una factura que aún no ha acabado, para enseñarlo.
// Pruebas: tests/unit/modules/conta/pagos/pagarPantalla.test.ts.

import { rpc, tabla } from '@/modules/conta/services/bd'
import { pagar } from '@/modules/conta/pagos/llaveNavegador'

export interface CuentaParaPagar { id: string; nombre: string; iban4: string | null; banco: string }

/** Las cuentas desde las que se puede pagar con Sumied: ligadas a Revolut y activas. */
export async function cuentasParaPagar(companyId: string): Promise<CuentaParaPagar[]> {
  const { data: links, error } = await tabla('bank_aggregator_link').select('treasury_account_id')
    .eq('company_id', companyId).eq('provider', 'revolut').eq('status', 'activo')
  if (error) throw new Error(`No se han podido leer las cuentas del banco: ${error.message}`)
  const ids = ((links ?? []) as unknown as { treasury_account_id: string }[]).map((l) => l.treasury_account_id)
  if (!ids.length) return []
  const { data: cuentas, error: e2 } = await tabla('treasury_account').select('id, name, iban, is_active').in('id', ids)
  if (e2) throw new Error(`No se han podido leer las cuentas del banco: ${e2.message}`)
  return ((cuentas ?? []) as unknown as { id: string; name: string; iban: string | null; is_active: boolean }[])
    .filter((c) => c.is_active)
    .map((c) => ({ id: c.id, nombre: c.name, iban4: c.iban ? c.iban.replace(/\s/g, '').slice(-4) : null, banco: 'Revolut' }))
}

export interface Preparado {
  sePuede: boolean
  porque: string | null
  numero: string | null
  beneficiario: string | null
  iban4: string | null
  ibanCheck: 'comprobado' | 'primer_pago' | 'cambiado' | string | null
  ibanNota: string | null
  importe: number
  concepto: string | null
  motivos: string[]
  motivosTexto: string[]
  salida: { banco: string | null; puede: boolean; porque: string | null }
  quien: { yoPuedo: boolean; soyAdmin: boolean; segunda: 'otra' | 'la_misma'; personas: { nombre: string; yo: boolean }[] }
}

type Fila = Record<string, unknown>
const str = (x: unknown) => (typeof x === 'string' && x ? x : null)
const num = (x: unknown) => (x == null ? 0 : Number(x))

export function preparadoDe(d: Fila): Preparado {
  const s = (d.salida ?? {}) as Fila, q = (d.quien ?? {}) as Fila
  return {
    sePuede: d.se_puede === true, porque: str(d.porque), numero: str(d.numero), beneficiario: str(d.beneficiario), iban4: str(d.iban4),
    ibanCheck: str(d.iban_check), ibanNota: str(d.iban_nota), importe: num(d.importe), concepto: str(d.concepto),
    motivos: ((d.motivos as unknown[]) ?? []).map(String), motivosTexto: ((d.motivos_texto as unknown[]) ?? []).map(String),
    salida: { banco: str(s.banco), puede: s.puede === true, porque: str(s.porque) },
    quien: { yoPuedo: q.yo_puedo === true, soyAdmin: q.soy_admin === true, segunda: q.segunda === 'otra' ? 'otra' : 'la_misma',
      personas: ((q.personas as Fila[]) ?? []).map((p) => ({ nombre: String(p.nombre ?? ''), yo: p.yo === true })) },
  }
}

export const preparar = async (companyId: string, facturaId: string, cuentaId: string) =>
  preparadoDe(await rpc<Fila>('conta_pago_preparar', { p_company: companyId, p_invoice: facturaId, p_treasury: cuentaId }))

export type Titular =
  | { resultado: 'coincide' }
  | { resultado: 'se_parece'; nombreReal: string }
  | { resultado: 'no_coincide' }
  | { resultado: 'no_se_puede'; porque: string }
  | { resultado: 'ahora_no'; porque: string }

/** Lo que dice el banco del titular. Si no se puede preguntar, lo dice y no para. */
export async function titular(companyId: string, facturaId: string, cuentaId: string): Promise<{ ok: true; titular: Titular | null } | { ok: false; texto: string }> {
  const r = await pagar<{ titular?: Titular }>('titular', { empresa: companyId, factura: facturaId, banco: cuentaId })
  return r.ok ? { ok: true, titular: r.titular ?? null } : { ok: false, texto: r.texto }
}

/** La frase de la línea «Titular» del panel (maqueta v2, pantallas 3 y 5). */
export function textoTitular(t: Titular | null, beneficiario: string | null, banco = 'Revolut'): { tono: 'ok' | 'duda' | 'falta'; texto: string } {
  if (!t) return { tono: 'duda', texto: `Comprobando con ${banco}…` }
  switch (t.resultado) {
    case 'coincide': return { tono: 'ok', texto: `✓ ${banco} dice que coincide` }
    case 'se_parece': return { tono: 'duda', texto: `${banco} dice que se parece: el titular es «${t.nombreReal}». Si es el mismo, sigue.` }
    case 'no_coincide': return { tono: 'falta', texto: `No se ha pagado: el titular de esa cuenta no es ${beneficiario ?? 'el proveedor'}. ${banco} ha preguntado al banco del IBAN y dice que el nombre no coincide; no nos dice de quién es. Antes de pagar, confirma con el proveedor que es su cuenta.` }
    case 'no_se_puede': return { tono: 'duda', texto: `${banco} no puede comprobar el titular de este IBAN (${t.porque}). Compruébalo con el proveedor si es nuevo.` }
    case 'ahora_no': return { tono: 'duda', texto: `${banco} no ha contestado ahora sobre el titular (${t.porque}). Puedes seguir; la segunda aprobación sigue haciendo falta si el IBAN es nuevo.` }
  }
}

export interface Aprobado {
  lote: string; estado: 'listo' | 'esperando_segunda'; pagos: number; total: number; frase: string
  segunda: { quien: 'otra' | 'la_misma'; motivosTexto: string[]; personas: string[] } | null
}

export async function aprobar(companyId: string, cuentaId: string, facturaId: string, pagarIgualPorque: string | null): Promise<Aprobado> {
  const d = await rpc<Fila>('conta_pago_aprobar', { p_company: companyId, p_treasury: cuentaId,
    p_facturas: [{ id: facturaId, ...(pagarIgualPorque ? { pagar_igual_porque: pagarIgualPorque } : {}) }] })
  const s = d.segunda as Fila | null
  return {
    lote: String(d.lote), estado: d.estado === 'listo' ? 'listo' : 'esperando_segunda', pagos: num(d.pagos), total: num(d.total), frase: String(d.frase ?? ''),
    segunda: s ? { quien: s.quien === 'otra' ? 'otra' : 'la_misma', motivosTexto: ((s.motivos_texto as unknown[]) ?? []).map(String), personas: ((s.personas as unknown[]) ?? []).map(String) } : null,
  }
}

/** Manda al banco un lote «listo». Dice lo que ha pasado (regla 8). */
export async function mandar(companyId: string, lote: string): Promise<{ ok: boolean; texto: string }> {
  const r = await pagar<{ texto?: string }>('mandar', { empresa: companyId, lote })
  return { ok: r.ok, texto: r.texto ?? (r.ok ? 'Enviado al banco.' : 'No se ha podido mandar.') }
}

export async function preguntarEstado(companyId: string, lote: string): Promise<{ ok: boolean; texto: string }> {
  const r = await pagar<{ preguntados?: number; cambiados?: number }>('estado', { empresa: companyId, lote })
  if (!r.ok) return { ok: false, texto: r.texto }
  const n = r.preguntados ?? 0, c = r.cambiados ?? 0
  return { ok: true, texto: n === 0 ? 'No hay nada esperando respuesta del banco.' : c === 0 ? `Preguntado al banco: ${n === 1 ? 'el pago sigue' : `los ${n} pagos siguen`} igual.` : `Preguntado al banco: ${c} de ${n} ${c === 1 ? 'ha cambiado' : 'han cambiado'}.` }
}

export interface PagoDelLote { id: string; factura: string; concepto: string | null; beneficiario: string; iban4: string; ibanCheck: string | null; importe: number; estado: string; motivosTexto: string[] }
export interface Lote {
  id: string; estado: string; huella: string; aprobadoPor: string | null; creado: string
  desde: { nombre: string; iban4: string | null; banco: string }
  motivosTexto: string[]; puedoDar: boolean; noPuedoPorque: string | null
  segunda: { por: string; at: string; via: string } | null
  total: number; pagos: PagoDelLote[]; historial: { at: string; por: string | null; texto: string }[]
}

export function loteDe(d: Fila): Lote {
  const de = (d.desde ?? {}) as Fila, s = d.segunda as Fila | null
  return {
    id: String(d.lote), estado: String(d.estado), huella: String(d.huella), aprobadoPor: str(d.aprobado_por), creado: String(d.creado),
    desde: { nombre: String(de.nombre ?? ''), iban4: str(de.iban4), banco: String(de.banco ?? 'Revolut') },
    motivosTexto: ((d.motivos_texto as unknown[]) ?? []).map(String), puedoDar: d.puedo_dar === true, noPuedoPorque: str(d.no_puedo_porque),
    segunda: s ? { por: String(s.por ?? ''), at: String(s.at ?? ''), via: String(s.via ?? '') } : null,
    total: num(d.total),
    pagos: ((d.pagos as Fila[]) ?? []).map((p) => ({ id: String(p.id), factura: String(p.factura), concepto: str(p.concepto), beneficiario: String(p.beneficiario ?? ''),
      iban4: String(p.iban4 ?? ''), ibanCheck: str(p.iban_check), importe: num(p.importe), estado: String(p.estado), motivosTexto: ((p.motivos_texto as unknown[]) ?? []).map(String) })),
    historial: ((d.historial as Fila[]) ?? []).map((h) => ({ at: String(h.at), por: str(h.por), texto: String(h.texto) })),
  }
}

export const verLote = async (lote: string) => loteDe(await rpc<Fila>('conta_pago_lote_ver', { p_lote: lote }))
export const cancelar = (lote: string, porque: string) => rpc<{ frase: string }>('conta_pago_cancelar', { p_lote: lote, p_porque: porque })

/** El pago de una factura que todavía no ha acabado (o el último, si ya acabó), para enseñarlo en su ficha. */
export async function pagoDeLaFactura(facturaId: string): Promise<{ lote: string; estado: string; estadoPorque: string | null; importe: number; at: string } | null> {
  const { data, error } = await tabla('conta_pago_salida').select('lote_id, estado, estado_porque, amount, created_at')
    .eq('invoice_id', facturaId).order('created_at', { ascending: false }).limit(1)
  if (error) {
    // Antes de la 1234 en este entorno: no hay pagos por el banco todavía.
    if (error.code === 'PGRST205' || error.code === '42P01') return null
    throw new Error(`No se ha podido leer el pago de la factura: ${error.message}`)
  }
  const f = ((data ?? []) as unknown as { lote_id: string; estado: string; estado_porque: string | null; amount: number; created_at: string }[])[0]
  return f ? { lote: f.lote_id, estado: f.estado, estadoPorque: f.estado_porque, importe: Number(f.amount), at: f.created_at } : null
}

/** Lo que dice la ficha de un pago por el banco, según su estado (regla 8). */
export function lineaDelPago(p: { estado: string; estadoPorque: string | null }, banco = 'Revolut'): { tono: 'ok' | 'duda' | 'falta'; texto: string; vivo: boolean } {
  switch (p.estado) {
    case 'esperando_segunda': return { tono: 'duda', texto: 'Aprobado, esperando la segunda aprobación. Hasta entonces no sale nada.', vivo: true }
    case 'lista': return { tono: 'duda', texto: `Aprobado y confirmado: falta mandarlo a ${banco}.`, vivo: true }
    case 'enviando': case 'enviada': return { tono: 'duda', texto: `Enviado a ${banco}. Te avisamos cuando lo confirme.`, vivo: true }
    case 'esperando_banco': return { tono: 'duda', texto: `Esperando aprobación en ${banco}: alguien tiene que aprobarlo allí.`, vivo: true }
    case 'pagada': return { tono: 'ok', texto: `${banco} lo ha pagado. La factura queda pagada al casar su cargo en Bancos.`, vivo: false }
    case 'rechazada': return { tono: 'falta', texto: `${banco} no lo ha pagado${p.estadoPorque ? `: «${p.estadoPorque}»` : ''}. La factura sigue por pagar.`, vivo: false }
    case 'devuelta': return { tono: 'falta', texto: `${banco} ha devuelto este pago${p.estadoPorque ? `: «${p.estadoPorque}»` : ''}. La factura vuelve a estar por pagar.`, vivo: false }
    case 'cancelada': return { tono: 'duda', texto: `No pagado: ${p.estadoPorque ?? 'cancelado'}. La factura sigue por pagar.`, vivo: false }
    default: return { tono: 'duda', texto: `El pago está «${p.estado}».`, vivo: false }
  }
}

/** Lo que espera MI segunda aprobación (conta_pago_para_mi): solo con dos o más personas que pagan. */
export async function paraMi(companyId: string): Promise<{ lote: string; aprobadoPor: string | null; creado: string; total: number; pagos: number }[]> {
  try {
    const d = await rpc<Fila[]>('conta_pago_para_mi', { p_company: companyId })
    return (d ?? []).map((x) => ({ lote: String(x.lote), aprobadoPor: str(x.aprobado_por), creado: String(x.creado), total: num(x.total), pagos: num(x.pagos) }))
  } catch (e) {
    // Quien no es de la empresa (o un entorno sin la 1234) no tiene nada que aprobar: no es un fallo de la pantalla.
    if (e instanceof Error && /no existe|does not exist|PGRST202/.test(e.message)) return []
    throw e
  }
}
