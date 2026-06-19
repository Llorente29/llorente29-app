// src/modules/orders/pages/OrdersFeedPage.tsx
//
// Página de la vista "Pedidos" (raíz de Folvy Orders). Resuelve el local del
// contexto de sesión (multi-local: el local sale del selector global, no de un
// selector manual). En consolidado pide elegir local, igual que el KDS.

import { MapPin } from 'lucide-react'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import OrdersFeed from '../components/OrdersFeed'

export default function OrdersFeedPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()

  if (isConsolidated || !resolvedLocationId) {
    return (
      <div className="grid place-items-center h-[60vh] text-center text-text-secondary">
        <div>
          <MapPin className="mx-auto mb-3 text-text-secondary" size={32} />
          <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
          <p className="text-sm mt-1">Los pedidos son por local. Elige uno en el selector de arriba.</p>
        </div>
      </div>
    )
  }

  return <OrdersFeed locationId={resolvedLocationId} />
}
