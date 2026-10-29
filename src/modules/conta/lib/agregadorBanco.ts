// src/modules/conta/lib/agregadorBanco.ts
//
// B01c (29/10): open-banking.io (abajo), lo que conecta de verdad las cuentas
// de BBVA de Foodint, con el mismo contrato; y la línea que enseña Bancos en
// cada cuenta conectada (lineaConexion).
//
// B01 · tarea 6 (respuesta 4, punto 4.3): el agregador, preparado para Enable
// Banking (cobra por cuenta conectada; Julio pide presupuesto) y probado con un
// proveedor SIMULADO. Nada de esto se enseña en pantalla hasta que exista el
// contrato: aquí solo está lo que el motor necesita para que enchufarlo no
// toque nada más.
//
//   · `proveedorEnableBanking(transporte)`: la interfaz ProveedorAgregador
//     (fuentesBanco.ts) sobre la API de cuentas de Enable Banking. El
//     transporte —la llamada firmada con la clave de la aplicación— se inyecta:
//     aquí no hay claves, ni URL secretas, ni llamadas de verdad.
//   · `movimientoDeEnableBanking`: su transacción, en nuestro modelo. Los
//     nombres de campo (entry_reference, transaction_amount,
//     credit_debit_indicator «CRDT»/«DBIT», booking_date, value_date,
//     remittance_information, creditor/debtor) son los de su esquema
//     publicado; si al firmar el contrato cambia algo, cambia SOLO esta función.
//   · `proveedorSimulado(datos)`: lo mismo, en memoria, para las pruebas.
//   · El consentimiento (PSD2: el permiso para leer la cuenta) dura 180 días:
//     `caducaElConsentimiento` y `avisoConsentimiento` (7 días antes, con cómo
//     renovarlo con un clic).
//
// El mismo movimiento por el agregador y por Norma 43 se reconoce por la
// HUELLA SUAVE (día, importe y orden en el día: extractoBanco.ts), porque las
// dos fuentes no traen las mismas referencias. La base lo aplica al importar
// (bank_importar, 0110): entre fuentes distintas, la suave basta.

import type { CuentaAgregador, MovimientoAgregador, PaginaAgregador, ProveedorAgregador } from '@/modules/conta/lib/fuentesBanco'
import {
  proveedorOpenBankingIo as nucleoOpenBankingIo, type ClienteOpenBankingIo, type ConexionDelProveedor,
} from '../../../../supabase/functions/_shared/bancoAgregador.ts'

// ── Enable Banking ──────────────────────────────────────────────────────────

/** Una transacción tal como la devuelve Enable Banking (los campos que usamos). */
export interface TransaccionEnableBanking {
  entry_reference?: string | null
  transaction_id?: string | null
  transaction_amount: { amount: string; currency: string }
  credit_debit_indicator: 'CRDT' | 'DBIT'
  booking_date?: string | null
  value_date?: string | null
  transaction_date?: string | null
  remittance_information?: string[] | null
  creditor?: { name?: string | null } | null
  debtor?: { name?: string | null } | null
  status?: string | null
}
export interface CuentaEnableBanking { uid: string; account_id?: { iban?: string | null } | null; currency?: string | null; name?: string | null }

/** La llamada a la API, firmada fuera de aquí (en el servidor, con la clave de la aplicación). */
export interface TransporteEnableBanking {
  get<T>(ruta: string, consulta?: Record<string, string>): Promise<T>
}

const ceros = (s: string) => s.replace(/^-/, '')

/** Su transacción, en nuestro modelo: céntimos con signo, la fecha contable, el concepto y la contraparte. */
export function movimientoDeEnableBanking(t: TransaccionEnableBanking): MovimientoAgregador {
  const fecha = t.booking_date ?? t.transaction_date ?? t.value_date
  if (!fecha) throw new Error('Una transacción del agregador sin fecha no se puede importar.')
  const [entero, dec = ''] = ceros(t.transaction_amount.amount.trim()).split('.')
  const cent = Number(entero) * 100 + Number((dec + '00').slice(0, 2))
  if (!Number.isFinite(cent)) throw new Error(`Importe del agregador que no se entiende: «${t.transaction_amount.amount}».`)
  const signo = t.credit_debit_indicator === 'DBIT' ? -1 : 1
  const contraparte = (signo < 0 ? t.creditor?.name : t.debtor?.name) ?? null
  return {
    id: t.entry_reference ?? t.transaction_id ?? `${fecha}:${t.transaction_amount.amount}`,
    fecha: fecha.slice(0, 10), fechaValor: t.value_date?.slice(0, 10) ?? null, importeCent: signo * cent,
    concepto: (t.remittance_information ?? []).map((x) => x.trim()).filter(Boolean).join(' ') || (contraparte ?? 'Movimiento'),
    contraparte: contraparte?.trim() || null,
  }
}

