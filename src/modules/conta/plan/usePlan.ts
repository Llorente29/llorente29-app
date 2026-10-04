// src/modules/conta/plan/usePlan.ts
//
// El plan contable de la empresa activa. Al recargar después de un cambio
// sigue enseñando lo de antes (como useDatosEmpresa): no vuelve al esqueleto.

import { useCallback, useEffect, useState } from 'react'
import { cargarPlan, type DatosPlan } from '@/modules/conta/services/planService'

interface Carga { clave: string | null; datos: DatosPlan | null; error: string | null }

export function usePlan(accountId: string | null, companyId: string | null) {
  const [carga, setCarga] = useState<Carga>({ clave: null, datos: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  const base = accountId && companyId ? `${accountId}:${companyId}` : null
  const clave = base ? `${base}:${vuelta}` : null
  useEffect(() => {
    if (!accountId || !companyId || !clave) return
    let vivo = true
    cargarPlan(accountId, companyId)
      .then((datos) => { if (vivo) setCarga({ clave, datos, error: null }) })
      .catch((e: unknown) => { if (vivo) setCarga({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, clave])
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const alDia = carga.clave === clave && clave !== null
  const deEstaEmpresa = base !== null && carga.clave?.startsWith(`${base}:`) === true && carga.datos !== null
  return { cargando: !alDia && !deEstaEmpresa, error: alDia ? carga.error : null, datos: deEstaEmpresa ? carga.datos : null, recargar }
}
