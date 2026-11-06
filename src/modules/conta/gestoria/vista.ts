// src/modules/conta/gestoria/vista.ts
//
// G01 · Tarea 4 · Lo que deciden las pantallas de Clientes y cuotas sin pintar
// (con sus pruebas en tests/unit/modules/conta/gestoria/vista.test.ts):
//   · los chips de «Te toca hoy», cada uno con su número (el marco esconde los
//     que dan 0), y qué filas deja ver cada uno;
//   · las letras de servicios (C contabilidad y gestoría, L laboral, S otros);
//   · la figura (sociedad o autónomo) que dice el NIF;
//   · la ficha: cada servicio con su tarifa y, debajo, cada empleado con la
//     suya, el total, lo que cobra hoy GoCardless y la diferencia en palabras
//     (la misma comparación que la lectura: comparacion.ts).
// Palabras de oficina: domiciliación, tarifa, línea, cobro, mandato, empleado.

import {
  comparar, euros, tarifaDelMes, vale, type Comparacion, type Linea, type Mes, type SuscripcionActiva, type Tarifa,
} from '../../../../supabase/functions/conta-gocardless-leer/comparacion'

export type TipoDiferencia =
  | 'bitrix_sin_cobro' | 'gocardless_sin_ficha' | 'emisor_distinto' | 'nif_repetido_en_bitrix' | 'correo_repetido_en_bitrix'
  | 'nif_distinto' | 'suscripcion_sin_convertir' | 'totales_distintos' | 'mandato_por_firmar' | 'falla_a_menudo' | 'abono_en_otra_cuenta'

export interface Diferencia {
  id: string
  tipo: TipoDiferencia
  porque: string
  clienteId: string | null
  emisorId: string | null
  gcClienteId: string | null
}

export interface Cobro { fecha: string; importeCent: number; estado: string; motivo: string | null }

/** Una fila de la tabla: un cliente con un emisor (o, sin ficha, alguien que solo está en GoCardless). */
export interface ClienteGestoria {
  id: string
  clienteId: string | null
  nombre: string
  nif: string | null
  emisorId: string
  emisor: string
  /** Lo que dice Bitrix24 (de referencia). */
  bitrix: { situacion: string | null; formaPago: string | null; servicios: string[] } | null
  formaCobro: 'gocardless' | 'transferencia' | 'remesa' | 'tarjeta' | null
  /** El estado del mandato en GoCardless, tal cual (active, pending_customer_approval…). */
  mandato: string | null
  cobros: Cobro[]
  diferencias: Diferencia[]
}

/** Los chips de «Te toca hoy», en su orden, con su texto. Fase 1: sin «Empleado que no está en Laboral». */
export const CHIPS: readonly { id: string; tipos: readonly TipoDiferencia[]; etiqueta: string }[] = [
  { id: 'sin-cobro', tipos: ['bitrix_sin_cobro'], etiqueta: 'En Bitrix24 sin cobro en GoCardless' },
  { id: 'sin-ficha', tipos: ['gocardless_sin_ficha'], etiqueta: 'En GoCardless sin ficha en Bitrix24' },
  { id: 'emisor', tipos: ['emisor_distinto'], etiqueta: 'Bitrix24 y GoCardless no coinciden en el emisor' },
  { id: 'sin-convertir', tipos: ['suscripcion_sin_convertir'], etiqueta: 'Suscripción sin convertir en tarifa' },
  { id: 'totales', tipos: ['totales_distintos'], etiqueta: 'Sumied y GoCardless no dan el mismo total' },
  { id: 'por-firmar', tipos: ['mandato_por_firmar'], etiqueta: 'Mandato pendiente de firma' },
  { id: 'fallan', tipos: ['falla_a_menudo'], etiqueta: 'Fallan a menudo (3 o más en 6 meses)' },
]

/** Cuántos clientes tiene cada chip (un cliente con dos diferencias del mismo chip cuenta una vez). */
export function contarChips(filas: readonly ClienteGestoria[]): Record<string, number> {
  const r: Record<string, number> = {}
  for (const c of CHIPS) r[c.id] = filas.filter((f) => f.diferencias.some((d) => c.tipos.includes(d.tipo))).length
  return r
}

export function filtrarPorChip(filas: readonly ClienteGestoria[], chip: string | null): ClienteGestoria[] {
  const c = CHIPS.find((x) => x.id === chip)
  return c ? filas.filter((f) => f.diferencias.some((d) => c.tipos.includes(d.tipo))) : [...filas]
}

/** El emisor elegido en la barra: uno, o «Los dos» (todos). */
export const filtrarPorEmisor = (filas: readonly ClienteGestoria[], emisor: string | null) =>
  emisor ? filas.filter((f) => f.emisorId === emisor) : [...filas]

/** Las letras de lo que se le cobra: C (contabilidad y gestoría), L (laboral), S (otros servicios). */
export function letrasDeServicios(lineas: readonly Linea[]): ('C' | 'L' | 'S')[] {
  const s = new Set<'C' | 'L' | 'S'>()
  for (const l of lineas) s.add(l.servicio === 'gestoria_mensual' ? 'C' : l.servicio === 'gestion_laboral' ? 'L' : 'S')
  return (['C', 'L', 'S'] as const).filter((x) => s.has(x))
}
export const NOMBRE_LETRA = { C: 'Contabilidad y gestoría', L: 'Laboral', S: 'Otros servicios' } as const

/** Sociedad o autónomo, por el NIF (la letra del principio). Sin NIF, no se dice. */
export function figura(nif: string | null): 'Sociedad' | 'Autónomo' | null {
  const n = (nif ?? '').trim().toUpperCase()
  if (!n) return null
  if (/^[0-9XYZKLM]/.test(n)) return 'Autónomo'
  if (/^[ABCDEFGHJNPQRSUVW]/.test(n)) return 'Sociedad'
  return null
}

