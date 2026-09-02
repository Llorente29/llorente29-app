// Tarjeta «Ticket medio» (§Ventas de la maqueta). Copy propuesto siguiendo la
// anatomía de las seis: cifra, delta contra su espejo, desglose por local si
// aporta, línea de consecuencia, sello y pie.
//
// LA CONSECUENCIA que se eligió: cuántos pedidos hay detrás. Un ticket medio de
// 24 € sacado de 9 pedidos y otro sacado de 140 no se leen igual, y el segundo
// número es el que dice si te puedes fiar del primero.
import { useCallback, useMemo } from 'react'
import { Receipt } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eur } from '@/lib/dinero'
import { calculaDelta, espejoDeDia } from '@/shell/home/espejo'
import { fechaISO } from '@/shell/home/drill'
import { diaAnterior } from '@/lib/fechas'
import type { HomeCardProps } from '@/shell/types'
import { ventasDeAyerCompletas, ticketMedio, type PeriodoDeVentas } from './ventasDelPeriodo'

export default function TicketMedio({ accountId, locationId, drillTo }: HomeCardProps) {
  const ayer = useMemo(() => diaAnterior(new Date()), [])
  const cargar = useCallback(
    (): Promise<PeriodoDeVentas> => {
      if (!accountId) throw new Error('sin cuenta activa')
      return ventasDeAyerCompletas(accountId, locationId)
    },
    [accountId, locationId],
  )
  // Ayer está cerrado, pero el ingestor puede traer pedidos tardíos.
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId, ayer.ymd], 60)

  const k = datos?.dashboard.kpis
  const medio = k ? ticketMedio(k.net, k.orders) : null

  const delta = useMemo(() => {
    const prev = datos?.dashboard.prev
    if (!k || !prev) return undefined
    const medioPrev = ticketMedio(prev.net, prev.orders)
    if (medio == null || medioPrev == null) return undefined
    const d = calculaDelta(medio, medioPrev, espejoDeDia(ayer.desde))
    return d ? { texto: d.texto, tono: d.tono } : undefined
  }, [datos, k, medio, ayer])

  const porLocal = datos?.dashboard.by_location ?? []

  return (
    <TarjetaInicio
      titulo={`Ticket medio · ayer ${datos?.nombreDelDia ?? ''}`.trim()}
      icono={Receipt}
      // Sin pedidos NO hay ticket medio, y no es cero.
      cifra={datos ? (medio == null ? 'sin pedidos' : eur(medio)) : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      delta={delta}
      filas={porLocal.length > 1
        ? porLocal.map(l => {
            const m = ticketMedio(l.net, l.orders)
            return {
              etiqueta: l.name,
              valor: m == null ? 'sin pedidos' : eur(m),
              tono: 'neutral' as const,
            }
          })
        : []}
      // De cuántos pedidos sale: es lo que dice si te puedes fiar de la cifra.
      nota={k && medio != null
        ? `De ${k.orders} ${k.orders === 1 ? 'pedido' : 'pedidos'}`
        : undefined}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Ventas →',
        onClick: () => drillTo({
          ruta: '/ventas', etiqueta: 'Abrir Ventas →',
          filtros: { desde: fechaISO(ayer.desde), hasta: fechaISO(ayer.hasta) },
        }),
      } : undefined}
    />
  )
}
