// src/modules/conta/laboral/ficha/tiempo/tiempoTextos.ts
//
// N1 · PR 3 (02/11/2026) · La pestaña «Tiempo y turnos» de la ficha (maquetas
// 10 y 10b, aprobadas por Julio en la N1·8), sin pantalla, para probarla sola.
// Todo sale de lo que ya existe: las marcas del registro de jornada, el
// cuadrante publicado de su local, sus firmas del mes y la bolsa de horas. Lo
// que no está, se dice; nunca un número inventado. Palabras sin género: Sumied
// es para cualquier persona (N1·8).

import {
  diaCorto, diaMadrid, horaMadrid, horasYMinutos, jornadasPorDia, lunesDe,
  type DiaJornada, type MarcaJornada,
} from '@/modules/personal/laboral/calculoJornada'
import { nombreDelMes } from '@/modules/personal/laboral/firmaDelMes'
import type { Schedule, ShiftTemplate } from '@/types/scheduler'

export interface TurnoDelDia { inicio: string; fin: string; nombre: string }

/** Los turnos de la persona cada día de la semana, del cuadrante PUBLICADO. Sin publicar, null (no se sabe). */
export function turnosDeLaSemana(cuadrante: Schedule | null, plantillas: ShiftTemplate[], employeeId: string): Record<string, TurnoDelDia[]> | null {
  if (!cuadrante || cuadrante.status !== 'published') return null
  const porId = new Map(plantillas.map((p) => [p.id, p]))
  const dias = diasDeLaSemana(cuadrante.week_start)
  const r: Record<string, TurnoDelDia[]> = Object.fromEntries(dias.map((d) => [d, []]))
  for (const [plantillaId, porDia] of Object.entries(cuadrante.cells ?? {})) {
    const p = porId.get(plantillaId)
    for (const [dow, personas] of Object.entries(porDia ?? {})) {
      if (!personas?.includes(employeeId)) continue
      const dia = dias[Number(dow)]
      if (!dia) continue
      r[dia].push(p ? { inicio: p.start_time.slice(0, 5), fin: p.end_time.slice(0, 5), nombre: p.label } : { inicio: '?', fin: '?', nombre: 'turno borrado' })
    }
  }
  for (const d of dias) r[d].sort((a, b) => a.inicio.localeCompare(b.inicio))
  return r
}

/** Los siete días (AAAA-MM-DD) de la semana que empieza el lunes `lunes`. */
export function diasDeLaSemana(lunes: string): string[] {
  const [y, m, d] = lunes.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10))
}

/** El lunes de la semana `desplazamiento` semanas antes (negativo) o después de la de `hoy`. */
export function lunesConDesplazamiento(hoy: string, desplazamiento: number): string {
  const [y, m, d] = lunesDe(hoy).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + desplazamiento * 7)).toISOString().slice(0, 10)
}

const MESES_DE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «del 26 de octubre al 1 de noviembre». */
export function textoSemana(lunes: string): string {
  const dias = diasDeLaSemana(lunes)
  const t = (dia: string) => `${Number(dia.slice(8, 10))} de ${MESES_DE[Number(dia.slice(5, 7)) - 1]}`
  return `del ${t(dias[0])} al ${t(dias[6])}`
}

export interface FilaDia {
  dia: string
  diaTexto: string
  /** null: el cuadrante de esa semana no está publicado. [] : libre. */
  turnos: TurnoDelDia[] | null
  /** «08:58 – 17:04», «09:01 – sin salida», o «—». */
  fichado: string
  /** «8 h 06», «?» si falta una salida, «—» si no fichó. */
  horas: string
  sinSalida: boolean
}

