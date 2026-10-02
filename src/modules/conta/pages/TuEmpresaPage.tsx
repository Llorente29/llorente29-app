// src/modules/conta/pages/TuEmpresaPage.tsx
//
// Ajustes › Tu empresa (maquetas N2Empresa y M2Empresa). Tarea 5 del C00.

import { Link } from 'react-router-dom'
import { PESTANAS_AJUSTES, rutaAltaEmpresa } from '@/config/navegacion'
import { Cabecera, ErrorConReintento, PestanasPildora, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { useEmpresas } from '@/modules/conta/empresa/contexto'

export default function TuEmpresaPage() {
  const { cargando, error, activa, recargar } = useEmpresas()
  return (
    <>
      <Cabecera antetitulo="Ajustes" titulo="Tu empresa" />
      <PestanasPildora entradas={PESTANAS_AJUSTES} etiqueta="Ajustes" />
      {cargando ? <TarjetaCargando /> : error ? <ErrorConReintento mensaje={error} reintentar={recargar} /> : !activa ? (
        <div className="cx-tarjeta">
          <Vacio titulo="Aún no has dado de alta tu empresa."
            explicacion="Cuéntame a qué te dedicas y la dejo montada: tus impuestos, tu ejercicio y tus tablas. Son tres minutos y no hace falta saber de contabilidad."
            accion={<Link to={rutaAltaEmpresa()} className="cx-boton">Dar de alta mi empresa</Link>} />
        </div>
      ) : (
        <div className="cx-tarjeta"><Vacio titulo={activa.nombre} explicacion="La pantalla completa llega en la tarea 5." /></div>
      )}
    </>
  )
}
