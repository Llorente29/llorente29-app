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
