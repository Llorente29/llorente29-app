// src/modules/conta/hooks/useImpuestoEmpresa.ts
//
// S01e · Las palabras del impuesto de la empresa (IVA, IGIC o IPSI), leídas de
// company_tax_profile.tax_territory, con la cuenta delante (regla 9). Se lee
// al abrir cada pantalla: si se cambia en Ajustes › Tu empresa, se ve al volver.
// Mientras llega, o si no se puede leer, IVA: es lo que decían antes.

import { useEffect, useState } from 'react'
import { tabla } from '@/modules/conta/services/bd'
import { palabrasDelTerritorio, type PalabrasImpuesto } from '@/modules/conta/lib/impuestoIndirecto'

async function leerTerritorio(accountId: string, companyId: string): Promise<string | null> {
  const { data, error } = await tabla('company_tax_profile').select('tax_territory')
    .eq('account_id', accountId).eq('company_id', companyId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { tax_territory: string | null } | null)?.tax_territory ?? null
}

export function useImpuestoEmpresa(accountId: string | null | undefined, companyId: string | null | undefined): PalabrasImpuesto {
  const clave = accountId && companyId ? `${accountId}|${companyId}` : null
  const [r, setR] = useState<{ clave: string; territorio: string | null } | null>(null)
  useEffect(() => {
    if (!clave || !accountId || !companyId) return
    let vivo = true
    leerTerritorio(accountId, companyId).then((t) => { if (vivo) setR({ clave, territorio: t }) },
      () => { /* sin leer: se queda en IVA, como antes */ })
    return () => { vivo = false }
  }, [clave, accountId, companyId])
  return palabrasDelTerritorio(r && r.clave === clave ? r.territorio : null)
}
