// supabase/functions/_shared/justificantePago.ts
//
// B01 · Cola 1e · EL JUSTIFICANTE DE UN PAGO (Julio, 02/11, B01·7 y B01·8).
// La API de Revolut no da comprobante de una transferencia: lo hace Sumied
// cuando el banco confirma que el pago ha salido.
//
//   · el PDF, con la marca de la empresa que paga (su nombre y su color), el
//     proveedor, la factura, el importe, la fecha y la referencia del banco, y
//     el IBAN del proveedor TAPADO salvo los 4 últimos;
//   · la clave del enlace público: 32 bytes al azar en base64url (43 letras),
//     que no se puede adivinar; el enlace caduca a los 30 días (la base);
//   · el correo al proveedor, si su ficha tiene «Mandar el justificante al
//     pagar» y un correo. Con el freno de los correos con marca: el tipo
//     «justificante_pago» está cerrado hasta que Julio lo abra.
//
// Sin Deno: jsPDF, el azar, el almacén y el correo se pasan desde fuera, y lo
// prueban las unitarias (tests/unit/modules/conta/b01/justificantePago.test.ts).
// Nada de lo que se escribe en el registro lleva un IBAN, un correo ni la clave.

import { MARCAS } from './marcas.ts'
import { cerrojoMarca } from '../send-email/marca.ts'

export const PLANTILLA_JUSTIFICANTE = 'justificante_pago'
export const BUZON_JUSTIFICANTES = 'pagos@sumied.com'
export const DIAS_ENLACE = 30
/** B01·13 (Julio, 03/11) · El pie del justificante (PDF y página pública). */
export const PIE_JUSTIFICANTE = 'Justificante generado por Sumied · sumied.com — la contabilidad que paga a tus proveedores sola'
/** B01·13 · La última línea del correo y del WhatsApp. */
export const FIRMA_SUMIED = 'Enviado con Sumied · sumied.com'

export interface DatosJustificante {
  salida: string
  account_id: string
  company_id: string
  invoice_id: string
  estado: string
  pagado_at: string
  importe: number | string
  concepto: string
  referencia: string | null
  banco: string
  empresa: { nombre: string; razon: string | null; nif: string | null; color: string | null; email: string | null; direccion?: string | null }
  desde: { nombre: string | null; iban4: string | null }
  proveedor: { nombre: string; nif: string | null; iban4: string; iban_pais: string; al_pagar: boolean; correo: string | null }
  factura: { numero: string | null; fecha: string | null; total: number | string | null }
  justificante: { id: string; clave: string; pdf_path: string; correo_at: string | null } | null
}

// ── Lo que no es PDF ─────────────────────────────────────────────────────────

