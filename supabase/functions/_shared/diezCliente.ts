// supabase/functions/_shared/diezCliente.ts
//
// C04b · T3 · El único sitio que habla con Diez (apiCON de Cegid).
//
// Sin nada de Deno ni de Node: lo usa la edge function que trae y envía, y lo
// prueban las unitarias contra el Diez simulado (scripts/conta/diez/falso.mjs).
//
// Los FRENOS, que no se quitan nunca (Julio, 12/10):
//   · C0001 —la base personal de Julio— vetada: ni se entra.
//   · Solo se habla con bases conocidas: C0008 (Llorente29) y C0009 (pruebas).
//     Al entrar, la base que dice Diez (DataBaseName) tiene que ser la pedida;
//     si no, no se lee nada.
//   · Siempre https (http solo para el Diez simulado en esta máquina), sin
//     seguir redirecciones, y ninguna petición espera más de 90 s.
//   · Escribir es una lista cerrada (apuntes/add y facturas/add) y hace falta
//     pedirlo: `escribir: true`. En C0008 además `escribirEnReal: true`
//     (regla 4 del encargo: primero el entorno de pruebas).
//
// El TOKEN dura 14 días. Se guarda fuera (Vault, por connector_token_save) y
// se renueva cuando le quedan menos de 2 días. Renovar es UN intento: si falla,
// la conexión pasa a «caída» (connector_mark_down) y se para. No hay bucles.
//
// Las RAREZAS de Diez, medidas en los runs 7 a 10:
//   · la página máxima es de 200, pidas lo que pidas;
//   · `$skip` cuenta PÁGINAS, no elementos;
//   · pasado el final, devuelve otra vez la primera página, sin avisar.
// Por eso se pagina con $top=200 y $skip = índice de página, se para en cuanto
// una página repite CUALQUIERA de las ya leídas, y lo leído tiene que sumar el
// total que dice Diez: si no, es un error, no un resultado.

export const BASES_PROHIBIDAS = ['C0001'] as const
export const BASE_REAL = 'C0008'
export const BASE_PRUEBAS = 'C0009'
export const BASES_CONOCIDAS = [BASE_REAL, BASE_PRUEBAS] as const
export const TAM_PAGINA = 200
export const MARGEN_RENOVAR_MS = 2 * 24 * 3600 * 1000
export const MAX_INTENTOS = 3 // regla 5 del encargo

export type Credenciales = {
  grant_type?: string
  client_id: string
  client_secret: string
  username: string
  password: string
}

export type TokenGuardado = { token: string; expiresAt: string }

/** Dónde vive el token entre llamadas (en la edge function: Vault). */
export interface AlmacenToken {
  leer(): Promise<TokenGuardado | null>
  guardar(token: string, expiresAt: string): Promise<void>
  /** La renovación falló: conexión caída, con su porqué. */
  caida(error: string): Promise<void>
}

export type ConfigDiez = {
  base: string
  nombreBd: string
  credenciales: Credenciales
  almacen: AlmacenToken
  escribir?: boolean
  escribirEnReal?: boolean
  fetch?: typeof fetch
  ahora?: () => number
  pausaMs?: number
}

export class FrenoDiez extends Error {
  constructor(m: string) { super(`Freno: ${m}`); this.name = 'FrenoDiez' }
}
export class ConexionCaida extends Error {
  constructor(m: string) { super(m); this.name = 'ConexionCaida' }
}
export class ErrorDiez extends Error {
  constructor(m: string, readonly status: number, readonly cuerpo: unknown) { super(m); this.name = 'ErrorDiez' }
}

