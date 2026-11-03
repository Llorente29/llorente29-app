// src/modules/conta/lib/justificante.ts
//
// B01 · Cola 1e · El justificante de un pago en la ficha de la factura: lo que
// no es pantalla. El enlace público (la función conta-justificante con la
// clave), el texto y el enlace de WhatsApp (wa.me, sin API: abre WhatsApp con
// el mensaje escrito) y cuánto le queda al enlace (30 días).

/** El enlace público del justificante: solo con la clave, sin sesión. */
export function enlaceJustificante(urlSupabase: string, clave: string): string {
  return `${urlSupabase.replace(/\/+$/, '')}/functions/v1/conta-justificante?c=${encodeURIComponent(clave)}`
}

/**
 * El teléfono para wa.me: solo cifras, con el prefijo del país. Un móvil o fijo
 * español de 9 cifras lleva el 34 delante; «+» o «00» delante se quitan. Si no
 * parece un teléfono, null (el botón lo dice y lleva a ponerlo).
 */
export function telefonoWhatsApp(telefono: string | null | undefined): string | null {
  let t = String(telefono ?? '').trim()
  if (!t) return null
  t = t.replace(/^\+/, '').replace(/[\s().-]/g, '')
  if (!/^\d+$/.test(t)) return null
  if (t.startsWith('00')) t = t.slice(2)
  if (/^[6789]\d{8}$/.test(t)) t = `34${t}`
  return t.length >= 10 && t.length <= 15 ? t : null
}

const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)

/** El mensaje de WhatsApp (maqueta v2, pantalla 6): «Hola, os hemos pagado la factura BP-2210 (288,40 €) hoy a las 13:04. Justificante: …». */
export function textoWhatsApp(o: { empresa: string; numero: string | null; importe: number; enlace: string; pagadoAt?: string | null }, ahora = new Date()): string {
  const que = o.numero ? `la factura ${o.numero}` : 'vuestra factura'
  let cuando = ''
  if (o.pagadoAt) {
    const madrid = (d: Date, op: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ...op }).format(d)
    const d = new Date(o.pagadoAt)
    const hora = madrid(d, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dia = madrid(d, { day: '2-digit', month: '2-digit' })
    cuando = dia === madrid(ahora, { day: '2-digit', month: '2-digit' }) ? ` hoy a las ${hora}` : ` el ${dia} a las ${hora}`
  }
  return `Hola, os hemos pagado ${que} (${euros(o.importe)} €)${cuando}. Justificante: ${o.enlace}${o.empresa ? ` · ${o.empresa}` : ''}`
}

/** El enlace de wa.me con el mensaje escrito; null sin un teléfono que valga. */
export function enlaceWhatsApp(telefono: string | null | undefined, texto: string): string | null {
  const t = telefonoWhatsApp(telefono)
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(texto)}` : null
}

/** «Caduca en 12 días» / «Caduca hoy» / «Ha caducado»: lo que le queda al enlace público. */
export function caducaEn(caduca: string, ahora = new Date()): string {
  const ms = new Date(caduca).getTime() - ahora.getTime()
  if (ms <= 0) return 'El enlace ha caducado'
  const dias = Math.floor(ms / 86_400_000)
  return dias === 0 ? 'El enlace caduca hoy' : `El enlace caduca en ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/** Si el enlace público ya ha caducado. */
export const haCaducado = (caduca: string, ahora = new Date()) => new Date(caduca).getTime() <= ahora.getTime()
