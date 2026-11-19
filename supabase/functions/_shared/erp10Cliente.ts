// supabase/functions/_shared/erp10Cliente.ts
//
// X10 (19/11) · ERP10 POR LA API, FASE 1: SOLO LEER. El ERP10 de un despacho
// (Cegid, apiCON: la misma API que Diez) visto desde Sumied, para comprobar que
// lo que ha salido queda igual sin subir un Excel.
//
// No es el cliente de Diez (_shared/diezCliente.ts) ni lo toca: Diez abre una
// base por empresa y su freno es el DataBaseName del token; ERP10 abre la base
// del DESPACHO, con empresas de otros clientes dentro, y su respuesta al token
// no trae DataBaseName. Aquí los frenos son otros:
//
//   1. La lista cerrada. Solo se entra con un código de empresa que esté en la
//      lista de la cuenta (las sociedades conectadas, cada una con el código que
//      teclea Julio). Uno que no esté, para ANTES de pedir el token. Sumied no
//      pide a Cegid la lista de empresas.
//   2. El NIF. Nada más entrar, GET /api/parametros (modelo Empresa, campo CIF:
//      Swagger del 19/11). Si no es el de la sociedad de Sumied, para y no lee
//      nada más; el token no se guarda. Se mira una vez por cliente, también con
//      un token guardado.
//   3. Solo GET (y POST /token). Esta fase no escribe nada en ERP10.
//
// Cómo se entra (medido por Julio el 19/11, no se vuelve a descubrir): POST
// /token en formulario (en JSON contesta invalid_clientId), con grant_type
// password, client_id y client_secret del correo de Cegid, el usuario del
// despacho, el código que da el panel de QBO como password, nombre_bd (la base
// del despacho) y cod_empresa, OBLIGATORIO: sin él el token sale y cada lectura
// da 500 («Error al comprobar … si la empresa tiene Contabilidad…»). El token
// va por empresa.
//
// Lo prueba tests/conta/erp10/cliente.test.ts, contra un ERP10 simulado.

import { limitesMes } from './diezCliente.ts'

export const TAM_PAGINA = 200
export const MARGEN_RENOVAR_MS = 2 * 24 * 3600 * 1000
const MAX_INTENTOS = 3

/** Las frases de la pantalla (regla 8: el fallo, en palabras). */
export const FRASES = {
  claves: 'ERP10 no reconoce las claves',
  sinCodigo: 'Falta el código de empresa',
  nif: 'El NIF de la empresa de ERP10 no es el de esta sociedad',
  fueraDeLaLista: 'Ese código de empresa no es de ninguna sociedad de esta cuenta: Sumied solo entra en las sociedades que tienes conectadas',
  sinNif: 'ERP10 no dice el NIF de la empresa abierta: Sumied no lee nada sin comprobarlo',
  sinNifSociedad: 'Esta sociedad no tiene NIF en Sumied: ponlo en su ficha antes de entrar en ERP10',
} as const

export type ClavesErp10 = { client_id: string; client_secret: string; username: string; password: string; grant_type?: string }
export type TokenGuardado = { token: string; expiresAt: string }
export interface AlmacenToken {
  leer(): Promise<TokenGuardado | null>
  guardar(token: string, expiresAt: string): Promise<void>
  caida(error: string): Promise<void>
}
/** Una sociedad de la lista cerrada: su código en ERP10 y su NIF en Sumied. */
export type EmpresaDeLaLista = { companyId: string; codEmpresa: string; nif: string | null }

export type ConfigErp10 = {
  base: string
  /** La base del despacho (nombre_bd). */
  nombreBd: string
  claves: ClavesErp10
  /** La lista cerrada: las sociedades de la cuenta conectadas a ERP10, con su código. */
  lista: readonly EmpresaDeLaLista[]
  /** El código de la empresa en la que se entra. */
  codEmpresa: string
  almacen: AlmacenToken
  fetch?: typeof fetch
  ahora?: () => number
  pausaMs?: number
}

export class FrenoErp10 extends Error {
  constructor(m: string) { super(m); this.name = 'FrenoErp10' }
}
export class ErrorErp10 extends Error {
  readonly status: number
  constructor(m: string, status: number) { super(m); this.name = 'ErrorErp10'; this.status = status }
}

