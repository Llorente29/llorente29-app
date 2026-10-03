// src/modules/conta/empresa/useDatosEmpresa.ts
//
// Carga los datos de la empresa activa para «Tu empresa». Al recargar después
// de guardar sigue enseñando lo de antes: la pantalla no vuelve al esqueleto
// ni se cierra lo que la persona tenía abierto.

import { useCallback, useEffect, useState } from 'react'
import { cargarDatosEmpresa } from '@/modules/conta/services/empresaDatosService'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'

interface Carga { clave: string | null; datos: DatosEmpresa | null; error: string | null }

export interface EstadoDatosEmpresa {
  cargando: boolean
  error: string | null
  datos: DatosEmpresa | null
  recargar: () => void
}

export function useDatosEmpresa(accountId: string | null, companyId: string | null, esAdmin: boolean): EstadoDatosEmpresa {
  const [carga, setCarga] = useState<Carga>({ clave: null, datos: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  const base = accountId && companyId ? `${accountId}:${companyId}:${esAdmin ? 'a' : 'n'}` : null
  const clave = base ? `${base}:${vuelta}` : null

  useEffect(() => {
    if (!accountId || !companyId || !clave) return
    let vivo = true
    cargarDatosEmpresa(accountId, companyId, esAdmin)
      .then((datos) => { if (vivo) setCarga({ clave, datos, error: null }) })
      .catch((e: unknown) => { if (vivo) setCarga({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, esAdmin, clave])

  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const alDia = carga.clave === clave && clave !== null
  const deEstaEmpresa = base !== null && carga.clave?.startsWith(`${base}:`) === true && carga.datos !== null
  return {
    cargando: !alDia && !deEstaEmpresa,
    error: alDia ? carga.error : null,
    datos: deEstaEmpresa ? carga.datos : null,
    recargar,
  }
}
