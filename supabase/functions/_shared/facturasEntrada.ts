// supabase/functions/_shared/facturasEntrada.ts
//
// D01 · Tarea 4 · EL CORREO DE FACTURAS DE CADA EMPRESA. Núcleo sin red ni base
// propias: lo de fuera entra por el puerto (la edge function
// conta-facturas-entrada pone Supabase, Resend y la lectura; las pruebas,
// dobles).
//
// Cómo llega (R1, punto 3): cada empresa tiene facturas-<empresa>@entrada.folvy.app
// y se le reenvían las facturas desde cualquiera de sus buzones. Resend recibe
// el correo y llama al webhook (evento email.received), firmado con svix.
//
// Lo que se hace, y por qué así:
//   1. La firma se comprueba (svix: HMAC-SHA256 de «id.timestamp.cuerpo» con el
//      secreto del webhook) y el sello de tiempo no puede tener más de 5
//      minutos: un correo falso o repetido por otro no entra.
//   2. Se miran TODOS los destinatarios (to, cc y bcc), no solo el primero: un
//      reenvío puede dejar la dirección de entrada en copia. Si no está en
//      ninguno, el sobre (lo que traiga Resend en el evento o al pedir el
//      correo entero): un reenvío automático de Gmail conserva el To: original.
//      Y si tampoco, se apunta igual, «sin destino»: ningún correo que llega se
//      pierde sin rastro (Julio, 16/10).
//   3. Si la dirección no es de ninguna empresa, o está apagada, se apunta en
//      el registro de entrada y se contesta 200: nada se pierde sin rastro y
//      Resend no reintenta.
//   4. De los adjuntos se toman los PDF y las fotos (jpeg, png, webp); lo demás
//      se dice por qué no. Si el correo no trae ninguno pero sí un enlace de
//      descarga, se guarda «Falta el PDF: el correo trae un enlace», para
//      bajarlo a mano.
//   5. Cada fichero se sube al bucket receipt-uploads de su cuenta, con su
//      huella (sha256): el mismo PDF dos veces se reconoce en la base.
//   6. Se registra en la bandeja (document_inbox) y se lee con el modo factura
//      de ocr-albaran; de la lectura sale la factura (o la repetida).
//   7. Nunca dos veces: el mismo correo (email_id) no se procesa dos veces.
//
// LIQUIDACIONES (D01 · T2, 15/10). La misma función recibe también lo que llega a
// liquidaciones-<empresa>@…: la base dice de qué clase es cada dirección
// (conta_entrada_destino) y aquí se enruta. Un resumen de pagos de Uber Eats se
// lee con _shared/liquidacionUber.ts (puro) y va a conta_liquidacion_registrar:
// la liquidación y su factura de comisión. El resumen del mes (el PDF
// monthly_statement_*.pdf) se guarda con ella. Lo que no es un resumen se
// apunta y se dice. Y en las dos clases, el correo con el que Gmail pide
// confirmar un reenvío se apunta con su código, para enseñarlo.
//
// FACTURAS DE LOS PROVEEDORES (D01, 16/10). Cada proveedor reenvía desde su
// buzón a facturas-<empresa>@. Dos cosas más:
//   · La confirmación del reenvío también se apunta con su ENLACE: hay buzones
//     (los de Google Workspace) en los que se confirma con el enlace y no con
//     el código. Solo enlaces de Google (mail.google.com, mail-settings…).
//   · Un remitente que la base sabe que no manda facturas (los justificantes
//     de entrega de un proveedor, por ejemplo) no se lee como factura: se
//     apunta y se dice por qué (conta_entrada_remitente; la dirección va por
//     su huella).

//
// LA PUERTA (V02 · Entrega 1, 25/10). Cada empresa tiene además UNA dirección
// para cualquier documento, sin prefijo: <empresa>@entrada.folvy.app (y, cuando
// Julio dé de alta el dominio, <empresa>@entrada.sumied.com). La base la sabe
// de clase «documentos» y aquí se lleva cada cosa a su sitio por los caminos
// de siempre (recibirDocumentos):
//   · un resumen de pagos de Uber Eats → la liquidación, como en liquidaciones-;
//   · un remitente que no manda facturas → se apunta y no se lee, como siempre;
//   · una nómina (porque su remitente se aprendió en «Dime qué es» o porque su
//     nombre lo dice) → Laboral, por el mismo camino que el buzón de nóminas
//     (employee-documents y payroll-extract);
//   · un PDF o una foto → la bandeja y la lectura de facturas, y se apunta qué
//     es: si la lectura dice que no es una factura, queda sin saber
//     («Necesita que lo mires»);
//   · un extracto, un Excel, un CSV, un zip o un XML → al almacén conta-entrada,
//     con lo que su nombre dice que es (un zip de Catcher, la quincena de
//     riders) o sin saber.

import { esResumenUber, leerResumenUber, NoEsResumenUber, paraRegistrar, trozos, type ResumenUber } from './liquidacionUber.ts'
import { esLiquidacionJustEat, leerLiquidacionJustEat, paraRegistrarJustEat } from './liquidacionJustEat.ts'
import { esExcelGlovo, leerExcelGlovo, paraRegistrarGlovo } from './lectorGlovo.ts'
import { queDiceElContenido, queDiceElNombre, type QueEs } from './queEs.ts'

export { queDiceElContenido, queDiceElNombre, type QueEs }

export const DOMINIO_ENTRADA = 'entrada.folvy.app'
export const DIRECCION = /^((?:facturas|liquidaciones)-[a-z0-9][a-z0-9-]{1,40})@([a-z0-9.-]+)$/
/** La dirección única de la puerta: sin prefijo, y solo en un dominio de entrada (entrada.folvy.app, entrada.sumied.com…). */
export const DIRECCION_UNICA = /^([a-z0-9][a-z0-9-]{1,40})@(entrada\.[a-z0-9.-]+)$/
/** Lo que la puerta guarda aunque no se lea: hojas, extractos, zips y XML (al almacén conta-entrada). */
export const BUCKET_ENTRADA = 'conta-entrada'
export const TIPOS_ADMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_BYTES = 10 * 1024 * 1024 // el límite del bucket receipt-uploads
const TOLERANCIA_FIRMA_S = 5 * 60

// ── La firma de svix ────────────────────────────────────────────────────────

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const deB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

