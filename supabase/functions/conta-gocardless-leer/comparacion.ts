// supabase/functions/conta-gocardless-leer/comparacion.ts
//
// G01 · Tarea 2 (06/11/2026). La comparación de un cliente en un mes: lo que
// suman sus líneas en Sumied (cada una con su tarifa) frente a lo que cobra
// hoy GoCardless con sus suscripciones activas. Es la base del mes en
// paralelo del encargo del recibo: aquí solo se calcula y se explica, no se
// cobra nada.
//
//   · El precio de una línea: su importe propio si lo tiene; si no, la tarifa
//     PROPIA del cliente para ese servicio y emisor que valga ese mes; si no
//     hay, la GENERAL del emisor. La propia manda sobre la general.
//   · Una tarifa vale desde su mes «desde» hasta su mes «hasta» (incluido; sin
//     «hasta», sigue). Si dos valen el mismo mes, la de «desde» más reciente.
//   · Una línea cuenta el mes si está entre su «desde» y su «hasta»
//     (incluido). Un empleado dado de baja en octubre lleva «hasta» octubre:
//     cuenta octubre y no noviembre.
//   · Lo anual se compara al mes: el importe entre 12, al céntimo.
//
// Importes en céntimos (enteros). Puro: lo prueban las unitarias
// (tests/unit/modules/conta/gestoria/comparacion.test.ts).

export type Mes = string // «AAAA-MM»
export type Periodo = 'mes' | 'anio'

export interface Tarifa {
  emisor: string
  servicio: string
  /** Null: la tarifa general del emisor. Con cliente: la propia de ese cliente. */
  clienteId: string | null
  importeCent: number
  periodo: Periodo
  desde: Mes
  hasta: Mes | null
}

export interface Linea {
  id: string
  emisor: string
  servicio: string
  nombreServicio: string
  detalle: string | null
  empleado: string | null
  importePropioCent: number | null
  periodo: Periodo
  desde: Mes
  hasta: Mes | null
  /** La suscripción de GoCardless de la que salió (importación), si salió de una. */
  suscripcionId: string | null
}

export interface SuscripcionActiva {
  id: string
  emisor: string
  nombre: string
  alMesCent: number
}

export interface LineaDelMes {
  lineaId: string
  emisor: string
  texto: string
  alMesCent: number | null
  precio: 'propio de la línea' | 'tarifa propia' | 'tarifa general' | 'sin tarifa'
}

export interface Comparacion {
  mes: Mes
  sumiedCent: number
  gocardlessCent: number
  diferenciaCent: number
  lineas: LineaDelMes[]
  /** La diferencia, en palabras: una frase por cosa que no cuadra. */
  explicaciones: string[]
}

export const vale = (desde: Mes, hasta: Mes | null, mes: Mes) => desde <= mes && (hasta === null || mes <= hasta)

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function nombreDelMes(mes: Mes): string {
  return MESES[Number(mes.slice(5, 7)) - 1] ?? mes
}
export function mesSiguiente(mes: Mes): Mes {
  const a = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}
