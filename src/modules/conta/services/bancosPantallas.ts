// src/modules/conta/services/bancosPantallas.ts
//
// B01 · Lo que leen y escriben las pantallas de Bancos (tarea 5). Las
// decisiones del motor y las guardas viven en la base y en bancosNucleo;
// aquí solo se lee lo que se pinta y se llama a la función que toca.
//
// Nombres de tabla y de función entre comillas (regla 40): comprobados contra
// las migraciones 20261101T0100–0140 de este frente.

import { supabase } from '@/lib/supabase'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { bancos, type BancoFolvy, type ResultadoConciliar } from '@/modules/conta/services/bancosService'
import type { FacturaParaCasar } from '@/modules/conta/lib/conciliarVista'
import { reglasQuePropongo, type Casado, type MovRegla, type NoLaPropongo, type ReglaPropuesta } from '@/modules/conta/lib/reglasBanco'
import { limitesMes, type ExtractoDeshecho, type MovimientoBanco, type PropuestaGuardada } from '@/modules/conta/lib/bancosVista'
import { LO_HECHO } from '@/modules/conta/bancos/marca'
import type { ConexionCuenta } from '@/modules/conta/lib/agregadorBanco'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error as Parameters<typeof mensaje>[1]))
  return (data ?? []) as Fila[]
}

export interface Tarjeta { id: string; cuentaId: string; ultimos4: string; titular: string; localId: string | null }
export interface Extracto {
  id: string; cuentaId: string; fichero: string | null; formato: string; desde: string; hasta: string; saldoInicialCent: number | null; saldoFinalCent: number | null
  movimientos: number; nuevos: number; repetidos: number; cuadra: boolean | null; sinComprobar: string | null; continuidad: string; huecoCent: number | null
  subido: string; quien: string | null
}
export interface BancoVista extends BancoFolvy {
  cuentaNombre: string | null
  tarjetas: Tarjeta[]
  ultimoExtracto: Extracto | null
  /** B01c · La conexión directa con el banco (open-banking.io), si la cuenta la tiene. */
  conexion: ConexionCuenta | null
}
export interface DatosBancos {
  bancos: BancoVista[]
  extractos: Extracto[]
  locales: { id: string; nombre: string }[]
  nombres: Record<string, string>
  primerMovimiento: string | null
  /** Por banco: los movimientos que piden una decisión (para confirmar + por aclarar). */
  dudas: Record<string, number>
  reglas: { activas: number; nuevas: number }
  /** La fecha de corte de los bancos de la empresa (bank_settings): antes, la contabilidad está cerrada. */
  corte: string | null
}

/** B01c · Una fila de bank_aggregator_link, como la pinta Bancos. */
function conexionDe(c: Fila | undefined): ConexionCuenta | null {
  if (!c) return null
  const estado = s(c.last_status) as ConexionCuenta['estado']
  return {
    banco: s(c.bank_name) ?? 'el banco', estado: c.status === 'caducado' && !estado ? 'permiso_caducado' : estado, mensaje: s(c.last_message),
    leida: s(c.last_sync_at), intentada: s(c.last_run_at), caduca: s(c.consent_valid_until), renovar: s(c.renew_url),
  }
}

