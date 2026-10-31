// supabase/functions/_shared/bancoAgregador.ts
//
// B01c · Los movimientos del banco entran solos, por la conexión directa
// (open-banking.io, que va sobre Enable Banking). Núcleo PURO, sin Deno ni
// navegador: lo usan la función de cada noche (conta-banco-agregador), la app
// (src/modules/conta/lib/agregadorBanco.ts lo publica con el contrato
// ProveedorAgregador de fuentesBanco.ts) y las pruebas, con un proveedor
// simulado.
//
//   · `proveedorOpenBankingIo(cliente, hoy)`: open-banking.io con la forma de
//     cualquier proveedor (ProveedorAgregador). El cliente es la librería
//     @open-banking-io/client (o uno simulado): aquí no hay claves ni red.
//   · `movimientoDeOpenBankingIo`: su movimiento, en nuestro modelo.
//   · Los saldos del periodo: open-banking.io no da el saldo de cada día, da el
//     saldo de AHORA (el contable, con su fecha). El final del periodo es ese
//     saldo menos lo que entró después; el inicial, el final menos lo del
//     periodo. Así el extracto cuadra por construcción, y lo que de verdad se
//     comprueba es la CONTINUIDAD: que empiece donde acabó el anterior de la
//     cuenta (el último Norma 43, la primera noche). Si falta algo entre medias,
//     sale «hueco» con su importe, como con un fichero.
//   · `sincronizarEmpresa`: lo de cada noche para una empresa. Pide al banco lo
//     nuevo, empareja cada cuenta por IBAN con su banco de Folvy, lee desde el
//     día siguiente al último que trajo (la primera vez, desde el principio del
//     último extracto subido, para que lo ya subido por Norma 43 se reconozca),
//     hasta AYER (un día cerrado), lo mete por bank_importar y apunta cómo ha
//     ido en bank_aggregator_link. Lo que ya entró por Norma 43 no se duplica:
//     la base lo reconoce por la huella suave (día, importe y orden en el día).
//
// Las huellas, con la copia exacta de extractoBanco.ts (la misma regla que la
// subida de un fichero). Pruebas: tests/unit/modules/conta/bancoAgregadorB01c.test.ts.

import { huellas, huellasSuaves, limpiarConcepto, limpiarContraparte, movimientoSinTarjetas, type MovimientoLeido } from './extractoBanco.ts'

// ── El contrato de un proveedor (el mismo que fuentesBanco.ts) ───────────────

export interface CuentaAgregador { id: string; iban: string; titular: string | null; divisa: string }
export interface MovimientoAgregador { id: string; fecha: string; fechaValor: string | null; importeCent: number; concepto: string; contraparte: string | null }
export interface PaginaAgregador { saldoInicialCent: number | null; saldoFinalCent: number | null; movimientos: MovimientoAgregador[] }
export interface ProveedorAgregador {
  id: string
  nombre: string
  cuentas(conexion: string): Promise<CuentaAgregador[]>
  movimientos(conexion: string, cuenta: string, desde: string, hasta: string): Promise<PaginaAgregador>
}

/** Lo que un proveedor sabe además de los movimientos: pedir al banco lo nuevo y hasta cuándo vale el permiso. */
export interface ConexionDelProveedor {
  /** Pide al banco los movimientos nuevos. Devuelve las cuentas que no se han podido leer y por qué. */
  refrescar(): Promise<{ cuenta: string; motivo: string }[]>
  /** Por cuenta del proveedor: el permiso (su id), hasta cuándo vale (ISO) y si hay que renovarlo ya. */
  permisos(): Promise<Record<string, { conexion: string | null; caduca: string | null; renovar: boolean }>>
  /** El saldo que da el banco ahora, por cuenta del proveedor. */
  saldos(): Promise<Record<string, { cent: number; fecha: string } | null>>
}

// ── open-banking.io ─────────────────────────────────────────────────────────
// Los nombres son los de @open-banking-io/client 1.3.0 (dist/index.d.ts), ya
// descifrados por la librería. Solo los campos que se usan.

