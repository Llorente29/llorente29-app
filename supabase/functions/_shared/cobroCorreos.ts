// supabase/functions/_shared/cobroCorreos.ts
//
// PC01 · Entrega 4 · LOS CORREOS DE COBRO DE SUMIED: el recordatorio de una
// factura y el mandato de domiciliación para firmar. Puro, sin Deno: lo
// prueban las unitarias (tests/unit/modules/conta/pc01/cobroCorreos.test.ts).
//
//   · Salen de sumied.com con el nombre de la empresa («Bar Ejemplo vía
//     Sumied», como las facturas: remitenteFactura) y las respuestas van al
//     correo de la empresa. Llevan su marca: su logo y su color, si los tiene.
//   · El freno: «recordatorio_cobro» y «mandato_sepa» están cerrados hasta que
//     Julio los abra en CORREO_MARCA_ABIERTOS (cerrojoMarca). El primer envío
//     real, solo a su correo de prueba («recordatorio_cobro:<correo>»).
//   · Palabras de la calle: nada de SEPA, mandato «CORE», token ni XML en el
//     cuerpo; «domiciliación» y «recibo», sí.

export const PLANTILLA_RECORDATORIO = 'recordatorio_cobro'
export const PLANTILLA_MANDATO = 'mandato_sepa'

const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const html = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const limpio = (x: string) => x.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/** El color de la empresa, solo si es un #RRGGBB; si no, la tinta de Sumied. */
export function colorMarca(c: unknown): string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : '#0B1F3B'
}

export interface Marca { empresa: string; color?: string | null; logo?: string | null }
export interface Correo { asunto: string; texto: string; html: string }

/** El marco de los dos correos: la cabecera con la marca de la empresa, los párrafos y, si lo hay, un botón. */
export function marco(m: Marca, lineas: string[], boton: { texto: string; url: string } | null): string {
  const color = colorMarca(m.color)
  const logo = m.logo && /^https:\/\//.test(m.logo) ? `<img src="${html(m.logo)}" alt="${html(m.empresa)}" style="max-height:48px;max-width:200px;display:block" />` : ''
  const cabecera = `<div style="border-bottom:3px solid ${color};padding:0 0 12px;margin:0 0 20px">${logo || `<strong style="font-size:18px;color:${color}">${html(m.empresa)}</strong>`}</div>`
  const cuerpo = lineas.map((l) => (l ? `<p style="margin:0 0 8px">${html(l)}</p>` : '<p style="margin:0 0 14px"></p>')).join('')
  const btn = boton
    ? `<p style="margin:20px 0"><a href="${html(boton.url)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${html(boton.texto)}</a></p>`
      + `<p style="margin:0 0 14px;font-size:12px;color:#4A5B73">Si el botón no se abre, copia este enlace: ${html(boton.url)}</p>`
    : ''
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;color:#0B1F3B;line-height:1.5;max-width:560px">${cabecera}${cuerpo}${btn}</div>`
}

// ── El recordatorio ─────────────────────────────────────────────────────────

export interface DatosRecordatorio extends Marca {
  cliente: string
  numero: string
  /** AAAA-MM-DD */
  fecha: string
  vence: string
  hoy: string
  total: number
  pendiente: number
  /** El enlace para pagar con tarjeta (y Bizum, si está activo), o null si la empresa no cobra así. */
  enlacePago?: string | null
  /** ¿El enlace deja pagar con Bizum? Solo si está activo (Respuesta 10: no se enseña lo que no funciona). */
  conBizum?: boolean
  conPdf: boolean
}

/** Qué dice del vencimiento: «vence el 01/11», «vence hoy», «venció el 10/10, hace 15 días». */
export function cuandoVence(vence: string, hoy: string): { asunto: string; frase: string } {
  const d = dias(hoy, vence)
  if (d > 0) return { asunto: `vence el ${fecha(vence).slice(0, 5)}`, frase: `vence el ${fecha(vence)}` }
  if (d === 0) return { asunto: 'vence hoy', frase: 'vence hoy' }
  return { asunto: 'pendiente de pago', frase: `venció el ${fecha(vence)}, hace ${-d === 1 ? '1 día' : `${-d} días`}` }
}

export function correoRecordatorio(d: DatosRecordatorio): Correo {
  const v = cuandoVence(d.vence, d.hoy)
  const parte = d.pendiente < d.total - 0.005
  const asunto = limpio(`Factura ${d.numero} de ${d.empresa}: ${v.asunto}`)
  const lineas = [
    `Hola, ${d.cliente}:`,
    '',
    `Te recordamos que la factura ${d.numero} del ${fecha(d.fecha)}, por ${euros(d.total)} €, ${v.frase}.`
      + (parte ? ` Quedan pendientes ${euros(d.pendiente)} €.` : ''),
    d.enlacePago ? `Puedes pagarla ahora con ${d.conBizum ? 'tarjeta o Bizum' : 'tarjeta'} desde el botón de abajo.` : 'Si ya la has pagado, gracias: no hace falta que hagas nada.',
    ...(d.conPdf ? ['Te la adjuntamos otra vez en PDF.'] : []),
    ...(d.enlacePago ? ['Si ya la has pagado, gracias: no hace falta que hagas nada.'] : []),
    'Para cualquier duda, responde a este correo.',
    '',
    'Un saludo,',
    d.empresa,
  ]
  const boton = d.enlacePago ? { texto: `Pagar ${euros(d.pendiente)} €`, url: d.enlacePago } : null
  const texto = [...lineas, ...(boton ? ['', `Pagar: ${boton.url}`] : [])].join('\n')
  return { asunto, texto, html: marco(d, lineas, boton) }
}

// ── El mandato para firmar ──────────────────────────────────────────────────

export interface DatosMandato extends Marca {
  cliente: string
  ref: string
  enlace: string
  /** AAAA-MM-DD */
  caduca: string
}

export function correoMandato(d: DatosMandato): Correo {
  const asunto = limpio(`${d.empresa}: firma la domiciliación de tus recibos (${d.ref})`)
  const lineas = [
    `Hola, ${d.cliente}:`,
    '',
    `Para cobrarte las facturas de ${d.empresa} por domiciliación bancaria necesitamos tu autorización firmada (referencia ${d.ref}).`,
    'Se firma en un minuto desde el móvil, sin crear cuenta: solo hace falta el nombre de quien firma y el IBAN donde quieres que se carguen los recibos.',
    `El enlace vale hasta el ${fecha(d.caduca)}. Al firmar, te quedas con una copia.`,
    'Para cualquier duda, responde a este correo.',
    '',
    'Un saludo,',
    d.empresa,
  ]
  const boton = { texto: 'Firmar la domiciliación', url: d.enlace }
  const texto = [...lineas, '', `Firmar: ${d.enlace}`].join('\n')
  return { asunto, texto, html: marco(d, lineas, boton) }
}

/**
 * Desde qué dirección se firma: la de la app desde la que se prepara, si es una
 * de las marcas (app.sumied.com, app.folvy.app…); si no, la de Sumied. Así un
 * correo de Sumied nunca lleva a una dirección que diga quien llama.
 */
export function origenFirma(origen: unknown, dominios: readonly string[]): string {
  try {
    const u = new URL(String(origen ?? ''))
    if (u.protocol === 'https:' && dominios.includes(u.hostname)) return `https://${u.hostname}`
  } catch { /* no es una dirección */ }
  return 'https://app.sumied.com'
}
