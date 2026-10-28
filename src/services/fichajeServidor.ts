// src/services/fichajeServidor.ts
//
// L1a · PR 1 (27/10/2026). Fichar en el servidor.
//
// Hasta aquí el front insertaba la fila de clock_entries con la hora del móvil.
// Ahora la escribe fichar() en la base: la hora la pone el servidor (o, sin
// cobertura, la declara el móvil y queda apuntada como «declarada» junto a la
// hora en que llegó); el móvil solo ficha por la persona que ha entrado; la
// tablet, con el PIN comprobado en el servidor; y se guarda la distancia al
// local y si cae dentro del radio. Una marca puesta a mano es una corrección
// con motivo (add_manual_clock_entry), nunca una marca suelta.
//
// MIENTRAS LA BASE NO TENGA LA 1905 (staging desde una rama, o si el front
// llega antes que la tanda): fichar() no existe (PGRST202) y quien llama hace
// lo de antes, el INSERT directo, que en esa base sigue abierto.
//
// No importa supabaseSync (que importa este fichero): los errores salen como
// datos ({ message, hint, code }) y supabaseSync los convierte en su
// ClockWriteError, el que ya saben leer las tres pantallas que fichan.
import { supabase } from '../lib/supabase'
import type { ClockEntry } from '../types'

// fichar() y add_manual_clock_entry con el motivo aún no están en database.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nombre: string, args: Record<string, unknown>) => (supabase!.rpc as any)(nombre, args)

export interface ErrorDeFichaje { message: string; hint: string | null; code: string | null }

/** La función no existe todavía en esta base (PostgREST: PGRST202). */
export function esFuncionQueNoExiste(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? ''))
}

/**
 * El fallo es de la red, no de la base: sin cobertura, o la petición no llegó.
 * Un rechazo de la base (PIN mal, fuera de zona, ya fichado…) trae código y no
 * es esto: ese no se guarda para luego, se enseña.
 */
export function esFalloDeRed(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? ''
  const code = (e as { code?: string | null } | null)?.code ?? null
  return !code && /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_internet_disconnected|timeout/i.test(m)
}

// ── Lo que guardó el servidor, para enseñarlo ───────────────────────────────

/** Lo que devuelve fichar(): lo que de verdad quedó guardado. */
export interface FichajeGuardado {
  id: string
  type: ClockEntry['type']
  datetime: string
  realDatetime: string
  declarada: string | null
  llegada: string
  origen: 'movil' | 'tablet'
  distanciaM: number | null
  dentroDelRadio: boolean | null
  radioM: number
  local: string
  localConCoordenadas: boolean
  /** L1a PR 3: la precisión de la ubicación (m) y si era aproximada (más de 100 m). */
  precisionM: number | null
  ubicacionAproximada: boolean
}

const ultimos = new Map<string, FichajeGuardado>()

/** Lo último que guardó el servidor para esta persona (en esta pestaña). */
export function ultimoFichajeGuardado(employeeId: string): FichajeGuardado | null {
  return ultimos.get(employeeId) ?? null
}

function aGuardado(r: Record<string, unknown>): FichajeGuardado {
  return {
    id: String(r.id),
    type: r.type as ClockEntry['type'],
    datetime: String(r.datetime),
    realDatetime: String(r.real_datetime),
    declarada: (r.declarada as string | null) ?? null,
    llegada: String(r.llegada),
    origen: r.origen as 'movil' | 'tablet',
    distanciaM: r.distancia_m == null ? null : Number(r.distancia_m),
    dentroDelRadio: r.dentro_del_radio == null ? null : Boolean(r.dentro_del_radio),
    radioM: Number(r.radio_m ?? 200),
    local: String(r.local ?? ''),
    localConCoordenadas: Boolean(r.local_con_coordenadas),
    precisionM: r.precision_m == null ? null : Number(r.precision_m),
    ubicacionAproximada: Boolean(r.ubicacion_aproximada),
  }
}

// ── El PIN de la tablet ─────────────────────────────────────────────────────
// La tablet comprueba el PIN antes de enseñar «Fichar» (kiosko_comprobar_pin) y
// fichar() lo vuelve a comprobar al escribir. Se pasa aquí, justo antes de
// fichar, y se olvida al usarlo: no viaja dentro del fichaje ni se queda en el
// estado de la app.
const pinesDeKiosko = new Map<string, string>()

