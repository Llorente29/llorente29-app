// src/modules/conta/erp10/qbo.ts
//
// X33 (25/11) · La contabilidad de QBO a ERP10, lo que dice la pantalla. Puro:
//   · el ajuste «Las facturas las emite Cegid: no se suben las de Sumied» (encendido, desde cuándo, quién) y lo que no
//     sale este mes por él (regla 7: se cuenta, no se esconde);
//   · los asientos de GoCardless del mes (conta_gc_asientos_del_mes): preparados, con su asiento, o en «Pendiente de
//     revisar» con su motivo; y la frase de lo que hizo «Preparar» (regla 8: con contenido).
// Palabras de la calle, las mismas de «Salida a ERP10».

export type FacturasFuera = { encendido: boolean; cambiadoEn: string | null; cambiadoPor: string | null; emitidas: number; recibidas: number }

/** La fila de conta_erp10_facturas_fuera_del_mes. */
export function aFacturasFuera(x: Record<string, unknown> | null | undefined): FacturasFuera {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return { encendido: x?.encendido === true, cambiadoEn: t(x?.cambiado_en), cambiadoPor: t(x?.cambiado_por_nombre), emitidas: n(x?.emitidas), recibidas: n(x?.recibidas) }
}

export const NOMBRE_FACTURAS_FUERA = 'Las facturas las emite Cegid: no se suben las de Sumied'

const facturas = (n: number, clase: 'emitida' | 'recibida') => `${n} ${n === 1 ? 'factura' : 'facturas'} ${clase}${n === 1 ? '' : 's'}`

/** Lo que dice «Qué mirar» con el ajuste encendido (null si está apagado). Nada se esconde: se dice cuántas no salen. */
export function notaFacturasFuera(f: FacturasFuera): { fuerte: string; resto: string } | null {
  if (!f.encendido) return null
  const partes = [f.emitidas ? facturas(f.emitidas, 'emitida') : null, f.recibidas ? facturas(f.recibidas, 'recibida') : null].filter(Boolean) as string[]
  const resto = partes.length
    ? `Este mes no ${f.emitidas + f.recibidas === 1 ? 'sale' : 'salen'} ${partes.join(' ni ')}: las lleva Cegid. Los demás asientos salen como siempre.`
    : 'Este mes no hay ninguna factura validada que dejar fuera. Los demás asientos salen como siempre.'
  return { fuerte: `${NOMBRE_FACTURAS_FUERA}.`, resto }
}

/** «Lo cambió … el …» del ajuste, con la fecha en Madrid (dd/mm/aaaa). Sin fecha, null. */
export function quienLoCambio(f: Pick<FacturasFuera, 'cambiadoEn' | 'cambiadoPor'>): string | null {
  if (!f.cambiadoEn) return null
  const d = new Date(f.cambiadoEn)
  if (Number.isNaN(d.getTime())) return null
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
  return `Lo cambió ${f.cambiadoPor ?? 'alguien'} el ${dia}.`
}

// ── Los asientos de GoCardless del mes ──────────────────────────────────────────────────────────────────────────────

export type ClaseGc = 'cobro' | 'devolucion' | 'ingreso'

export type FilaGc = {
  clase: ClaseGc; gcId: string; fecha: string; importe: number; nombre: string | null; cuenta: string | null; concepto: string
  pendiente: string[]; entryId: string | null; numero: string | null; estado: string | null
  /** X33b · Lo que se dice de la fila sin ser un pendiente (la factura ya estaba cobrada en Sumied). */
  nota: string | null
}

export type AsientosGc = { porPreparar: number; filas: FilaGc[] }

/** Lo que devuelve conta_gc_asientos_del_mes. Una fila rara no tumba la pantalla. */
export function aAsientosGc(x: Record<string, unknown> | null | undefined): AsientosGc {
  const filas = Array.isArray(x?.filas) ? (x!.filas as Record<string, unknown>[]) : []
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return {
    porPreparar: Number.isFinite(Number(x?.por_preparar)) ? Number(x!.por_preparar) : 0,
    filas: filas.map((f) => ({
      clase: (['cobro', 'devolucion', 'ingreso'].includes(String(f.clase)) ? f.clase : 'cobro') as ClaseGc,
      gcId: String(f.gc_id ?? ''), fecha: String(f.fecha ?? ''), importe: Number(f.importe ?? 0), nombre: t(f.nombre), cuenta: t(f.cuenta),
      concepto: t(f.concepto) ?? '', pendiente: Array.isArray(f.pendiente) ? (f.pendiente as unknown[]).map(String) : [],
      entryId: t(f.entry_id), numero: t(f.numero), estado: t(f.estado), nota: t(f.nota),
    })),
  }
}

const QUE: Record<ClaseGc, string> = { cobro: 'Cobro', devolucion: 'Devolución', ingreso: 'Ingreso en el banco' }
export const queEs = (c: ClaseGc) => QUE[c]

/** Lo pendiente arriba (regla 7: está todo, primero lo que hay que mirar); después, por fecha. */
export function enOrden(filas: readonly FilaGc[]): FilaGc[] {
  return [...filas].sort((a, b) => Number(b.pendiente.length > 0) - Number(a.pendiente.length > 0) || a.fecha.localeCompare(b.fecha) || a.gcId.localeCompare(b.gcId))
}

/** El resumen de la tarjeta: cuántos preparados y cuántos en «Pendiente de revisar». Sin nada, null. */
export function resumenGc(a: AsientosGc, mes: string): { fuerte: string; resto: string } | null {
  if (!a.filas.length && !a.porPreparar) return null
  const prep = a.filas.filter((f) => !f.pendiente.length).length
  const pend = a.filas.length - prep
  const partes = [`${prep} ${prep === 1 ? 'preparado' : 'preparados'}`, `${pend} en «Pendiente de revisar»`]
  if (a.porPreparar) partes.push(`${a.porPreparar} por preparar`)
  return { fuerte: `Asientos de GoCardless de ${mes} · ${a.filas.length + a.porPreparar}`, resto: `${partes.join(' · ')}. Se preparan por revisar: no sale ninguno hasta que se valida.` }
}

/** X33b · «Cómo está» de una fila preparada: la nota si la hay (ya cobrada en Sumied: no se escribió otro asiento), o su asiento. */
export function comoEsta(f: Pick<FilaGc, 'pendiente' | 'nota' | 'estado' | 'numero' | 'entryId'>): string {
  if (f.pendiente.length) return `Pendiente de revisar: ${f.pendiente.join(' · ')}`
  if (f.nota) return f.nota
  if (!f.entryId) return '—'
  return f.estado === 'validado' ? `Validado · ${f.numero ?? '—'}` : 'Por revisar'
}

/** Lo que dice «Preparar» al acabar (regla 8): con números, nunca «Hecho». */
export function fraseDePreparar(r: Record<string, unknown> | null | undefined): string {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const p = n(r?.preparados); const y = n(r?.ya_estaban); const q = n(r?.pendientes)
  return `${p} ${p === 1 ? 'preparado' : 'preparados'} · ${y} ya ${y === 1 ? 'estaba' : 'estaban'} · ${q} en «Pendiente de revisar».`
}
