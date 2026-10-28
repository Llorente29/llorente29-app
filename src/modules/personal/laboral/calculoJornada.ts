// src/modules/personal/laboral/calculoJornada.ts
//
// L1a · PR 2 (28/10/2026). El cálculo de las horas del registro de jornada,
// sin red ni pantalla: lo usan el informe para la Inspección, el resumen que
// firma la persona y las pruebas (tests/unit/laboral/calculoJornada.test.ts).
//
// Las reglas, dichas una vez:
//   · Las horas salen de las marcas tal cual (la hora del servidor, o la
//     corregida con su rastro), nunca redondeadas: el redondeo no vale ante la
//     Inspección.
//   · Una jornada (un tramo) va de una entrada a la siguiente salida. Es del
//     día de su ENTRADA, en hora de Madrid: la que acaba pasada la medianoche
//     cuenta el día que empezó. Una jornada partida son dos tramos el mismo
//     día, y los dos constan.
//   · Se resta el tiempo de pausa (de cada «pausa» a su «vuelta»).
//   · Las horas se miden entre instantes, no entre horas del reloj: la noche
//     del cambio de hora de octubre dura una hora más, y así se cuenta.
//   · Una entrada sin salida (llega otra entrada antes, o lleva más de un día
//     abierta) no suma horas, y se dice; nunca se inventa una salida.
//   · Ordinarias y extra se cuentan por semana (de lunes a domingo) frente a la
//     jornada del contrato; una semana que el periodo coge a medias cuenta la
//     parte proporcional de sus días.

export type TipoMarca = 'entrada' | 'salida' | 'pausa_inicio' | 'pausa_fin'

export interface MarcaJornada {
  id: string
  tipo: TipoMarca
  /** ISO: el instante de la marca. */
  hora: string
  anulada?: boolean
}

export interface Pausa {
  inicio: string
  fin: string | null
  minutos: number
}

export type EstadoTramo = 'cerrado' | 'abierto' | 'sin_salida'

export interface Tramo {
  entradaId: string
  entrada: string
  salidaId: string | null
  salida: string | null
  pausas: Pausa[]
  minutosPresencia: number
  minutosPausa: number
  minutosTrabajados: number
  /** cerrado: con salida · abierto: en curso (menos de un día) · sin_salida: no la tendrá. */
  estado: EstadoTramo
  /** Más de 12 horas de la entrada a la salida. */
  larga: boolean
}

export interface DiaJornada {
  /** AAAA-MM-DD, en hora de Madrid. */
  dia: string
  tramos: Tramo[]
  minutosTrabajados: number
  minutosPausa: number
}

export interface SemanaJornada {
  /** El lunes de la semana (AAAA-MM-DD). */
  lunes: string
  diasEnElPeriodo: number
  minutosTrabajados: number
  /** null: el contrato no dice la jornada. */
  minutosContrato: number | null
  minutosOrdinarios: number
  minutosExtra: number | null
}

export interface TotalesJornada {
  semanas: SemanaJornada[]
  minutosTrabajados: number
  minutosOrdinarios: number
  minutosExtra: number | null
  minutosContrato: number | null
  diasTrabajados: number
  tramosSinSalida: number
}

const ZONA = 'Europe/Madrid'
const UN_DIA_MS = 24 * 3600 * 1000
const LARGA_MIN = 12 * 60

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtHora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** El día (AAAA-MM-DD) de un instante, en Madrid. */
export function diaMadrid(iso: string): string {
  return fmtDia.format(new Date(iso))
}

/** «09:05», en Madrid. */
export function horaMadrid(iso: string): string {
  return fmtHora.format(new Date(iso))
}

const minutosEntre = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000))

/**
 * Las marcas, en tramos de entrada a salida con sus pausas. Las anuladas no
 * cuentan (constan en el informe como corrección, no aquí).
 */
export function armarTramos(marcas: MarcaJornada[], ahora: Date = new Date()): { tramos: Tramo[]; salidasSueltas: MarcaJornada[] } {
  const vivas = marcas.filter(m => !m.anulada).sort((a, b) => Date.parse(a.hora) - Date.parse(b.hora) || a.id.localeCompare(b.id))
  const tramos: Tramo[] = []
  const salidasSueltas: MarcaJornada[] = []
  let abierto: { entrada: MarcaJornada; pausas: { inicio: string; fin: string | null }[] } | null = null

  const cerrar = (salida: MarcaJornada | null) => {
    if (!abierto) return
    const { entrada, pausas } = abierto
    const fin = salida?.hora ?? null
    const pausasHechas: Pausa[] = pausas.map(p => {
      const hasta = p.fin ?? fin
      return { inicio: p.inicio, fin: p.fin, minutos: hasta ? minutosEntre(p.inicio, hasta) : 0 }
    })
    const presencia = fin ? minutosEntre(entrada.hora, fin) : 0
    const pausa = fin ? pausasHechas.reduce((s, p) => s + p.minutos, 0) : 0
    const estado: EstadoTramo = salida
      ? 'cerrado'
      : 'sin_salida'
    tramos.push({
      entradaId: entrada.id, entrada: entrada.hora, salidaId: salida?.id ?? null, salida: fin,
      pausas: pausasHechas, minutosPresencia: presencia, minutosPausa: pausa,
      minutosTrabajados: Math.max(0, presencia - pausa), estado, larga: presencia > LARGA_MIN,
    })
    abierto = null
  }

  for (const m of vivas) {
    if (m.tipo === 'entrada') {
      cerrar(null) // una entrada antes de cerrar la anterior: esa queda sin salida
      abierto = { entrada: m, pausas: [] }
    } else if (m.tipo === 'pausa_inicio') {
      if (abierto) abierto.pausas.push({ inicio: m.hora, fin: null })
    } else if (m.tipo === 'pausa_fin') {
      const p = abierto?.pausas.find(x => x.fin === null)
      if (p) p.fin = m.hora
    } else if (m.tipo === 'salida') {
      if (abierto) cerrar(m)
      else salidasSueltas.push(m)
    }
  }
  if (abierto) {
    const a: { entrada: MarcaJornada; pausas: { inicio: string; fin: string | null }[] } = abierto
    const reciente = ahora.getTime() - Date.parse(a.entrada.hora) < UN_DIA_MS
    cerrar(null)
    if (reciente) tramos[tramos.length - 1].estado = 'abierto'
  }
  return { tramos, salidasSueltas }
}