export function prepararPinDeKiosko(employeeId: string, pin: string): void {
  pinesDeKiosko.set(employeeId, pin)
}

function tomarPinDeKiosko(employeeId: string): string | null {
  const pin = pinesDeKiosko.get(employeeId) ?? null
  pinesDeKiosko.delete(employeeId)
  return pin
}

// ── Fichar ──────────────────────────────────────────────────────────────────

export type ResultadoDeFichar =
  | { tipo: 'guardado'; guardado: FichajeGuardado }
  | { tipo: 'sin-funcion' }
  | { tipo: 'rechazado'; error: ErrorDeFichaje }
  | { tipo: 'sin-red'; error: ErrorDeFichaje }

/**
 * Ficha en el servidor. `horaDeclarada`: la hora del móvil cuando se fichó sin
 * cobertura (se manda al volver la red).
 */
export async function ficharEnElServidor(
  employeeId: string, entry: ClockEntry, horaDeclarada?: string | null,
): Promise<ResultadoDeFichar> {
  const origen = entry.source === 'tablet' ? 'tablet' : 'movil'
  const pin = origen === 'tablet' ? tomarPinDeKiosko(employeeId) : null
  let r: { data: unknown; error: { message: string; hint?: string | null; code?: string | null } | null }
  const args: Record<string, unknown> = {
    p_employee_id: employeeId,
    p_type: entry.type,
    p_origen: origen,
    p_location_id: entry.locationIdAtClock ?? null,
    p_lat: entry.lat ?? null,
    p_lng: entry.lng ?? null,
    p_hora_efectiva: entry.datetime ?? null,
    p_hora_declarada: horaDeclarada ?? null,
    p_scheduled: entry.scheduled ?? null,
    p_rounding_applied: entry.roundingApplied ?? false,
    p_diff_minutes: entry.diffMinutes ?? null,
    p_address: entry.address ?? null,
    p_pin: pin,
  }
  try {
    // L1a PR 3: con la precisión de la ubicación, fichar_con_precision (la
    // 1934). Una base sin ella (PGRST202) ficha con fichar(), sin precisión.
    r = await rpc('fichar_con_precision', { ...args, p_precision_m: entry.precisionM ?? null })
    if (r.error && esFuncionQueNoExiste(r.error)) r = await rpc('fichar', args)
  } catch (e) {
    const err = { message: e instanceof Error ? e.message : String(e), hint: null, code: null }
    return esFalloDeRed(e) ? { tipo: 'sin-red', error: err } : { tipo: 'rechazado', error: err }
  }
  const { data, error } = r
  if (error) {
    if (esFuncionQueNoExiste(error)) return { tipo: 'sin-funcion' }
    const err = { message: error.message, hint: error.hint ?? null, code: error.code ?? null }
    return esFalloDeRed(error) ? { tipo: 'sin-red', error: err } : { tipo: 'rechazado', error: err }
  }
  const guardado = aGuardado((data ?? {}) as Record<string, unknown>)
  ultimos.set(employeeId, guardado)
  return { tipo: 'guardado', guardado }
}

/**
 * Una marca puesta a mano es una corrección con motivo: add_manual_clock_entry.
 * La pone el administrador, o el encargado a las personas de sus locales.
 */
export async function corregirConMotivo(employeeId: string, entry: ClockEntry): Promise<ErrorDeFichaje | null> {
  const motivo = (entry.motivo ?? '').trim()
  if (!motivo) return { message: 'MOTIVO_OBLIGATORIO', hint: 'Escribe por qué pones la marca a mano.', code: null }
  if (entry.type !== 'entrada' && entry.type !== 'salida') {
    return { message: 'TIPO_INVALIDO', hint: 'A mano solo se pone una entrada o una salida.', code: null }
  }
  const { error } = await rpc('add_manual_clock_entry', {
    p_employee_id: employeeId,
    p_type: entry.type,
    p_datetime: entry.datetime,
    p_reason: motivo,
    p_actor_label: entry.actorLabel ?? null,
    p_force: false,
  })
  if (!error) return null
  return { message: error.message, hint: error.hint ?? traducirMotivoManual(error.message), code: error.code ?? null }
}

