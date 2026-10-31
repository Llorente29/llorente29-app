// supabase/functions/_shared/revolut/lectura.ts
//
// B01 Revolut · PR 1 · LOS MOVIMIENTOS DE REVOLUT, como los de cualquier banco.
// Núcleo PURO, sin Deno ni red: lo usan conta-revolut-leer y las pruebas
// (tests/unit/modules/conta/revolut/lectura.test.ts), con un cliente simulado.
//
// Revolut entra por el mismo enchufe que BBVA: es un proveedor más del
// agregador (ProveedorAgregador + ConexionDelProveedor, _shared/bancoAgregador.ts),
// y lo que lee lo mete sincronizarEmpresa por bank_importar. Ni tabla ni
// conciliación propias.
//
// Las reglas (paso 0, §1.3, y respuesta 1), con los nombres de la
// especificación oficial (revolut-openapi, business.json, 30/10/2026):
//   · Un movimiento por PATA (legs[]): una transacción entre dos cuentas
//     propias entra en cada una, una vez. Su id: «<transacción>:<leg_id>».
//   · Solo `completed`. `created` y `pending` no entran todavía (cambiarían);
//     `declined` y `failed` no entran nunca.
//   · La fecha, la de `completed_at` en hora de Madrid (regla 4), que no cambia.
//   · `reverted` después de completada: entra lo que entró (si se completó
//     antes) y además un movimiento CONTRARIO el día en que se devolvió
//     (`updated_at`), con id «<transacción>:<leg_id>:vuelta». Lo casado no se
//     toca: el contrario sale por casar.
//   · La comisión de la pata (`fee`), un movimiento aparte: «Comisión de
//     Revolut», id «<transacción>:<leg_id>:comision».
//   · Solo las cuentas en euros se traen (respuesta 1, P2: las demás divisas
//     quedan para otro encargo). Las otras se enseñan, no se leen.
//   · LO TERMINADO ENTRA EN CUANTO LLEGA (respuesta 3 de Julio): por el aviso
//     o por la lectura de cada hora, hasta HOY, no hasta ayer. La espera de un
//     día es de cómo lee BBVA y se queda para BBVA. Por eso Revolut se lee con
//     `OPCIONES_REVOLUT`: vuelve a leer el último día leído (releerUltimoDia)
//     y manda a la base solo lo que no tiene aún (BaseAgregador.conocidos,
//     por su id). Una lectura sin nada nuevo no crea extracto.
//
// El id de Revolut va en reference_2 y forma parte de la huella dura: leer el
// mismo día dos veces no crea nada nuevo (y, si llegara, bank_importar: on
// conflict (treasury_account_id, fingerprint) do nothing). Las huellas se
// calculan sobre el día entero, en el mismo orden cada vez (por la hora en que
// se terminó), así que un movimiento tiene la misma huella en cada lectura.

import type { ConexionDelProveedor, CuentaAgregador, MovimientoAgregador, PaginaAgregador, ProveedorAgregador } from '../bancoAgregador.ts'
import { saldoAlCerrar } from '../bancoAgregador.ts'

export const PROVEEDOR_REVOLUT = 'revolut'
/** La fuente de sus extractos en bank_statement (la que mira desdeCuando). */
export const FUENTE_REVOLUT = `agregador:${PROVEEDOR_REVOLUT}` as const
/** Revolut deja leer todo el historial: el tope es el que pida la persona. Para no pedir el año entero cada vez, 3 años. */
export const DIAS_ATRAS_REVOLUT = 3 * 366
/** Cuántos días antes del periodo se mira, para encontrar devoluciones de pagos más viejos. */
export const DIAS_DEVOLUCIONES = 90

/** Cómo se lee Revolut con sincronizarEmpresa (con `hoy` como último día, no ayer). */
export const OPCIONES_REVOLUT = { fuente: FUENTE_REVOLUT, diasAtras: DIAS_ATRAS_REVOLUT, releerUltimoDia: true } as const

// ── Lo que da la API (solo los campos que se usan) ──────────────────────────

export type EstadoRevolut = 'created' | 'pending' | 'completed' | 'declined' | 'failed' | 'reverted'

export interface PataRevolut {
  leg_id: string
  account_id: string
  amount: number
  fee?: number | null
  currency: string
  description?: string | null
  balance?: number | null
  counterparty?: { account_type?: string | null; account_id?: string | null; id?: string | null } | null
}

export interface TransaccionRevolut {
  id: string
  type: string
  state: EstadoRevolut
  request_id?: string | null
  reason_code?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
  reference?: string | null
  merchant?: { name?: string | null } | null
  legs: PataRevolut[]
}