/** La firma de svix de un cuerpo, como la calcula Resend («v1,<base64>»). */
export async function firmaSvix(secreto: string, id: string, timestamp: string, cuerpo: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', deB64(secreto.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`${id}.${timestamp}.${cuerpo}`))
  return `v1,${b64(mac)}`
}

/** ¿Es de Resend y es de ahora? Devuelve el porqué si no. */
export async function comprobarFirma(secreto: string, cab: { id: string | null; timestamp: string | null; firma: string | null }, cuerpo: string, ahoraS: number): Promise<string | null> {
  if (!cab.id || !cab.timestamp || !cab.firma) return 'faltan las cabeceras de la firma'
  const t = Number(cab.timestamp)
  if (!Number.isFinite(t) || Math.abs(ahoraS - t) > TOLERANCIA_FIRMA_S) return 'el sello de tiempo no es de ahora'
  const esperada = (await firmaSvix(secreto, cab.id, cab.timestamp, cuerpo)).slice(3)
  const dadas = cab.firma.split(' ').map((x) => x.split(',')).filter(([v]) => v === 'v1').map(([, f]) => f)
  // Comparación en tiempo constante.
  const igual = (a: string, b: string) => a.length === b.length && [...a].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0
  return dadas.some((f) => igual(f, esperada)) ? null : 'la firma no es la de Resend'
}

// ── El correo ──────────────────────────────────────────────────────────────

export type CorreoResend = {
  email_id: string
  from?: string | null
  to?: string[] | null
  cc?: string[] | null
  bcc?: string[] | null
  subject?: string | null
  created_at?: string | null
  text?: string | null
  html?: string | null
}
export type AdjuntoResend = { id: string; filename?: string | null; content_type?: string | null; size?: number | null; download_url?: string | null }

type Direccion = { localPart: string; dominio: string; direccion: string }

/** De una lista de destinatarios («Nombre <a@b>», «a@b» o varias separadas por comas o espacios), las de entrada. */
function deEntrada(xs: readonly string[]): Direccion[] {
  const todas = xs.flatMap((x) => x.split(/[\s,;]+/)).map((d) => (d.match(/<([^>]+)>/)?.[1] ?? d).replace(/^<|>$/g, '').trim().toLowerCase())
  const vistas = new Set<string>()
  const out: Direccion[] = []
  for (const d of todas) {
    const m = d.match(DIRECCION) ?? d.match(DIRECCION_UNICA)
    if (!m || vistas.has(d)) continue
    vistas.add(d)
    out.push({ localPart: m[1], dominio: m[2], direccion: d })
  }
  return out
}

/** Las direcciones de entrada que trae el correo en sus destinatarios (to, cc y bcc), sin repetir, en minúsculas. */
export function direccionesDeFacturas(c: Pick<CorreoResend, 'to' | 'cc' | 'bcc'>): Direccion[] {
  return deEntrada([...(c.to ?? []), ...(c.cc ?? []), ...(c.bcc ?? [])])
}

/**
 * Lo que dice el SOBRE, cuando el To: no es el nuestro. Un reenvío automático
 * de Gmail conserva el To: original (el buzón de quien reenvía) y la dirección
 * de entrada solo va en el sobre: lo que se lee aquí es lo que Resend traiga de
 * él, sea en el evento o al pedir el correo entero. Ninguno de estos nombres es
 * obligatorio: si no viene ninguno, no se inventa un destino (y el correo queda
 * apuntado igual, ver recibirCorreo).
 */
export type Sobre = {
  envelope?: { to?: string[] | string | null } | null
  delivered_to?: string[] | string | null
  headers?: Record<string, string | string[]> | { name: string; value: string }[] | null
}
const CABECERAS_SOBRE = ['delivered-to', 'x-original-to', 'x-forwarded-to', 'x-forwarded-for', 'envelope-to', 'x-envelope-to']
export function destinatariosDelSobre(s: Sobre | null | undefined): Direccion[] {
  if (!s) return []
  const lista = (v: string[] | string | null | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v])
  const cab: string[] = []
  const h = s.headers
  if (Array.isArray(h)) for (const x of h) { if (CABECERAS_SOBRE.includes(String(x.name).toLowerCase())) cab.push(String(x.value)) }
  else if (h) for (const [k, v] of Object.entries(h)) { if (CABECERAS_SOBRE.includes(k.toLowerCase())) cab.push(...lista(v)) }
  return deEntrada([...lista(s.envelope?.to), ...lista(s.delivered_to), ...cab])
}

/** Un nombre de fichero que se puede guardar: sin rutas, sin signos raros, con su extensión. */
export function nombreSeguro(nombre: string | null | undefined, tipo: string | null | undefined): string {
  const ext = tipo === 'application/pdf' ? 'pdf' : tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'
  const base = (nombre ?? 'documento').split(/[\\/]/).pop()!.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'documento'
  return `${base}.${ext}`
}

const tipoDe = (a: AdjuntoResend): string | null => {
  const t = (a.content_type ?? '').toLowerCase().split(';')[0].trim()
  if ((TIPOS_ADMITIDOS as readonly string[]).includes(t)) return t === 'image/jpg' ? 'image/jpeg' : t
  const n = (a.filename ?? '').toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (/\.(jpe?g)$/.test(n)) return 'image/jpeg'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  return null
}

export type Clasificados = { tomar: (AdjuntoResend & { tipo: string; nombre: string })[]; dejar: { nombre: string; porque: string }[] }

/** Qué adjuntos se toman (PDF y fotos) y cuáles no, con su porqué. */
export function clasificarAdjuntos(xs: readonly AdjuntoResend[]): Clasificados {
  const tomar: Clasificados['tomar'] = []
  const dejar: Clasificados['dejar'] = []
  for (const a of xs) {
    const tipo = tipoDe(a)
    const nombre = a.filename ?? 'sin nombre'
    if (!tipo) { dejar.push({ nombre, porque: 'no es un PDF ni una foto' }); continue }
    if ((a.size ?? 0) > MAX_BYTES) { dejar.push({ nombre, porque: 'pasa de 10 MB' }); continue }
    // Los logos e imágenes pequeñas de una firma de correo no son facturas.
    if (tipo !== 'application/pdf' && (a.size ?? Infinity) < 15_000) { dejar.push({ nombre, porque: 'es una imagen pequeña (la firma o el logo del correo)' }); continue }
    tomar.push({ ...a, tipo, nombre: nombreSeguro(a.filename, tipo) })
  }
  return { tomar, dejar }
}

