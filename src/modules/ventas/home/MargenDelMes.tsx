// Tarjeta «Margen del mes» (§Cocina del cajón, pantalla de Ventas).
//
// LA CIFRA GRANDE ES LO QUE QUEDA, y las tres filas son de dónde sale: venta,
// lo que se lleva la plataforma, lo que cuesta la comida. Puesta así, la resta
// se ve; puesta solo el resultado, hay que fiarse.
//
// EL PIE LLEVA A `/ventas/margen-final`, que es la pantalla que pinta la MISMA
// RPC (`margin_by_brand`). Mismo número arriba y abajo.
import { useCallback } from 'react'
import { Wallet } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import { leeMargenDelMes, type MargenDelMes as Dato } from './margenDelMes'

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
}

export default function MargenDelMes({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback((): Promise<Dato> => {
    if (!accountId) throw new Error('sin cuenta activa')
    return leeMargenDelMes(accountId, locationId)
  }, [accountId, locationId])

  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 60)

  const dias = datos ? `${datos.mes}, ${datos.diasDelMes} ${datos.diasDelMes === 1 ? 'día' : 'días'}` : ''
  const referencia = datos?.anterior
    ? `${datos.anterior.mes} cerró en ${eurEntero(datos.anterior.margenEur)} (${pct(datos.anterior.margenPct)}).`
    : null
  // La advertencia que hace que la cifra se lea bien: este margen es optimista
  // en la medida en que falte escandallo. Se dice con el número, no con un
  // «aproximado» que no compromete a nada.
  const optimista = datos && datos.coberturaPct != null && datos.coberturaPct < 100
    ? `El food solo cubre el ${pct(datos.coberturaPct)} de las líneas: el margen real es menor.`
    : null

  return (
    <TarjetaInicio
      titulo="Margen del mes"
      icono={Wallet}
      cifra={!datos ? undefined : eurEntero(datos.margenEur)}
      cifraSufijo={datos ? dias : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={!datos ? [] : [
        { etiqueta: 'Venta', valor: eurEntero(datos.ventaEur), tono: 'neutral' as const },
        { etiqueta: 'Comisión de plataforma', valor: `− ${eurEntero(datos.comisionEur)}`, tono: 'neutral' as const },
        { etiqueta: 'Food cost', valor: `− ${eurEntero(datos.foodEur)}`, tono: 'neutral' as const },
      ]}
      nota={!datos ? undefined
        : datos.ventaEur <= 0
          // Un mes recién empezado sin ventas no es «0 € de margen»: es que
          // todavía no ha pasado nada.
          ? `Todavía no hay ventas en ${datos.mes}.${referencia ? ` ${referencia}` : ''}`
          : [
              // No lleva personal ni alquiler. Callarlo convertiría un margen
              // de contribución en un beneficio, que es otra cosa y más grande.
              'Sin personal ni gastos de local.',
              optimista, referencia,
            ].filter(Boolean).join(' ')}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Ventas · Margen final →',
        onClick: () => drillTo({ ruta: '/ventas/margen-final', etiqueta: 'Abrir Ventas · Margen final →' }),
      } : undefined}
    />
  )
}
