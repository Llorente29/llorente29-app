// src/modules/personal/home/resumeEnCocina.ts
//
// Lo que la tarjeta «En cocina ahora» deduce de los estados. Puro, para
// probarlo sin montar React ni tocar la base.

import type { EstadoEmpleado } from './enCocinaAhora'

export interface ResumenEnCocina {
  dentro: number
  /** El denominador de la maqueta: «0 de 6». */
  total: number
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


export function resumeEnCocina(
  estados: EstadoEmpleado[],
  opciones: {
    /** true = el selector está en «todos los locales». */
    consolidado?: boolean
    primeraEntradaPrevista?: string | null
    ayerCerro?: { nombre: string; hora: string } | null
  } = {},
): ResumenEnCocina {
  const { consolidado = true } = opciones
  const dentro = estados.filter(e => e.estado === 'trabajando')

  // ── EL DESGLOSE POR LOCAL NO ESTÁ EN LA MAQUETA ───────────────────────────
  // Se queda SOLO en consolidado, que es donde aporta: con un local
  // seleccionado repetiría la cifra grande, y ahí manda el bloque aprobado.
  const porLocal = new Map<string, { dentro: number; plantilla: number }>()
  for (const e of estados) {
    const a = porLocal.get(e.localNombre) ?? { dentro: 0, plantilla: 0 }
    a.plantilla += 1
    if (e.estado === 'trabajando') a.dentro += 1
    porLocal.set(e.localNombre, a)
  }

  const filasLocal = consolidado && porLocal.size > 1
    ? [...porLocal.entries()]
        .sort((a, b) => b[1].dentro - a[1].dentro || a[0].localeCompare(b[0], 'es'))
        .map(([etiqueta, v]) => ({
          etiqueta,
          // Un local sin nadie NO desaparece: «no aparece» y «no hay nadie» se
          // leen igual y significan cosas muy distintas. Regla 7.
          valor: v.dentro === 0 ? 'nadie dentro' : `${v.dentro} de ${v.plantilla}`,
          tono: 'neutral' as const,
        }))
    : []

  // ── LA FILA DE CONTEXTO DE LA MAQUETA: quién cerró ayer ───────────────────
  const filaAyer = opciones.ayerCerro
    ? [{ etiqueta: 'Ayer cerró', valor: `${opciones.ayerCerro.nombre} · ${opciones.ayerCerro.hora}`,
         tono: 'neutral' as const }]
    : []

  const desconocidos = estados.filter(e => e.estado === 'desconocido').length

  // ── LA LÍNEA DE ESTADO ────────────────────────────────────────────────────
  // Prioridad: un fallo se dice SIEMPRE primero. Si no, y no hay nadie dentro,
  // la maqueta pide la primera entrada prevista del cuadrante.
  let nota: string | undefined
  if (desconocidos > 0) {
    nota = `No se ha podido leer el estado de ${desconocidos} ${desconocidos === 1 ? 'persona' : 'personas'}`
  } else if (dentro.length === 0) {
    nota = opciones.primeraEntradaPrevista
      ? `Sin fichajes aún hoy · primera entrada prevista a las ${opciones.primeraEntradaPrevista}`
      // Sin cuadrante que consultar no se inventa una hora: se dice que no la hay.
      : 'Sin fichajes aún hoy · no hay turno previsto en el cuadrante'
  }

  return { dentro: dentro.length, total: estados.length, filas: [...filasLocal, ...filaAyer], nota }
}
