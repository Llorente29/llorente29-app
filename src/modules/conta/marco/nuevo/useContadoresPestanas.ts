// src/modules/conta/marco/nuevo/useContadoresPestanas.ts
//
// S01f · Los contadores de las pestañas de la cabecera (esqueleto/contadoresPestanas.ts).
// Los grises salen de lo que el marco ya cuenta para la barra (useCuentasMenu):
// no piden nada nuevo a la base. Los rojos de Impuestos leen el calendario de
// la empresa (el mismo que el Inicio), y solo cuando se está en Impuestos: las
// demás pantallas no pagan esa lectura. De ahí sale también «Presentados N», en gris. Se recuerda 30 s por empresa, como el
// menú, y vuelve a leer con `refrescarCuentasMenu()`.

import { useEffect, useMemo, useState } from 'react'
import { leerCalendario } from '@/modules/conta/services/impuestosService'
import { avisosInicio } from '@/modules/conta/impuestos/avisosInicio'
import { EVENTO_CUENTAS_MENU, type CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { contadoresDeCuentas, contadoresDeImpuestos, type ContadoresPestanas } from '@/modules/conta/esqueleto/contadoresPestanas'
import type { IdProducto } from '@/modules/conta/esqueleto/productos'

const cache = new Map<string, { cuando: number; valor: Promise<ContadoresPestanas> }>()

function contarImpuestos(companyId: string): Promise<ContadoresPestanas> {
  // El nivel solo cambia cómo se titula cada aviso, no cuántos hay.
  return leerCalendario(companyId).then((c) => contadoresDeImpuestos(avisosInicio(c, 'medio'), c.presentados?.presentados ?? 0))
    .catch((e: unknown) => { console.error('[pestañas] no se pudo leer lo que vence', e); return {} })
}

export function useContadoresPestanas(producto: IdProducto | null, companyId: string | null, cuentas: CuentasMenu): ContadoresPestanas {
  const [impuestos, setImpuestos] = useState<{ clave: string; valor: ContadoresPestanas } | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const clave = producto === 'impuestos' && companyId ? companyId : null
  useEffect(() => {
    const f = () => { cache.clear(); setVuelta((v) => v + 1) }
    window.addEventListener(EVENTO_CUENTAS_MENU, f)
    return () => window.removeEventListener(EVENTO_CUENTAS_MENU, f)
  }, [])
  useEffect(() => {
    if (!clave) return
    let c = cache.get(clave)
    if (!c || Date.now() - c.cuando > 30_000) {
      c = { cuando: Date.now(), valor: contarImpuestos(clave) }
      cache.set(clave, c)
    }
    let vivo = true
    c.valor.then((v) => { if (vivo) setImpuestos({ clave, valor: v }) })
    return () => { vivo = false }
  }, [clave, vuelta])
  const vence = impuestos && impuestos.clave === clave ? impuestos.valor : null
  return useMemo(() => ({ ...contadoresDeCuentas(cuentas), ...(vence ?? {}) }), [cuentas, vence])
}