/** Lo de arriba de todas las pestañas: los bancos, sus tarjetas y extractos, los locales y el plan. */
export async function leerDatosBancos(accountId: string, companyId: string): Promise<DatosBancos> {
  const [bs, tarjetas, extractos, locales, cuentas, primero, dudas, porValidar, reglas, ajustes, conexiones] = await Promise.all([
    bancos.bancosDeLaEmpresa(accountId, companyId),
    leer(tabla('bank_card').select('id, treasury_account_id, last4, holder_name, location_id').eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true).order('created_at', { ascending: true }), 'las tarjetas'),
    leer(tabla('bank_statement').select('id, treasury_account_id, file_name, format, period_from, period_to, opening_balance, closing_balance, movements_count, new_count, repeated_count, balanced, unchecked_reason, continuity, continuity_gap, imported_at, imported_by_name')
      .eq('account_id', accountId).eq('company_id', companyId).order('period_to', { ascending: false }).limit(200), 'los extractos'),
    leer(tabla('locations').select('id, name').eq('account_id', accountId).order('name'), 'los locales'),
    leer(tabla('company_account').select('code, name, plain_name').eq('account_id', accountId).eq('company_id', companyId), 'el plan'),
    leer(tabla('bank_movement').select('op_date').eq('account_id', accountId).eq('company_id', companyId).order('op_date', { ascending: true }).limit(1), 'el primer movimiento'),
    leer(tabla('bank_movement').select('treasury_account_id').eq('account_id', accountId).eq('company_id', companyId).in('status', ['propuesto', 'por_aclarar', 'posible_repetido']), 'las dudas'),
    // S02 · PR 2: lo casado cuyo asiento sigue propuesto también pide algo (se valida en «Por validar»).
    leer(tabla('bank_movement').select('treasury_account_id, bank_match!inner(status, journal_entry!inner(status))')
      .eq('account_id', accountId).eq('company_id', companyId).eq('status', 'casado')
      .eq('bank_match.status', 'vivo').eq('bank_match.journal_entry.status', 'propuesto'), 'lo que falta por validar'),
    leer(tabla('bank_rule').select('status').eq('account_id', accountId).eq('company_id', companyId), 'las reglas'),
    leer(tabla('bank_settings').select('cutover_date').eq('account_id', accountId).eq('company_id', companyId).limit(1), 'los ajustes del banco'),
    // B01c · Las cuentas conectadas con el banco y cómo fue su última pasada. Si no se puede leer,
    // Bancos sigue sin la línea de la conexión (y lo dice la consola): nada de lo demás depende de ella.
    leer(tabla('bank_aggregator_link').select('treasury_account_id, bank_name, status, last_status, last_message, last_sync_at, last_run_at, consent_valid_until, renew_url')
      .eq('account_id', accountId).eq('company_id', companyId).order('last_run_at', { ascending: false }), 'las cuentas conectadas')
      .catch((e: unknown) => { console.warn('[bancos] no se pudieron leer las cuentas conectadas', e); return [] as Fila[] }),
  ])
  const nombres: Record<string, string> = {}
  for (const c of cuentas) nombres[String(c.code)] = String(c.plain_name ?? c.name).trim().replace(/[.\s]+$/, '')
  const ext: Extracto[] = extractos.map((e) => ({
    id: String(e.id), cuentaId: String(e.treasury_account_id), fichero: s(e.file_name), formato: String(e.format), desde: String(e.period_from), hasta: String(e.period_to),
    saldoInicialCent: e.opening_balance === null ? null : cent(e.opening_balance), saldoFinalCent: e.closing_balance === null ? null : cent(e.closing_balance), movimientos: Number(e.movements_count), nuevos: Number(e.new_count), repetidos: Number(e.repeated_count),
    cuadra: e.balanced === null ? null : !!e.balanced, sinComprobar: s(e.unchecked_reason), continuidad: String(e.continuity), huecoCent: e.continuity_gap === null ? null : cent(e.continuity_gap),
    subido: String(e.imported_at), quien: s(e.imported_by_name),
  }))
  const tjs: Tarjeta[] = tarjetas.map((t) => ({ id: String(t.id), cuentaId: String(t.treasury_account_id), ultimos4: String(t.last4), titular: String(t.holder_name), localId: s(t.location_id) }))
  const porBanco: Record<string, number> = {}
  for (const d of [...dudas, ...porValidar]) porBanco[String(d.treasury_account_id)] = (porBanco[String(d.treasury_account_id)] ?? 0) + 1
  return {
    bancos: bs.filter((b) => b.kind === 'bank').map((b) => ({
      ...b, cuentaNombre: b.cuenta ? nombres[b.cuenta] ?? null : null,
      tarjetas: tjs.filter((t) => t.cuentaId === b.id),
      ultimoExtracto: ext.find((e) => e.cuentaId === b.id) ?? null,
      conexion: conexionDe(conexiones.find((c) => String(c.treasury_account_id) === b.id)),
    })),
    extractos: ext,
    locales: locales.map((l) => ({ id: String(l.id), nombre: String(l.name) })),
    nombres,
    primerMovimiento: primero[0] ? String(primero[0].op_date) : null,
    dudas: porBanco,
    reglas: { activas: reglas.filter((r) => r.status === 'activa').length, nuevas: reglas.filter((r) => r.status === 'propuesta').length },
    corte: s(ajustes[0]?.cutover_date),
  }
}

