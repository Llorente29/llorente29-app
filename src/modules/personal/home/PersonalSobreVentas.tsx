// Tarjeta «% personal sobre ventas» (§Team de la maqueta). Frente 9, decidido.
//
// LA TARJETA DICE CUÁL USA, que era la mitad de la decisión de Julio: el
// sufijo pone «coste de empresa». Una cifra de la que hay que preguntar cómo
// está hecha ya ha fallado — si hay que preguntar, la respuesta llega tarde.
//
// Y CUANDO NO SE PUEDE CALCULAR, NO DA NÚMERO. Hoy es el caso: ninguno de los
// seis empleados tiene la seguridad social rellena. La tarjeta dice qué falta y
// a quién, que es accionable; un porcentaje sacado del bruto sería ~30 % más
// bajo del real y diría que el negocio va mejor de lo que va.
import { useCallback } from 'react'
import { Users2 } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { eurEntero } from '@/lib/dinero'
import type { HomeCardProps } from '@/shell/types'
import { leePersonalSobreVentas, type CosteDePersonal } from './personalSobreVentas'

export default function PersonalSobreVentas({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    (): Promise<CosteDePersonal> => {
      if (!accountId) throw new Error('sin cuenta activa')
      return leePersonalSobreVentas(accountId, locationId)
    },
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], 30)

  const pct = datos?.porcentaje

  return (
    <TarjetaInicio
      titulo="% personal sobre ventas"
      icono={Users2}
      cifra={!datos ? undefined
        : pct == null ? 'sin calcular'
        : `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`}
      // La mitad de la decisión: la tarjeta dice CUÁL usa.
      cifraSufijo={datos && pct != null ? 'coste de empresa' : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={!datos || pct == null ? [] : [
        { etiqueta: 'Coste de personal', valor: eurEntero(datos.costeEur), tono: 'neutral' as const },
        { etiqueta: 'Ventas', valor: eurEntero(datos.ventasEur), tono: 'neutral' as const },
        { etiqueta: 'Horas trabajadas', valor: `${Math.round(datos.horas)} h`, tono: 'neutral' as const },
      ]}
      nota={!datos ? undefined
        : datos.sinDato > 0
          // Qué falta y a quién. Accionable, en vez de un porcentaje que nadie
          // podría auditar.
          ? `Falta el coste de ${datos.sinDato} de ${datos.totalEmpleados}: ${datos.queFalta.slice(0, 3).join(', ')}`
            + (datos.queFalta.length > 3 ? ` y ${datos.queFalta.length - 3} más` : '')
          : datos.ventasEur <= 0
            ? 'Todavía no hay ventas esta semana con las que comparar'
            : `${datos.periodo}, de lunes a hoy`}
      sello={sello}
      pie={drillTo ? {
        etiqueta: 'Abrir Team · Informes →',
        onClick: () => drillTo({
          ruta: '/personal/informes-analitica', etiqueta: 'Abrir Team · Informes →',
          filtros: { local: locationId },
        }),
      } : undefined}
    />
  )
}
