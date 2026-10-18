// src/modules/conta/lib/expedidaPdf.ts
//
// S01d · El PDF de una factura expedida apuntada a mano (Asientos › Expedida,
// serie 1). Lo que se decide sin tocar la base, aparte para probarlo:
//
//   · si un asiento puede llevar ese PDF, y si ya se le puede adjuntar
//     (conta_documento_expedida_guardar pide validado, 'manual' y serie 1);
//   · qué fichero se acepta (PDF, o una foto JPG/PNG que se convierte);
//   · la ruta en conta-documentos (<cuenta>/<asiento>/<huella>.pdf) y el nombre,
//     que la base solo admite como [A-Za-z0-9._-]+.pdf (journal_entry_document).

export interface AsientoParaExpedida { estado: string; origen: string; serie: number }

/** Una expedida a mano: serie 1 (Ventas) y apuntada a mano. Puede llevar su PDF (al validarla). */
export function esExpedidaAMano(a: AsientoParaExpedida): boolean {
  return a.origen === 'manual' && a.serie === 1
}

/** Ya se le puede adjuntar: además, validada (la base no lo enlaza a un borrador). */
export function admitePdfExpedida(a: AsientoParaExpedida): boolean {
  return esExpedidaAMano(a) && a.estado === 'validado'
}

export type ClaseFichero = 'pdf' | 'image/jpeg' | 'image/png'

/** Lo que se acepta en el selector de ficheros. */
export const ACEPTA_EXPEDIDA = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png'

/** El bucket conta-documentos admite hasta 5 MB por fichero. */
export const MAX_BYTES_EXPEDIDA = 5 * 1024 * 1024

/** PDF, foto JPG o PNG; cualquier otra cosa, null. Por el tipo y, si el navegador no lo da, por la extensión. */
export function claseDeFichero(nombre: string, tipo: string): ClaseFichero | null {
  const t = tipo.toLowerCase()
  const n = nombre.toLowerCase()
  if (t === 'application/pdf' || (!t && n.endsWith('.pdf'))) return 'pdf'
  if (t === 'image/jpeg' || (!t && /\.jpe?g$/.test(n))) return 'image/jpeg'
  if (t === 'image/png' || (!t && n.endsWith('.png'))) return 'image/png'
  return null
}

/** Por qué no se acepta un fichero, o null si vale. */
export function problemaDeFichero(nombre: string, tipo: string, bytes: number): string | null {
  if (!claseDeFichero(nombre, tipo)) return `«${nombre}» no es un PDF ni una foto JPG o PNG.`
  if (bytes <= 0) return `«${nombre}» está vacío.`
  return null
}

const HUELLA = /^[0-9a-f]{64}$/

/** <cuenta>/<asiento>/<16 primeros de la huella>.pdf: la ruta que la base comprueba. */
export function rutaExpedida(accountId: string, entryId: string, sha256: string): string {
  if (!HUELLA.test(sha256)) throw new Error('la huella del PDF no es un sha256')
  return `${accountId}/${entryId}/${sha256.slice(0, 16)}.pdf`
}

/**
 * El nombre con el que se guarda: el del fichero, sin tildes ni espacios y
 * acabado en .pdf (una foto «Factura 12.jpg» → «Factura-12.pdf»). La base solo
 * admite [A-Za-z0-9._-]+.pdf.
 */
export function nombreExpedida(original: string): string {
  const sinExt = original.replace(/\.(pdf|jpe?g|png)$/i, '')
  const limpio = sinExt.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100).replace(/[-.]+$/, '')
  return `${limpio || 'factura'}.pdf`
}

/** Lo que dice la pantalla al adjuntarla (regla 8: con su contenido). */
export function textoAdjunta(nombre: string, yaEstaba: boolean): string {
  return yaEstaba ? `La factura ya estaba adjunta: ${nombre}.` : `Factura adjunta: ${nombre}.`
}

/** Tamaño legible: «820 KB», «1,4 MB». */
export function tamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`
}

/**
 * El motivo de un fallo, para meterlo en una frase: sin el nombre de la
 * función que le pone delante `rpc` y sin el punto final («…: no se cambia»).
 */
export function motivoExpedida(texto: string): string {
  return texto.replace(/^conta_documento_expedida_guardar:\s*/, '').trim().replace(/\.+$/, '')
}