/**
 * Los enlaces que parecen de descarga de una factura, del texto o el HTML del
 * correo. Solo https, y solo los que lo dicen (factura, invoice, descargar,
 * download o .pdf): no se sigue ninguno, se guardan para bajarlos a mano.
 */
export function enlacesDeFactura(c: Pick<CorreoResend, 'text' | 'html'>): string[] {
  const t = `${c.text ?? ''}\n${c.html ?? ''}`
  const urls = [...t.matchAll(/https:\/\/[^\s"'<>)\]]+/gi)].map((m) => m[0].replace(/[.,;]+$/, '').replace(/&amp;/g, '&'))
  return [...new Set(urls.filter((u) => /factura|invoice|descarg|download|\.pdf(\?|$)/i.test(u)))].slice(0, 5)
}

export const rutaEntrada = (accountId: string, emailId: string, i: number, nombre: string) =>
  `${accountId}/_correo/${emailId.replace(/[^A-Za-z0-9-]/g, '')}/${String(i + 1).padStart(2, '0')}-${nombre}`

// ── El orquestador ─────────────────────────────────────────────────────────

export type ClaseDireccion = 'facturas' | 'liquidaciones' | 'documentos'
export type Destino = { companyId: string; accountId: string; activa: boolean; tipo?: ClaseDireccion }
export type DatosLiquidacion = ReturnType<typeof paraRegistrar> | ReturnType<typeof paraRegistrarJustEat>
export interface PuertoEntrada {
  /** La empresa de una dirección de facturas, o null. */
  destino(localPart: string, dominio: string): Promise<Destino | null>
  /** ¿Ya se procesó este correo? */
  yaVisto(emailId: string): Promise<boolean>
  /** Apunta el correo en el registro de entrada (también el que no es de nadie). */
  registrarCorreo(r: { emailId: string; to: string; from: string | null; subject: string | null; companyId: string | null; resultado: string; detalle: unknown; porSobre?: boolean }): Promise<void>
  adjuntos(emailId: string): Promise<AdjuntoResend[]>
  bajar(url: string): Promise<Uint8Array>
  subir(ruta: string, bytes: Uint8Array, tipo: string): Promise<void>
  sha256(b: Uint8Array): Promise<string>
  /** Registra la llegada en la bandeja; devuelve su id, o el de la que ya estaba con la misma huella. */
  llegada(x: { accountId: string; companyId: string; emailId: string; to: string; from: string | null; subject: string | null; recibido: string | null; ruta: string | null; nombre: string | null; tipo: string | null; bytes: number | null; sha256: string | null; enlace: string | null }): Promise<{ id: string; yaEstaba: boolean }>
  /** Lee la llegada (ocr-albaran, modo factura) y saca de ella la factura. */
  leer(inboxId: string): Promise<{ estado: string; texto: string }>
  /** El correo entero según Resend (sus destinatarios y cabeceras), para buscar el sobre si el evento no lo trae. */
  correoEntero?(emailId: string): Promise<(Sobre & Pick<CorreoResend, 'to' | 'cc' | 'bcc'>) | null>
  /** El cuerpo del correo (Resend no lo manda en el webhook). */
  cuerpo?(emailId: string): Promise<{ html: string | null; text: string | null }>
  /** Registra un resumen leído (conta_liquidacion_registrar). */
  liquidacion?(x: { companyId: string; datos: DatosLiquidacion }): Promise<{ id: string; yaEstaba: boolean; texto: string; factura: string | null }>
  /** Lo que la base sabe del remitente para esa empresa (conta_entrada_remitente), o null. «tipo»: lo que manda, aprendido en «Dime qué es». */
  remitente?(companyId: string, from: string): Promise<{ decision: 'no_facturas' | 'tipo'; motivo: string; tipo?: QueEs | null } | null>
  /** S01j · Las filas de la primera hoja de un Excel, como objetos por su cabecera (el Excel de Glovo). */
  hoja?(bytes: Uint8Array): Promise<Record<string, unknown>[]>
  /** S01j · La factura de comisión que viene escrita en el correo (Just Eat), como recibida: conta_comision_del_correo. */
  facturaComision?(x: { settlementId: string; datos: DatosLiquidacion; emailId: string }): Promise<{ id: string | null; estado: string; texto: string }>
  /** La puerta: sube a otro almacén (conta-entrada) lo que no es un PDF ni una foto. */
  subirA?(bucket: string, ruta: string, bytes: Uint8Array, tipo: string): Promise<void>
  /** La puerta: apunta en la bandeja qué es (y por quién lo sabe) y, si va en otro almacén, cuál. */
  colocar?(inboxId: string, x: { tipo: QueEs | null; por: 'regla' | 'lectura'; bucket?: string }): Promise<void>
  /** La puerta: una nómina, por el camino del buzón de nóminas (employee-documents y payroll-extract). */
  nomina?(x: { accountId: string; emailId: string; nombre: string; bytes: Uint8Array }): Promise<{ ok: boolean; texto: string }>
}

export type ResultadoEntrada = {
  resultado: 'ignorado' | 'sin_destino' | 'apagada' | 'repetido' | 'recibido' | 'liquidacion' | 'confirmacion' | 'no_es_liquidacion' | 'no_es_factura' | 'documentos'
  texto: string
  llegadas: { id: string; estado: string; texto: string }[]
}

/** ¿Es el correo con el que Gmail pide confirmar un reenvío? */
export function esConfirmacionDeReenvio(c: Pick<CorreoResend, 'from' | 'subject'>): boolean {
  return /forwarding-noreply@google\.com/.test((c.from ?? '').toLowerCase()) || /(confirmaci[oó]n de reenv[ií]o|forwarding confirmation)/i.test(c.subject ?? '')
}

/** El enlace de confirmación de Gmail (solo de Google: mail.google.com o mail-settings.google.com, con «/mail/vf-»). */
const ENLACE_CONFIRMACION = /https:\/\/(?:[a-z0-9-]+\.)*?(?:mail-settings\.google\.com|mail\.google\.com)\/mail\/(?:u\/\d+\/)?vf-[^\s"'<>]+/i

/**
 * El correo con el que Gmail pide confirmar un reenvío: su código y su enlace
 * (para enseñarlos: unos buzones se confirman escribiendo el código y otros,
 * los de Google Workspace, abriendo el enlace). null si no lo es o no trae ni uno ni otro.
 */
export function confirmacionDeReenvio(c: Pick<CorreoResend, 'from' | 'subject' | 'text' | 'html'>): { codigo: string | null; enlace: string | null } | null {
  if (!esConfirmacionDeReenvio(c)) return null
  const asunto = c.subject ?? ''
  const cuerpo = `${c.text ?? ''} ${(c.html ?? '').replace(/&amp;/g, '&')}`
  const codigo = asunto.match(/#(\d{6,12})/)?.[1] ?? `${c.text ?? ''} ${(c.html ?? '').replace(/<[^>]+>/g, ' ')}`.match(/(?:c[oó]digo de confirmaci[oó]n|confirmation code)\D{0,20}(\d{6,12})/i)?.[1] ?? null
  const enlace = cuerpo.match(ENLACE_CONFIRMACION)?.[0].replace(/[.,;]+$/, '') ?? null
  return codigo || enlace ? { codigo, enlace } : null
}

/** Lo que se dice de una confirmación: el código, el enlace o los dos. */
export function textoConfirmacion(direccion: string, x: { codigo: string | null; enlace: string | null }): string {
  if (x.codigo && !x.enlace) return `Gmail pide confirmar el reenvío a ${direccion}: el código es ${x.codigo}. Escríbelo en Gmail.`
  if (!x.codigo) return `Gmail pide confirmar el reenvío a ${direccion}: se confirma abriendo el enlace del correo (queda apuntado en el registro de entrada).`
  return `Gmail pide confirmar el reenvío a ${direccion}: el código es ${x.codigo}, o abre el enlace del correo (los dos quedan apuntados en el registro de entrada).`
}

/** El resumen mensual que Uber adjunta al primero del mes (monthly_statement_<Mes>_<Año>.pdf). */
export const esResumenMensual = (a: Pick<AdjuntoResend, 'filename' | 'content_type'>) =>
  /^monthly_statement_[a-z]+_\d{4}\.pdf$/i.test(a.filename ?? '') || (/monthly_statement/i.test(a.filename ?? '') && /pdf/i.test(a.content_type ?? ''))
export const rutaLiquidacion = (accountId: string, emailId: string, nombre: string) =>
  `${accountId}/_liquidaciones/${emailId.replace(/[^A-Za-z0-9-]/g, '')}/${nombre}`

export async function recibirCorreo(c: CorreoResend & Sobre, p: PuertoEntrada): Promise<ResultadoEntrada> {
  if (await p.yaVisto(c.email_id)) return { resultado: 'repetido', texto: 'Este correo ya se recibió: no se procesa dos veces.', llegadas: [] }
  // Primero los destinatarios; si ninguna es de una empresa, el sobre del
  // evento; y si tampoco, el correo entero según Resend (Julio, 16/10: que no
  // se pierda ninguno; un reenvío de Gmail conserva el To: original). Desde la
  // puerta (V02) cualquier <algo>@entrada.… es candidata, y manda la base: por
  // eso se sigue buscando aunque los destinatarios traigan una que no es de nadie.
  const vistas: Direccion[] = []
  let destino: (Destino & { direccion: string }) | null = null
  let porSobre = false
  const resolver = async (xs: Direccion[], sobre: boolean) => {
    for (const d of xs) {
      if (vistas.some((v) => v.direccion === d.direccion)) continue
      vistas.push(d)
      const x = await p.destino(d.localPart, d.dominio)
      if (x) { destino = { ...x, direccion: d.direccion }; porSobre = sobre; return }
    }
  }
  await resolver(direccionesDeFacturas(c), false)
  if (!destino) await resolver(destinatariosDelSobre(c), true)
  if (!destino && p.correoEntero) {
    const e = await p.correoEntero(c.email_id).catch(() => null)
    if (e) await resolver([...direccionesDeFacturas(e), ...destinatariosDelSobre(e)], true)
  }
  if (!vistas.length) {
    // Antes se contestaba «ignorado» sin apuntar nada: un correo así se perdía sin rastro.
    const destinatarios = [...(c.to ?? []), ...(c.cc ?? []), ...(c.bcc ?? [])]
    await p.registrarCorreo({ emailId: c.email_id, to: destinatarios[0] ?? '', from: c.from ?? null, subject: c.subject ?? null, companyId: null, resultado: 'sin_destino',
      detalle: { motivo: 'ninguna dirección de entrada en sus destinatarios ni en el sobre', destinatarios: destinatarios.length } })
    return { resultado: 'sin_destino', texto: 'El correo no lleva ninguna dirección de entrada (ni en sus destinatarios ni en el sobre): queda apuntado y no se lee.', llegadas: [] }
  }
  const d0 = destino as (Destino & { direccion: string }) | null
  const base = { emailId: c.email_id, to: d0?.direccion ?? vistas[0].direccion, from: c.from ?? null, subject: c.subject ?? null, ...(porSobre ? { porSobre: true } : {}) }
  if (!d0) {
    await p.registrarCorreo({ ...base, companyId: null, resultado: 'sin_destino', detalle: { direcciones: vistas.map((d) => d.direccion) } })
    return { resultado: 'sin_destino', texto: `${vistas[0].direccion} no es la dirección de ninguna empresa: queda apuntado y no se lee.`, llegadas: [] }
  }
  const dest = d0
  if (!dest.activa) {
    await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: 'apagada', detalle: {} })
    return { resultado: 'apagada', texto: `La dirección ${dest.direccion} está apagada: queda apuntado y no se lee.`, llegadas: [] }
  }

  // Gmail pide confirmar el reenvío (en las dos clases): se apunta con su
  // código y su enlace. El enlace va en el cuerpo, que el webhook no trae: se pide.
  if (esConfirmacionDeReenvio(c)) {
    let conf = confirmacionDeReenvio(c)
    if (!conf?.enlace && !c.text && !c.html && p.cuerpo) {
      const b = await p.cuerpo(c.email_id).catch(() => null)
      if (b) conf = confirmacionDeReenvio({ ...c, text: b.text, html: b.html }) ?? conf
    }
    if (conf) {
      await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: 'confirmacion', detalle: { codigo: conf.codigo, enlace: conf.enlace } })
      return { resultado: 'confirmacion', texto: textoConfirmacion(dest.direccion, conf), llegadas: [] }
    }
  }
  if (dest.tipo === 'liquidaciones') return recibirLiquidacion(c, { ...dest }, base, p)
  if (dest.tipo === 'documentos') return recibirDocumentos(c, { ...dest }, base, p)

  // S01j · Just Eat manda la liquidación y su factura de comisión escritas en el cuerpo, sin
  // adjuntos: aunque llegue a la dirección de facturas, se lee como en la de liquidaciones.
  if (pareceDeJustEat(c) && p.liquidacion) {
    const cuerpo = c.html || c.text ? { html: c.html ?? null, text: c.text ?? null } : p.cuerpo ? await p.cuerpo(c.email_id) : null
    if (cuerpo && esLiquidacionJustEat({ from: c.from, subject: c.subject }, trozos(cuerpo))) return recibirLiquidacion(c, { ...dest }, base, p, cuerpo)
  }

  // Un remitente que no manda facturas (sus justificantes, por ejemplo): se apunta y no se lee.
  const quien = c.from && p.remitente ? await p.remitente(dest.companyId, c.from) : null
  if (quien?.decision === 'no_facturas') {
    await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: 'sin_facturas', detalle: { motivo: 'remitente_no_facturas' } })
    return { resultado: 'no_es_factura', texto: `No se lee como factura: ${quien.motivo.replace(/\.$/, '')}. Queda apuntado en el registro de entrada.`, llegadas: [] }
  }

  const todos = await p.adjuntos(c.email_id)
  const { tomar, dejar } = clasificarAdjuntos(todos)
  const llegadas: ResultadoEntrada['llegadas'] = []
  const comun = { accountId: dest.accountId, companyId: dest.companyId, emailId: c.email_id, to: dest.direccion, from: c.from ?? null, subject: c.subject ?? null, recibido: c.created_at ?? null }

  for (const [i, a] of tomar.entries()) {
    if (!a.download_url) { dejar.push({ nombre: a.nombre, porque: 'Resend no da su enlace de descarga' }); continue }
    const bytes = await p.bajar(a.download_url)
    if (bytes.length > MAX_BYTES) { dejar.push({ nombre: a.nombre, porque: 'pasa de 10 MB' }); continue }
    const ruta = rutaEntrada(dest.accountId, c.email_id, i, a.nombre)
    const sha = await p.sha256(bytes)
    await p.subir(ruta, bytes, a.tipo)
    const l = await p.llegada({ ...comun, ruta, nombre: a.nombre, tipo: a.tipo, bytes: bytes.length, sha256: sha, enlace: null })
    if (l.yaEstaba) { llegadas.push({ id: l.id, estado: 'repetido', texto: `${a.nombre}: ya estaba (el mismo fichero llegó antes).` }); continue }
    const r = await p.leer(l.id)
    llegadas.push({ id: l.id, ...r })
  }
  // S01j · El Excel de Glovo («invoice-<n>.XLSX») que viene con su factura: es su liquidación.
  // Se lee con el mismo lector que el Excel subido a mano (la misma clave: no se duplica).
  const liquidaciones = await excelesDeGlovo(c, dest, todos, dejar, p)
  // Sin ningún fichero útil, pero con un enlace de descarga: «Falta el PDF».
  if (!llegadas.length && !liquidaciones.length) {
    for (const enlace of enlacesDeFactura(c)) {
      const l = await p.llegada({ ...comun, ruta: null, nombre: null, tipo: null, bytes: null, sha256: null, enlace })
      llegadas.push({ id: l.id, estado: 'falta_pdf', texto: 'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.' })
    }
  }
  await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: llegadas.length || liquidaciones.length ? 'recibido' : 'sin_facturas',
    detalle: { tomados: llegadas.length, dejados: dejar, ...(liquidaciones.length ? { liquidaciones: liquidaciones.map((l) => ({ id: l.id, ya_estaba: l.yaEstaba, plataforma: 'glovo' })) } : {}) } })
  const deLiq = liquidaciones.length ? `; ${liquidaciones.map((l) => l.texto.replace(/\.$/, '')).join('; ')}` : ''
  const texto = llegadas.length || liquidaciones.length
    ? `${llegadas.length} ${llegadas.length === 1 ? 'documento recibido' : 'documentos recibidos'}${deLiq}${dejar.length ? `; ${dejar.length} sin tomar (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''}.`
    : `El correo no trae ninguna factura${dejar.length ? ` (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''} ni un enlace para bajarla.`
  return { resultado: 'recibido', texto, llegadas }
}

