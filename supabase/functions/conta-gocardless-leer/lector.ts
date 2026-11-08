// supabase/functions/conta-gocardless-leer/lector.ts
//
// G01 · Tarea 2 (06/11/2026). Lo de leer una cuenta de GoCardless que no
// necesita Deno: las direcciones de cada entorno, la cabecera de la versión,
// la paginación por cursor y lo que se guarda de cada cliente, mandato,
// suscripción, cobro y cuenta de abono. Puro: lo prueban las unitarias
// (tests/unit/modules/conta/gestoria/lectorGocardless.test.ts).
//
// Solo LEE: GET a /customers, /mandates, /subscriptions, /payments, /events y
// /creditor_bank_accounts. Nunca escribe en GoCardless.
//
// API de GoCardless (documentación oficial, https://developer.gocardless.com/api-reference):
//   · Cabecera obligatoria «GoCardless-Version: 2015-07-06» y
//     «Authorization: Bearer <token>».
//   · Real: https://api.gocardless.com · Pruebas (sandbox): https://api-sandbox.gocardless.com
//   · Listas paginadas por cursor: «limit» (hasta 500) y «after»; la respuesta
//     trae meta.cursors.after, null en la última página.
//   · Los importes van en céntimos (enteros) y con su moneda.

export type Entorno = 'real' | 'pruebas'
export const BASES: Record<Entorno, string> = {
  real: 'https://api.gocardless.com',
  pruebas: 'https://api-sandbox.gocardless.com',
}
export const VERSION_API = '2015-07-06'
export const POR_PAGINA = 500

export function cabeceras(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'GoCardless-Version': VERSION_API, Accept: 'application/json' }
}

export type Recurso = 'customers' | 'mandates' | 'subscriptions' | 'payments' | 'events' | 'creditor_bank_accounts'

/** La dirección de una página: el recurso, sus filtros y el cursor de la anterior. */
export function urlDePagina(entorno: Entorno, recurso: Recurso, filtros: Record<string, string> = {}, despues: string | null = null): string {
  const u = new URL(`${BASES[entorno]}/${recurso}`)
  u.searchParams.set('limit', String(POR_PAGINA))
  for (const [k, v] of Object.entries(filtros)) u.searchParams.set(k, v)
  if (despues) u.searchParams.set('after', despues)
  return u.toString()
}

/** El cursor de la página siguiente, o null si es la última. */
export function cursorSiguiente(respuesta: unknown): string | null {
  const after = (respuesta as { meta?: { cursors?: { after?: unknown } } } | null)?.meta?.cursors?.after
  return typeof after === 'string' && after !== '' ? after : null
}

/**
 * Lee un recurso entero, página a página, con quien pida cada página (fuera
 * se hace el fetch). Para si la misma página devuelve el mismo cursor (no se
 * queda dando vueltas) o si pasa del tope de páginas.
 */
export async function leerTodo<T>(
  recurso: Recurso,
  pedir: (despues: string | null) => Promise<unknown>,
  tope = 200,
): Promise<T[]> {
  const out: T[] = []
  let despues: string | null = null
  const vistos = new Set<string>()
  for (let i = 0; i < tope; i++) {
    const r = await pedir(despues)
    const filas = (r as Record<string, unknown> | null)?.[recurso]
    if (!Array.isArray(filas)) throw new Error(`GoCardless no ha devuelto «${recurso}» en la página ${i + 1}.`)
    out.push(...(filas as T[]))
    const sig = cursorSiguiente(r)
    if (!sig) return out
    if (vistos.has(sig)) throw new Error(`GoCardless repite el cursor de «${recurso}»: se para para no leer en bucle.`)
    vistos.add(sig)
    despues = sig
  }
  throw new Error(`«${recurso}» tiene más de ${tope} páginas: se para sin terminar.`)
}

// ── Lo que se guarda de cada cosa ───────────────────────────────────────────

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const enlace = (x: unknown, k: string): string | null => texto((x as { links?: Record<string, unknown> } | null)?.links?.[k])

export interface ClienteGc {
  id: string
  nombre: string
  correo: string | null
  /** El NIF, si la cuenta lo guarda en los metadatos (GoCardless no tiene campo propio). */
  nif: string | null
  creado: string | null
}

/** Las claves de metadatos donde se busca el NIF, por este orden. */
export const CLAVES_NIF = ['nif', 'cif', 'dni', 'nie', 'tax_id', 'vat']