export function euros(cent: number): string {
  // eslint-disable-next-line no-restricted-syntax -- cálculo local: «cent» es siempre un entero (céntimos), nunca null
  const s = (Math.abs(cent) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '−' : ''}${s} €`
}
const alMes = (importe: number, periodo: Periodo) => (periodo === 'anio' ? Math.round(importe / 12) : importe)

/** La tarifa que vale un mes para un cliente: la propia y, si no hay, la general. */
export function tarifaDelMes(tarifas: Tarifa[], clienteId: string, emisor: string, servicio: string, mes: Mes): { tarifa: Tarifa; propia: boolean } | null {
  const elegir = (lista: Tarifa[]) => lista.filter((t) => vale(t.desde, t.hasta, mes)).sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0))[0] ?? null
  const mismas = tarifas.filter((t) => t.emisor === emisor && t.servicio === servicio)
  const propia = elegir(mismas.filter((t) => t.clienteId === clienteId))
  if (propia) return { tarifa: propia, propia: true }
  const general = elegir(mismas.filter((t) => t.clienteId === null))
  return general ? { tarifa: general, propia: false } : null
}

const textoDeLinea = (l: Linea) => [l.nombreServicio, l.empleado ?? l.detalle].filter(Boolean).join(' · ')

export function comparar(clienteId: string, mes: Mes, lineas: Linea[], tarifas: Tarifa[], suscripciones: SuscripcionActiva[]): Comparacion {
  const delMes: LineaDelMes[] = []
  const explicaciones: string[] = []
  const vigentes = lineas.filter((l) => vale(l.desde, l.hasta, mes))

  for (const l of vigentes) {
    let alMesCent: number | null
    let precio: LineaDelMes['precio']
    if (l.importePropioCent !== null) { alMesCent = alMes(l.importePropioCent, l.periodo); precio = 'propio de la línea' }
    else {
      const t = tarifaDelMes(tarifas, clienteId, l.emisor, l.servicio, mes)
      if (t) { alMesCent = alMes(t.tarifa.importeCent, t.tarifa.periodo); precio = t.propia ? 'tarifa propia' : 'tarifa general' }
      else { alMesCent = null; precio = 'sin tarifa'; explicaciones.push(`${textoDeLinea(l)} no tiene tarifa en ${nombreDelMes(mes)}: no suma nada.`) }
    }
    delMes.push({ lineaId: l.id, emisor: l.emisor, texto: textoDeLinea(l), alMesCent, precio })
  }

  // Lo que cobra GoCardless, contra las líneas de Sumied, una a una.
  const porSuscripcion = new Map(lineas.filter((l) => l.suscripcionId).map((l) => [l.suscripcionId!, l]))
  const activas = new Set(suscripciones.map((s) => s.id))
  for (const s of suscripciones) {
    const l = porSuscripcion.get(s.id)
    if (!l) { explicaciones.push(`GoCardless cobra «${s.nombre}» (${euros(s.alMesCent)} al mes), que no es ninguna línea en Sumied.`); continue }
    const quien = l.empleado ? `a ${l.empleado}` : `«${l.nombreServicio}${l.detalle ? ` · ${l.detalle}` : ''}»`
    if (l.hasta !== null && l.hasta < mes) { explicaciones.push(`GoCardless cobra ${quien}, que está de baja en Sumied desde ${nombreDelMes(mesSiguiente(l.hasta))}.`); continue }
    if (l.desde > mes) { explicaciones.push(`GoCardless ya cobra ${quien}, que en Sumied empieza en ${nombreDelMes(l.desde)}.`); continue }
    const d = delMes.find((x) => x.lineaId === l.id)
    if (d && d.alMesCent !== null && d.alMesCent !== s.alMesCent) {
      explicaciones.push(`${d.texto}: Sumied ${euros(d.alMesCent)} y GoCardless ${euros(s.alMesCent)} al mes.`)
    }
  }
  for (const l of vigentes) {
    if (l.suscripcionId && !activas.has(l.suscripcionId)) explicaciones.push(`${textoDeLinea(l)} está en Sumied, y GoCardless ya no lo cobra.`)
  }

  const sumiedCent = delMes.reduce((t, x) => t + (x.alMesCent ?? 0), 0)
  const gocardlessCent = suscripciones.reduce((t, s) => t + s.alMesCent, 0)
  return { mes, sumiedCent, gocardlessCent, diferenciaCent: sumiedCent - gocardlessCent, lineas: delMes, explicaciones }
}

/** Cuántas líneas de laboral cambian si se cambia la tarifa laboral de un cliente: las vigentes sin importe propio. */
export function afectaA(lineas: Linea[], emisor: string, servicio: string, desde: Mes): number {
  return lineas.filter((l) => l.emisor === emisor && l.servicio === servicio && l.importePropioCent === null && (l.hasta === null || l.hasta >= desde)).length
}