/** ¿Puede ser un correo de Glovo? (S01j: su Excel solo se mira si lo es.) */
const pareceDeGlovo = (c: Pick<CorreoResend, 'from' | 'subject'>) => /glovo/i.test(`${c.from ?? ''} ${c.subject ?? ''}`)

/**
 * S01j · El Excel de Glovo de un correo, a su liquidación. Lo que no es un Excel
 * de Glovo, o no se puede leer, se queda en «dejados» con su porqué (no se pierde).
 */
export async function excelesDeGlovo(c: CorreoResend, dest: Destino, todos: readonly AdjuntoResend[], dejar: { nombre: string; porque: string }[], p: PuertoEntrada):
  Promise<{ id: string; yaEstaba: boolean; texto: string }[]> {
  const hechas: { id: string; yaEstaba: boolean; texto: string }[] = []
  if (!p.hoja || !p.liquidacion || !pareceDeGlovo(c)) return hechas
  for (const d of [...dejar]) {
    if (d.porque !== 'no es un PDF ni una foto' || !/\.xlsx?$/i.test(d.nombre)) continue
    const a = todos.find((x) => (x.filename ?? 'sin nombre') === d.nombre)
    if (!a?.download_url) continue
    const i = dejar.indexOf(d)
    try {
      const bytes = await p.bajar(a.download_url)
      if (bytes.length > MAX_BYTES) { dejar[i] = { nombre: d.nombre, porque: 'pasa de 10 MB' }; continue }
      const filas = await p.hoja(bytes)
      if (!esExcelGlovo(filas)) { dejar[i] = { nombre: d.nombre, porque: 'es un Excel, pero no el de la liquidación de Glovo' }; continue }
      for (const ex of leerExcelGlovo(filas)) {
        const r = await p.liquidacion({ companyId: dest.companyId, datos: { ...paraRegistrarGlovo({ excel: ex }), email_id: c.email_id } })
        hechas.push({ id: r.id, yaEstaba: r.yaEstaba, texto: r.texto })
      }
      dejar.splice(i, 1)
    } catch (x) {
      dejar[i] = { nombre: d.nombre, porque: `el Excel de Glovo no se ha podido leer: ${x instanceof Error ? x.message : String(x)}` }
    }
  }
  return hechas
}