/** Los movimientos de un banco en un mes, con su casado vivo o su propuesta. */
export async function leerMovimientos(accountId: string, bancoId: string, mes: string): Promise<MovimientoBanco[]> {
  const { desde, hasta } = limitesMes(mes)
  const filas = await leer(tabla('bank_movement')
    .select('id, treasury_account_id, op_date, amount, bank_concept, clean_concept, counterparty, movement_type, status, confidence, reason, proposal, ignored_reason, receipt_path, bank_card(last4, holder_name), bank_match(id, kind, reason, by_who, status, journal_entry_id, journal_entry(concept, status))')
    .eq('account_id', accountId).eq('treasury_account_id', bancoId).gte('op_date', desde).lte('op_date', hasta)
    .order('op_date', { ascending: false }).order('created_at', { ascending: false }), 'los movimientos')
  return filas.map((m) => {
    const vivo = ((m.bank_match as Fila[] | null) ?? []).find((x) => x.status === 'vivo') ?? null
    const tarjeta = m.bank_card as Fila | null
    return {
      id: String(m.id), cuentaId: String(m.treasury_account_id), fecha: String(m.op_date), importeCent: cent(m.amount),
      conceptoBanco: String(m.bank_concept ?? ''), conceptoLimpio: String(m.clean_concept || m.bank_concept || ''),
      contraparte: s(m.counterparty), tipo: s(m.movement_type),
      estado: m.status as MovimientoBanco['estado'], confianza: (s(m.confidence) as MovimientoBanco['confianza']) ?? null, porque: s(m.reason),
      propuesta: (m.proposal as PropuestaGuardada | null) ?? null,
      casado: vivo ? {
        id: String(vivo.id), tipo: String(vivo.kind), porque: String(vivo.reason), porQuien: vivo.by_who === 'folvy' ? 'folvy' : 'persona',
        asientoId: s(vivo.journal_entry_id), asientoConcepto: s((vivo.journal_entry as Fila | null)?.concept),
        asientoEstado: (s((vivo.journal_entry as Fila | null)?.status) as NonNullable<MovimientoBanco['casado']>['asientoEstado']) ?? null,
      } : null,
      tarjeta: tarjeta ? { ultimos4: String(tarjeta.last4), titular: String(tarjeta.holder_name) } : null,
      ticket: s(m.receipt_path), motivoIgnorado: s(m.ignored_reason),
    }
  })
}

/** El saldo de cada cuenta 572 de los bancos a una fecha (lo que dice contabilidad). */
export async function saldosContables(companyId: string, hasta: string, codigos: string[]): Promise<Record<string, number>> {
  if (!codigos.length) return {}
  const filas = await rpc<Fila[]>('bank_saldos_cuentas', { p_company: companyId, p_hasta: hasta, p_prefijos: codigos })
  const out: Record<string, number> = {}
  for (const f of filas ?? []) if (codigos.includes(String(f.cuenta))) out[String(f.cuenta)] = cent(f.saldo)
  return out
}

/**
 * S01 · Las cuentas de la pasarela de cobro («Stripe · por abonar», «TPV del
 * banco · por abonar»), con su saldo hoy: lo cobrado con tarjeta o Bizum que
 * aún no ha llegado al banco. Se crean solas con el primer cobro por el enlace.
 */
