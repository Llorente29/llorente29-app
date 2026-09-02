// Tarjeta ancha «Ventas por canal · ayer» (§Ventas de la maqueta).
//
// COPY PROPUESTO, siguiendo la anatomía de las seis:
//   · cifra grande: cuánto pesa el canal MÁS GRANDE, en porcentaje. No el total
//     —eso ya lo dice «Ventas de ayer»— sino la concentración, que es lo que
//     esta tarjeta sabe y las otras no.
//   · una fila por canal, con importe, pedidos y su peso.
//   · consecuencia: la dependencia. «El 62 % viene de Glovo» es una frase que
//     cambia decisiones; «cuatro canales» no.
//
// NO LLEVA DELTA. `sales_dashboard` devuelve el espejo del TOTAL (`prev.net`),
// no por canal, así que un delta aquí compararía el peso de hoy contra el
// importe total de ayer — dos cosas distintas con la misma pinta. Antes sin
// delta que con uno que no compara lo que dice comparar.
import { useCallback, useMemo } from 'react'
import { Share2 } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import { fechaISO } from '@/shell/home/drill'
import { diaAnterior } from '@/lib/fechas'
import type { HomeCardProps } from '@/shell/types'
import { ventasDeAyerCompletas, type PeriodoDeVentas } from './ventasDelPeriodo'

const pct = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 0 })} %`

export default function VentasPorCanal({ accountId, locationId, drillTo }: HomeCardProps) {
  const ayer = useMemo(() => diaAnterior(new Date()), [])
  const cargar = useCallback(
    (): Promise<PeriodoDeVentas> => {
      if (!accountId) throw new Error('sin cuenta activa')
      return ventasDeAyerCompletas(accountId, locationId)
    },
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId, ayer.ymd], 60)

  const { canales, mayor, total } = useMemo(() => {
    const cs = [...(datos?.dashboard.by_channel ?? [])].sort((a, b) => b.net - a.net)
    const t = cs.reduce((s, c) => s + c.net, 0)
    return { canales: cs, mayor: cs[0] ?? null, total: t }
  }, [datos])

  const pesoMayor = mayor && total > 0 ? (mayor.net / total) * 100 : null

  return (
    <TarjetaInicio
      titulo={`Ventas por canal · ayer ${datos?.nombreDelDia ?? ''}`.trim()}
      icono={Share2}
      cifra={datos ? (pesoMayor == null ? 'sin ventas' : pct(pesoMayor)) : undefined}
      cifraSufijo={datos && mayor ? `en ${mayor.name}` : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      // TODOS los canales, no los tres primeros: es una tarjeta que se abre a
      // propósito, y el orden ya pone arriba lo que pesa. Si sobran, la propia
      // TarjetaInicio dice cuántas no caben.
      filas={canales.map(c => ({
        etiqueta: c.name,
        valor: `${eurEntero(c.net)} · ${c.orders} ${c.orders === 1 ? 'pedido' : 'pedidos'}`
          + (total > 0 ? ` · ${pct((c.net / total) * 100)}` : ''),
        tono: 'neutral' as const,
      }))}
      // LA CONSECUENCIA: la dependencia, que es lo que cambia decisiones.
      nota={!datos ? undefined
        : canales.length === 0 ? 'Ayer no hubo ventas por ningún canal'
        : canales.length === 1 ? `Todo vino de ${canales[0].name}: no hay reparto`
        : pesoMayor != null && pesoMayor >= 60
          ? `${pct(pesoMayor)} depende de ${mayor!.name}`
          : `Repartido entre ${canales.length} canales`}
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
