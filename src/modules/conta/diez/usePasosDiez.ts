// src/modules/conta/diez/usePasosDiez.ts
//
// Lee los cuatro pasos antes de traer de Diez (conta_diez_listo) y los bancos
// sin su subcuenta 572. Con «recargar» para después de hacer un paso.

import { useEffect, useState } from 'react'
import type { ListoDiez } from '@/modules/conta/lib/pasosDiez'
import { bancosSinSubcuenta, leerPasosDiez } from '@/modules/conta/services/pasosDiezService'
import { leerProgramaAnterior } from '@/modules/conta/services/programaService'
import type { ProgramaAnterior } from '@/modules/conta/alta/programa'

/** programa: lo que contestó en el alta («¿De qué programa vienes?»); null si su alta es de antes. */
export interface EstadoPasosDiez { listo: ListoDiez; sinSubcuenta: number; programa: ProgramaAnterior | null }

export function usePasosDiez(accountId: string, companyId: string): [EstadoPasosDiez | null | 'fallo', () => void] {
  const [e, setE] = useState<{ clave: string; v: EstadoPasosDiez | 'fallo' } | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const clave = `${companyId}#${vuelta}`
  useEffect(() => {
    let vivo = true
    Promise.all([leerPasosDiez(companyId), bancosSinSubcuenta(accountId, companyId), leerProgramaAnterior(accountId, companyId)])
      .then(([listo, b, programa]) => { if (vivo) setE({ clave, v: { listo, sinSubcuenta: b.length, programa } }) },
        () => { if (vivo) setE({ clave, v: 'fallo' }) })
    return () => { vivo = false }
  }, [accountId, companyId, clave])
  return [e && e.clave === clave ? e.v : null, () => setVuelta((x) => x + 1)]
}