export interface CuentaPasarela { proveedor: 'stripe' | 'redsys'; codigo: string; nombre: string; saldoCent: number }
export async function cuentasPasarela(accountId: string, companyId: string, hoy: string): Promise<CuentaPasarela[]> {
  const filas = await leer(tabla('conta_pasarela_cuenta').select('proveedor, code, company_account:company_account_id(name, plain_name)')
    .eq('account_id', accountId).eq('company_id', companyId), 'las cuentas de la pasarela')
  const saldos = await saldosContables(companyId, hoy, filas.map((f) => String(f.code)))
  return filas.map((f) => {
    const ca = f.company_account as Fila | null
    return { proveedor: f.proveedor === 'redsys' ? 'redsys' as const : 'stripe' as const, codigo: String(f.code), nombre: String(ca?.plain_name ?? ca?.name ?? ''), saldoCent: saldos[String(f.code)] ?? 0 }
  }).sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/** Los asientos con un banco y sin movimiento que los case, en un mes (lo que está en contabilidad y no en el banco). */
export async function asientosSinMovimiento(companyId: string, mes: string): Promise<{ id: string; cuentaId: string; fecha: string; importeCent: number; concepto: string }[]> {
  const { desde, hasta } = limitesMes(mes)
  const filas = await rpc<Fila[]>('bank_asientos_sin_movimiento', { p_company: companyId, p_desde: desde, p_hasta: hasta })
  return (filas ?? []).map((a) => ({ id: String(a.entry_id), cuentaId: String(a.treasury_account_id), fecha: String(a.fecha), importeCent: cent(a.importe), concepto: String(a.concepto) }))
}

export interface Regla {
  id: string; palabras: string; contiene: string; signo: 1 | -1 | null; cuenta: string; origen: 'persona' | 'folvy'; estado: 'propuesta' | 'activa' | 'apagada' | 'rechazada'
  veces: number; ultimaVez: string | null
}

export async function leerReglas(accountId: string, companyId: string): Promise<Regla[]> {
  const filas = await leer(tabla('bank_rule').select('id, words, condition, target, origin, status, confirmations, last_used_at').eq('account_id', accountId).eq('company_id', companyId)
    .order('created_at', { ascending: false }), 'las reglas')
  return filas.map((r) => {
    const cond = r.condition as Fila
    return { id: String(r.id), palabras: String(r.words), contiene: String(cond.contiene ?? ''), signo: cond.signo === 1 || cond.signo === -1 ? cond.signo : null,
      cuenta: String((r.target as Fila).cuenta ?? ''), origen: r.origin === 'folvy' ? 'folvy' : 'persona', estado: r.status as Regla['estado'],
      veces: Number(r.confirmations ?? 0), ultimaVez: s(r.last_used_at) }
  })
}

/**
 * B02 · Lo que necesitan las reglas para enseñarse: lo que propongo (lo hecho
 * al menos 3 veces igual) y lo que no propongo (texto genérico), y los
 * movimientos y lo casado antes, para los ejemplos y «qué cambiaría».
 */
export async function datosDeReglas(accountId: string, companyId: string, hoy: string):
  Promise<{ propongo: ReglaPropuesta[]; noPropongo: NoLaPropongo[]; movs: MovRegla[]; casados: Casado[] }> {
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - 400 * 86400000).toISOString().slice(0, 10)
  const [{ ctx }, filas, historial] = await Promise.all([
    bancos.cargarContexto(accountId, companyId, hoy),
    leer(tabla('bank_movement').select('id, op_date, amount, bank_concept, counterparty, status').eq('account_id', accountId).eq('company_id', companyId)
      .gte('op_date', desde).neq('status', 'ignorado'), 'los movimientos'),
    rpc<Fila[]>('bank_historial', { p_company: companyId, p_desde: desde }),
  ])
  const movs: MovRegla[] = filas.map((m) => ({ id: String(m.id), fecha: String(m.op_date), importeCent: cent(m.amount), concepto: String(m.bank_concept ?? ''),
    contraparte: s(m.counterparty), sinCasar: ['pendiente', 'propuesto', 'por_aclarar'].includes(String(m.status)) }))
  const casados: Casado[] = (historial ?? []).filter((h) => h.cuenta).map((h) => ({ concepto: String(h.concepto ?? ''), cuenta: String(h.cuenta) }))
  return { ...reglasQuePropongo(ctx, movs, casados), movs, casados }
}

