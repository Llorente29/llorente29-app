// src/modules/conta/apartados/Facturas.tsx
//
// Apartado «Facturas» del móvil: todas las del proveedor, y desde cada una
// «Marcar como pagada», «Deshacer» o cambiar el vencimiento.

import { useFicha } from '@/modules/conta/components/FichaContexto'
import { ListaFacturas } from '@/modules/conta/components/Facturas'

export default function Facturas() {
  const { datos } = useFicha()
  return (
    <div className="cf-tarjeta" style={{ gap: 6 }}>
      <ListaFacturas facturas={datos.facturas} />
    </div>
  )
}
