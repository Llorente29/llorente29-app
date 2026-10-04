// src/modules/conta/empresa/EmpresasProveedor.tsx
//
// Carga las empresas de la cuenta y recuerda cuál está elegida (por cuenta, en
// el almacén local del navegador: es una comodidad, no un dato; si se pierde,
// queda la primera).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { listarEmpresas } from '@/modules/conta/services/empresaService'
import {
  EmpresasContexto, claveEmpresaElegida, empresaQueQuedaActiva,
  type EmpresaResumen, type EstadoEmpresas,
} from '@/modules/conta/empresa/contexto'

function leerRecordada(accountId: string): string | null {
  try { return window.localStorage.getItem(claveEmpresaElegida(accountId)) } catch { return null }
}
function recordar(accountId: string, id: string): void {
  try { window.localStorage.setItem(claveEmpresaElegida(accountId), id) } catch { /* sin almacén: se queda la primera */ }
}

interface Carga { accountId: string | null; empresas: EmpresaResumen[]; error: string | null }

export function EmpresasProveedor({ children }: { children: ReactNode }) {
  const { accountId, cargando: cargandoCuenta } = useCuentaConta()
  const [carga, setCarga] = useState<Carga>({ accountId: null, empresas: [], error: null })
  const [vuelta, setVuelta] = useState(0)
  const [elegida, setElegida] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let vivo = true
    listarEmpresas(accountId)
      .then((empresas) => { if (vivo) setCarga({ accountId, empresas, error: null }) })
      .catch((e: unknown) => { if (vivo) setCarga({ accountId, empresas: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  const elegir = useCallback((id: string) => {
    if (accountId) recordar(accountId, id)
    setElegida(id)
  }, [accountId])
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])

  const valor = useMemo<EstadoEmpresas>(() => {
    const alDia = carga.accountId === accountId
    const empresas = alDia ? carga.empresas : []
    const recordada = elegida ?? (accountId ? leerRecordada(accountId) : null)
    return {
      cargando: cargandoCuenta || !accountId || !alDia,
      error: alDia ? carga.error : null,
      empresas,
      activa: empresaQueQuedaActiva(empresas, recordada),
      elegir,
      recargar,
    }
  }, [carga, accountId, cargandoCuenta, elegida, elegir, recargar])

  return <EmpresasContexto.Provider value={valor}>{children}</EmpresasContexto.Provider>
}