export function normalizarNif(v: string | null | undefined): string | null {
  if (!v) return null
  let n = v.toUpperCase().replace(/[\s.\-_/]/g, '')
  if (n.startsWith('ES') && n.length > 9) n = n.slice(2)
  return n === '' ? null : n
}

export function leerCliente(x: Record<string, unknown>): ClienteGc {
  const empresa = texto(x.company_name)
  const persona = [texto(x.given_name), texto(x.family_name)].filter(Boolean).join(' ')
  const meta = (x.metadata ?? {}) as Record<string, unknown>
  let nif: string | null = null
  for (const [k, v] of Object.entries(meta)) {
    if (CLAVES_NIF.includes(k.toLowerCase()) && texto(v)) { nif = normalizarNif(texto(v)); break }
  }
  return {
    id: String(x.id),
    nombre: empresa ?? (persona || String(x.id)),
    correo: texto(x.email)?.toLowerCase() ?? null,
    nif,
    creado: texto(x.created_at),
  }
}

/** Estados de un mandato en GoCardless. «activo» para el casado: active (y submitted, que ya cobra). */
export type EstadoMandatoGc =
  | 'pending_customer_approval' | 'pending_submission' | 'submitted' | 'active' | 'failed'
  | 'cancelled' | 'expired' | 'consumed' | 'blocked' | 'suspended_by_payer'
export const MANDATO_VIVO: readonly string[] = ['pending_submission', 'submitted', 'active']
export const MANDATO_POR_FIRMAR: readonly string[] = ['pending_customer_approval']

export interface MandatoGc {
  id: string
  estado: string
  referencia: string | null
  esquema: string | null
  clienteId: string | null
  cuentaBancoId: string | null
  creado: string | null
}

export function leerMandato(x: Record<string, unknown>): MandatoGc {
  return {
    id: String(x.id),
    estado: String(x.status ?? ''),
    referencia: texto(x.reference),
    esquema: texto(x.scheme),
    clienteId: enlace(x, 'customer'),
    cuentaBancoId: enlace(x, 'customer_bank_account'),
    creado: texto(x.created_at),
  }
}

export type Intervalo = 'weekly' | 'monthly' | 'yearly'

export interface SuscripcionGc {
  id: string
  nombre: string
  importeCent: number
  moneda: string
  intervalo: string
  cada: number
  estado: string
  mandatoId: string | null
  inicio: string | null
  fin: string | null
  /** G04 · El siguiente cobro (upcoming_payments de GoCardless, el más próximo): su día y su importe. */
  proximoCobro: { fecha: string; importeCent: number } | null
}

export function leerSuscripcion(x: Record<string, unknown>): SuscripcionGc {
  return {
    id: String(x.id),
    nombre: texto(x.name) ?? '',
    importeCent: Number.isInteger(x.amount) ? (x.amount as number) : Math.round(Number(x.amount ?? 0)),
    moneda: String(x.currency ?? ''),
    intervalo: String(x.interval_unit ?? ''),
    cada: Number.isInteger(x.interval) && (x.interval as number) > 0 ? (x.interval as number) : 1,
    estado: String(x.status ?? ''),
    mandatoId: enlace(x, 'mandate'),
    inicio: texto(x.start_date),
    fin: texto(x.end_date),
    proximoCobro: proximoCobro(x.upcoming_payments),
  }
}

/** G04 · El más próximo de upcoming_payments ([{ charge_date, amount }]); null si no trae ninguno. */
function proximoCobro(v: unknown): { fecha: string; importeCent: number } | null {
  if (!Array.isArray(v)) return null
  const xs = v.filter((p): p is { charge_date: string; amount: number } =>
    !!p && typeof (p as { charge_date?: unknown }).charge_date === 'string' && Number.isFinite(Number((p as { amount?: unknown }).amount)))
    .sort((a, b) => (a.charge_date < b.charge_date ? -1 : a.charge_date > b.charge_date ? 1 : 0))
  return xs.length ? { fecha: xs[0].charge_date, importeCent: Math.round(Number(xs[0].amount)) } : null
}

/**
 * Lo que cuesta al mes una suscripción, en céntimos, redondeado al céntimo
 * (medio céntimo hacia arriba). Una anual se prorratea en 12; una de cada 3
 * meses, en 3; una semanal, 52 semanas entre 12 meses. Null si no se sabe.
 */
export function alMesCent(s: Pick<SuscripcionGc, 'importeCent' | 'intervalo' | 'cada'>): number | null {
  const cada = s.cada > 0 ? s.cada : 1
  const meses = s.intervalo === 'monthly' ? cada : s.intervalo === 'yearly' ? 12 * cada : s.intervalo === 'weekly' ? (12 * cada) / 52 : null
  if (meses === null) return null
  return Math.round(s.importeCent / meses)
}

