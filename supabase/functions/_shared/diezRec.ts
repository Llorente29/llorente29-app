// supabase/functions/_shared/diezRec.ts
//
// Q10 · respuesta 1 · LA FACTURACIÓN DE CEGID (API DiezREC, docs/conta/api_diezrec.md), SOLO LEYENDO.
//   · El login (POST /api/Auth/login) con las cuatro claves y el código de empresa. La documentación dice «empresa»
//     y la colección de Postman de QBO manda «codigoEmpresa»: se prueba «empresa» y, si el código no se tiene en
//     cuenta (400), «codigoEmpresa»; el que funciona se dice.
//   · Solo GET (y el POST del login): este cliente NO sabe escribir. Mandar incidencias (punto 4) llegará con su
//     propio cliente y el sí de Julio; cualquier otro método aquí PARA antes de salir.
//   · Listados de 200 en 200 con $orderby fijo ($skip es el número de página: la API lo dice así).
//   · Lo que se lee se pasa a la forma corta de las tablas conta_cegid_* (la 1840). Puro lo que se puede: las
//     formas cortas y las rutas se prueban sin red (tests/unit/modules/conta/q10/diezRec.test.ts).
// Sin dependencias de Deno: fetch se pasa desde fuera.

export const BASE_DIEZREC = 'https://apirec.diezsoftware.com'
export const POR_PAGINA = 200

export interface ClavesDiezRec { client_id: string; client_secret: string; username: string; password: string }

export class FalloDiezRec extends Error {
  constructor(mensaje: string, readonly status: number | null = null) { super(mensaje) }
}

type Fila = Record<string, unknown>
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null)
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const ent = (v: unknown) => { const n = num(v); return n === null ? null : Math.trunc(n) }
const marca = (v: unknown) => v === true || (typeof v === 'string' && v.trim() === '*')

// ── Las formas cortas (las columnas de conta_cegid_*) ─────────────────────────────

export interface ClienteCegid { codigo: number; nombre_comercial: string | null; nombre_fiscal: string | null; nif: string | null; email: string | null }
export interface ConceptoFijo { codigoConcepto: string | null; descripcion: string | null; importe: number | null; cantidad: number | null; totalLinea: number | null }
export interface ConceptoCegid { codigo: string; descripcion: string | null; importe: number | null; area: number | null; extraordinario: boolean | null
  por_iva: number | null; con_retencion: boolean | null; iva_incluido: boolean | null }
export interface FacturaCegid { ejercicio: number; serie: string; codigo: number; cliente: number | null; nombre_fiscal: string | null; nif: string | null
  fecha_cegid: number | null; base: number; iva: number; retencion: number; porcentaje_retencion: number | null; total: number | null; lineas: Fila[] }

export function clienteCegid(x: Fila): ClienteCegid | null {
  const codigo = ent(x.codigo)
  if (codigo === null) return null
  // «nombreFisCal», con la C mayúscula, como lo escribe la documentación; por si acaso, también «nombreFiscal».
  return { codigo, nombre_comercial: txt(x.nombreComercial), nombre_fiscal: txt(x.nombreFisCal ?? x.nombreFiscal), nif: txt(x.nif), email: txt(x.email) }
}

export function conceptosFijos(x: Fila): ConceptoFijo[] {
  const xs = Array.isArray(x.detalleConceptos) ? (x.detalleConceptos as Fila[]) : []
  return xs.map((c) => ({ codigoConcepto: txt(c.codigoConcepto), descripcion: txt(c.descripcion), importe: num(c.importe), cantidad: num(c.cantidad), totalLinea: num(c.totalLinea) }))
}

/** Un concepto del listado (sin IVA ni retención) o de GetConcept (con ellos). */
export function conceptoCegid(x: Fila): ConceptoCegid | null {
  const codigo = txt(x.codigo)
  if (!codigo) return null
  const conDetalle = 'porIva' in x || 'conRetencion' in x || 'ivaIncluido' in x
  return { codigo, descripcion: txt(x.descripcion), importe: num(x.importe), area: ent(x.area), extraordinario: typeof x.extraordinario === 'boolean' ? x.extraordinario : null,
    por_iva: num(x.porIva), con_retencion: conDetalle ? marca(x.conRetencion) : null, iva_incluido: conDetalle ? marca(x.ivaIncluido) : null }
}

