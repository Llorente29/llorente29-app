// Tarjeta «Liquidaciones CTB» (§Canales del cajón).
//
// LA CIFRA GRANDE ES EL NETO DE LA ÚLTIMA LIQUIDACIÓN y el sufijo dice DE QUÉ
// MES es. Sin el mes, un importe de junio leído en septiembre se lee como
// dinero de ahora — y esa confusión vale exactamente lo que vale el importe.
//
// LA CONSECUENCIA NO ES EL IMPORTE: es que julio y agosto siguen sin liquidar.
// Es lo primero que se ve al leer la tabla y no lo enseñaba ninguna pantalla,
// porque `licensed_settlement` no se lee desde ningún sitio de la aplicación.
//
// EL SELLO Y LA ANTIGÜEDAD SON COSAS DISTINTAS y las dos están: el sello dice
// cuándo se leyó la tabla (hace un minuto), la nota dice de cuándo es el dato
// (de junio). Un sello verde sobre un dato de hace dos meses sería mentir con
// la verdad.
import { useCallback } from 'react'
import { FileText } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import { leeLiquidacionesCtb, type LiquidacionesCtb as Dato } from './liquidacionesCtb'

export default function LiquidacionesCtb({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback((): Promise<Dato> => {
    if (!accountId) throw new Error('sin cuenta activa')
    return leeLiquidacionesCtb(accountId, locationId)
  }, [accountId, locationId])

  // Una liquidación llega una vez al mes: el dato no caduca en minutos. Umbral
  // 0 = sin caducidad, como los periodos cerrados.
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 0)

  const sinNada = datos != null && datos.documentos === 0

  return (
    <TarjetaInicio
      titulo="Liquidaciones CTB"
      icono={FileText}
      cifra={!datos ? undefined : sinNada ? 'ninguna' : eurEntero(datos.netoEur)}
      cifraSufijo={datos && !sinNada && datos.periodo ? datos.periodo : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={(datos?.porLocal ?? []).map(l => ({
        etiqueta: l.referencia ? `${l.local} · ${l.referencia}` : l.local,
        valor: eurEntero(l.netoEur),
        tono: 'neutral' as const,
      }))}
      nota={!datos ? undefined
        : sinNada
          // Cero de verdad: no hay ni un documento. Se dice, y se dice que la
          // tabla se ha mirado.
          ? 'No hay ninguna liquidación cargada para esta cuenta.'
          : datos.mesesSinLiquidar > 0
            ? `${datos.mesesSinLiquidar === 1 ? 'Queda un mes' : `Quedan ${datos.mesesSinLiquidar} meses`} cerrados sin liquidar desde entonces.`
            : 'Al día: no hay ningún mes cerrado sin liquidar.'}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Ventas · Cedidas →',
        onClick: () => drillTo({ ruta: '/ventas/cedidas', etiqueta: 'Abrir Ventas · Cedidas →' }),
      } : undefined}
    />
  )
}