// ── Lo que devuelve y recibe Diez (Swagger, run 13) ──────────────────────────
export type DetalleApunte = {
  Ejercicio?: string; Serie?: string; Documento?: number; Linea?: number
  Cuenta?: string; Fecha?: number; Debe?: number; Haber?: number
  Descripcion?: string; Contrapartida?: string; Justificante?: string; Tercero?: string
}
export type Apunte = {
  Ejercicio: string; Serie: string; Documento?: number; TipoAsiento?: number
  Fecha?: number; Descripcion?: string; Debe?: number; Haber?: number
  Detalles?: DetalleApunte[]
}
export type ApunteSimplificado = {
  Ejercicio: string; Serie: string; Documento?: number; Fecha: number; Descripcion?: string
  Detalles: { Linea?: number; Cuenta: string; Debe?: number; Haber?: number; Descripcion?: string; Contrapartida?: string }[]
}
export type Factura = Record<string, unknown> & {
  Ejercicio: string; Serie: string; Documento?: number; TipoAsiento: number; Fecha: number
  CuentaCliente: string; FechaFactura?: number; NumeroFactura?: string; CifCliente?: string; TotalFactura?: number
}
export type FacturaData = Record<string, unknown> & {
  Ejercicio: string; Serie: string; Documento?: number; TipoAsiento: number
  CuentaCliente: string; FechaFactura: number; NumeroFactura?: string; CifCliente?: string
}
type Paginada<T> = { Datos: T[]; ResultadosTotales?: number; PaginaActual?: number; ElementosPorPagina?: number }

