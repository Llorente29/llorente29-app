// Tarjeta «Bolsa de horas» (§Team de la maqueta).
//
// COPY PROPUESTO:
//   · cifra grande: el saldo NETO del periodo en curso, en horas, con signo.
//     Positivo = horas de más que habrá que pagar o devolver; negativo = horas
//     que se deben. Las dos cosas cuestan dinero, en direcciones distintas.
//   · filas: quien más se desvía, arriba, con su nombre. El saldo no es un
//     agregado que se arregle solo: se arregla persona a persona.
//   · consecuencia: las semanas SIN CUADRANTE PUBLICADO del periodo. El
//     servicio las devuelve (`weeksWithoutSchedule`) y son la razón número uno
//     de que un saldo esté mal: lo que no está publicado no cuenta como horas
//     contratadas, así que el saldo sale falsamente positivo.
//
// SIN DELTA a propósito: el saldo del periodo anterior está CERRADO y resuelto
// (`resolvedClosures`), no es un espejo comparable. Compararlos diría que has
// mejorado cuando lo que ha pasado es que el mes pasado se cerró.
import { useCallback, useMemo } from 'react'
import { Hourglass } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import { leeBolsaDeHoras, type ResumenBolsa } from './bolsaHoras'

const horas = (h: number) => {
  const signo = h > 0 ? '+' : h < 0 ? '−' : ''
  const v = Math.abs(h)
  return `${signo}${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
}

export default function BolsaHoras({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    (): Promise<ResumenBolsa> => {
      if (!accountId) throw new Error('sin cuenta activa')
      return leeBolsaDeHoras(accountId, locationId)
    },
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 30)

  const filas = useMemo(() => (datos?.masDesviados ?? []).map(e => ({
    etiqueta: e.nombre,
    valor: horas(e.delta),
    // Ámbar por encima de 8 h en cualquier dirección: una jornada entera de
    // desvío deja de ser ruido de redondeo.
    tono: Math.abs(e.delta) >= 8 ? ('attention' as const) : ('neutral' as const),
  })), [datos])

  return (
    <TarjetaInicio
      titulo="Bolsa de horas"
      icono={Hourglass}
      cifra={datos ? horas(datos.saldoTotal) : undefined}
      cifraSufijo={datos ? datos.etiquetaPeriodo : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={filas}
      // LA CONSECUENCIA: lo que hace que el saldo no sea de fiar.
      nota={!datos ? undefined
        : datos.semanasSinPublicar > 0
          ? `${datos.semanasSinPublicar} ${datos.semanasSinPublicar === 1 ? 'semana' : 'semanas'} sin publicar en el periodo: esas horas no cuentan y el saldo sale corto`
          : datos.empleados === 0 ? 'Sin plantilla activa en el ámbito'
          : undefined}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Team · Bolsa de horas →',
        onClick: () => drillTo({
          ruta: '/personal/bolsa-horas', etiqueta: 'Abrir Team · Bolsa de horas →',
          filtros: { local: locationId },
        }),
      } : undefined}
    />
  )
}