export interface SaldoObi { type: string; amount: string; currency: string; referenceDate: string | null }
export interface CuentaObi {
  id: string; aspspName: string; currency: string; needsReconnect: boolean
  iban: string | null; ownerName: string | null; displayName: string | null; balances: SaldoObi[]
}
export interface TransaccionObi {
  id: string; currency: string; creditDebitIndicator: string; status: string | null
  bookingDate: string | null; valueDate: string | null; transactionDate: string | null; bankTransactionCode: string | null
  amount: string; creditorName: string | null; debtorName: string | null; remittanceInformation: string | null; note: string | null
}
export interface ConexionObi { sessionId: string; aspspName: string; validUntil: string; status: string; isLive: boolean; accountIds: string[] }
export interface ClienteOpenBankingIo {
  getAccounts(): Promise<CuentaObi[]>
  getTransactions(accountId: string, q?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<{ items: TransaccionObi[]; total: number }>
  getConnections(): Promise<ConexionObi[]>
  syncAll(): Promise<{ accounts: number; newTransactions: number; failures: { accountId: string; reason: string; bankErrorCode: string | null }[] }>
}

export const PROVEEDOR_OBI = 'open-banking-io'
/** La fuente de lo que entra por aquí (bank_statement.source). */
export const FUENTE_OBI = `agregador:${PROVEEDOR_OBI}` as const

/** Un importe en texto decimal («-45.10», «1234,5») a céntimos, sin pasar por coma flotante. */
export function centimos(texto: string): number {
  const m = /^\s*([+-])?(\d+)(?:[.,](\d+))?\s*$/.exec(texto)
  if (!m) throw new Error(`Importe del banco que no se entiende: «${texto}».`)
  const dec = (m[3] ?? '').padEnd(2, '0')
  if (/[1-9]/.test(dec.slice(2))) throw new Error(`Importe del banco con más de dos decimales: «${texto}».`)
  const c = Number(m[2]) * 100 + Number(dec.slice(0, 2))
  return m[1] === '-' ? -c : c
}

/** Solo lo contabilizado: lo pendiente puede cambiar o desaparecer. */
export const contabilizado = (t: Pick<TransaccionObi, 'status'>) => !t.status || /^book/i.test(t.status)

/** Su movimiento, en nuestro modelo: céntimos con signo, la fecha contable, el concepto y la contraparte. */
export function movimientoDeOpenBankingIo(t: TransaccionObi): MovimientoAgregador {
  const fecha = t.bookingDate ?? t.transactionDate ?? t.valueDate
  if (!fecha) throw new Error('Un movimiento del banco sin fecha no se puede importar.')
  const bruto = centimos(t.amount)
  // El signo lo dice el indicador (DBIT sale, CRDT entra); si no viene, el del importe.
  const ind = (t.creditDebitIndicator ?? '').toUpperCase()
  const importeCent = ind === 'DBIT' ? -Math.abs(bruto) : ind === 'CRDT' ? Math.abs(bruto) : bruto
  const contraparte = ((importeCent < 0 ? t.creditorName : t.debtorName) ?? '').trim() || null
  const concepto = [t.remittanceInformation, t.note].map((x) => (x ?? '').trim()).filter(Boolean).join(' ') || contraparte || 'Movimiento'
  return { id: t.id, fecha: fecha.slice(0, 10), fechaValor: t.valueDate?.slice(0, 10) ?? null, importeCent, concepto, contraparte }
}

/** Los saldos contables, por orden de preferencia: el del momento, el de cierre, el esperado. Nunca uno «disponible» (lleva el crédito). */
const SALDOS_CONTABLES = ['ITBD', 'CLBD', 'XPCD']

/** El saldo contable que da el banco y su fecha (la de hoy si no la dice). Null si no da ninguno. */
export function saldoDelBanco(saldos: readonly SaldoObi[], hoy: string): { cent: number; fecha: string; tipo: string } | null {
  for (const tipo of SALDOS_CONTABLES) {
    const s = saldos.find((x) => x.type === tipo)
    if (s) return { cent: centimos(s.amount), fecha: (s.referenceDate ?? hoy).slice(0, 10), tipo }
  }
  return null
}

/**
 * El saldo al cerrar el día `hasta`, sabiendo el del banco el día `saldo.fecha`
 * y los movimientos contabilizados entre los dos días (los dos incluidos).
 */
export function saldoAlCerrar(saldo: { cent: number; fecha: string }, movs: readonly { fecha: string; importeCent: number }[], hasta: string): number {
  let c = saldo.cent
  for (const m of movs) {
    if (m.fecha > hasta && m.fecha <= saldo.fecha) c -= m.importeCent
    else if (m.fecha <= hasta && m.fecha > saldo.fecha) c += m.importeCent
  }
  return c
}

/** Todas las páginas de movimientos de una cuenta entre dos días. */
async function todosLosMovimientos(c: ClienteOpenBankingIo, cuenta: string, desde: string, hasta: string): Promise<TransaccionObi[]> {
  const out: TransaccionObi[] = []
  const LIMITE = 200
  for (let pagina = 0; pagina < 100; pagina++) {
    const p = await c.getTransactions(cuenta, { from: desde, to: hasta, limit: LIMITE, offset: out.length })
    out.push(...(p.items ?? []))
    if (!p.items?.length || out.length >= p.total) return out
  }
  throw new Error(`La cuenta ${cuenta} tiene más de ${100 * LIMITE} movimientos entre el ${desde} y el ${hasta}: no los traigo a medias.`)
}

const ibanLimpio = (iban: string | null) => (iban ?? '').replace(/\s+/g, '').toUpperCase()

/** open-banking.io como proveedor, con lo que además sabe de la conexión. `hoy`: el día de Madrid en que se lee. */
export function proveedorOpenBankingIo(c: ClienteOpenBankingIo, hoy: string): ProveedorAgregador & ConexionDelProveedor {
  let cuentasObi: Promise<CuentaObi[]> | null = null
  const leerCuentas = () => (cuentasObi ??= c.getAccounts())
  return {
    id: PROVEEDOR_OBI,
    nombre: 'open-banking.io',
    async cuentas() {
      return (await leerCuentas()).map((a) => ({ id: a.id, iban: ibanLimpio(a.iban), titular: a.ownerName ?? a.displayName ?? null, divisa: a.currency || 'EUR' }))
    },
    async movimientos(_conexion, cuenta, desde, hasta) {
      const cuentaObi = (await leerCuentas()).find((a) => a.id === cuenta)
      if (!cuentaObi) throw new Error(`La cuenta ${cuenta} ya no está en la conexión.`)
      // Se lee hasta hoy (no hasta `hasta`): lo de después del periodo hace falta para saber su saldo final.
      const leidos = (await todosLosMovimientos(c, cuenta, desde, hoy)).filter(contabilizado).map(movimientoDeOpenBankingIo)
        .filter((m) => m.fecha >= desde && m.fecha <= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))
      const dentro = leidos.filter((m) => m.fecha <= hasta)
      const saldo = saldoDelBanco(cuentaObi.balances ?? [], hoy)
      if (!saldo || saldo.fecha < hasta) return { saldoInicialCent: null, saldoFinalCent: null, movimientos: dentro }
      const final = saldoAlCerrar(saldo, leidos, hasta)
      return { saldoInicialCent: final - dentro.reduce((t, m) => t + m.importeCent, 0), saldoFinalCent: final, movimientos: dentro }
    },
    async refrescar() {
      const r = await c.syncAll()
      return (r.failures ?? []).map((f) => ({ cuenta: f.accountId, motivo: f.reason }))
    },
    async permisos() {
      const out: Record<string, { conexion: string | null; caduca: string | null; renovar: boolean }> = {}
      for (const x of await c.getConnections()) for (const id of x.accountIds ?? []) out[id] = { conexion: x.sessionId ?? null, caduca: x.validUntil ?? null, renovar: !x.isLive }
      for (const a of await leerCuentas()) if (a.needsReconnect) out[a.id] = { conexion: out[a.id]?.conexion ?? null, caduca: out[a.id]?.caduca ?? null, renovar: true }
      return out
    },
    async saldos() {
      const out: Record<string, { cent: number; fecha: string } | null> = {}
      for (const a of await leerCuentas()) { const s = saldoDelBanco(a.balances ?? [], hoy); out[a.id] = s ? { cent: s.cent, fecha: s.fecha } : null }
      return out
    },
  }
}

