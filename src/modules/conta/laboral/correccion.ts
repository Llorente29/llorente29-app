// src/modules/conta/laboral/correccion.ts
//
// LS1 (28/10/2026) · Las cuentas de corregir dentro de «Para revisar»,
// aparte para probarlas sin pintar nada. Las horas se escriben y se leen en
// hora de Madrid (regla 4), venga de donde venga el navegador.

import type { ClockCorrectionRequest } from '@/services/clockEditService'
import { diaMadrid, fechaLarga, horaMadrid } from '@/modules/personal/laboral/calculoJornada'

/** Minutos que Madrid va por delante de UTC en ese instante (60 o 120). */
function desfaseMadrid(ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return Math.round((comoUtc - Math.floor(ms / 60000) * 60000) / 60000)
}

/** «2026-10-28» + «17:30» de Madrid → ISO en UTC. */
export function isoDeMadrid(dia: string, hora: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  const [h, mi] = hora.split(':').map(Number)
  const supuesto = Date.UTC(y, m - 1, d, h, mi)
  let ms = supuesto - desfaseMadrid(supuesto) * 60000
  ms = supuesto - desfaseMadrid(ms) * 60000
  return new Date(ms).toISOString()
}

/** Lo que falla de una corrección, en palabras; null si se puede guardar. */
export function errorDeCorreccion(c: { dia: string; hora: string; motivo: string; despuesDe?: string; antesDe?: string | null }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dia) || !/^\d{2}:\d{2}$/.test(c.hora)) return 'Pon el día y la hora.'
  if (!c.motivo.trim()) return 'Escribe el motivo: queda en el registro y lo ve la persona.'
  const iso = isoDeMadrid(c.dia, c.hora)
  if (new Date(iso).getTime() > Date.now()) return 'Esa hora aún no ha llegado.'
  if (c.despuesDe && iso <= new Date(c.despuesDe).toISOString()) return `Tiene que ser después de la entrada (${horaMadrid(c.despuesDe)}).`
  if (c.antesDe && iso >= new Date(c.antesDe).toISOString()) return `Tiene que ser antes de la salida (${horaMadrid(c.antesDe)}).`
  return null
}

const TIPO: Record<string, string> = { entrada: 'entrada', salida: 'salida' }

/** Qué pide una petición de corrección del trabajador, en una frase. */
export function textoDePeticion(p: ClockCorrectionRequest): string {
  const cuando = p.proposedDatetime ? `${horaMadrid(p.proposedDatetime)} del ${fechaLarga(diaMadrid(p.proposedDatetime))}` : ''
  const tipo = TIPO[p.proposedType ?? ''] ?? 'marca'
  if (p.kind === 'add') return `Añadir una ${tipo} a las ${cuando}`
  if (p.kind === 'edit') return `Cambiar la hora de su ${tipo} a las ${cuando}`
  return 'Anular un fichaje'
}