export interface CuentaRevolut { id: string; name?: string | null; balance: number; currency: string; state: string; public?: boolean; updated_at?: string }
export interface DatosBancoRevolut { iban?: string | null; bic?: string | null; account_no?: string | null; beneficiary?: string | null; schemes?: string[] | null }

/** Lo mínimo del cliente de Revolut que hace falta para leer (cliente.ts, o uno simulado en las pruebas). */
export interface ClienteLecturaRevolut {
  cuentas(): Promise<CuentaRevolut[]>
  datosBanco(cuenta: string): Promise<DatosBancoRevolut[]>
  /** Todas las transacciones de una cuenta creadas entre `desde` y `hasta` (ISO), ya paginadas. */
  transacciones(cuenta: string, desde: string, hasta: string): Promise<TransaccionRevolut[]>
}

// ── De Revolut a nuestro modelo ─────────────────────────────────────────────

/** El día de Madrid de un instante, AAAA-MM-DD (regla 4). */
export const diaMadrid = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

/** Euros con decimales (como los da Revolut) a céntimos, sin errores de coma flotante. */
export const aCentimos = (euros: number) => Math.round(euros * 100)

const ibanLimpio = (s: string) => s.replace(/\s+/g, '').toUpperCase()

function conceptoDe(t: TransaccionRevolut, p: PataRevolut): { concepto: string; contraparte: string | null } {
  const descripcion = (p.description ?? '').trim()
  const referencia = (t.reference ?? '').trim()
  const comercio = (t.merchant?.name ?? '').trim()
  const contraparte = comercio || (descripcion && /^(to|from|para|de)\s+/i.test(descripcion) ? descripcion.replace(/^(to|from|para|de)\s+/i, '') : null) || null
  const partes = [descripcion || TIPOS[t.type] || t.type, referencia && referencia !== descripcion ? referencia : ''].filter(Boolean)
  return { concepto: partes.join(' · '), contraparte }
}

/** El tipo de Revolut en palabras, cuando la pata no trae descripción. */
const TIPOS: Record<string, string> = {
  atm: 'Cajero', card_payment: 'Pago con tarjeta', card_refund: 'Devolución de tarjeta', card_chargeback: 'Retrocesión de tarjeta',
  card_credit: 'Abono en tarjeta', exchange: 'Cambio de divisa', transfer: 'Transferencia', loan: 'Préstamo', fee: 'Comisión de Revolut',
  refund: 'Devolución', topup: 'Ingreso', topup_return: 'Devolución de ingreso', tax: 'Impuesto', tax_refund: 'Devolución de impuesto',
}

/**
 * Los movimientos de UNA cuenta de Revolut entre `desde` y `hasta` (días de
 * Madrid, los dos incluidos), sacados de las transacciones que se han leído.
 * Ordenados por fecha y, dentro del día, por el instante: así la huella suave
 * sale igual cada vez que se lee el mismo día.
 */
export function movimientosDeRevolut(txs: readonly TransaccionRevolut[], cuenta: string, desde: string, hasta: string): MovimientoAgregador[] {
  const out: (MovimientoAgregador & { instante: string })[] = []
  const dentro = (d: string) => d >= desde && d <= hasta
  for (const t of txs) {
    for (const p of t.legs ?? []) {
      if (p.account_id !== cuenta) continue
      const { concepto, contraparte } = conceptoDe(t, p)
      const base = `${t.id}:${p.leg_id}`
      const completada = t.completed_at ?? null
      // Lo que entró: completada, o devuelta después de haberse completado.
      if (completada && (t.state === 'completed' || t.state === 'reverted')) {
        const dia = diaMadrid(completada)
        if (dentro(dia)) {
          out.push({ id: base, fecha: dia, fechaValor: dia, importeCent: aCentimos(p.amount), concepto, contraparte, instante: completada })
          const fee = aCentimos(p.fee ?? 0)
          if (fee !== 0) out.push({ id: `${base}:comision`, fecha: dia, fechaValor: dia, importeCent: -Math.abs(fee), concepto: `Comisión de Revolut · ${concepto}`, contraparte: 'Revolut', instante: completada })
        }
      }
      // La devolución: el contrario, el día en que Revolut la devolvió.
      if (t.state === 'reverted' && completada) {
        const dia = diaMadrid(t.updated_at)
        if (dentro(dia)) {
          out.push({ id: `${base}:vuelta`, fecha: dia, fechaValor: dia, importeCent: -aCentimos(p.amount), concepto: `Devuelto por Revolut · ${concepto}`, contraparte, instante: t.updated_at })
          const fee = aCentimos(p.fee ?? 0)
          if (fee !== 0) out.push({ id: `${base}:comision:vuelta`, fecha: dia, fechaValor: dia, importeCent: Math.abs(fee), concepto: `Devuelta la comisión de Revolut · ${concepto}`, contraparte: 'Revolut', instante: t.updated_at })
        }
      }
    }
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.instante.localeCompare(b.instante) || a.id.localeCompare(b.id))
  return out.map((m) => ({ id: m.id, fecha: m.fecha, fechaValor: m.fechaValor, importeCent: m.importeCent, concepto: m.concepto, contraparte: m.contraparte }))
}

