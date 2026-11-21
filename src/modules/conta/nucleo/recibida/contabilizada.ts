// src/modules/conta/nucleo/recibida/contabilizada.ts
//
// K07 · Una factura, una sola ficha (Julio, 20/11: al validar su primera
// factura de verdad, Sumied le abrió la pantalla de antes). La recibida
// validada y la descartada se abren en la ficha nueva, la misma pantalla: lo
// único que cambia es la franja de arriba, que las casillas no se escriben y
// el asiento con su número. Lo que decide eso, sin React ni red:
//
//   · qué ficha se abre en cada estado (la de antes solo para los abonos y
//     cuando se pide «La ficha completa»);
//   · la franja: «Contabilizada · asiento N» (verde), con lo que dice la base
//     (pagada o por pagar, en ERP10 si ya salió); «Descartada» (gris);
//   · qué se puede hacer con el documento: ponerlo, cambiarlo (se pone al
//     guardar) o cambiarlo en una contabilizada (pide confirmar; el de antes
//     queda en su historial);
//   · lo que hay en «Más», cada cosa con su nombre;
//   · el historial, en frases.

import type { TonoEstado } from '../ficha/piezas'

/** En qué está la recibida que se abre. */
export type ModoRecibida = 'escribir' | 'contabilizada' | 'descartada'

export function modoDeLaRecibida(o: { aMano: boolean; validada: boolean; descartada: boolean }): ModoRecibida {
  if (o.aMano) return 'escribir'
  if (o.descartada) return 'descartada'
  return o.validada ? 'contabilizada' : 'escribir'
}

/** Qué ficha se abre: la nueva siempre, salvo un abono (aún no tiene maqueta) o «La ficha completa» pedida. */
export function queFichaSeAbre(o: { aMano: boolean; completa: boolean; abono: boolean }): 'nueva' | 'completa' {
  if (o.aMano) return 'nueva'
  return o.completa || o.abono ? 'completa' : 'nueva'
}

export interface Franja { tono: TonoEstado; fuerte: string; resto: string }

/** «Contabilizada · asiento 12» con lo que la base dice de ella. */
export function franjaContabilizada(o: { numero: number | null; pagada: boolean; enErp10: boolean }): Franja {
  const partes = [o.pagada ? 'Pagada' : 'Por pagar', ...(o.enErp10 ? ['en ERP10'] : [])]
  return { tono: 'verde', fuerte: `Contabilizada · asiento ${o.numero ?? '—'}.`, resto: `${partes.join(' · ')}.` }
}

export function franjaDescartada(o: { motivo: string | null; quien: string | null }): Franja {
  const porque = o.motivo?.trim() ? `No es una factura: ${o.motivo.trim().replace(/\.$/, '')}` : 'No es una factura'
  return { tono: 'gris', fuerte: 'Descartada.', resto: `${porque}${o.quien ? ` (${o.quien})` : ''}.` }
}

/** La etiqueta del asiento validado, en «El asiento que sale». */
export const etiquetaValidado = (numero: number | null) => `Validado · asiento ${numero ?? '—'}`

export const CONFIRMAR_CAMBIO = 'Cambias el documento de una factura contabilizada. El de antes queda en su historial.'

export type AccionDocumento =
  | { que: 'poner' }
  | { que: 'cambiar' }
  | { que: 'cambiar_contabilizada'; confirmar: string }
  | null

/** Qué se puede hacer con el documento. Descartada: nada (la base no la cambia). */
export function accionDocumento(o: { modo: ModoRecibida; hayDocumento: boolean }): AccionDocumento {
  if (o.modo === 'descartada') return null
  if (!o.hayDocumento) return { que: 'poner' }
  return o.modo === 'contabilizada' ? { que: 'cambiar_contabilizada', confirmar: CONFIRMAR_CAMBIO } : { que: 'cambiar' }
}

/** Lo que se dice al elegir otro documento en una de por revisar: se pone al guardar, sin perder lo escrito. */
export const textoCambioAlGuardar = (nombre: string) =>
  `Documento nuevo: «${nombre}». Se pone al guardar, sin perder lo escrito; el de antes queda en su historial.`

/** Una opción de «Más»: lo hace esta ficha, o abre «La ficha completa» (lo que de verdad aún no está aquí). */
export interface OpcionMas { id: string; texto: string; dato?: string; hace: 'aqui' | 'completa' }