export interface CobroGc {
  id: string
  estado: string
  fecha: string | null
  importeCent: number
  moneda: string
  mandatoId: string | null
  suscripcionId: string | null
  /** El motivo del fallo, de su evento (/events): lo pone casarMotivos. */
  motivo: string | null
}

export const COBRO_FALLIDO: readonly string[] = ['failed', 'charged_back', 'cancelled']

export function leerCobro(x: Record<string, unknown>): CobroGc {
  return {
    id: String(x.id),
    estado: String(x.status ?? ''),
    fecha: texto(x.charge_date),
    importeCent: Number.isInteger(x.amount) ? (x.amount as number) : Math.round(Number(x.amount ?? 0)),
    moneda: String(x.currency ?? ''),
    mandatoId: enlace(x, 'mandate'),
    suscripcionId: enlace(x, 'subscription'),
    motivo: null,
  }
}

/**
 * El motivo de cada cobro fallido, de los eventos «payments · failed /
 * charged_back» (details.description; si no, details.cause). El último gana.
 */
export function casarMotivos(cobros: CobroGc[], eventos: Record<string, unknown>[]): CobroGc[] {
  const motivo = new Map<string, { cuando: string; texto: string }>()
  for (const e of eventos) {
    if (e.resource_type !== 'payments' || !['failed', 'charged_back', 'cancelled'].includes(String(e.action))) continue
    const pago = enlace(e, 'payment')
    const d = (e.details ?? {}) as Record<string, unknown>
    const t = texto(d.description) ?? texto(d.cause)
    if (!pago || !t) continue
    const cuando = texto(e.created_at) ?? ''
    const antes = motivo.get(pago)
    if (!antes || cuando >= antes.cuando) motivo.set(pago, { cuando, texto: t })
  }
  return cobros.map((c) => (motivo.has(c.id) ? { ...c, motivo: motivo.get(c.id)!.texto } : c))
}

/** Desde cuándo se leen los cobros: el primer día del mes de hace N meses («charge_date[gte]»). */
export function desdeHaceMeses(hoy: string, meses: number): string {
  const [a, m] = hoy.slice(0, 7).split('-').map(Number)
  const total = a * 12 + (m - 1) - meses
  const año = Math.floor(total / 12)
  const mes = (total % 12) + 1
  return `${año}-${String(mes).padStart(2, '0')}-01`
}

export interface CuentaAbonoGc {
  id: string
  banco: string | null
  titular: string | null
  /** Las últimas cifras de la cuenta: GoCardless no devuelve el IBAN entero. */
  terminaEn: string | null
  moneda: string | null
  activa: boolean
}

export function leerCuentaAbono(x: Record<string, unknown>): CuentaAbonoGc {
  return {
    id: String(x.id),
    banco: texto(x.bank_name),
    titular: texto(x.account_holder_name),
    terminaEn: texto(x.account_number_ending),
    moneda: texto(x.currency),
    activa: x.enabled === true,
  }
}

/**
 * ¿La cuenta de abono de GoCardless es una de las del emisor dadas de alta en
 * Sumied? Con lo que da GoCardless (las últimas cifras y el banco) se compara
 * contra el final del IBAN de cada cuenta de tesorería. Dice cuál, o por qué no.
 */
export function abonoContraTesoreria(
  abono: CuentaAbonoGc,
  tesoreria: { id: string; nombre: string; iban: string | null }[],
): { coincide: true; tesoreriaId: string; nombre: string } | { coincide: false; porque: string } {
  if (!abono.terminaEn) return { coincide: false, porque: 'GoCardless no dice en qué termina la cuenta de abono.' }
  const fin = abono.terminaEn.replace(/\D/g, '')
  const candidatas = tesoreria.filter((t) => t.iban && t.iban.replace(/\s/g, '').endsWith(fin))
  if (candidatas.length === 1) return { coincide: true, tesoreriaId: candidatas[0].id, nombre: candidatas[0].nombre }
  if (candidatas.length === 0) {
    return { coincide: false, porque: `GoCardless abona en una cuenta${abono.banco ? ` de ${abono.banco}` : ''} que termina en ${fin}, y ninguna cuenta del emisor en Sumied termina así.` }
  }
  return { coincide: false, porque: `Hay ${candidatas.length} cuentas del emisor que terminan en ${fin}: con lo que da GoCardless no se sabe cuál es.` }
}
