// src/modules/kitchen/proveedores/LoQueLeCompras.tsx
//
// La sección «Lo que le compras» que Cocina aporta a la ficha de proveedor
// (C01): los artículos que se le compran y «Migrar artículos a otro
// proveedor», que es lo que tenía la ficha vieja. Ver extensionesCocina.ts.

import { useEffect, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { ContextoExtension } from '@/modules/conta/extensiones'
import { getSupplierById, listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import SupplierItemsSection from '@/modules/kitchen/components/SupplierItemsSection'
import SupplierMigrateModal from '@/modules/kitchen/components/SupplierMigrateModal'
import type { Supplier } from '@/types/kitchen'

export default function LoQueLeCompras({ accountId, supplierId, alCambiar }: ContextoExtension) {
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [todos, setTodos] = useState<Supplier[]>([])
  const [migrar, setMigrar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([getSupplierById(supplierId), listSuppliers(accountId)])
      .then(([s, t]) => { if (vivo) { setSupplier(s); setTodos(t) } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudieron cargar sus artículos.') })
    return () => { vivo = false }
  }, [accountId, supplierId])

  if (error) return <div className="cf-error" role="alert">{error}</div>
  if (!supplier) return <div className="cf-hueso" style={{ height: 120 }} aria-busy="true" />
  return (
    <>
      <SupplierItemsSection supplier={supplier} onChanged={alCambiar} />
      <button type="button" className="cf-boton-texto" onClick={() => setMigrar(true)} style={{ alignSelf: 'flex-start' }}>
        <ArrowRightLeft size={14} aria-hidden="true" /> Migrar artículos a otro proveedor
      </button>
      {migrar && (
        <SupplierMigrateModal
          source={supplier}
          allSuppliers={todos}
          onClose={() => setMigrar(false)}
          onArchivedSource={() => { setMigrar(false); alCambiar() }}
        />
      )}
    </>
  )
}
