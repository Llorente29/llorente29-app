// src/modules/conta/bancos/revolut/revolut.ts
//
// B01 Revolut · PR 1 · LO QUE NO ES PANTALLA DEL ASISTENTE «CONECTAR REVOLUT».
// Sin React: las llamadas a conta-revolut-conectar, leer la conexión de la
// empresa, la vuelta de Revolut y los textos de cada estado (regla 8: cada
// botón dice lo que ha pasado). Pruebas: tests/unit/modules/conta/revolut/
// pantalla.test.ts.
//
// La vuelta: Revolut exige una dirección fija (la de la marca), pero las de
// Sumied llevan delante la cuenta. Por eso la dirección de vuelta es una página
// pequeña aparte (public/revolut-vuelta.html, en /bancos/revolut/vuelta) que
// solo devuelve a la persona a la página de Bancos desde la que salió (la
// guarda `recordarVuelta` antes de ir a Revolut), con el código y el «state».

import { supabase } from '@/lib/supabase'
import { tabla } from '@/modules/conta/services/bd'

export type EstadoRevolut = 'certificado' | 'autorizar' | 'conectada' | 'desconectada' | 'retirada'

export interface ConexionRevolut {
  estado: EstadoRevolut
  entorno: 'sandbox' | 'produccion'
  certificado: string
  vuelta: string
  desdeHistorico: string | null
  conectadaAt: string | null
  conectadaPor: string | null
  lastOkAt: string | null
  lastError: string | null
}

export interface CuentaDeRevolut { id: string; nombre: string; divisa: string; saldo: number; iban: string | null; iban4: string }

export type Salida<T = Record<string, unknown>> = ({ ok: true; texto?: string } & T) | { ok: false; texto: string; demo?: boolean }

/** Llama a conta-revolut-conectar. Nunca lanza: si falla, su `texto` dice por qué y qué hacer. */
export async function revolut<T = Record<string, unknown>>(accion: string, cuerpo: Record<string, unknown>): Promise<Salida<T>> {
  if (!supabase) return { ok: false, texto: 'Sin conexión con la base.' }
  const { data, error } = await supabase.functions.invoke('conta-revolut-conectar', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as Salida<T>
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { texto?: string } | null
    if (c && typeof c.texto === 'string') return { ok: false, texto: c.texto }
    if (ctx.status === 404) return { ok: false, texto: 'La conexión con Revolut aún no está publicada en este entorno.' }
    return { ok: false, texto: `La conexión con Revolut ha contestado ${ctx.status}. Inténtalo otra vez en un momento.` }
  }
  return { ok: false, texto: `No se ha podido hablar con la conexión con Revolut${error ? ` (${error.message})` : ''}.` }
}

/** La conexión con Revolut de una empresa (o null si nunca se empezó). Lo público: lo secreto vive en el Vault. */
export async function leerConexion(companyId: string): Promise<ConexionRevolut | null> {
  // La tabla es nueva (2210): aún no está en src/types/database.ts, como las del C00 (services/bd.ts).
  const { data: fila, error } = await tabla('revolut_conexion')
    .select('estado, entorno, certificado, vuelta, desde_historico, conectada_at, conectada_por_nombre, last_ok_at, last_error')
    .eq('company_id', companyId).maybeSingle()
  if (error) throw new Error(`No se ha podido leer la conexión con Revolut: ${error.message}`)
  if (!fila) return null
  const data = fila as unknown as Record<string, string | null>
  return {
    estado: data.estado as EstadoRevolut, entorno: data.entorno as 'sandbox' | 'produccion', certificado: String(data.certificado), vuelta: String(data.vuelta),
    desdeHistorico: data.desde_historico ?? null, conectadaAt: data.conectada_at ?? null, conectadaPor: data.conectada_por_nombre ?? null,
    lastOkAt: data.last_ok_at ?? null, lastError: data.last_error ?? null,
  }
}

// ── La vuelta de Revolut ────────────────────────────────────────────────────

/** Dónde guarda la página de vuelta a qué página volver (solo en este navegador, y solo el camino). */
export const CLAVE_VUELTA = 'sumied.revolut.vuelta'
/** Los parámetros con que la página de vuelta devuelve a Bancos. */
export const PARAM_CODIGO = 'revolut_code'
export const PARAM_ESTADO = 'revolut_state'
export const PARAM_ERROR = 'revolut_error'