// ── Lo que se manda a bank_importar ─────────────────────────────────────────

/** Los movimientos del proveedor, como los manda la subida de un fichero (bancosNucleo.importar): sin tarjetas y con sus dos huellas. */
export function paraImportar(movs: readonly MovimientoAgregador[]): Record<string, unknown>[] {
  const leidos: MovimientoLeido[] = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((m) => movimientoSinTarjetas({
    fecha: m.fecha, fechaValor: m.fechaValor ?? m.fecha, importeCent: m.importeCent,
    conceptoBanco: [m.concepto, m.contraparte].filter(Boolean).join(' · '),
    conceptoComun: null, conceptoPropio: null, numeroDocumento: null, referencia1: null, referencia2: m.id,
    equivalencia: null, tipoMovimiento: null, contraparte: limpiarContraparte(m.contraparte),
  }))
  const hs = huellas(leidos), ss = huellasSuaves(leidos)
  return leidos.map((m, j) => ({
    fecha: m.fecha, fecha_valor: m.fechaValor, importe: m.importeCent / 100, concepto_banco: m.conceptoBanco, concepto_limpio: limpiarConcepto(m.conceptoBanco),
    comun: null, propio: null, documento: null, ref1: null, ref2: m.referencia2, contraparte: m.contraparte, tipo: null,
    huella: hs[j], huella_suave: ss[j],
  }))
}