/** Las filas de la semana: turno, lo fichado y las horas de cada día. */
export function filasDeLaSemana(lunes: string, marcas: MarcaJornada[], turnos: Record<string, TurnoDelDia[]> | null, ahora: Date): FilaDia[] {
  const dias = diasDeLaSemana(lunes)
  const jornadas = new Map(jornadasPorDia(marcas, dias[0], dias[6], ahora).map((j) => [j.dia, j]))
  return dias.map((dia) => {
    const j = jornadas.get(dia)
    const tramos = j?.tramos ?? []
    const sinSalida = tramos.some((t) => t.estado === 'sin_salida')
    const fichado = tramos.length === 0 ? '—'
      : tramos.map((t) => `${horaMadrid(t.entrada)} – ${t.estado === 'cerrado' && t.salida ? horaMadrid(t.salida) : t.estado === 'abierto' ? 'trabajando' : 'sin salida'}`).join(' · ')
    const horas = tramos.length === 0 ? '—' : sinSalida ? '?' : horasYMinutos(j!.minutosTrabajados)
    return { dia, diaTexto: diaCorto(dia), turnos: turnos ? turnos[dia] ?? [] : null, fichado, horas, sinSalida }
  })
}

export interface ResumenMes {
  minutosTrabajados: number
  /** Días del mes con una entrada que no tendrá salida, del más antiguo al más reciente. */
  sinSalida: string[]
}

/** Lo fichado en el mes de `hoy`, hasta hoy. */
export function resumenDelMes(marcas: MarcaJornada[], hoy: string, ahora: Date): ResumenMes {
  const desde = `${hoy.slice(0, 7)}-01`
  const dias: DiaJornada[] = jornadasPorDia(marcas, desde, hoy, ahora)
  return {
    minutosTrabajados: dias.reduce((n, d) => n + d.minutosTrabajados, 0),
    sinSalida: dias.filter((d) => d.tramos.some((t) => t.estado === 'sin_salida')).map((d) => d.dia),
  }
}

/** Los días entre `desde` y `hasta` con una entrada que no tendrá salida, del más antiguo al más reciente. */
export function diasSinSalida(marcas: MarcaJornada[], desde: string, hasta: string, ahora: Date): string[] {
  return jornadasPorDia(marcas, desde, hasta, ahora).filter((d) => d.tramos.some((t) => t.estado === 'sin_salida')).map((d) => d.dia)
}

/** Minutos trabajados de cada mes (AAAA-MM) de los que se piden. */
export function minutosPorMes(marcas: MarcaJornada[], meses: string[], ahora: Date): Record<string, number> {
  const hoy = diaMadrid(ahora.toISOString())
  const r: Record<string, number> = {}
  for (const mes of meses) {
    const [y, m] = mes.split('-').map(Number)
    const ultimo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const hasta = ultimo > hoy ? hoy : ultimo
    r[mes] = `${mes}-01` > hoy ? 0 : jornadasPorDia(marcas, `${mes}-01`, hasta, ahora).reduce((n, d) => n + d.minutosTrabajados, 0)
  }
  return r
}

/** Los `n` últimos meses (AAAA-MM), el de `hoy` primero. */
export function ultimosMeses(hoy: string, n: number): string[] {
  const [y, m] = hoy.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7))
}

/** «Octubre 2026». */
export const mesConAnio = (mes: string) => `${nombreDelMes(mes).charAt(0).toUpperCase()}${nombreDelMes(mes).slice(1)} ${mes.slice(0, 4)}`

/** «+3 h 20», «−1 h 05», «0»: la bolsa de horas, de horas con decimales. */
export function textoBolsa(horas: number): string {
  const min = Math.round(horas * 60)
  if (min === 0) return '0'
  return `${min > 0 ? '+' : '−'}${horasYMinutos(Math.abs(min))}`
}

/** El aviso de arriba: el fichaje sin salida más reciente, con la hora en que acababa su turno si se sabe. */
export function avisoSinSalida(dia: string, turnos: TurnoDelDia[] | null | undefined): string {
  const fin = turnos && turnos.length > 0 ? turnos[turnos.length - 1].fin : null
  return `El ${diaCorto(dia).toLowerCase().replace(/^(\S+) /, (_, d: string) => `${({ lun: 'lunes', mar: 'martes', 'mié': 'miércoles', jue: 'jueves', vie: 'viernes', 'sáb': 'sábado', dom: 'domingo' } as Record<string, string>)[d] ?? d} `)} no fichó la salida.${fin ? ` Su turno acababa a las ${fin}.` : ''}`
}