/** Enable Banking como ProveedorAgregador. `conexion` es el id de su sesión (el consentimiento firmado). */
export function proveedorEnableBanking(transporte: TransporteEnableBanking): ProveedorAgregador {
  return {
    id: 'enable-banking',
    nombre: 'Enable Banking',
    async cuentas(conexion: string): Promise<CuentaAgregador[]> {
      const s = await transporte.get<{ accounts: CuentaEnableBanking[] }>(`/sessions/${encodeURIComponent(conexion)}`)
      return (s.accounts ?? []).map((c) => ({ id: c.uid, iban: (c.account_id?.iban ?? '').replace(/\s+/g, '').toUpperCase(), titular: c.name ?? null, divisa: c.currency ?? 'EUR' }))
    },
    async movimientos(_conexion: string, cuenta: string, desde: string, hasta: string): Promise<PaginaAgregador> {
      // Las transacciones vienen por páginas (continuation_key); solo las contabilizadas («BOOK»).
      const movimientos: MovimientoAgregador[] = []
      let clave: string | undefined
      do {
        const pag = await transporte.get<{ transactions: TransaccionEnableBanking[]; continuation_key?: string | null }>(
          `/accounts/${encodeURIComponent(cuenta)}/transactions`, { date_from: desde, date_to: hasta, ...(clave ? { continuation_key: clave } : {}) })
        for (const t of pag.transactions ?? []) if (!t.status || t.status === 'BOOK') movimientos.push(movimientoDeEnableBanking(t))
        clave = pag.continuation_key ?? undefined
      } while (clave)
      // El saldo de cierre no viene con las transacciones: sin él, el extracto entra «sin comprobar», y lo dice.
      return { saldoInicialCent: null, saldoFinalCent: null, movimientos }
    },
  }
}

// ── open-banking.io (B01c) ──────────────────────────────────────────────────
// Lo que conecta de verdad desde el B01c: open-banking.io, que va sobre Enable
// Banking y entrega los datos cifrados (se descifran en el servidor, con la
// clave privada del credentials.json). El núcleo vive en
// supabase/functions/_shared/bancoAgregador.ts porque lo usa la función de cada
// noche (conta-banco-agregador); aquí se publica con el contrato de siempre, y
// tsc comprueba que lo cumple.

export type { ClienteOpenBankingIo } from '../../../../supabase/functions/_shared/bancoAgregador.ts'
export { movimientoDeOpenBankingIo, saldoDelBanco, saldoAlCerrar, desdeCuando, paraImportar, sincronizarEmpresa, FUENTE_OBI } from '../../../../supabase/functions/_shared/bancoAgregador.ts'

/** open-banking.io como ProveedorAgregador (y lo que sabe de la conexión: refrescar, permisos y saldos). `hoy`: el día de Madrid. */
export function proveedorOpenBankingIo(cliente: ClienteOpenBankingIo, hoy: string): ProveedorAgregador & ConexionDelProveedor {
  return nucleoOpenBankingIo(cliente, hoy)
}

// ── Lo que dice Bancos de una cuenta conectada (B01c) ──────────────────────

export interface ConexionCuenta {
  banco: string
  estado: 'al_dia' | 'sin_movimientos' | 'permiso_caducado' | 'fallo' | null
  mensaje: string | null
  /** Cuándo se leyó bien por última vez (ISO con hora). */
  leida: string | null
  /** Cuándo se intentó por última vez (ISO con hora). */
  intentada: string | null
  caduca: string | null
  renovar: string | null
}

export interface LineaConexion {
  nivel: 'ok' | 'aviso' | 'error'
  texto: string
  /** El botón «Renovar»: lleva a donde se renueva el permiso. */
  renovar: string | null
}

const horaMadrid = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const diaMadrid = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

/** «hoy a las 03:00», «ayer a las 03:00» o «el 27/10 a las 03:00», en la hora de Madrid. */
export function cuandoFue(iso: string, ahora: Date): string {
  const d = diaMadrid(iso), hoy = diaMadrid(ahora.toISOString())
  const ayer = diaMadrid(new Date(ahora.getTime() - 86_400_000).toISOString())
  const dia = d === hoy ? 'hoy' : d === ayer ? 'ayer' : `el ${d.slice(8, 10)}/${d.slice(5, 7)}`
  return `${dia} a las ${horaMadrid(iso)}`
}

/**
 * La línea de una cuenta conectada, en palabras: «Conectada con BBVA ·
 * actualizada hoy a las 03:00»; a 7 días de caducar, «Caduca el permiso en 7
 * días · Renovar»; caducado o fallado, qué pasa y desde cuándo. Null si la
 * cuenta no está conectada.
 */
