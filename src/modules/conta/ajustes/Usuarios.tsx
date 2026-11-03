// src/modules/conta/ajustes/Usuarios.tsx
//
// DM1 · Ajustes › Usuarios. PR 1 (30/10): «Invitar a una persona» (tablero 4).
// Accesos 1 (03/11, tableros 5 y 6 aprobados por Julio): a la izquierda la
// confirmación de lo último que se ha hecho, «Con acceso» (con quitar) y
// «Pendientes» (con reenviar y anular); a la derecha, invitar. Solo para el
// administrador de la empresa: la base no le enseña esto a nadie más.

import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Tarjeta } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { AccesosYPendientes } from '@/modules/multitenancy/components/AccesosYPendientes'
import { InvitarPersona } from '@/modules/multitenancy/components/InvitarPersona'

export function Usuarios() {
  const { activeAccountId, userProfile } = useApp()
  const { activa } = useEmpresas()
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState('')
  const esAdmin = userProfile?.role === 'admin'

  if (!esAdmin || !activeAccountId) {
    return (
      <div className="s-usuarios" data-prueba="ajustes-usuarios">
        <Tarjeta titulo="Usuarios" apoyo="Solo un administrador de la empresa ve quién entra e invita a otras personas." />
      </div>
    )
  }
  return (
    <div className="s-usuarios" data-prueba="ajustes-usuarios">
      <AccesosYPendientes accountId={activeAccountId} empresa={activa?.nombre ?? 'esta empresa'} aviso={aviso} vuelta={vuelta} />
      <InvitarPersona avisoFuera alInvitar={(frase) => { setAviso(frase); setVuelta((v) => v + 1) }} />
    </div>
  )
}
