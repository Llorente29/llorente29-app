// src/modules/conta/services/bancosNucleo.ts
//
// B01 · Bancos: lo que une el lector y el motor (núcleo puro en lib/) con la
// base (20261101T01xx), SIN atarse al cliente de la app: recibe la base como
// parámetro (`crearBancos(bd)`). La app lo usa con services/bd.ts
// (bancosService.ts); la demostración de staging, con la sesión del usuario de
// prueba (tests/e2e/conta/b01). Nada decide aquí: el lector lee, el motor
// propone y las funciones de la base casan, con sus guardas.
//
//   leerYCuadrar         Norma 43 o Excel/CSV → cuentas, cuadre y «He leído…».
//   emparejar            cada cuenta del fichero con su banco de Folvy por IBAN.
//   importar             bank_importar por cuenta (la base vuelve a cuadrar).
//   cargarContexto       lo que el motor necesita saber, leído de la base.
//   conciliarPendientes  el motor sobre lo pendiente: lo seguro se casa solo
//                        (bank_casar, «folvy»); lo demás queda propuesto o por
//                        aclarar con su porqué (bank_proponer).
//   confirmar / deshacer lo que hace la persona.

import { cuadrar, huellas, huellasSuaves, limpiarConcepto, movimientoSinTarjetas, resumenLectura, type Cuadre, type ExtractoLeido } from '@/modules/conta/lib/extractoBanco'
import { leerFicheroBanco, type ContenidoFichero } from '@/modules/conta/lib/fuentesBanco'
import { partirCsv } from '@/modules/conta/lib/importarPlan'
import type { BancoCsv } from '@/modules/conta/lib/lectorCsvBanco'
import {
  conciliar, contraparte, cuentaDeTienda, ventanaDeCobro, type Aprendido, type AsientoLibre, type Contexto, type Contrato, type Decision, type Destino, type Impuesto, type Movimiento, type Plataforma,
} from '@/modules/conta/lib/conciliacion'

type Fila = Record<string, unknown>
type Respuesta = PromiseLike<{ data: unknown; error: { message: string } | null }>
/** Lo mínimo de una consulta encadenada de supabase-js que se usa aquí. */
export interface Consulta extends Respuesta {
  select(c: string): Consulta
  eq(c: string, v: unknown): Consulta
  in(c: string, v: unknown[]): Consulta
  order(c: string, o: { ascending: boolean }): Consulta
  limit(n: number): Consulta
}
export interface Bd {
  tabla(nombre: string): Consulta
  rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T>
  /** El error de la base en una frase que se puede enseñar (en la app, services/bd.ts). */
  mensaje?: (prefijo: string, error: { message: string }) => string
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const cent = (v: unknown) => Math.round(n(v) * 100)
const abs = Math.abs

export interface ExtractoAbierto { nombre: string; sha256: string; contenido: ContenidoFichero }

export function leerYCuadrar(a: ExtractoAbierto, banco?: BancoCsv): { extracto: ExtractoLeido; cuadre: Cuadre; resumen: string } {
  const extracto = leerFicheroBanco(a.contenido, partirCsv, banco)
  const cuadre = cuadrar(extracto)
  return { extracto, cuadre, resumen: resumenLectura(extracto, cuadre) }
}

export interface BancoFolvy {
  id: string; nombre: string; iban: string | null; kind: string; cuenta: string | null; localId: string | null
  /** El nombre corto en la barra (respuesta 4); null = el nombre entero. */
  alias: string | null
  ibanRevision: { iban_propuesto: string; motivo: string } | null
  /** Otros IBAN que la persona dijo que van a esta cuenta (respuesta 3): la subida empareja sola. */
  ibanes: string[]
}

/** Cada cuenta del fichero con su banco de Folvy por IBAN (el suyo o uno recordado); null si no hay (se pregunta). */
export function emparejar(e: ExtractoLeido, bancos: readonly BancoFolvy[]): (string | null)[] {
  return e.cuentas.map((c) => (c.iban ? bancos.find((b) => b.iban === c.iban || b.ibanes.includes(c.iban!))?.id ?? null : null))
}

export interface ResultadoImportar { banco: string; repetido: boolean; mensaje: string | null; nuevos: number; repetidos: number; posiblesRepetidos: number; continuidad: string; hueco: number | null }

// ── Lo que sabe el motor ───────────────────────────────────────────────────

const ventanas = (dias: { fecha: string; c: number }[]): Plataforma['pendiente'] => {
  // Semanas de lunes a domingo y quincenas: los dos ritmos de liquidación que se ven en las plataformas.
  const out = new Map<string, { desde: string; hasta: string; ventasCent: number }>()
  for (const d of dias) {
    const f = new Date(`${d.fecha}T00:00:00Z`)
    const lunes = new Date(f); lunes.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7))
    const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6)
    const iso = (x: Date) => x.toISOString().slice(0, 10)
    const q = f.getUTCDate() <= 15 ? [`${d.fecha.slice(0, 8)}01`, `${d.fecha.slice(0, 8)}15`]
      : [`${d.fecha.slice(0, 8)}16`, iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)))]
    for (const [desde, hasta] of [[iso(lunes), iso(domingo)], q]) {
      const k = `${desde}:${hasta}`
      const v = out.get(k) ?? { desde, hasta, ventasCent: 0 }
      v.ventasCent += d.c
      out.set(k, v)
    }
  }
  return [...out.values()].sort((a, b) => a.hasta.localeCompare(b.hasta))
}

