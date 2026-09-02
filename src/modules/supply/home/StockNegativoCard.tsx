// Tarjeta «Stock negativo» (§Almacén de la maqueta).
//
// Cuelga de `getNegativeStockReport`, el mismo servicio que la pantalla de
// Almacén y que el informe CSV: una sola definición de «negativo», su causa y
// su umbral anti-ruido.
//
// LA CIFRA CUENTA TODOS, no solo los que cruzan el umbral. El umbral ordena y
// etiqueta —la nota dice cuántos son de verdad urgentes— pero no decide la
// existencia de la fila. Es la regla 7, y es exactamente el fallo del 29/08:
// «sin alertas» en verde mientras Pedidos enseñaba Coca-Cola a −10.
import { useCallback, useMemo } from 'react'
import { PackageMinus } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import { leeStockNegativoPorLocal, type NegativoPorLocal } from './stockNegativoHome'

export default function StockNegativoCard({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? leeStockNegativoPorLocal(accountId, locationId) : Promise.resolve([] as NegativoPorLocal[])),
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 15)
  const filas = useMemo(() => datos ?? [], [datos])

  const total = filas.reduce((s, l) => s + l.articulos, 0)
  const urgentes = filas.reduce((s, l) => s + l.cruzanUmbral, 0)
  const valor = filas.reduce((s, l) => s + l.valorEur, 0)

  return (
    <TarjetaInicio
      titulo="Stock negativo"
      icono={PackageMinus}
      cifra={datos ? String(total) : undefined}
      cifraSufijo={datos && total > 0 ? (total === 1 ? 'artículo' : 'artículos') : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={filas.length > 1
        ? filas.map(l => ({ etiqueta: l.local, valor: String(l.articulos), tono: 'neutral' as const }))
        : []}
      nota={!datos ? undefined
        : total === 0 ? 'Ningún artículo por debajo de cero'
        : `${urgentes} por encima del umbral de ruido · ${eurEntero(Math.abs(valor))} en negativo`}
      sello={sello}
      pie={drillTo ? { etiqueta: 'Abrir Almacén · Stock →', onClick: () => drillTo({ ruta: '/supply/stock', etiqueta: 'Abrir Almacén · Stock →', filtros: { local: locationId } }) } : undefined}
    />
  )
}
