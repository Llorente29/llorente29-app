// src/modules/personal/laboral/avisoOlvidoTexto.ts
//
// L1a · PR 3. Lo puro de la tarjeta del olvido en el portal: «Ayer», «Hoy» o
// «El 21/10», y la salida que la persona escribe (solo la hora) convertida en
// un instante: el día de la entrada, o el siguiente si la hora es anterior a
// la de la entrada (un turno que pasa de medianoche). Todo en hora de Madrid.

import { diaMadrid, horaMadrid } from './calculoJornada'

/** Desfase de Madrid respecto a UTC, en minutos, en ese instante. */
function desfaseMadrid(fecha: Date): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha)
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value)
  const comoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'))
  return Math.round((comoUtc - Math.floor(fecha.getTime() / 60000) * 60000) / 60000)
}

/** «Hoy», «Ayer» o «El 21/10», según el día (Madrid) de la entrada. */
export function cuandoFueElOlvido(entradaIso: string, ahora: Date = new Date()): string {
  const dia = diaMadrid(entradaIso)
  const hoy = diaMadrid(ahora.toISOString())
  const ayer = diaMadrid(new Date(ahora.getTime() - 86400_000).toISOString())
  if (dia === hoy) return 'Hoy'
  if (dia === ayer) return 'Ayer'
  return `El ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** La salida (ISO) para una hora «HH:MM» escrita por la persona. Null si no es una hora. */
export function salidaDesdeHora(entradaIso: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  let dia = diaMadrid(entradaIso)
  if (`${String(h).padStart(2, '0')}:${m[2]}` <= horaMadrid(entradaIso)) {
    const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); dia = d.toISOString().slice(0, 10)
  }
  // El instante de esa hora en Madrid: se prueba con el desfase de ese día.
  const [y, mo, d] = dia.split('-').map(Number)
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi)
  let t = comoUtc - desfaseMadrid(new Date(comoUtc)) * 60000
  t = comoUtc - desfaseMadrid(new Date(t)) * 60000
  return new Date(t).toISOString()
}