/** B02 · «No» a una regla que propongo y aún no está guardada: queda rechazada y no la vuelvo a proponer. */
export async function rechazarPropuesta(companyId: string, p: { palabras: string; contiene: string; cuenta: string }): Promise<void> {
  const id = await rpc<string>('bank_regla_guardar', { p_company: companyId, p_id: null, p_palabras: p.palabras, p_condicion: { contiene: p.contiene },
    p_destino: { cuenta: p.cuenta }, p_origen: 'folvy', p_estado: 'propuesta' })
  await rpc<void>('bank_regla_estado', { p_id: id, p_estado: 'rechazada' })
}

/** B02 · Borrar una regla: solo si está apagada (la base lo comprueba). */
export const borrarRegla = (id: string) => rpc<void>('bank_regla_borrar', { p_id: id })

/**
 * Guarda una regla encendida. La que propone Folvy nace «propuesta» y la
 * persona la acepta (la base no deja que Folvy encienda una sola): dos pasos,
 * los dos en el registro de la regla.
 */
export async function guardarRegla(companyId: string, r: { id?: string | null; palabras: string; contiene: string; cuenta: string; signo?: 1 | -1 | null; origen: 'persona' | 'folvy' }): Promise<string> {
  const id = await rpc<string>('bank_regla_guardar', {
    p_company: companyId, p_id: r.id ?? null, p_palabras: r.palabras, p_condicion: { contiene: r.contiene, ...(r.signo ? { signo: r.signo } : {}) },
    p_destino: { cuenta: r.cuenta }, p_origen: r.origen, p_estado: r.origen === 'folvy' && !r.id ? 'propuesta' : 'activa',
  })
  if (r.origen === 'folvy' && !r.id) await rpc<void>('bank_regla_estado', { p_id: id, p_estado: 'activa' })
  return id
}

export const cambiarEstadoRegla = (id: string, estado: 'activa' | 'apagada' | 'rechazada') => rpc<void>('bank_regla_estado', { p_id: id, p_estado: estado })

export interface Hecho { id: string; fecha: string; accion: string; resumen: string; movimientoId: string | null; casadoId: string | null; casadoVivo: boolean; porQuien: 'folvy' | 'persona'; quien: string | null }

/** «Lo que ha hecho Folvy» en un mes: todo lo que hizo solo, con su porqué, y Deshacer si sigue vivo. */
export async function leerHechos(accountId: string, companyId: string, mes: string): Promise<Hecho[]> {
  const { desde, hasta } = limitesMes(mes)
  const filas = await leer(tabla('bank_activity_log').select('id, created_at, action, summary, movement_id, match_id, by_who, created_by_name, bank_match(status)')
    .eq('account_id', accountId).eq('company_id', companyId).gte('created_at', `${desde}T00:00:00Z`).lte('created_at', `${hasta}T23:59:59Z`)
    .order('created_at', { ascending: false }).limit(500), LO_HECHO.toLowerCase())
  return filas.map((h) => ({ id: String(h.id), fecha: String(h.created_at), accion: String(h.action), resumen: String(h.summary), movimientoId: s(h.movement_id), casadoId: s(h.match_id),
    casadoVivo: (h.bank_match as Fila | null)?.status === 'vivo', porQuien: h.by_who === 'folvy' ? 'folvy' : 'persona', quien: s(h.created_by_name) }))
}

export interface FacturaPendiente { id: string; numero: string | null; fecha: string; pendienteCent: number; proveedor: string; terceroId: string | null; cuentaTercero: string | null }

