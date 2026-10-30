// src/modules/conta/lib/correoFacturas.ts
//
// S01c · Lo que no es pantalla de Ajustes › Correo de facturas y de «Llegado
// por correo» en Compras: cuándo llegó algo, en palabras, y qué se hizo con
// cada correo (factura leída y casada, esperando su albarán, no es una
// factura, repetida). Todo en palabras de oficina.

import type { ComparacionLineas, LineaComparada, LlegadaCorreo } from '@/modules/conta/services/comprasService'
import { eurosExactos } from '@/modules/conta/lib/formato'

const HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
const DIA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' })
const diaMadrid = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

/** «hoy a las 10:12», «ayer a las 18:03» o «el 24 de octubre a las 09:30» (hora de Madrid). */
export function cuandoEnPalabras(iso: string, ahora: Date): string {
  const f = new Date(iso)
  const hora = HORA.format(f)
  const dia = diaMadrid(f)
  if (dia === diaMadrid(ahora)) return `hoy a las ${hora}`
  const ayer = new Date(ahora.getTime() - 86_400_000)
  if (dia === diaMadrid(ayer)) return `ayer a las ${hora}`
  return `el ${DIA.format(f)} a las ${hora}`
}

export type TonoLlegada = 'bien' | 'espera' | 'mira' | 'nada'

/** Lo que se hizo con un correo, en una frase. */
export function queSeHizo(l: LlegadaCorreo): { titulo: string; texto: string | null; tono: TonoLlegada } {
  const f = l.factura
  const nombre = f ? `${f.numero ?? f.codigo ?? 'Factura'}${f.proveedor ? ` de ${f.proveedor}` : ''}` : null
  if (l.resultado === 'confirmacion') return { titulo: 'Gmail pide confirmar el reenvío', texto: 'Su código y su enlace están arriba.', tono: 'mira' }
  if (l.llegada === 'repetida' || l.resultado === 'repetido') {
    return { titulo: `Repetida${nombre ? `: ${nombre}` : ''}`, texto: l.motivo ?? 'Ya estaba: no se apunta dos veces.', tono: 'nada' }
  }
  if (l.llegada === 'no_es_factura' || l.resultado === 'no_es_factura') {
    return { titulo: 'No es una factura', texto: l.motivo ?? 'No trae número, total ni bases.', tono: 'nada' }
  }
  if (f && f.casada) return { titulo: `Factura leída y casada: ${nombre}`, texto: l.dicho, tono: l.dicho && /Difiere/.test(l.dicho) ? 'mira' : 'bien' }
  if (f) return { titulo: `Factura esperando su albarán: ${nombre}`, texto: l.dicho ?? 'Cuando llegue su albarán, la caso con él.', tono: 'espera' }
  if (l.llegada === 'error' || l.resultado === 'error') return { titulo: 'No se ha podido leer', texto: l.motivo, tono: 'mira' }
  if (l.resultado === 'apagada') return { titulo: 'La dirección estaba apagada', texto: 'No se ha leído.', tono: 'mira' }
  return { titulo: 'Recibido', texto: l.motivo, tono: 'espera' }
}

const cant = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('es-ES', { maximumFractionDigits: 3 }))
const eur = (x: number | null | undefined) => (x == null ? '—' : eurosExactos(x))

/** Una línea de la comparación, en palabras: qué es, qué dice y si hay que mirarla. */
export function lineaEnPalabras(l: LineaComparada): { que: string; dice: string; mira: boolean } {
  const que = l.texto_factura ?? l.texto_albaran ?? 'Línea sin texto'
  switch (l.resultado) {
    case 'cuadra': return { que, dice: `Cuadra · ${cant(l.cant_factura)} · ${eur(l.importe_factura)}`, mira: false }
    case 'cantidad': return { que, dice: `Difiere en cantidad: la factura dice ${cant(l.cant_factura)} y el albarán ${cant(l.cant_albaran)}`, mira: true }
    case 'importe': return { que, dice: `Difiere en importe: la factura dice ${eur(l.importe_factura)} y el albarán ${eur(l.importe_albaran)}`, mira: true }
    case 'solo_factura': return { que, dice: `En la factura y no en el albarán · ${cant(l.cant_factura)} · ${eur(l.importe_factura)}`, mira: true }
    case 'solo_albaran': return { que, dice: `En el albarán ${l.albaran ?? ''} y no en la factura · ${cant(l.cant_albaran)} · ${eur(l.importe_albaran)}`.replace('  ', ' '), mira: true }
  }
}

/** El resumen: «Las 4 líneas cuadran» o «3 cuadran · 1 difiere · 1 solo en la factura». */
export function resumenLineas(c: ComparacionLineas): string {
  if (c.lineas_factura === 0) return c.solo_albaran > 0 ? 'La factura no trae sus líneas: no se pueden comparar con las del albarán.' : 'Ni la factura ni el albarán traen líneas.'
  if (c.difieren + c.solo_factura + c.solo_albaran === 0) return c.cuadran === 1 ? 'La línea cuadra con el albarán.' : `Las ${c.cuadran} líneas cuadran con el albarán.`
  const partes = [
    c.cuadran ? `${c.cuadran} ${c.cuadran === 1 ? 'cuadra' : 'cuadran'}` : null,
    c.difieren ? `${c.difieren} ${c.difieren === 1 ? 'difiere' : 'difieren'}` : null,
    c.solo_factura ? `${c.solo_factura} solo en la factura` : null,
    c.solo_albaran ? `${c.solo_albaran} solo en el albarán` : null,
  ].filter(Boolean)
  return partes.join(' · ')
}
