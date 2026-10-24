// src/modules/conta/marco/EncabezadoPagina.tsx
//
// S02 · El encabezado de cada página (encargo S02, «Encabezado de cada
// página»; tableros 2 a 9):
//   · migas pequeñas encima del título, desde el segundo nivel, y cada trozo
//     se pulsa menos el último («Compras y gastos › Facturas recibidas ›
//     EUROPASTRY 24048027»). Las dos primeras salen solas del mapa;
//   · el título, de 28 px, con lo que hay en palabras de calle; al lado, si la
//     página lo tiene, su estado («Por revisar»). Debajo, una frase de 14 px;
//   · arriba a la derecha, UN solo botón principal, azul. Lo demás, en botones
//     blancos o en «Más acciones ▾», que recoge también lo del catálogo de la
//     página (lo que antes iba en la cinta).
// Una página que lo pinta se lo dice al marco (useConPropias): el marco no
// pinta su fila de acciones de serie y nada sale dos veces.

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { dondeEsta } from '@/modules/conta/esqueleto/productos'
import { useConPropias, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { Chip, type TonoChip } from '@/modules/conta/diseno'
import { useIsMobile } from '@/shell/useIsMobile'
import { migasDe, type Miga } from './migas'
import { MasAcciones } from './MasAcciones'
import type { GrupoDeAcciones } from './acciones'

/** Las migas: pequeñas, encima del título. La última no es un enlace. */
export function Migas({ migas }: { migas: readonly Miga[] }) {
  if (migas.length === 0) return null
  return (
    <nav aria-label="Estás en" className="s-migas">
      <ol>
        {migas.map((m, i) => (
          <li key={`${m.etiqueta}-${i}`}>
            {m.a ? <Link to={m.a}>{m.etiqueta}</Link> : <span aria-current="page">{m.etiqueta}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function EncabezadoPagina({ titulo, frase, estado, migasExtra = [], principal, secundarios, masAcciones = [], derecha, sinMigas = false }: {
  titulo: ReactNode
  frase?: ReactNode
  /** El estado de lo que se ve («Por revisar»), al lado del título. */
  estado?: { texto: string; tono: TonoChip }
  /** Lo que la página añade a las migas del mapa (la ficha: «EUROPASTRY 24048027»). */
  migasExtra?: readonly Miga[]
  /** El botón azul. Uno solo. */
  principal?: ReactNode
  /** Como mucho dos botones blancos. */
  secundarios?: ReactNode
  /** Lo de la página que va en «Más acciones ▾» (además de lo del catálogo). */
  masAcciones?: readonly GrupoDeAcciones[]
  /** Lo que va a la izquierda de los botones («‹ 3 de 9 ›»). */
  derecha?: ReactNode
  sinMigas?: boolean
}) {
  useConPropias()
  const marco = useMarco()
  const movil = useIsMobile()
  const { pathname, search } = useLocation()
  const migas = sinMigas ? [] : migasDe(dondeEsta(pathname, undefined, search), (r) => rutaConta(r), migasExtra)
  const grupos = [...masAcciones, ...(marco?.accionesDelCatalogo ?? [])].filter((g) => g.acciones.length > 0)
  return (
    <header className="s-encabezado">
      <Migas migas={migas} />
      <div className="s-encabezado-fila">
        <div className="s-encabezado-titulos">
          <div className="s-encabezado-titulo-fila">
            <h1 className="s-titulo-pagina">{titulo}</h1>
            {estado && <Chip tono={estado.tono}>{estado.texto}</Chip>}
          </div>
          {frase && <p className="s-frase-pagina">{frase}</p>}
        </div>
        <div className="s-encabezado-acciones">
          {derecha}
          {secundarios}
          {grupos.length > 0 && <MasAcciones grupos={grupos} />}
          {/* En el móvil, el principal va abajo, bajo el pulgar (BotonPulgar); aquí, en el ordenador. */}
          {!movil && principal}
        </div>
      </div>
    </header>
  )
}

/** S02 · En el móvil, el botón principal (y uno más) abajo, bajo el pulgar (tablero 4). */
export function BotonPulgar({ children }: { children: ReactNode }) {
  const movil = useIsMobile()
  if (!movil) return null
  return <div className="s-pulgar">{children}</div>
}
