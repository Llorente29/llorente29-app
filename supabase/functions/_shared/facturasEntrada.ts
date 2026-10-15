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
//   2. Se miran TODOS los destinatarios (to y cc), no solo el primero: un
//      reenvío puede dejar la dirección de Folvy en copia.
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

export const DOMINIO_ENTRADA = 'entrada.folvy.app'
export const DIRECCION = /^(facturas-[a-z0-9][a-z0-9-]{1,40})@([a-z0-9.-]+)$/
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
  subject?: string | null
  created_at?: string | null
  text?: string | null
  html?: string | null
}
export type AdjuntoResend = { id: string; filename?: string | null; content_type?: string | null; size?: number | null; download_url?: string | null }

/** Las direcciones de facturas que trae el correo (to y cc), sin repetir, en minúsculas. */
export function direccionesDeFacturas(c: Pick<CorreoResend, 'to' | 'cc'>): { localPart: string; dominio: string; direccion: string }[] {
  const todas = [...(c.to ?? []), ...(c.cc ?? [])]
    .map((d) => (d.match(/<([^>]+)>/)?.[1] ?? d).trim().toLowerCase())
  const vistas = new Set<string>()
  const out: { localPart: string; dominio: string; direccion: string }[] = []
  for (const d of todas) {
    const m = d.match(DIRECCION)
    if (!m || vistas.has(d)) continue
    vistas.add(d)
    out.push({ localPart: m[1], dominio: m[2], direccion: d })
  }
  return out
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

export type Destino = { companyId: string; accountId: string; activa: boolean }
export interface PuertoEntrada {
  /** La empresa de una dirección de facturas, o null. */
  destino(localPart: string, dominio: string): Promise<Destino | null>
  /** ¿Ya se procesó este correo? */
  yaVisto(emailId: string): Promise<boolean>
  /** Apunta el correo en el registro de entrada (también el que no es de nadie). */
  registrarCorreo(r: { emailId: string; to: string; from: string | null; subject: string | null; companyId: string | null; resultado: string; detalle: unknown }): Promise<void>
  adjuntos(emailId: string): Promise<AdjuntoResend[]>
  bajar(url: string): Promise<Uint8Array>
  subir(ruta: string, bytes: Uint8Array, tipo: string): Promise<void>
  sha256(b: Uint8Array): Promise<string>
  /** Registra la llegada en la bandeja; devuelve su id, o el de la que ya estaba con la misma huella. */
  llegada(x: { accountId: string; companyId: string; emailId: string; to: string; from: string | null; subject: string | null; recibido: string | null; ruta: string | null; nombre: string | null; tipo: string | null; bytes: number | null; sha256: string | null; enlace: string | null }): Promise<{ id: string; yaEstaba: boolean }>
  /** Lee la llegada (ocr-albaran, modo factura) y saca de ella la factura. */
  leer(inboxId: string): Promise<{ estado: string; texto: string }>
}

export type ResultadoEntrada = { resultado: 'ignorado' | 'sin_destino' | 'apagada' | 'repetido' | 'recibido'; texto: string; llegadas: { id: string; estado: string; texto: string }[] }

export async function recibirCorreo(c: CorreoResend, p: PuertoEntrada): Promise<ResultadoEntrada> {
  const dirs = direccionesDeFacturas(c)
  if (!dirs.length) return { resultado: 'ignorado', texto: 'El correo no va a ninguna dirección de facturas.', llegadas: [] }
  if (await p.yaVisto(c.email_id)) return { resultado: 'repetido', texto: 'Este correo ya se recibió: no se procesa dos veces.', llegadas: [] }

  let destino: (Destino & { direccion: string }) | null = null
  for (const d of dirs) {
    const x = await p.destino(d.localPart, d.dominio)
    if (x) { destino = { ...x, direccion: d.direccion }; break }
  }
  const base = { emailId: c.email_id, to: destino?.direccion ?? dirs[0].direccion, from: c.from ?? null, subject: c.subject ?? null }
  if (!destino) {
    await p.registrarCorreo({ ...base, companyId: null, resultado: 'sin_destino', detalle: { direcciones: dirs.map((d) => d.direccion) } })
    return { resultado: 'sin_destino', texto: `${dirs[0].direccion} no es la dirección de ninguna empresa: queda apuntado y no se lee.`, llegadas: [] }
  }
  if (!destino.activa) {
    await p.registrarCorreo({ ...base, companyId: destino.companyId, resultado: 'apagada', detalle: {} })
    return { resultado: 'apagada', texto: `La dirección ${destino.direccion} está apagada: queda apuntado y no se lee.`, llegadas: [] }
  }

  const { tomar, dejar } = clasificarAdjuntos(await p.adjuntos(c.email_id))
  const llegadas: ResultadoEntrada['llegadas'] = []
  const comun = { accountId: destino.accountId, companyId: destino.companyId, emailId: c.email_id, to: destino.direccion, from: c.from ?? null, subject: c.subject ?? null, recibido: c.created_at ?? null }

  for (const [i, a] of tomar.entries()) {
    if (!a.download_url) { dejar.push({ nombre: a.nombre, porque: 'Resend no da su enlace de descarga' }); continue }
    const bytes = await p.bajar(a.download_url)
    if (bytes.length > MAX_BYTES) { dejar.push({ nombre: a.nombre, porque: 'pasa de 10 MB' }); continue }
    const ruta = rutaEntrada(destino.accountId, c.email_id, i, a.nombre)
    const sha = await p.sha256(bytes)
    await p.subir(ruta, bytes, a.tipo)
    const l = await p.llegada({ ...comun, ruta, nombre: a.nombre, tipo: a.tipo, bytes: bytes.length, sha256: sha, enlace: null })
    if (l.yaEstaba) { llegadas.push({ id: l.id, estado: 'repetido', texto: `${a.nombre}: ya estaba (el mismo fichero llegó antes).` }); continue }
    const r = await p.leer(l.id)
    llegadas.push({ id: l.id, ...r })
  }
  // Sin ningún fichero útil, pero con un enlace de descarga: «Falta el PDF».
  if (!llegadas.length) {
    for (const enlace of enlacesDeFactura(c)) {
      const l = await p.llegada({ ...comun, ruta: null, nombre: null, tipo: null, bytes: null, sha256: null, enlace })
      llegadas.push({ id: l.id, estado: 'falta_pdf', texto: 'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.' })
    }
  }
  await p.registrarCorreo({ ...base, companyId: destino.companyId, resultado: llegadas.length ? 'recibido' : 'sin_facturas', detalle: { tomados: llegadas.length, dejados: dejar } })
  const texto = llegadas.length
    ? `${llegadas.length} ${llegadas.length === 1 ? 'documento recibido' : 'documentos recibidos'}${dejar.length ? `; ${dejar.length} sin tomar (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''}.`
    : `El correo no trae ninguna factura${dejar.length ? ` (${dejar.map((d) => `${d.nombre}: ${d.porque}`).join('; ')})` : ''} ni un enlace para bajarla.`
  return { resultado: 'recibido', texto, llegadas }
}
