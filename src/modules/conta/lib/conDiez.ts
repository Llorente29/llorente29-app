// src/modules/conta/lib/conDiez.ts
//
// C04b · R15 · Cómo está con Diez cada asiento de ventas de una plataforma, en
// palabras (R13): «Propuesto», «Validado · enviando a Diez», «En Diez · 1/1801»
// o «No ha llegado a Diez: <motivo>» con «Reintentar». Puro: lo usan el Libro
// diario, el asiento y, después, la pantalla N16 «Libros › Con Diez».
//
// El freno de R15, aquí también: SIN DOCUMENTO ADJUNTO NO ESTÁ EN DIEZ. Una
// factura que Diez tiene pero sin su PDF dice «No ha llegado a Diez: falta el
// documento», no «En Diez».
//
// C06b · Respuesta 7 (Julio, 14/10): a Diez sin esperar a Cegid. La factura
// que Diez tiene SIN su PDF porque Diez aún no guarda documentos sí está en
// Diez, y lo dice: «En Diez · 1/1801 · PDF pendiente en Diez» (azul, no verde:
// falta algo, pero no es un fallo). Lo que falla al adjuntar sigue siendo
// «No ha llegado a Diez: falta el documento». Y lo anulado en Folvy que sigue
// en Diez no se queda en «Anulado» a secas: falta su contraasiento allí.
// Respuesta 8: con su contraasiento ya en Diez, «Anulado en Folvy y en Diez».

import { MARCA } from '../cuenta/marca'
import { PATRONES, PATRONES_PENDIENTES } from '../../../../supabase/functions/_shared/diezFactura.ts'
import { cent, deCent } from './libro'

/** Lo que se lee de external_send. */
export interface EnvioDiez {
  status: 'pendiente' | 'enviado' | 'enlazado' | 'rechazado'
  serie: string | null
  numero: number | null
  factura: string | null
  intentos: number
  error: string | null
  documento: 'pendiente' | 'adjunto' | 'fallo' | 'pendiente_diez' | null
  errorDocumento: string | null
}
/** Lo que se lee de journal_entry_document. */
export interface DocumentoAsiento { ruta: string; nombre: string; bytes: number; creadoEn: string; creadoPor: string | null }

/** Un asiento de ventas de una plataforma, con lo suyo de Diez. */
export interface ConDiez {
  entryId: string
  /** sales_channel.slug y nombre. */
  canal: string
  nombreCanal: string
  documento: DocumentoAsiento | null
  envio: EnvioDiez | null
  /** Respuesta 8: el envío a Diez de su contraasiento, si está anulado. */
  contraasiento?: EnvioDiez | null
}

export type TonoDiez = 'ambar' | 'verde' | 'azul' | 'neutro'
export interface EstadoDiez {
  /** La frase entera, la de la pantalla del asiento. */
  texto: string
  /** La corta, la del chip de la fila del libro (una línea). */
  corto: string
  tono: TonoDiez
  /** ¿Tiene «Reintentar»? */
  reintentar: boolean
  enDiez: boolean
}

export const FALTA_DOCUMENTO = 'falta el documento'

/**
 * 15/10 · Por qué un asiento de ventas de esta plataforma no se puede mandar
 * a Diez hoy (su patrón de factura no está medido, o está medido y no encaja:
 * Glovo), o null si se puede. Se mira ANTES de validar: validar no se deshace.
 */
export function motivoSinPatron(canal: string): string | null {
  const c = canal.toLowerCase()
  if (PATRONES[c]) return null
  return PATRONES_PENDIENTES[c] ?? `la plataforma «${canal}» no tiene su patrón de factura medido en Diez`
}


/**
 * 15/10 · Los dos números de un asiento validado, el de la marca y el de Diez:
 * ya no coinciden (Folvy 1803 es el Glovo que no llegó; Diez 1803 es
 * UBR-CAM-20261001, que en Folvy es el 1804). Sin número en la marca, null.
 * La serie de Diez solo se dice si no es la 1 (las recibidas van a la 2).
 */
export function numerosFolvyDiez(a: { numero: number | null }, d: ConDiez | null | undefined): string | null {
  if (a.numero == null) return null
  const propio = `${MARCA.nombre} ${a.numero.toLocaleString('es-ES')}`
  if (!d) return propio
  const e = d.envio
  if (!e || (e.status !== 'enviado' && e.status !== 'enlazado') || e.numero == null) return `${propio} · aún no está en Diez`
  return `${propio} · Diez ${e.serie && e.serie !== '1' ? `${e.serie}/` : ''}${e.numero.toLocaleString('es-ES')}`
}

