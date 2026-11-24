// src/modules/conta/nucleo/listado/ListadoSegun.tsx
//
// Q06 · Qué listado sale: dentro de una pestaña del núcleo (el interruptor
// conta_nucleo encendido y en el ordenador: lo decide el marco, MarcoSegun), la
// ventana de listado nueva; fuera, la pantalla de hoy, sin un cambio (como
// RecibidaSegun de la K04). Así, con el interruptor apagado, todo sigue igual.
//
//   · libros/:area/:accion → el mayor, sumas y saldos y los dos libros de IVA;
//     las demás acciones (balance, retenciones, acumulados…), las de hoy.
//   · libros/diario/resumido → el diario.
//   · plan/:codigo (lo que abre F5) → el mayor de esa cuenta.

import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { usePestana } from '@/modules/conta/diseno/plantillas'
import { ListadoNucleo } from './ListadoNucleo'
import { queDeLaAccion, type QueListado } from './rutas'

export default function ListadoSegun({ hoy, que }: { hoy: ReactNode; que?: QueListado }) {
  const enPestana = usePestana() !== null
  const params = useParams()
  const elQue = que ?? queDeLaAccion(params.accion)
  if (!enPestana || !elQue) return <>{hoy}</>
  return <ListadoNucleo que={elQue} cuentaDada={params.codigo ?? null} />
}