/** Los días del periodo (los dos incluidos), AAAA-MM-DD. */
export function diasDelPeriodo(desde: string, hasta: string): string[] {
  const out: string[] = []
  const [y, m, d] = desde.split('-').map(Number)
  let t = Date.UTC(y, m - 1, d)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const fin = Date.UTC(y2, m2 - 1, d2)
  while (t <= fin) {
    out.push(new Date(t).toISOString().slice(0, 10))
    t += UN_DIA_MS
  }
  return out
}

/** Todos los días del periodo, también los que no se trabajó, con sus tramos. */
export function jornadasPorDia(marcas: MarcaJornada[], desde: string, hasta: string, ahora: Date = new Date()): DiaJornada[] {
  const { tramos } = armarTramos(marcas, ahora)
  const porDia = new Map<string, Tramo[]>()
  for (const t of tramos) {
    const d = diaMadrid(t.entrada)
    porDia.set(d, [...(porDia.get(d) ?? []), t])
  }
  return diasDelPeriodo(desde, hasta).map(dia => {
    const ts = porDia.get(dia) ?? []
    return {
      dia, tramos: ts,
      minutosTrabajados: ts.reduce((s, t) => s + t.minutosTrabajados, 0),
      minutosPausa: ts.reduce((s, t) => s + t.minutosPausa, 0),
    }
  })
}

/** El lunes (AAAA-MM-DD) de la semana de un día. */
export function lunesDe(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const dow = new Date(t).getUTCDay() // 0 domingo
  return new Date(t - ((dow + 6) % 7) * UN_DIA_MS).toISOString().slice(0, 10)
}

/** Ordinarias y extra por semana, frente a la jornada del contrato. */
export function totalesJornada(dias: DiaJornada[], horasSemana: number | null | undefined): TotalesJornada {
  const contratoSemana = horasSemana && horasSemana > 0 ? horasSemana * 60 : null
  const semanas = new Map<string, SemanaJornada>()
  for (const d of dias) {
    const l = lunesDe(d.dia)
    const s = semanas.get(l) ?? { lunes: l, diasEnElPeriodo: 0, minutosTrabajados: 0, minutosContrato: null, minutosOrdinarios: 0, minutosExtra: null }
    s.diasEnElPeriodo += 1
    s.minutosTrabajados += d.minutosTrabajados
    semanas.set(l, s)
  }
  const lista = [...semanas.values()].map(s => {
    const contrato = contratoSemana === null ? null : Math.round((contratoSemana * s.diasEnElPeriodo) / 7)
    return {
      ...s,
      minutosContrato: contrato,
      minutosOrdinarios: contrato === null ? s.minutosTrabajados : Math.min(s.minutosTrabajados, contrato),
      minutosExtra: contrato === null ? null : Math.max(0, s.minutosTrabajados - contrato),
    }
  })
  const suma = (f: (s: SemanaJornada) => number) => lista.reduce((t, s) => t + f(s), 0)
  return {
    semanas: lista,
    minutosTrabajados: suma(s => s.minutosTrabajados),
    minutosOrdinarios: suma(s => s.minutosOrdinarios),
    minutosExtra: contratoSemana === null ? null : suma(s => s.minutosExtra ?? 0),
    minutosContrato: contratoSemana === null ? null : suma(s => s.minutosContrato ?? 0),
    diasTrabajados: dias.filter(d => d.tramos.some(t => t.estado === 'cerrado')).length,
    tramosSinSalida: dias.reduce((n, d) => n + d.tramos.filter(t => t.estado === 'sin_salida').length, 0),
  }
}

/** «4 h 46», «118 h 00», «0 h 55»; cero, «0». */
export function horasYMinutos(minutos: number | null | undefined): string {
  if (minutos == null) return '—'
  if (minutos === 0) return '0'
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/** «Jue 23». */
export function diaCorto(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  return `${DIAS_CORTOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`
}

/** «12/10/2026». */
export function fechaLarga(dia: string): string {
  const [y, m, d] = dia.split('-')
  return `${d}/${m}/${y}`
}

/** «12/10/2026 a las 09:05», de un instante, en Madrid. */
export function fechaYHora(iso: string): string {
  return `${fechaLarga(diaMadrid(iso))} a las ${horaMadrid(iso)}`
}