export const PDF_PENDIENTE_DIEZ = 'PDF pendiente en Diez'

export function estadoDiez(a: { estado: string }, d: ConDiez, o: { enviando?: boolean } = {}): EstadoDiez {
  if (a.estado === 'propuesto' || a.estado === 'borrador') return { texto: 'Propuesto', corto: 'Propuesto', tono: 'ambar', reintentar: false, enDiez: false }
  if (a.estado === 'anulado') {
    const e = d.envio
    const c = d.contraasiento
    if (e && (e.status === 'enviado' || e.status === 'enlazado') && c && (c.status === 'enviado' || c.status === 'enlazado')) {
      return { texto: `Anulado en ${MARCA.nombre} y en Diez · ${e.serie}/${e.numero} anulada con ${c.serie}/${c.numero}`, corto: `Anulado · en Diez con ${c.serie}/${c.numero}`, tono: 'neutro', reintentar: false, enDiez: true }
    }
    if (e && (e.status === 'enviado' || e.status === 'enlazado')) {
      return { texto: `Anulado en ${MARCA.nombre} · en Diez sigue ${e.serie}/${e.numero}: falta su contraasiento en Diez`, corto: `Anulado · sigue en Diez ${e.serie}/${e.numero}`, tono: 'ambar', reintentar: false, enDiez: true }
    }
    return { texto: 'Anulado', corto: 'Anulado', tono: 'neutro', reintentar: false, enDiez: false }
  }
  if (o.enviando) return { texto: 'Validado · enviando a Diez', corto: 'Enviando a Diez', tono: 'azul', reintentar: false, enDiez: false }
  const no = (motivo: string, reintentar = true): EstadoDiez => ({ texto: `No ha llegado a Diez: ${motivo}`, corto: 'No ha llegado a Diez', tono: 'ambar', reintentar, enDiez: false })
  const e = d.envio
  if (e && (e.status === 'enviado' || e.status === 'enlazado')) {
    if (e.documento === 'adjunto') return { texto: `En Diez · ${e.serie}/${e.numero}`, corto: `En Diez · ${e.serie}/${e.numero}`, tono: 'verde', reintentar: false, enDiez: true }
    if (e.documento === 'pendiente_diez') return { texto: `En Diez · ${e.serie}/${e.numero} · ${PDF_PENDIENTE_DIEZ}`, corto: `En Diez · ${e.serie}/${e.numero} · PDF pendiente`, tono: 'azul', reintentar: false, enDiez: true }
    return no(FALTA_DOCUMENTO)
  }
  if (!d.documento) return no(FALTA_DOCUMENTO)
  if (e?.error && e.error !== 'enviando') return no(e.error, e.intentos < 3)
  if (e?.error === 'enviando') return no(`el envío se cortó a medias: al reintentar, ${MARCA.nombre} lo busca antes en Diez y no envía otro`)
  return no('aún no se ha enviado')
}

/** Lo que dice el diálogo antes de enviar: cuántos y cuánto (R13). */
export function resumenSeleccion(xs: readonly { importe: number }[]): { n: number; total: number } {
  return { n: xs.length, total: deCent(xs.reduce((t, x) => t + cent(x.importe), 0)) }
}

/** El resultado de «Validar y enviar a Diez», con contenido (regla 8). */
export interface PasoEnvio { concepto: string; validado: boolean; documento: boolean; enDiez: boolean; pdfPendiente?: boolean; texto: string }
export function textoResultado(pasos: readonly PasoEnvio[]): string {
  const v = pasos.filter((p) => p.validado).length
  const en = pasos.filter((p) => p.enDiez).length
  const no = pasos.length - en
  const partes = [`${v} de ${pasos.length} ${pasos.length === 1 ? 'validado' : 'validados'}`, `${pasos.filter((p) => p.documento).length} con su documento guardado`]
  const pend = pasos.filter((p) => p.enDiez && p.pdfPendiente).length
  partes.push(en ? `${en} en Diez${pend ? ` (${pend} con el PDF pendiente de adjuntar allí)` : ''}` : 'ninguno en Diez')
  if (no) partes.push(`${no} sin llegar a Diez (debajo, por qué)`)
  return `${partes.join(' · ')}.`
}

/** Lo que cobra la plataforma en un asiento de ventas: su 430, debe menos haber. */
export function cobroDe(apuntes: readonly { cuenta: string; debe: number; haber: number }[]): number {
  return deCent(apuntes.filter((l) => l.cuenta.startsWith('430')).reduce((t, l) => t + cent(l.debe) - cent(l.haber), 0))
}
