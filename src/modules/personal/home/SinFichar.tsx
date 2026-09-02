// Tarjeta «Sin fichar teniendo turno» (§Team de la maqueta). Cierra Team 5 de 5.
//
// COPY PROPUESTO:
//   · cifra: cuántas personas se esperaban y no están.
//   · filas: quién, en qué local, a qué hora se le esperaba y cuánto lleva. Un
//     número solo no sirve: para llamar a alguien hay que saber a quién.
//   · consecuencia: el retraso del que más lleva. Diez minutos es un metro
//     perdido; cincuenta es un turno que no va a venir, y son cosas distintas.
//   · sin delta: comparar los ausentes de hoy con los de ayer no ayuda a nadie
//     a las ocho de la mañana.
import { useCallback, useMemo } from 'react'
import { UserX } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { leeSinFichar, MARGEN_CORTESIA_MIN, type TurnoSinFichar } from './sinFichar'

export default function SinFichar({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? leeSinFichar(accountId, locationId) : Promise.resolve([] as TurnoSinFichar[])),
    [accountId, locationId],
  )
  // Tres minutos: esto cambia en cuanto alguien ficha, y el valor de la tarjeta
  // es avisar mientras aún se puede llamar por teléfono.
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 3)
  const faltan = useMemo(() => datos ?? [], [datos])
  const peor = faltan[0]

  return (
    <TarjetaInicio
      titulo="Sin fichar teniendo turno"
      icono={UserX}
      cifra={datos ? String(faltan.length) : undefined}
      cifraSufijo={datos && faltan.length > 0 ? (faltan.length === 1 ? 'persona' : 'personas') : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={faltan.map(f => ({
        etiqueta: `${f.nombre.trim().split(/\s+/)[0]} · ${f.local}`,
        valor: `${f.entradaPrevista} · ${f.minutosDeRetraso} min`,
        // Media hora deja de ser un retraso y empieza a ser una ausencia.
        tono: f.minutosDeRetraso >= 30 ? ('bad' as const) : ('attention' as const),
      }))}
      nota={!datos ? undefined
        : faltan.length === 0
          ? `Nadie con turno sin fichar (margen de ${MARGEN_CORTESIA_MIN} min)`
          : peor.minutosDeRetraso >= 30
            ? `${peor.nombre.trim().split(/\s+/)[0]} lleva ${peor.minutosDeRetraso} min: a esa hora ya no es el metro`
            : `El que más lleva, ${peor.minutosDeRetraso} min`}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Team · Ahora mismo →',
        onClick: () => drillTo({
          ruta: '/personal/ahora-mismo', etiqueta: 'Abrir Team · Ahora mismo →',
          filtros: { local: locationId },
        }),
      } : undefined}
    />
  )
}
