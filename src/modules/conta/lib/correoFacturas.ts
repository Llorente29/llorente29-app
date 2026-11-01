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
  // S01i · Un correo sin PDF ni enlace (Just Eat manda la factura escrita en el cuerpo): no se pierde, se dice.
  if (l.resultado === 'sin_facturas') {
    return { titulo: 'Sin factura que leer', texto: l.motivo ?? 'No trae ningún PDF ni enlace. Si la factura va escrita en el propio correo (la de Just Eat), aún no se lee: queda aquí apuntado para que la subas.', tono: 'mira' }
  }
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

// ── S01j·2 · Qué salió de cada correo (maquetas 1 y 2, aprobadas por Julio el 01/11) ──

const NOMBRE_PLATAFORMA: Record<string, string> = { glovo: 'Glovo', justeat: 'Just Eat' }
/** «Glovo» o «Just Eat», por la plataforma del correo; si no se sabe, null. */
export const nombrePlataforma = (p: string | null | undefined): string | null => (p ? NOMBRE_PLATAFORMA[p] ?? null : null)

/** «1–15/10», o «16/09–15/10» si cambia de mes; sin periodo, null. */
export function periodoCorto(desde: string | null | undefined, hasta: string | null | undefined): string | null {
  if (!desde || !hasta) return null
  const [, md, dd] = desde.slice(0, 10).split('-')
  const [, mh, dh] = hasta.slice(0, 10).split('-')
  return md === mh ? `${Number(dd)}–${Number(dh)}/${mh}` : `${dd}/${md}–${dh}/${mh}`
}

export type TonoChip = 'bien' | 'mira' | 'falta' | 'nada'
export interface QueSalio { titulo: string; texto: string | null; chip: { texto: string; tono: TonoChip } }

/** «te ingresa 236,27 €» o, si sale negativa, «le debes 5,98 €». */
export function frasePago(neto: number | null | undefined): string | null {
  if (neto == null) return null
  return neto < 0 ? `le debes ${eurosExactos(-neto)}` : `te ingresa ${eurosExactos(neto)}`
}

/**
 * Lo que salió de un correo, en una línea de título, una de apoyo y su estado:
 * la factura y la liquidación de Glovo (por su Excel), las de Just Eat (por su
 * cuerpo), el Excel que se quedó sin leer, o el que no venía. Lo demás, como
 * siempre (queSeHizo). Nunca se esconde lo que falta (regla 7).
 */
export function queSalio(l: LlegadaCorreo): QueSalio {
  const plat = nombrePlataforma(l.plataforma) ?? l.liquidaciones?.[0]?.plataforma ?? null
  const f = l.factura ?? (l.factura_comision ? { ...l.factura_comision, proveedor: null, casada: false } : null)
  const nFactura = f ? (f.numero ?? f.codigo ?? 'sin número') : null
  const liqs = l.liquidaciones ?? []
  if (liqs.length > 0) {
    const x = liqs[0]
    const donde = [x.tienda, x.local, periodoCorto(x.desde, x.hasta)].filter(Boolean).join(' · ')
    const deQue = liqs.length === 1 ? `liquidación de ${plat ?? x.plataforma ?? 'la plataforma'}` : `${liqs.length} liquidaciones de ${plat ?? x.plataforma ?? 'la plataforma'}`
    const titulo = `${nFactura ? `Factura ${nFactura} y ` : ''}${nFactura ? deQue : deQue.charAt(0).toUpperCase() + deQue.slice(1)}${donde ? ` · ${donde}` : ''}`
    const todasDeOtro = liqs.every((y) => y.otro_correo)
    const pago = liqs.length === 1 ? frasePago(x.neto) : null
    const texto = todasDeOtro
      ? `Ya había entrado con otro correo: no se ha creado otra${liqs.length === 1 ? '' : 's'}.${pago ? ` ${pago.charAt(0).toUpperCase()}${pago.slice(1)}.` : ''}`
      : pago
    if (l.factura_comision?.en_revision) {
      return { titulo, texto: l.factura_comision.nota ?? 'Su factura de comisión queda en revisión; la liquidación sí entró.', chip: { texto: 'En revisión · la factura', tono: 'mira' } }
    }
    if (!f) return { titulo, texto, chip: { texto: 'Entró la liquidación', tono: 'bien' } }
    return { titulo, texto, chip: { texto: x.pago_el ? `Ligadas · se paga el ${x.pago_el.slice(8, 10)}/${x.pago_el.slice(5, 7)}` : 'Ligadas', tono: 'bien' } }
  }
  if (l.excel === 'sin_leer') {
    return {
      titulo: nFactura ? `Factura ${nFactura} de ${plat ?? 'Glovo'}` : `Correo de ${plat ?? 'Glovo'}`,
      texto: 'Entró antes de que se leyera el Excel: la liquidación se quedó sin leer. Vuelve a leerlo desde el ⋯.',
      chip: { texto: 'Falta leer el Excel', tono: 'falta' },
    }
  }
  if (l.excel === 'no_traia' && f) {
    return {
      titulo: `Factura ${nFactura} de ${plat ?? 'Glovo'}`,
      texto: 'Este correo no traía Excel: la liquidación de esta quincena sigue faltando.',
      chip: { texto: 'Falta la liquidación', tono: 'falta' },
    }
  }
  const q = queSeHizo(l)
  const tono: TonoChip = q.tono === 'bien' ? 'bien' : q.tono === 'mira' ? 'mira' : q.tono === 'espera' ? 'falta' : 'nada'
  const chip = q.tono === 'bien' ? 'Hecho' : q.tono === 'mira' ? 'Mírala' : q.tono === 'espera' ? 'Esperando' : 'Nada que hacer'
  return { titulo: q.titulo, texto: q.texto, chip: { texto: chip, tono } }
}

/** Lo que se puede hacer con una llegada desde su ⋯ (solo lo que tiene sentido para ella). */
export function accionesDeLlegada(l: LlegadaCorreo): ('releer' | 'releer_plataforma' | 'factura' | 'liquidacion')[] {
  const a: ('releer' | 'releer_plataforma' | 'factura' | 'liquidacion')[] = []
  if (l.email_id && l.resultado !== 'confirmacion') a.push('releer')
  if (l.plataforma) a.push('releer_plataforma')
  if (l.factura?.id || l.factura_comision?.id) a.push('factura')
  if ((l.liquidaciones ?? []).length > 0) a.push('liquidacion')
  return a
}
