// src/modules/conta/nucleo/tesoreria/servicio.ts
//
// X28 · Lo que lee y escribe la pantalla de Tesorería. Lo de los movimientos, el cuadre y conciliar es lo de Bancos
// del núcleo (nucleo/bancos: leerBancos, confirmar, deshacer), sin un cambio. Lo nuevo:
//   · el EJERCICIO entero, como la maqueta 21 y ERP10 (respuesta X28 · 2): los movimientos del año, del más antiguo
//     al más nuevo, y el saldo del banco en el diario a la fecha (el último día del año, o hoy si es el de hoy);
//   · la empresa es de hostelería (company.sector): solo entonces salen marca y plataforma;
//   · de lo contabilizado, su asiento: número, concepto, subcuenta y analítica (journal_entry y journal_line, de esa
//     empresa: regla 9);
//   · cambiar lo contabilizado con el mismo número (conta_tesoreria_se_puede_modificar / _modificar, 0800);
//   · ⊕ otro movimiento con su analítica (conta_tesoreria_a_mano, 0800);
//   · la factura que se paga o se cobra, con lo pendiente antes de este movimiento (supplier_invoice /
//     customer_invoice y lo pagado en bank_match_item);
//   · «Leer fichero de extracto bancario» aquí mismo: el mismo camino que «Subir extracto» (abrirExtracto,
//     leerYCuadrar, importar y la pasada del agente), al banco de la pantalla.

import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import { abrirExtracto, bancos as nucleo, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosService'
import { leerMovimientosEntre, pasarAgente, type BancoVista, type DatosBancos } from '@/modules/conta/services/bancosPantallas'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { saldosDelCuadre } from '../bancos/servicio'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { pendienteAntes } from './tesoreria'

type Fila = Record<string, unknown>
const s = (x: unknown) => (x === null || x === undefined ? null : String(x))
const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)

/** La empresa es de hostelería: solo entonces salen la marca y la plataforma (respuesta X28 · 1, decisión 1). */
export async function esDeHosteleria(companyId: string): Promise<boolean> {
  const { data, error } = await tabla('company').select('sector').eq('id', companyId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer la empresa', error))
  return (data as { sector: string | null } | null)?.sector === 'hosteleria'
}

/** Lo contabilizado: su asiento, para la fila y la línea que se edita. */
export interface AsientoDeTesoreria {
  id: string; numero: number | null; serie: number | null; concepto: string
  cuenta: string | null; local: string | null; marca: string | null; plataforma: string | null
}

/** De cada asiento, el número, el concepto y la contrapartida (la primera línea que no es la del banco) con su analítica. */
export async function asientosDeTesoreria(companyId: string, ids: readonly string[], cuenta572: string | null): Promise<Record<string, AsientoDeTesoreria>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return {}
  // De 150 en 150: un ejercicio entero son miles, y la lista va en la dirección de la lectura.
  const trozos: string[][] = []
  for (let i = 0; i < unicos.length; i += 150) trozos.push(unicos.slice(i, i + 150))
  const leidos = await Promise.all(trozos.map((t) => Promise.all([
    tabla('journal_entry').select('id, number, series, concept').eq('company_id', companyId).in('id', t),
    tabla('journal_line').select('entry_id, position, concept, location_id, is_common, brand_id, channel_id, company_account:company_account_id(code)')
      .eq('company_id', companyId).in('entry_id', t).order('position'),
  ])))
  const e = { data: [] as unknown[] }, l = { data: [] as unknown[] }
  for (const [a, b] of leidos) {
    if (a.error) throw new Error(mensaje('No se han podido leer los asientos', a.error))
    if (b.error) throw new Error(mensaje('No se han podido leer los asientos', b.error))
    e.data.push(...(a.data ?? [])); l.data.push(...(b.data ?? []))
  }
  const out: Record<string, AsientoDeTesoreria> = {}
  for (const x of (e.data ?? []) as Fila[]) {
    out[String(x.id)] = { id: String(x.id), numero: x.number === null ? null : Number(x.number), serie: x.series === null ? null : Number(x.series),
      concepto: String(x.concept ?? ''), cuenta: null, local: null, marca: null, plataforma: null }
  }
  for (const x of (l.data ?? []) as unknown as (Fila & { company_account: { code: string } | null })[]) {
    const a = out[String(x.entry_id)]
    const c = x.company_account?.code ?? null
    if (!a || a.cuenta || !c || c === cuenta572) continue
    a.cuenta = c
    a.local = x.location_id ? String(x.location_id) : x.is_common ? 'comun' : null
    a.marca = s(x.brand_id); a.plataforma = s(x.channel_id)
  }
  return out
}

