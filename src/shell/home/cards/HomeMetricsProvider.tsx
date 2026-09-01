// src/shell/home/cards/HomeMetricsProvider.tsx
//
// Las métricas transversales del Inicio, pedidas UNA VEZ para todas las
// tarjetas que las usan.
//
// Cada tarjeta del catálogo se busca sus datos sola —esa es la idea, y es lo
// que permite que un módulo aporte una tarjeta sin tocar el Inicio—, pero las
// cuatro transversales salen todas de la MISMA llamada. Que cada una la
// repitiese serían cuatro consultas idénticas por carga, y encima podrían
// enseñar números de instantes distintos en la misma pantalla.
//
// `cargando` se DERIVA de si lo que hay cargado corresponde al alcance actual,
// en vez de asignarse al empezar el efecto. Así no hay setState síncrono en el
// cuerpo del efecto, y de paso no existe el instante en el que la pantalla
// enseña los números del local anterior como si fueran del nuevo.

import { useEffect, useState, type ReactNode } from 'react'
import { getHomeMetrics, type HomeMetrics } from '../homeMetricsService'
import { HomeMetricsContext } from './homeMetricsContext'

function clave(accountId: string | null, locationId: string | null): string {
  return `${accountId ?? '-'}|${locationId ?? 'todos'}`
}

export function HomeMetricsProvider(
  { accountId, locationId, children }: { accountId: string | null; locationId: string | null; children: ReactNode },
) {
  const actual = clave(accountId, locationId)
  const [cargado, setCargado] = useState<{ clave: string; metrics: HomeMetrics | null } | null>(null)

  useEffect(() => {
    if (!accountId) return          // sin cuenta no hay nada que pedir ni que marcar
    let vivo = true
    getHomeMetrics(accountId, locationId)
      .then(m => { if (vivo) setCargado({ clave: actual, metrics: m }) })
      .catch(() => { if (vivo) setCargado({ clave: actual, metrics: null }) })
    return () => { vivo = false }
  }, [accountId, locationId, actual])

  // Sin cuenta: no se está cargando, simplemente no hay métricas. Las tarjetas
  // ya saben enseñar «—» sin inventarse un cero.
  const alDia = accountId == null || cargado?.clave === actual
  return (
    <HomeMetricsContext.Provider value={{ metrics: alDia ? (cargado?.metrics ?? null) : null, loading: !alDia }}>
      {children}
    </HomeMetricsContext.Provider>
  )
}