/** Antes de ir a Revolut: a qué página de Sumied volver (el camino, sin la dirección ni los parámetros). */
export function recordarVuelta(camino: string, almacen: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { almacen?.setItem(CLAVE_VUELTA, camino.split('?')[0]) } catch { /* sin almacén: la vuelta irá al inicio y lo dirá */ }
}

/** Lo que trae la dirección al volver de Revolut, si es una vuelta. */
export function vueltaDeLaDireccion(buscar: string): { code: string; state: string } | { error: string } | null {
  const q = new URLSearchParams(buscar)
  const error = q.get(PARAM_ERROR)
  if (error) return { error }
  const code = q.get(PARAM_CODIGO), state = q.get(PARAM_ESTADO)
  if (!code || !state) return null
  return { code, state }
}

// ── Lo que se comprueba antes de llamar ─────────────────────────────────────

/** El Client ID, como lo comprueba la función: así el error sale antes, y con las mismas palabras. */
export function comprobarClientId(s: string): string | null {
  const t = s.trim()
  if (!t) return 'Pega el Client ID que te enseña Revolut.'
  if (/BEGIN|CERTIFICATE|-----/.test(t)) return 'Eso es el certificado, no el Client ID. El Client ID lo enseña Revolut después de guardar el certificado: es una línea corta de letras y números, debajo de «Client ID».'
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(t)) return 'Ese Client ID no tiene la forma de los de Revolut: tiene que ser una sola línea de letras y números, sin espacios. Cópialo otra vez de Revolut › Ajustes › API.'
  return null
}

// ── Lo que dice la tarjeta de Revolut en Cuentas y extractos ────────────────

const hace = (iso: string, ahora: Date) => {
  const min = Math.max(0, Math.round((ahora.getTime() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

export interface LineaRevolut { nivel: 'ok' | 'aviso' | 'error' | 'nada'; texto: string; boton: 'conectar' | 'seguir' | 'desconectar' | 'reconectar' }

/** La línea de la tarjeta, según el estado de la conexión. */
export function lineaRevolut(c: ConexionRevolut | null, ahora: Date): LineaRevolut {
  if (!c || c.estado === 'desconectada') return { nivel: 'nada', texto: 'Conecta tu cuenta de Revolut Business y sus movimientos entrarán solos, como los de cualquier banco.', boton: 'conectar' }
  if (c.estado === 'retirada') return { nivel: 'error', texto: `Desconectada desde Revolut: ya no acepta el permiso de Sumied. Los movimientos dejan de entrar. Vuelve a conectar.`, boton: 'reconectar' }
  if (c.estado === 'certificado' || c.estado === 'autorizar') return { nivel: 'aviso', texto: c.estado === 'certificado' ? 'A medias: falta pegar el certificado en Revolut y traer el Client ID.' : 'A medias: falta autorizar en Revolut.', boton: 'seguir' }
  if (c.lastError) return { nivel: 'error', texto: `Conectada · la última lectura no ha ido bien: ${c.lastError}${c.lastOkAt ? ` Al día ${hace(c.lastOkAt, ahora)}.` : ''}`, boton: 'desconectar' }
  return { nivel: 'ok', texto: c.lastOkAt ? `Al día · ${hace(c.lastOkAt, ahora)}` : 'Conectada · aún no se ha leído', boton: 'desconectar' }
}

/** Para una cuenta de Revolut: si ya está ligada a un banco de la empresa (por IBAN), cuál. */
export function bancoLigado(cuenta: CuentaDeRevolut, bancos: readonly { id: string; nombre: string; iban: string | null }[]): { id: string; nombre: string } | null {
  if (!cuenta.iban) return null
  const limpio = (s: string) => s.replace(/\s+/g, '').toUpperCase()
  const b = bancos.find((x) => x.iban && limpio(x.iban) === limpio(cuenta.iban!))
  return b ? { id: b.id, nombre: b.nombre } : null
}

/** El nombre del banco nuevo para una cuenta de Revolut: «Revolut · Principal». */
export const nombreDeBanco = (cuenta: Pick<CuentaDeRevolut, 'nombre'>) => `Revolut · ${cuenta.nombre.trim() || 'Cuenta'}`.slice(0, 80)

/** El día de hoy menos `meses`, AAAA-MM-DD: la propuesta de desde cuándo traer el histórico. */
export function desdePropuesto(hoy: Date, meses = 3): string {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - meses, 1))
  return d.toISOString().slice(0, 10)
}