export interface LecturaEjercicio { movs: MovimientoBanco[]; asientos: Record<string, AsientoDeTesoreria>; saldoCent: number | null; saldoA: string }

/** El ejercicio de un banco: sus movimientos (del más antiguo al más nuevo), sus asientos y el saldo del banco en el diario. */
export async function leerEjercicio(accountId: string, companyId: string, datos: DatosBancos, banco: BancoVista, anio: string, hoy: string): Promise<LecturaEjercicio> {
  const mesCorte = anio < hoy.slice(0, 4) ? `${anio}-12` : anio > hoy.slice(0, 4) ? `${anio}-01` : hoy.slice(0, 7)
  const [movs, saldos] = await Promise.all([
    leerMovimientosEntre(accountId, banco.id, `${anio}-01-01`, `${anio}-12-31`, true),
    saldosDelCuadre(companyId, datos, banco, mesCorte, hoy),
  ])
  const asientos = await asientosDeTesoreria(companyId, movs.map((m) => m.casado?.asientoId).filter((x): x is string => !!x), banco.cuenta)
  return { movs, asientos, saldoCent: saldos.libroCent, saldoA: anio < hoy.slice(0, 4) ? `${anio}-12-31` : hoy }
}

/** Los ejercicios que se pueden elegir: los años de los meses con movimientos, el más nuevo primero. */
export const ejerciciosDe = (meses: readonly string[]): string[] => [...new Set(meses.map((m) => m.slice(0, 4)))].sort().reverse()

/** Si un movimiento contabilizado se puede cambiar (y, si no, por qué); y si se puede cambiar su subcuenta. */
export async function sePuedeModificar(asientoId: string): Promise<{ puede: boolean; porque: string | null; subcuenta: boolean; subcuentaPorque: string | null }> {
  const r = await rpc<Fila>('conta_tesoreria_se_puede_modificar', { p_asiento: asientoId })
  return { puede: r.puede === true, porque: s(r.porque), subcuenta: r.subcuenta === true, subcuentaPorque: s(r.subcuenta_porque) }
}

/** Cambiar lo contabilizado: el mismo asiento, el mismo número. Devuelve la frase de la base. */
export async function modificar(asientoId: string, cambios: Record<string, string>, quien: string | null): Promise<string> {
  const r = await rpc<Fila>('conta_tesoreria_modificar', { p_asiento: asientoId, p_cambios: cambios, p_quien_nombre: quien })
  return String(r.texto ?? 'Modificado.')
}

/** Contabilizar un movimiento del banco con su destino (lo que propone Sumied, u otra subcuenta), con su analítica. */
export async function contabilizar(movimientoId: string, destino: Destino, porque: string): Promise<{ asiento: string }> {
  const r = await nucleo.confirmar(movimientoId, porque, destino, 'probable', null)
  return { asiento: r.asiento }
}

/** ⊕ otro movimiento: el que no vino en el extracto, validado al momento (serie 3), con su analítica. */
export async function otroMovimiento(a: { bancoId: string; fecha: string; cuenta: string; concepto: string; importeCent: number; quien: string | null; local: string | null; marca: string | null; plataforma: string | null }): Promise<string> {
  const id = (x: string | null) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null)
  const r = await rpc<Fila>('conta_tesoreria_a_mano', {
    p_banco: a.bancoId, p_fecha: a.fecha, p_cuenta: a.cuenta, p_concepto: a.concepto, p_importe: a.importeCent / 100, p_quien_nombre: a.quien,
    p_local: id(a.local), p_marca: id(a.marca), p_plataforma: id(a.plataforma),
  })
  return String(r.texto ?? 'Apuntado.')
}

/** La factura del documento de la derecha: lo que se ve en la maqueta (número y de quién, fechas, total y lo pendiente antes). */
export interface FacturaDelMovimiento {
  tipo: 'recibida' | 'emitida'; id: string; numero: string; quien: string; fecha: string | null; vence: string | null
  totalCent: number; pendienteAntesCent: number
}