/** Los cuatro últimos de un IBAN o de un número de cuenta, para enseñar y para los registros (nunca entero). */
export const ultimos4 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').slice(-4)

// ── Revolut como proveedor del agregador ───────────────────────────────────

const masDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** El primer instante de un día de Madrid, en ISO, con un día de margen (la API filtra por created_at en UTC). */
const inicioHolgado = (dia: string) => `${masDias(dia, -1)}T00:00:00Z`
const finHolgado = (dia: string) => `${masDias(dia, 2)}T00:00:00Z`

/**
 * Revolut con la forma de cualquier proveedor. `hoy` es el día de Madrid de la
 * lectura. El saldo del periodo, como con open-banking.io: el saldo de AHORA
 * de la cuenta, menos lo que entró después del periodo (saldoAlCerrar).
 * Solo se ofrecen las cuentas activas en euros.
 */
export function proveedorRevolut(c: ClienteLecturaRevolut, hoy: string): ProveedorAgregador & ConexionDelProveedor & { otrasDivisas(): Promise<CuentaRevolut[]> } {
  let cuentasCache: CuentaRevolut[] | null = null
  const todas = async () => (cuentasCache ??= await c.cuentas())
  const enEuros = async () => (await todas()).filter((a) => a.state === 'active' && a.currency === 'EUR')
  return {
    id: PROVEEDOR_REVOLUT,
    nombre: 'Revolut Business',
    async cuentas(): Promise<CuentaAgregador[]> {
      const out: CuentaAgregador[] = []
      for (const a of await enEuros()) {
        const datos = await c.datosBanco(a.id)
        const iban = datos.map((d) => d.iban).find((x): x is string => !!x)
        if (!iban) continue
        out.push({ id: a.id, iban: ibanLimpio(iban), titular: datos.find((d) => d.beneficiary)?.beneficiary ?? null, divisa: a.currency })
      }
      return out
    },
    async movimientos(_conexion: string, cuenta: string, desde: string, hasta: string): Promise<PaginaAgregador> {
      // Se mira desde antes (las devoluciones de pagos viejos) y hasta hoy (lo de después del periodo, para el saldo al cerrar).
      const txs = await c.transacciones(cuenta, inicioHolgado(masDias(desde, -DIAS_DEVOLUCIONES)), finHolgado(hoy))
      const movimientos = movimientosDeRevolut(txs, cuenta, desde, hasta)
      const despues = movimientosDeRevolut(txs, cuenta, masDias(hasta, 1), hoy)
      const a = (await todas()).find((x) => x.id === cuenta)
      if (!a) return { saldoInicialCent: null, saldoFinalCent: null, movimientos }
      const final = saldoAlCerrar({ cent: aCentimos(a.balance), fecha: hoy }, despues, hasta)
      const delPeriodo = movimientos.reduce((s, m) => s + m.importeCent, 0)
      return { saldoInicialCent: final - delPeriodo, saldoFinalCent: final, movimientos }
    },
    // Revolut no necesita que se le pida refrescar: lo que hay, lo da.
    async refrescar() { return [] },
    // El permiso es el de la conexión entera (el token de renovación), no por cuenta: sin fecha conocida.
    async permisos() {
      return Object.fromEntries((await enEuros()).map((a) => [a.id, { conexion: a.id, caduca: SIN_CADUCIDAD, renovar: false }]))
    },
    async saldos() {
      return Object.fromEntries((await enEuros()).map((a) => [a.id, { cent: aCentimos(a.balance), fecha: hoy }]))
    },
    async otrasDivisas() { return (await todas()).filter((a) => a.state === 'active' && a.currency !== 'EUR') },
  }
}

/**
 * Revolut no dice hasta cuándo vale el permiso (su duración vive en las guías,
 * no en la especificación). bank_aggregator_link exige una fecha: se apunta
 * ésta, y la app la lee como «sin fecha». Si una renovación falla porque el
 * permiso se retiró o caducó, la conexión entera pasa a «Desconectada desde
 * Revolut» (conta-revolut-leer), no por esta fecha.
 */
export const SIN_CADUCIDAD = '9999-12-31T00:00:00Z'