export const empleadosDe = (lineas: readonly Linea[], mes: Mes) =>
  lineas.filter((l) => l.servicio === 'gestion_laboral' && l.empleado && vale(l.desde, l.hasta, mes)).length

export const FORMA_COBRO: Record<string, string> = {
  gocardless: 'Domiciliación (GoCardless)', remesa: 'Remesa del banco', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
}

export function textoMandato(estado: string | null): { texto: string; tono: 'verde' | 'ambar' | 'gris' } {
  switch (estado) {
    case 'active': return { texto: 'Firmado', tono: 'verde' }
    case 'pending_submission': case 'submitted': return { texto: 'Camino del banco', tono: 'ambar' }
    case 'pending_customer_approval': return { texto: 'Por firmar', tono: 'ambar' }
    case 'cancelled': return { texto: 'Cancelado', tono: 'gris' }
    case 'failed': return { texto: 'Rechazado por el banco', tono: 'gris' }
    case 'expired': return { texto: 'Caducado', tono: 'gris' }
    case 'blocked': return { texto: 'Bloqueado', tono: 'gris' }
    case null: return { texto: 'Sin mandato', tono: 'gris' }
    default: return { texto: estado, tono: 'gris' }
  }
}

export function textoCobro(estado: string): { texto: string; tono: 'verde' | 'ambar' | 'rojo' | 'gris' } {
  if (['paid_out', 'confirmed'].includes(estado)) return { texto: 'Cobrado', tono: 'verde' }
  if (['pending_submission', 'submitted', 'pending_customer_approval'].includes(estado)) return { texto: 'En camino', tono: 'ambar' }
  if (['failed', 'charged_back', 'customer_approval_denied'].includes(estado)) return { texto: estado === 'charged_back' ? 'Devuelto' : 'Fallido', tono: 'rojo' }
  if (estado === 'cancelled') return { texto: 'Cancelado', tono: 'gris' }
  return { texto: estado, tono: 'gris' }
}

/** Lo de la ficha: cada servicio con su tarifa, los empleados debajo y lo que cobra GoCardless. */
export interface Ficha {
  servicios: { servicio: string; nombre: string; tarifa: string; filas: { texto: string; importe: string }[]; totalCent: number }[]
  comparacion: Comparacion
  /** La diferencia en palabras: «Cuadra con GoCardless» o la explicación. */
  diferencia: string[]
}

export function fichaDe(clienteId: string, emisor: string, mes: Mes, lineas: Linea[], tarifas: Tarifa[], suscripciones: SuscripcionActiva[]): Ficha {
  const comp = comparar(clienteId, mes, lineas.filter((l) => l.emisor === emisor), tarifas, suscripciones.filter((s) => s.emisor === emisor))
  const delMes = new Map(comp.lineas.map((x) => [x.lineaId, x]))
  const porServicio = new Map<string, Linea[]>()
  for (const l of lineas) if (l.emisor === emisor && vale(l.desde, l.hasta, mes)) porServicio.set(l.servicio, [...(porServicio.get(l.servicio) ?? []), l])
  const servicios = [...porServicio.entries()].map(([servicio, ls]) => {
    const t = tarifaDelMes(tarifas, clienteId, emisor, servicio, mes)
    const tarifa = t ? `${euros(t.tarifa.importeCent)} ${t.tarifa.periodo === 'anio' ? 'al año' : 'al mes'} · ${t.propia ? 'tarifa propia' : 'tarifa general'}` : 'Sin tarifa'
    const filas = ls.map((l) => {
      const d = delMes.get(l.id)
      const quien = l.empleado ?? l.detalle ?? l.nombreServicio
      return { texto: `${l.nombreServicio}${quien !== l.nombreServicio ? ` · ${quien}` : ''}`, importe: d?.alMesCent == null ? 'Sin tarifa' : euros(d.alMesCent) }
    })
    const totalCent = ls.reduce((s, l) => s + (delMes.get(l.id)?.alMesCent ?? 0), 0)
    return { servicio, nombre: ls[0].nombreServicio, tarifa, filas, totalCent }
  })
  const diferencia = comp.diferenciaCent === 0
    ? [`Cuadra con GoCardless: ${euros(comp.sumiedCent)} al mes en los dos.`]
    : [`Sumied ${euros(comp.sumiedCent)} y GoCardless ${euros(comp.gocardlessCent)} al mes: ${comp.diferenciaCent > 0 ? 'Sumied' : 'GoCardless'} ${euros(Math.abs(comp.diferenciaCent))} más.`, ...comp.explicaciones]
  return { servicios, comparacion: comp, diferencia }
}

/** La frase de una diferencia para la tabla: cuántas y la primera. */
export function textoDiferencias(d: readonly Diferencia[]): string {
  if (d.length === 0) return 'Ninguna'
  return d.length === 1 ? CHIPS.find((c) => c.tipos.includes(d[0].tipo))?.etiqueta ?? d[0].porque : `${d.length} diferencias`
}

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** Los meses que se pueden elegir: este y los 11 siguientes. */
export function mesesDesde(mes: string, n = 12): { valor: string; texto: string }[] {
  let [a, m] = mes.split('-').map(Number)
  const r: { valor: string; texto: string }[] = []
  for (let i = 0; i < n; i++) {
    r.push({ valor: `${a}-${String(m).padStart(2, '0')}-01`, texto: `${MESES[m - 1]} de ${a}` })
    m += 1; if (m > 12) { m = 1; a += 1 }
  }
  return r
}
/** «24,20» → 24.2; null si no es un importe. */
export function leerImporte(t: string): number | null {
  const s = t.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Number(s)
}

export { euros }
