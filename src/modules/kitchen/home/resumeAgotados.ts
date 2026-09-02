// src/modules/kitchen/home/resumeAgotados.ts
//
// Lo que la tarjeta «Productos en 86» DEDUCE de la lista: el total, el desglose
// por local y la frase de consecuencia.
//
// Vive fuera del componente porque es lo único que puede estar mal —contar,
// ordenar, y decir «6 días» cuando son 6— y así se prueba sin montar React.

import type { SoldOutRow } from '../services/availabilityService'
import { diasNaturalesEntre } from '@/lib/fechas'

export interface ResumenAgotados {
  total: number
  filas: { etiqueta: string; valor: string }[]
  nota?: string
}

// ── DÍAS NATURALES, NO HORAS TRANSCURRIDAS (02/09) ─────────────────────────
// La primera versión hacía `floor((ahora - set_at) / 24h)`. Medido con la fila
// real de Alcalá: agotado el 28/08 a las 12:17 de Madrid, mirado el 02/09 a las
// 10:25, daba **4** — y la base de datos decía **5**. A las 12:17 de ese mismo
// día habría pasado a 5 sola.
//
// El problema no es el número, es QUE BAILA: la misma pantalla, el mismo
// agotado, dos cifras según la hora, y el salto ocurre a las 12:17 porque a esa
// hora se agotó — un instante que no significa nada para quien lo lee.
//
// El criterio es DÍAS NATURALES COMPLETOS y vive en src/lib/fechas.ts, que es
// donde está el huso del negocio. Aquí solo se envuelve para tolerar el null.

/** Días naturales completos desde `iso`. null si falta o no es una fecha. */
export function diasDesde(iso: string | null, ahora: number = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return diasNaturalesEntre(t, new Date(ahora))
}

export function resumeAgotados(filas: SoldOutRow[], ahora: number = Date.now()): ResumenAgotados {
  // Por local, ORDENADO DE MÁS A MENOS: la maqueta pone primero al que más
  // tiene, que es el que hay que mirar. Empate → alfabético, para que la
  // tarjeta no baile entre recargas.
  const porLocal = new Map<string, number>()
  for (const r of filas) {
    const nombre = r.locationName ?? 'Sin local'
    porLocal.set(nombre, (porLocal.get(nombre) ?? 0) + 1)
  }
  const ordenadas = [...porLocal.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([etiqueta, n]) => ({ etiqueta, valor: String(n) }))

  // LA CONSECUENCIA: la antigüedad del más viejo. Un 86 de hace seis días no
  // suele ser un producto agotado, es un producto olvidado.
  const dias = filas.map(r => diasDesde(r.setAt, ahora)).filter((d): d is number => d != null)
  const masViejo = dias.length > 0 ? Math.max(...dias) : null

  return {
    total: filas.length,
    // Con un solo local no se repite el desglose: sería la misma cifra dos veces.
    filas: ordenadas.length > 1 ? ordenadas : [],
    nota: masViejo == null ? undefined
      : masViejo === 0 ? 'El más antiguo se agotó hoy'
      : masViejo === 1 ? 'El más antiguo lleva 1 día agotado'
      : `El más antiguo lleva ${masViejo} días agotado`,
  }
}
