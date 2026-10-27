// supabase/functions/_shared/stripeSumied.ts
//
// PC01 · Entrega 4 · EL COBRO CON TARJETA Y BIZUM DE SUMIED, por Stripe.
// Lo que comparten conta-stripe (el alta del restaurante y su estado),
// conta-pago (el enlace de pago) y conta-stripe-webhook (los avisos de Stripe).
//
//   · LA VERSIÓN DE LA API, en un solo sitio y sin «preview» (Respuesta 10 al
//     PC01): la que contestó la sonda el 27/10 (docs/conta/pc01/e4/sonda-bizum.json).
//     Va en TODAS las llamadas, v1 y v2.
//   · El alta, la que funcionó en la sonda: Accounts v2, panel completo de
//     Stripe para el restaurante, Stripe cobra las comisiones y cubre las
//     pérdidas, tarjeta en el alta y Bizum pedido justo después. Los datos del
//     restaurante los pide Stripe en su propio formulario (nunca uno nuestro).
//   · El estado de cada método, en palabras: activo, falta el alta o Stripe
//     está revisando (estadoMetodo).
//   · La firma de los avisos de Stripe (firmaValida), sin Deno: la prueban las
//     unitarias (tests/unit/modules/conta/pc01/stripeSumied.test.ts).
// Lo puro está arriba; las llamadas, abajo (usan fetch, que también tiene Node).

/** La versión de la API de Stripe de Sumied. La única. */
export const STRIPE_VERSION = '2026-06-24.dahlia'

export type EstadoMetodo = 'activo' | 'falta_alta' | 'revisando' | 'sin_alta'

export interface CuentaStripe {
  capabilities?: Record<string, string | undefined> | null
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; disabled_reason?: string | null } | null
  details_submitted?: boolean | null
}

/**
 * El estado de un método (card_payments, bizum_payments) en palabras:
 *   · activo: Stripe lo deja cobrar;
 *   · revisando: lo ha pedido y Stripe lo está mirando (pending, o datos ya
 *     mandados sin nada pendiente);
 *   · falta_alta: al restaurante le falta terminar su alta en Stripe.
 */
export function estadoMetodo(cuenta: CuentaStripe | null, capacidad: string): EstadoMetodo {
  if (!cuenta) return 'sin_alta'
  const c = cuenta.capabilities?.[capacidad]
  if (c === 'active') return 'activo'
  if (c === 'pending') return 'revisando'
  const falta = (cuenta.requirements?.currently_due?.length ?? 0) + (cuenta.requirements?.past_due?.length ?? 0)
  if (falta > 0 || !cuenta.details_submitted) return 'falta_alta'
  return 'revisando'
}

/** Céntimos de un importe en euros (sin errores de coma flotante). */
export const centimos = (euros: number): number => Math.round(Number(euros) * 100)

/** El HMAC-SHA256 en hexadecimal (Web Crypto: Deno y Node 20). */
async function hmac(secreto: string, texto: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto))
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Comparación en tiempo constante de dos cadenas hexadecimales. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/**
 * ¿Es de Stripe este aviso? La cabecera Stripe-Signature («t=…,v1=…») firma
 * «t.cuerpo» con el secreto del punto de aviso. Se rechaza si tiene más de
 * `tolerancia` segundos (para que no se pueda repetir uno viejo).
 */
export async function firmaValida(cuerpo: string, cabecera: string | null, secreto: string, ahora = Math.floor(Date.now() / 1000), tolerancia = 300): Promise<boolean> {
  if (!cabecera || !secreto) return false
  const partes = cabecera.split(',').map((p) => p.trim().split('='))
  const t = Number(partes.find(([k]) => k === 't')?.[1])
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v ?? '')
  if (!Number.isFinite(t) || firmas.length === 0 || Math.abs(ahora - t) > tolerancia) return false
  const esperada = await hmac(secreto, `${t}.${cuerpo}`)
  return firmas.some((f) => iguales(f, esperada))
}

/** ¿La clave es de pruebas? (sk_test_ o rk_test_). En producción con clave real, solo cobra la empresa que Julio pase a real. */
export const clavePrueba = (clave: string): boolean => /^(sk|rk)_test_/.test(clave)

// ── Las llamadas ────────────────────────────────────────────────────────────

const API = 'https://api.stripe.com'

export interface Respuesta { ok: boolean; status: number; datos: any }

/** El mensaje de error de Stripe, tal cual (sus textos no llevan datos de nadie). */
export const errorStripe = (r: Respuesta): string => String(r.datos?.error?.message ?? `HTTP ${r.status}`)

/** Una llamada a la API v1 (formulario), con la versión fija y, si se da, la cuenta conectada. */
export async function v1(clave: string, metodo: 'GET' | 'POST' | 'DELETE', ruta: string, campos: Record<string, string> = {}, cuenta?: string | null): Promise<Respuesta> {
  const headers: Record<string, string> = { Authorization: `Bearer ${clave}`, 'Stripe-Version': STRIPE_VERSION }
  if (cuenta) headers['Stripe-Account'] = cuenta
  let body: string | undefined
  if (metodo === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(campos).toString() }
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers, body, signal: AbortSignal.timeout(25_000) })
  return { ok: r.ok, status: r.status, datos: await r.json().catch(() => null) }
}

