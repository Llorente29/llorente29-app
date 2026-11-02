// src/modules/conta/compras/RemesasPagosPage.tsx
//
// PC01 · Entrega 2 · Compras › Pagos › Remesas (el botón «Remesas» del
// tablero 15): todas las remesas de la empresa y los pagos a mano, la última
// arriba, con su estado y su total. Abre su ficha (tablero 16). Ninguna se
// esconde (regla 7): las pagadas y las vacías también salen.

import { useNavigate } from 'react-router-dom'
import { rutaPagos, rutaRemesaPagos } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { BotonEnlace, Chip } from '@/modules/conta/diseno'
import { TablaLista, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import { NOMBRE_ESTADO_REMESA } from '@/modules/conta/lib/pagos'
import { leerRemesas, type RemesaResumen } from '@/modules/conta/services/pagosService'

const TONO = { preparada: 'duda', fichero: 'duda', en_banco: 'neutro', pagada: 'seguro', vacia: 'neutro' } as const

export default function RemesasPagosPage() {
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const datos = useLeer(activa ? () => leerRemesas(activa.id) : null, `${activa?.id}:remesas`)
  const filas = datos.datos ?? []
  const columnas: ColumnaLista<RemesaResumen>[] = [
    { id: 'codigo', titulo: 'Remesa', celda: (r) => r.codigo, minimo: 110 },
    { id: 'tipo', titulo: 'Qué es', celda: (r) => (r.porBanco ? 'Pago por el banco' : r.aMano ? 'Pago a mano' : 'Transferencias'), prioridad: 3, minimo: 120 },
    { id: 'fecha', titulo: 'Fecha de pago', celda: (r) => diaMesCorto(r.fechaPago), minimo: 100 },
    { id: 'banco', titulo: 'Desde', celda: (r) => r.banco, prioridad: 2, minimo: 120 },
    { id: 'pagos', titulo: 'Pagos', cifra: true, celda: (r) => `${r.pagadas} de ${r.vivas}`, prioridad: 2, minimo: 70 },
    { id: 'total', titulo: 'Total', cifra: true, celda: (r) => eurosExactos(r.total).replace(' €', ''), minimo: 90 },
    { id: 'estado', titulo: 'Estado', celda: (r) => <Chip tono={TONO[r.estado]}>{NOMBRE_ESTADO_REMESA[r.estado]}</Chip>, minimo: 170 },
  ]
  const irAPagos = <BotonEnlace a={rutaPagos()} variante="principal">Ir a Pagos</BotonEnlace>
  return (
    <div className="pg-pagina">
      <EncabezadoPagina titulo="Remesas"
        frase="Las remesas de transferencias que has preparado y los pagos que apuntaste a mano. Cada una se cierra sola cuando casas su cargo en Bancos."
        principal={irAPagos} />
      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las remesas: {datos.error}</p>}
      {!datos.datos && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las remesas"><div className="s-lista-cargando" /></div>}
      {datos.datos && (
        <TablaLista<RemesaResumen> etiqueta="Remesas" columnas={columnas} filas={filas} clave={(r) => r.id} nombre={(r) => `Remesa ${r.codigo}`}
          alAbrir={(r) => navegar(rutaRemesaPagos(r.id))} movil={movil}
          tarjeta={(r) => (
            <span className="pg-tarjeta">
              <span className="pg-tarjeta-fila"><strong>{r.codigo}</strong><strong className="s-cifra">{eurosExactos(r.total)}</strong></span>
              <span className="pg-tarjeta-fila cx-ayuda"><span>{r.porBanco ? 'Pago por el banco' : r.aMano ? 'Pago a mano' : 'Transferencias'} · {diaMesCorto(r.fechaPago)}</span><Chip tono={TONO[r.estado]}>{NOMBRE_ESTADO_REMESA[r.estado]}</Chip></span>
            </span>
          )}
          vacio={<p className="s-lista-vacia">Aún no hay remesas. Se preparan en Pagos, marcando las facturas y «Pagar».</p>} />
      )}
      <BotonPulgar>{irAPagos}</BotonPulgar>
    </div>
  )
}