// ── Las liquidaciones ────────────────────────────────────────────────────────

async function recibirLiquidacion(c: CorreoResend, destino: Destino & { direccion: string },
  base: { emailId: string; to: string; from: string | null; subject: string | null }, p: PuertoEntrada,
  cuerpoYa?: { html: string | null; text: string | null }): Promise<ResultadoEntrada> {
  if (!p.liquidacion) throw new Error('La función no sabe registrar liquidaciones.')
  const cuerpo = cuerpoYa ?? (c.html || c.text ? { html: c.html ?? null, text: c.text ?? null } : p.cuerpo ? await p.cuerpo(c.email_id) : { html: null, text: null })
  // V02 · E2: una liquidación de Just Eat (factura, estado de cuenta y pedidos en el correo).
  if (esLiquidacionJustEat({ from: c.from, subject: c.subject }, trozos(cuerpo))) {
    const je = leerLiquidacionJustEat({ from: c.from, subject: c.subject, html: cuerpo.html, text: cuerpo.text })
    const datos = paraRegistrarJustEat(je, { emailId: c.email_id })
    // Si su factura no suma, la liquidación entra igual (sin factura: conta_liquidacion_registrar
    // pararía) y la factura va aparte, en revisión con el porqué. No se inventa nada.
    const cuadra = Math.round(je.factura.base * 100) + Math.round(je.factura.iva * 100) === Math.round(je.factura.total * 100)
    const r = await p.liquidacion({ companyId: destino.companyId, datos: cuadra ? datos : { ...datos, factura: null } })
    // S01j · Su factura de comisión, como recibida (con su número): la liga el S01i. Si no suma, en revisión con el porqué.
    const f = p.facturaComision ? await p.facturaComision({ settlementId: r.id, datos, emailId: c.email_id }) : null
    await p.registrarCorreo({ ...base, companyId: destino.companyId, resultado: 'liquidacion',
      detalle: { liquidacion_id: r.id, ya_estaba: r.yaEstaba, factura: r.factura, avisos: je.avisos.length, plataforma: 'justeat',
                 ...(f ? { factura_id: f.id, factura_estado: f.estado } : {}) } })
    const texto = cuadra ? r.texto : `La liquidación de Just Eat del ${je.desde.slice(8, 10)}/${je.desde.slice(5, 7)} al ${je.hasta.slice(8, 10)}/${je.hasta.slice(5, 7)} ha entrado.`
    return { resultado: 'liquidacion', texto: f ? `${texto} ${f.texto}` : texto, llegadas: [] }
  }
  let resumen: ResumenUber
  try {
    resumen = leerResumenUber({ subject: c.subject, html: cuerpo.html, text: cuerpo.text })
  } catch (x) {
    if (!(x instanceof NoEsResumenUber)) throw x
    await p.registrarCorreo({ ...base, companyId: destino.companyId, resultado: 'no_es_liquidacion', detalle: { motivo: x.message } })
    return { resultado: 'no_es_liquidacion', texto: `${x.message} Queda apuntado y no se lee: por ahora se leen los resúmenes de pagos de Uber Eats y las liquidaciones de Just Eat.`, llegadas: [] }
  }
  // El resumen del mes, si viene: se guarda con la liquidación.
  let adjunto: { ruta: string; nombre: string; sha256: string } | null = null
  const mensual = (await p.adjuntos(c.email_id)).find((a) => esResumenMensual(a) && a.download_url && (a.size ?? 0) <= MAX_BYTES)
  if (mensual?.download_url) {
    const nombre = nombreSeguro(mensual.filename, 'application/pdf')
    const bytes = await p.bajar(mensual.download_url)
    if (bytes.length <= MAX_BYTES) {
      const ruta = rutaLiquidacion(destino.accountId, c.email_id, nombre)
      await p.subir(ruta, bytes, 'application/pdf')
      adjunto = { ruta, nombre, sha256: await p.sha256(bytes) }
    }
  }
  const r = await p.liquidacion({ companyId: destino.companyId, datos: paraRegistrar(resumen, { emailId: c.email_id, adjunto }) })
  // Al registro, solo ids, recuentos y estados: nunca importes ni nombres.
  await p.registrarCorreo({ ...base, companyId: destino.companyId, resultado: 'liquidacion',
    detalle: { liquidacion_id: r.id, ya_estaba: r.yaEstaba, factura: r.factura, avisos: resumen.avisos.length, mensual: !!adjunto } })
  return { resultado: 'liquidacion', texto: r.texto, llegadas: [] }
}