/** Una llamada a la API v2 (JSON), con la versión fija. */
export async function v2(clave: string, ruta: string, cuerpo: unknown): Promise<Respuesta> {
  const r = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Stripe-Version': STRIPE_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(25_000),
  })
  return { ok: r.ok, status: r.status, datos: await r.json().catch(() => null) }
}

/** El alta del restaurante (la de la sonda): v2, panel completo, comisiones y pérdidas para Stripe, tarjeta. */
export function cuerpoAlta(d: { correo: string | null; nombre: string }) {
  return {
    ...(d.correo ? { contact_email: d.correo } : {}),
    display_name: d.nombre.slice(0, 100),
    dashboard: 'full',
    identity: { country: 'es' },
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
  }
}

/**
 * El enlace al formulario de alta de Stripe (alojado). Primero el de v2
 * (/v2/core/account_links); si Stripe no lo acepta para esta cuenta, el de v1
 * (/v1/account_links), que también vale para las cuentas de panel completo.
 */
export async function enlaceAlta(clave: string, cuenta: string, vuelta: string, otraVez: string): Promise<{ url: string } | { error: string }> {
  const a = await v2(clave, '/v2/core/account_links', {
    account: cuenta,
    use_case: { type: 'account_onboarding', account_onboarding: { configurations: ['merchant'], return_url: vuelta, refresh_url: otraVez } },
  })
  if (a.ok && typeof a.datos?.url === 'string') return { url: a.datos.url }
  const b = await v1(clave, 'POST', '/v1/account_links', { account: cuenta, type: 'account_onboarding', return_url: vuelta, refresh_url: otraVez })
  if (b.ok && typeof b.datos?.url === 'string') return { url: b.datos.url }
  return { error: `${errorStripe(a)} / ${errorStripe(b)}` }
}

/** Enciende Bizum en las configuraciones de métodos de pago de la cuenta (las que lo dejan cambiar). */
export async function encenderBizum(clave: string, cuenta: string): Promise<{ encendido: boolean; error: string | null }> {
  const l = await v1(clave, 'GET', '/v1/payment_method_configurations', {}, cuenta)
  if (!l.ok) return { encendido: false, error: errorStripe(l) }
  const confs = ((l.datos?.data ?? []) as any[]).filter((c) => c?.active !== false)
  let encendido = confs.some((c) => c?.bizum?.display_preference?.value === 'on')
  let error: string | null = null
  for (const c of confs) {
    if (c?.bizum?.display_preference?.value === 'on' || c?.bizum?.display_preference?.overridable === false) continue
    const r = await v1(clave, 'POST', `/v1/payment_method_configurations/${c.id}`, { 'bizum[display_preference][preference]': 'on' }, cuenta)
    if (r.ok) encendido = true
    else error = errorStripe(r)
  }
  return { encendido, error: encendido ? null : error }
}

/** Lo que hace falta de la base para guardar el estado (el cliente de Supabase con la clave de servicio). */
export interface ConRpc { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }

/**
 * Lee la cuenta en Stripe y guarda su estado: tarjeta y Bizum en palabras, lo
 * que le falta, y Bizum encendido en sus métodos de pago en cuanto esté activo.
 * Si Bizum no se había pedido (o se cayó), lo vuelve a pedir.
 */
export async function refrescar(clave: string, srv: ConRpc, empresa: string, cuenta: string, quien: string | null) {
  const l = await v1(clave, 'GET', `/v1/accounts/${cuenta}`)
  if (!l.ok) return { ok: false as const, error: errorStripe(l) }
  const c = l.datos as CuentaStripe & { capabilities?: Record<string, string> }
  if (!c.capabilities?.bizum_payments || c.capabilities.bizum_payments === 'unrequested') {
    await v1(clave, 'POST', `/v1/accounts/${cuenta}/capabilities/bizum_payments`, { requested: 'true' })
  }
  const tarjeta = estadoMetodo(c, 'card_payments') as Exclude<EstadoMetodo, 'sin_alta'>
  const bizum = estadoMetodo(c, 'bizum_payments') as Exclude<EstadoMetodo, 'sin_alta'>
  let encendido: boolean | null = null
  let errorBizum: string | null = null
  if (bizum === 'activo') { const e = await encenderBizum(clave, cuenta); encendido = e.encendido; errorBizum = e.error }
  const pendiente = (c.requirements?.currently_due?.length ?? 0) + (c.requirements?.past_due?.length ?? 0)
  const { data, error } = await srv.rpc('conta_cobro_stripe_apuntar', {
    p_company: empresa, p_stripe: cuenta, p_tarjeta: tarjeta, p_bizum: bizum, p_bizum_encendido: encendido, p_pendiente: pendiente, p_quien: quien,
  })
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, estado: data as Record<string, unknown>, errorBizum }
}

/** «Tarjeta: activo. Bizum: falta tu alta en Stripe.» — lo que dice la pantalla después de mirar. */
export function fraseEstado(tarjeta: string, bizum: string): string {
  const t = (e: string) => (e === 'activo' ? 'activo' : e === 'revisando' ? 'Stripe lo está revisando' : 'falta terminar tu alta en Stripe')
  return `Tarjeta: ${t(tarjeta)}. Bizum: ${t(bizum)}.`
}