/** La factura que paga (o cobra) un movimiento: la de su casado o, si no, la de su propuesta. */
export async function facturaDelMovimiento(mov: { id: string; fecha: string }, casadoId: string | null, propuesta: { tipo: 'recibida' | 'emitida'; id: string } | null): Promise<FacturaDelMovimiento | null> {
  let f = propuesta
  if (casadoId) {
    const { data, error } = await tabla('bank_match_item').select('supplier_invoice_id, customer_invoice_id').eq('match_id', casadoId)
    if (error) throw new Error(mensaje('No se ha podido leer lo que paga', error))
    const x = ((data ?? []) as Fila[]).find((i) => i.supplier_invoice_id || i.customer_invoice_id)
    f = x ? (x.supplier_invoice_id ? { tipo: 'recibida', id: String(x.supplier_invoice_id) } : { tipo: 'emitida', id: String(x.customer_invoice_id) }) : null
  }
  if (!f) return null
  const columna = f.tipo === 'recibida' ? 'supplier_invoice_id' : 'customer_invoice_id'
  const [fac, pagos] = await Promise.all([
    f.tipo === 'recibida'
      ? tabla('supplier_invoice').select('id, invoice_number, invoice_date, due_date, grand_total, supplier:supplier_id(name)').eq('id', f.id).maybeSingle()
      : tabla('customer_invoice').select('id, number_text, issue_date, due_date, total, party:party_id(name)').eq('id', f.id).maybeSingle(),
    tabla('bank_match_item').select('amount, bank_match:match_id(status, bank_movement:movement_id(id, op_date))').eq(columna, f.id),
  ])
  if (fac.error) throw new Error(mensaje('No se ha podido leer la factura', fac.error))
  if (pagos.error) throw new Error(mensaje('No se ha podido leer lo pagado de la factura', pagos.error))
  const d = fac.data as Fila | null
  if (!d) return null
  const lista = ((pagos.data ?? []) as unknown as { amount: number; bank_match: { status: string; bank_movement: { id: string; op_date: string } | null } | null }[])
    .filter((p) => p.bank_match?.status === 'vivo' && p.bank_match.bank_movement)
    .map((p) => ({ movimiento: p.bank_match!.bank_movement!.id, fecha: p.bank_match!.bank_movement!.op_date, cent: Math.abs(cent(p.amount)) }))
  const totalCent = cent(f.tipo === 'recibida' ? d.grand_total : d.total)
  const quien = f.tipo === 'recibida' ? (d.supplier as { name?: string } | null)?.name : (d.party as { name?: string } | null)?.name
  return {
    tipo: f.tipo, id: f.id, numero: String((f.tipo === 'recibida' ? d.invoice_number : d.number_text) ?? 'sin número'), quien: String(quien ?? ''),
    fecha: s(f.tipo === 'recibida' ? d.invoice_date : d.issue_date), vence: s(d.due_date), totalCent, pendienteAntesCent: pendienteAntes(totalCent, lista, mov),
  }
}

/**
 * «Leer fichero de extracto bancario» (Norma 43 o Excel), al banco de la pantalla: el mismo camino que «Subir extracto».
 * Si el fichero trae varias cuentas, cada una a la suya (emparejar); si trae una sola, a este banco. Después pasa el
 * agente de conciliación, que deja sus propuestas (en ámbar). Devuelve la frase de lo que ha hecho (regla 8).
 */
export async function leerFicheroDelExtracto(f: File, banco: BancoVista, todos: Parameters<typeof emparejar>[1], ctx: { accountId: string; companyId: string; hoy: string }): Promise<string> {
  const a = await abrirExtracto(f)
  const { extracto, cuadre } = leerYCuadrar(a)
  if (!cuadre.ok) throw new Error(`«${f.name}» no cuadra: ${cuadre.motivos.join(' ')}`)
  const asignacion = extracto.cuentas.length === 1 ? [banco.id] : emparejar(extracto, todos)
  const r = await nucleo.importar(a, extracto, cuadre, asignacion, 'fichero', Object.fromEntries(todos.map((b) => [b.id, [...b.ibanes]])))
  if (r.length === 0) throw new Error(`«${f.name}» no es de ninguno de tus bancos.`)
  let agente = ''
  try { await pasarAgente(ctx.accountId, ctx.companyId, ctx.hoy, 'extracto') } catch (e) { agente = ` Sumied no ha podido proponer todavía (${e instanceof Error ? e.message : String(e)}).` }
  const nuevos = r.reduce((t, x) => t + x.nuevos, 0), repetidos = r.reduce((t, x) => t + x.repetidos, 0)
  if (r.every((x) => x.repetido)) return `«${f.name}» ya estaba leído: no cambia nada.`
  return `Leído «${f.name}»: ${nuevos === 1 ? '1 movimiento nuevo' : `${nuevos} movimientos nuevos`}${repetidos ? ` y ${repetidos} que ya estaban` : ''}.${agente}`
}

/** La frase del total de un movimiento contabilizado (para el aviso de la barra). */
export const importeVisto = (importeCent: number): string => eurosExactos(Math.abs(importeCent) / 100)
