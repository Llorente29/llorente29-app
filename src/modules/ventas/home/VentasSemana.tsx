// src/modules/ventas/home/VentasSemana.tsx
//
// TARJETA «VENTAS · ESTA SEMANA» (§1.2 de la maqueta). Es la del porqué, y por
// tanto la que más fácil miente. Las tres cosas que hace para no hacerlo:
//
//   1. La cifra grande lleva el día en curso; la COMPARACIÓN no, en ninguno de
//      los dos lados. Es la entrada 6 del registro: un periodo a medias contra
//      uno completo da una caída inventada todos los días.
//   2. El rótulo dice lo que de verdad se compara — «vs los mismos días» — y
//      lleva la cifra del espejo entre paréntesis, como la maqueta.
//   3. La línea del porqué enuncia un HECHO y no una causa, y solo sale si la
//      semana va a la baja y el cierre tiene local y duró más de dos horas.
//      Si no, no se pinta: antes sin porqué que con un porqué inventado.

import { useCallback, useMemo } from 'react'
import { TrendingDown } from 'lucide-react'
import { eurEntero } from '@/lib/dinero'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { fechaISO } from '@/shell/home/drill'
import type { HomeCardProps } from '@/shell/types'
import { leeSemanaConEspejo, type SemanaConEspejo } from './ventasSemana'
import { leeEventosDeMarca } from './eventosDeMarca'
import { frasePorque, type EventoDeMarca } from './porqueSemana'

const UMBRAL_MIN = 15


interface Datos { semana: SemanaConEspejo; eventos: EventoDeMarca[] }

export default function VentasSemana({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(async (): Promise<Datos> => {
    if (!accountId) throw new Error('sin cuenta activa')
    const semana = await leeSemanaConEspejo(accountId, locationId)
    const eventos = await leeEventosDeMarca(accountId, locationId, semana.desde, semana.hasta)
    return { semana, eventos }
  }, [accountId, locationId])

  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], UMBRAL_MIN)

  const delta = useMemo(() => {
    const s = datos?.semana
    if (!s) return undefined
    // El lunes por la mañana no hay días cerrados: no hay nada que comparar y
    // se dice, en vez de enseñar un 0 % o un −100 % que no significan nada.
    if (s.diasComparados < 1 || s.espejo <= 0) return undefined
    const pct = ((s.totalCerrado - s.espejo) / s.espejo) * 100
    const signo = pct >= 0 ? '+' : '−'
    return {
      texto: `${signo}${Math.abs(pct).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
        + ` vs los mismos días de la semana anterior (${eurEntero(s.espejo)})`,
      tono: (pct >= 0 ? 'positive' : 'attention') as 'positive' | 'attention',
    }
  }, [datos])

  const porque = useMemo(() => {
    const s = datos?.semana
    if (!s || !datos) return undefined
    const baja = s.diasComparados >= 1 && s.espejo > 0 && s.totalCerrado < s.espejo
    return frasePorque(datos.eventos, s.hasta, baja) ?? undefined
  }, [datos])

  return (
    <TarjetaInicio
      titulo="Ventas · esta semana"
      icono={TrendingDown}
      cifra={datos ? eurEntero(datos.semana.total) : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      delta={delta}
      // Sin espejo utilizable se DICE por qué falta, en vez de dejar el hueco.
      nota={porque
        ?? (datos && !delta ? 'Todavía no hay días cerrados esta semana con los que comparar' : undefined)}
      sello={sello}
      pie={drillTo
        ? {
            etiqueta: 'Ver el porqué, día a día →',
            onClick: () => drillTo({
              ruta: '/ventas',
              etiqueta: 'Ver el porqué, día a día →',
              filtros: datos
                ? { desde: fechaISO(datos.semana.desde), hasta: fechaISO(datos.semana.hasta) }
                : {},
            }),
          }
        : undefined}
    />
  )
}
