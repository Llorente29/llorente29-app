// src/modules/multitenancy/hooks/useMisInvitaciones.ts
//
// DM1 · Accesos 1 (03/11/2026). Las invitaciones pendientes de quien entra
// (mis_invitaciones), para el número del botón de empresa y su lista (tablero 7).

import { useEffect, useState } from 'react'
import { misInvitaciones, type MiInvitacion } from '../services/invitacionesService'

export function useMisInvitaciones(): MiInvitacion[] {
  const [lista, setLista] = useState<MiInvitacion[]>([])
  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try { const l = await misInvitaciones(); if (vivo) setLista(l ?? []) } catch { /* sin la 0812 o sin red: ninguna */ }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [])
  return lista
}