export async function facturasPendientes(companyId: string): Promise<FacturaPendiente[]> {
  const filas = await rpc<Fila[]>('bank_facturas_recibidas_pendientes', { p_company: companyId })
  return (filas ?? []).map((f) => ({ id: String(f.id), numero: s(f.numero), fecha: String(f.fecha ?? ''), pendienteCent: cent(f.total) - cent(f.pagado), proveedor: String(f.proveedor ?? ''),
    terceroId: s(f.tercero_id), cuentaTercero: s(f.cuenta_tercero) })).filter((f) => f.pendienteCent > 0)
}

/** B02 · Las facturas que se pueden casar (aprobadas y en revisión, sin pagar del todo), para el panel lateral. */
export async function facturasParaCasar(companyId: string): Promise<FacturaParaCasar[]> {
  const filas = await rpc<Fila[]>('bank_facturas_para_casar', { p_company: companyId })
  return (filas ?? []).map((f) => ({ id: String(f.id), numero: s(f.numero), fecha: String(f.fecha ?? ''), totalCent: cent(f.total), pagadoCent: cent(f.pagado),
    proveedor: String(f.proveedor ?? ''), alias: ((f.alias as string[] | null) ?? []).filter(Boolean), terceroId: s(f.tercero_id), cuentaTercero: s(f.cuenta_tercero),
    enRevision: f.estado === 'en_revision' }))
}

// ── Lo que hace la persona ─────────────────────────────────────────────────

/** B02 · «Es el mismo» (se aparta, no cuenta dos veces) o «Son dos» (se queda como uno más). */
export const resolverRepetido = (movimientoId: string, esElMismo: boolean) => rpc<void>('bank_repetido_resolver', { p_movement: movimientoId, p_es_el_mismo: esElMismo })

export const guardarTarjeta = (bancoId: string, t: { id?: string | null; ultimos4: string; titular: string; localId: string | null; comun: boolean }) =>
  rpc<string>('bank_tarjeta_guardar', { p_treasury: bancoId, p_id: t.id ?? null, p_last4: t.ultimos4, p_titular: t.titular, p_local: t.localId, p_comun: t.comun })
export const bajaTarjeta = (id: string) => rpc<void>('bank_tarjeta_baja', { p_id: id })
export const recordarIban = (bancoId: string, iban: string) => rpc<void>('bank_iban_recordar', { p_treasury: bancoId, p_iban: iban })
export const corregirIban = (bancoId: string, iban: string) => rpc<void>('bank_cuenta_iban_corregir', { p_treasury: bancoId, p_iban: iban })
export const localDeCuenta = (bancoId: string, localId: string | null, comun: boolean) => rpc<void>('bank_cuenta_local', { p_treasury: bancoId, p_local: localId, p_comun: comun })
export const ignorar = (movimientoId: string, motivo: string) => rpc<void>('bank_ignorar', { p_movement: movimientoId, p_motivo: motivo })

export async function cuentasPorDarDeAlta(companyId: string): Promise<{ codigo: string; nombre: string; ibanEnNombre: string | null }[]> {
  const filas = await rpc<Fila[]>('bank_cuentas_por_dar_de_alta', { p_company: companyId })
  return (filas ?? []).map((f) => ({ codigo: String(f.code), nombre: String(f.name), ibanEnNombre: s(f.iban_en_nombre) }))
}

export const altaCuenta = (companyId: string, c: { nombre: string; iban: string; codigo: string; localId: string | null; comun: boolean }) =>
  rpc<string>('bank_cuenta_alta', { p_company: companyId, p_kind: 'bank', p_nombre: c.nombre, p_iban: c.iban, p_cuenta_contable: c.codigo, p_local: c.localId, p_comun: c.comun })

export interface BancoNuevoHecho { banco: string; cuenta: string | null; cuentaId: string | null; porque: string }

/**
 * S01d · Un banco (o una tarjeta) que aún no está en el plan: la base le crea
 * la subcuenta 572 siguiente («Bancos · <nombre>») y lo enlaza; sin plan
 * activado, el banco solo, y `porque` lo dice.
 */