function traducirMotivoManual(m: string): string | null {
  if (/^NO_AUTORIZADO/.test(m)) return 'Solo el administrador, o el encargado de su local, puede poner una marca a mano.'
  if (/^YA_ESTA_FICHADO/.test(m)) return 'Esa persona ya tiene una entrada sin cerrar a esa hora.'
  if (/^NO_ESTA_FICHADO/.test(m)) return 'No hay ninguna entrada abierta antes de esa hora: no se puede poner una salida.'
  if (/^MOTIVO_OBLIGATORIO/.test(m)) return 'Escribe por qué pones la marca a mano.'
  return null
}

// ── Sin cobertura: se guarda en el móvil y se manda al volver la red ────────

export interface FichajePendiente {
  clave: string
  employeeId: string
  entry: ClockEntry
  /** La hora del móvil al pulsar «Fichar». */
  horaDeclarada: string
  /** Si el servidor lo rechazó al mandarlo: el motivo, para enseñarlo. */
  rechazo?: string
}

const CLAVE = 'folvy-fichajes-pendientes'

function leer(): FichajePendiente[] {
  try {
    const t = localStorage.getItem(CLAVE)
    return t ? (JSON.parse(t) as FichajePendiente[]) : []
  } catch {
    return []
  }
}

function escribir(lista: FichajePendiente[]): boolean {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista))
    return true
  } catch {
    return false
  }
}

/** Guarda en el móvil un fichaje que no ha podido salir. false si el móvil no deja guardarlo. */
export function guardarFichajePendiente(employeeId: string, entry: ClockEntry, horaDeclarada: string): boolean {
  const lista = leer()
  lista.push({ clave: `${employeeId}-${horaDeclarada}`, employeeId, entry, horaDeclarada })
  return escribir(lista)
}

/** Los fichajes guardados en este móvil sin subir todavía (de esta persona, o de todas). */
export function fichajesPendientes(employeeId?: string): FichajePendiente[] {
  const l = leer()
  return employeeId ? l.filter(p => p.employeeId === employeeId) : l
}

/** Quita uno de la lista (el trabajador lo descarta tras un rechazo). */
export function descartarFichajePendiente(clave: string): void {
  escribir(leer().filter(p => p.clave !== clave))
}

let enviando = false

/**
 * Manda los fichajes pendientes, en orden. Se para en el primero que no sale
 * por la red (luego se reintenta); uno que el servidor rechaza se queda marcado
 * con el motivo, para que la persona lo vea y pida la corrección.
 * Devuelve cuántos han subido.
 */
export async function enviarFichajesPendientes(): Promise<{ subidos: number; quedan: number }> {
  if (enviando || !supabase) return { subidos: 0, quedan: leer().length }
  enviando = true
  let subidos = 0
  try {
    const lista = leer().sort((a, b) => a.horaDeclarada.localeCompare(b.horaDeclarada))
    for (const p of lista) {
      if (p.rechazo) continue
      const r = await ficharEnElServidor(p.employeeId, p.entry, p.horaDeclarada)
      if (r.tipo === 'sin-red') break
      if (r.tipo === 'guardado' || r.tipo === 'sin-funcion') {
        // Con la base de antes no se puede mandar la hora declarada: ese
        // fichaje lo tiene que poner el encargado (se queda como rechazo).
        if (r.tipo === 'sin-funcion') {
          marcarRechazo(p.clave, 'Este fichaje se hizo sin conexión y no se ha podido subir con su hora. Pide a tu encargado que lo ponga.')
          continue
        }
        descartarFichajePendiente(p.clave)
        subidos++
        continue
      }
      marcarRechazo(p.clave, r.error.hint || r.error.message)
    }
  } finally {
    enviando = false
  }
  return { subidos, quedan: leer().length }
}

function marcarRechazo(clave: string, motivo: string): void {
  escribir(leer().map(p => (p.clave === clave ? { ...p, rechazo: motivo } : p)))
}
