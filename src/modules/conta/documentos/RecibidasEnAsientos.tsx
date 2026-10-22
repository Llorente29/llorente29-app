// src/modules/conta/documentos/RecibidasEnAsientos.tsx
//
// S01 · «Recibida» de la cinta de Contabilidad › Asientos (maqueta 3). Abre la
// primera factura recibida para revisar de los últimos 12 meses (la pestaña
// «Por revisar» de Facturas recibidas) en su vista de Asientos; si no hay ninguna, lo dice y dónde se sube una.
//
// S01d · Con ?nueva=a-mano («Recibida a mano» de la cinta, «+ Nueva recibida a
// mano» del vacío y de Libros › Registro › Recibidas) no salta a ninguna: pinta
// el alta a mano (RecibidaAMano).

import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { rutaDocumentos, rutaRecibidaAMano, rutaRecibidaEnAsientos } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ventanaParaRevisar } from '@/modules/conta/documentos/documentos'
import { colaDeFacturas, filasDeLaLista, filtrosDe } from '@/modules/conta/documentos/recibidas'
import { leerDocumentos, leerExtrasFacturas } from '@/modules/conta/services/documentosService'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import RecibidaAMano from '@/modules/conta/documentos/RecibidaAMano'

export default function RecibidasEnAsientos() {
  const [query] = useSearchParams()
  const aMano = query.get('nueva') === 'a-mano'
  const { activa } = useEmpresas()
  const { accountId } = useCuentaConta()
  const hoy = hoyEnMadrid()
  // S02: la primera de la MISMA cola que recorre la ficha («Por revisar», con
  // el orden de serie de la lista), para que sea la «1 de N» y no otra.
  const lista = useLeer(activa && accountId && !aMano ? async () => {
    const { desde, hasta } = ventanaParaRevisar(hoy)
    const d = await leerDocumentos(activa.id, desde, hasta)
    const ids = d.filas.filter((x) => x.tipo === 'factura').map((x) => x.id)
    const extras = await leerExtrasFacturas(accountId, ids).catch(() => new Map())
    return colaDeFacturas(filasDeLaLista(d.filas, extras, filtrosDe(new URLSearchParams('ver=por-revisar'))))
  } : null, `${activa?.id}:${accountId}:${hoy}`)
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
