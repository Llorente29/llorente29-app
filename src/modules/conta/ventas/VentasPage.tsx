// src/modules/conta/ventas/VentasPage.tsx
//
// «Ventas» a secas (la dirección de antes). V01 · Entrega 2: ya no es una
// página que dice «aún no»: lleva a lo que funciona. Con «Vendo en
// hostelería», a Cierres del día (donde está ahora «Lo que deja el cierre del
// día», C11b); sin ella, a Facturas. Mientras no se sabe, espera: también a la
// empresa activa (sin ella, lo de hostelería se lee sin empresa y sale «no», y
// llevaba a Facturas a quien sí vende en hostelería: lo cazó la e2e del móvil).

import { useContext } from 'react'
import { Navigate } from 'react-router-dom'
import { rutaCierres, rutaFacturasVenta } from '@/config/navegacion'
import { MarcoContexto } from '@/modules/conta/marco/nuevo/contexto'
import { useEmpresas } from '@/modules/conta/empresa/contexto'

export default function VentasPage() {
  const marco = useContext(MarcoContexto)
  const { activa, cargando } = useEmpresas()
  const hosteleria = marco ? marco.hosteleria : true
  if (hosteleria === null || (cargando && !activa)) return <div className="s-lista" aria-busy="true" aria-label="Cargando Ventas"><div className="s-lista-cargando" /></div>
  return <Navigate to={hosteleria ? rutaCierres() : rutaFacturasVenta()} replace />
}