// ── La puerta: <empresa>@entrada.… (V02) ─────────────────────────────────────

/** Lo que se guarda sin leer: hojas, CSV, extractos (Norma 43, OFX), zips y XML. */
const GUARDABLES: { ext: RegExp; tipo: string }[] = [
  { ext: /\.csv$/i, tipo: 'text/csv' },
  { ext: /\.xlsx$/i, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { ext: /\.xls$/i, tipo: 'application/vnd.ms-excel' },
  { ext: /\.zip$/i, tipo: 'application/zip' },
  { ext: /\.(xml|xsig)$/i, tipo: 'application/xml' },
  { ext: /\.(n43|q43|c43|aeb|txt|ofx|qif)$/i, tipo: 'text/plain' },
]
const TIPOS_GUARDABLES: Record<string, string> = {
  'text/csv': 'text/csv', 'application/vnd.ms-excel': 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip': 'application/zip', 'application/x-zip-compressed': 'application/zip', 'application/xml': 'application/xml', 'text/xml': 'application/xml',
  'text/plain': 'text/plain',
}

export type ClasificadosPuerta = {
  leer: (AdjuntoResend & { tipo: string; nombre: string })[]
  guardar: (AdjuntoResend & { tipo: string; nombre: string })[]
  dejar: { nombre: string; porque: string }[]
}

/** Un nombre seguro que conserva su extensión (para lo que se guarda sin leer). */
export function nombreSeguroCon(nombre: string | null | undefined): string {
  const limpio = (nombre ?? 'documento').split(/[\\/]/).pop()!.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const ext = limpio.match(/\.([A-Za-z0-9]{1,5})$/)?.[1]?.toLowerCase() ?? 'bin'
  const base = limpio.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'documento'
  return `${base}.${ext}`
}

/** Qué se lee (PDF y fotos), qué se guarda sin leer (hojas, extractos, zips, XML) y qué se deja, con su porqué. */
export function clasificarDocumentos(xs: readonly AdjuntoResend[]): ClasificadosPuerta {
  const { tomar, dejar: dejar0 } = clasificarAdjuntos(xs)
  const guardar: ClasificadosPuerta['guardar'] = []
  const dejar: ClasificadosPuerta['dejar'] = []
  for (const d of dejar0) {
    if (d.porque !== 'no es un PDF ni una foto') { dejar.push(d); continue }
    const a = xs.find((x) => (x.filename ?? 'sin nombre') === d.nombre)!
    const ct = (a.content_type ?? '').toLowerCase().split(';')[0].trim()
    const tipo = GUARDABLES.find((g) => g.ext.test(a.filename ?? ''))?.tipo ?? TIPOS_GUARDABLES[ct] ?? null
    if (!tipo) { dejar.push({ nombre: d.nombre, porque: 'no es un PDF, una foto, una hoja, un extracto, un zip ni un XML' }); continue }
    if ((a.size ?? 0) > MAX_BYTES) { dejar.push({ nombre: d.nombre, porque: 'pasa de 10 MB' }); continue }
    guardar.push({ ...a, tipo, nombre: nombreSeguroCon(a.filename) })
  }
  return { leer: tomar, guardar, dejar }
}

/** ¿Puede ser un resumen de pagos de Uber Eats? (Para pedir el cuerpo solo cuando hace falta.) */
const pareceDeUber = (c: Pick<CorreoResend, 'from' | 'subject'>) => /uber/i.test(`${c.from ?? ''} ${c.subject ?? ''}`)
/** ¿Puede ser una liquidación de Just Eat? (V02 · E2) */
const pareceDeJustEat = (c: Pick<CorreoResend, 'from' | 'subject'>) => /just-?eat|justeat/i.test(`${c.from ?? ''} ${c.subject ?? ''}`)

const QUE: Record<QueEs, string> = {
  factura: 'una factura', ticket: 'un ticket', liquidacion: 'una liquidación', extracto: 'un extracto del banco',
  nomina: 'una nómina', riders: 'una quincena de riders', otro: 'otra cosa',
}

async function recibirDocumentos(c: CorreoResend, dest: Destino & { direccion: string },
  base: { emailId: string; to: string; from: string | null; subject: string | null }, p: PuertoEntrada): Promise<ResultadoEntrada> {
  // 1 · Un resumen de pagos de Uber o una liquidación de Just Eat: es una liquidación, por su camino.
  if ((pareceDeUber(c) || pareceDeJustEat(c)) && p.liquidacion) {
    const cuerpo = c.html || c.text ? { html: c.html ?? null, text: c.text ?? null } : p.cuerpo ? await p.cuerpo(c.email_id).catch(() => null) : null
    if (cuerpo && (esResumenUber({ subject: c.subject }, trozos(cuerpo)) || esLiquidacionJustEat({ from: c.from, subject: c.subject }, trozos(cuerpo)))) {
      return recibirLiquidacion(c, dest, base, p, cuerpo)
    }
  }

  // 2 · Lo que la base sabe del remitente.
  const quien = c.from && p.remitente ? await p.remitente(dest.companyId, c.from) : null
  if (quien?.decision === 'no_facturas') {
    await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: 'sin_facturas', detalle: { motivo: 'remitente_no_facturas' } })
    return { resultado: 'no_es_factura', texto: `No se lee como factura: ${quien.motivo.replace(/\.$/, '')}. Queda apuntado en el registro de entrada.`, llegadas: [] }
  }
  const delRemitente: QueEs | null = quien?.decision === 'tipo' ? quien.tipo ?? null : null

  const { leer, guardar, dejar } = clasificarDocumentos(await p.adjuntos(c.email_id))
  const llegadas: ResultadoEntrada['llegadas'] = []
  const comun = { accountId: dest.accountId, companyId: dest.companyId, emailId: c.email_id, to: dest.direccion, from: c.from ?? null, subject: c.subject ?? null, recibido: c.created_at ?? null }
  let i = 0

  // 3 · PDF y fotos.
  for (const a of leer) {
    if (!a.download_url) { dejar.push({ nombre: a.nombre, porque: 'Resend no da su enlace de descarga' }); continue }
    const bytes = await p.bajar(a.download_url)
    if (bytes.length > MAX_BYTES) { dejar.push({ nombre: a.nombre, porque: 'pasa de 10 MB' }); continue }
    const que = delRemitente ?? queDiceElNombre(a.filename)
    // Una nómina va a Laboral por el camino del buzón de nóminas; no entra en la bandeja de facturas.
    if (que === 'nomina' && a.tipo === 'application/pdf' && p.nomina) {
      const r = await p.nomina({ accountId: dest.accountId, emailId: c.email_id, nombre: a.nombre, bytes })
      llegadas.push({ id: `nomina:${a.nombre}`, estado: r.ok ? 'nomina' : 'error', texto: r.texto })
      continue
    }
    const ruta = rutaEntrada(dest.accountId, c.email_id, i++, a.nombre)
    const sha = await p.sha256(bytes)
    await p.subir(ruta, bytes, a.tipo)
    const l = await p.llegada({ ...comun, ruta, nombre: a.nombre, tipo: a.tipo, bytes: bytes.length, sha256: sha, enlace: null })
    if (l.yaEstaba) { llegadas.push({ id: l.id, estado: 'repetido', texto: `${a.nombre}: ya estaba (el mismo fichero llegó antes).` }); continue }
    if (que && que !== 'factura' && que !== 'ticket') {
      // Se sabe que no es una factura: no se lee como tal.
      await p.colocar?.(l.id, { tipo: que, por: 'regla' })
      llegadas.push({ id: l.id, estado: 'colocado', texto: `${a.nombre}: es ${QUE[que]}.` })
      continue
    }
    const r = await p.leer(l.id)
    // Lo que la lectura dice: si es factura, factura; si no lo parece, queda sin saber («Necesita que lo mires»).
    if (r.estado !== 'no_es_factura' && r.estado !== 'error') await p.colocar?.(l.id, { tipo: que ?? 'factura', por: que ? 'regla' : 'lectura' })
    llegadas.push({ id: l.id, ...r })
  }

  // 4 · Hojas, extractos, zips y XML: a conta-entrada, sin leer, con lo que su
  // nombre o su contenido dice. La quincena de Catcher llega junta (el zip y sus
  // dos Excel): si el correo trae el zip de los riders, sus hojas van con él.
  const bajados: { a: (typeof guardar)[number]; bytes: Uint8Array; que: QueEs | null }[] = []
  for (const a of guardar) {
    if (!a.download_url || !p.subirA) { dejar.push({ nombre: a.nombre, porque: 'Resend no da su enlace de descarga' }); continue }
    const bytes = await p.bajar(a.download_url)
    if (bytes.length > MAX_BYTES) { dejar.push({ nombre: a.nombre, porque: 'pasa de 10 MB' }); continue }
    bajados.push({ a, bytes, que: delRemitente ?? queDiceElNombre(a.filename) ?? queDiceElContenido(a.filename, bytes) })
  }
  if (bajados.some((b) => b.que === 'riders' && /\.zip$/i.test(b.a.nombre))) {
    for (const b of bajados) if (!b.que && /\.(xlsx|xls)$/i.test(b.a.nombre)) b.que = 'riders'
  }
  for (const { a, bytes, que } of bajados) {
    const ruta = rutaEntrada(dest.accountId, c.email_id, i++, a.nombre)
    const sha = await p.sha256(bytes)
    await p.subirA!(BUCKET_ENTRADA, ruta, bytes, a.tipo)
    const l = await p.llegada({ ...comun, ruta, nombre: a.nombre, tipo: a.tipo, bytes: bytes.length, sha256: sha, enlace: null })
    if (l.yaEstaba) { llegadas.push({ id: l.id, estado: 'repetido', texto: `${a.nombre}: ya estaba (el mismo fichero llegó antes).` }); continue }
    await p.colocar?.(l.id, { tipo: que, por: 'regla', bucket: BUCKET_ENTRADA })
    llegadas.push({ id: l.id, estado: que ? 'colocado' : 'sin_saber', texto: que ? `${a.nombre}: es ${QUE[que]}.` : `${a.nombre}: no sé qué es; dímelo en la puerta.` })
  }

  // Sin ningún fichero, pero con un enlace de descarga: «Falta el PDF», como en facturas-.
  if (!llegadas.length) {
    for (const enlace of enlacesDeFactura(c)) {
      const l = await p.llegada({ ...comun, ruta: null, nombre: null, tipo: null, bytes: null, sha256: null, enlace })
      llegadas.push({ id: l.id, estado: 'falta_pdf', texto: 'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.' })
    }
  }
  // Al registro, solo recuentos y estados: nunca importes ni nombres de personas.
  const porEstado = llegadas.reduce<Record<string, number>>((m, l) => ({ ...m, [l.estado]: (m[l.estado] ?? 0) + 1 }), {})
  await p.registrarCorreo({ ...base, companyId: dest.companyId, resultado: llegadas.length ? 'recibido' : 'sin_facturas',
    detalle: { puerta: true, tomados: llegadas.length, estados: porEstado, dejados: dejar } })
  const texto = llegadas.length
    ? `${llegadas.length} ${llegadas.length === 1 ? 'documento recibido' : 'documentos recibidos'}${dejar.length ? `; ${dejar.length} sin tomar (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''}.`
    : `El correo no trae ningún documento${dejar.length ? ` (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''} ni un enlace para bajarlo.`
  return { resultado: 'documentos', texto, llegadas }
}

