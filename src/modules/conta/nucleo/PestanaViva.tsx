// src/modules/conta/nucleo/PestanaViva.tsx
//
// K03 · Una pestaña de trabajo del núcleo, VIVA: su pantalla sigue montada
// aunque se mire otra, y por eso conserva lo escrito a medias, el filtro y la
// fila elegida. Además, al volver, dónde estaba la rueda y en qué casilla
// estaba el foco.
//
// Cada pestaña pinta las rutas del módulo con SU dirección (useRoutes con la
// dirección de la pestaña): la pantalla lee su useLocation, sus parámetros y
// su consulta como si estuviera sola. El contexto de ruta se reinicia, porque
// una ruta pintada dentro de otra se lee relativa a ella.
//
// Lo que el marco de hoy da a cada pantalla (MarcoContexto) es, aquí, POR
// PESTAÑA: los huecos del periodo y de sus acciones, lo que pone en la cinta y
// si pinta su propio encabezado. Lo demás (la empresa, el nivel, la densidad)
// es del marco y se comparte.

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UNSAFE_RouteContext, useRoutes, type Location } from 'react-router-dom'
import { FranjaDemo } from '@/modules/conta/cuenta/FranjaDemo'
import { TeTocaHoy } from '@/modules/conta/ui/marco/TeTocaHoy'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MarcoContexto, type DatosCinta, type EntradasCinta, type Marco as ValorMarco, type Propias } from '@/modules/conta/marco/nuevo/contexto'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { dondeEsta, type Contexto } from '@/modules/conta/esqueleto/productos'
import { cintaDe } from '@/modules/conta/esqueleto/ordenes'
import { AccionesDePagina } from '@/modules/conta/marco/AccionesDePagina'
import { resolverGrupos } from '@/modules/conta/marco/resolverGrupos'
import { PestanaContexto, type CambiosDePestana, type PestanaDeTrabajo } from '@/modules/conta/diseno/plantillas/pestana'
import { rutasDelNucleo } from './rutas'
import { claveDe, INICIO } from './pestanas'

const SIN_RUTA = { outlet: null, matches: [], isDataRoute: false }

function Pantalla({ ubicacion }: { ubicacion: Location }) {
  return useRoutes(rutasDelNucleo(), ubicacion)
}

export interface PropsPestanaViva {
  id: string
  ubicacion: Location
  activa: boolean
  /** Lo del marco que se comparte (sin lo de la pestaña). */
  base: Omit<ValorMarco, 'huecoAcciones' | 'huecoPeriodo' | 'ponerDatosCinta' | 'ponerEntradasCinta' | 'ponerConPropias' | 'accionesDelCatalogo'>
  ctx: Contexto
  cuentas: CuentasMenu
  abrirBuscador: () => void
  ponerNombre: (id: string, nombre: string | null) => void
  ponerCambios: (id: string, c: CambiosDePestana | null) => void
  /** K04 · Cerrar esta pestaña, con la pregunta si tiene cambios (Esc en una ficha). */
  cerrar: (id: string) => void
  /** La pestaña dice su nombre (para «Acciones de …»). */
  nombre: string
}

function PestanaVivaSinMemo({ id, ubicacion, activa, base, ctx, cuentas, abrirBuscador, ponerNombre, ponerCambios, cerrar, nombre }: PropsPestanaViva) {
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLDivElement | null>(null)
  const [huecoPeriodo, setHuecoPeriodo] = useState<HTMLDivElement | null>(null)
  const [datosCinta, setDatosCinta] = useState<DatosCinta | null>(null)
  const [entradasCinta, setEntradasCinta] = useState<EntradasCinta | null>(null)
  const [propias, setPropias] = useState<Propias | null>(null)

  const { pathname, search } = ubicacion
  const donde = dondeEsta(pathname, undefined, search)
  const catalogo = donde?.producto && donde.pestana ? cintaDe(donde.producto.id, donde.pestana.id, ctx) : []
  const grupos = resolverGrupos(catalogo, { datos: datosCinta, entradas: entradasCinta, pathname, search, abrirBuscador })
  const clave = JSON.stringify(grupos.map((g) => [g.titulo, g.acciones.map((a) => [a.id, a.numero, a.aviso, a.actual])]))
  const marco: ValorMarco = useMemo(() => ({
    ...base,
    huecoAcciones,
    huecoPeriodo,
    ponerDatosCinta: setDatosCinta,
    ponerEntradasCinta: setEntradasCinta,
    ponerConPropias: setPropias,
    accionesDelCatalogo: grupos,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [base, huecoAcciones, huecoPeriodo, clave])

  const pestana: PestanaDeTrabajo = useMemo(() => ({
    id,
    activa,
    ponerNombre: (n) => ponerNombre(id, n),
    ponerCambios: (c) => ponerCambios(id, c),
    esDeEstaPestana: (destino) => claveDe(destino) === id,
    cerrar: () => cerrar(id),
  }), [id, activa, ponerNombre, ponerCambios, cerrar])

  // Dónde estaba la rueda y el foco, para volver a encontrarlo todo como se dejó.
  const zona = useRef<HTMLElement | null>(null)
  const rueda = useRef(0)
  const foco = useRef<HTMLElement | null>(null)
  const alRodar = useCallback(() => { if (zona.current && !zona.current.hidden) rueda.current = zona.current.scrollTop }, [])
  const alEnfocar = useCallback((e: React.FocusEvent) => { foco.current = e.target as HTMLElement }, [])
  useLayoutEffect(() => {
    if (!activa || !zona.current) return
    zona.current.scrollTop = rueda.current
    const f = foco.current
    if (f && f.isConnected && zona.current.contains(f)) f.focus({ preventScroll: true })
  }, [activa])

  return (
    <PestanaContexto.Provider value={pestana}>
      <MarcoContexto.Provider value={marco}>
        <main ref={zona} tabIndex={-1} className="cx-principal cxm-principal s-principal k-zona" hidden={!activa} data-pestana={id}
          data-activa={activa ? 'si' : 'no'} onScroll={alRodar} onFocus={alEnfocar} aria-label={nombre}>
          <FranjaDemo />
          <div className="k-periodo" ref={setHuecoPeriodo} />
          {propias !== 'encabezado' && (
            <AccionesDePagina grupos={grupos} conBarra={propias === 'barra'} hueco={setHuecoAcciones} etiqueta={`Acciones de ${nombre}`} />
          )}
          {id === INICIO && <TeTocaHoy chips={chipsDelInicio(cuentas)} />}
          <UNSAFE_RouteContext.Provider value={SIN_RUTA}>
            <Pantalla ubicacion={ubicacion} />
          </UNSAFE_RouteContext.Provider>
        </main>
      </MarcoContexto.Provider>
    </PestanaContexto.Provider>
  )
}

/** Una pestaña escondida no se vuelve a pintar porque cambie otra (solo si cambia lo suyo). */
export const PestanaViva = memo(PestanaVivaSinMemo)