/** La clave del enlace: 32 bytes al azar, en base64url sin relleno (43 letras). */
export function nuevaClave(azar: (n: number) => Uint8Array): string {
  const b = azar(32)
  if (b.length !== 32) throw new Error('El azar no ha dado 32 bytes.')
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const CLAVE = /^[A-Za-z0-9_-]{43}$/

/** Dónde se guarda el PDF, en conta-documentos. */
export const rutaJustificante = (cuenta: string, salida: string) => `${cuenta}/justificantes/${salida}.pdf`

/** El nombre del fichero: «Justificante-26A-10966.pdf». */
export const nombreJustificante = (numero: string | null) => `Justificante-${String(numero || 'pago').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`

/** El IBAN tapado salvo los 4 últimos: «ES·· ···· ···· ···· ···· 2115». */
export const ibanTapado = (pais: string | null, ultimos4: string | null) => `${(pais || '··').slice(0, 2)}·· ···· ···· ···· ···· ${ultimos4 || '····'}`

const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
/** La fecha y la hora de Madrid de un instante. */
function fechaHoraMadrid(iso: string): string {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso))
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} a las ${v('hour')}:${v('minute')}`
}

/** El color de la empresa (#RRGGBB) en RGB; sin color o raro, el azul de Sumied. */
export function colorEmpresa(hex: string | null): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return [30, 99, 201]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ── El PDF ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPdfCtor = new (o: { unit: 'mm'; format: 'a4'; orientation: 'portrait' }) => any
const TINTA: [number, number, number] = [11, 31, 59]
const GRIS: [number, number, number] = [74, 91, 115]
const LINEA: [number, number, number] = [226, 232, 240]

/** Las filas del justificante, en orden: lo que pinta el PDF (y lo que miran las pruebas). */
export function filasJustificante(d: DatosJustificante): [string, string][] {
  const filas: [string, string][] = [
    ['Paga', [d.empresa.razon || d.empresa.nombre, d.empresa.nif].filter(Boolean).join(' · ')],
    ['Desde', [d.banco, d.desde.nombre && d.desde.nombre !== d.banco ? d.desde.nombre : null, d.desde.iban4 ? `cuenta acabada en ${d.desde.iban4}` : null].filter(Boolean).join(' · ')],
    ['A', [d.proveedor.nombre, d.proveedor.nif].filter(Boolean).join(' · ')],
    ['A la cuenta', ibanTapado(d.proveedor.iban_pais, d.proveedor.iban4)],
    ['Factura', [d.factura.numero, d.factura.fecha ? `del ${fecha(d.factura.fecha)}` : null].filter(Boolean).join(' ') || '—'],
    ['Concepto', d.concepto],
    ['Pagado', `${fechaHoraMadrid(d.pagado_at)} (hora de Madrid)`],
  ]
  if (d.referencia) filas.push([`Referencia de ${d.banco}`, d.referencia])
  return filas
}

/** Las iniciales de la empresa para la marca del PDF («Taberna de Prueba Norte» → «TP»). */
export function iniciales(nombre: string): string {
  const p = nombre.replace(/[,.]/g, ' ').split(/\s+/).filter((x) => x && !/^(de|del|la|las|el|los|y|s\.?l\.?|s\.?a\.?)$/i.test(x))
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'S'
}

/** El PDF, en bytes. Solo de un pago que el banco ha confirmado. Como la maqueta v2 (pantalla 6). */
export function justificantePagoPdf(JsPDF: JsPdfCtor, d: DatosJustificante): Uint8Array {
  if (d.estado !== 'pagada') throw new Error('Este pago no está confirmado por el banco: no lleva justificante.')
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const W = 210, M = 18, D = W - M
  const marca = colorEmpresa(d.empresa.color)
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const letra = (estilo: 'normal' | 'bold', tam: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam) }
  const linea = (y: number) => { doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]); doc.line(M, y, D, y) }
  const razon = d.empresa.razon || d.empresa.nombre
  const [fechaPago, horaPago] = fechaHoraMadrid(d.pagado_at).split(' a las ')

  // La marca de quien paga: sus iniciales en su color, la razón social, el NIF y la dirección.
  doc.setFillColor(marca[0], marca[1], marca[2]); doc.roundedRect(M, M, 14, 14, 3, 3, 'F')
  doc.setTextColor(255, 255, 255); letra('bold', 12); doc.text(iniciales(d.empresa.nombre), M + 7, M + 9.2, { align: 'center' })
  color(TINTA); letra('bold', 13); doc.text(razon, M + 18, M + 5.5)
  letra('normal', 8.5); color(GRIS); doc.text([d.empresa.nif, d.empresa.direccion].filter(Boolean).join(' · ') || ' ', M + 18, M + 11)
  letra('bold', 12); color(TINTA); doc.text('Justificante de pago', D, M + 5.5, { align: 'right' })
  letra('normal', 9); color(GRIS); doc.text(`${fechaPago} · ${horaPago}`, D, M + 11, { align: 'right' })
  let y = M + 22
  linea(y); y += 10

  // A quién y cuánto.
  letra('normal', 9); color(GRIS); doc.text('Pagado a', M, y); doc.text('Importe', D, y, { align: 'right' })
  y += 7
  letra('bold', 13); color(TINTA); doc.text(doc.splitTextToSize(d.proveedor.nombre, 110), M, y)
  color(marca); letra('bold', 22); doc.text(`${euros(Number(d.importe))} €`, D, y + 2, { align: 'right' })
  y += 6
  letra('normal', 9.5); color(GRIS); doc.text(ibanTapado(d.proveedor.iban_pais, d.proveedor.iban4), M, y)
  y += 10
  linea(y); y += 7

  // La factura que paga.
  letra('bold', 8.5); color(GRIS)
  doc.text('Factura', M, y); doc.text('Fecha', M + 80, y); doc.text('Pagado', D, y, { align: 'right' })
  y += 6
  letra('normal', 10); color(TINTA)
  doc.text(d.factura.numero || d.concepto || '—', M, y)
  doc.text(d.factura.fecha ? fecha(d.factura.fecha) : '—', M + 80, y)
  doc.text(`${euros(Number(d.importe))} €`, D, y, { align: 'right' })
  y += 5
  linea(y); y += 9

  // Desde dónde y la referencia del banco.
  const filas: [string, string][] = [['Desde', `${d.banco} Business${d.desde.iban4 ? ` · cuenta ···${d.desde.iban4}` : ''}`]]
  if (d.referencia) filas.push([`Referencia de ${d.banco}`, d.referencia])
  for (const [k, v] of filas) {
    letra('normal', 9); color(GRIS); doc.text(k, M, y)
    letra('bold', 10); color(TINTA); doc.text(v, M + 50, y)
    y += 7
  }
  y += 4
  linea(y); y += 8
  letra('normal', 8.5); color(GRIS)
  doc.text(doc.splitTextToSize(`Transferencia SEPA enviada y confirmada por ${d.banco} el ${fechaPago} a las ${horaPago} (hora de Madrid). Justificante hecho para ${razon}; el IBAN va tapado salvo los 4 últimos.`, D - M), M, y)
  // B01·13 · El pie, abajo del todo.
  letra('normal', 8); color(GRIS); doc.text(PIE_JUSTIFICANTE, 105, 287, { align: 'center' })
  return new Uint8Array(doc.output('arraybuffer'))
}

// ── El correo ───────────────────────────────────────────────────────────────

const html = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const limpio = (x: string) => x.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)

export function remitenteJustificante(empresa: string): string {
  const n = limpio(empresa)
  return n ? `"${n} vía Sumied" <${BUZON_JUSTIFICANTES}>` : `Sumied <${BUZON_JUSTIFICANTES}>`
}

export function correoJustificante(d: DatosJustificante): { asunto: string; texto: string; html: string } {
  const que = d.factura.numero ? `la factura ${d.factura.numero}` : 'tu factura'
  const asunto = limpio(`Pago de ${que} · ${d.empresa.nombre}`)
  const lineas = [
    'Hola:',
    '',
    `${d.empresa.nombre} te ha pagado ${que}: ${euros(Number(d.importe))} € por transferencia desde ${d.banco}, el ${fecha(d.pagado_at.slice(0, 10))}.`,
    'Tienes el justificante adjunto en PDF.',
    '',
    'Un saludo,',
    d.empresa.nombre,
    '',
    FIRMA_SUMIED,
  ]
  return { asunto, texto: lineas.join('\n'), html: lineas.map((l) => (l ? `<p>${html(l)}</p>` : '')).join('') }
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export function correoValido(x: unknown): string | null {
  const c = String(x ?? '').trim().toLowerCase()
  return c && CORREO.test(c) && !/[\r\n,;<>"]/.test(c) ? c : null
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Manda el justificante a `para`. Devuelve si salió y la frase (regla 8): la
 * apunta quien llama. Con el freno cerrado no se manda nada, y lo dice.
 */
export async function mandarJustificante(o: { fetch: Fetch; resendKey: string | null | undefined; abiertos: string | null | undefined; para: string; d: DatosJustificante; pdf: Uint8Array }): Promise<{ enviado: boolean; texto: string }> {
  const para = correoValido(o.para)
  const n = o.d.factura.numero ?? 'la factura'
  if (!para) return { enviado: false, texto: `No se ha mandado el justificante de ${n}: el correo del proveedor no vale.` }
  const cerrojo = cerrojoMarca(MARCAS.sumied, PLANTILLA_JUSTIFICANTE, para, o.abiertos)
  if (!cerrojo.abierto) return { enviado: false, texto: `No se ha mandado el justificante de ${n} a ${para}: los correos de justificantes aún están cerrados (los abre Julio).` }
  if (!o.resendKey) return { enviado: false, texto: `No se ha mandado el justificante de ${n}: el servicio de correo no está configurado.` }
  const c = correoJustificante(o.d)
  const responder = correoValido(o.d.empresa.email)
  const res = await o.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remitenteJustificante(o.d.empresa.nombre), to: [para], subject: c.asunto, html: c.html, text: c.texto,
      ...(responder ? { reply_to: responder } : {}),
      attachments: [{ filename: nombreJustificante(o.d.factura.numero), content: base64(o.pdf) }],
    }),
  })
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({})) as { message?: string }
    return { enviado: false, texto: `No se ha mandado el justificante de ${n} a ${para}: el proveedor de correo lo ha rechazado (${cuerpo.message ?? `HTTP ${res.status}`}).` }
  }
  return { enviado: true, texto: `Mandado el justificante de ${n} a ${para}, con su PDF.` }
}

// ── Hacer los que faltan (la lectura de cada hora, el aviso y «Pagar») ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Srv = { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }

export interface PiezasJustificante {
  pdf(d: DatosJustificante): Uint8Array
  clave(): string
  subir(ruta: string, pdf: Uint8Array): Promise<void>
  /** El correo, si la ficha del proveedor lo pide; null = no hay con qué mandar. */
  mandar: ((para: string, d: DatosJustificante, pdf: Uint8Array) => Promise<{ enviado: boolean; texto: string }>) | null
}

/**
 * Los pagos de la empresa que el banco ha confirmado y aún no tienen
 * justificante: a cada uno, su PDF al almacén, guardado en la base y, si su
 * proveedor lo pide, por correo. No lanza: un fallo se cuenta y sigue (la
 * próxima lectura lo vuelve a intentar).
 */
export async function hacerJustificantes(srv: Srv, empresa: string, p: PiezasJustificante) {
  const out = { hechos: 0, mandados: 0, fallos: 0 }
  const { data, error } = await srv.rpc('conta_pago_justificante_por_hacer', { p_company: empresa })
  if (error || !Array.isArray(data)) return out
  for (const salida of data as string[]) {
    try {
      const r = await srv.rpc('conta_pago_justificante_datos', { p_salida: salida })
      if (r.error || !r.data) throw new Error(r.error?.message ?? 'sin datos')
      const d = r.data as DatosJustificante
      const pdf = p.pdf(d)
      const ruta = rutaJustificante(d.account_id, d.salida)
      await p.subir(ruta, pdf)
      const g = await srv.rpc('conta_pago_justificante_guardar', { p_salida: salida, p_clave: p.clave(), p_pdf_path: ruta })
      if (g.error) throw new Error(g.error.message)
      out.hechos++
      const nuevo = (g.data as { nuevo?: boolean; id: string }).nuevo === true
      if (nuevo && p.mandar && d.proveedor.al_pagar && d.proveedor.correo) {
        const m = await p.mandar(d.proveedor.correo, d, pdf)
        await srv.rpc('conta_pago_justificante_correo', { p_id: (g.data as { id: string }).id, p_a: m.enviado ? correoValido(d.proveedor.correo) : null, p_texto: m.texto, p_quien: null })
        if (m.enviado) out.mandados++
      }
    } catch { out.fallos++ }
  }
  return out
}
