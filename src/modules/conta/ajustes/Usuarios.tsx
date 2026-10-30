// src/modules/conta/ajustes/Usuarios.tsx
//
// DM1 · PR 1 (30/10/2026). Ajustes › Usuarios (tablero 4 de «Sumied · DM1 ·
// Demos y varias empresas»): quién entra en la empresa abierta y «Invitar a
// una persona». Antes era un hueco («Quién entra y qué ve… llegan en un
// encargo propio»): es este.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Tarjeta } from '@/modules/conta/diseno'
import { InvitarPersona } from '@/modules/multitenancy/components/InvitarPersona'
import { listUserProfilesByAccount } from '@/modules/multitenancy/services/userProfilesService'
import type { UserProfile } from '@/types/multitenancy'

const ROL: Record<string, string> = { admin: 'Todo (administrador)', manager: 'Encargado', worker: 'Trabajador' }

export function Usuarios() {
  const { activeAccountId, userProfile } = useApp()
  const [usuarios, setUsuarios] = useState<UserProfile[] | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const esAdmin = userProfile?.role === 'admin'

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const l = await listUserProfilesByAccount(activeAccountId)
        if (vivo) setUsuarios(l)
      } catch {
        if (vivo) setUsuarios([])
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [activeAccountId, vuelta])

  return (
    <div className="s-usuarios" data-prueba="ajustes-usuarios">
      <Tarjeta titulo="Quién entra" apoyo={usuarios ? `${usuarios.filter((u) => u.active).length} con acceso` : 'Buscando…'}>
        <ul className="s-usuarios-lista">
          {usuarios?.map((u) => (
            <li key={u.id} data-activo={u.active || undefined}>
              <span className="s-usuarios-nombre">{u.displayName || 'Sin nombre todavía'}</span>
              <span className="s-usuarios-rol">{ROL[u.role] ?? u.role}{u.active ? '' : ' · sin acceso'}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
      {esAdmin
        ? <InvitarPersona alInvitar={() => setVuelta((v) => v + 1)} />
        : <Tarjeta titulo="Invitar a una persona" apoyo="Solo un administrador de la empresa puede invitar." />}
    </div>
  )
}
