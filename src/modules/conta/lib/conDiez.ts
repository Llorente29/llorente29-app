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

import { MARCA } from '../cuenta/marca'
import { cent, deCent } from './libro'

/** Lo que se lee de external_send. */
export interface EnvioDiez {
  status: 'pendiente' | 'enviado' | 'enlazado' | 'rechazado'
  serie: string | null
  numero: number | null
  factura: string | null
  intentos: number
  error: string | null
  documento: 'pendiente' | 'adjunto' | 'fallo' | null
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

export function estadoDiez(a: { estado: string }, d: ConDiez, o: { enviando?: boolean } = {}): EstadoDiez {
  if (a.estado === 'propuesto' || a.estado === 'borrador') return { texto: 'Propuesto', corto: 'Propuesto', tono: 'ambar', reintentar: false, enDiez: false }
  if (a.estado === 'anulado') return { texto: 'Anulado', corto: 'Anulado', tono: 'neutro', reintentar: false, enDiez: false }
  if (o.enviando) return { texto: 'Validado · enviando a Diez', corto: 'Enviando a Diez', tono: 'azul', reintentar: false, enDiez: false }
  const no = (motivo: string, reintentar = true): EstadoDiez => ({ texto: `No ha llegado a Diez: ${motivo}`, corto: 'No ha llegado a Diez', tono: 'ambar', reintentar, enDiez: false })
  const e = d.envio
  if (e && (e.status === 'enviado' || e.status === 'enlazado')) {
    if (e.documento === 'adjunto') return { texto: `En Diez · ${e.serie}/${e.numero}`, corto: `En Diez · ${e.serie}/${e.numero}`, tono: 'verde', reintentar: false, enDiez: true }
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
export interface PasoEnvio { concepto: string; validado: boolean; documento: boolean; enDiez: boolean; texto: string }
export function textoResultado(pasos: readonly PasoEnvio[]): string {
  const v = pasos.filter((p) => p.validado).length
  const en = pasos.filter((p) => p.enDiez).length
  const no = pasos.length - en
  const partes = [`${v} de ${pasos.length} ${pasos.length === 1 ? 'validado' : 'validados'}`, `${pasos.filter((p) => p.documento).length} con su documento guardado`]
  partes.push(en ? `${en} en Diez` : 'ninguno en Diez')
  if (no) partes.push(`${no} sin llegar a Diez (debajo, por qué)`)
  return `${partes.join(' · ')}.`
}

/** Lo que cobra la plataforma en un asiento de ventas: su 430, debe menos haber. */
export function cobroDe(apuntes: readonly { cuenta: string; debe: number; haber: number }[]): number {
  return deCent(apuntes.filter((l) => l.cuenta.startsWith('430')).reduce((t, l) => t + cent(l.debe) - cent(l.haber), 0))
}