export interface ResultadoConciliar { casadosSolos: number; propuestos: number; porAclarar: number; antesDelCorte: number; fallos: { movimiento: string; motivo: string }[]; decisiones: Decision[] }

/**
 * B02 · Con qué texto paga cada plataforma en el banco, además de su nombre
 * (Uber paga como «STICHTING CUSTODIAN UBER PAYMENTS»). Cada cobro se reconoce
 * por su texto propio y se casa con su liquidación, nunca con una regla.
 */
const PAGADORES: [RegExp, string[]][] = [
  [/uber/i, ['STICHTING CUSTODIAN UBER', 'UBER PAYMENTS', 'UBER EATS SPAIN']],
  [/glovo/i, ['GLOVOAPP', 'GLOVO APP']],
  [/just ?eat/i, ['JUST EAT', 'TAKEAWAY']],
  [/deliveroo/i, ['ROOFOODS', 'DELIVEROO']],
]
export const pagadorDe = (plataforma: string): string[] => PAGADORES.filter(([re]) => re.test(plataforma)).flatMap(([, xs]) => xs)

/** B02 · El nombre de la empresa, sin su forma jurídica: en el concepto, delata un traspaso entre sus cuentas. */
export function nombresDeEmpresa(e: Fila | undefined): string[] {
  if (!e) return []
  const sinForma = (x: unknown) => String(x ?? '').replace(/[.,]/g, ' ').replace(/\b(S ?L ?U?|S ?A|S ?C|C ?B|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA)\s*$/i, '').replace(/\s+/g, ' ').trim()
  return [...new Set([sinForma(e.legal_name), sinForma(e.trade_name)].filter((x) => x.length >= 4))]
}