export function facturaCegid(x: Fila): FacturaCegid | null {
  const ejercicio = ent(x.ejercicio), codigo = ent(x.codigo)
  if (ejercicio === null || codigo === null) return null
  const suma = (k: string) => [1, 2, 3, 4].reduce((t, i) => t + (num(x[`${k}${i}`]) ?? 0), 0)
  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    ejercicio, serie: txt(x.serie) ?? '', codigo, cliente: ent(x.cliente), nombre_fiscal: txt(x.nombreFiscal), nif: txt(x.nif),
    fecha_cegid: ent(x.fecha), base: r2(suma('base')), iva: r2(suma('cuotaIva')), retencion: num(x.retencion) ?? 0, porcentaje_retencion: num(x.porcentajeRetencion),
    total: num(x.totalFactura), lineas: Array.isArray(x.details) ? (x.details as Fila[]) : [],
  }
}

// ── Las rutas ───────────────────────────────────────────────────────────────────

const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
export type QueLeer = 'clientes' | 'conceptos' | 'facturas' | 'series' | 'incidencias'
export function rutaListado(que: QueLeer, pagina: number, ejercicio?: number, mes?: number): string {
  const pag = { $top: POR_PAGINA, $skip: pagina }
  switch (que) {
    case 'clientes': return `/api/Customers?${q({ $orderby: 'codigo', ...pag })}`
    case 'conceptos': return `/api/Concepts?${q({ $orderby: 'codigo', ...pag })}`
    case 'series': return `/api/Sets?${q({ $orderby: 'codigo', ...pag })}`
    case 'facturas': return `/api/Invoices?${q({ $filter: `ejercicio eq ${Number(ejercicio)}`, $orderby: 'codigo', ...pag })}`
    // Q10 · respuesta 4 · Las incidencias de un mes (las de Sumied y las de cualquiera), para el cuadre con lo cobrado.
    case 'incidencias': return `/api/Incidences?${q({ $filter: `ano eq ${Number(ejercicio)} and mes eq ${Number(mes)}`, $orderby: 'cliente', ...pag })}`
  }
}
export const rutaCliente = (codigo: number) => `/api/Customers/GetCustomer/${Math.trunc(codigo)}`
export const rutaConcepto = (codigo: string) => `/api/Concepts/GetConcept/${encodeURIComponent(codigo)}`

/** Si esta página es la última: con menos de 200, o con lo leído llegando al total. */
export function esUltima(pagina: number, enPagina: number, total: number | null): boolean {
  return enPagina < POR_PAGINA || (total !== null && (pagina + 1) * POR_PAGINA >= total)
}

// ── El cliente (solo lee) ───────────────────────────────────────────────────────

export interface Respuesta { status: number; json: unknown; texto: string }
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>

export class ClienteDiezRec {
  private token: string | null = null
  /** El campo con el que el login aceptó el código de empresa («empresa» o «codigoEmpresa»), cuando ya ha entrado. */
  campoEmpresa: 'empresa' | 'codigoEmpresa' | null = null
  /** El «id» que devuelve el login: el cliente de Diez Software al que pertenece el usuario. */
  idCliente: string | null = null
  /**
   * `escribe: 'incidencias'` (Q10 · respuesta 3): además de leer, puede añadir una incidencia (POST
   * /api/Incidences/incidence), cambiarla (PUT, la misma ruta: respuesta 6) y borrar una (DELETE
   * /api/Incidences/delete/{cliente}/{incidencia}). Nada más: ni conceptos, ni clientes (Sumied no da de alta clientes
   * en Cegid, así que ninguno sale con cuotas fijas). Sin él, solo lee. Lo piden conta-cegid-mandar y
   * conta-cegid-corregir; conta-cegid-leer y conta-cegid-ver no.
   */
  constructor(private readonly o: { claves: ClavesDiezRec; empresa: string; base?: string; fetch: Fetch; escribe?: 'incidencias' }) {}

  private puede(metodo: string, ruta: string): boolean {
    if (metodo === 'GET') return true
    if (metodo === 'POST' && ruta === '/api/Auth/login') return true
    if (this.o.escribe !== 'incidencias') return false
    return ((metodo === 'POST' || metodo === 'PUT') && ruta === '/api/Incidences/incidence') || (metodo === 'DELETE' && /^\/api\/Incidences\/delete\/\d+\/\d+$/.test(ruta))
  }