// ── S01j · Volver a leer lo que ya llegó ─────────────────────────────────────

export type Releido = { emailId: string; estado: 'leido' | 'ya_no_esta' | 'error'; resultado: string | null; texto: string }

export const YA_NO_ESTA = 'Este correo ya no está en el buzón: reenvíalo desde Gmail.'

/**
 * Vuelve a leer unos correos que ya llegaron: los pide otra vez a la entrada
 * (Resend) y los pasa por el mismo camino que al llegar, sin pararse en «ya
 * visto». No duplica nada: el mismo PDF se reconoce por su huella, la misma
 * liquidación por su clave y la misma factura por su número. Si la entrada ya
 * no tiene el correo, lo dice (el camino es reenviarlo desde Gmail).
 */
export async function releerCorreos(ids: readonly string[], p: PuertoEntrada, pedir: (id: string) => Promise<(CorreoResend & Sobre) | null>): Promise<Releido[]> {
  const sinVisto: PuertoEntrada = { ...p, yaVisto: async () => false }
  const out: Releido[] = []
  for (const id of ids) {
    let c: (CorreoResend & Sobre) | null
    try { c = await pedir(id) } catch (x) { out.push({ emailId: id, estado: 'error', resultado: null, texto: `No se ha podido pedir: ${x instanceof Error ? x.message : String(x)}` }); continue }
    if (!c) { out.push({ emailId: id, estado: 'ya_no_esta', resultado: null, texto: YA_NO_ESTA }); continue }
    try {
      const r = await recibirCorreo({ ...c, email_id: id }, sinVisto)
      out.push({ emailId: id, estado: 'leido', resultado: r.resultado, texto: r.texto })
    } catch (x) {
      out.push({ emailId: id, estado: 'error', resultado: null, texto: `No se ha podido leer: ${x instanceof Error ? x.message : String(x)}` })
    }
  }
  return out
}

/** Lo que dice la pantalla al acabar de volver a leer (regla 8: con contenido). */
export function resumenReleidos(rs: readonly Releido[]): string {
  const leidos = rs.filter((r) => r.estado === 'leido').length
  const fuera = rs.filter((r) => r.estado === 'ya_no_esta').length
  const mal = rs.filter((r) => r.estado === 'error').length
  const partes = [
    leidos ? `${leidos === 1 ? 'Leído otra vez 1 correo' : `Leídos otra vez ${leidos} correos`}` : null,
    fuera ? `${fuera === 1 ? '1 ya no está en el buzón' : `${fuera} ya no están en el buzón`}: reenvíalos desde Gmail` : null,
    mal ? `${mal === 1 ? '1 no se ha podido leer' : `${mal} no se han podido leer`}` : null,
  ].filter(Boolean)
  return partes.length ? `${partes.join('; ')}.` : 'No había ningún correo que volver a leer.'
}