/** Las funciones que hablan con la base, sobre la base que se les dé. */
export function crearBancos(bd: Bd) {
  const rpc = bd.rpc.bind(bd)
  const tabla = (t: string) => bd.tabla(t)
  async function leer(q: Respuesta, que: string): Promise<Fila[]> {
    const { data, error } = await q
    if (error) throw new Error(bd.mensaje ? bd.mensaje(`No se ha podido leer ${que}`, error) : `No se ha podido leer ${que}: ${error.message}`)
    return (data ?? []) as Fila[]
  }

  async function bancosDeLaEmpresa(accountId: string, companyId: string): Promise<BancoFolvy[]> {
    const [ts, enlaces, recordados] = await Promise.all([
      // S01 · Sin las cuentas de la pasarela («Stripe · por abonar»): no tienen extracto ni movimientos; Bancos las enseña aparte, con su saldo.
      leer(tabla('treasury_account').select('id, name, short_name, iban, kind, location_id, is_active, iban_review').eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true).in('kind', ['bank', 'card', 'cash']), 'los bancos'),
      leer(tabla('company_account_link').select('entity_id, company_account:company_account_id(code)').eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'bank_account').eq('role', 'principal'), 'las cuentas de los bancos'),
      leer(tabla('bank_account_iban').select('treasury_account_id, iban').eq('account_id', accountId).eq('company_id', companyId), 'los IBAN recordados'),
    ])
    const cuentaDe = new Map(enlaces.map((e) => [String(e.entity_id), s((e.company_account as Fila | null)?.code)]))
    return ts.map((t) => ({ id: String(t.id), nombre: String(t.name), alias: s(t.short_name), iban: s(t.iban), kind: String(t.kind), cuenta: cuentaDe.get(String(t.id)) ?? null,
      localId: s(t.location_id), ibanRevision: (t.iban_review as BancoFolvy['ibanRevision']) ?? null,
      ibanes: recordados.filter((r) => String(r.treasury_account_id) === String(t.id)).map((r) => String(r.iban)) }))
  }

  /**
   * Importa cada cuenta del extracto en el banco que se le ha asignado. Lo que no cuadre no llega aquí (y la base lo vuelve a comprobar).
   * `recordados`: los IBAN que la persona ya dijo que van a cada banco (bank_account_iban); con ellos no se pide «Revisa esta cuenta».
   */
  async function importar(a: ExtractoAbierto, e: ExtractoLeido, cuadre: Cuadre, asignacion: readonly (string | null)[], fuente: 'fichero' | 'correo' | `agregador:${string}` = 'fichero',
    recordados: Readonly<Record<string, readonly string[]>> = {}): Promise<ResultadoImportar[]> {
    if (!cuadre.ok) throw new Error(`No cuadra: ${cuadre.motivos.join(' ')}`)
    const out: ResultadoImportar[] = []
    for (const [i, c] of e.cuentas.entries()) {
      const banco = asignacion[i]
      if (!banco) continue
      // Nunca una tarjeta entera (15/10): ni en lo que se guarda ni en la huella.
      const leidos = c.movimientos.map(movimientoSinTarjetas)
      const hs = huellas(leidos), ss = huellasSuaves(leidos)
      const movs = leidos.map((m, j) => ({
        fecha: m.fecha, fecha_valor: m.fechaValor, importe: m.importeCent / 100, concepto_banco: m.conceptoBanco, concepto_limpio: limpiarConcepto(m.conceptoBanco),
        comun: m.conceptoComun, propio: m.conceptoPropio, documento: m.numeroDocumento, ref1: m.referencia1, ref2: m.referencia2,
        contraparte: m.contraparte, tipo: m.tipoMovimiento,
        ...(m.equivalencia ? { divisa_origen: m.equivalencia.divisa, importe_origen: m.equivalencia.importeCent / 100 } : {}),
        huella: hs[j], huella_suave: ss[j],
      }))
      const sinSaldo = c.saldoInicialCent === null || c.saldoFinalCent === null
      const r = await rpc<Fila>('bank_importar', {
        p_treasury: banco, p_fuente: fuente, p_formato: e.formato, p_fichero: a.nombre, p_sha256: a.sha256,
        p_desde: c.desde ?? c.movimientos[0]?.fecha, p_hasta: c.hasta ?? c.movimientos.at(-1)?.fecha,
        p_saldo_inicial: sinSaldo ? null : c.saldoInicialCent! / 100, p_saldo_final: sinSaldo ? null : c.saldoFinalCent! / 100,
        p_sin_comprobar: sinSaldo ? (cuadre.sinComprobar[0] ?? 'El fichero no trae saldos.') : null,
        p_iban_fichero: c.iban && (recordados[banco] ?? []).includes(c.iban) ? null : c.iban, p_movs: movs,
      })
      out.push({ banco, repetido: !!r.repetido, mensaje: s(r.mensaje), nuevos: n(r.nuevos), repetidos: n(r.repetidos), posiblesRepetidos: n(r.posibles_repetidos),
        continuidad: String(r.continuidad ?? ''), hueco: r.hueco === null || r.hueco === undefined ? null : n(r.hueco) })
    }
    return out
  }

  async function cargarContexto(accountId: string, companyId: string, hoy: string): Promise<{ ctx: Contexto; movimientos: Movimiento[] }> {
    const hace = (d: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - d * 86400000).toISOString().slice(0, 10)
    const [bancos, movs, facturas, saldos, asientos, historial, ventas, liqs, canales, roles, enlaces, cuentas, contratos, reglas, proveedores, tarjetas, empresa, tiendas, cuentasLocal, emitidas, cobroEmitidas, pasarela, declaraciones] = await Promise.all([
      bancosDeLaEmpresa(accountId, companyId),
      leer(tabla('bank_movement').select('id, treasury_account_id, op_date, amount, bank_concept, clean_concept, common_code, document_no, reference_1, reference_2, before_cutover, status, counterparty, movement_type')
        .eq('account_id', accountId).eq('company_id', companyId).in('status', ['pendiente', 'propuesto', 'por_aclarar']), 'los movimientos sin casar'),
      // B02: también las «en revisión» (en ámbar, «factura sin aprobar»).
      rpc<Fila[]>('bank_facturas_para_casar', { p_company: companyId }),
      rpc<Fila[]>('bank_saldos_cuentas', { p_company: companyId, p_hasta: hoy, p_prefijos: ['400', '410', '430', '465', '475', '476'] }),
      rpc<Fila[]>('bank_asientos_sin_movimiento', { p_company: companyId, p_desde: hace(400), p_hasta: hoy }),
      rpc<Fila[]>('bank_historial', { p_company: companyId, p_desde: hace(400) }),
      rpc<Fila[]>('bank_ventas_plataforma', { p_company: companyId, p_desde: hace(60), p_hasta: hoy }),
      leer(tabla('channel_settlement').select('id, channel_id, settlement_date, period_from, period_to, net_payout, accumulated_debt, gross_sales, commission, source, collected_on, store_id')
        .eq('account_id', accountId).order('settlement_date', { ascending: false }).limit(400), 'las liquidaciones'),
      leer(tabla('sales_channel').select('id, name').eq('account_id', accountId), 'los canales'),
      leer(tabla('party_role').select('party_id, role, channel_id, supplier_id').eq('account_id', accountId), 'lo que es cada contacto'),
      leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
      leer(tabla('company_account').select('id, code, name, plain_name, template_code, kind, withholding_model').eq('account_id', accountId).eq('company_id', companyId), 'el plan'),
      leer(tabla('recurring_contract').select('*').eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true), 'los contratos'),
      leer(tabla('bank_rule').select('id, words, condition, target, confirmations').eq('account_id', accountId).eq('company_id', companyId).eq('status', 'activa'), 'las reglas'),
      leer(tabla('supplier').select('id, name, legal_name').eq('account_id', accountId).eq('is_active', true), 'los proveedores'),
      leer(tabla('bank_card').select('id, treasury_account_id, last4, holder_name, location_id').eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true), 'las tarjetas'),
      leer(tabla('company').select('legal_name, trade_name').eq('id', companyId), 'la empresa'),
      // D01 · El mapa de tiendas de las plataformas: la cuenta del banco de cada marca × local.
      leer(tabla('platform_store').select('id, external_text, treasury_account_id, location_id').eq('account_id', accountId).eq('company_id', companyId), 'las tiendas de las plataformas'),
      leer(tabla('treasury_account').select('id, location_id').eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true).in('kind', ['bank', 'card', 'cash']), 'las cuentas de cada local'),
      // PC01 · Las emitidas a un cliente (no las de los cierres: ésas las cobra su liquidación) y lo que les queda.
      leer(tabla('customer_invoice').select('id, number_text, issue_date, party_id').eq('account_id', accountId).eq('company_id', companyId)
        .eq('status', 'emitida').in('origin', ['a_mano', 'recurrente', 'presupuesto', 'tienda', 'automatica']), 'las facturas emitidas'),
      leer(tabla('conta_factura_cobro').select('invoice_id, pendiente').eq('account_id', accountId).eq('company_id', companyId)
        .in('estado', ['vencida', 'falta_liquidacion', 'cobrada_parte', 'vence_semana', 'por_cobrar']), 'lo que queda por cobrar de cada factura'),
      // S01 · Los cobros por el enlace de pago (Stripe y TPV) que esperan su abono.
      // Si no se puede leer, Bancos sigue: esos abonos se casan a mano, como antes.
      rpc<Fila[]>('conta_abonos_pasarela_pendientes', { p_company: companyId })
        .catch((e: unknown) => { console.warn('[bancos] no se pudieron leer los cobros con tarjeta que esperan su abono', e); return [] as Fila[] }),
      // S01d · Las declaraciones presentadas a ingresar y sin su asiento de pago: el modelo y el periodo del pago, de aquí.
      leer(tabla('tax_return').select('id, form_code, fiscal_year, period, amount, payment_entry_id').eq('account_id', accountId).eq('company_id', companyId)
        .eq('status', 'filed').eq('result_kind', 'to_pay'), 'las declaraciones por pagar'),
    ])
    const tiendaDe = new Map(tiendas.map((t) => [String(t.id), t]))
    const bancosLocal = cuentasLocal.map((c) => ({ id: String(c.id), localId: s(c.location_id) }))
    const codigo = new Map(cuentas.map((c) => [String(c.id), String(c.code)]))
    const nombres: Record<string, string> = {}
    for (const c of cuentas) nombres[String(c.code)] = String(c.plain_name ?? c.name)
    const hoja = (t: string) => cuentas.find((c) => c.kind === 'template' && c.template_code === t)?.code as string | undefined
    const enlace = (e: string, id: string) => { const l = enlaces.find((x) => x.entity === e && x.entity_id === id && x.role === 'principal'); return l ? codigo.get(String(l.company_account_id)) ?? null : null }
    // PC01 · Por cada 430 de cliente, sus facturas emitidas con algo por cobrar (la más antigua primero).
    const quedaDe = new Map(cobroEmitidas.map((c) => [String(c.invoice_id), cent(c.pendiente)]))
    const facturasDeCliente = new Map<string, { id: string; numero: string | null; fecha: string; pendienteCent: number }[]>()
    for (const f of [...emitidas].sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)))) {
      if (!f.party_id) continue
      const c = enlace('customer', String(f.party_id)); const q = quedaDe.get(String(f.id)) ?? 0
      if (!c || q <= 0) continue
      facturasDeCliente.set(c, [...(facturasDeCliente.get(c) ?? []), { id: String(f.id), numero: s(f.number_text), fecha: String(f.issue_date), pendienteCent: q }])
    }
    const nombreCanal = new Map(canales.map((c) => [String(c.id), String(c.name)]))
    const partyDeCanal = new Map(roles.filter((r) => r.channel_id).map((r) => [String(r.channel_id), String(r.party_id)]))
    const cuentaDeCanal = (canal: string) => { const p = partyDeCanal.get(canal); return p ? enlace('customer', p) : null }

    const movimientos: Movimiento[] = movs.map((m) => ({
      id: String(m.id), cuentaId: String(m.treasury_account_id), fecha: String(m.op_date), importeCent: cent(m.amount),
      concepto: String(m.bank_concept || m.clean_concept || m.movement_type || ''), conceptoComun: s(m.common_code),
      contraparte: s(m.counterparty), tipo: s(m.movement_type),
      referencias: [s(m.document_no), s(m.reference_1), s(m.reference_2)].filter((x): x is string => !!x), antesDelCorte: !!m.before_cutover,
    }))

    // Lo aprendido por contraparte: lo casado en Bancos y lo traído de Diez.
    const veces = new Map<string, Aprendido>()
    for (const h of historial) {
      const cp = contraparte(String(h.concepto ?? ''))
      if (!cp || !h.cuenta) continue
      const k = `${cp}|${h.cuenta}`
      const a = veces.get(k) ?? { contraparte: cp, cuenta: String(h.cuenta), terceroId: s(h.tercero_id), veces: 0 }
      a.veces++
      veces.set(k, a)
    }

    const plataformas: Plataforma[] = []
    for (const [canal, nombre] of nombreCanal) {
      const c430 = cuentaDeCanal(canal)
      if (!c430) continue
      const suyas = liqs.filter((l) => String(l.channel_id) === canal && n(l.gross_sales) > 0)
      const comision = suyas.length ? suyas.reduce((t, l) => t + abs(n(l.commission)) / n(l.gross_sales), 0) / suyas.length : null
      const dias = ventas.filter((v) => v.cuenta === c430).map((v) => ({ fecha: String(v.fecha), c: cent(v.importe) }))
      plataformas.push({ nombre, alias: [nombre, ...pagadorDe(nombre)], cuenta430: c430, terceroId: partyDeCanal.get(canal) ?? null, comisionHabitual: comision, pendiente: ventanas(dias) })
    }

    const conTercero = (entidad: 'supplier' | 'customer') => saldos.filter((x) => x.tercero_entidad === entidad)
    const nombreProv = new Map(proveedores.map((p) => [String(p.id), p]))
    const nombre476 = hoja('476') ?? '47600000'
    const ctx: Contexto = {
      cuentas: bancos.map((b) => ({ id: b.id, nombre: b.nombre, cuenta: b.cuenta, ultimos4: b.iban ? b.iban.slice(-4) : null })),
      sinCasar: movimientos.filter((m) => !m.antesDelCorte),
      facturas: facturas.filter((f) => f.cuenta_tercero).map((f) => ({ id: String(f.id), numero: s(f.numero), fecha: String(f.fecha ?? hoy), totalCent: cent(f.total), pagadoCent: cent(f.pagado),
        proveedor: String(f.proveedor ?? ''), alias: (f.alias as string[] | null) ?? [], terceroId: s(f.tercero_id), cuentaTercero: String(f.cuenta_tercero),
        aprobada: f.estado !== 'en_revision' })),
      // P5: los proveedores con saldo acreedor en el libro (traído de Diez) y sin factura de Folvy pendiente.
      saldosTraidos: conTercero('supplier').filter((x) => n(x.saldo) < 0).map((x) => {
        const p = nombreProv.get(String(x.tercero_id))
        return { terceroId: null, proveedor: String(p?.name ?? x.nombre), alias: [p?.name, p?.legal_name, x.nombre].filter(Boolean).map(String), cuenta: String(x.cuenta), pendienteCent: -cent(x.saldo) }
      }),
      proveedores: proveedores.map((p) => ({ terceroId: null, proveedor: String(p.name), alias: [p.name, p.legal_name].filter(Boolean).map(String),
        cuentaTercero: enlace('supplier', String(p.id)) ?? '', cuentaAnticipo: hoja('407') ?? '40700000' })).filter((p) => p.cuentaTercero),
      clientes: conTercero('customer').filter((x) => n(x.saldo) > 0 && !plataformas.some((p) => p.cuenta430 === x.cuenta))
        .map((x) => ({ terceroId: null, nombre: String(x.nombre), alias: [String(x.nombre)], cuenta: String(x.cuenta), pendienteCent: cent(x.saldo),
          facturas: facturasDeCliente.get(String(x.cuenta)) ?? [] })),
      // D01 · Las del correo (una por marca × local): con su tienda, su banco y su ventana. Un neto
      // negativo o cero no se espera en el banco («sin cobro: pasa al siguiente»): no se busca.
      liquidaciones: liqs.filter((l) => !l.collected_on && l.net_payout !== null && l.channel_id && cuentaDeCanal(String(l.channel_id)))
        .filter((l) => !(String(l.source ?? '').startsWith('correo_') && cent(l.net_payout) <= 0)).map((l) => {
          const t = l.store_id ? tiendaDe.get(String(l.store_id)) : undefined
          return {
            id: String(l.id), plataforma: nombreCanal.get(String(l.channel_id)) ?? 'la plataforma', fecha: String(l.settlement_date ?? l.period_to ?? hoy),
            desde: s(l.period_from), hasta: s(l.period_to), netoCent: cent(l.net_payout) - (l.source === 'import_csv_glovo' ? cent(l.accumulated_debt) : 0),
            cuenta430: cuentaDeCanal(String(l.channel_id))!, terceroId: partyDeCanal.get(String(l.channel_id)) ?? null,
            porTienda: t && l.period_to ? { tienda: String(t.external_text).replace(/, [^,()]+, [A-Z]{2}, \d{5}\)$/, ')'), cuentaId: cuentaDeTienda({ cuentaId: s(t.treasury_account_id), localId: s(t.location_id) }, bancosLocal), ventana: ventanaDeCobro(String(l.period_to)) } : null,
          }
        }),
      plataformas,
      // Nóminas: lo que queda por pagar en 476 y 465 es la nómina del mes anterior (si está asentada).
      nominas: (() => {
        const ss = saldos.filter((x) => String(x.cuenta).startsWith('476')).reduce((t, x) => t - cent(x.saldo), 0)
        const neto = saldos.filter((x) => String(x.cuenta).startsWith('465')).reduce((t, x) => t - cent(x.saldo), 0)
        if (ss <= 0 && neto <= 0) return []
        const anterior = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
        return [{ mes: anterior, ssPendienteCent: ss, netoPendienteCent: neto, cuenta476: nombre476, cuenta465: hoja('465') ?? '46500000' }]
      })(),
      // S01d · De las declaraciones presentadas sin pagar: su modelo, su periodo y la cuenta del modelo
      // (la 4750 del 303; la subcuenta de la 4751 que dice ser de ese modelo; si no lo dice ninguna y solo
      // hay una 4751 con saldo, ésa). Lo que no tiene cuenta no se propone: se queda en «¿de qué modelo es?».
      impuestos: impuestosPorPagar(declaraciones, cuentas, saldos, hoy),
      contratos: contratos.map((c) => ({ id: String(c.id), tipo: c.kind as Contrato['tipo'], nombre: String(c.name), contiene: String(c.concept_contains),
        importeCent: c.amount === null ? null : cent(c.amount), confirmaciones: n(c.confirmations), terceroId: s(c.party_id),
        cuadro: Array.isArray(c.schedule) ? (c.schedule as Fila[]).map((f) => ({ fecha: String(f.fecha), cuotaCent: cent(f.cuota), capitalCent: cent(f.capital), interesesCent: cent(f.intereses) })) : null,
        // S01d · El capital de cada cuota va a corto (520); el paso de largo a corto va con el cierre del año.
        cuentaCapital: s(c.short_capital_account) ?? s(c.capital_account), cuentaIntereses: s(c.interest_account), cuentaGasto: s(c.expense_account) })),
      reglas: reglas.map((r) => {
        const cond = r.condition as Fila, dest = r.target as Fila
        return { id: String(r.id), palabras: String(r.words), contiene: String(cond.contiene), signo: cond.signo === 1 || cond.signo === -1 ? cond.signo : null,
          cuenta: String(dest.cuenta), terceroId: s(dest.tercero_id), confirmaciones: n(r.confirmations),
          // S01d · «Recordar este reparto»: las líneas de la regla (importe en céntimos; null = lo que falte).
          lineas: Array.isArray(dest.lineas) ? (dest.lineas as Fila[]).map((l) => ({ cuenta: String(l.cuenta), importeCent: l.importe_cent === null || l.importe_cent === undefined ? null : Number(l.importe_cent),
            concepto: s(l.concepto), modelo: s(l.modelo), periodo: s(l.periodo) })) : null }
      }),
      aprendido: [...veces.values()],
      asientos: asientos.map((a): AsientoLibre => ({ id: String(a.entry_id), cuentaId: String(a.treasury_account_id), fecha: String(a.fecha), importeCent: cent(a.importe),
        concepto: String(a.concepto), origen: a.origen as AsientoLibre['origen'] })),
      nombres,
      cuentas626: hoja('626') ?? '62600000',
      cuentaCaja: hoja('570') ?? null,
      tarjetas: tarjetas.map((t) => ({ id: String(t.id), cuentaId: String(t.treasury_account_id), ultimos4: String(t.last4), titular: String(t.holder_name), localId: s(t.location_id) })),
      cuentas476: nombre476,
      nombresPropios: nombresDeEmpresa(empresa[0]),
      cuentaDiferenciaGasto: hoja('669') ?? '66900000',
      cuentaDiferenciaIngreso: hoja('769') ?? '76900000',
      cobrosPasarela: (pasarela ?? []).map((c) => ({
        id: String(c.id), proveedor: c.proveedor === 'redsys' ? 'redsys' as const : 'stripe' as const, fecha: String(c.fecha), brutoCent: cent(c.bruto),
        netoCent: c.neto === null || c.neto === undefined ? null : cent(c.neto), comisionCent: c.comision === null || c.comision === undefined ? null : cent(c.comision),
        factura: s(c.factura), cliente: String(c.cliente ?? 'Un cliente'), cuenta: s(c.cuenta), conAsiento: c.con_asiento === true,
      })),
    }
    // S01c · Los albaranes que esperan factura, para decir cuál espera la que falta. Si la base aún
    // no tiene la función (antes de su tanda), se concilia igual, sin ellos.
    try {
      const esperando = await rpc<Fila[]>('compras_esperando_detalle', { p_cuenta: accountId })
      ctx.albaranesEsperando = (esperando ?? []).map((a) => ({ proveedor: String(a.supplier_name ?? ''), numero: s(a.doc_number) ?? s(a.code),
        fecha: String(a.receipt_date), totalCent: a.total_papel === null || a.total_papel === undefined ? null : cent(a.total_papel) }))
    } catch (e) { console.warn('[bancos] los albaranes que esperan factura no se han podido leer', e) }
    return { ctx, movimientos }
  }

  async function conciliarPendientes(accountId: string, companyId: string, hoy: string): Promise<ResultadoConciliar> {
    const { ctx, movimientos } = await cargarContexto(accountId, companyId, hoy)
    const decisiones = conciliar(movimientos, ctx)
    const r: ResultadoConciliar = { casadosSolos: 0, propuestos: 0, porAclarar: 0, antesDelCorte: 0, fallos: [], decisiones }
    const hechos = new Set<string>()
    for (const d of decisiones) {
      // El otro lado de un traspaso lo casa la decisión de su pareja: no se propone aparte.
      if (hechos.has(d.movimientoId) || d.otroLadoDe) continue
      const propuesta = { que: d.que, destino: d.destino, falta: d.falta, pideTicket: d.pideTicket, reglaId: d.reglaId, contraparte: d.contraparte, tarjetaId: d.tarjetaId,
        origen: d.origen, preseleccionar: d.preseleccionar, tarjetaDesconocida: d.tarjetaDesconocida, alternativas: d.alternativas,
        quedaPorCasarCent: d.quedaPorCasarCent, facturaSinAprobar: d.facturaSinAprobar, reparto: d.reparto ?? null }
      try {
        if (d.tarjetaId) await rpc('bank_tarjeta_del_movimiento', { p_movement: d.movimientoId, p_card: d.tarjetaId })
        if (d.confianza === 'seguro' && d.destino) {
          await casarDestino(d.movimientoId, d.destino, 'seguro', d.porque, 'folvy', d.reglaId)
          if (d.destino.tipo === 'traspaso') hechos.add(d.destino.otro_movimiento_id)
          r.casadosSolos++
        } else if (d.antesDelCorteSinPareja) {
          await rpc('bank_proponer', { p_movement: d.movimientoId, p_estado: 'antes_corte_sin_pareja', p_confianza: 'duda', p_porque: d.porque, p_propuesta: propuesta })
          r.antesDelCorte++
        } else {
          await rpc('bank_proponer', { p_movement: d.movimientoId, p_estado: d.confianza === 'probable' ? 'propuesto' : 'por_aclarar', p_confianza: d.confianza, p_porque: d.porque, p_propuesta: propuesta })
          if (d.confianza === 'probable') r.propuestos++; else r.porAclarar++
        }
      } catch (e) {
        // Lo que la base rechaza (el freno del IBAN de la factura, un mes cerrado…) no se pierde: queda por aclarar con el motivo.
        const motivo = e instanceof Error ? e.message : String(e)
        r.fallos.push({ movimiento: d.movimientoId, motivo })
        try {
          await rpc('bank_proponer', { p_movement: d.movimientoId, p_estado: 'por_aclarar', p_confianza: 'duda', p_porque: `${d.porque} No se ha podido casar: ${motivo}`, p_propuesta: propuesta })
          r.porAclarar++
        } catch { /* se queda pendiente: el fallo ya está en la lista */ }
      }
    }
    return r
  }

  /**
   * Casa un movimiento con su destino. El abono de Stripe o del TPV (S01) va a
   * conta_abono_pasarela_casar, que hace su asiento y lo casa con bank_casar;
   * lo demás, a bank_casar directamente.
   */
  async function casarDestino(movimientoId: string, destino: Destino, confianza: 'seguro' | 'probable' | 'duda', porque: string, por: 'folvy' | 'persona', reglaId: string | null): Promise<Fila> {
    if (destino.tipo === 'abono_pasarela') {
      return rpc<Fila>('conta_abono_pasarela_casar', { p_movement: movimientoId, p_enlaces: destino.cobros, p_confianza: confianza, p_porque: porque, p_por: por })
    }
    return rpc<Fila>('bank_casar', { p_movement: movimientoId, p_destino: destino, p_confianza: confianza, p_porque: porque, p_razones: [], p_por: por, p_regla: reglaId })
  }

  /** «Sí»: casa lo propuesto (o el destino que elija la persona). */
  async function confirmar(movimientoId: string, porque: string, destino: Destino, confianza: 'seguro' | 'probable' | 'duda', reglaId: string | null): Promise<{ asiento: string; creado: boolean }> {
    const r = await casarDestino(movimientoId, destino, confianza, porque, 'persona', reglaId)
    if (destino.tipo === 'abono_pasarela') return { asiento: String(r.asiento), creado: true }
    if (reglaId) await rpc('bank_regla_confirmada', { p_id: reglaId })
    return { asiento: String(r.asiento), creado: !!r.creado }
  }

  async function deshacer(casadoId: string, motivo: string): Promise<string> {
    const r = await rpc<Fila>('bank_deshacer', { p_match: casadoId, p_motivo: motivo })
    return String(r.asiento ?? '')
  }

  return { bancosDeLaEmpresa, importar, cargarContexto, conciliarPendientes, confirmar, deshacer }
}