export async function altaBancoNuevo(companyId: string, b: { tipo: 'bank' | 'card'; nombre: string; iban: string | null; localId: string | null; comun: boolean }, quien: string | null): Promise<BancoNuevoHecho> {
  const r = await rpc<Fila>('bank_cuenta_nueva', { p_company: companyId, p_kind: b.tipo, p_nombre: b.nombre, p_iban: b.iban, p_local: b.localId, p_comun: b.comun, p_quien_nombre: quien })
  return { banco: String(r.banco), cuenta: s(r.cuenta), cuentaId: s(r.cuenta_id), porque: String(r.porque ?? '') }
}

/** La foto del ticket: al bucket privado, en la carpeta del movimiento, y apuntada en él. */
export async function subirTicket(accountId: string, movimientoId: string, f: File): Promise<void> {
  if (!supabase) throw new Error('No hay conexión con la base de datos.')
  const bytes = await f.arrayBuffer()
  const huella = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
  const ext = (f.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const ruta = `${accountId}/${movimientoId}/${huella}.${ext}`
  const { error } = await supabase.storage.from('banco-tickets').upload(ruta, f, { upsert: true, contentType: f.type || undefined })
  if (error) throw new Error(`No se ha podido subir la foto: ${error.message}`)
  await rpc<void>('bank_ticket_guardar', { p_movement: movimientoId, p_ruta: ruta })
}

// ── Respuesta 4 y tarea 6 ───────────────────────────────────────────────────

export const guardarAlias = (bancoId: string, alias: string) => rpc<void>('bank_cuenta_alias', { p_treasury: bancoId, p_alias: alias })

export interface EstadoMes {
  bancoId: string; mes: string; hasta: string; cuenta: string | null
  saldoBancoCent: number | null; extractoHasta: string | null; saldoLibroCent: number; diferenciaCent: number | null
  sueltos: number; sueltosCent: number
  cierre: { id: string; aSabiendas: boolean; por: string | null; el: string; motivo: string | null } | null
}

/** El estado del mes de cada banco (la base lo calcula: el mismo que comprueba el cierre). */
export async function mesesEstado(companyId: string, mes: string): Promise<EstadoMes[]> {
  const filas = await rpc<Fila[]>('bank_meses_estado', { p_company: companyId, p_mes: `${mes}-01` })
  return (filas ?? []).map((f) => {
    const e = f.estado as Fila
    return {
      bancoId: String(f.treasury_account_id), mes: String(e.mes), hasta: String(e.hasta), cuenta: s(e.cuenta),
      saldoBancoCent: e.saldo_banco === null ? null : cent(e.saldo_banco), extractoHasta: s(e.extracto_hasta), saldoLibroCent: cent(e.saldo_libro),
      diferenciaCent: e.diferencia === null ? null : cent(e.diferencia), sueltos: Number(e.sueltos ?? 0), sueltosCent: cent(e.sueltos_importe),
      cierre: f.cierre_id ? { id: String(f.cierre_id), aSabiendas: !!f.cerrado_a_sabiendas, por: s(f.cerrado_por), el: String(f.cerrado_el), motivo: s(f.motivo) } : null,
    }
  })
}

/** S02 · PR 2 · Un banco tal como lo pinta su cierre del mes (en Contabilidad › Cierre y Registro). */
export interface BancoDelCierre { id: string; nombre: string; iban: string | null; cuenta: string | null; cuentaNombre: string | null }

/**
 * S02 · PR 2 · Los bancos de la empresa para «Cerrar el mes», sin todo lo que
 * lee Bancos (extractos, tarjetas, reglas…): sus cuentas y el nombre de su
 * 572. Siempre con account_id y company_id (regla 9). Las tarjetas no se
 * cierran por mes: solo los bancos, como en Bancos.
 */
export async function leerBancosDelCierre(accountId: string, companyId: string): Promise<BancoDelCierre[]> {
  const bs = (await bancos.bancosDeLaEmpresa(accountId, companyId)).filter((b) => b.kind === 'bank')
  const codigos = [...new Set(bs.map((b) => b.cuenta).filter((c): c is string => !!c))]
  const cuentas = codigos.length === 0 ? [] : await leer(tabla('company_account').select('code, name, plain_name')
    .eq('account_id', accountId).eq('company_id', companyId).in('code', codigos), 'el plan')
  const nombres = new Map(cuentas.map((c) => [String(c.code), String(c.plain_name ?? c.name).trim().replace(/[.\s]+$/, '')]))
  return bs
    .map((b) => ({ id: b.id, nombre: b.nombre, iban: b.iban, cuenta: b.cuenta, cuentaNombre: b.cuenta ? nombres.get(b.cuenta) ?? null : null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export const cerrarMes = (bancoId: string, mes: string, aSabiendas: boolean, motivo: string | null) =>
  rpc<Fila>('bank_mes_cerrar', { p_treasury: bancoId, p_mes: `${mes}-01`, p_a_sabiendas: aSabiendas, p_motivo: motivo })
export const reabrirMes = (cierreId: string, motivo: string) => rpc<void>('bank_mes_reabrir', { p_cierre: cierreId, p_motivo: motivo })

/** Deshacer un extracto entero (15/10): solo si ninguno de sus movimientos está casado; se lleva también los «¿es el mismo?». */
export async function deshacerExtracto(extractoId: string, motivo: string): Promise<ExtractoDeshecho> {
  const r = await rpc<Fila>('bank_extracto_deshacer', { p_statement: extractoId, p_motivo: motivo })
  return { fichero: s(r.fichero), movimientos: Number(r.movimientos ?? 0), posiblesRepetidos: Number(r.posibles_repetidos ?? 0) }
}

export interface Pasada { id: string; disparo: 'extracto' | 'diario'; cuando: string; resumen: string; casados: number; propuestos: number; porAclarar: number }

/** La última pasada del agente «Conciliación» de la empresa: su resumen es la banda verde. */
export async function ultimaPasada(accountId: string, companyId: string): Promise<Pasada | null> {
  const filas = await leer(tabla('bank_agent_run').select('id, trigger, ran_at, summary, matched, proposed, to_clarify')
    .eq('account_id', accountId).eq('company_id', companyId).order('ran_at', { ascending: false }).limit(1), 'la última pasada del agente')
  const p = filas[0]
  return p ? { id: String(p.id), disparo: p.trigger === 'diario' ? 'diario' : 'extracto', cuando: String(p.ran_at), resumen: String(p.summary),
    casados: Number(p.matched), propuestos: Number(p.proposed), porAclarar: Number(p.to_clarify) } : null
}

/**
 * El agente «Conciliación» (respuesta 4, tarea 6.1): el motor sobre lo pendiente
 * —con las mismas guardas de siempre: nada se valida fuera de «validar solo lo
 * seguro»— y su pasada registrada con el resumen. Corre después de cada
 * extracto y, si hoy no ha corrido, la primera vez que alguien abre Bancos.
 */
export async function pasarAgente(accountId: string, companyId: string, hoy: string, disparo: 'extracto' | 'diario'): Promise<{ resultado: ResultadoConciliar; resumen: string }> {
  const resultado = await bancos.conciliarPendientes(accountId, companyId, hoy)
  const id = await rpc<string>('bank_agente_registrar', { p_company: companyId, p_disparo: disparo, p_resultado: {
    casados: resultado.casadosSolos, propuestos: resultado.propuestos, por_aclarar: resultado.porAclarar, antes_corte: resultado.antesDelCorte,
    fallos: resultado.fallos.length, fallos_detalle: resultado.fallos.slice(0, 20) } })
  const filas = await leer(tabla('bank_agent_run').select('summary').eq('id', id).limit(1), 'el resumen de la pasada')
  return { resultado, resumen: String(filas[0]?.summary ?? '') }
}

export const agenteTocaHoy = (companyId: string) => rpc<boolean>('bank_agente_toca_hoy', { p_company: companyId })
