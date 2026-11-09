// src/modules/multitenancy/hooks/useDespacho.ts
//
// G05 (08/11/2026). Dónde está quien entra: si la cuenta abierta es un acceso
// que da su despacho (y de cuál), y los clientes de sus despachos. Se pregunta
// una vez por persona y carga de la página (cambiar de cuenta recarga entera):
// lo leen el Shell, el marco, la franja y el selector, y no se repite.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { dondeEstoy, misClientesDeDespacho } from '../services/empresasService'
import type { ClienteDeDespacho, DondeEstoy } from '../lib/misEmpresas'

export interface Despacho {
  /** Ya se sabe (mientras, `abierto` es null). */
  listo: boolean
  donde: DondeEstoy
  clientes: ClienteDeDespacho[]
}

const NADA: Despacho = { listo: false, donde: { abierto: null, accesos: [] }, clientes: [] }
let memo: { usuario: string; promesa: Promise<Despacho> } | null = null

function leer(usuario: string): Promise<Despacho> {
  if (memo?.usuario !== usuario) {
    memo = {
      usuario,
      promesa: Promise.all([dondeEstoy(), misClientesDeDespacho()])
        .then(([donde, clientes]) => ({ listo: true, donde, clientes }))
        .catch(() => ({ ...NADA, listo: true })),
    }
  }
  return memo.promesa
}

export function useDespacho(): Despacho {
  const { authUserId } = useApp()
  const [d, setD] = useState<Despacho>(NADA)
  useEffect(() => {
    let vivo = true
    if (!authUserId) return
    leer(authUserId).then((x) => { if (vivo) setD(x) })
    return () => { vivo = false }
  }, [authUserId])
  return d
}

/** ¿La cuenta abierta es un acceso del despacho? Entonces solo se ve Sumied. */
export function useEnClienteDelDespacho(): boolean {
  return useDespacho().donde.abierto !== null
}
