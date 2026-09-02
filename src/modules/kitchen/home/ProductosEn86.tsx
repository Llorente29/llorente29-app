// src/modules/kitchen/home/ProductosEn86.tsx
//
// TARJETA «PRODUCTOS EN 86» del Inicio (§1.4 de la maqueta aprobada).
//
// ── DE DÓNDE SALE LA CIFRA, Y POR QUÉ DE AHÍ ───────────────────────────────
// De `listSoldOut`, que es LA MISMA función que usa la pantalla de
// Disponibilidad. No de una consulta nueva sobre `product_availability`.
//
// No es pereza, es que las dos cifras tienen que ser la misma. Medido el 02/09
// en Foodint Carabanchel: la tabla tenía 66 filas y la pantalla listaba 62. Si
// esta tarjeta hubiera consultado la tabla, el Inicio habría dicho 66, se
// pulsa «Abrir Disponibilidad →» y se ven 62. La promesa del drill-through se
// habría roto en la primera tarjeta que la usa.
//
// De aquellas cuatro de diferencia, tres eran agrupación buena —el mismo
// producto agotado bajo varias marcas se cuenta una vez— y una era un fallo que
// se arregló antes de anclar aquí (migración 20260902T0710: el panel casaba
// solo por external_id y la tienda casa por external_id O recipe_item_id).
//
// ── PRODUCTOS, NO OPCIONES ─────────────────────────────────────────────────
// La maqueta dice «Productos en 86» y así se queda. Pero las opciones de
// modificador TAMBIÉN se agotan —el 01/09 se agotaron nueve en Alcalá— y no
// aparecen aquí, así que el subtítulo lo dice con todas las letras en vez de
// dejar que alguien deduzca que no hay ninguna. Sí se ven en Disponibilidad,
// comprobado, que es justo a donde lleva el pie.
//
// ── EL UMBRAL DE FRESCURA: CORTO ───────────────────────────────────────────
// Un 86 cambia en mitad de un servicio. Cinco minutos, no los diez de por
// defecto: aquí un número de hace un cuarto de hora ya puede mandar a alguien
// a decirle a un cliente que no hay algo que sí hay.

import { useCallback, useMemo } from 'react'
import { CircleSlash } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import type { DrillDestino } from '@/shell/home/drill'
import { listSoldOut, type SoldOutRow } from '../services/availabilityService'
import { resumeAgotados } from './resumeAgotados'

const UMBRAL_MIN = 5

const A_DISPONIBILIDAD: DrillDestino = {
  ruta: '/kitchen/disponibilidad',
  etiqueta: 'Abrir Disponibilidad →',
}


export default function ProductosEn86({ accountId, locationId, drillTo }: HomeCardProps) {
  const cargar = useCallback(
    () => (accountId ? listSoldOut(accountId, locationId) : Promise.resolve([] as SoldOutRow[])),
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(cargar, [accountId, locationId], UMBRAL_MIN)

  const { total, filas, nota } = useMemo(() => resumeAgotados(datos ?? []), [datos])

  return (
    <TarjetaInicio
      titulo="Productos en 86"
      icono={CircleSlash}
      // Antes esto era `String(total)` y con `datos` nulo pintaba un 0: «cero
      // agotados» y «no he podido mirar» se leen igual y significan lo
      // contrario. Ahora la cifra solo sale si hay dato.
      cifra={datos ? String(total) : undefined}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
      filas={filas}
      // Se dice que las opciones no cuentan aquí, en vez de dejar que se
      // deduzca de un número que no las incluye.
      nota={[nota, 'Productos; las opciones de modificador se ven en Disponibilidad']
        .filter(Boolean).join(' · ')}
      sello={sello}
      pie={drillTo
        ? {
            etiqueta: A_DISPONIBILIDAD.etiqueta,
            // El filtro viaja: si se está mirando un local, se aterriza en ese
            // local. En consolidado no se manda nada — un `local=null` en la URL
            // es peor que ningún parámetro.
            onClick: () => drillTo({ ...A_DISPONIBILIDAD, filtros: { local: locationId } }),
          }
        : undefined}
    />
  )
}
