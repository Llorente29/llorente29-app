// src/modules/kitchen/proveedores/LocalHabitual.tsx
//
// «Local habitual» del proveedor: el local al que suele servir. No es
// contabilidad (respuesta 3 del C02): va en el bloque de Cocina de la ficha,
// junto a «Artículos que le compras». Una cuenta sin Cocina no lo recibe.
// Guardar dice lo que ha guardado (regla 8).
//
// Nombres de la base entre comillas (regla 40), comprobados contra staging:
// supplier.default_location_id; locations (id, name, account_id, active),
// los mismos que lee listarLocales del módulo de contabilidad.

import { useEffect, useId, useState } from 'react'
import { isSupabaseEnabled } from '@/lib/supabase'
// supplier.default_location_id no está aún en src/types/database.ts: acceso sin tipar, en un solo sitio.
import { tabla } from '@/modules/conta/services/bd'

interface Local { id: string; name: string }

export default function LocalHabitual({ accountId, supplierId }: { accountId: string; supplierId: string }) {
  const id = useId()
  const [locales, setLocales] = useState<Local[] | null>(null)
  const [valor, setValor] = useState<string>('')
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseEnabled) return
    let vivo = true
    Promise.all([
      tabla('locations').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
      tabla('supplier').select('default_location_id').eq('id', supplierId).eq('account_id', accountId).maybeSingle(),
    ]).then(([l, s]) => {
      if (!vivo) return
      if (l.error || s.error) { setFallo(`No se ha podido leer el local habitual: ${(l.error ?? s.error)!.message}`); return }
      setLocales((l.data ?? []) as unknown as Local[])
      setValor(((s.data as unknown as { default_location_id: string | null } | null)?.default_location_id) ?? '')
    })
    return () => { vivo = false }
  }, [accountId, supplierId])

  if (fallo && !locales) return <div className="cx-error" role="alert">{fallo}</div>
  if (!locales) return null
  return (
    <div className="cx-campo">
      <label htmlFor={id}>Local habitual</label>
      <select id={id} className="cx-input" value={valor} onChange={async (e) => {
        const nuevo = e.target.value
        setHecho(null); setFallo(null)
        const { error } = await tabla('supplier').update({ default_location_id: nuevo || null } as never).eq('id', supplierId).eq('account_id', accountId)
        if (error) { setFallo(`No se ha podido guardar: ${error.message}`); return }
        setValor(nuevo)
        setHecho(`Local habitual: ${nuevo ? locales.find((x) => x.id === nuevo)?.name ?? '' : 'todos'}.`)
      }}>
        <option value="">Todos</option>
        {locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <span className="cx-ayuda">El local al que suele servir. «Todos» si reparte a todos.</span>
      <div role="status" aria-live="polite">{hecho && <div className="cx-guardado">{hecho}</div>}</div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )
}
