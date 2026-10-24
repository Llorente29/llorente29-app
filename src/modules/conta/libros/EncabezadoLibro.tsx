// src/modules/conta/libros/EncabezadoLibro.tsx
//
// S02 · PR 2 · El encabezado de cada libro: el del patrón (EncabezadoPagina:
// migas, el nombre del libro como título visible, una frase con el periodo y
// lo que se ve, los botones) con el selector «Ver: <libro>. Cambiar» delante
// de los botones, para pasar de un libro a otro.
//
// Cómo: el catálogo de la página se reparte aquí (encabezado.ts). El selector
// se pinta en el hueco `derecha` del encabezado, y al encabezado le llega un
// marco con el catálogo SIN los grupos `ver` (un proveedor del contexto solo
// para él): así su «Más acciones» no repite los libros. Fuera del marco no hay
// catálogo ni selector, y el encabezado se pinta igual.

import { useMemo, type ReactNode } from 'react'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { SelectorDePagina } from '@/modules/conta/marco/MasAcciones'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { MarcoContexto, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { repartoDelLibro } from './encabezado'

export function EncabezadoLibro({ titulo, frase, principal, secundarios, masAcciones }: {
  titulo: ReactNode
  frase?: ReactNode
  principal?: ReactNode
  /** Como mucho dos blancos (Exportar PDF, Excel). */
  secundarios?: ReactNode
  masAcciones?: readonly GrupoDeAcciones[]
}) {
  const marco = useMarco()
  const catalogo = marco?.accionesDelCatalogo
  const reparto = useMemo(() => repartoDelLibro(catalogo ?? []), [catalogo])
  const sinVer = useMemo(() => (marco ? { ...marco, accionesDelCatalogo: reparto.resto } : null), [marco, reparto.resto])
  // En el móvil, EncabezadoPagina no pinta el principal: va abajo, bajo el pulgar.
  const encabezado = (
    <>
    <EncabezadoPagina titulo={titulo} frase={frase} principal={principal} secundarios={secundarios} masAcciones={masAcciones}
      derecha={reparto.selectores.length > 0 ? reparto.selectores.map((s) => <SelectorDePagina key={s.titulo} s={s} />) : undefined} />
    {principal && <BotonPulgar>{principal}</BotonPulgar>}
    </>
  )
  return sinVer ? <MarcoContexto.Provider value={sinVer}>{encabezado}</MarcoContexto.Provider> : encabezado
}
