// Tarjeta «Resumen de agentes» (§Agentes de la maqueta).
//
// OJO: es la TARJETA del mosaico, distinta del panel «Mis agentes» que va
// debajo. La tarjeta resume; el panel enseña la tabla y el interruptor. Comparten
// `home_agentes_estado`, así que no pueden discrepar — que es justo lo que
// pasaría con dos consultas.
import { useCallback, useMemo } from 'react'
import { Bot } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { leeAgentes, type EstadoAgente } from './agentesService'

export default function ResumenAgentes({ accountId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? leeAgentes(accountId) : Promise.resolve([] as EstadoAgente[])),
    [accountId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId], 5)
  const a = useMemo(() => datos ?? [], [datos])

  const trabajando = a.filter(x => x.estado === 'ok').length
  const conFallos = a.filter(x => x.estado === 'con_fallos')
  const pausados = a.filter(x => x.pausado)
  const apagadosEnCron = a.reduce((s, x) => s + x.jobs_apagados, 0)

  return (
    <TarjetaInicio
      titulo="Resumen de agentes"
      icono={Bot}
      cifra={datos ? String(trabajando) : undefined}
      cifraSufijo={datos ? `de ${a.length}` : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={[
        ...conFallos.map(x => ({
          etiqueta: x.nombre, valor: `${x.fallos_24h} fallos hoy`, tono: 'bad' as const,
        })),
        ...pausados.map(x => ({
          etiqueta: x.nombre, valor: 'apagado por ti', tono: 'attention' as const,
        })),
      ]}
      // El dato que hoy no dice ninguna pantalla: vigías apagados en el
      // planificador, sin autor ni fecha.
      nota={datos && apagadosEnCron > 0
        ? `${apagadosEnCron} vigía${apagadosEnCron === 1 ? '' : 's'} apagado${apagadosEnCron === 1 ? '' : 's'} en el planificador, sin rastro de quién`
        : undefined}
      sello={sello}
      pie={drillTo ? { etiqueta: 'Abrir Agentes →', onClick: () => drillTo({ ruta: '/agentes', etiqueta: 'Abrir Agentes →' }) } : undefined}
    />
  )
}