// ── La ventana: desde cuándo se lee ─────────────────────────────────────────

const masDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** Lo más atrás que se lee (el banco guarda unos 90 días). */
export const DIAS_ATRAS = 89

/** B01 Revolut · Lo que cambia de un proveedor a otro al decidir desde cuándo se lee. */
export interface OpcionesLectura {
  /** La fuente de los extractos de esta conexión (por defecto, la de open-banking.io, como antes). */
  fuente?: string
  /** La primera vez, sin nada suyo: desde este día (la carga del histórico que pide la persona). */
  desdeInicial?: string | null
  /** Lo más atrás que deja leer el banco (open-banking.io: 89). */
  diasAtras?: number
  /**
   * B01 Revolut (respuesta 3): se vuelve a leer el último día leído, porque lo
   * terminado entra en cuanto llega (hasta HOY, no hasta ayer). Solo para un
   * proveedor cuyos movimientos terminados tienen un id que no cambia, y con
   * una base que diga cuáles ya tiene (BaseAgregador.conocidos).
   */
  releerUltimoDia?: boolean
}

/**
 * Desde qué día se lee una cuenta. Si ya trajo algo la conexión, desde el día
 * siguiente al último. Si no, desde el día que pidió la persona (si lo hay) o
 * desde el principio del último extracto subido (así lo ya subido por Norma 43
 * se reconoce y la continuidad se mide contra el de antes); sin ninguno, los
 * últimos 30 días. Nunca más de `diasAtras` (89) días atrás.
 */
export function desdeCuando(extractos: readonly { fuente: string; desde: string; hasta: string }[], hoy: string, o: OpcionesLectura = {}): string {
  const fuente = o.fuente ?? FUENTE_OBI
  const tope = masDias(hoy, -(o.diasAtras ?? DIAS_ATRAS))
  const suyos = extractos.filter((e) => e.fuente === fuente).sort((a, b) => b.hasta.localeCompare(a.hasta))
  const d = suyos[0] ? masDias(suyos[0].hasta, o.releerUltimoDia ? 0 : 1)
    : o.desdeInicial ?? [...extractos].sort((a, b) => b.hasta.localeCompare(a.hasta))[0]?.desde ?? masDias(hoy, -30)
  return d < tope ? tope : d
}

// ── Lo de cada noche ────────────────────────────────────────────────────────

