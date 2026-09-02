// Tarjeta «Pedidos atascados» (§Canales de la maqueta).
//
// Es la más urgente de las seis de la mañana: el aviso del vigía dice que «Uber
// marca el pedido PERDIDO a los ~10 min y el pago queda en 0 €». Un pedido
// atascado no es una métrica, es dinero que se está cayendo mientras se mira.
import { useCallback, useMemo } from 'react'
import { PackageX } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import {
  leePedidosAtascados, HORAS_DE_VENTANA, type PedidoAtascado,
} from './pedidosAtascados'

export default function PedidosAtascadosCard({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? leePedidosAtascados(accountId, locationId) : Promise.resolve([] as PedidoAtascado[])),
    [accountId, locationId],
  )
  // DOS MINUTOS: es la tarjeta donde un dato viejo cuesta dinero de verdad.
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 2)
  const pedidos = useMemo(() => datos ?? [], [datos])
  const enRiesgo = pedidos.filter(p => p.minutos >= 10)

  return (
    <TarjetaInicio
      titulo="Pedidos atascados"
      icono={PackageX}
      cifra={datos ? String(pedidos.length) : undefined}
      cifraSufijo={datos && pedidos.length > 0 ? 'sin aceptar' : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={pedidos.map(p => ({
        etiqueta: p.marca,
        valor: `${p.minutos} min · ${eurEntero(p.total)}`,
        // Los ~10 min son el umbral real: a partir de ahí Uber lo da por
        // perdido y el pago queda en 0 €.
        tono: p.minutos >= 10 ? ('bad' as const) : ('attention' as const),
      }))}
      nota={!datos ? undefined
        : pedidos.length === 0
          ? `Ninguno sin aceptar en las últimas ${HORAS_DE_VENTANA} h`
          : enRiesgo.length > 0
            ? `${enRiesgo.length} pasa${enRiesgo.length === 1 ? '' : 'n'} de 10 min: Uber los da por perdidos y el pago queda en 0 €`
            : `Ventana de ${HORAS_DE_VENTANA} h, la misma que el aviso`}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Pedidos →',
        onClick: () => drillTo({ ruta: '/pedidos', etiqueta: 'Abrir Pedidos →', filtros: { local: locationId } }),
      } : undefined}
    />
  )
}
