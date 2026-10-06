// src/modules/conta/ajustes/MarcoAjustes.tsx
//
// C02 §5a · Ajustes deja de ser pestañas: una página con índice lateral
// agrupado (maqueta N6Ajustes). Ordenador: el índice a la izquierda y la
// entrada a la derecha. Móvil: el índice es la lista y cada entrada abre su
// pantalla con «atrás». Solo contabilidad: nada de Cocina, reparto, locales ni
// marcas (eso sigue en los Ajustes de Folvy).
//
// Carga UNA vez los datos de la empresa y el plan, y se los da a las entradas
// por contexto (useAjustes, en contextoAjustes.ts): la línea de resumen de
// cada entrada sale de ahí.

import { useEffect, type ReactNode } from 'react'
import { CtxAjustes as Ctx, resumenEntrada, type ContextoAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { Link } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { INDICE_AJUSTES, rutaAltaEmpresa, rutaAjustes, rutaConta } from '@/config/navegacion'
import { Cabecera, Chip, ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { useEmpresas, type EmpresaResumen } from '@/modules/conta/empresa/contexto'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useDatosEmpresa } from '@/modules/conta/empresa/useDatosEmpresa'
import { usePlan } from '@/modules/conta/plan/usePlan'
import { fraseFalta, loQueFalta, type DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import { TOTAL_PUNTOS, hechosDeUnaAMedias } from '@/modules/conta/alta/llevamos'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { CabeceraEmpresa } from '@/modules/conta/marco/MenuConta'
import { Sugerencias } from '@/modules/conta/ia/PiezasIA'
import type { DatosPlan } from '@/modules/conta/services/planService'

function EtiquetaListo({ d, hoy }: { d: DatosEmpresa; hoy: string }) {
  const falta = loQueFalta(d, hoy)
  return falta.length === 0 ? <Chip tono="ia">Todo listo para llevar tu contabilidad</Chip> : <Chip tono="ambar">{fraseFalta(falta)}</Chip>
}

/** Respuesta 3 del C00: salir del alta deja el aviso para seguirla. */
function AvisoAltaAMedias({ e }: { e: EmpresaResumen }) {
  const hechos = hechosDeUnaAMedias(e.pasoAlta, e.razonSocial !== null, e.tieneDireccion)
  return (
    <div className="cx-aviso-alta" role="status" aria-label="Alta a medias">
      <span><b>Alta a medias</b> · {e.razonSocial ?? 'empresa sin nombre todavía'} · <span className="cx-cifra">{hechos} de {TOTAL_PUNTOS}</span></span>
      <Link to={rutaAltaEmpresa()} className="cx-boton">Seguir</Link>
    </div>
  )
}

function Indice({ actual, d, plan, hoy, lista }: { actual: string | null; d: DatosEmpresa | null; plan: DatosPlan | null; hoy: string; lista: boolean }) {
  return (
    <nav aria-label="Ajustes" className={lista ? 'cx-ajustes-lista' : 'cx-tarjeta cx-ajustes-indice'}>
      {INDICE_AJUSTES.map((g) => (
        <div key={g.grupo} className="cx-ajustes-grupo">
          <h2 className="cx-ajustes-grupo-titulo">{g.grupo}</h2>
          <div className={lista ? 'cx-lista' : undefined}>
            {g.entradas.map((e) => (
              <Link key={e.id} to={rutaConta(e.ruta)} className={lista ? 'cx-lista-fila' : 'cx-ajustes-enlace'} aria-current={actual === e.id ? 'page' : undefined}>
                <span className="cx-lista-fila-texto">
                  <span className={lista ? 'cx-lista-fila-titulo' : 'cx-ajustes-enlace-titulo'}>{e.etiqueta}</span>
                  <span className={lista ? 'cx-lista-fila-apoyo' : 'cx-ajustes-enlace-apoyo'}>{resumenEntrada(e, d, plan, hoy)}</span>
                </span>
                {lista && <span className="cx-flecha" aria-hidden="true">›</span>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

/** Cabecera de una entrada en el móvil: «atrás» al índice y su título. */
export function CabeceraEntradaMovil({ titulo, atras = rutaAjustes(), antetitulo = 'Ajustes', derecha }: { titulo: string; atras?: string; antetitulo?: string; derecha?: ReactNode }) {
  return (
    <header className="cx-cabecera cx-tablas-cabecera-movil">
      <Link to={atras} className="cx-boton-sec cx-atras" aria-label={`Volver a ${antetitulo.toLowerCase()}`}>‹</Link>
      <div className="cx-cabecera-titulos" style={{ flexGrow: 1 }}>
        <span className="cx-antetitulo">{antetitulo}</span>
        <h1 className="cx-titulo">{titulo}</h1>
      </div>
      {derecha}
    </header>
  )
}

/**
 * El marco. `entrada` = la que está abierta (null: en el ordenador, «Tu
 * empresa»; en el móvil, el índice). `children` es el contenido de la entrada.
 */
export function MarcoAjustes({ entrada, children }: { entrada: string | null; children: ReactNode }) {
  const movil = useIsMobile()
  const { accountId, userId, esAdmin } = useCuentaConta()
  const { cargando, error, activa, recargar, empresas } = useEmpresas()
  const datos = useDatosEmpresa(accountId, activa?.id ?? null, esAdmin)
  const plan = usePlan(accountId, activa?.id ?? null)
  const hoy = hoyEnMadrid()
  // Al volver del alta la lista de empresas puede ser la de antes: se relee.
  useEffect(() => { recargar() }, [recargar])

  const d = datos.datos
  const aMedias = empresas.find((e) => !e.completa) ?? null
  const actual = entrada ?? (movil ? null : 'empresa')
  const cabecera = (!movil || entrada === null) && (
    <>
      <Cabecera antetitulo="Folvy Conta" titulo="Ajustes" derecha={d && !movil ? <EtiquetaListo d={d} hoy={hoy} /> : undefined} />
      {aMedias && <AvisoAltaAMedias e={aMedias} />}
    </>
  )

  if (cargando && !activa) return <>{cabecera}<TarjetaCargando /></>
  if (error) return <>{cabecera}<ErrorConReintento mensaje={error} reintentar={recargar} /></>
  if (!activa) {
    return (
      <>
        {cabecera}
        <div className="cx-tarjeta">
          <Vacio titulo="Aún no has dado de alta tu empresa."
            explicacion="Cuéntame a qué te dedicas y la dejo montada: tus impuestos, tu ejercicio, tu plan contable y tus tablas. Son tres minutos y no hace falta saber de contabilidad."
            accion={<Link to={rutaAltaEmpresa()} className="cx-boton">Dar de alta mi empresa</Link>} />
        </div>
      </>
    )
  }

  const valor: ContextoAjustes = {
    datos, plan, movil, hoy, quien: { accountId: accountId ?? '', companyId: activa.id, userId },
  }

  if (movil && entrada === null) {
    return (
      <Ctx.Provider value={valor}>
        {cabecera}
        {/* Como la lista de M2: con más de una empresa, en el móvil no hay otro sitio para cambiar. */}
        {empresas.length > 1 && <div className="cx-tarjeta cx-empresa-movil"><CabeceraEmpresa /></div>}
        {d && <EtiquetaListo d={d} hoy={hoy} />}
        {d && <Sugerencias sugerencias={d.ia.sugerencias} alCambiar={datos.recargar} />}
        <Indice actual={null} d={d} plan={plan.datos} hoy={hoy} lista />
      </Ctx.Provider>
    )
  }
  // El contenido va SIEMPRE en el mismo sitio del árbol, en los dos tamaños: si
  // cambiara de forma al cruzar los 768 px, React lo desmontaría y se perdería
  // lo que hubiera a medias (06/10: la captura de página entera de Chromium
  // deja la ventana a 1×1 un instante y el asistente del C02c volvía al paso 1;
  // a una persona le pasaría al estrechar la ventana o girar la tableta). En el
  // móvil los dos envoltorios no pintan nada (display: contents).
  return (
    <Ctx.Provider value={valor}>
      {cabecera}
      <div className={movil ? 'cx-ajustes-movil' : 'cx-ajustes'}>
        {!movil && <Indice actual={actual} d={d} plan={plan.datos} hoy={hoy} lista={false} />}
        <div className={movil ? 'cx-ajustes-movil' : 'cx-ajustes-panel'}>{children}</div>
      </div>
    </Ctx.Provider>
  )
}
