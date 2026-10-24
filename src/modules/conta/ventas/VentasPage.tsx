// src/modules/conta/ventas/VentasPage.tsx
//
// «Ventas» a secas (la dirección de antes). V01 · Entrega 2: ya no es una
// página que dice «aún no»: lleva a lo que funciona. Con «Vendo en
// hostelería», a Cierres del día (donde está ahora «Lo que deja el cierre del
// día», C11b); sin ella, a Facturas. Mientras no se sabe, espera.

import { useContext } from 'react'
import { Navigate } from 'react-router-dom'
import { rutaCierres, rutaFacturasVenta } from '@/config/navegacion'
import { MarcoContexto } from '@/modules/conta/marco/nuevo/contexto'

export default function VentasPage() {
  const marco = useContext(MarcoContexto)
  const hosteleria = marco ? marco.hosteleria : true
  if (hosteleria === null) return <div className="s-lista" aria-busy="true" aria-label="Cargando Ventas"><div className="s-lista-cargando" /></div>
  return <Navigate to={hosteleria ? rutaCierres() : rutaFacturasVenta()} replace />
}
