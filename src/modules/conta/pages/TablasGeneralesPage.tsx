// src/modules/conta/pages/TablasGeneralesPage.tsx
//
// Ajustes › Tablas generales (maquetas N3Tablas y M3Tablas). Tarea 4 del C00.
//
// Ordenador: las nueve tablas a la izquierda con sus cifras y la elegida a la
// derecha. Móvil: la lista de tablas y, al tocar una, esa tabla con «atrás».
// Nunca más de dos pasos hasta una tabla (encargo §7).

import { Link, Navigate, useParams } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { PESTANAS_AJUSTES, rutaAltaEmpresa, rutaTablasGenerales } from '@/config/navegacion'
import { Cabecera, ErrorConReintento, PestanasPildora, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { TABLAS_GENERALES, agruparConceptos, definicion, type DefinicionTabla } from '@/modules/conta/tablas/registro'
import { useTablasGenerales } from '@/modules/conta/tablas/useTablasGenerales'
import { TablaGeneral } from '@/modules/conta/tablas/TablaGeneral'
import type { FilasPorTabla } from '@/modules/conta/services/tablasService'

/** Cuántos conceptos tiene cada tabla (las vigencias de lo mismo cuentan una vez). */
function cuantos(def: DefinicionTabla, filas: FilasPorTabla, hoy: string): number {
  return agruparConceptos(filas[def.id] ?? [], def.conVigencia, hoy).length
}

export default function TablasGeneralesPage() {
  const { tabla } = useParams()
  const movil = useIsMobile()
  const { accountId, userId } = useCuentaConta()
  const { cargando: cargandoEmpresas, error: errorEmpresas, activa, recargar: recargarEmpresas } = useEmpresas()
  const datos = useTablasGenerales(accountId, activa?.id ?? null)

  const elegida = tabla === undefined ? null : definicion(tabla)
  if (tabla !== undefined && !elegida) return <Navigate to={rutaTablasGenerales()} replace />
  const def = elegida ?? (movil ? null : TABLAS_GENERALES[0])

  const cabecera = !(movil && def) && (
    <>
      <Cabecera antetitulo="Ajustes" titulo="Tablas generales" />
      <PestanasPildora entradas={PESTANAS_AJUSTES} etiqueta="Ajustes" />
    </>
  )

  // Solo esqueleto si aún no hay empresa: si ya la hay, una recarga de la
  // cuenta (al llegar la sesión, accountsLoading parpadea) no desmonta la
  // pantalla ni cierra la fila que la persona tenía abierta.
  if (cargandoEmpresas && !activa) return <>{cabecera}<TarjetaCargando /></>
  if (errorEmpresas) return <>{cabecera}<ErrorConReintento mensaje={errorEmpresas} reintentar={recargarEmpresas} /></>
  if (!activa) {
    return (
      <>
        {cabecera}
        <div className="cx-tarjeta">
          <Vacio titulo="Las tablas son de cada empresa, y aún no has dado de alta la tuya."
            explicacion="Con el alta quedan puestos tus impuestos, tus formas de pago y lo demás. Son tres minutos."
            accion={<Link to={rutaAltaEmpresa()} className="cx-boton">Dar de alta mi empresa</Link>} />
        </div>
      </>
    )
  }

  const hoy = datos.ctx?.hoy ?? ''
  const cifra = (d: DefinicionTabla) => (datos.ctx ? String(cuantos(d, datos.filas, hoy)) : '')

  // Móvil, sin tabla elegida: la lista de las nueve.
  if (movil && !def) {
    return (
      <>
        {cabecera}
        {datos.error ? <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} /> : (
          <nav aria-label="Tablas" className="cx-lista">
            {TABLAS_GENERALES.map((d) => (
              <Link key={d.id} to={rutaTablasGenerales(d.id)} className="cx-lista-fila">
                <span className="cx-lista-fila-texto"><span className="cx-lista-fila-titulo">{d.titulo}</span></span>
                <span className="cx-cifra cx-rejilla-apoyo">{cifra(d)}</span>
                <span className="cx-flecha" aria-hidden="true">›</span>
              </Link>
            ))}
          </nav>
        )}
      </>
    )
  }

  const quien = { accountId: accountId ?? '', companyId: activa.id, userId }
  const bancos = (datos.filas['bancos-y-cajas'] ?? []).map((b) => ({ id: b.id, nombre: String(b.datos.name) }))

  const contenido = !def ? null : datos.cargando ? <TarjetaCargando /> : datos.error || !datos.ctx ? (
    <ErrorConReintento mensaje={datos.error ?? 'No se ha podido leer.'} reintentar={datos.recargar} />
  ) : (
    <TablaGeneral key={`${def.id}:${activa.id}`} def={def} filas={datos.filas[def.id] ?? []} ctx={datos.ctx}
      quien={quien} bancos={bancos} movil={movil} alCambiar={datos.recargar}
      cabeceraMovil={(alta) => (
        <header className="cx-cabecera cx-tablas-cabecera-movil">
          <Link to={rutaTablasGenerales()} className="cx-boton-sec cx-atras" aria-label="Volver a las tablas generales">‹</Link>
          <div className="cx-cabecera-titulos" style={{ flexGrow: 1 }}>
            <span className="cx-antetitulo">Tablas generales</span>
            <h1 className="cx-titulo">{def.titulo}</h1>
          </div>
          {!def.soloLectura && (
            <button type="button" className="cx-boton cx-mas" onClick={alta} aria-label={`Añadir ${def.singular}`}>+</button>
          )}
        </header>
      )} />
  )

  if (movil) return <>{contenido}</>

  return (
    <>
      {cabecera}
      <div className="cx-tablas">
        <nav aria-label="Tablas" className="cx-tarjeta cx-tablas-menu">
          {TABLAS_GENERALES.map((d) => (
            <Link key={d.id} to={rutaTablasGenerales(d.id)} className="cx-tablas-enlace" aria-current={def?.id === d.id ? 'page' : undefined}>
              {d.titulo}
              <span className="cx-tablas-cuenta">{cifra(d)}</span>
            </Link>
          ))}
        </nav>
        {contenido}
      </div>
    </>
  )
}