/** Lo que necesita de la base (la función con la clave de servicio; la e2e con la sesión de su administrador). */
export interface BaseAgregador {
  bancos(accountId: string, companyId: string): Promise<{ id: string; nombre: string; iban: string | null }[]>
  extractos(treasuryId: string): Promise<{ fuente: string; desde: string; hasta: string }[]>
  importar(args: Record<string, unknown>): Promise<Record<string, unknown>>
  apuntar(args: Record<string, unknown>): Promise<void>
  /**
   * B01 Revolut: de estas referencias del proveedor (reference_2), cuáles ya
   * están en este banco. Con ella solo se manda lo nuevo, y una lectura sin
   * nada nuevo no crea un extracto. Sin ella (BBVA), como antes.
   */
  conocidos?(treasuryId: string, referencias: string[]): Promise<Set<string>>
}

export type EstadoCuenta = 'al_dia' | 'sin_movimientos' | 'permiso_caducado' | 'fallo'

export interface ParteCuenta {
  banco: string | null
  cuentaProveedor: string
  iban4: string
  estado: EstadoCuenta | 'sin_banco_en_folvy'
  mensaje: string
  desde: string | null
  hasta: string | null
  leidos: number
  nuevos: number
  repetidos: number
  posiblesRepetidos: number
  continuidad: string | null
  huecoCent: number | null
  /** El saldo que da el banco ahora; y el de Folvy al cerrar el periodo (el que queda en el extracto). */
  saldoBancoCent: number | null
  saldoFinalCent: number | null
  caduca: string | null
}

