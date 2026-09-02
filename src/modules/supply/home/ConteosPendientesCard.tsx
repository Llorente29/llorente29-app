// Tarjeta «Conteos pendientes» (§Almacén de la maqueta).
import { useCallback, useMemo } from 'react'
import { ClipboardList } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { leeConteosPendientes, type ConteosPorLocal } from './conteosPendientes'

export default function ConteosPendientesCard({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? leeConteosPendientes(accountId, locationId) : Promise.resolve([] as ConteosPorLocal[])),
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 15)
  const filas = useMemo(() => datos ?? [], [datos])

  const total = filas.reduce((s, l) => s + l.vivos, 0)
  const masViejo = filas
    .map(l => l.diasDelMasViejo)
    .filter((d): d is number => d != null)
  const dias = masViejo.length > 0 ? Math.max(...masViejo) : null

  return (
    <TarjetaInicio
      titulo="Conteos pendientes"
      icono={ClipboardList}
      cifra={datos ? String(total) : undefined}
      cifraSufijo={datos && total > 0 ? (total === 1 ? 'sin cerrar' : 'sin cerrar') : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={filas.length > 1
        ? filas.map(l => ({ etiqueta: l.local, valor: String(l.vivos), tono: 'neutral' as const }))
        : []}
      nota={!datos ? undefined
        : total === 0 ? 'Ningún conteo abierto'
        : dias == null ? undefined
        : dias === 0 ? 'El más antiguo se abrió hoy'
        : dias === 1 ? 'El más antiguo lleva 1 día abierto'
        : `El más antiguo lleva ${dias} días abierto`}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Almacén · Inventarios →',
        onClick: () => drillTo({
          ruta: '/supply/inventario', etiqueta: 'Abrir Almacén · Inventarios →',
          filtros: { local: locationId },
        }),
      } : undefined}
    />
  )
}
