// src/modules/conta/esqueleto/useContadores.ts
//
// I01c (20/10) · Los contadores de las pestañas del producto activo. Cada
// producto que cuenta algo dice aquí de dónde lo saca; los demás no llevan
// contador. Se vuelven a pedir al cambiar de pantalla (lo presentado o lo
// calculado en una pestaña se ve en las otras al volver). Si la lectura
// falla, no sale ningún contador: la pestaña sigue funcionando igual.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { leerCalendario } from '@/modules/conta/services/impuestosService'
import { contadoresImpuestos } from '@/modules/conta/impuestos/calendario'
import type { Contadores } from './contadores'
import type { IdProducto } from './productos'

const FUENTES: Partial<Record<IdProducto, (companyId: string) => Promise<Contadores>>> = {
  impuestos: async (companyId) => contadoresImpuestos(await leerCalendario(companyId)),
}

export function useContadores(producto: IdProducto | null, companyId: string | null): Contadores {
  const { pathname } = useLocation()
  const clave = producto && companyId && FUENTES[producto] ? `${producto}/${companyId}` : null
  const [leido, setLeido] = useState<{ clave: string; c: Contadores } | null>(null)
  useEffect(() => {
    if (!clave || !producto || !companyId) return
    let vivo = true
    FUENTES[producto]!(companyId).then((c) => { if (vivo) setLeido({ clave, c }) }, () => { if (vivo) setLeido({ clave, c: {} }) })
    return () => { vivo = false }
  }, [clave, producto, companyId, pathname])
  return leido && leido.clave === clave ? leido.c : {}
}