export function opcionesDeMas(o: { modo: ModoRecibida; aMano: boolean; hayDocumento: boolean; porPagar: boolean }): OpcionMas[] {
  if (o.aMano) return []
  const fuera = 'en la ficha completa'
  const doc = accionDocumento({ modo: o.modo, hayDocumento: o.hayDocumento })
  const l: OpcionMas[] = []
  if (doc) l.push({ id: 'documento', texto: doc.que === 'poner' ? 'Poner el documento' : 'Cambiar el documento', hace: 'aqui' })
  if (o.hayDocumento) l.push({ id: 'abrir', texto: 'Abrir el documento aparte', hace: 'aqui' })
  l.push({ id: 'historial', texto: 'Ver el historial', hace: 'aqui' })
  if (o.modo === 'descartada') {
    l.push({ id: 'recuperar', texto: 'Recuperarla', dato: 'Es una factura: vuelve a por revisar', hace: 'aqui' })
    return l
  }
  if (o.modo === 'contabilizada' && o.porPagar) l.push({ id: 'pagar', texto: 'Pagarla', dato: fuera, hace: 'completa' })
  l.push({ id: 'duplicada', texto: 'Marcar como duplicada', dato: fuera, hace: 'completa' })
  l.push({ id: 'descartar', texto: 'Descartarla con su motivo', dato: fuera, hace: 'completa' })
  l.push({ id: 'iva', texto: 'IVA no deducible', dato: fuera, hace: 'completa' })
  l.push({ id: 'comision', texto: 'La comisión de su plataforma', dato: fuera, hace: 'completa' })
  return l
}

/** Un cambio guardado (supplier_invoice_change). */
export interface CambioGuardado { at: string; quien: string | null; que: string; cambios: readonly { campo?: string; antes?: unknown; ahora?: unknown; nombre?: unknown; contabilizada?: unknown }[] }

const nombreDeRuta = (r: unknown) => (typeof r === 'string' && r ? r.replace(/^.*\//, '') : null)
const cuandoEs = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`
}

/** El historial, del más nuevo al más viejo, en frases: «20/11/2026 21:05 · Julio · Documento cambiado: «a.pdf» → «b.pdf»». */
export function lineasDelHistorial(cambios: readonly CambioGuardado[], asiento: { numero: number | null; cuando: string | null; quien: string | null } | null): { cuando: string; quien: string; texto: string }[] {
  const l: { orden: string; cuando: string; quien: string; texto: string }[] = []
  for (const c of cambios) {
    for (const x of c.cambios) {
      if (x.campo === 'documento') {
        const antes = nombreDeRuta(x.antes)
        const ahora = (typeof x.nombre === 'string' && x.nombre) || nombreDeRuta(x.ahora) || 'otro'
        const que = antes ? `Documento cambiado: «${antes}» → «${ahora}»` : `Documento puesto: «${ahora}»`
        l.push({ orden: c.at, cuando: cuandoEs(c.at), quien: c.quien ?? 'alguien', texto: `${que}${x.contabilizada ? ' (ya contabilizada; el asiento no cambió)' : ''}.${antes ? ' El de antes sigue guardado.' : ''}` })
      } else if (x.campo === 'sin_pdf') {
        l.push({ orden: c.at, cuando: cuandoEs(c.at), quien: c.quien ?? 'alguien', texto: 'Ya no está marcada «Sin PDF».' })
      }
    }
    const otros = c.cambios.filter((x) => x.campo && x.campo !== 'documento' && x.campo !== 'sin_pdf').map((x) => String(x.campo))
    if (otros.length) l.push({ orden: c.at, cuando: cuandoEs(c.at), quien: c.quien ?? 'alguien', texto: `Cambió: ${[...new Set(otros)].join(', ')}.` })
  }
  if (asiento?.cuando) l.push({ orden: asiento.cuando, cuando: cuandoEs(asiento.cuando), quien: asiento.quien ?? 'alguien', texto: `Contabilizada: asiento ${asiento.numero ?? '—'}.` })
  return l.sort((a, b) => b.orden.localeCompare(a.orden)).map(({ cuando, quien, texto }) => ({ cuando, quien, texto }))
}

/** ‹ después de validar y pasar: la que se acaba de validar (ya no está en la cola), y si no, la de antes en la cola. */
export function laAnterior(o: { vieneDe: string | null; actual: string; enLaCola: string | null }): string | null {
  if (o.vieneDe && o.vieneDe !== o.actual) return o.vieneDe
  return o.enLaCola
}

/**
 * K08 · Lo que enseña la casilla «Proveedor»: su subcuenta, como la maqueta («40000007»), también en una
 * contabilizada; el nombre va entero en la casilla «Nombre», al lado (Julio, 21/11: el nombre no cabe en
 * los 106 px de la casilla). Sin subcuenta todavía, la que le tocará al validar («40000001»: la línea del
 * asiento dice «Será la…»). Sin ninguna de las dos, el nombre.
 */
export function textoCasillaProveedor(o: { subcuenta: string; futura: string; nombre: string | null }): string {
  return o.subcuenta || o.futura || o.nombre || ''
}