export type DetalleApunte = { Cuenta?: string; Debe?: number; Haber?: number; Fecha?: number }
export type Apunte = { Ejercicio?: string; Serie?: string; Documento?: number; TipoAsiento?: number; Fecha?: number; Detalles?: DetalleApunte[] }
type Paginada<T> = { Datos: T[]; ResultadosTotales?: number }

/** El código de empresa, como número entero sin ceros delante (cod_empresa es int32). */
export function codigoLimpio(x: unknown): string {
  const t = String(x ?? '').trim()
  if (!/^\d{1,9}$/.test(t)) return ''
  return String(Number(t))
}
/** Un NIF comparable: sin espacios, guiones ni puntos, sin «ES» delante, en mayúsculas. */
export function nifLimpio(x: unknown): string {
  const t = String(x ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  return t.startsWith('ES') && t.length > 9 ? t.slice(2) : t
}
/** «…terminado en 678»: lo que se enseña del NIF (nunca entero en un registro). */
export const finalDelNif = (nif: string) => nifLimpio(nif).slice(-3)

/** El token se guarda con la empresa que abrió: uno de otra empresa no se usa. */
const PREFIJO = 'erp10-emp:'
export const tokenConLaEmpresa = (cod: string, token: string) => `${PREFIJO}${codigoLimpio(cod)}|${token}`
export function tokenDeLaEmpresa(guardado: string): { cod: string; token: string } | null {
  if (!guardado.startsWith(PREFIJO)) return null
  const i = guardado.indexOf('|')
  if (i < 0) return null
  const cod = guardado.slice(PREFIJO.length, i)
  const token = guardado.slice(i + 1)
  return cod && token ? { cod, token } : null
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esLocal = (b: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

/** AAAAMMDD de un día ISO (AAAA-MM-DD). */
export const aaaammdd = (iso: string) => Number(iso.slice(0, 10).replace(/-/g, ''))

/** El CIF de lo que devuelve /api/parametros (un objeto Empresa, una lista o algo envuelto). */
export function cifDeParametros(j: unknown): string | null {
  const mira = (o: unknown, prof = 0): string | null => {
    if (!o || typeof o !== 'object' || prof > 3) return null
    if (Array.isArray(o)) { for (const x of o) { const r = mira(x, prof + 1); if (r) return r } return null }
    const r = o as Record<string, unknown>
    for (const k of Object.keys(r)) if (/^(cif|nif)$/i.test(k) && typeof r[k] === 'string' && String(r[k]).trim()) return String(r[k])
    for (const k of Object.keys(r)) { const x = mira(r[k], prof + 1); if (x) return x }
    return null
  }
  return mira(j)
}

/** ¿Es el 500 de «sin cod_empresa» (medido el 19/11)? */
const esSinEmpresa = (txt: string) => /error al comprobar/i.test(txt) && /empresa/i.test(txt)

export class ClienteErp10 {
  private readonly base: string
  private readonly f: typeof fetch
  private readonly ahora: () => number
  private readonly cfg: ConfigErp10
  private readonly empresa: EmpresaDeLaLista
  private token: string | null = null
  private nifVisto: string | null = null
  readonly metrica = { peticiones: 0 }

  constructor(cfg: ConfigErp10) {
    this.cfg = cfg
    const cod = codigoLimpio(cfg.codEmpresa)
    if (!String(cfg.codEmpresa ?? '').trim()) throw new FrenoErp10(FRASES.sinCodigo)
    // 1. La lista cerrada, antes de nada (antes de pedir el token).
    const e = cod ? cfg.lista.find((x) => codigoLimpio(x.codEmpresa) === cod) : undefined
    if (!e) throw new FrenoErp10(FRASES.fueraDeLaLista)
    if (!nifLimpio(e.nif)) throw new FrenoErp10(FRASES.sinNifSociedad)
    this.empresa = { ...e, codEmpresa: cod }
    if (!String(cfg.nombreBd ?? '').trim()) throw new FrenoErp10('Falta la base del despacho en las claves de ERP10')
    const b = String(cfg.base ?? '').replace(/\/$/, '')
    if (!b.startsWith('https://') && !esLocal(b)) throw new FrenoErp10('sin https no sale nada')
    this.base = b
    this.f = cfg.fetch ?? fetch
    this.ahora = cfg.ahora ?? Date.now
  }

  get codEmpresa() { return this.empresa.codEmpresa }
  get companyId() { return this.empresa.companyId }

  private async llamar(metodo: 'GET' | 'POST', ruta: string, form?: Record<string, string>): Promise<{ status: number; json: unknown; txt: string }> {
    const camino = ruta.split('?')[0]
    const esEntrar = metodo === 'POST' && camino === '/token'
    // 3. Fase 1: solo leer.
    if (metodo !== 'GET' && !esEntrar) throw new FrenoErp10(`${metodo} ${camino}: en esta fase Sumied no escribe nada en ERP10`)
    if (!camino.startsWith('/api/') && !esEntrar) throw new FrenoErp10(`ruta ${camino} fuera de /api`)
    const cab: Record<string, string> = { accept: 'application/json' }
    let body: string | undefined
    if (form) { cab['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString() }
    if (!esEntrar) cab.authorization = `Bearer ${await this.asegurarToken()}`
    const inicio = this.ahora()
    for (let intento = 1; ; intento++) {
      if (this.cfg.pausaMs) await espera(this.cfg.pausaMs)
      this.metrica.peticiones++
      const r = await this.f(this.base + ruta, { method: metodo, headers: cab, body, redirect: 'manual', signal: AbortSignal.timeout(90_000) })
      if (r.status >= 300 && r.status < 400) throw new FrenoErp10(`${metodo} ${camino} redirige (${r.status}); no se sigue`)
      if (r.status === 429 && metodo === 'GET' && intento < MAX_INTENTOS) {
        await r.arrayBuffer().catch(() => null)
        await espera(5000 * intento)
        continue
      }
      const txt = await r.text()
      // Un 500 pasajero de una lectura se repite; el de «sin empresa» y el de «no existe el contenedor», no.
      if (r.status >= 500 && metodo === 'GET' && intento < MAX_INTENTOS && this.ahora() - inicio < 60_000 && !esSinEmpresa(txt) && !/container does not exist/i.test(txt)) {
        await espera(2000 * intento)
        continue
      }
      let json: unknown
      try { json = txt ? JSON.parse(txt) : null } catch { json = txt }
      return { status: r.status, json, txt }
    }
  }

  /** Entra en la empresa de la lista (un intento). Las claves nunca salen en un mensaje. */
  async entrar(): Promise<TokenGuardado> {
    const c = this.cfg.claves
    const form = {
      grant_type: c.grant_type ?? 'password', client_id: c.client_id, client_secret: c.client_secret,
      username: c.username, password: c.password, nombre_bd: this.cfg.nombreBd.trim(), cod_empresa: this.empresa.codEmpresa,
    }
    const r = await this.llamar('POST', '/token', form)
    const j = (r.json ?? {}) as Record<string, unknown>
    if (r.status !== 200 || typeof j.access_token !== 'string') {
      const motivo = String(j.error_description ?? j.error ?? '').slice(0, 120)
      if (r.status === 400 || r.status === 401 || /invalid_(grant|client|clientid)/i.test(motivo)) throw new FrenoErp10(FRASES.claves)
      throw new ErrorErp10(`ERP10 no deja entrar (${r.status})${motivo ? `: ${motivo}` : ''}`, r.status)
    }
    const segundos = Number(j.expires_in) || 0
    return { token: j.access_token, expiresAt: new Date(this.ahora() + segundos * 1000).toISOString() }
  }

  /** 2. El NIF de la empresa abierta contra el de la sociedad. Si no coincide, para. */
  private async comprobarNif(token: string): Promise<void> {
    if (this.nifVisto) return
    this.token = token
    const r = await this.llamar('GET', '/api/parametros')
    if (r.status >= 500 && esSinEmpresa(r.txt)) throw new FrenoErp10(FRASES.sinCodigo)
    if (r.status === 401) throw new FrenoErp10(FRASES.claves)
    if (r.status !== 200) throw new ErrorErp10(`ERP10 no contesta a qué empresa ha abierto (${r.status})`, r.status)
    const cif = cifDeParametros(r.json)
    if (!cif || !nifLimpio(cif)) throw new FrenoErp10(FRASES.sinNif)
    if (nifLimpio(cif) !== nifLimpio(this.empresa.nif)) throw new FrenoErp10(FRASES.nif)
    this.nifVisto = nifLimpio(cif)
  }

  /**
   * El token vigente de ESTA empresa, con el NIF comprobado. Uno guardado de otra
   * empresa, o que caduca en menos de 2 días, no vale: se entra de nuevo. Si el NIF
   * no coincide, el token nuevo no se guarda.
   */
  async asegurarToken(): Promise<string> {
    if (this.token && this.nifVisto) return this.token
    if (this.token) return this.token // dentro de comprobarNif
    const g = await this.cfg.almacen.leer()
    const deLaEmpresa = g ? tokenDeLaEmpresa(g.token) : null
    if (g && deLaEmpresa && deLaEmpresa.cod === this.empresa.codEmpresa && Date.parse(g.expiresAt) - this.ahora() > MARGEN_RENOVAR_MS) {
      try { await this.comprobarNif(deLaEmpresa.token) } catch (e) { this.token = null; throw e }
      return deLaEmpresa.token
    }
    let n: TokenGuardado
    try { n = await this.entrar() } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.cfg.almacen.caida(msg)
      throw e
    }
    try { await this.comprobarNif(n.token) } catch (e) {
      this.token = null
      await this.cfg.almacen.caida(e instanceof Error ? e.message : String(e))
      throw e
    }
    await this.cfg.almacen.guardar(tokenConLaEmpresa(this.empresa.codEmpresa, n.token), n.expiresAt)
    return n.token
  }

  /** Entra y comprueba el NIF; devuelve el NIF visto (para decir «terminado en …»). */
  async probar(): Promise<string> {
    await this.asegurarToken()
    return this.nifVisto ?? ''
  }

  async get<T>(ruta: string): Promise<{ status: number; json: T; txt: string }> {
    await this.asegurarToken()
    const r = await this.llamar('GET', ruta)
    if (r.status >= 500 && esSinEmpresa(r.txt)) throw new FrenoErp10(FRASES.sinCodigo)
    return r as { status: number; json: T; txt: string }
  }
  private async leer<T>(ruta: string): Promise<T> {
    const r = await this.get<T>(ruta)
    if (r.status !== 200) throw new ErrorErp10(`ERP10 contesta ${r.status} al leer ${ruta.split('?')[0]}`, r.status)
    return r.json
  }

  /** Todas las filas de un listado paginado ($top, $skip por página), como el de Diez. */
  async todas<T>(ruta: string, tam = TAM_PAGINA): Promise<T[]> {
    const sep = ruta.includes('?') ? '&' : '?'
    const filas: T[] = []
    const vistas = new Set<string>()
    let total: number | null = null
    for (let pag = 0; pag < 5000; pag++) {
      const j = await this.leer<Paginada<T> | T[]>(`${ruta}${sep}${q({ $top: tam, $skip: pag })}`)
      const d = Array.isArray(j) ? j : j?.Datos
      if (!Array.isArray(d)) throw new ErrorErp10(`${ruta.split('?')[0]}: forma inesperada`, 200)
      if (!Array.isArray(j) && typeof j.ResultadosTotales === 'number') total = j.ResultadosTotales
      if (d.length === 0) break
      const primero = JSON.stringify(d[0])
      if (vistas.has(primero)) break
      vistas.add(primero)
      filas.push(...d)
      if (total != null ? filas.length >= total : d.length < tam) break
    }
    if (total != null && filas.length !== total) throw new ErrorErp10(`${ruta.split('?')[0]}: ERP10 dice ${total} y se han leído ${filas.length}`, 200)
    return filas
  }

  /** Los apuntes entre dos días (AAAA-MM-DD, los dos incluidos). */
  apuntesEntre(desde: string, hasta: string): Promise<Apunte[]> {
    return this.todas<Apunte>(`/api/apuntes?${q({ $filter: `Fecha ge ${aaaammdd(desde)} and Fecha le ${aaaammdd(hasta)}` })}`)
  }
  /** Los apuntes de un mes (AAAA-MM). */
  apuntesDelMes(aaaa_mm: string): Promise<Apunte[]> {
    const [a, b] = limitesMes(aaaa_mm.replace('-', ''))
    return this.todas<Apunte>(`/api/apuntes?${q({ $filter: `Fecha ge ${a} and Fecha le ${b}` })}`)
  }
  /** /api/apuntes/resumen de un mes (lo que ERP10 resume por tipo). */
  async resumenDelMes(aaaa_mm: string): Promise<{ status: number; json: unknown }> {
    const [a, b] = limitesMes(aaaa_mm.replace('-', ''))
    const r = await this.get<unknown>(`/api/apuntes/resumen?${q({ fechaInicio: a, fechaFinal: b })}`)
    return { status: r.status, json: r.json }
  }
  facturasDelMes(aaaa_mm: string): Promise<Record<string, unknown>[]> {
    const [a, b] = limitesMes(aaaa_mm.replace('-', ''))
    return this.todas<Record<string, unknown>>(`/api/facturas?${q({ $filter: `Fecha ge ${a} and Fecha le ${b}` })}`)
  }
  /** El PDF de una factura (getfile), solo para ver si se baja: estado y tamaño. */
  async documento(ejercicio: string, serie: string, documento: number): Promise<{ status: number; bytes: number; motivo: string | null }> {
    const r = await this.get<unknown>(`/api/facturas/getfile/${encodeURIComponent(ejercicio)}/${encodeURIComponent(serie)}/${documento}`)
    const motivo = r.status === 200 ? null : String((r.json as Record<string, unknown> | null)?.Message ?? (r.json as Record<string, unknown> | null)?.message ?? r.txt ?? '').slice(0, 120)
    return { status: r.status, bytes: r.txt.length, motivo }
  }
}

// ── Lo que se hace con lo leído (puro) ───────────────────────────────────────────────

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const subcuenta = (x: unknown) => String(x ?? '').replace(/\D/g, '')

/**
 * Las líneas de los apuntes sumadas por cuenta, como el sumas y saldos de ERP10
 * (céntimos: debe, haber y el saldo partido en deudor y acreedor). Como el traspaso
 * de Diez (lineasDeApuntes): las líneas de los apuntes, no getSumasYsaldos, que en
 * Diez devuelve líneas y no saldos (docs/conta/contraste.md).
 */
export function sumarPorCuenta(apuntes: readonly Apunte[]): { subcuenta: string; nombre: string; debe: number; haber: number; deudor: number; acreedor: number }[] {
  const m = new Map<string, { debe: number; haber: number }>()
  for (const a of apuntes) for (const l of a.Detalles ?? []) {
    const c = subcuenta(l.Cuenta)
    if (!c) continue
    const x = m.get(c) ?? { debe: 0, haber: 0 }
    x.debe += cent(l.Debe)
    x.haber += cent(l.Haber)
    m.set(c, x)
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, x]) => {
    const s = x.debe - x.haber
    return { subcuenta: c, nombre: '', debe: x.debe, haber: x.haber, deudor: s > 0 ? s : 0, acreedor: s < 0 ? -s : 0 }
  })
}

/** Cuántas líneas tiene una lista de apuntes. */
export const lineas = (apuntes: readonly Apunte[]) => apuntes.reduce((t, a) => t + (a.Detalles?.length ?? 0), 0)

/** Por tipo de asiento: cuántos asientos y cuántas líneas (para «qué hay en ERP10»). */
export function porTipo(apuntes: readonly Apunte[]): { tipo: number | null; asientos: number; lineas: number }[] {
  const m = new Map<number | null, { asientos: number; lineas: number }>()
  for (const a of apuntes) {
    const k = typeof a.TipoAsiento === 'number' ? a.TipoAsiento : null
    const x = m.get(k) ?? { asientos: 0, lineas: 0 }
    x.asientos++
    x.lineas += a.Detalles?.length ?? 0
    m.set(k, x)
  }
  return [...m.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1)).map(([tipo, x]) => ({ tipo, ...x }))
}

/**
 * Del resumen de ERP10, solo lo que no es dato de nadie: los campos de texto que
 * nombran el tipo y los números enteros (recuentos). Ni importes, ni nombres, ni NIF.
 */
export function resumenSinDatos(j: unknown): Record<string, string | number>[] {
  const filas = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as Paginada<unknown>).Datos) ? (j as Paginada<unknown>).Datos : [])
  return filas.map((f) => {
    const o: Record<string, string | number> = {}
    for (const [k, v] of Object.entries((f ?? {}) as Record<string, unknown>)) {
      if (/importe|debe|haber|saldo|total|cif|nif|nombre|razon|tercero|cuenta|concepto|descripcion$/i.test(k) && !/^tipo/i.test(k)) continue
      if (typeof v === 'number' && Number.isInteger(v)) o[k] = v
      else if (typeof v === 'string' && /^tipo/i.test(k) && v.length <= 40) o[k] = v
    }
    return o
  })
}