/** S01d · Las declaraciones presentadas a ingresar y sin pagar, con la cuenta de su modelo. Pura. */
export function impuestosPorPagar(declaraciones: readonly Fila[], cuentas: readonly Fila[], saldos: readonly Fila[], hoy = new Date().toISOString().slice(0, 10)): Impuesto[] {
  const declaracionVieja = (d: Fila) => Number(d.fiscal_year) < Number(hoy.slice(0, 4)) - 1
  const conModelo = (m: string) => cuentas.filter((c) => c.withholding_model === m).map((c) => String(c.code))
  const cuenta4751Sola = (() => {
    const xs = saldos.filter((x) => String(x.cuenta).startsWith('4751') && Number(x.saldo) < 0).map((x) => String(x.cuenta))
    return xs.length === 1 ? xs[0] : null
  })()
  const c4750 = cuentas.find((c) => String(c.code).startsWith('4750') && c.kind !== 'template')?.code
  const out: Impuesto[] = []
  for (const d of declaraciones) {
    if (d.payment_entry_id) continue
    // Solo las de este año y el anterior: lo de antes ya se pagó (traído de otro programa, sin su asiento enlazado).
    if (declaracionVieja(d)) continue
    const modelo = String(d.form_code)
    if (!['303', '111', '115', '123'].includes(modelo)) continue
    const periodo = `${d.fiscal_year}-${d.period}`
    const cuenta = modelo === '303' ? (c4750 ? String(c4750) : null) : (conModelo(modelo).length === 1 ? conModelo(modelo)[0] : cuenta4751Sola)
    if (!cuenta) continue
    out.push({ modelo: modelo as Impuesto['modelo'], periodo, importeCent: Math.round(Number(d.amount) * 100), cuenta, declaracionId: String(d.id) })
  }
  return out
}