const euros = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`

/**
 * Una empresa, una noche: pedir lo nuevo al banco, emparejar por IBAN, importar
 * lo de cada cuenta hasta `ayer` y apuntar cómo ha ido. Una cuenta que falla no
 * para a las demás; su fallo queda apuntado con su porqué (y en el parte).
 */
export async function sincronizarEmpresa(base: BaseAgregador, p: ProveedorAgregador & ConexionDelProveedor,
  e: { accountId: string; companyId: string; banco: string; renovar: string | null }, hoy: string, ayer: string, o: OpcionesLectura = {}): Promise<ParteCuenta[]> {
  const fallos = new Map((await p.refrescar()).map((f) => [f.cuenta, f.motivo]))
  const [cuentas, permisos, saldos, bancos] = await Promise.all([p.cuentas(''), p.permisos(), p.saldos(), base.bancos(e.accountId, e.companyId)])
  const out: ParteCuenta[] = []
  for (const c of cuentas) {
    const banco = bancos.find((b) => b.iban && ibanLimpio(b.iban) === c.iban) ?? null
    const permiso = permisos[c.id] ?? { conexion: null, caduca: null, renovar: false }
    const saldo = saldos[c.id] ?? null
    const parte: ParteCuenta = {
      banco: banco?.nombre ?? null, cuentaProveedor: c.id, iban4: c.iban.slice(-4), estado: 'al_dia', mensaje: '', desde: null, hasta: null,
      leidos: 0, nuevos: 0, repetidos: 0, posiblesRepetidos: 0, continuidad: null, huecoCent: null,
      saldoBancoCent: saldo?.cent ?? null, saldoFinalCent: null, caduca: permiso.caduca,
    }
    out.push(parte)
    if (!banco) {
      parte.estado = 'sin_banco_en_folvy'
      parte.mensaje = `La cuenta ···${parte.iban4} está conectada pero no es ningún banco de la empresa en Folvy: no se trae.`
      continue
    }
    const apuntar = (extra: Record<string, unknown> = {}) => base.apuntar({
      p_treasury: banco.id, p_proveedor: p.id, p_cuenta_proveedor: c.id, p_conexion: permiso.conexion, p_banco: e.banco, p_caduca: permiso.caduca, p_renovar: e.renovar,
      p_estado: parte.estado, p_mensaje: parte.mensaje, p_saldo_banco: saldo ? saldo.cent / 100 : null, p_saldo_fecha: saldo?.fecha ?? null,
      p_nuevos: parte.nuevos, p_repetidos: parte.repetidos, p_desde: parte.desde, p_hasta: parte.hasta, ...extra,
    })
    try {
      const motivo = fallos.get(c.id)
      if (permiso.renovar || motivo === 'reconnect_needed' || motivo === 'consent_withdrawn') {
        parte.estado = 'permiso_caducado'
        parte.mensaje = `El permiso para leer ${e.banco} ···${parte.iban4} ha caducado: desde entonces no llegan sus movimientos. Hay que renovarlo.`
        await apuntar()
        continue
      }
      const desde = desdeCuando(await base.extractos(banco.id), hoy, o)
      parte.desde = desde; parte.hasta = ayer
      if (desde > ayer) { parte.estado = 'sin_movimientos'; parte.mensaje = 'Ya estaba al día.'; await apuntar(); continue }
      const pag = await p.movimientos('', c.id, desde, ayer)
      parte.leidos = pag.movimientos.length
      // Sin movimientos no se crea un extracto vacío: la próxima noche se vuelve a leer desde el mismo día.
      if (pag.movimientos.length === 0) {
        parte.estado = 'sin_movimientos'; parte.desde = null; parte.hasta = null
        parte.mensaje = motivo ? `El banco no ha dado movimientos nuevos (dice: ${motivo}).` : `Sin movimientos nuevos del ${desde} al ${ayer}.`
        await apuntar(); continue
      }
      const sinSaldo = pag.saldoInicialCent === null || pag.saldoFinalCent === null
      // B01 Revolut: las huellas, sobre el periodo entero (el orden en el día no
      // cambia de una lectura a otra); y a la base, solo lo que no tiene aún.
      let movs = paraImportar(pag.movimientos)
      let yaEstaban = 0
      let saldoInicialCent = pag.saldoInicialCent
      if (base.conocidos) {
        const conocidos = await base.conocidos(banco.id, movs.map((m) => String(m.ref2)))
        const nuevos = movs.filter((m) => !conocidos.has(String(m.ref2)))
        yaEstaban = movs.length - nuevos.length
        movs = nuevos
        if (!sinSaldo) saldoInicialCent = pag.saldoFinalCent! - nuevos.reduce((s, m) => s + Math.round(Number(m.importe) * 100), 0)
        if (movs.length === 0) {
          parte.estado = 'sin_movimientos'; parte.repetidos = yaEstaban; parte.desde = null; parte.hasta = null; parte.saldoFinalCent = pag.saldoFinalCent
          parte.mensaje = `Nada nuevo desde la última lectura (${yaEstaban} ya estaban).`
          await apuntar(); continue
        }
      }
      const r = await base.importar({
        p_treasury: banco.id, p_fuente: `agregador:${p.id}`, p_formato: `agregador:${p.id}`, p_fichero: `${p.nombre} · del ${desde} al ${ayer}`, p_sha256: null,
        p_desde: desde, p_hasta: ayer,
        p_saldo_inicial: sinSaldo ? null : saldoInicialCent! / 100, p_saldo_final: sinSaldo ? null : pag.saldoFinalCent! / 100,
        p_sin_comprobar: sinSaldo ? 'La conexión con el banco no ha dado el saldo contable: no se puede comprobar que empiece donde acabó el anterior.' : null,
        p_iban_fichero: null, p_movs: movs,
      })
      parte.nuevos = Number(r.nuevos ?? 0); parte.repetidos = Number(r.repetidos ?? 0) + yaEstaban; parte.posiblesRepetidos = Number(r.posibles_repetidos ?? 0)
      parte.continuidad = r.continuidad == null ? null : String(r.continuidad)
      parte.huecoCent = r.hueco == null ? null : Math.round(Number(r.hueco) * 100)
      parte.saldoFinalCent = pag.saldoFinalCent
      parte.mensaje = `${parte.nuevos} nuevos y ${parte.repetidos} que ya estaban, del ${desde} al ${ayer}`
        + (parte.continuidad === 'hueco' && parte.huecoCent !== null ? `. No empieza donde acabó el anterior: faltan ${euros(parte.huecoCent)}.` : '.')
      await apuntar()
    } catch (err) {
      parte.estado = 'fallo'
      parte.mensaje = `No se han podido traer los movimientos: ${err instanceof Error ? err.message : String(err)}`
      try { await apuntar() } catch (e2) { parte.mensaje += ` (y no se ha podido apuntar: ${e2 instanceof Error ? e2.message : String(e2)})` }
    }
  }
  return out
}
