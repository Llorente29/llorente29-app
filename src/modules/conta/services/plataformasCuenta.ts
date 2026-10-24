// src/modules/conta/services/plataformasCuenta.ts
//
// Regla de Julio (17/10): lo de plataformas es para quien vende por Uber,
// Glovo o Just Eat. ¿Vende esta cuenta por plataformas? Sus canales de venta
// (sales_channel.slug, por la cuenta: regla 9) lo dicen. Mientras lee, y si no
// puede leer, dice que no: un texto sin «plataforma» no engaña a nadie.

import { useEffect, useState } from 'react'
import { tabla } from '@/modules/conta/services/bd'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { vendePorPlataformas } from '@/modules/conta/lib/terceros'

export function useVendePorPlataformas(): boolean {
  const { accountId } = useCuentaConta()
  const [vende, setVende] = useState(false)
  useEffect(() => {
    if (!accountId) return
    let vivo = true
    void Promise.resolve(tabla('sales_channel').select('slug').eq('account_id', accountId)).then(({ data, error }) => {
      if (vivo) setVende(!error && vendePorPlataformas((data ?? []) as { slug?: string | null }[]))
    })
    return () => { vivo = false }
  }, [accountId])
  return vende
}
