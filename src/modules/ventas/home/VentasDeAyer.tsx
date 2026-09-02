// src/modules/ventas/home/VentasDeAyer.tsx
//
// TARJETA «VENTAS · AYER <día>» del Inicio (§1.1 de la maqueta aprobada).
//
// Es la primera que usa DE VERDAD las tres garantías a la vez, y por eso se
// eligió la segunda:
//
//   (a) Sello propio. Umbral largo, no cero: un día CERRADO no cambia por sí
//       solo, pero las ventas de ayer sí pueden seguir entrando hoy por el
//       ingestor (un webhook que llega tarde, un reproceso). Decir «esto ya no
//       se mueve» sería tan falso como avisar cada cinco minutos.
//
//   (b) Delta contra su ESPEJO: el mismo día de la semana anterior, con su
//       nombre —«vs sábado anterior»—. Nunca «vs ayer», y nunca un día parcial
//       contra uno completo: ayer está cerrado y su espejo también.
//
//   (c) El pie aterriza FILTRADO: `/ventas?desde=…&hasta=…` con el día de
//       ayer, y esa pantalla ya sabe leerlo (02/09) y lo dice al llegar.
//
// El día se corta en hora del NEGOCIO, no del navegador: `sold_at` está en UTC
// y la medianoche de Madrid no es la de un portátil en otro huso.

import { useCallback, useMemo } from 'react'
import { Banknote } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { calculaDelta, espejoDeDia } from '@/shell/home/espejo'
import { fechaISO } from '@/shell/home/drill'
import { diaAnterior, diaEspejo } from '@/lib/fechas'
import type { HomeCardProps } from '@/shell/types'
import { ventasEntre, nombresDeLocales, type VentasDeUnDia } from './ventasDelDia'

/** Una hora. Ayer está cerrado, pero el ingestor todavía puede traer pedidos. */
const UMBRAL_MIN = 60

const eur = (n: number) =>
  n.toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR',
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  })

interface Datos { ayer: VentasDeUnDia; espejo: VentasDeUnDia }

export default function VentasDeAyer({ accountId, locationId, drillTo }: HomeCardProps) {
  // El día de ayer y su espejo, calculados UNA vez por render del componente.
  const { rangoAyer, rangoEspejo } = useMemo(() => {
    const ayer = diaAnterior(new Date())
    // `diaEspejo` y no «menos 7×24 h» a mano: el cálculo del espejo ya existe y
    // ya está probado contra el cambio de hora. Dos formas de calcular lo mismo
    // acaban discrepando (Regla 10).
    return { rangoAyer: ayer, rangoEspejo: diaEspejo(ayer.desde) }
  }, [])

  const cargar = useCallback(async (): Promise<Datos> => {
    if (!accountId) throw new Error('sin cuenta activa')
    const nombres = await nombresDeLocales(accountId)
    // En paralelo: son dos consultas independientes y la tarjeta espera a las
    // dos de todas formas.
    const [ayer, espejo] = await Promise.all([
      ventasEntre(accountId, rangoAyer.desde, rangoAyer.hasta, locationId, nombres),
      ventasEntre(accountId, rangoEspejo.desde, rangoEspejo.hasta, locationId, nombres),
    ])
    return { ayer, espejo }
  }, [accountId, locationId, rangoAyer, rangoEspejo])

  const { datos, cargando, error, sello } = useDatoDeTarjeta(
    cargar, [accountId, locationId, rangoAyer.ymd], UMBRAL_MIN,
  )

  const nombreDeAyer = rangoAyer.desde.toLocaleDateString('es-ES', { weekday: 'long' })

  const delta = useMemo(() => {
    if (!datos) return undefined
    // El espejo de AYER, no de hoy: los dos periodos son días cerrados.
    const d = calculaDelta(datos.ayer.total, datos.espejo.total, espejoDeDia(rangoAyer.desde))
    return d ? { texto: d.texto, tono: d.tono } : undefined
  }, [datos, rangoAyer])

  const filas = useMemo(() => {
    const porLocal = datos?.ayer.porLocal ?? []
    // Con un solo local el desglose repetiría la cifra grande.
    if (porLocal.length <= 1) return []
    return porLocal.map(l => ({
      etiqueta: l.nombre,
      valor: `${eur(l.total)} · ${l.pedidos} ${l.pedidos === 1 ? 'pedido' : 'pedidos'}`,
    }))
  }, [datos])

  return (
    <TarjetaInicio
      titulo={`Ventas · ayer ${nombreDeAyer}`}
      icono={Banknote}
      cifra={datos ? eur(datos.ayer.total) : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      delta={delta}
      filas={filas}
      // Sin espejo no se pinta tendencia (regla 1 de la garantía b), pero se
      // DICE por qué falta: un hueco sin explicar se lee como un fallo.
      nota={datos && !delta ? `Sin ventas el ${espejoDeDia(rangoAyer.desde).etiqueta}: no hay con qué comparar` : undefined}
      sello={sello}
      pie={drillTo
        ? {
            etiqueta: 'Abrir Ventas →',
            onClick: () => drillTo({
              ruta: '/ventas',
              etiqueta: 'Abrir Ventas →',
              filtros: { desde: fechaISO(rangoAyer.desde), hasta: fechaISO(rangoAyer.hasta) },
            }),
          }
        : undefined}
    />
  )
}