  private async llamar(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', ruta: string, cuerpo?: Fila): Promise<Respuesta> {
    // Solo lee: el único POST que sale es el del login.
    if (!this.puede(metodo, ruta)) throw new FalloDiezRec(this.o.escribe ? `Sumied solo escribe incidencias en la facturación de Cegid: ${metodo} ${ruta} no sale.` : `Sumied solo lee de la facturación de Cegid: ${metodo} ${ruta} no sale.`)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (cuerpo) headers['Content-Type'] = 'application/json'
    if (this.token && ruta !== '/api/Auth/login') headers.Authorization = `Bearer ${this.token}`
    const r = await this.o.fetch(`${this.o.base ?? BASE_DIEZREC}${ruta}`, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    const texto = await r.text()
    let json: unknown
    try { json = texto ? JSON.parse(texto) : null } catch { json = texto }
    return { status: r.status, json, texto }
  }

  /** El login: «empresa» y, si no vale, «codigoEmpresa». Nunca deja las claves en el error. */
  async entrar(): Promise<void> {
    const base = { userName: this.o.claves.username, password: this.o.claves.password, clientId: this.o.claves.client_id, clientSecret: this.o.claves.client_secret }
    let ultimo: Respuesta | null = null
    for (const campo of ['empresa', 'codigoEmpresa'] as const) {
      const r = await this.llamar('POST', '/api/Auth/login', { ...base, [campo]: this.o.empresa })
      const tok = (r.json as Fila | null)?.auth_token
      if (r.status === 200 && typeof tok === 'string' && tok) { this.token = tok; this.campoEmpresa = campo; this.idCliente = txt((r.json as Fila).id); return }
      ultimo = r
      if (r.status !== 400) break
    }
    throw new FalloDiezRec(`Cegid no ha dejado entrar (${ultimo?.status ?? '?'}): ${motivoDeError(ultimo?.json)}`, ultimo?.status ?? null)
  }

  async get(ruta: string): Promise<Respuesta> {
    if (!this.token) await this.entrar()
    let r = await this.llamar('GET', ruta)
    // El token dura 2 horas: con 401, se vuelve a entrar una vez.
    if (r.status === 401) { this.token = null; await this.entrar(); r = await this.llamar('GET', ruta) }
    return r
  }

  /** Con un 401 (token caducado), vuelve a entrar una vez y repite. */
  private async conToken(metodo: 'POST' | 'PUT' | 'DELETE', ruta: string, cuerpo?: Fila): Promise<Respuesta> {
    if (!this.token) await this.entrar()
    let r = await this.llamar(metodo, ruta, cuerpo)
    if (r.status === 401) { this.token = null; await this.entrar(); r = await this.llamar(metodo, ruta, cuerpo) }
    return r
  }

  /** Añade una incidencia (incidencia 0: la numera Cegid). Devuelve su número; si no, lanza con el porqué. */
  async crearIncidencia(cuerpo: Fila): Promise<{ incidencia: number; datos: Fila }> {
    const r = await this.conToken('POST', '/api/Incidences/incidence', cuerpo)
    const j = (r.json ?? {}) as Fila
    const n = ent(j.incidencia)
    if (r.status !== 200 || !n) throw new FalloDiezRec(`Cegid no ha guardado la incidencia (${r.status}): ${motivoDeError(r.json)}`, r.status)
    return { incidencia: n, datos: j }
  }

  /**
   * Respuesta 6 · Cambia una incidencia que ya existe (PUT): el cuerpo lleva su cliente y su número. Devuelve lo que
   * dice Cegid que ha guardado; si no, lanza con el porqué.
   */
  async modificarIncidencia(cuerpo: Fila): Promise<Fila> {
    if (!ent(cuerpo.cliente) || !ent(cuerpo.incidencia)) throw new FalloDiezRec('Para cambiar una incidencia hacen falta su cliente y su número.')
    const r = await this.conToken('PUT', '/api/Incidences/incidence', cuerpo)
    if (r.status !== 200) throw new FalloDiezRec(`Cegid no ha cambiado la incidencia ${cuerpo.incidencia} del cliente ${cuerpo.cliente} (${r.status}): ${motivoDeError(r.json)}`, r.status)
    return (r.json ?? {}) as Fila
  }

  /** Lee una incidencia: null si no existe (204). */
  async leerIncidencia(cliente: number, incidencia: number): Promise<Fila | null> {
    const r = await this.get(`/api/Incidences/GetIncidence/${Math.trunc(cliente)}/${Math.trunc(incidencia)}`)
    if (r.status === 204) return null
    if (r.status !== 200) throw new FalloDiezRec(`Cegid contesta ${r.status} al leer la incidencia ${incidencia} del cliente ${cliente}: ${motivoDeError(r.json)}`, r.status)
    return (r.json ?? {}) as Fila
  }

  /** Borra una incidencia; true si Cegid dice que la ha borrado. */
  async borrarIncidencia(cliente: number, incidencia: number): Promise<boolean> {
    const r = await this.conToken('DELETE', `/api/Incidences/delete/${Math.trunc(cliente)}/${Math.trunc(incidencia)}`)
    if (r.status !== 200) throw new FalloDiezRec(`Cegid no ha borrado la incidencia ${incidencia} del cliente ${cliente} (${r.status}): ${motivoDeError(r.json)}`, r.status)
    return r.json === true || r.texto.trim() === 'true'
  }

  /** Una página de un listado, con su total. */
  async pagina(que: QueLeer, pagina: number, ejercicio?: number, mes?: number): Promise<{ filas: Fila[]; total: number | null; ultima: boolean }> {
    const r = await this.get(rutaListado(que, pagina, ejercicio, mes))
    if (r.status !== 200) throw new FalloDiezRec(`Cegid contesta ${r.status} al leer ${que}: ${motivoDeError(r.json)}`, r.status)
    const j = (r.json ?? {}) as Fila
    const filas = Array.isArray(j.datos) ? (j.datos as Fila[]) : []
    const total = ent(j.resultadosTotales)
    return { filas, total, ultima: esUltima(pagina, filas.length, total) }
  }
}

/** El porqué de un error de DiezREC, en una línea, sin repetir lo que se mandó. */
export function motivoDeError(j: unknown): string {
  if (typeof j === 'string') return j.slice(0, 200) || 'sin detalle'
  const x = (j ?? {}) as Fila
  const acceso = x['error de acceso']
  if (Array.isArray(acceso)) return [...acceso, ...(Array.isArray(x.Error) ? x.Error : x.Error ? [x.Error] : [])].map(String).join(' ').slice(0, 200)
  if (x.errors && typeof x.errors === 'object') return Object.values(x.errors as Record<string, unknown>).flat().map(String).join(' ').slice(0, 200)
  return String(x.title ?? x.message ?? 'sin detalle').slice(0, 200)
}

// ── «Probar la conexión»: a qué empresa ha entrado, por lo que lee de ella ───────────────

/** La última factura de un ejercicio y una serie (la de número más alto). */
export const rutaUltimaFactura = (ejercicio: number, serie: string) =>
  `/api/Invoices?${q({ $filter: `ejercicio eq ${Math.trunc(ejercicio)} and serie eq '${serie.replace(/'/g, "''")}'`, $orderby: 'codigo desc', $top: 1, $skip: 0 })}`

