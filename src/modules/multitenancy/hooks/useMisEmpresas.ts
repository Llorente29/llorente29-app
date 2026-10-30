// src/modules/multitenancy/hooks/useMisEmpresas.ts
//
// DM1 · PR 1 (30/10/2026). Las empresas de quien entra (mis_empresas), una vez
// por sesión de la pantalla. Con una sola cuenta el selector de varias no sale.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { misEmpresas } from '../services/empresasService'
import type { CuentaMia } from '../lib/misEmpresas'

export function useMisEmpresas(): CuentaMia[] {
  const { authUserId } = useApp()
  const [cuentas, setCuentas] = useState<CuentaMia[]>([])
  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      const c = authUserId ? await misEmpresas() : []
      if (vivo) setCuentas(c)
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [authUserId])
  return cuentas
}
