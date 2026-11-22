// src/modules/conta/lib/diaTpv.ts
//
// R15 · Lo que dice la ficha de un día del TPV, sin pantalla: su estado, el
// título, la línea de debajo y el aviso del límite de la factura simplificada
// (Reglamento de facturación, art. 4: 400 €, o 3.000 € IVA incluido en
// hostelería y restauración). El límite lo da la base (conta_tpv_dia_ficha);
// aquí solo se dice. Vale para cualquier TPV: el programa es un dato.

import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { rangoTickets } from '@/modules/conta/lib/subirTpv'

export type EstadoDiaTpv = 'validado' | 'en_espera' | 'por_validar'

export const NOMBRE_ESTADO_DIA: Record<EstadoDiaTpv, { texto: string; tono: 'seguro' | 'duda' | 'neutro' }> = {
  validado: { texto: 'Contabilizado', tono: 'seguro' },
  en_espera: { texto: 'En espera', tono: 'duda' },
  por_validar: { texto: 'Listo para validar', tono: 'neutro' },
}

const fecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** «Revo · 31 oct» */
export const tituloDiaTpv = (programa: string, dia: string) => `${programa} · ${diaMes(dia)}`

/** «Ventas del 31/10/2026 · 48 facturas · tickets 5001 a 5048 · 1.234,56 €» */
export function fraseDiaTpv(d: { dia: string; documentos: number; primero: number | string | null; ultimo: number | string | null; total: number }): string {
  return [`Ventas del ${fecha(d.dia)}`, `${d.documentos.toLocaleString('es-ES')} ${d.documentos === 1 ? 'factura' : 'facturas'}`, rangoTickets(d.primero, d.ultimo), eurosExactos(d.total)]
    .filter(Boolean).join(' · ')
}

/**
 * Punto 4 · El ticket que pasa del límite de la factura simplificada sin NIF del cliente. Null si no hay ninguno.
 * «La factura 5012 (3.240,00 €) pasa del límite de la factura simplificada (3.000 € en hostelería) y no lleva el NIF
 * del cliente: tendría que ser una factura completa.»
 */
export function avisoLimite(sobre: { numero: string; total: number }[], limite: number): string | null {
  if (!sobre.length) return null
  const tope = `${eurosExactos(limite).replace(/,00(\s*€)$/, '$1')}${limite === 3000 ? ' en hostelería' : ''}`
  const xs = sobre.map((x) => `${x.numero} (${eurosExactos(x.total)})`)
  return sobre.length === 1
    ? `La factura ${xs[0]} pasa del límite de la factura simplificada (${tope}) y no lleva el NIF del cliente: tendría que ser una factura completa.`
    : `Las facturas ${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]} pasan del límite de la factura simplificada (${tope}) y no llevan el NIF del cliente: tendrían que ser facturas completas.`
}

/** «Subido por Ana el 31/10 a las 09:12, en una subida de 3 días» */
export function textoSubida(d: { subido_por: string | null; subido_en: string | null; subida: { quien: string | null; cuando: string; dias: number } | null }): string | null {
  const cuando = d.subida?.cuando ?? d.subido_en
  if (!cuando) return null
  const t = new Date(cuando)
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit' }).format(t)
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
  const quien = d.subida?.quien ?? d.subido_por
  const dias = d.subida && d.subida.dias > 1 ? `, en una subida de ${d.subida.dias} días` : ''
  return `Subido${quien ? ` por ${quien}` : ''} el ${dia} a las ${hora}${dias}`
}

/** El asiento con su número: «nº 12» o «sin número». */
export const numeroAsiento = (a: { numero: number | null } | null) => (a?.numero != null ? `nº ${a.numero.toLocaleString('es-ES')}` : 'sin número')

// ── R15b · El día en el libro de IVA ─────────────────────────────────────────

/** Una fila del libro de IVA de un día (conta_tpv_dia_libro). */
export interface FilaLibroDia {
  tipo_factura: string; serie: string | null; numero: string | null; hasta: string | null; documentos: number
  nif: string | null; nombre: string | null; tipo: number; base: number; cuota: number; total: number
}
export type ClaseFilaLibro = 'serie' | 'nif' | 'r5'
export const claseFilaLibro = (f: Pick<FilaLibroDia, 'tipo_factura'>): ClaseFilaLibro =>
  f.tipo_factura === 'F1' ? 'nif' : f.tipo_factura.startsWith('R') ? 'r5' : 'serie'

/**
 * Lo que dice cada fila del libro de un día:
 *   serie: «Tickets 5097 a 5144 · Barra» (o «Ticket 5097» si es uno solo);
 *   factura con NIF: «Factura 5103 · Cliente de ejemplo 7»;
 *   devolución: «Devolución 5047».
 */
export function textoFilaLibro(f: Pick<FilaLibroDia, 'tipo_factura' | 'serie' | 'numero' | 'hasta' | 'nombre'>): string {
  const c = claseFilaLibro(f)
  if (c === 'nif') return `Factura ${f.numero ?? '—'}${f.nombre ? ` · ${f.nombre}` : ''}`
  if (c === 'r5') return `Devolución ${f.numero ?? '—'}`
  const uno = !f.hasta || f.hasta === f.numero
  return `${uno ? 'Ticket' : 'Tickets'} ${f.numero ?? '—'}${uno ? '' : ` a ${f.hasta}`}${f.serie ? ` · ${f.serie}` : ''}`
}

/** El tipo de factura del libro, en palabras: F4 «Resumen de tickets», F2 «Ticket», F1 «Factura», R5 «Rectificativa». */
export const NOMBRE_TIPO_FACTURA: Record<string, string> = { F4: 'Resumen de tickets', F2: 'Ticket', F1: 'Factura', R5: 'Rectificativa' }

/** Las filas del libro, en el orden en que se leen: las series, las facturas con NIF y las devoluciones; cada grupo por su número. */
export function ordenarLibro<T extends Pick<FilaLibroDia, 'tipo_factura' | 'serie' | 'numero' | 'tipo'>>(fs: readonly T[]): T[] {
  const peso = { serie: 1, nif: 2, r5: 3 } as const
  return [...fs].sort((a, b) => peso[claseFilaLibro(a)] - peso[claseFilaLibro(b)] || Number(a.numero ?? 0) - Number(b.numero ?? 0)
    || (a.serie ?? '').localeCompare(b.serie ?? '') || a.tipo - b.tipo)
}