// Las únicas rutas que se pueden escribir, y con qué método.
const ESCRITURAS: Record<string, 'POST'> = { '/api/apuntes/add': 'POST', '/api/facturas/add': 'POST' }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esLocal = (b: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
const huella = (x: unknown) => JSON.stringify(x ?? null)
/** AAAAMMDD de un mes (AAAAMM): primero y último día. */
export function limitesMes(aaaamm: string): [number, number] {
  const y = Number(aaaamm.slice(0, 4)), m = Number(aaaamm.slice(4, 6))
  if (!y || !m || m > 12) throw new Error(`Mes no válido: ${aaaamm}`)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [y * 10000 + m * 100 + 1, y * 10000 + m * 100 + ultimo]
}

export class ClienteDiez {
  private readonly base: string
  private readonly f: typeof fetch
  private readonly ahora: () => number
  private token: string | null = null
  /** Métrica de la sesión (para el registro de la lectura: solo recuentos). */
  readonly metrica = { peticiones: 0, reintentos429: 0 }

  constructor(private readonly cfg: ConfigDiez) {
    const bd = String(cfg.nombreBd ?? '').trim().toUpperCase()
    if ((BASES_PROHIBIDAS as readonly string[]).includes(bd)) throw new FrenoDiez(`la base ${bd} no se toca nunca`)
    if (!(BASES_CONOCIDAS as readonly string[]).includes(bd)) throw new FrenoDiez(`base ${bd || '(vacía)'} desconocida; solo ${BASES_CONOCIDAS.join(' y ')}`)
    const b = String(cfg.base ?? '').replace(/\/$/, '')
    if (!b.startsWith('https://') && !esLocal(b)) throw new FrenoDiez('sin https no sale nada')
    this.base = b
    this.f = cfg.fetch ?? fetch
    this.ahora = cfg.ahora ?? Date.now
  }

  get nombreBd() { return this.cfg.nombreBd.trim().toUpperCase() }

  // ── Hablar ───────────────────────────────────────────────────────────────────
  private async llamar(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, form?: Record<string, string>): Promise<{ status: number; json: unknown }> {
    const camino = ruta.split('?')[0]
    const esEntrar = metodo === 'POST' && camino === '/token'
    if (metodo !== 'GET' && !esEntrar) {
      if (ESCRITURAS[camino] !== metodo) throw new FrenoDiez(`${metodo} ${camino} no está en la lista de escrituras`)
      if (!this.cfg.escribir) throw new FrenoDiez(`escribir en Diez no está pedido (${camino})`)
      if (this.nombreBd === BASE_REAL && !this.cfg.escribirEnReal) throw new FrenoDiez(`escribir en ${BASE_REAL} exige escribirEnReal; primero ${BASE_PRUEBAS}`)
    }
    if (!camino.startsWith('/api/') && !esEntrar) throw new FrenoDiez(`ruta ${camino} fuera de /api`)
    const cab: Record<string, string> = { accept: 'application/json' }
    let body: string | undefined
    if (form) { cab['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString() }
    else if (cuerpo !== undefined) { cab['content-type'] = 'application/json'; body = JSON.stringify(cuerpo) }
    if (!esEntrar) cab.authorization = `Bearer ${await this.asegurarToken()}`
    for (let intento = 1; ; intento++) {
      if (this.cfg.pausaMs) await espera(this.cfg.pausaMs)
      this.metrica.peticiones++
      const r = await this.f(this.base + ruta, { method: metodo, headers: cab, body, redirect: 'manual', signal: AbortSignal.timeout(90_000) })
      if (r.status >= 300 && r.status < 400) throw new FrenoDiez(`${metodo} ${camino} redirige (${r.status}); no se sigue`)
      // 429: espera y otra vez, hasta MAX_INTENTOS en total. Solo en lectura:
      // una escritura que no se sabe si entró no se repite a ciegas.
      if (r.status === 429 && metodo === 'GET' && intento < MAX_INTENTOS) {
        this.metrica.reintentos429++
        await r.arrayBuffer().catch(() => null)
        const ra = r.headers.get('retry-after')
        const s = ra != null && ra.trim() !== '' && Number.isFinite(Number(ra)) ? Number(ra) : 5 * intento
        await espera(Math.min(s, 60) * 1000)
        continue
      }
      const txt = await r.text()
      let json: unknown = null
      try { json = txt ? JSON.parse(txt) : null } catch { json = txt }
      return { status: r.status, json }
    }
  }

  // ── El token ─────────────────────────────────────────────────────────────────
  /** Entra (un intento). Comprueba que Diez abre la base pedida. */
  async entrar(): Promise<TokenGuardado> {
    const c = this.cfg.credenciales
    const form = {
      grant_type: c.grant_type ?? 'password', client_id: c.client_id, client_secret: c.client_secret,
      username: c.username, password: c.password, nombre_bd: this.nombreBd,
    }
    const r = await this.llamar('POST', '/token', undefined, form)
    const j = (r.json ?? {}) as Record<string, unknown>
    if (r.status !== 200 || typeof j.access_token !== 'string') {
      // El mensaje de Diez, nunca las credenciales.
      throw new ErrorDiez(`Diez no deja entrar (${r.status}): ${String(j.error_description ?? j.error ?? 'sin motivo')}`, r.status, null)
    }
    const abierta = String(j.DataBaseName ?? '').trim().toUpperCase()
    if (abierta !== this.nombreBd) throw new FrenoDiez(`Diez ha abierto ${abierta || '(ninguna)'} y se pidió ${this.nombreBd}; no se lee nada`)
    const segundos = Number(j.expires_in) || 0
    const expiresAt = new Date(this.ahora() + segundos * 1000).toISOString()
    return { token: j.access_token, expiresAt }
  }

  /** El token vigente; si caduca en menos de 2 días, uno nuevo (un intento). */
  async asegurarToken(): Promise<string> {
    if (this.token) return this.token
    const g = await this.cfg.almacen.leer()
    if (g && Date.parse(g.expiresAt) - this.ahora() > MARGEN_RENOVAR_MS) return (this.token = g.token)
    try {
      const n = await this.entrar()
      await this.cfg.almacen.guardar(n.token, n.expiresAt)
      return (this.token = n.token)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Caída, con su porqué, y se para. En ningún caso se reintenta.
      await this.cfg.almacen.caida(`La renovación del token falló: ${msg}`)
      if (e instanceof FrenoDiez) throw e
      throw new ConexionCaida(`Conexión con Diez caída: ${msg}`)
    }
  }

  // ── Leer ─────────────────────────────────────────────────────────────────────
  async get<T>(ruta: string): Promise<T> {
    const r = await this.llamar('GET', ruta)
    if (r.status !== 200) throw new ErrorDiez(`GET ${ruta.split('?')[0]} → ${r.status}`, r.status, r.json)
    return r.json as T
  }

  /** Todas las filas de un listado paginado, con las tres rarezas cubiertas. */
  async todas<T>(ruta: string): Promise<T[]> {
    const sep = ruta.includes('?') ? '&' : '?'
    const filas: T[] = []
    const vistas = new Set<string>()
    let total: number | null = null
    for (let pag = 0; pag < 5000; pag++) {
      const j = await this.get<Paginada<T> | T[]>(`${ruta}${sep}${q({ $top: TAM_PAGINA, $skip: pag })}`)
      const d = Array.isArray(j) ? j : j?.Datos
      if (!Array.isArray(d)) throw new ErrorDiez(`${ruta.split('?')[0]}: forma inesperada`, 200, null)
      if (!Array.isArray(j) && typeof j.ResultadosTotales === 'number') total = j.ResultadosTotales
      if (d.length === 0) break
      const primero = huella(d[0])
      if (vistas.has(primero)) break // Diez ha vuelto al principio
      vistas.add(primero)
      filas.push(...d)
      if (total != null ? filas.length >= total : d.length < TAM_PAGINA) break
    }
    if (total != null && filas.length !== total) {
      throw new ErrorDiez(`${ruta.split('?')[0]}: Diez dice ${total} y se han leído ${filas.length}`, 200, null)
    }
    return filas
  }

  private filtroMes(aaaamm: string) {
    const [a, b] = limitesMes(aaaamm)
    return q({ $filter: `Fecha ge ${a} and Fecha le ${b}` })
  }
  apuntesDelMes(aaaamm: string) { return this.todas<Apunte>(`/api/apuntes?${this.filtroMes(aaaamm)}`) }
  facturasDelMes(aaaamm: string) { return this.todas<Factura>(`/api/facturas?${this.filtroMes(aaaamm)}`) }
  subcuentas() { return this.todas<Record<string, unknown>>('/api/subcuentas') }
  series() { return this.todas<{ Codigo: string; Descripcion: string }>('/api/series') }

  /** ¿Existe ya el asiento con esa clave? (para no enviar dos veces). */
  async asiento(ejercicio: string, serie: string, documento: number): Promise<Factura | null> {
    const r = await this.llamar('GET', `/api/apuntes/asiento/${encodeURIComponent(ejercicio)}/${encodeURIComponent(serie)}/${documento}`)
    if (r.status === 404 || r.json == null) return null
    if (r.status !== 200) throw new ErrorDiez(`GET asiento → ${r.status}`, r.status, r.json)
    return r.json as Factura
  }

  /**
   * ¿Está ya en Diez esta factura? Serie + número de factura + NIF (respuesta 1).
   * Diez no busca por número: se lee el mes de la fecha de la factura y se casa
   * aquí. Devuelve TODAS las que casan: si hay más de una, quien llama no elige.
   */
  async buscarFactura(serie: string, numeroFactura: string, nif: string, fechaFactura: number): Promise<Factura[]> {
    const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-/]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
    const mes = String(fechaFactura).slice(0, 6)
    const delMes = await this.facturasDelMes(mes)
    return delMes.filter((f) => String(f.Serie) === serie && norm(f.NumeroFactura) === norm(numeroFactura) && norm(f.CifCliente) === norm(nif))
  }

  // ── Escribir ─────────────────────────────────────────────────────────────────
  async enviarAsiento(a: ApunteSimplificado): Promise<Apunte> {
    const r = await this.llamar('POST', '/api/apuntes/add', a)
    if (r.status !== 200) throw new ErrorDiez(`apuntes/add → ${r.status}`, r.status, r.json)
    return r.json as Apunte
  }
  async enviarFactura(fd: FacturaData): Promise<Factura> {
    const r = await this.llamar('POST', '/api/facturas/add', fd)
    if (r.status !== 200) throw new ErrorDiez(`facturas/add → ${r.status}`, r.status, r.json)
    return r.json as Factura
  }
}