export function lineaConexion(c: ConexionCuenta | null, ahora: Date): LineaConexion | null {
  if (!c) return null
  const hoy = diaMadrid(ahora.toISOString())
  const aviso = c.caduca ? avisoConsentimiento({ conexionId: '', banco: c.banco, caduca: diaMadrid(c.caduca) }, hoy) : null
  const leida = c.leida ? `actualizada ${cuandoFue(c.leida, ahora)}` : 'aún no se ha leído'
  if (c.estado === 'permiso_caducado' || aviso?.nivel === 'caducado') {
    return { nivel: 'error', renovar: c.renovar, texto: `El permiso para leer ${c.banco} ha caducado: no llegan sus movimientos (${leida}). Renuévalo y confirma en tu banco.` }
  }
  if (c.estado === 'fallo') {
    return { nivel: 'error', renovar: null, texto: `Conectada con ${c.banco} · la última vez (${cuandoFue(c.intentada ?? c.leida ?? ahora.toISOString(), ahora)}) no se pudo leer: ${c.mensaje ?? 'sin motivo'}. Sigue ${leida}.` }
  }
  if (aviso && aviso.nivel === 'aviso') {
    const dias = aviso.dias === 0 ? 'hoy' : aviso.dias === 1 ? 'mañana' : `en ${aviso.dias} días`
    return { nivel: 'aviso', renovar: c.renovar, texto: `Caduca el permiso ${dias} · ${leida}` }
  }
  return { nivel: 'ok', renovar: null, texto: `Conectada con ${c.banco} · ${leida}` }
}

// ── Simulado ────────────────────────────────────────────────────────────────

export interface DatosSimulados { cuentas: CuentaAgregador[]; movimientos: Record<string, MovimientoAgregador[]>; saldos?: Record<string, { inicialCent: number; finalCent: number }> }

/** El proveedor simulado: lo mismo que Enable Banking, en memoria. */
export function proveedorSimulado(d: DatosSimulados): ProveedorAgregador {
  return {
    id: 'simulado',
    nombre: 'Simulado',
    cuentas: async () => d.cuentas,
    movimientos: async (_c, cuenta, desde, hasta) => ({
      saldoInicialCent: d.saldos?.[cuenta]?.inicialCent ?? null, saldoFinalCent: d.saldos?.[cuenta]?.finalCent ?? null,
      movimientos: (d.movimientos[cuenta] ?? []).filter((m) => m.fecha >= desde && m.fecha <= hasta),
    }),
  }
}

// ── El consentimiento: 180 días ─────────────────────────────────────────────

/** Días que dura el permiso para leer la cuenta (PSD2, autenticación reforzada cada 180 días). */
export const DIAS_CONSENTIMIENTO = 180
/** Cuántos días antes se avisa. */
export const DIAS_AVISO = 7

const dia = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** El día en que caduca un permiso firmado el `firmado` ('YYYY-MM-DD'). */
export function caducaElConsentimiento(firmado: string): string {
  return new Date(dia(firmado) + DIAS_CONSENTIMIENTO * 86_400_000).toISOString().slice(0, 10)
}

export interface AvisoConsentimiento {
  nivel: 'nada' | 'aviso' | 'caducado'
  dias: number
  texto: string
  /** El clic que lo renueva: vuelve a pedir el permiso al banco para esa misma cuenta. */
  accion: { etiqueta: string; conexionId: string } | null
}

/** Qué decir del permiso de una cuenta conectada: nada hasta 7 días antes; luego, cuándo caduca y cómo renovarlo. */
export function avisoConsentimiento(c: { conexionId: string; banco: string; caduca: string }, hoy: string): AvisoConsentimiento {
  const dias = Math.round((dia(c.caduca) - dia(hoy)) / 86_400_000)
  if (dias > DIAS_AVISO) return { nivel: 'nada', dias, texto: '', accion: null }
  if (dias < 0) {
    return { nivel: 'caducado', dias, accion: { etiqueta: 'Renovar el permiso', conexionId: c.conexionId },
      texto: `El permiso para leer ${c.banco} caducó el ${fechaCorta(c.caduca)}: desde entonces no llegan sus movimientos. Renuévalo con un clic: «Renovar el permiso» y confirmas en tu banco.` }
  }
  return { nivel: 'aviso', dias, accion: { etiqueta: 'Renovar el permiso', conexionId: c.conexionId },
    texto: `El permiso para leer ${c.banco} caduca el ${fechaCorta(c.caduca)} (${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`}). Renuévalo con un clic: «Renovar el permiso» y confirmas en tu banco.` }
}