export interface Probado {
  campo: 'empresa' | 'codigoEmpresa' | null
  empresa: string
  idCliente: string | null
  clientes: number | null
  series: { codigo: string; descripcion: string | null; ultima: { ejercicio: number; codigo: number } | null }[]
  ejercicio: number
}

/**
 * La frase de «Probar la conexión». DiezREC no da el nombre ni el NIF de la empresa en la que se entra: se dice lo que
 * se lee de ella (sus series con su última factura del año y cuántos clientes tiene) para reconocerla sin adivinar.
 */
export function fraseProbado(p: Probado): string {
  const series = p.series.length
    ? p.series.map((x) => `${x.codigo}${x.descripcion ? ` («${x.descripcion}»)` : ''}: ${x.ultima ? `la última de ${p.ejercicio} es la ${x.ultima.ejercicio}/${x.codigo}/${x.ultima.codigo}` : `ninguna factura de ${p.ejercicio}`}`).join('; ')
    : 'ninguna'
  return `Conectada con la facturación de Cegid: ha entrado en la empresa ${p.empresa} (con «${p.campo ?? '?'}»${p.idCliente ? `; cliente de Diez Software ${p.idCliente}` : ''}). `
    + `Tiene ${p.clientes ?? '?'} clientes. Series: ${series}. Mira que es la empresa que toca. No se ha escrito nada.`
}
