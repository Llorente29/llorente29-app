// src/modules/conta/documentos/RecibidasEnAsientos.tsx
//
// S01 · «Recibida» de la cinta de Contabilidad › Asientos (maqueta 3). Abre la
// primera factura recibida para revisar de los últimos 12 meses (las de N22
// «Para mirar») en su vista de Asientos; si no hay ninguna, lo dice y dónde se sube una.
//
// S01d · Con ?nueva=a-mano («Recibida a mano» de la cinta, «+ Nueva recibida a
// mano» del vacío y de Libros › Registro › Recibidas) no salta a ninguna: pinta
// el alta a mano (RecibidaAMano).

import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { rutaDocumentos, rutaRecibidaAMano, rutaRecibidaEnAsientos } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { facturasEnOrden, ventanaParaRevisar } from '@/modules/conta/documentos/documentos'
import { leerDocumentos } from '@/modules/conta/services/documentosService'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import RecibidaAMano from '@/modules/conta/documentos/RecibidaAMano'

export default function RecibidasEnAsientos() {
  const [query] = useSearchParams()
  const aMano = query.get('nueva') === 'a-mano'
  const { activa } = useEmpresas()
  const hoy = hoyEnMadrid()
  const lista = useLeer(activa && !aMano ? async () => {
    const { desde, hasta } = ventanaParaRevisar(hoy)
    const d = await leerDocumentos(activa.id, desde, hasta)
    return facturasEnOrden(d.filas, 'para-mirar')
  } : null, `${activa?.id}:${hoy}`)
  if (aMano) return <RecibidaAMano />
  if (lista.error) return <ErrorConReintento mensaje={lista.error} reintentar={lista.recargar} />
  if (!lista.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Buscando la primera para revisar">{[0, 1].map((i) => <Hueso key={i} alto={40} />)}</div>
  if (lista.datos.length) return <Navigate replace to={`${rutaRecibidaEnAsientos(lista.datos[0])}?ver=para-mirar`} />
  return (
    <div className="cx-tarjeta">
      <h1 className="cx-oculto">Recibidas para revisar</h1>
      <Vacio titulo="Ninguna factura recibida para revisar."
        explicacion="En los últimos 12 meses no queda ninguna por mirar. Las que llegan por correo o subes salen aquí, una detrás de otra, para validarlas. Si tienes una sin fichero, escríbela a mano."
        accion={<span className="s-pie">
          <Link to={rutaRecibidaAMano()} className="cx-boton">+ Nueva recibida a mano</Link>
          <Link to={rutaDocumentos('todas')} className="cx-enlace">Ver las facturas recibidas</Link>
        </span>} />
    </div>
  )
}
