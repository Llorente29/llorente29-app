// src/modules/conta/lib/cierreDelDia.ts
//
// El cierre del día (encargo del 09/10): cada día se da por terminado a una
// hora fija de la madrugada siguiente —las 6:00 de serie, ajuste de cada
// empresa—, en la zona de la cuenta. Antes de esa hora no se propone el
// asiento de ventas del día. El día de cada pedido sigue siendo el día
// natural de `sold_at` en esa zona: lo que cambia es cuándo se cierra.
//
// La misma cuenta que hace la base (`conta_ultimo_dia_cerrado`): la hora de
// la pared en la zona de la cuenta. Así el cambio de hora de octubre y de
// marzo no mueve el cierre: a las 6:00 de Madrid es a las 6:00 de Madrid,
// sea UTC+2 o UTC+1.

export const HORA_DE_CIERRE_DE_SERIE = '06:00'

const unDia = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** La fecha y la hora de la pared en una zona: «2026-10-09» y «17:16». */
export function enLaZona(instante: Date, zona: string): { dia: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante)
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00'
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` }
}

/** «06:00:00» o «6:00» → «06:00». Lo que no se entienda, a la hora de serie. */
export function normalizarHora(hora: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return HORA_DE_CIERRE_DE_SERIE
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * El último día ya cerrado a esta hora. Un día D se cierra a la hora de
 * cierre del día D + 1: a las 17:16 del 09/10 el último cerrado es el 08/10;
 * a las 5:30 del 09/10, el 07/10 (el 08/10 aún no ha llegado a las 6:00).
 */
export function ultimoDiaCerrado(instante: Date, horaCierre: string, zona = 'Europe/Madrid'): string {
  const { dia, hora } = enLaZona(instante, zona)
  return hora >= normalizarHora(horaCierre) ? unDia(dia, -1) : unDia(dia, -2)
}

/** Si ese día ya está cerrado a esta hora. */
export function diaCerrado(dia: string, instante: Date, horaCierre: string, zona = 'Europe/Madrid'): boolean {
  return dia <= ultimoDiaCerrado(instante, horaCierre, zona)
}

/** «6:00» para la pantalla («Hoy se cierra mañana a las 6:00»). */
export function horaParaLeer(horaCierre: string): string {
  const h = normalizarHora(horaCierre)
  return `${Number(h.slice(0, 2))}:${h.slice(3)}`
}
