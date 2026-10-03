// src/modules/conta/pages/TuEmpresaPage.tsx
//
// Ajustes › Tu empresa (maquetas N2Empresa y M2Empresa). Tarea 5 del C00.
//
// Ordenador: las seis tarjetas en una pantalla. Móvil: la lista de apartados
// y, al tocar uno, su pantalla con «atrás» (ajustes/empresa/:apartado). Todo
// se cambia en su tarjeta, sin ventanas encima.
//
// La etiqueta de la cabecera dice «Todo listo para llevar tu contabilidad»
// solo si no falta nada; si falta algo, dice qué (regla 7: no se esconde).
//
// El bloque verde de la maqueta es una SUGERENCIA de la IA (§6.2): sale solo
// si se puede fundamentar con datos de la propia cuenta (hoy, el 115 por un
// alquiler con retención y el 111 por retenciones a profesionales). La del
// reparto a domicilio de la maqueta necesitaría las ventas de Cocina, y
// contabilidad no depende de Cocina: no se inventa.

import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { PESTANAS_AJUSTES, rutaAltaEmpresa, rutaApartadoEmpresa, rutaTuEmpresa } from '@/config/navegacion'
import { Cabecera, Chip, ErrorConReintento, PestanasPildora, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { useEmpresas, type EmpresaResumen } from '@/modules/conta/empresa/contexto'
import { TOTAL_PUNTOS, hechosDeUnaAMedias } from '@/modules/conta/alta/llevamos'
import { CabeceraEmpresa } from '@/modules/conta/marco/MenuConta'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useDatosEmpresa } from '@/modules/conta/empresa/useDatosEmpresa'
import { APARTADOS, apartado as buscarApartado, type ClaveApartado, type Quien } from '@/modules/conta/empresa/apartados'
import { fraseFalta, loQueFalta, mesesConEstado, ejercicioActual, type DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { DetalleContable, QuienEres, TusImpuestos } from '@/modules/conta/empresa/ApartadosEmpresa'
import { Actividades, EjercicioMeses, Socios } from '@/modules/conta/empresa/ApartadosActividad'
import { RegistroIA, Sugerencias } from '@/modules/conta/ia/PiezasIA'
import { ParaPresentar } from '@/modules/conta/empresa/ApartadoPresentar'

function EtiquetaListo({ d, hoy }: { d: DatosEmpresa; hoy: string }) {
  const falta = loQueFalta(d, hoy)
  return falta.length === 0
    ? <Chip tono="ia">Todo listo para llevar tu contabilidad</Chip>
    : <Chip tono="ambar">{fraseFalta(falta)}</Chip>
}

/** Respuesta 3: salir del alta deja aquí el aviso para seguirla. */
function AvisoAltaAMedias({ e }: { e: EmpresaResumen }) {
  const hechos = hechosDeUnaAMedias(e.pasoAlta, e.razonSocial !== null, e.tieneDireccion)
  return (
    <div className="cx-aviso-alta" role="status" aria-label="Alta a medias">
      <span><b>Alta a medias</b> · {e.razonSocial ?? 'empresa sin nombre todavía'} · <span className="cx-cifra">{hechos} de {TOTAL_PUNTOS}</span></span>
      <Link to={rutaAltaEmpresa()} className="cx-boton">Seguir</Link>
    </div>
  )
}

function UnApartado({ id, d, quien, alCambiar, movil, hoy }: {
  id: ClaveApartado; d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean; hoy: string
}) {
  const p = { d, quien, alCambiar, movil, hoy }
  switch (id) {
    case 'quien-eres': return <QuienEres {...p} />
    case 'actividad': return <Actividades {...p} />
    case 'impuestos': return <TusImpuestos {...p} />
    case 'ejercicio': return <EjercicioMeses {...p} />
    case 'socios': return <Socios {...p} />
    case 'presentar': return <ParaPresentar d={d} movil={movil} hoy={hoy} />
    case 'detalle': return <DetalleContable {...p} />
    case 'registro': return <RegistroIA registro={d.ia.registro} alCambiar={alCambiar} movil={movil} />
  }
}

export default function TuEmpresaPage() {
  const { apartado: param } = useParams()
  const movil = useIsMobile()
  const { accountId, userId, esAdmin } = useCuentaConta()
  const { cargando, error, activa, recargar, empresas } = useEmpresas()
  const datos = useDatosEmpresa(accountId, activa?.id ?? null, esAdmin)
  const hoy = hoyEnMadrid()
  // Al llegar aquí desde el alta (salir, cerrar la ventana o el botón atrás),
  // la lista de empresas puede ser la de antes: el proveedor se reutiliza
  // entre rutas. Se relee, para que «Alta a medias · N de 6» diga lo de ahora.
  useEffect(() => { recargar() }, [recargar])

  const elegido = param === undefined ? null : buscarApartado(param)
  if (param !== undefined && !elegido) return <Navigate to={rutaTuEmpresa()} replace />
  // En el ordenador todo cabe en una pantalla: el apartado suelto vuelve a ella.
  if (elegido && !movil) return <Navigate to={rutaTuEmpresa()} replace />

  const d = datos.datos
  const aMedias = empresas.find((e) => !e.completa) ?? null
  const cabecera = (
    <>
      <Cabecera antetitulo="Ajustes" titulo="Tu empresa" derecha={d && !movil ? <EtiquetaListo d={d} hoy={hoy} /> : undefined} />
      {/* También en el móvil, aunque M2 no las dibuja: sin ellas no se llega a
          Tablas generales desde el teléfono (lo cazó el e2e de la cuenta B). */}
      <PestanasPildora entradas={PESTANAS_AJUSTES} etiqueta="Ajustes" />
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
            explicacion="Cuéntame a qué te dedicas y la dejo montada: tus impuestos, tu ejercicio y tus tablas. Son tres minutos y no hace falta saber de contabilidad."
            accion={<Link to={rutaAltaEmpresa()} className="cx-boton">Dar de alta mi empresa</Link>} />
        </div>
      </>
    )
  }
  if (datos.cargando) return <>{cabecera}<TarjetaCargando /></>
  if (datos.error || !d) return <>{cabecera}<ErrorConReintento mensaje={datos.error ?? 'No se ha podido leer.'} reintentar={datos.recargar} /></>

  const quien: Quien = { accountId: accountId ?? '', companyId: activa.id, userId }
  const comun = { d, quien, alCambiar: datos.recargar, movil, hoy }

  // Móvil, un apartado: su pantalla con «atrás».
  if (movil && elegido) {
    return (
      <>
        <header className="cx-cabecera cx-tablas-cabecera-movil">
          <Link to={rutaTuEmpresa()} className="cx-boton-sec cx-atras" aria-label="Volver a tu empresa">‹</Link>
          <div className="cx-cabecera-titulos" style={{ flexGrow: 1 }}>
            <span className="cx-antetitulo">Tu empresa</span>
            <h1 className="cx-titulo">{elegido.titulo(d, hoy)}</h1>
          </div>
        </header>
        <UnApartado id={elegido.id} {...comun} />
      </>
    )
  }

  // Móvil: la lista de apartados.
  if (movil) {
    const ej = ejercicioActual(d.ejercicios, hoy)
    return (
      <>
        {cabecera}
        {/* M2 dibuja una sola empresa. Con más de una, en el móvil no hay otro
            sitio para cambiar: la misma cabecera que el menú del ordenador. */}
        {empresas.length > 1 && <div className="cx-tarjeta cx-empresa-movil"><CabeceraEmpresa /></div>}
        <EtiquetaListo d={d} hoy={hoy} />
        <Sugerencias sugerencias={d.ia.sugerencias} alCambiar={datos.recargar} />
        <nav aria-label="Apartados de tu empresa" className="cx-lista">
          {APARTADOS.map((a) => (
            <Link key={a.id} to={rutaApartadoEmpresa(a.id)} className="cx-lista-fila">
              <span className="cx-lista-fila-texto">
                <span className="cx-lista-fila-titulo">{a.titulo(d, hoy)}</span>
                <span className="cx-lista-fila-apoyo">{a.resumen(d, hoy)}</span>
                {a.id === 'ejercicio' && ej && (
                  <span className="cx-meses-mini" aria-hidden="true">
                    {mesesConEstado(ej, d.cierres, hoy).map((m) => <span key={m.mes} className={`cx-mes cx-mes-${m.estado}`}>{m.corto.charAt(0)}</span>)}
                  </span>
                )}
              </span>
              <span className="cx-flecha" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
      </>
    )
  }

  // Ordenador: las seis tarjetas, como N2.
  return (
    <>
      {cabecera}
      <Sugerencias sugerencias={d.ia.sugerencias} alCambiar={datos.recargar} />
      <div className="cx-rejilla-3">
        <QuienEres {...comun} />
        <Actividades {...comun} />
        <TusImpuestos {...comun} />
      </div>
      <div className="cx-rejilla-2-1">
        <EjercicioMeses {...comun} />
        <Socios {...comun} />
      </div>
      <ParaPresentar d={d} movil={false} hoy={hoy} />
      <DetalleContable {...comun} />
      <RegistroIA registro={d.ia.registro} alCambiar={datos.recargar} movil={false} />
    </>
  )
}
