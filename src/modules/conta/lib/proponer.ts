// src/modules/conta/lib/proponer.ts
//
// C04 R4 · Qué repasa «Proponer lo pendiente», en puro (con pruebas):
//
//   · Nada con fecha ≤ el corte (imported_until): eso lo trae el programa
//     anterior. Se empieza el día siguiente.
//   · Sin corte y con ventas en Folvy ANTERIORES al ejercicio, no se adivina
//     desde cuándo asienta Folvy: se pregunta («¿Desde qué día asienta
//     Folvy?») y la respuesta se guarda como corte. Si el ejercicio ya tiene
//     asientos, la pregunta ya está contestada con hechos y no se repite.
//   · Del mes más reciente hacia atrás: lo de ayer importa más que lo de
//     junio. Cada vez, un mes de ventas; y se dice cuántos días quedan.

export interface EjercicioParaProponer {
  inicio: string
  fin: string
  traidoHasta: string | null
}

export type Rango =
  | { tipo: 'rango'; desde: string; hasta: string }
  | { tipo: 'preguntar'; porque: string }
  | { tipo: 'nada'; porque: string }

const unDia = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const diaSiguiente = (iso: string) => unDia(iso, 1)
export const diaAnterior = (iso: string) => unDia(iso, -1)
const fecha = (iso: string) => iso.split('-').reverse().join('/')

/**
 * Entre qué fechas se propone, o si antes hay que preguntar. El límite es el
 * ÚLTIMO DÍA CERRADO (cierreDelDia.ts, ultimoDiaCerrado), no hoy: un día no se
 * propone antes de su hora de cierre (encargo del 09/10, regla 2).
 */
export function rangoAProponer(e: EjercicioParaProponer, ultimoCerrado: string, o: { primeraVenta: string | null; asientosEnEjercicio: number }): Rango {
  const hasta = ultimoCerrado < e.fin ? ultimoCerrado : e.fin
  if (e.traidoHasta) {
    const desde = diaSiguiente(e.traidoHasta)
    if (desde > hasta) return { tipo: 'nada', porque: `Hasta el ${fecha(e.traidoHasta)} lo trae el programa anterior: aún no hay días de Folvy en este ejercicio.` }
    return { tipo: 'rango', desde: desde > e.inicio ? desde : e.inicio, hasta }
  }
  if (hasta < e.inicio) return { tipo: 'nada', porque: 'El ejercicio aún no ha empezado.' }
  if (o.primeraVenta && o.primeraVenta < e.inicio && o.asientosEnEjercicio === 0) {
    return { tipo: 'preguntar', porque: `Folvy tiene ventas desde el ${fecha(o.primeraVenta)}, antes de este ejercicio: no sé si este año lo llevaba otro programa.` }
  }
  return { tipo: 'rango', desde: e.inicio, hasta }
}

/** La respuesta a «¿Desde qué día asienta Folvy?», como corte (el día anterior) o un error para enseñar. */
export function corteDesdeRespuesta(e: EjercicioParaProponer, desde: string, hoy: string): { corte: string | null } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { error: 'Escribe una fecha.' }
  if (desde < e.inicio || desde > e.fin) return { error: `Tiene que ser un día del ejercicio (${fecha(e.inicio)}–${fecha(e.fin)}).` }
  if (desde > hoy) return { error: 'No puede ser un día que aún no ha llegado.' }
  // Desde el primer día: todo el ejercicio es de Folvy, no hay corte.
  return { corte: desde === e.inicio ? null : diaAnterior(desde) }
}

/**
 * De los días con ventas sin asiento (uno por local y día), cuáles se
 * proponen ahora (los del mes más reciente que tenga alguno) y cuántos DÍAS
 * quedan para después. Los días van del más reciente al más antiguo.
 */
export function tandaDeDias<T extends { dia: string }>(pendientes: readonly T[]): { ahora: T[]; mes: string | null; quedanDias: number } {
  if (!pendientes.length) return { ahora: [], mes: null, quedanDias: 0 }
  const orden = [...pendientes].sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0))
  const mes = orden[0].dia.slice(0, 7)
  const ahora = orden.filter((d) => d.dia.slice(0, 7) === mes)
  const quedanDias = new Set(orden.filter((d) => d.dia.slice(0, 7) !== mes).map((d) => d.dia)).size
  return { ahora, mes, quedanDias }
}
