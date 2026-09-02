// src/modules/personal/home/resumeEnCocina.ts
//
// Lo que la tarjeta «En cocina ahora» deduce de los estados. Puro, para
// probarlo sin montar React ni tocar la base.

import type { EstadoEmpleado } from './enCocinaAhora'

export interface ResumenEnCocina {
  dentro: number
  filas: { etiqueta: string; valor: string; tono?: 'neutral' | 'attention' | 'bad' }[]
  nota?: string
}

/** «2 h 17 min», «48 min». */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

function minutosDesde(iso: string | null, ahora: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (ahora - t) / 60000
}

export function resumeEnCocina(
  estados: EstadoEmpleado[],
  ahora: number = Date.now(),
): ResumenEnCocina {
  const dentro = estados.filter(e => e.estado === 'trabajando')

  // Una fila por LOCAL activo, incluidos los que tienen a cero: un local con
  // nadie dentro no desaparece de la tarjeta, porque «no aparece» y «no hay
  // nadie» se leen igual y significan cosas muy distintas.
  const porLocal = new Map<string, { dentro: number; plantilla: number }>()
  for (const e of estados) {
    const a = porLocal.get(e.localNombre) ?? { dentro: 0, plantilla: 0 }
    a.plantilla += 1
    if (e.estado === 'trabajando') a.dentro += 1
    porLocal.set(e.localNombre, a)
  }

  const filas = [...porLocal.entries()]
    .sort((a, b) => b[1].dentro - a[1].dentro || a[0].localeCompare(b[0], 'es'))
    .map(([etiqueta, v]) => ({
      etiqueta,
      valor: v.dentro === 0 ? 'nadie dentro'
        : `${v.dentro} de ${v.plantilla}`,
      // Cero dentro no es rojo por sí solo: a las 6 de la mañana es lo normal.
      // El color queda neutro y es la nota la que dice si eso importa.
      tono: 'neutral' as const,
    }))

  // LA CONSECUENCIA: quien lleva más tiempo dentro. Sirve para lo que de
  // verdad se mira a media tarde — quién lleva ya muchas horas.
  const conTiempo = dentro
    .map(e => ({ e, min: minutosDesde(e.abiertaDesde, ahora) }))
    .filter((x): x is { e: EstadoEmpleado; min: number } => x.min != null)
    .sort((a, b) => b.min - a.min)

  const desconocidos = estados.filter(e => e.estado === 'desconocido').length

  return {
    dentro: dentro.length,
    filas,
    // Un fallo al leer un estado se DICE. Si no, la tarjeta enseñaría un
    // número más bajo que el real sin explicar por qué.
    nota: desconocidos > 0
      ? `No se ha podido leer el estado de ${desconocidos} ${desconocidos === 1 ? 'persona' : 'personas'}`
      : conTiempo.length > 0
        ? `${conTiempo[0].e.nombre.trim().split(/\s+/)[0]} lleva ${duracion(conTiempo[0].min)} dentro`
        : undefined,
  }
}
